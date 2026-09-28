// Données partagées des pages légales — /legal (index, CGU, CGV, politique de
// confidentialité) et /extension-privacy. UNE SOURCE : chaque page compose ses
// phrases à partir d'ici, et deux documents ne peuvent plus dire deux choses
// différentes. La recette du 26/09/2026 en a relevé trois : la politique de
// l'extension disait les fonctions de Vercel « servies depuis les États-Unis »
// quand celle de la console les disait exécutées à Francfort ; l'une écrivait
// « pseudonyme », l'autre « anonyme » (deux régimes RGPD différents) ; le pays
// était dit « déduit du fuseau horaire » alors que l'adresse IP sert de repli.
//
// AUCUNE INFORMATION D'ENTITÉ INVENTÉE : ce qui reste à fournir est regroupé
// dans `ORG`, et les pages l'affichent entre crochets sous le bandeau « modèle à
// compléter » de `LegalShell`. Les hébergeurs sont factuels. À faire relire par
// un conseil juridique.

export const LEGAL_UPDATED = "28 septembre 2026";

/**
 * L'ÉDITEUR ET SES CONDITIONS — TOUT CE QUI RESTE À FOURNIR, EN UN SEUL OBJET.
 *
 * Chaque valeur entre crochets est un champ à compléter : rien n'y est deviné.
 * À fournir par l'éditeur (puis à faire relire par un conseil juridique) :
 *
 *   Identité de l'éditeur (CGU § 1, CGV, politiques de confidentialité)
 *     raisonSociale          dénomination de la société éditrice
 *     formeJuridique         forme sociale (SAS, SARL…)
 *     capital                montant du capital social
 *     siren                  numéro SIREN
 *     rcs                    ville d'immatriculation au RCS
 *     tva                    numéro de TVA intracommunautaire
 *     adresse                adresse du siège social
 *     email                  adresse de contact générale (aussi : demandes de DPA)
 *     telephone              téléphone de contact
 *     directeurPublication   nom du directeur ou de la directrice de la publication
 *     dpo                    contact du délégué à la protection des données, ou du
 *                            responsable RGPD (adresse e-mail ou postale)
 *
 *   Conditions commerciales (CGV)
 *     tarifs                 grille tarifaire, ou renvoi au devis (§ 3)
 *     delaiPaiement          délai de paiement des factures, en jours (§ 3)
 *     preavis                durée du préavis de résiliation (§ 4)
 *     sla                    taux de disponibilité, fenêtres de maintenance,
 *                            délais de support (§ 5)
 *     reversibilite          durée pendant laquelle l'export reste possible après
 *                            la fin du contrat (§ 7)
 *     plafondResponsabilite  montant ou mode de calcul du plafond (§ 8)
 *     confidentialiteApres   durée de l'obligation de confidentialité après le
 *                            terme du contrat (§ 9)
 *
 * `produit` est le seul champ connu.
 */
export const ORG = {
  produit: "MIP RUM",
  raisonSociale: "[RAISON SOCIALE]",
  formeJuridique: "[FORME JURIDIQUE — ex. SAS]",
  capital: "[CAPITAL] €",
  siren: "[SIREN]",
  rcs: "[RCS — ville d'immatriculation]",
  tva: "[N° TVA intracommunautaire]",
  adresse: "[ADRESSE DU SIÈGE SOCIAL]",
  email: "[e-mail de contact]",
  telephone: "[téléphone]",
  directeurPublication: "[Nom du directeur ou de la directrice de la publication]",
  dpo: "[Contact du délégué à la protection des données ou du responsable RGPD]",
  tarifs: "[grille tarifaire ou devis]",
  delaiPaiement: "[délai de paiement, en jours]",
  preavis: "[durée du préavis]",
  sla: "[taux de disponibilité, fenêtres de maintenance, délais de support]",
  reversibilite: "[durée, ex. 30 jours]",
  plafondResponsabilite: "[montant ou mode de calcul, ex. les sommes versées sur les 12 derniers mois]",
  confidentialiteApres: "[durée après la fin du contrat, ex. 3 ans]",
} as const;

// ⚠ CES CONSTANTES SONT SERVIES PUBLIQUEMENT (/legal/*, /extension-privacy, les Specs
// et le pied de page de la vitrine — exemptés d'auth par middleware.ts). Les mentions
// légales et le DPA en ligne ont été retirés le 22/09/2026 : pour un POC interne,
// c'était surdimensionné ; le modèle de DPA reste dans docs/DPA.md, et les pages y
// renvoient comme à un document FOURNI SUR DEMANDE (`DPA`), jamais par un lien mort.
// Une valeur périmée ici n'est pas une coquille : c'est une déclaration RGPD inexacte
// et opposable. Elles ont déclaré Supabase / eu-west-3 Paris pendant douze jours après
// la migration vers Neon / Francfort, et ont omis les deux fournisseurs LLM alors
// réellement appelés. Tout changement d'hébergeur ou tout nouvel appel sortant vers un
// tiers qui reçoit des données doit être répercuté ICI dans la même modification que
// le code qui l'introduit (cf. invariant AD-7 du spine d'architecture).

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
 * COLLECTE DIRECTE DU DOGFOODING (P6b.G, 28/09/2026). Le capteur de la console
 * elle-même — et lui seul — peut envoyer ses mesures du navigateur au collector,
 * sans passer par Vercel (`NEXT_PUBLIC_DOGFOOD_COLLECTOR_URL`,
 * `lib/ingest-endpoint.ts`). Le collector lit alors l'adresse posée par la façade
 * Railway pour en déduire le pays, en mémoire, le temps de la requête, et ne
 * l'écrit nulle part (`packages/backend/shared/geoip.mjs`). D'où « et,
 * directement du navigateur, celles de la console elle-même » ci-dessous, et la
 * note de Railway. Écrit AVANT que la variable soit posée : déclarer un
 * traitement qui n'a pas encore lieu est le moindre des deux défauts.
 *
 * FORME IMPOSÉE. `lib/presentation-topologie.ts` DÉCOUPE ces phrases : la société
 * avant la première parenthèse, puis « région <id> — Ville, Pays) » ou
 * « région <id>, Ville, Pays) » EN FIN de phrase. Le mot « région » n'y paraît
 * donc qu'une fois, là ; tests/unit/presentation-topologie.test.ts rougit sinon.
 * Elles alimentent aussi une zone générée du README (scripts/readme-sections.mjs) :
 * les changer impose de la régénérer.
 */
export const HOSTS = {
  data: "Neon (base de données PostgreSQL sur infrastructure AWS, région aws-eu-central-1 — Francfort, Allemagne)",
  app: "Vercel Inc. (hébergement de l'application console ; réception des mesures envoyées par les navigateurs et relais vers le collecteur, sans que la console conserve ni transmette l'adresse IP — seul le code pays est transmis ; fonctions serveur exécutées en région fra1 — Francfort, Allemagne)",
  // P4 : l'API de lecture v1 est aussi servie depuis Railway (service `api`),
  // aux machines porteuses d'un jeton ; piste C : le backend de la console
  // (service `console-api`) — voir SUBPROCESSORS.
  backend:
    "Railway Corp. (hébergement du collecteur, qui reçoit les mesures relayées par la console et, directement du navigateur, celles de la console elle-même, les pseudonymise et les écrit en base, des travaux planifiés, de l'API de lecture servie aux machines sur jeton, du backend de la console — comptes, sessions, écrans et écritures — et du serveur MCP de lecture — déployés en région europe-west4, Amsterdam, Pays-Bas)",
} as const;

/** Un sous-traitant ultérieur, tel que le déclarent les politiques de confidentialité. */
export interface SousTraitant {
  /** La société, telle que la nomment ses contrats (clé du registre de docs/CONFORMITE.md § 7). */
  name: string;
  /** Ce qu'elle fait pour le service, en une phrase. */
  role: string;
  /** Le droit dont relève la société. */
  societe: string;
  /** Où les données sont traitées, en toutes lettres. */
  traitement: string;
  /** Identifiant de région de l'hébergeur ; `null` quand il n'en expose pas. */
  region: string | null;
  /** Ce qui encadre un transfert, ou un accès depuis l'extérieur de l'UE. */
  garanties: string;
  /** Précision rendue en note sous le tableau : un fait de traitement, jamais une note d'exploitation. */
  note?: string;
}

/**
 * Les garanties déclarées. C'est la phrase que la politique de confidentialité
 * publiait déjà (« clauses contractuelles types ») ; À VÉRIFIER, fournisseur par
 * fournisseur, dans son accord de traitement lors de la relecture juridique.
 */
const CCT = "Clauses contractuelles types de la Commission européenne";

/**
 * Sous-traitants ultérieurs — factuels, pour les politiques de confidentialité.
 *
 * DÉCLARATIF, PAS UN JOURNAL. Le tableau public dit société, rôle, lieu de
 * traitement et garanties. Les notes d'exploitation (« relevé le 09/09 »,
 * « domaine de test ») vivent dans les commentaires ci-dessous et dans
 * docs/CONFORMITE.md, jamais dans une phrase servie au public.
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
export const SUBPROCESSORS: SousTraitant[] = [
  {
    name: "Neon",
    role: "Hébergement de la base de données : mesures et comptes de la console.",
    societe: "Société de droit américain",
    traitement: "Base hébergée en UE — Francfort, Allemagne",
    region: "aws-eu-central-1",
    garanties: CCT,
  },
  // RELAIS ACTIF (P3). Vercel REÇOIT toujours tout — SDK, extension et CI visent
  // la console, aucune URL n'a changé chez les clients — et relaie au collector la
  // part tirée au sort : corps octet pour octet, code pays seul, AUCUNE adresse
  // (ni `x-forwarded-for`, ni `x-real-ip` : `lib/ingest-relay.ts`).
  // POURQUOI LE REPLI EST NOMMÉ (dans la note). Le chemin d'écriture local n'est
  // PAS retiré (il le sera en C11/C12) : la part non tirée pendant la montée
  // (10 % → 50 % → 100 %) et le repli (collector injoignable, 502/504, disjoncteur
  // ouvert…) sont encore écrits en base par la console, identité RETIRÉE puisqu'aucun
  // secret d'identité n'est posé sur Vercel. Le taire ferait de « relais » une
  // demi-vérité : un DPO en conclurait qu'aucune fonction Vercel n'écrit en base.
  {
    name: "Vercel Inc.",
    role: "Hébergement de la console et réception des mesures envoyées par les navigateurs.",
    societe: "Société de droit américain",
    traitement: "Fonctions serveur exécutées en UE — Francfort, Allemagne",
    region: "fra1",
    garanties: CCT,
    note:
      "La console relaie les mesures au collecteur avec le seul code pays : elle ne conserve ni ne transmet l'adresse IP. " +
      "La part qui n'est pas relayée, et toutes les mesures quand le collecteur est indisponible, est écrite directement " +
      "en base par la console, l'identifiant d'utilisateur retiré.",
  },
  // Ajouté le 08/09/2026, dans la MÊME modification que l'extraction du backend
  // vers des services autonomes. Le premier receveur Railway (`ingest`) n'a
  // jamais reçu une mesure de production — aucun domaine public, supprimé le
  // 21/09/2026 — et Railway n'a d'abord fait que LIRE la base (travaux
  // planifiés) et servir le MCP. Avec le relais P3, le `collector`
  // (europe-west4) reçoit ce que la console lui transmet, hache l'identité
  // (HMAC ; le secret n'existe que sur Railway) et ÉCRIT : c'est désormais son
  // premier rôle, d'où l'ordre de la note. Région relevée le 09/09/2026 ; celle du
  // collecteur est celle que `.railway/railway.ts` lui impose, à revérifier le jour
  // de la bascule.
  // Le serveur MCP (09/09/2026) tourne sur le même hébergeur et sert les mêmes
  // agrégats, à un agent IA cette fois. Il ne fait PAS entrer de tiers
  // supplémentaire dans la liste : il ne parle qu'à l'API v1 de MIP, et le modèle
  // qui l'interroge est l'outil de son utilisateur, pas un sous-traitant de MIP.
  // API DE LECTURE (P4). Le service `api` sert depuis Railway les MÊMES agrégats
  // que l'API v1 de la console, aux mêmes porteurs de jeton — partenaires, CI,
  // le serveur MCP par le réseau privé —, et la console lui relaie ses lectures
  // sur jeton (`lib/api-relay.ts` : jeton, en-têtes d'acceptation et de cache,
  // origine ; aucune adresse). Même donnée, même destinataire : ce qui change est
  // l'hébergeur qui la SERT, et c'est ce qu'il faut déclarer. Lecture seule, sous
  // un rôle de base sans aucun droit d'écriture (migration-v89).
  // BACKEND DE LA CONSOLE (piste C). Le service `console-api` sert depuis Railway
  // ce que la console lisait et écrivait elle-même : la connexion (vérification du
  // mot de passe, sessions), les écrans, les écritures (tableaux de bord, alertes,
  // administration) et les demandes RGPD. Seul client : le serveur de la console
  // sur Vercel, qui lui transmet le jeton de session et, pour le débit de
  // connexion, l'adresse de l'utilisateur de la console (jamais stockée en clair :
  // une empreinte HMAC dans les compteurs de débit, effacée après 24 h
  // d'inactivité, migration-v90). Même donnée, même base : ce qui change est
  // l'hébergeur qui la TRAITE — les comptes de la console compris.
  // COLLECTE DIRECTE DU DOGFOODING (P6b.G, 28/09/2026) : les mesures de la
  // console ELLE-MÊME peuvent arriver du navigateur au collector sans passer par
  // Vercel. Railway reçoit alors l'adresse IP du visiteur de la console : le
  // collector en déduit le pays en mémoire, le temps de la requête, sans l'écrire
  // (`packages/backend/shared/geoip.mjs`, `appliquerGeo` : seuls le code pays, sa
  // provenance et la version de la base sont écrits). La phrase dit « peuvent » :
  // elle reste vraie variable posée ou non, et la coupure (retirer la variable)
  // ne la rend pas fausse. Les journaux HTTP de la plateforme Railway consignent
  // l'adresse source, comme ceux de Vercel : cela relève de son contrat, et
  // docs/CONFORMITE.md § 3.2 le dit.
  {
    name: "Railway Corp.",
    role: "Hébergement des services du backend : collecteur des mesures, travaux planifiés, API de lecture, backend de la console et serveur MCP.",
    societe: "Société de droit américain",
    traitement: "Services déployés en UE — Amsterdam, Pays-Bas",
    region: "europe-west4",
    garanties: CCT,
    note:
      "Le collecteur remplace l'identifiant d'utilisateur par une empreinte (HMAC) avant d'écrire en base. Les mesures " +
      "de la console elle-même peuvent lui être envoyées directement par le navigateur : il en lit alors l'adresse IP " +
      "pour en déduire le pays, le temps de la requête, sans la conserver. L'API de " +
      "lecture et le serveur MCP servent des agrégats aux machines porteuses d'un jeton, sans droit d'écriture. Le " +
      "backend de la console traite les comptes, les sessions, les écrans, les écritures et les demandes RGPD, pour le " +
      "seul serveur de la console ; l'adresse IP d'un utilisateur de la console n'y est gardée que sous forme " +
      "d'empreinte, dans les compteurs de tentatives de connexion, effacée après 24 h d'inactivité.",
  },
  // RESEND (P5), ajouté dans la MÊME modification que la clé posée sur le service
  // `notifier` : c'est lui, sur Railway, qui appelle Resend — ni la console, ni la
  // base. Ce qui part : l'adresse du destinataire (un opérateur, jamais un
  // utilisateur final) et le texte de l'alerte (application, mesure, valeur).
  // POURQUOI « ÉTATS-UNIS » ET NON UNE RÉGION UE. La région d'envoi se choisit PAR
  // DOMAINE chez Resend ; tant que l'expéditeur est le domaine de test `resend.dev`,
  // MIP ne la choisit pas (eu-west-1, Irlande, sera à retenir en vérifiant le
  // domaine d'expédition — docs/CONFORMITE.md § 7). Déclarer un transfert qui
  // n'aurait pas lieu est le moindre des deux défauts ; promettre une résidence UE
  // qui n'existe pas encore serait une déclaration inexacte.
  {
    name: "Resend, Inc.",
    role: "Envoi des alertes par e-mail : adresse du destinataire (un opérateur de la console) et texte de l'alerte ; aucune donnée d'utilisateur final.",
    societe: "Société de droit américain",
    traitement: "Envoi depuis les États-Unis",
    region: null,
    garanties: CCT,
  },
];

/**
 * Le pays des mesures (« Pays estimé : … ») — VÉRIFIÉ dans le code le 28/09/2026 avant d'être écrit.
 * Par la console : le SDK envoie le fuseau horaire du navigateur (`mip.tz`), d'où
 * le pays ; à défaut, la route d'ingestion reprend le code pays que l'hébergeur
 * déduit de l'adresse à la réception (`x-vercel-ip-country`), et le relais ne
 * transmet que ce code (`packages/backend/shared/geoip.mjs`, `appliquerGeo`).
 * EN DIRECT au collecteur, avec la base DB-IP chargée, l'adresse passe DEVANT le
 * fuseau : c'est le chemin du seul capteur de la console elle-même depuis P6b.G
 * (SDK des clients, extension et CI visent toujours la console). D'où une phrase
 * qui ne dit plus d'ordre : elle vaut pour les deux chemins, et pour la politique
 * de l'extension qui la reprend. L'adresse n'est écrite nulle part.
 */
export const PAYS_ESTIME =
  "déduit de l'adresse IP à la réception ou du fuseau horaire du navigateur, sans que cette adresse soit conservée";

/**
 * Les identifiants de la mesure : des PSEUDONYMES, jamais « anonymes » — une
 * donnée pseudonyme reste une donnée personnelle au sens du RGPD (docs/CONFORMITE.md § 2).
 */
export const IDENTIFIANTS_PSEUDONYMES =
  "un identifiant de session et un identifiant de visiteur, tirés au hasard et gardés dans le stockage local du navigateur, sans lien avec l'identité de la personne ni avec son poste. Ce sont des pseudonymes, pas des données anonymes : vider le stockage local du site les efface";

/**
 * L'identité que le site client choisit de transmettre (`setUser` du SDK) :
 * hachée par le collecteur, retirée par la console qui n'a pas le secret
 * (`packages/backend/lib/identity-hash.mjs`).
 */
export const IDENTITE_CLIENT =
  "le cas échéant, l'identifiant d'utilisateur ou de compte que le site transmet, remplacé par une empreinte (HMAC) avant d'être écrit, ou retiré";

/** Durée de conservation des mesures : défaut du travail de purge (migration-v14), réglable par application. */
export const CONSERVATION_MESURES = "30 jours par défaut ; une autre durée peut être convenue par application";

/**
 * Le renvoi à l'accord de traitement. Le DPA en ligne a été retiré le 22/09/2026 :
 * le renvoyer par un lien serait un lien mort, le taire rendrait les CGV
 * incomplètes. Il est donc FOURNI SUR DEMANDE.
 */
export const DPA = "l'accord de traitement des données (DPA), fourni sur demande";

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
  href: string;
  title: string;
  desc: string;
}

/**
 * Index des documents, pour la page /legal. La politique de l'extension y figure :
 * elle est tout aussi opposable, et son adresse (/extension-privacy) est celle que
 * déclare le Chrome Web Store — elle ne se déplace pas sous /legal.
 */
export const LEGAL_DOCS: LegalDocLink[] = [
  { href: "/legal/cgu", title: "Conditions générales d'utilisation", desc: "Règles d'accès et d'usage de la console." },
  { href: "/legal/cgv", title: "Conditions générales de vente", desc: "Souscription, prix, durée, réversibilité, niveaux de service." },
  { href: "/legal/confidentialite", title: "Politique de confidentialité", desc: "Données traitées, finalités, sous-traitants, droits RGPD." },
  {
    href: "/extension-privacy",
    title: "Politique de confidentialité de l'extension",
    desc: "Ce que le capteur navigateur mesure, ce qu'il ne collecte pas, ses permissions.",
  },
];
