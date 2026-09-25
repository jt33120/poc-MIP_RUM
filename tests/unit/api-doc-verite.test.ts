// Le contrat d'API décrit-il l'API qui existe ?
//
// CE QUI ÉTAIT FAUX. `docs/API_CONSOLE.md` documentait `/api/v1/ai`,
// `/api/v1/ai/costs` et `/api/v1/ai/credits` — trois endpoints SUPPRIMÉS lors de
// l'extraction de la supervision IA vers xSOM (ADR-0001). Aucun fichier de route
// ne leur correspond : un client qui les appelait recevait un 404. En sens
// inverse, quatre routes réelles n'étaient nulle part : `/health`, `/openapi`,
// `/docs` et l'unique écriture `POST /deploys`.
//
// LE DESCRIPTEUR DE CODE AVAIT DÉJÀ ÉTÉ CORRIGÉ, pas le document. C'est le mode de
// défaillance intéressant : deux sources décrivant la même chose, dont une seule
// est rattrapée quand la réalité bouge. Ce test les attache l'une à l'autre.
//
// IL VÉRIFIE DANS LES DEUX SENS, et le second compte autant que le premier. Un
// endpoint documenté qui n'existe pas fait perdre du temps ; un endpoint qui
// existe sans être documenté ne sert à personne — et sur ce projet, il est aussi
// lu par un serveur MCP, donc par un modèle, qui croit ce qu'on lui dit.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { endpointsDeclares } from "../../apps/console/lib/api/openapi";

const RACINE = join(__dirname, "..", "..");
const DOC = readFileSync(join(RACINE, "docs/API_CONSOLE.md"), "utf8");
const API = join(RACINE, "apps/console/app/api/v1");

/**
 * Endpoints décrits par le document : les titres de section de la forme
 * « ### `GET /api/v1/...` ». C'est la structure que le fichier utilise déjà —
 * on ne lui impose pas une convention pour le test.
 */
function documentes(): { methode: string; chemin: string }[] {
  return [...DOC.matchAll(/^### `(GET|POST|PUT|PATCH|DELETE) (\/api\/v1[^`]*)`/gm)].map((m) => ({
    methode: m[1],
    chemin: m[2].trim(),
  }));
}

/**
 * Chemin d'API -> fichier de route attendu. Les segments dynamiques s'écrivent
 * `{id}` dans une spec OpenAPI et `[id]` dans le routeur Next : la conversion
 * est ici, une seule fois.
 */
function fichierDe(chemin: string): string {
  const rel = chemin.replace(/^\/api\/v1/, "").replace(/\{([^}]+)\}/g, "[$1]");
  return join(API, rel, "route.ts");
}

/** Routes réellement posées sur le disque, sous /api/v1. */
function surLeDisque(): string[] {
  const out: string[] = [];
  const marcher = (dir: string, prefixe: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) marcher(join(dir, e.name), `${prefixe}/${e.name}`);
      else if (e.name === "route.ts") out.push(`/api/v1${prefixe}`);
    }
  };
  marcher(API, "");
  return out.sort();
}

describe("aucun endpoint documenté n'est un fantôme", () => {
  it("chaque section du document correspond à un fichier de route", () => {
    const fantomes = documentes()
      .filter((e) => !existsSync(fichierDe(e.chemin)))
      .map((e) => `${e.methode} ${e.chemin}`);
    expect(fantomes, `documentés mais inexistants :\n${fantomes.join("\n")}`).toEqual([]);
  });

  it("les trois endpoints IA extraits vers xSOM ne sont plus décrits comme vivants", () => {
    // Ils sont NOMMÉS dans le document — c'est voulu : un lecteur qui les
    // cherche doit apprendre où ils sont passés, pas tomber sur un silence.
    // Ce qu'on interdit, c'est qu'ils reviennent sous forme de section.
    for (const mort of ["/api/v1/ai", "/api/v1/ai/costs", "/api/v1/ai/credits"])
      expect(DOC).not.toContain(`### \`GET ${mort}\``);
    expect(DOC).toContain("n'existent plus");
    expect(DOC).toContain("xSOM");
  });

  it("et le document dit où lire les données IA aujourd'hui", () => {
    // Retirer sans rediriger transformerait une information fausse en
    // information manquante. Ce n'est pas un progrès pour le lecteur.
    expect(DOC).toContain("/api/rum/summary");
    expect(DOC).toContain("ai_*");
  });
});

describe("aucune route réelle n'est passée sous silence", () => {
  it("chaque route de app/api/v1 a sa section", () => {
    const decrits = new Set(documentes().map((e) => e.chemin));
    const oublies = surLeDisque()
      .map((c) => c.replace(/\[([^\]]+)\]/g, "{$1}"))
      .filter((c) => !decrits.has(c));
    expect(oublies, `existants mais non documentés :\n${oublies.join("\n")}`).toEqual([]);
  });

  it("chaque endpoint déclaré dans la spec OpenAPI a sa section", () => {
    // Troisième source : la spec machine. Elle sert le serveur MCP et Swagger UI.
    const decrits = new Set(documentes().map((e) => e.chemin));
    const absents = endpointsDeclares()
      .map((e) => e.path)
      .filter((p) => !decrits.has(p));
    expect(absents, `dans la spec mais pas dans le document :\n${absents.join("\n")}`).toEqual([]);
  });

  it("les écritures sont annoncées comme telles, et seulement elles", () => {
    // Le document les regroupe sous « Écritures ». Une écriture de plus, non signalée
    // ici, ferait mentir cette liste.
    //
    // UN POST N'EST PAS UNE ÉCRITURE. P6.4 ajoute `POST /api/v1/explorer/query`, qui
    // LIT : son verbe vient de la taille de l'AST, pas d'un changement d'état. Le
    // ranger parmi les écritures dirait à un client — et à un modèle — qu'il lui faut
    // une session admin de même origine, alors qu'un jeton de lecture suffit. Les deux
    // listes sont donc tenues séparément, et toutes deux exactes : une route non-GET
    // qui n'apparaît dans ni l'une ni l'autre est une route mal classée.
    const LECTURES_EN_POST = ["POST /api/v1/explorer/query"];
    // C7 (25/09/2026) : les écritures de l'OPÉRATEUR — triage, commentaire, lien et
    // demande de ticket d'une issue, vues enregistrées — ont quitté l'API publique.
    // Elles n'acceptaient que le cookie de la console ; l'écran écrit désormais par
    // ses server actions et leurs commandes. Reste l'écriture d'une MACHINE : le
    // marqueur de déploiement qu'envoie la CI.
    const ECRITURES = ["POST /api/v1/deploys"];
    const nonGet = documentes()
      .filter((e) => e.methode !== "GET")
      .map((e) => `${e.methode} ${e.chemin}`);
    expect(nonGet.filter((e) => !LECTURES_EN_POST.includes(e))).toEqual(ECRITURES);
    expect(nonGet.filter((e) => LECTURES_EN_POST.includes(e))).toEqual(LECTURES_EN_POST);
  });

  it("le descripteur ne range pas la lecture en POST de l'Explorer parmi les écritures", () => {
    // `write` est ce qu'un client lit pour savoir ce qui exige une session admin. Y
    // faire figurer une lecture lui ferait croire qu'un jeton d'API ne suffit pas.
    const route = readFileSync(join(API, "route.ts"), "utf8");
    const write = route.slice(route.indexOf("write: ["));
    expect(write).not.toContain("/explorer/query");
    expect(route).toContain("POST /api/v1/explorer/query");
  });

  // Anti-tautologie : la sonde sait lire des sections, et il y en a plus d'une
  // poignée. Sans cela, une expression régulière cassée rendrait tout vert.
  it("la sonde trouve bien les sections qu'elle prétend lire", () => {
    expect(documentes().length).toBeGreaterThanOrEqual(15);
    expect(surLeDisque().length).toBeGreaterThanOrEqual(15);
  });
});
