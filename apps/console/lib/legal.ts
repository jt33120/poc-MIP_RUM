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

/**
 * Hébergement — factuel. Sociétés et régions vérifiées le 08/09/2026 contre
 * docs/NEON_MIGRATION.md et DEPLOY.md ; RÔLES réécrits pour l'état « relais
 * actif » de P3 (`platform_flag.ingest_relay_pct` > 0).
 *
 * POURQUOI LES RÔLES ONT CHANGÉ. Avant la bascule, la route de la console
 * (Vercel) recevait ET écrivait les mesures ; Railway ne faisait que LIRE la
 * base (travaux planifiés) et servir le MCP. Dès qu'une part des beacons part au
 * relais, le sens s'inverse : Vercel reçoit et relaie — corps tel quel, code
 * pays seul, jamais l'adresse (liste d'en-têtes exacte, `lib/ingest-relay.ts`) —,
 * le `collector` Railway hache l'identité et ÉCRIT, Neon stocke. Garder
 * « Vercel collecte, Railway lit » aurait tu le sous-traitant qui écrit : des
 * deux défauts, le plus coûteux (tests/unit/conformite.test.ts).
 *
 * « SANS QUE LA CONSOLE CONSERVE NI TRANSMETTE L'ADRESSE IP » : le sujet est la
 * console, pas Vercel. Ce que NOTRE code fait de l'adresse, on le prouve (aucun
 * en-tête d'adresse relayé, aucune écriture) ; ce que la plateforme Vercel garde
 * dans ses propres journaux de requêtes relève de son contrat, pas de ce fichier.
 *
 * FORME IMPOSÉE. `lib/presentation-topologie.ts` DÉCOUPE ces phrases : la société
 * avant la première parenthèse, puis « région <id> — Ville, Pays) » ou
 * « région <id>, Ville, Pays) » EN FIN de phrase. Le mot « région » n'y paraît
 * donc qu'une fois, là ; tests/unit/presentation-topologie.test.ts rougit sinon.
 */
export const HOSTS = {
  data: "Neon (base de données PostgreSQL sur infrastructure AWS, région aws-eu-central-1 — Francfort, Allemagne)",
  app: "Vercel Inc. (hébergement de l'application console ; réception des mesures envoyées par les navigateurs et relais vers le collecteur, sans que la console conserve ni transmette l'adresse IP — seul le code pays est transmis ; fonctions serveur exécutées en région fra1 — Francfort, Allemagne)",
  backend:
    "Railway Corp. (hébergement du collecteur, qui reçoit les mesures relayées par la console, les pseudonymise et les écrit en base, ainsi que des travaux planifiés et du serveur MCP de lecture — déployés en région europe-west4, Amsterdam, Pays-Bas)",
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
  // RELAIS ACTIF (P3). Vercel REÇOIT toujours tout — SDK, extension et CI visent
  // la console, aucune URL n'a changé chez les clients — et relaie au collector la
  // part tirée au sort : corps octet pour octet, code pays seul, AUCUNE adresse
  // (ni `x-forwarded-for`, ni `x-real-ip` : `lib/ingest-relay.ts`).
  // POURQUOI LE REPLI EST NOMMÉ. Le chemin d'écriture local n'est PAS retiré (il
  // le sera en C11/C12) : la part non tirée pendant la montée (10 % → 50 % →
  // 100 %) et le repli (collector injoignable, 502/504, disjoncteur ouvert…) sont
  // encore écrits en base par la console, identité RETIRÉE puisqu'aucun secret
  // d'identité n'est posé sur Vercel. Le taire ferait de « relais » une
  // demi-vérité : un DPO en conclurait qu'aucune fonction Vercel n'écrit en base.
  { name: "Vercel Inc.", role: "Hébergement de l'application console ; réception des mesures RUM envoyées par les navigateurs et relais vers le collecteur Railway avec le seul code pays — la console ne conserve ni ne transmet l'adresse IP ; écriture directe en base, identité retirée, de la part non relayée et en repli si le collecteur est indisponible", location: "États-Unis (société) — fonctions serveur exécutées en UE (Francfort, région fra1)" },
  // Ajouté le 08/09/2026, dans la MÊME modification que l'extraction du backend
  // vers des services autonomes. Le premier receveur Railway (`ingest`) n'a
  // jamais reçu une mesure de production — aucun domaine public, supprimé le
  // 21/09/2026 — et Railway n'a d'abord fait que LIRE la base (travaux
  // planifiés) et servir le MCP. Avec le relais P3, le `collector`
  // (europe-west4) reçoit ce que la console lui transmet, hache l'identité
  // (HMAC ; le secret n'existe que sur Railway) et ÉCRIT : c'est désormais son
  // premier rôle, d'où l'ordre de la phrase. « Collecteur déployé dans la même
  // région » n'est pas un relevé daté comme celui du 09/09 : c'est la région que
  // `.railway/railway.ts` lui impose, à revérifier le jour de la bascule.
  // Le serveur MCP (09/09/2026) tourne sur le même hébergeur et sert les mêmes
  // agrégats, à un agent IA cette fois. Il ne fait PAS entrer de tiers
  // supplémentaire dans la liste : il ne parle qu'à la console, et le modèle qui
  // l'interroge est l'outil de son utilisateur, pas un sous-traitant de MIP.
  { name: "Railway Corp.", role: "Hébergement du collecteur des mesures RUM (réception des mesures relayées par la console, pseudonymisation de l'identité, écriture en base), des travaux planifiés et du serveur MCP de lecture", location: "États-Unis (société) — services déployés en UE (europe-west4, Amsterdam, Pays-Bas), relevé le 09/09/2026 ; collecteur déployé dans la même région" },
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
