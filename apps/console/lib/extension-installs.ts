// Lecture de l'inventaire de parc — logique PURE, testée. La couche I/O est dans
// queries-extension-installs.ts ; ici, rien qui touche à la base.

/**
 * Compare deux versions « a.b.c ». Renvoie <0, 0, >0 comme un comparateur.
 * Comparaison NUMÉRIQUE segment par segment : en lexicographique, « 0.10.0 »
 * passerait avant « 0.9.0 » et l'inventaire déclarerait périmés les postes les
 * plus à jour. Les segments manquants valent 0 (« 1.2 » == « 1.2.0 »).
 */
export function compareVersions(a: string, b: string): number {
  const seg = (v: string): number[] => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const x = seg(a);
  const y = seg(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Version de référence du parc = la PLUS HAUTE réellement observée.
 *
 * Elle n'est pas lue dans le manifest : la console est déployée seule, sans le
 * dossier de l'extension, et une constante recopiée dériverait en silence au
 * premier oubli. La plus haute version observée se maintient toute seule et
 * répond à la vraie question — « quels postes sont en retard sur le reste du
 * parc » — sans qu'aucune version de référence n'ait à être tenue à jour.
 */
export function fleetVersion(versions: (string | null)[]): string | null {
  let best: string | null = null;
  for (const v of versions) {
    if (!v) continue;
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

export type Freshness = "actif" | "silencieux" | "perdu";

/** Trois jours : un poste éteint du vendredi soir au lundi matin ne doit pas
 *  passer pour perdu. L'extension bat toutes les 6 h quand la machine est allumée. */
export const ACTIF_MS = 3 * 24 * 60 * 60 * 1000;
export const SILENCIEUX_MS = 30 * 24 * 60 * 60 * 1000;

export function freshness(lastSeenMs: number, nowMs: number): Freshness {
  const age = nowMs - lastSeenMs;
  if (age <= ACTIF_MS) return "actif";
  if (age <= SILENCIEUX_MS) return "silencieux";
  return "perdu";
}

/** Nom affiché d'un poste : le libellé de la policy, sinon un identifiant court. */
export function displayName(label: string | null, installId: string): string {
  const l = label?.trim();
  return l && l.length > 0 ? l : `Poste ${installId.slice(0, 8)}`;
}
