// Ce que la page « API et MCP » distribue : adresses, commande d'installation,
// jetons, routes et exemples. Fonctions PURES (aucune E/S, aucun import next/*),
// testées dans tests/unit/api-docs.test.ts.
//
// POURQUOI UN MODULE À PART. La page était un long document (4 542 px, cinq écrans,
// recette du 30/09/2026 : « trop long sinon ») ; elle devient deux blocs et un
// tableau, le détail replié. Ce qui s'y copie — une commande, une configuration —
// doit rester exact même replié : il se vérifie ici, sans navigateur.
//
// AUCUN JETON RÉEL, NI D'EXEMPLE À FORTE ENTROPIE. Les exemples portent des
// marque-places lisibles (VOTRE_JETON…) : un faux jeton aléatoire se lit comme un
// vrai, et un outil de détection de secrets le signale comme tel.
import { endpointsDeclares } from "./api/openapi";

/** Chemin du transport HTTP du serveur MCP (`MCP_PATH`, défaut du service). */
export const CHEMIN_MCP = "/mcp";
/** Nom sous lequel un client MCP range ce serveur. */
export const NOM_SERVEUR_MCP = "mip-rum";
/** Marque-place du jeton d'API dans tout ce qui se copie. */
export const MARQUE_JETON = "VOTRE_JETON";

/** http en local (IPv6 compris), https partout ailleurs — même règle que l'ingestion. */
function protocole(host: string): "http" | "https" {
  return /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) ? "http" : "https";
}

/**
 * Origine publique de la console, depuis l'hôte de la requête : elle suit les
 * previews et l'auto-hébergement. Hors requête, l'hôte de déploiement, sinon le
 * poste local.
 */
export function origineConsole(host: string | null | undefined): string {
  if (host) return `${protocole(host)}://${host}`;
  const deploye = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null;
  return deploye ? `https://${deploye}` : "http://localhost:3000";
}

/** Adresse de base de l'API REST v1. */
export function baseApi(origine: string): string {
  return `${origine}/api/v1`;
}

/** Adresse du serveur MCP distant (transport HTTP). */
export function adresseMcp(origineMcp: string): string {
  return `${origineMcp.replace(/\/+$/, "")}${CHEMIN_MCP}`;
}

/**
 * La commande Claude Code, sur UNE ligne : elle se colle telle quelle dans un
 * terminal, sans barre oblique de continuation qu'un shell Windows ne lit pas.
 */
export function commandeClaudeCode(adresse: string): string {
  return `claude mcp add --transport http ${NOM_SERVEUR_MCP} ${adresse} --header "Authorization: Bearer ${MARQUE_JETON}"`;
}

/**
 * Configuration JSON d'un client MCP (Claude Desktop, Cursor, VS Code…). Le champ
 * `type: "http"` est obligatoire : une entrée qui porte `url` sans `type` est lue
 * comme un serveur local, et échoue.
 */
export function configurationJson(adresse: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [NOM_SERVEUR_MCP]: { type: "http", url: adresse, headers: { Authorization: `Bearer ${MARQUE_JETON}` } },
      },
    },
    null,
    2,
  );
}

/**
 * Le serveur sur le poste (transport stdio), lancé par le client depuis un clone du
 * dépôt : l'adresse de la console et le jeton passent par l'environnement.
 */
export function configurationStdio(origine: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [NOM_SERVEUR_MCP]: {
          command: "node",
          args: ["<clone du dépôt>/services/mcp/stdio.mjs"],
          env: { MIP_CONSOLE_URL: origine, MIP_API_TOKEN: MARQUE_JETON },
        },
      },
    },
    null,
    2,
  );
}

/**
 * Trois appels pour vérifier soi-même le serveur. Le troisième, SANS jeton, doit
 * répondre 401 : ne tester que le cas qui passe ne dit pas si le serveur est ouvert
 * à tous.
 */
export function appelsDeVerification(origineMcp: string): string {
  const adresse = adresseMcp(origineMcp);
  const corps = `-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
  return [
    "# 1. Le service répond (sans jeton) : 200",
    `curl -s ${origineMcp.replace(/\/+$/, "")}/health`,
    "# 2. Avec votre jeton : la liste des outils",
    `curl -s -X POST ${adresse} -H "Authorization: Bearer ${MARQUE_JETON}" ${corps}`,
    "# 3. Sans jeton : doit répondre 401",
    `curl -s -o /dev/null -w "%{http_code}\\n" -X POST ${adresse} ${corps}`,
  ].join("\n");
}

/** Un jeton, tel que le tableau de la page le présente : une ligne chacun. */
export interface Jeton {
  nom: string;
  /** Début reconnaissable du secret, s'il en a un. */
  prefixe?: string;
  /** À quoi il sert, en mots. */
  usage: string;
  /** Ce qu'il ouvre, en adresses (sous-ligne en chasse fixe). */
  ouvre: string;
  droits: string;
  /** Précision des droits (sous-ligne en chasse fixe). */
  privileges?: string;
  portee: string;
  validite: string;
  /** Où l'obtenir : un écran de la console, ou une demande. */
  source: { libelle: string; href?: string };
}

/**
 * Les trois jetons. « Jeton d'accès » (recette du 30/09/2026) : l'ancien « jeton de
 * lecture » EST un jeton d'accès porteur, en lecture seule, limité à la synthèse
 * d'une application. Le jeton d'API est une valeur de configuration de la
 * plateforme (`jeton` ou `jeton@app1;app2`) : sans date d'échéance.
 */
export const JETONS: readonly Jeton[] = [
  {
    nom: "Jeton d'API",
    usage: "lire les mesures (API, agent IA)",
    ouvre: "/api/v1 · serveur MCP",
    droits: "lecture",
    portee: "toutes, ou une liste",
    validite: "sans échéance",
    source: { libelle: "l'exploitant de la plateforme" },
  },
  {
    nom: "Jeton d'accès",
    prefixe: "mrk_",
    usage: "afficher la synthèse d'une application",
    ouvre: "/api/rum/summary",
    droits: "lecture",
    portee: "une seule",
    validite: "1 à 365 j",
    source: { libelle: "Administration › Jetons d'accès", href: "/admin/read-tokens" },
  },
  {
    nom: "Jeton de CI",
    prefixe: "msu_",
    usage: "déploiements et source maps",
    ouvre: "/api/v1/deploys · source maps",
    droits: "écriture, un privilège",
    privileges: "deploys:write | sourcemaps:write",
    portee: "une seule",
    validite: "1 à 90 j",
    source: { libelle: "Administration › Source maps", href: "/admin/sourcemaps" },
  },
];

/** Une route de l'API, telle que la liste repliée la montre. */
export interface Route {
  methode: "GET" | "POST";
  chemin: string;
  description: string;
  /** Une écriture (la seule : le marqueur de déploiement). */
  ecriture?: boolean;
}

/**
 * Les routes de l'API v1 : les lectures DÉRIVÉES de la spec OpenAPI (une route
 * absente de la spec ne peut pas y figurer), la lecture en POST de l'Explorer, et
 * l'unique écriture, que la spec renvoie à cette page.
 */
export function routesApi(): Route[] {
  return [
    ...endpointsDeclares().map((e) => ({ methode: "GET" as const, chemin: e.path, description: e.desc })),
    {
      methode: "POST",
      chemin: "/api/v1/explorer/query",
      description: "Explorer : requête analytique bornée (une lecture, en POST : la requête ne tient pas dans l'adresse)",
    },
    {
      methode: "POST",
      chemin: "/api/v1/deploys",
      description: "Marqueur de déploiement, posé par une intégration continue avec un jeton de CI deploys:write",
      ecriture: true,
    },
  ];
}

/** Exemples d'appels, un par jeton, prêts à copier. */
export function exemplesApi(origine: string): string {
  const base = baseApi(origine);
  return [
    "# Synthèse d'une application (jeton d'accès) — window = 24h, 7d ou 30d",
    `curl -s -H "Authorization: Bearer VOTRE_JETON_D_ACCES" "${origine}/api/rum/summary?window=7d"`,
    "# Vue d'ensemble d'une application (jeton d'API) — period = 1h, 24h ou 7d",
    `curl -s -H "Authorization: Bearer ${MARQUE_JETON}" "${base}/overview?app=VOTRE_APPLICATION&period=24h"`,
    "# Marqueur de déploiement (jeton de CI deploys:write)",
    `curl -s -X POST -H "Authorization: Bearer VOTRE_JETON_DE_CI" -H "Content-Type: application/json" -d '{"app_id":"VOTRE_APPLICATION","version":"1.4.2","env":"production"}' "${base}/deploys"`,
  ].join("\n");
}

/** Les filtres communs des routes /api/v1, en une ligne chacun. */
export const FILTRES_API: readonly (readonly [string, string])[] = [
  ["app", "une application, ou all (défaut : toutes celles du jeton) ; hors périmètre : 403"],
  ["period", "1h, 24h (défaut) ou 7d, fenêtre glissante"],
  ["from, to", "plage personnalisée, ISO UTC, 30 jours au plus, à la place de period"],
  ["device", "mobile, desktop, tablet ou all"],
  ["browser, os, env, service, release, route, country", "valeur exacte ; une dimension non portée : 400"],
  ["seg", "segment, 10 conditions au plus"],
  ["bots, internal", "1 = inclure les robots, les applications internes"],
  ["limit, offset, cursor", "pagination des listes : limit et offset, ou cursor, selon la route"],
];
