// La page « Installer » (`app/installer/page.tsx`) : ce qui s'y calcule sans base ni
// navigateur — les trois parcours, ce qui est propre à l'application, l'état du test
// « ça arrive », la règle d'arrêt du sondage, les codes par pile et le décompte des
// check-lists. Module pur : tout est testé dans `tests/unit/installer.test.ts`.
//
// POURQUOI UNE PAGE DE PLUS, À CÔTÉ DE LA FICHE D'UN CLIENT. La fiche
// (`/admin/customers/[appId]`) est un écran d'administrateur : un client qui a accès
// à son application ne la voit pas. `/installer` suit l'application sélectionnée,
// comme les autres écrans, et parle à l'équipe technique du client.
import { fmtInstant } from "./format";
import { buildInjectionArtifacts } from "./onboarding";
import { REPERE_CLE_API, nomDeService } from "./recettes-agents-otel";

// ─── Les parcours ────────────────────────────────────────────────────────────

export const PARCOURS = ["snippet", "extension", "serveur"] as const;
export type Parcours = (typeof PARCOURS)[number];

/** Libellé court d'un parcours (onglet, carte). */
export const LIBELLE_PARCOURS: Record<Parcours, string> = {
  snippet: "Code de suivi",
  extension: "Extension navigateur",
  serveur: "Serveur",
};

/** L'ancre des onglets des parcours : les cartes « Lequel choisir ? » y ramènent. */
export const ANCRE_PARCOURS = "parcours-installation";

/** Le parcours d'un fragment d'URL (`#extension`) ; le code de suivi par défaut. */
export function parcoursDuFragment(fragment: string | null | undefined): Parcours {
  const nom = (fragment ?? "").replace(/^#/, "");
  return (PARCOURS as readonly string[]).includes(nom) ? (nom as Parcours) : "snippet";
}

/**
 * L'AVERTISSEMENT DE L'EXTENSION — À RETIRER quand l'extension enverra une clé :
 * passer cette constante à `null` suffit (la page et le test « ça arrive » ne
 * l'affichent que si elle vaut un texte).
 *
 * Depuis le 29/09/2026, le collector exige une clé d'API (`REQUIRE_API_KEY: "true"`,
 * `.railway/railway.ts`) et la console lui relaie toute la collecte, sans repli sur
 * un 403 ; or l'extension injecte le SDK sans clé (`apps/extension/src/background.ts`,
 * `inject` : `endpoint`, `appId`, `collectionSource`). Ses mesures sont donc
 * refusées. Le battement des postes, lui, passe : sa route ne demande pas de clé.
 */
export const AVERTISSEMENT_EXTENSION_SANS_CLE: string | null =
  "Depuis le 29/09/2026, la collecte exige une clé d'API, et l'extension n'en envoie pas encore : ses mesures sont refusées (erreur 403) tant qu'un correctif n'est pas livré. Le battement des postes, lui, arrive. En attendant, préférez le code de suivi.";

// ─── Le sondage en direct ────────────────────────────────────────────────────

/** Le rythme de la relecture, celui de la fiche d'un client (`AutoRefresh`). */
export const INTERVALLE_SONDAGE_MS = 5_000;
/** Au plus 10 minutes d'interrogation : la base est payée à l'usage. */
export const DUREE_MAX_SONDAGE_MS = 10 * 60_000;
/** Le même plafond, en relectures : 120 au plus, puis « Vérifier à nouveau ». */
export const RELECTURES_MAX = DUREE_MAX_SONDAGE_MS / INTERVALLE_SONDAGE_MS;

export type EtatSondage = "en_cours" | "en_pause" | "vert" | "delai";

/**
 * Faut-il relire maintenant, et que dire du sondage ? L'ordre compte : tout vert
 * arrête avant tout (plus rien à attendre), puis le plafond, puis l'onglet masqué
 * (aucune requête, mais le sondage reprend au retour), puis une relecture encore en
 * cours (jamais deux à la fois).
 *
 * Le plafond se compte en relectures FAITES, pas en temps écoulé : un onglet laissé
 * masqué le temps de poser le code ne consomme rien, et le client qui revient voit
 * encore le test tourner.
 */
export function decisionSondage(e: { relectures: number; toutVert: boolean; visible: boolean; enCours: boolean }): {
  relire: boolean;
  etat: EtatSondage;
} {
  if (e.toutVert) return { relire: false, etat: "vert" };
  if (e.relectures >= RELECTURES_MAX) return { relire: false, etat: "delai" };
  if (!e.visible) return { relire: false, etat: "en_pause" };
  if (e.enCours) return { relire: false, etat: "en_cours" };
  return { relire: true, etat: "en_cours" };
}

/** « encore 9 min au plus » : ce qu'il reste de relectures, en minutes entamées. */
export function minutesRestantes(relectures: number): number {
  const restantes = Math.max(0, RELECTURES_MAX - relectures);
  return Math.ceil((restantes * INTERVALLE_SONDAGE_MS) / 60_000);
}

// ─── Le test « ça arrive » ───────────────────────────────────────────────────

type Instant = Date | string | null;

/**
 * Les faits du test, lus par `sondeInstallation` (`lib/queries-customers.ts`). Chaque
 * lecture est bornée — une fenêtre, un nombre de lignes — parce qu'elle est rejouée
 * toutes les 5 secondes : la sonde de la fiche (`probeOnboarding`) prend le
 * minimum de toutes les Web Vitals de l'application, une lecture qui grandit avec
 * l'historique.
 */
export interface SondeInstallation {
  /** Code de suivi : sessions `collection_source = 'sdk'` et leurs Web Vitals (7 jours). */
  derniere_mesure_sdk: Instant;
  sessions_sdk_24h: number;
  /** Extension : battements des postes (depuis toujours) et mesures de ses sessions (7 jours). */
  dernier_battement: Instant;
  postes: number;
  derniere_mesure_extension: Instant;
  sessions_extension_24h: number;
  /** Serveur : temps serveur (7 jours) et appels du navigateur reliés à leur part serveur. */
  dernier_span_serveur: Instant;
  spans_serveur_24h: number;
  dernier_appel_relie: Instant;
}

/** Un compte est plafonné par la sonde : au-delà, « 1 000 et plus ». */
export const PLAFOND_COMPTE = 1000;

export function compteLisible(n: number, singulier: string, plurielForme: string): string {
  if (n >= PLAFOND_COMPTE) return `${PLAFOND_COMPTE.toLocaleString("fr-FR")} ${plurielForme} et plus`;
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? plurielForme : singulier}`;
}

export interface Verification {
  id: string;
  libelle: string;
  ok: boolean;
  /** Ce que la sonde a vu (« dernière à 26/09 à 14:03 · 12 sessions sur 24 h »), ou « en attente ». */
  detail: string;
  /** Pourquoi elle peut rester en attente, quand on le sait. */
  aide?: string;
}

const EN_ATTENTE = "en attente";

function vu(instant: Instant, suite?: string): string {
  if (!instant) return EN_ATTENTE;
  const quand = `dernière à ${fmtInstant(instant)}`;
  return suite ? `${quand} · ${suite}` : quand;
}

/**
 * Les cases du test « ça arrive » d'un parcours. Sonde illisible (`null`) : tout est
 * en attente — jamais un vert qui n'a pas été vu.
 */
export function verificationsDe(parcours: Parcours, sonde: SondeInstallation | null): Verification[] {
  const s = sonde;
  switch (parcours) {
    case "snippet":
      return [
        {
          id: "sdk-mesures",
          libelle: "Web Vitals reçues du code de suivi",
          ok: !!s?.derniere_mesure_sdk,
          detail: vu(s?.derniere_mesure_sdk ?? null),
        },
        {
          id: "sdk-sessions",
          libelle: "Sessions du code de suivi, sur les dernières 24 h",
          ok: (s?.sessions_sdk_24h ?? 0) > 0,
          detail: s && s.sessions_sdk_24h > 0 ? compteLisible(s.sessions_sdk_24h, "session", "sessions") : "aucune",
        },
      ];
    case "extension":
      return [
        {
          id: "ext-battement",
          libelle: "Battement d'un poste équipé",
          ok: !!s?.dernier_battement,
          detail: s?.dernier_battement ? vu(s.dernier_battement, compteLisible(s.postes, "poste", "postes")) : EN_ATTENTE,
          aide: "Un poste se déclare à l'installation, puis au plus toutes les 6 heures.",
        },
        {
          id: "ext-mesures",
          libelle: "Mesures envoyées par l'extension",
          ok: !!s?.derniere_mesure_extension,
          detail: vu(
            s?.derniere_mesure_extension ?? null,
            s ? compteLisible(s.sessions_extension_24h, "session sur 24 h", "sessions sur 24 h") : undefined,
          ),
          aide: AVERTISSEMENT_EXTENSION_SANS_CLE ? "Refusées tant que l'extension n'envoie pas de clé : voir l'avertissement en tête du parcours." : undefined,
        },
      ];
    case "serveur":
      return [
        {
          id: "serveur-spans",
          libelle: "Temps serveur reçus de l'agent",
          ok: !!s?.dernier_span_serveur,
          detail: vu(s?.dernier_span_serveur ?? null, s ? compteLisible(s.spans_serveur_24h, "appel sur 24 h", "appels sur 24 h") : undefined),
        },
        {
          id: "serveur-relies",
          libelle: "Appels du navigateur reliés à leur part serveur",
          ok: !!s?.dernier_appel_relie,
          detail: vu(s?.dernier_appel_relie ?? null),
          aide: "Il faut le code de suivi sur le site, et l'en-tête traceparent accepté par l'API.",
        },
      ];
  }
}

/** Tout est-il arrivé pour ce parcours ? C'est ce qui arrête le sondage. */
export function toutVert(parcours: Parcours, sonde: SondeInstallation | null): boolean {
  return verificationsDe(parcours, sonde).every((v) => v.ok);
}

// ─── Les check-lists ─────────────────────────────────────────────────────────

/**
 * Le décompte d'une check-list : les cases cochées à la main, plus les cases du
 * test « ça arrive » que la sonde a vues. Une case de sonde ne se coche jamais au
 * clic : `coches` n'est lu que pour les cases manuelles.
 */
export function compteChecklist(
  items: readonly { id: string; sonde?: { ok: boolean } }[],
  coches: ReadonlySet<string>,
): { faits: number; total: number; complet: boolean } {
  const faits = items.filter((i) => (i.sonde ? i.sonde.ok : coches.has(i.id))).length;
  return { faits, total: items.length, complet: items.length > 0 && faits === items.length };
}

/** Cocher ou décocher une case : un NOUVEL ensemble (l'état React ne se modifie pas en place). */
export function basculerCoche(coches: ReadonlySet<string>, id: string): Set<string> {
  const suivant = new Set(coches);
  if (suivant.has(id)) suivant.delete(id);
  else suivant.add(id);
  return suivant;
}

// ─── Ce qui est propre à l'application ───────────────────────────────────────

export interface DomaineExtension {
  domaine: string;
  etat: "actif" | "coupe" | "non_enregistre";
}

/** Un hôte de poste de développement : l'extension ne sert à rien dessus. */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * Les domaines de l'extension pour une application : ceux du registre (actifs ou
 * coupés), puis les domaines déclarés pour le code de suivi qui n'y sont pas — ceux
 * qu'il faudrait enregistrer pour que l'extension y mesure.
 */
export function domainesExtension(
  registre: readonly { domain: string; active: boolean }[],
  origines: readonly string[],
): DomaineExtension[] {
  const connus = new Set(registre.map((r) => r.domain.toLowerCase()));
  const manquants = new Set<string>();
  for (const o of origines) {
    let hote: string;
    try {
      hote = new URL(o).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!LOCAL.test(hote) && !connus.has(hote)) manquants.add(hote);
  }
  return [
    ...[...registre]
      .sort((a, b) => a.domain.localeCompare(b.domain))
      .map((r): DomaineExtension => ({ domaine: r.domain, etat: r.active ? "actif" : "coupe" })),
    ...[...manquants].sort().map((domaine): DomaineExtension => ({ domaine, etat: "non_enregistre" })),
  ];
}

export interface FaitsApplication {
  appId: string;
  clientId: string | null;
  aUneCle: boolean;
  origines: readonly string[];
  sdkUrl: string;
  endpoint: string;
  endpointLogs: string;
  domaines: readonly DomaineExtension[];
}

export interface LignePersonnalisation {
  element: string;
  valeur: string;
  /** Propre à l'application (`true`) ou pareil pour tous les clients (`false`). */
  propre: boolean;
}

/**
 * « Ce qui est propre à votre application, ce qui est pareil pour tous », parcours
 * par parcours. Chaque ligne est vérifiée dans le code :
 *   · code de suivi — l'adresse du SDK est celle que sert la console, la collecte
 *     `ingestEndpoint` ; `appId`, `clientId` (s'il existe) et `apiKey` sont ceux de
 *     `buildSnippet` ; les domaines sont `app_registry.allowed_origins`, la liste
 *     blanche CORS de la collecte ;
 *   · extension — un seul paquet (`EXTENSION_ID`), ses adresses sont écrites dans
 *     `background.ts` ; l'application se RÉSOUT depuis le domaine visité
 *     (`/api/extension/resolve`, registre `extension_scope`) ; l'autorisation est le
 *     bouton « Activer sur ce domaine » du menu (`popup.ts`) ou `runtime_allowed_hosts`
 *     d'une stratégie ; le libellé de poste, la clé `poste` de `managed-schema.json` ;
 *   · serveur — le socle `OTEL_*` de `socleOtel`, dont seuls le nom de service,
 *     `mip.app_id` et `mip.api_key` changent d'une application à l'autre.
 */
export function personnalisation(parcours: Parcours, f: FaitsApplication): LignePersonnalisation[] {
  const cle = f.aUneCle
    ? "remise une seule fois, à la création ; régénérable par l'administrateur"
    : "aucune pour l'instant : à générer par l'administrateur";
  switch (parcours) {
    case "snippet":
      return [
        { element: "Identifiant d'application (appId)", valeur: f.appId, propre: true },
        ...(f.clientId ? [{ element: "Identifiant client (clientId)", valeur: f.clientId, propre: true }] : []),
        { element: "Clé d'API (apiKey)", valeur: cle, propre: true },
        {
          element: "Domaines déclarés (seuls autorisés à envoyer)",
          valeur: f.origines.length ? f.origines.join(", ") : "aucun",
          propre: true,
        },
        { element: "Adresse du script", valeur: f.sdkUrl, propre: false },
        { element: "Adresse de collecte", valeur: f.endpoint, propre: false },
        { element: "Variante avec consentement", valeur: "requireConsent: true, puis MIPRum.consent(true)", propre: false },
      ];
    case "extension": {
      const enregistres = f.domaines.filter((d) => d.etat !== "non_enregistre").map((d) => d.domaine);
      return [
        {
          element: "Domaines enregistrés côté MIP",
          valeur: enregistres.length ? enregistres.join(", ") : "aucun",
          propre: true,
        },
        {
          element: "Application mesurée",
          valeur: `${f.appId}, retrouvée par l'extension à partir du domaine visité : rien à saisir`,
          propre: true,
        },
        {
          element: "Autorisation sur chaque poste",
          valeur: "un clic par site dans le menu de l'extension, ou accordée d'avance par la stratégie du parc",
          propre: true,
        },
        {
          element: "Libellé du poste (facultatif)",
          valeur: "clé « poste » de la stratégie d'entreprise ; sans elle, l'inventaire reste anonyme",
          propre: true,
        },
        { element: "Le paquet de l'extension", valeur: "le même pour tous les clients", propre: false },
        { element: "Adresses de résolution et de collecte", valeur: "écrites dans l'extension, les mêmes pour tous", propre: false },
      ];
    }
    case "serveur":
      return [
        { element: "Nom du service (OTEL_SERVICE_NAME)", valeur: `${nomDeService(f.appId)} (à adapter)`, propre: true },
        { element: "Identifiant d'application (mip.app_id)", valeur: f.appId, propre: true },
        { element: "Clé d'API (mip.api_key)", valeur: `la même que celle du code de suivi ; ${cle}`, propre: true },
        { element: "L'agent", valeur: "l'agent OpenTelemetry officiel du langage du serveur", propre: false },
        {
          element: "Variables OTEL_* du socle",
          valeur: "protocole http/protobuf, compression gzip, traces et journaux, pas de métriques",
          propre: false,
        },
        { element: "Adresses de collecte", valeur: `${f.endpoint} · ${f.endpointLogs}`, propre: false },
      ];
  }
}

// ─── Le code de suivi, par pile ──────────────────────────────────────────────

/** L'appel d'initialisation sur une ligne, repère de la clé compris (Next.js). */
export function appelInit(o: { endpoint: string; appId: string; clientId: string | null }): string {
  const champs = [`endpoint: ${JSON.stringify(o.endpoint)}`, `appId: ${JSON.stringify(o.appId)}`];
  if (o.clientId) champs.push(`clientId: ${JSON.stringify(o.clientId)}`);
  champs.push(`env: "prod"`, `apiKey: ${JSON.stringify(REPERE_CLE_API)}`);
  return `MIPRum.init({ ${champs.join(", ")} });`;
}

/**
 * Next.js, App Router : les deux balises en tête du `<head>` du layout racine.
 * C'est ainsi que la console, elle-même en App Router, pose son propre capteur
 * (`Capteur` de `app/layout.tsx`) : une balise `<script src>` puis un script en
 * ligne — l'ordre du document garantit que `MIPRum` existe quand l'init s'exécute.
 */
export function codeNextAppRouter(sdkUrl: string, init: string): string {
  return [
    "// app/layout.tsx : les deux balises en tête du <head>, avant tout autre script",
    "export default function RootLayout({ children }: { children: React.ReactNode }) {",
    "  return (",
    '    <html lang="fr">',
    "      <head>",
    `        <script src=${JSON.stringify(sdkUrl)} />`,
    `        <script dangerouslySetInnerHTML={{ __html: \`${init}\` }} />`,
    "      </head>",
    "      <body>{children}</body>",
    "    </html>",
    "  );",
    "}",
  ].join("\n");
}

/** Next.js, Pages Router : les mêmes balises dans le `<Head>` de `pages/_document.tsx`. */
export function codeNextPagesRouter(sdkUrl: string, init: string): string {
  return [
    "// pages/_document.tsx",
    'import { Html, Head, Main, NextScript } from "next/document";',
    "",
    "export default function Document() {",
    "  return (",
    '    <Html lang="fr">',
    "      <Head>",
    `        <script src=${JSON.stringify(sdkUrl)} />`,
    `        <script dangerouslySetInnerHTML={{ __html: \`${init}\` }} />`,
    "      </Head>",
    "      <body>",
    "        <Main />",
    "        <NextScript />",
    "      </body>",
    "    </Html>",
    "  );",
    "}",
  ].join("\n");
}

/**
 * Les directives CSP à AJOUTER (jamais une politique entière à coller : elle
 * écraserait celle du site). Les origines sont celles des recettes d'injection
 * (`buildInjectionArtifacts`), le même calcul que le Worker Cloudflare.
 */
export function directivesCsp(o: { sdkUrl: string; endpoint: string; appId: string }): {
  scriptSrc: string;
  connectSrc: string;
} {
  const { scriptOrigin, connectOrigin } = buildInjectionArtifacts({ ...o, clientId: null });
  return { scriptSrc: `script-src ${scriptOrigin}`, connectSrc: `connect-src ${connectOrigin}` };
}
