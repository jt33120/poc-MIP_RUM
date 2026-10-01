// LA CARTE « SANTÉ DE LA CHAÎNE DE MESURE » — ce qu'elle dit, sans base ni rendu.
//
// Le verdict se lit d'abord dans l'ÂGE du dernier passage : un canari qui ne passe
// plus ne laisse aucune ligne, donc aucun échec à afficher — seul son silence le
// dit. La règle suit celle du scheduler (`planReconstitution`, étude A3 § 2.5) :
// au-delà de `2 × cadence + 5 min` sans passage, la chaîne est tenue pour
// interrompue. Ensuite, la fenêtre ouverte de la plateforme (`portee = '*'`,
// étage `chaine`) décide : interrompue, dégradée, ou rien.
import type { EtatDef } from "@/components/charts/FriseEtats";
import type { EtatMesure, FenetreRegistre, HeureEtage, SanteChaineBrute } from "./queries-chaine";

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
  if (brute === null) return verdictMesure(null, maintenant);
  const ouverte = fenetreOuvertePlateforme(brute.fenetres);
  return verdictMesure(
    {
      dernier: brute.dernier?.emis_at ?? null,
      ouverte: ouverte && { etat: ouverte.etat, debut: ouverte.debut, cause: ouverte.cause },
      cadenceMin,
    },
    maintenant,
  );
}

/**
 * Le même verdict, depuis le seul nécessaire (`EtatMesure`) : c'est ce que lit le
 * badge de l'en-tête (`lireEtatMesure`), et la carte y ramène sa lecture — un seul
 * verdict, deux affichages. `etat = null` : le schéma des sondes n'est pas là.
 */
export function verdictMesure(etat: EtatMesure | null, maintenant: number): VerdictChaine {
  if (etat === null) {
    return { niveau: "inconnu", titre: "Sondes pas encore en service", detail: "La base n'a pas encore le journal des sondes : la mise à jour du schéma n'est pas appliquée." };
  }
  if (etat.dernier === null) {
    return { niveau: "inconnu", titre: "Aucun passage du canari", detail: "Le scheduler n'a encore journalisé aucun passage (canari coupé, ou pas encore démarré)." };
  }
  const cadence = etat.cadenceMin ?? 15;
  const age = maintenant - Date.parse(etat.dernier);
  if (age > (2 * cadence + 5) * 60_000) {
    return {
      niveau: "incident",
      titre: `Aucun passage du canari ${depuis(etat.dernier, maintenant)}`,
      detail: `Au-delà de ${2 * cadence + 5} min sans passage (tick de ${cadence} min), la base ou le scheduler est injoignable.`,
    };
  }
  const ouverte = etat.ouverte;
  if (ouverte?.etat === "interrompue") {
    return { niveau: "incident", titre: `Collecte interrompue depuis ${depuis(ouverte.debut, maintenant).replace("il y a ", "")}`, detail: ouverte.cause };
  }
  if (ouverte?.etat === "degradee") {
    return { niveau: "attention", titre: `Collecte dégradée depuis ${depuis(ouverte.debut, maintenant).replace("il y a ", "")}`, detail: ouverte.cause };
  }
  return { niveau: "ok", titre: `Collecte en service · dernier canari ${depuis(etat.dernier, maintenant)}`, detail: null };
}

/** Le libellé court du badge de l'en-tête. */
export function libelleBadgeMesure(niveau: NiveauChaine): string {
  return { ok: "Mesure OK", attention: "Mesure dégradée", incident: "Mesure interrompue", inconnu: "Mesure non sondée" }[niveau];
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

/**
 * L'étage d'une fenêtre autre que la synthèse (`chaine`), entre parenthèses sur sa
 * ligne. `ordonnanceur` : les travaux planifiés se sont tus, constaté par le
 * notifier (`packages/backend/jobs/veille-ordonnanceur.mjs`).
 */
const LIBELLES_ETAGE: Record<string, string> = { ordonnanceur: "travaux planifiés" };

export function libelleEtage(etage: string): string {
  return LIBELLES_ETAGE[etage] ?? etage;
}

// ─── La frise de 7 jours ─────────────────────────────────────────────────────
//
// UNE CASE PAR HEURE, pas par passage : 7 × 24 = 168 cases lisibles sur la
// largeur d'une carte, là où 672 passages (tick de 15 min) tomberaient sous le
// pixel. La case prend le PIRE résultat de l'heure, et son libellé dit le compte
// de chacun (« 4 passages : 3 réussi, 1 lent »). Une heure sans passage est
// hachurée : l'absence de preuve se lit, elle ne se suppose pas (étude A3 § 2.1).

/** Heures couvertes par la frise. */
export const HEURES_FRISE = 7 * 24;
const HEURE_MS = 3_600_000;

/**
 * Les états de la frise, au format de `FriseEtats` : la forme et le glyphe portent
 * l'état, la couleur ne fait que doubler. `lignes_absentes` : le résultat `absent`
 * (lignes non relues en base) — la clé `absent` de `FriseEtats` est déjà « aucun
 * passage », qu'elle donne d'elle-même à une heure sans ligne.
 */
export const ETATS_FRISE_CHAINE: EtatDef[] = [
  { cle: "ok", libelle: "réussi", forme: "basse", ton: "good" },
  { cle: "lent", libelle: "lent", forme: "moyenne", glyphe: "!", ton: "warn" },
  { cle: "repli", libelle: "repli local", forme: "moyenne", glyphe: "~", ton: "warn" },
  { cle: "echec", libelle: "échec", forme: "haute", glyphe: "×", ton: "bad" },
  { cle: "lignes_absentes", libelle: "lignes absentes", forme: "haute", glyphe: "?", ton: "bad" },
  { cle: "saute", libelle: "sauté", forme: "contour", ton: "neutre" },
  { cle: "absent", libelle: "aucun passage", forme: "hachure", ton: "vide" },
];

/** Du moins grave au plus grave : une heure prend le pire de ses passages. */
const GRAVITE_RESULTAT = ["ok", "saute", "lent", "repli", "absent", "echec"];
const rang = (r: string) => GRAVITE_RESULTAT.indexOf(r);

/** Les débuts d'heure (ms) de la frise : les 168 dernières heures, l'heure en cours comprise. */
export function debutsFrise(maintenant: number): number[] {
  const derniere = Math.floor(maintenant / HEURE_MS) * HEURE_MS;
  return Array.from({ length: HEURES_FRISE }, (_, i) => derniere - (HEURES_FRISE - 1 - i) * HEURE_MS);
}

/** Les cases d'un étage : une par heure lue, au pire résultat, le compte de chacun dans le détail. */
export function casesFrise(heures: readonly HeureEtage[], etage: string): Array<{ t: string; etat: string; detail: string }> {
  return heures
    .filter((h) => h.etage === etage)
    .map((h) => {
      const presents = Object.entries(h.resultats)
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => rang(a) - rang(b));
      const total = presents.reduce((s, [, n]) => s + n, 0);
      const pire = presents.length > 0 ? presents[presents.length - 1][0] : "saute";
      const detail = `${total} passage${total > 1 ? "s" : ""} : ${presents.map(([r, n]) => `${n} ${libelleResultat(r)}`).join(", ")}`;
      return { t: h.heure, etat: pire === "absent" ? "lignes_absentes" : pire, detail };
    });
}

/** « p50 420 ms · p95 1 800 ms, sur 672 passages » ; `null` sans mesure. */
export function libelleLatences(l: { p50: number | null; p95: number | null; n: number } | undefined): string | null {
  if (!l || l.n === 0 || l.p50 === null || l.p95 === null) return null;
  const ms = (v: number) => `${v.toLocaleString("fr-FR")} ms`;
  return `p50 ${ms(l.p50)} · p95 ${ms(l.p95)}, sur ${l.n.toLocaleString("fr-FR")} passage${l.n > 1 ? "s" : ""}`;
}
