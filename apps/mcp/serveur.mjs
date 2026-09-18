// Assemblage du serveur MCP : le catalogue devient des outils enregistrés.
//
// Un seul handler, partagé par tous les outils — il construit le chemin, appelle
// l'API, met en forme. Les outils ne diffèrent que par leur DONNÉE (catalogue.mjs).
//
// Ce module ne choisit PAS de transport et ne lit AUCUNE variable
// d'environnement : il reçoit une fabrique de client et rend un serveur. C'est
// ce qui permet aux deux points d'entrée (stdio local, HTTP distant) de partager
// exactement le même comportement, et aux tests de l'exercer sans réseau.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OUTILS, PARAMS, construireChemin, construireCorps } from "./lib/catalogue.mjs";
import { ErreurApi } from "./lib/client.mjs";
import { avertissementPerimetre, enMarkdown, indicesPage } from "./lib/rendu.mjs";

export const NOM = "mip-rum-mcp-server";
export const VERSION = "0.1.0";

/**
 * Instructions remises au modèle à la connexion. Elles disent ce que le serveur
 * NE fait pas — un modèle informé des limites cesse d'essayer de les contourner,
 * et surtout cesse de combler les trous par des suppositions.
 */
export const INSTRUCTIONS = `Outils de lecture du portail MIP RUM (Real User Monitoring : ce que les vrais utilisateurs vivent sur une application web).

Marche à suivre : appeler d'abord mip_rum_list_apps pour connaître les applications accessibles, puis interroger les autres outils avec le slug obtenu.

Limites à respecter, elles ne sont pas contournables :
- LECTURE SEULE. Aucun outil ne modifie quoi que ce soit.
- Trois fenêtres seulement : 1h, 24h, 7d. Aucun outil n'accepte de dates libres, et il n'existe pas d'historique plus profond ici.
- Le périmètre dépend du jeton. Une app hors périmètre est REFUSÉE (403) : appeler mip_rum_list_apps plutôt que deviner un slug. Sans app, la réponse couvre toutes les apps autorisées du jeton.
- Le détail d'un groupe d'erreurs ou d'une issue porte l'app de la RESSOURCE, qui peut différer de celle demandée : l'outil le signale explicitement. Lire cet avertissement avant de conclure.
- La liste des sessions est paginée sans total. Les groupes d'erreurs, les issues et l'Explorer d'événements fournissent un total filtré ; le détail d'un groupe d'erreurs et l'Explorer paginent par curseur opaque stable (data.page.next_cursor), les issues et leur détail par data.next_cursor.
- Pas de données personnelles : les utilisateurs sont des empreintes anonymes.
- Une question qu'aucun outil ne couvre se compose avec mip_rum_query_explorer : jeu de données, mesure, regroupement. Son catalogue est FERMÉ — un champ absent n'est pas mesurable, et le refus ne dit pas s'il existe ailleurs. Un dénombrement vide vaut 0, une moyenne ou un percentile sans échantillon vaut null, et une requête trop large échoue (503) sans rendre de chiffre : ne pas lire cet échec comme un zéro.

Si un chiffre demandé n'est dans aucune réponse, le dire — ne pas l'estimer.`;

/** Schéma zod d'un paramètre, à partir de son nom. */
function schemaParam(nom) {
  const d = PARAMS[nom] ?? nom;
  switch (nom) {
    case "period":
      return z.enum(["1h", "24h", "7d"]).optional().describe(d);
    case "device":
      return z.enum(["mobile", "desktop", "tablet", "all"]).optional().describe(d);
    case "limit":
      return z.number().int().min(1).max(200).optional().describe(d);
    case "offset":
      return z.number().int().min(0).optional().describe(d);
    case "kind":
      return z.enum(["pageview", "vital", "error", "resource", "longtask", "breadcrumb", "event", "span"]).optional().describe(d);
    case "attr_source":
      return z.enum(["props", "context"]).optional().describe(d);
    case "attr_type":
      return z.enum(["string", "number", "boolean", "null"]).optional().describe(d);
    case "cursor":
      return z.string().max(512).optional().describe(d);
    case "name":
      return z.string().min(1).max(100).optional().describe(d);
    case "attr_key":
      return z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/).optional().describe(d);
    case "attr_value":
      return z.string().max(500).optional().describe(d);
    case "status":
      return z.enum(["open", "for_review", "resolved", "ignored"]).optional().describe(d);
    case "source":
      return z.enum([
        "browser_js", "browser_console", "browser_resource", "browser_csp", "browser_network",
        "node", "python", "react_native_js", "native", "otel",
      ]).optional().describe(d);
    case "release":
      return z.string().min(1).max(200).optional().describe(d);
    case "issue_id":
      return z.string().uuid().describe(d);
    // Explorer (P6.4). Les listes fermées sont recopiées du registre côté console :
    // le serveur MCP refuse alors une valeur inexistante AVANT l'appel réseau, et
    // l'API refuse de toute façon celles qu'il laisserait passer.
    case "dataset":
      return z.enum([
        "custom_events", "errors", "views", "sessions", "vitals", "resources", "longtasks", "actions", "spans",
      ]).describe(d);
    case "measure":
      return z.string().regex(/^[a-z_]{1,60}:(count|sum|avg|p75|p95|distinct)$/).describe(d);
    case "measure_property":
      return z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/).optional().describe(d);
    case "variant":
      return z.string().min(1).max(60).optional().describe(d);
    case "group_by":
      return z.string().regex(/^[a-z_]{1,60}(,[a-z_]{1,60})?$/).optional().describe(d);
    case "visualization":
      return z.enum(["value", "toplist", "timeseries", "table"]).optional().describe(d);
    case "browser":
    case "os":
    case "env":
    case "service":
    case "route":
    case "country":
      return z.string().min(1).max(500).optional().describe(d);
    // Les segments de chemin sont les SEULS paramètres requis : sans eux il n'y
    // a pas d'URL à construire.
    case "fingerprint":
    case "session_id":
      return z.string().min(1).describe(d);
    default:
      return z.string().optional().describe(d);
  }
}

/** Forme d'entrée complète d'un outil (paramètres du catalogue + format de sortie). */
export function schemaEntree(outil) {
  const forme = {};
  for (const p of outil.params) forme[p] = schemaParam(p);
  forme.format = z.enum(["json", "markdown"]).optional().describe(PARAMS.format);
  return forme;
}

/**
 * Exécute un outil : chemin → appel → mise en forme.
 * Exportée pour être testée sans SDK ni transport.
 *
 * @param {object} outil   entrée du catalogue
 * @param {object} args    arguments validés
 * @param {object} client  client créé par creerClient()
 */
export async function executer(outil, args, client) {
  const chemin = construireChemin(outil, args);
  // `construireCorps` rend null pour les outils qui lisent par GET : le client
  // ne poste que lorsqu'il y a réellement un corps à envoyer.
  const requete = construireCorps(outil, args);
  const corps = await client.appeler(chemin, requete ? { corps: requete } : {});

  const avert = avertissementPerimetre(args.app, corps?.meta);
  const page = indicesPage(corps?.data);

  if ((args.format ?? "json") === "markdown") {
    const parts = [enMarkdown(outil.titre, corps)];
    if (page)
      parts.push(
        `---\n\n_Pagination : ${page.recus} élément(s) reçu(s)${page.offset == null ? "" : `, offset ${page.offset}`}${page.limit == null ? "" : `, limite ${page.limit}`}.` +
          `${page.peut_avoir_suite ? (page.cursor_suivant ? ` Appeler de nouveau avec cursor=${page.cursor_suivant} pour la suite stable.` : ` Page pleine — appeler de nouveau avec offset=${page.offset_suivant} pour la suite.`) : " Page incomplète : c'est la fin."}` +
          `${page.total == null ? " L'API ne fournit pas de total." : ` Total filtré : ${page.total}.`}_`,
      );
    if (avert) parts.unshift(avert);
    return { texte: parts.join("\n\n"), structure: null };
  }

  // JSON : l'enveloppe de l'API TELLE QUELLE, plus ce que le serveur MCP a
  // constaté. Les deux sont séparés (`_mcp`) pour qu'on ne puisse pas confondre
  // une observation du serveur avec une donnée mesurée.
  const structure = { ...corps, _mcp: { outil: outil.nom, chemin, pagination: page, avertissement: avert } };
  return { texte: JSON.stringify(structure, null, 2), structure };
}

/**
 * Construit le serveur MCP.
 *
 * @param {object} opts
 * @param {(extra: object) => object} opts.clientPour
 *   Fabrique appelée À CHAQUE appel d'outil, avec le contexte de la requête.
 *   C'est volontaire : en HTTP, le jeton vient de l'appelant, donc il change
 *   d'une requête à l'autre. Un client construit une fois au démarrage
 *   servirait le jeton du premier appelant à tous les suivants.
 */
export function creerServeur({ clientPour }) {
  const serveur = new McpServer({ name: NOM, version: VERSION }, { instructions: INSTRUCTIONS });

  for (const outil of OUTILS) {
    serveur.registerTool(
      outil.nom,
      {
        title: outil.titre,
        description: `${outil.description}\n\nRetour : enveloppe { meta, data } de l'API MIP RUM v1. \`meta\` dit l'app, la période et l'appareil RÉELLEMENT appliqués — qui peuvent différer de la demande.`,
        inputSchema: schemaEntree(outil),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args, extra) => {
        try {
          const { texte } = await executer(outil, args ?? {}, clientPour(extra));
          return { content: [{ type: "text", text: texte }] };
        } catch (e) {
          // Erreur remontée DANS le résultat (isError), pas en erreur de
          // protocole : le modèle doit pouvoir la lire et changer d'approche.
          const message =
            e instanceof ErreurApi ? e.message : `Échec de l'outil ${outil.nom} : ${e?.message ?? String(e)}`;
          return { isError: true, content: [{ type: "text", text: message }] };
        }
      },
    );
  }

  return serveur;
}
