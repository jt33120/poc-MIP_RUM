// Catalogue des usages IA — dérivé de l'inventaire uti-platform (docs/AI_MAPPING_UTI.md
// + retour d'inventaire). Il n'y a AUCUN OCR/vision : 6 usages LLM texte, dont
// plusieurs traitent de la donnée personnelle. Ce catalogue enrichit les lignes
// rum_ai (jointes par `route`) avec la sémantique de gouvernance : nature de la
// donnée et traitement PII appliqué AVANT l'appel au fournisseur externe.
//
// Source de vérité provisoire (classification côté console). À terme, ces champs
// seront émis à la source par le backend (attribut `data_class` / `pii_scrubbed`)
// et ce catalogue deviendra un simple repli.

/** Nature de la donnée envoyée au fournisseur IA. */
export type DataClass = "personal" | "business" | "anonymized" | "unknown";
/** Traitement PII appliqué avant l'appel externe. */
export type PiiHandling = "scrubbed" | "raw" | "mixed" | "none" | "unknown";

export interface AiUsage {
  label: string; // libellé métier
  dataClass: DataClass;
  pii: PiiHandling;
  mode: "sync" | "background" | "batch";
  note?: string;
}

// Clé = `route` émise dans le span gen_ai (attribut mip.route).
export const AI_CATALOG: Record<string, AiUsage> = {
  "ao/draft": {
    label: "Rédaction d'AO",
    dataClass: "business",
    pii: "none",
    mode: "sync",
    note: "Spec de mission client (business) ; parfois le nom d'un interlocuteur technique.",
  },
  "ao/summary": {
    label: "Résumé d'AO",
    dataClass: "business",
    pii: "none",
    mode: "background",
    note: "Résumé d'une phrase à partir de champs AO déjà enregistrés.",
  },
  "matching/extract": {
    label: "Extraction features CV (matching)",
    dataClass: "personal",
    pii: "mixed",
    mode: "batch",
    note: "Deux chemins : matching officiel pseudonymisé (strip_pii), mais auto_extract_skills envoie le CV BRUT.",
  },
  "matching/score": {
    label: "Scoring matching",
    dataClass: "business",
    pii: "scrubbed",
    mode: "batch",
    note: "Features déjà pseudonymisées + TJM/expérience (donnée professionnelle, pas de PII directe).",
  },
  "cv/harmonize": {
    label: "Harmonisation CV",
    dataClass: "personal",
    pii: "raw",
    mode: "sync",
    note: "CV brut (nom/contact) envoyé au fournisseur ; seule la SORTIE est anonymisée par le prompt.",
  },
  "assistant/chat": {
    label: "Assistant conversationnel",
    dataClass: "personal",
    pii: "raw",
    mode: "sync",
    note: "Snapshot business + consultants (noms, TJM, clients, partenaires) injecté à chaque message.",
  },
};

const UNKNOWN: AiUsage = {
  label: "Usage non catalogué",
  dataClass: "unknown",
  pii: "unknown",
  mode: "sync",
  note: "Route absente du catalogue — à classifier.",
};

export function catalogFor(route: string | null | undefined): AiUsage {
  return (route && AI_CATALOG[route]) || UNKNOWN;
}

/** Un usage expose-t-il de la donnée personnelle non (ou mal) pseudonymisée ? */
export function isPiiRisk(u: AiUsage): boolean {
  return u.dataClass === "personal" && (u.pii === "raw" || u.pii === "mixed");
}
