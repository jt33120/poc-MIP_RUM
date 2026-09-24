// P4 — le service `api` : les routes de l'API v1 de la console, compilées en un
// service Railway en lecture seule.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Qu'un cookie de session de la console vaille quelque chose dans l'API
//     publique : le module qui vérifie les sessions (`lib/auth.ts`, `jose`, le
//     secret de développement) ne doit pas pouvoir entrer dans le bundle.
//   - Qu'une écriture de l'API v1 (triage, commentaires, vues, marqueurs) soit
//     servie par ce service : il est en lecture seule, par construction.
//   - Que la table des routes diverge de l'arborescence de la console : une
//     route ajoutée là doit exister ici, au même chemin.
//   - Qu'un segment fixe perde contre un paramètre (`/explorer/schema` pris pour
//     une vue d'identifiant « schema »).
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POST_DE_LECTURE,
  cheminDuFichier,
  creerRouteur,
  methodeServie,
  motif,
} from "../../services/api/routeur.mjs";
import { NextRequest, NextResponse, after } from "../../services/api/shims/next-server.mjs";
import { SESSION_COOKIE, verifyJwt } from "../../services/api/shims/auth.mjs";
import { brancherPool, q, withTenant } from "../../services/api/shims/db.mjs";
import { construire, fautesDuBundle, fichiersDeRoutes } from "../../services/api/build.mjs";

const APP = join("apps", "console", "app");

describe("routeur — les chemins de la console, tels quels", () => {
  it("un fichier de route donne son chemin, paramètres compris", () => {
    expect(cheminDuFichier("api/v1/route.ts")).toBe("/api/v1");
    expect(cheminDuFichier("api/v1/errors/[fingerprint]/route.ts")).toBe("/api/v1/errors/[fingerprint]");
    expect(motif("/api/v1/issues/[id]/activity")).toMatchObject({ cles: ["id"], dynamiques: 1 });
  });

  it("un segment fixe l'emporte sur un paramètre, et les paramètres sont décodés", () => {
    const table = [
      { chemin: "/api/v1/explorer/views/[id]", module: { nom: "vue" } },
      { chemin: "/api/v1/explorer/schema", module: { nom: "schema" } },
      { chemin: "/api/v1/errors/[fingerprint]", module: { nom: "erreur" } },
    ];
    const r = creerRouteur(table);
    expect(r("/api/v1/explorer/schema")?.entree.module).toEqual({ nom: "schema" });
    expect(r("/api/v1/explorer/views/42")).toMatchObject({ entree: { module: { nom: "vue" } }, params: { id: "42" } });
    expect(r("/api/v1/errors/a%2Fb")?.params).toEqual({ fingerprint: "a/b" });
    expect(r("/api/v1/errors/")).toBeNull();
    expect(r("/api/v2/errors/x")).toBeNull();
  });

  it("la table couvre CHAQUE route de l'API v1 de la console, et le résumé partenaire", () => {
    const attendus: string[] = [];
    (function parcourir(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) parcourir(p);
        else if (n === "route.ts") attendus.push(p);
      }
    })(join(APP, "api", "v1"));
    const servis = fichiersDeRoutes().map((f: string) => relative(process.cwd(), f));
    expect(servis.sort()).toEqual([...attendus, join(APP, "api", "rum", "summary", "route.ts")].sort());
  });
});

describe("lecture seule, par construction", () => {
  it("GET, HEAD, OPTIONS partout ; POST seulement pour la lecture de l'Explorer", () => {
    expect(POST_DE_LECTURE).toEqual(["/api/v1/explorer/query"]);
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(methodeServie("/api/v1/issues/[id]", m)).toBe(true);
    expect(methodeServie("/api/v1/explorer/query", "POST")).toBe(true);
    for (const [chemin, m] of [
      ["/api/v1/issues/[id]/triage", "POST"],
      ["/api/v1/issues/[id]/comments", "POST"],
      ["/api/v1/explorer/views", "POST"],
      ["/api/v1/explorer/views/[id]", "PATCH"],
      ["/api/v1/explorer/views/[id]", "DELETE"],
      ["/api/v1/deploys", "POST"],
    ]) {
      expect(methodeServie(chemin, m), `${m} ${chemin}`).toBe(false);
    }
  });
});

describe("shims — ce qui remplace Next et les sessions", () => {
  it("NextRequest : l'URL analysée, et AUCUN cookie, même envoyé", () => {
    const req = new NextRequest("https://api.test/api/v1/apps?app=x", { headers: { cookie: `${SESSION_COOKIE}=vole` } });
    expect(req.nextUrl.pathname).toBe("/api/v1/apps");
    expect(req.nextUrl.searchParams.get("app")).toBe("x");
    expect(req.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("NextResponse.json et redirect, comme Next", async () => {
    const r = NextResponse.json({ a: 1 }, { status: 201, headers: { etag: "W/1" } });
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("etag")).toBe("W/1");
    expect(await r.json()).toEqual({ a: 1 });
    expect(NextResponse.redirect("https://x.test/", 308).headers.get("location")).toBe("https://x.test/");
  });

  it("after() : après la réponse, et une erreur n'en sort jamais", async () => {
    const ordre: string[] = [];
    after(() => {
      ordre.push("après");
      throw new Error("avalée");
    });
    ordre.push("réponse");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(ordre).toEqual(["réponse", "après"]);
  });

  it("aucune session n'est jamais valide", async () => {
    expect(await verifyJwt()).toBeNull();
  });

  it("db : le pool est injecté ; la portée tenant passe par set_config LOCAL, dans une transaction", async () => {
    const requetes: string[] = [];
    const client = {
      query: async (sql: string) => {
        requetes.push(sql);
        return { rows: [] };
      },
      release: () => {},
    };
    brancherPool({ query: async () => ({ rows: [{ n: 1 }] }), connect: async () => client } as never);
    expect(await q("select 1 as n")).toEqual([{ n: 1 }]);
    await withTenant(["a", "b"], async () => "ok");
    expect(requetes).toEqual(["begin", "select set_config('app.current_app_id', $1, true)", "commit"]);
    await expect(withTenant([], async () => 1)).rejects.toThrow(/portée tenant vide/);
  });
});

describe("le bundle — ce qu'il ne doit jamais contenir", () => {
  it("les gardes refusent lib/auth.ts, jose, next et le secret de développement", () => {
    expect(fautesDuBundle(["apps/console/lib/api/auth.ts"], "")).toEqual([]);
    expect(fautesDuBundle(["apps/console/lib/auth.ts"], "")).toEqual(["lib/auth.ts de la console est dans le bundle"]);
    expect(fautesDuBundle(["node_modules/.pnpm/jose@6.0.0/node_modules/jose/dist/index.js"], "")).toHaveLength(1);
    expect(fautesDuBundle(["node_modules/next/dist/server/web/exports.js"], "")).toHaveLength(1);
    expect(fautesDuBundle([], 'const s = "dev-secret-mip-rum";')).toHaveLength(1);
    // Le service est la CIBLE du relais : ni le relais, ni sa lecture du drapeau.
    expect(fautesDuBundle(["apps/console/lib/api-relay.ts"], "")).toHaveLength(1);
    expect(fautesDuBundle(["apps/console/lib/platform-flag.ts"], "")).toHaveLength(1);
  });

  it("le vrai bundle se construit, sans aucune de ces pièces", async () => {
    const r = await construire({ ecrire: false });
    expect(r.routes).toBe(fichiersDeRoutes().length);
    expect(r.entrees.some((e: string) => e.endsWith("apps/console/lib/auth.ts"))).toBe(false);
    expect(r.entrees.some((e: string) => e.includes("services/api/shims/auth.mjs"))).toBe(true);
    expect(r.entrees.some((e: string) => e.endsWith("apps/console/lib/db.ts"))).toBe(false);
  }, 60_000);
});
