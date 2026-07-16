// Données partagées des pages légales. AUCUNE information d'entité inventée : les
// champs société sont des placeholders à compléter (cf. bandeau LegalShell). Les
// hébergeurs sont factuels (connus). À faire relire par un conseil juridique.

export const LEGAL_UPDATED = "15 juillet 2026";

/** Champs propres à l'éditeur — À RENSEIGNER (rien n'est inventé ici). */
export const ORG = {
  raisonSociale: "[RAISON SOCIALE]",
  formeJuridique: "[FORME JURIDIQUE — ex. SAS]",
  capital: "[CAPITAL] €",
  siren: "[SIREN]",
  rcs: "[RCS — ville d'immatriculation]",
  tva: "[N° TVA intracommunautaire]",
  adresse: "[ADRESSE DU SIÈGE SOCIAL]",
  email: "[email de contact]",
  telephone: "[téléphone]",
  directeurPublication: "[Nom du directeur / de la directrice de la publication]",
  dpo: "[Contact du délégué à la protection des données / responsable RGPD]",
  produit: "MIP RUM",
} as const;

/** Hébergement — factuel (l'architecture réelle du produit). */
export const HOSTS = {
  data: "Supabase (base de données PostgreSQL sur infrastructure AWS, région eu-west-3 — Paris, France)",
  app: "Vercel Inc. (hébergement de l'application console)",
} as const;

/** Sous-traitants ultérieurs — factuels, pour la politique de confidentialité et le DPA. */
export const SUBPROCESSORS: { name: string; role: string; location: string }[] = [
  { name: "Supabase", role: "Hébergement base de données (RUM, comptes)", location: "UE (Paris, eu-west-3)" },
  { name: "Vercel Inc.", role: "Hébergement de l'application console", location: "États-Unis / réseau mondial" },
  { name: "[Fournisseur e-mail — à brancher]", role: "Envoi des alertes e-mail (si activé)", location: "[à préciser — UE recommandé]" },
  { name: "[Fournisseur LLM — Mistral AI recommandé]", role: "Assistance / synthèse (si activée) sur données agrégées, sans PII", location: "[UE si Mistral 🇫🇷]" },
];

export interface LegalDocLink {
  slug: string;
  title: string;
  desc: string;
}

/** Index des documents, pour la page /legal et les liens de pied de page. */
export const LEGAL_DOCS: LegalDocLink[] = [
  { slug: "mentions", title: "Mentions légales", desc: "Éditeur, hébergement, propriété intellectuelle." },
  { slug: "cgu", title: "Conditions générales d'utilisation", desc: "Règles d'accès et d'usage de la console." },
  { slug: "cgv", title: "Conditions générales de vente", desc: "Souscription, prix, durée, réversibilité, SLA." },
  { slug: "confidentialite", title: "Politique de confidentialité", desc: "Données traitées, finalités, droits RGPD." },
  { slug: "dpa", title: "Accord de traitement (DPA)", desc: "Sous-traitance art. 28 RGPD — modèle signable." },
];
