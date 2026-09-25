// LE ROUTEUR : méthode + chemin → enregistrement et paramètres. Rien d'autre.
//
// Un segment fixe l'emporte sur un paramètre (`/v1/dashboards/templates` avant
// `/v1/dashboards/{id}`). Un paramètre ne capture qu'un segment, décodé, et ne
// peut contenir ni `/` ni `..` : une ressource se nomme, elle ne se parcourt pas.
import type { Enregistrement } from "./politique";

export type Aiguillage =
  | { readonly trouve: true; readonly enregistrement: Enregistrement; readonly params: Readonly<Record<string, string>> }
  | { readonly trouve: false; readonly statut: 404 }
  | { readonly trouve: false; readonly statut: 405; readonly permises: readonly string[] };

interface Motif {
  readonly segments: readonly string[];
  readonly enregistrement: Enregistrement;
  /** Nombre de segments fixes : le plus spécifique gagne. */
  readonly poids: number;
}

export function creerRouteur(table: readonly Enregistrement[]): (methode: string, chemin: string) => Aiguillage {
  const motifs: Motif[] = table.map((enregistrement) => {
    const segments = enregistrement.operation.chemin.slice(1).split("/");
    return { segments, enregistrement, poids: segments.filter((s) => !s.startsWith("{")).length };
  });
  motifs.sort((a, b) => b.poids - a.poids);

  return (methode, chemin) => {
    const brut = chemin.slice(1).split("/");
    if (chemin.length > 512 || brut.some((s) => s === "" || s === "." || s === "..")) return { trouve: false, statut: 404 };
    const candidats: { motif: Motif; params: Record<string, string> }[] = [];
    for (const motif of motifs) {
      if (motif.segments.length !== brut.length) continue;
      const params: Record<string, string> = {};
      let accepte = true;
      for (let i = 0; i < brut.length && accepte; i++) {
        const attendu = motif.segments[i];
        if (attendu.startsWith("{")) {
          let valeur: string;
          try {
            valeur = decodeURIComponent(brut[i]);
          } catch {
            accepte = false;
            break;
          }
          if (!valeur || valeur.includes("/") || valeur === "." || valeur === "..") accepte = false;
          else params[attendu.slice(1, -1)] = valeur;
        } else if (attendu !== brut[i]) {
          accepte = false;
        }
      }
      if (accepte) candidats.push({ motif, params });
    }
    if (!candidats.length) return { trouve: false, statut: 404 };
    const bon = candidats.find((c) => c.motif.enregistrement.operation.methode === methode);
    if (bon) return { trouve: true, enregistrement: bon.motif.enregistrement, params: Object.freeze(bon.params) };
    const permises = [...new Set(candidats.map((c) => c.motif.enregistrement.operation.methode))].sort();
    return { trouve: false, statut: 405, permises };
  };
}
