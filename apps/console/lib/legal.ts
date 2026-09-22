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

// ⚠ CES CONSTANTES SONT SERVIES PUBLIQUEMENT (/legal/confidentialite, les Specs et le
// pied de page de la vitrine — exemptés d'auth par middleware.ts). Les mentions légales
// et le DPA en ligne ont été retirés le 22/09/2026 : pour un POC interne, c'était
// surdimensionné ; le modèle de DPA reste dans docs/DPA.md. Une valeur périmée ici n'est pas une
// coquille : c'est une déclaration RGPD inexacte et opposable. Elles ont déclaré Supabase /
// eu-west-3 Paris pendant douze jours après la migration vers Neon / Francfort, et ont omis
// les deux fournisseurs LLM alors réellement appelés. Tout changement d'hébergeur ou tout nouvel
// appel sortant vers un tiers qui reçoit des données doit être répercuté ICI dans la même
// modification que le code qui l'introduit (cf. invariant AD-7 du spine d'architecture).

/** Hébergement — factuel, vérifié le 08/09/2026 contre docs/NEON_MIGRATION.md et DEPLOY.md. */
export const HOSTS = {
  data: "Neon (base de données PostgreSQL sur infrastructure AWS, région aws-eu-central-1 — Francfort, Allemagne)",
  app: "Vercel Inc. (hébergement de l'application console et de la collecte des mesures ; fonctions serveur exécutées en région fra1 — Francfort, Allemagne)",
  backend:
    "Railway Corp. (hébergement des travaux planifiés et du serveur MCP de lecture — déployés en région europe-west4, Amsterdam, Pays-Bas)",
} as const;

/**
 * Sous-traitants ultérieurs — factuels, pour la politique de confidentialité.
 *
 * MISTRAL AI ET ANTHROPIC EN SONT SORTIS le 09/09/2026, dans la même modification
 * que la suppression de l'assistant IA interne. Ils y figuraient parce que
 * `app/api/{ask,briefing,assist}/route.ts` les appelaient réellement ; ces routes
 * n'existent plus, aucune donnée ne part donc plus vers un fournisseur de modèle.
 * Les laisser aurait été le symétrique exact du défaut que cet en-tête met en
 * garde : déclarer un sous-traitant qui ne traite rien est aussi faux que d'en
 * omettre un qui traite. Le transfert hors UE qu'impliquait le second disparaît
 * avec eux.
 */
export const SUBPROCESSORS: { name: string; role: string; location: string }[] = [
  { name: "Neon", role: "Hébergement de la base de données (RUM, comptes)", location: "UE (Francfort, aws-eu-central-1)" },
  { name: "Vercel Inc.", role: "Hébergement de l'application console et collecte des mesures RUM envoyées par les navigateurs", location: "États-Unis (société) — fonctions serveur exécutées en UE (Francfort, région fra1)" },
  // Ajouté le 08/09/2026, dans la MÊME modification que l'extraction du backend
  // vers des services autonomes. La réception des mesures n'y a en fait jamais
  // tourné en production (le service `ingest` n'avait aucun domaine public, et il
  // a été supprimé le 21/09/2026) : c'est la route de la console, sur Vercel, qui
  // les reçoit. Railway héberge les travaux planifiés — qui LISENT la base — et le MCP.
  // Le serveur MCP (09/09/2026) tourne sur le même hébergeur et sert les mêmes
  // agrégats, à un agent IA cette fois. Il ne fait PAS entrer de tiers
  // supplémentaire dans la liste : il ne parle qu'à la console, et le modèle qui
  // l'interroge est l'outil de son utilisateur, pas un sous-traitant de MIP.
  { name: "Railway Corp.", role: "Hébergement des travaux planifiés et du serveur MCP de lecture", location: "États-Unis (société) — services déployés en UE (europe-west4, Amsterdam, Pays-Bas), relevé le 09/09/2026" },
  { name: "[Fournisseur e-mail — à brancher]", role: "Envoi des alertes e-mail (si activé)", location: "[à préciser — UE recommandé]" },
];

/**
 * Sources de données tierces embarquées, et l'attribution que leur licence EXIGE.
 *
 * DB-IP IP to Country Lite est distribuée sous CC BY 4.0 : la licence autorise
 * l'usage, y compris commercial, À CONDITION de créditer la source de façon
 * visible. Un fichier de licence au fond du dépôt ne satisfait pas cette
 * condition — c'est pourquoi la mention est rendue dans le pied de page de la
 * vitrine publique, servie sans authentification.
 *
 * Elle figure ici MÊME QUAND LA BASE N'EST PAS DÉPOSÉE : la console ne sait pas
 * ce que porte l'image du service d'ingestion, et une attribution en trop est
 * inoffensive là où une attribution manquante est un manquement de licence.
 *
 * Ce n'est PAS un sous-traitant : aucune donnée ne part chez DB-IP. Le fichier
 * est lu en mémoire de notre propre processus, et aucune adresse IP ne sort.
 */
export const DATA_SOURCES: { name: string; use: string; licence: string; attribution: string; url: string }[] = [
  {
    name: "DB-IP IP to Country Lite",
    use: "Estimation du pays d'origine du trafic à partir de l'adresse réseau, résolue localement (aucune adresse IP n'est transmise ni stockée)",
    licence: "CC BY 4.0",
    attribution: "IP Geolocation by DB-IP",
    url: "https://db-ip.com",
  },
];

export interface LegalDocLink {
  slug: string;
  title: string;
  desc: string;
}

/** Index des documents, pour la page /legal et les liens de pied de page. */
export const LEGAL_DOCS: LegalDocLink[] = [
  { slug: "cgu", title: "Conditions générales d'utilisation", desc: "Règles d'accès et d'usage de la console." },
  { slug: "cgv", title: "Conditions générales de vente", desc: "Souscription, prix, durée, réversibilité, SLA." },
  { slug: "confidentialite", title: "Politique de confidentialité", desc: "Données traitées, finalités, droits RGPD." },
];
