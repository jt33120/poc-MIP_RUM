// Le contrat d'API décrit-il l'API qui existe ?
//
// CE QUI ÉTAIT FAUX. La documentation de l'API v1 a décrit `/api/v1/ai`,
// `/api/v1/ai/costs` et `/api/v1/ai/credits` — trois endpoints SUPPRIMÉS lors de
// l'extraction de la supervision IA vers xSOM. Aucun fichier de route ne leur
// correspondait : un client qui les appelait recevait un 404.
//
// La description qui fait foi est désormais la spec OpenAPI construite dans le code
// (`lib/api/openapi.ts`), servie par Swagger UI et lue par le serveur MCP — donc par
// un modèle, qui croit ce qu'on lui dit. Ce test l'attache aux routes réelles, DANS
// LES DEUX SENS : un endpoint décrit qui n'existe pas fait perdre du temps ; un
// endpoint qui existe sans être décrit ne sert à personne.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { endpointsDeclares } from "../../apps/console/lib/api/openapi";

const RACINE = join(__dirname, "..", "..");
const API = join(RACINE, "apps/console/app/api/v1");

/**
 * Chemin d'API -> fichier de route attendu. Les segments dynamiques s'écrivent
 * `{id}` dans une spec OpenAPI et `[id]` dans le routeur Next : la conversion
 * est ici, une seule fois.
 */
function fichierDe(chemin: string): string {
  const rel = chemin.replace(/^\/api\/v1/, "").replace(/\{([^}]+)\}/g, "[$1]");
  return join(API, rel, "route.ts");
}

/** Routes réellement posées sur le disque, sous /api/v1, en notation OpenAPI. */
function surLeDisque(): string[] {
  const out: string[] = [];
  const marcher = (dir: string, prefixe: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) marcher(join(dir, e.name), `${prefixe}/${e.name}`);
      else if (e.name === "route.ts") out.push(`/api/v1${prefixe}`);
    }
  };
  marcher(API, "");
  return out.map((c) => c.replace(/\[([^\]]+)\]/g, "{$1}")).sort();
}

/**
 * Les routes que la spec ne décrit pas, et pourquoi : la spec ne porte que les
 * lectures GET des agrégats. Le descripteur `GET /api/v1` liste à part l'écriture
 * (`POST /deploys`) et la lecture en POST de l'Explorer ; `/docs` sert Swagger UI.
 */
const HORS_SPEC = ["/api/v1/deploys", "/api/v1/docs", "/api/v1/explorer/query"];

describe("la spec OpenAPI et les routes réelles", () => {
  it("chaque endpoint de la spec correspond à un fichier de route", () => {
    const fantomes = endpointsDeclares()
      .filter((e) => !existsSync(fichierDe(e.path)))
      .map((e) => `${e.method} ${e.path}`);
    expect(fantomes, `décrits mais inexistants :\n${fantomes.join("\n")}`).toEqual([]);
  });

  it("les trois endpoints IA extraits vers xSOM ne reviennent pas", () => {
    const chemins = endpointsDeclares().map((e) => e.path);
    for (const mort of ["/api/v1/ai", "/api/v1/ai/costs", "/api/v1/ai/credits"]) {
      expect(chemins).not.toContain(mort);
      expect(existsSync(fichierDe(mort)), mort).toBe(false);
    }
  });

  it("chaque route de app/api/v1 est dans la spec, sauf celles que le descripteur liste à part", () => {
    const decrits = new Set(endpointsDeclares().map((e) => e.path));
    const oublies = surLeDisque().filter((c) => !decrits.has(c));
    expect(oublies).toEqual(HORS_SPEC);
  });

  it("le descripteur ne range pas la lecture en POST de l'Explorer parmi les écritures", () => {
    // `write` est ce qu'un client lit pour savoir ce qui exige une session admin. Y
    // faire figurer une lecture lui ferait croire qu'un jeton d'API ne suffit pas.
    const route = readFileSync(join(API, "route.ts"), "utf8");
    const write = route.slice(route.indexOf("write: ["));
    expect(write).not.toContain("/explorer/query");
    expect(route).toContain("POST /api/v1/explorer/query");
    expect(write).toContain("/deploys");
  });

  // Anti-tautologie : la sonde trouve plus d'une poignée de routes.
  it("la sonde trouve bien les routes qu'elle prétend lire", () => {
    expect(endpointsDeclares().length).toBeGreaterThanOrEqual(15);
    expect(surLeDisque().length).toBeGreaterThanOrEqual(15);
  });
});
