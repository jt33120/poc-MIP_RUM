// LA CARTE « SANTÉ DE LA CHAÎNE DE MESURE » — ce qu'elle dit, sans base ni rendu.
//
// Le verdict se lit d'abord dans l'ÂGE du dernier passage : un canari qui ne passe
// plus ne laisse aucune ligne, donc aucun échec à afficher — seul son silence le
// dit. La règle suit celle du scheduler (`planReconstitution`, étude A3 § 2.5) :
// au-delà de `2 × cadence + 5 min` sans passage, la chaîne est tenue pour
// interrompue. Ensuite, la fenêtre ouverte de la plateforme (`portee = '*'`,
// étage `chaine`) décide : interrompue, dégradée, ou rien.
import type { FenetreRegistre, SanteChaineBrute } from "./queries-chaine";

export type NiveauChaine = "ok" | "attention" | "incident" | "inconnu";

/** Les étages sondés à chaque passage, dans l'ordre du trajet d'une mesure. */
export const ETAGES_CHAINE: ReadonlyArray<{ etage: string; libelle: string; aide: string }> = [
  { etage: "ingest_console", libelle: "Console", aide: "le canari envoyé à l'adresse publique des capteurs (console, relais, collector)" },
  { etage: "ecriture", libelle: "Base", aide: "les lignes de ce canari relues en base, table par table" },
  { etage: "ingest_collector", libelle: "Collector direct", aide: "le même canari, envoyé en direct au collector, relu en base" },
];

const LIBELLES_RESULTAT: Record<string, string> = {
  ok: "réussi",
  lent: "lent",
  repli: "repli local",
  echec: "échec",
  absent: "lignes absentes",
  saute: "sauté",
};

export function libelleResultat(resultat: string): string {
  return LIBELLES_RESULTAT[resultat] ?? resultat;
}

export function niveauResultat(resultat: string | null | undefined): NiveauChaine {
  if (resultat === "ok") return "ok";
  if (resultat === "lent" || resultat === "repli") return "attention";
  if (resultat === "echec" || resultat === "absent") return "incident";
  return "inconnu";
}

/** « il y a 6 min », « il y a 3 h », « il y a 2 j » ; « à l'instant » sous la minute. */
export function depuis(instant: string, maintenant: number): string {
  const min = Math.floor((maintenant - Date.parse(instant)) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/** Durée d'une fenêtre, en clair : « 3 j 16 h », « 45 min ». */
export function duree(debut: string, fin: string | null, maintenant: number): string {
  const min = Math.max(0, Math.round(((fin === null ? maintenant : Date.parse(fin)) - Date.parse(debut)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}

export type VerdictChaine = { niveau: NiveauChaine; titre: string; detail: string | null };

/**
 * Le verdict de la carte. `cadenceMin` : la cadence publiée du tick (15 par défaut).
 * `brute = null` : le schéma des sondes n'est pas encore là.
 */
export function verdictChaine(brute: SanteChaineBrute | null, maintenant: number, cadenceMin: number | null): VerdictChaine {
  if (brute === null) {
    return { niveau: "inconnu", titre: "Sondes pas encore en service", detail: "La base n'a pas encore le journal des sondes : la mise à jour du schéma n'est pas appliquée." };
  }
  if (brute.dernier === null) {
    return { niveau: "inconnu", titre: "Aucun passage du canari", detail: "Le scheduler n'a encore journalisé aucun passage (canari coupé, ou pas encore démarré)." };
  }
  const cadence = cadenceMin ?? 15;
  const age = maintenant - Date.parse(brute.dernier.emis_at);
  if (age > (2 * cadence + 5) * 60_000) {
    return {
      niveau: "incident",
      titre: `Aucun passage du canari ${depuis(brute.dernier.emis_at, maintenant)}`,
      detail: `Au-delà de ${2 * cadence + 5} min sans passage (tick de ${cadence} min), la base ou le scheduler est injoignable.`,
    };
  }
  const ouverte = fenetreOuvertePlateforme(brute.fenetres);
  if (ouverte?.etat === "interrompue") {
    return { niveau: "incident", titre: `Collecte interrompue depuis ${depuis(ouverte.debut, maintenant).replace("il y a ", "")}`, detail: ouverte.cause };
  }
  if (ouverte?.etat === "degradee") {
    return { niveau: "attention", titre: `Collecte dégradée depuis ${depuis(ouverte.debut, maintenant).replace("il y a ", "")}`, detail: ouverte.cause };
  }
  return { niveau: "ok", titre: `Collecte en service · dernier canari ${depuis(brute.dernier.emis_at, maintenant)}`, detail: null };
}

export function fenetreOuvertePlateforme(fenetres: readonly FenetreRegistre[]): FenetreRegistre | null {
  return fenetres.find((f) => f.fin === null && f.portee === "*" && f.etage === "chaine") ?? null;
}

/** Part des canaris aboutis, en pourcentage entier ; `null` sans passage. */
export function tauxAboutis(taux: { total: number; aboutis: number }): number | null {
  return taux.total > 0 ? Math.floor((taux.aboutis / taux.total) * 1000) / 10 : null;
}

const LIBELLES_SOURCE: Record<FenetreRegistre["source"], string> = {
  sonde: "sonde",
  reconstitution: "reconstituée",
  operateur: "opérateur",
};

export function libelleSource(source: FenetreRegistre["source"]): string {
  return LIBELLES_SOURCE[source] ?? source;
}
