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

// ⚠ CES CONSTANTES SONT SERVIES PUBLIQUEMENT (/legal/mentions, /legal/confidentialite,
// /legal/dpa — exemptées d'auth par middleware.ts). Une valeur périmée ici n'est pas une
// coquille : c'est une déclaration RGPD inexacte et opposable. Elles ont déclaré Supabase /
// eu-west-3 Paris pendant douze jours après la migration vers Neon / Francfort, et ont omis
// les deux fournisseurs LLM réellement appelés. Tout changement d'hébergeur ou tout nouvel
// appel sortant vers un tiers qui reçoit des données doit être répercuté ICI dans la même
// modification que le code qui l'introduit (cf. invariant AD-7 du spine d'architecture).

/** Hébergement — factuel, vérifié le 08/09/2026 contre docs/NEON_MIGRATION.md et DEPLOY.md. */
export const HOSTS = {
  data: "Neon (base de données PostgreSQL sur infrastructure AWS, région aws-eu-central-1 — Francfort, Allemagne)",
  app: "Vercel Inc. (hébergement de l'application console ; fonctions serveur exécutées en région fra1 — Francfort, Allemagne)",
  backend:
    "Railway Corp. (hébergement des services backend — réception des mesures, travaux planifiés, serveur MCP de lecture — déployés en région europe-west4, Amsterdam, Pays-Bas)",
} as const;

/**
 * Sous-traitants ultérieurs — factuels, pour la politique de confidentialité et le DPA.
 * Les deux fournisseurs LLM sont listés parce que les deux sont câblés dans le code
 * (apps/console/app/api/{ask,briefing,assist}/route.ts) : celui qui traite dépend de la
 * clé d'API présente en configuration. Le second implique un transfert hors UE.
 */
export const SUBPROCESSORS: { name: string; role: string; location: string }[] = [
  { name: "Neon", role: "Hébergement de la base de données (RUM, comptes)", location: "UE (Francfort, aws-eu-central-1)" },
  { name: "Vercel Inc.", role: "Hébergement de l'application console", location: "États-Unis (société) — fonctions serveur exécutées en UE (Francfort, région fra1)" },
  // Ajouté le 08/09/2026, dans la MÊME modification que l'extraction du backend
  // vers des services autonomes : ce sous-traitant reçoit les mesures RUM
  // envoyées par les navigateurs. Le déclarer après coup aurait fait une
  // déclaration RGPD inexacte et opposable pendant l'intervalle.
  // Le serveur MCP (09/09/2026) tourne sur le même hébergeur et sert les mêmes
  // agrégats, à un agent IA cette fois. Il ne fait PAS entrer de tiers
  // supplémentaire dans la liste : il ne parle qu'à la console, et le modèle qui
  // l'interroge est l'outil de son utilisateur, pas un sous-traitant de MIP.
  { name: "Railway Corp.", role: "Hébergement des services backend (réception des mesures RUM, travaux planifiés, serveur MCP de lecture)", location: "États-Unis (société) — services déployés en UE (europe-west4, Amsterdam, Pays-Bas), relevé le 09/09/2026" },
  { name: "[Fournisseur e-mail — à brancher]", role: "Envoi des alertes e-mail (si activé)", location: "[à préciser — UE recommandé]" },
  { name: "Mistral AI", role: "Assistance et synthèse IA (si activée), sur données agrégées, sans PII", location: "UE (France)" },
  { name: "Anthropic", role: "Assistance et synthèse IA (si activée), sur données agrégées, sans PII — employé lorsque la clé correspondante est configurée", location: "États-Unis (transfert hors UE)" },
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
