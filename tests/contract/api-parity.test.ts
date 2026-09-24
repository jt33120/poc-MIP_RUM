// P4 — CONTRAT DE PARITÉ DE L'API DE LECTURE : console (Next) ↔ service `api`.
//
// Le service `api` exécute LE MÊME CODE que la console — ses routes v1, compilées
// par esbuild avec trois substitutions (`services/api/build.mjs`). Ce contrat
// vérifie que les substitutions ne changent rien de ce qu'un client voit : pour
// la même requête, sur la même base, même statut, même corps (hors horodatage
// de génération) et même ETag. En P4, le relais de la console enverra une
// requête à l'un OU à l'autre : un client ne doit pas pouvoir le deviner.
//
// Il vérifie aussi ce que le service fait EN MOINS, à dessein :
//   · un cookie de session ne vaut rien (401), là où la console l'accepterait ;
//   · une écriture de l'API v1 répond 405, la console la sert.
//
//   CONTRACT_API_DATABASE_URL=<base vierge, migrée> pnpm test:contract
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ENV = vi.hoisted(() => {
  const url = process.env.CONTRACT_API_DATABASE_URL || null;
  if (url) {
    const hote = new URL(url).hostname;
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hote)) {
      throw new Error(`contrat de parité de l'API : base non locale refusée (${hote}) — Docker uniquement`);
    }
  }
  const jeton = "jeton-parite-api-0123456789";
  const jetonTout = "jeton-parite-api-tout-0123456789";
  process.env.DATABASE_URL = url ?? "postgres://parite:absente@127.0.0.1:9/parite_absente";
  process.env.CONSOLE_API_TOKENS = `${jeton}@parite-api-a;parite-api-b,${jetonTout}`;
  process.env.CONSOLE_API_RATE_LIMIT = "0";
  process.env.CONSOLE_API_ALLOWED_ORIGINS = "https://front.parite.test";
  return { url, jeton, jetonTout };
});

// @ts-expect-error module ESM, sans déclarations
import { construire, fichiersDeRoutes } from "../../services/api/build.mjs";
// @ts-expect-error module ESM, sans déclarations
import { cheminDuFichier, creerRouteur } from "../../services/api/routeur.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { writeRows } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

if (process.env.CI && !ENV.url) throw new Error("CI : CONTRACT_API_DATABASE_URL est requise");
const suite = ENV.url ? describe : describe.skip;

const A = "parite-api-a";
const B = "parite-api-b";
const C = "parite-api-c"; // hors du périmètre du jeton scopé
const JETON_BASE = "jeton-parite-base-0123456789";

/** Un lot OTLP réaliste : pages vues, Web Vitals, une erreur, une action. */
function lot(app: string, session: string, decalageMin: number) {
  const ns = (BigInt(Date.now() - decalageMin * 60_000)) * 1_000_000n;
  const attrs = (v: Record<string, string | number>) =>
    Object.entries(v).map(([key, value]) => ({ key, value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) } }));
  const span = (name: string, a: Record<string, string | number>, dureeMs = 1) => ({
    name,
    traceId: "c".repeat(32),
    spanId: randomBytes(8).toString("hex"),
    startTimeUnixNano: ns.toString(),
    endTimeUnixNano: (ns + BigInt(dureeMs) * 1_000_000n).toString(),
    attributes: attrs({ "mip.session_id": session, "mip.route": "/panier", "mip.url": "https://parite.test/panier", ...a }),
  });
  return flattenOtlp({
    resourceSpans: [
      {
        resource: { attributes: attrs({ "mip.app_id": app, "mip.env": "prod", "mip.release": "1.2.0" }) },
        scopeSpans: [
          {
            spans: [
              span("pageview", { "mip.nav_type": "navigate" }),
              span("webvital.LCP", { "webvital.name": "LCP", "webvital.value": 2300 + decalageMin, "webvital.id": `lcp-${session}` }),
              span("webvital.INP", { "webvital.name": "INP", "webvital.value": 180, "webvital.id": `inp-${session}` }),
              span("webvital.CLS", { "webvital.name": "CLS", "webvital.value": 0.05, "webvital.id": `cls-${session}` }),
              span("exception", { "exception.type": "TypeError", "exception.message": "x is undefined", "exception.stacktrace": "TypeError: x is undefined\n    at panier (https://parite.test/main.js:1:40)" }),
              span("rum.action", { "mip.event_type": "action", "mip.event_name": "ajouter-au-panier", "mip.action_id": `act-${session}` }, 30),
            ],
          },
        ],
      },
    ],
  });
}

/** Un port libre, pour lancer le service. */
function portLibre(): Promise<number> {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
    s.on("error", ko);
  });
}

type Reponse = { statut: number; etag: string | null; corps: unknown };

/** Ce qui change d'un appel à l'autre sans rien dire de la donnée. */
function normaliser(corps: unknown): unknown {
  if (!corps || typeof corps !== "object") return corps;
  const c = structuredClone(corps) as {
    generatedAt?: unknown;
    generated_at?: unknown;
    meta?: { generatedAt?: unknown; range?: { from?: unknown; to?: unknown; preset?: unknown } };
  };
  delete c.generatedAt; // /api/v1/health le porte à la racine
  delete c.generated_at; // /api/rum/summary aussi, en snake_case
  if (c.meta) {
    delete c.meta.generatedAt;
    // Fenêtre glissante : ses bornes avancent à chaque appel, son preset non.
    if (c.meta.range?.preset) {
      delete c.meta.range.from;
      delete c.meta.range.to;
    }
  }
  return c;
}

suite("P4 — parité de l'API de lecture : console ↔ service api", () => {
  const pool = new pg.Pool({ connectionString: ENV.url ?? undefined, max: 2 });
  /** Le service se connecte en `mip_api` (migration-v89), comme en production. */
  const motDePasseApi = randomBytes(18).toString("base64url");
  let service: ChildProcess;
  let base = "";
  let routeurConsole: (p: string) => { entree: { module: Record<string, (...a: unknown[]) => Promise<Response>> }; params: Record<string, string> } | null;

  async function appelerConsole(chemin: string, init: RequestInit = {}): Promise<Reponse> {
    const url = `https://mip-rum-console.vercel.app${chemin}`;
    const trouve = routeurConsole(new URL(url).pathname);
    if (!trouve) return { statut: 404, etag: null, corps: null };
    const methode = (init.method ?? "GET").toUpperCase();
    const fn = trouve.entree.module[methode];
    if (typeof fn !== "function") return { statut: 405, etag: null, corps: null };
    const brute = new Request(url, init);
    // Ce que NextRequest ajoute à la requête web : `nextUrl` et `cookies`.
    const cookies = new Map(
      (brute.headers.get("cookie") ?? "").split(";").filter(Boolean).map((c) => c.trim().split("=") as [string, string]),
    );
    const req = Object.assign(brute, { nextUrl: new URL(url), cookies: { get: (n: string) => (cookies.has(n) ? { value: cookies.get(n) } : undefined) } });
    const res = await fn(req, { params: Promise.resolve(trouve.params) });
    const texte = await res.text();
    return { statut: res.status, etag: res.headers.get("etag"), corps: texte ? JSON.parse(texte) : null };
  }

  async function appelerService(chemin: string, init: RequestInit = {}): Promise<Reponse> {
    const res = await fetch(`${base}${chemin}`, init);
    const texte = await res.text();
    let corps: unknown = null;
    try {
      corps = texte ? JSON.parse(texte) : null;
    } catch {
      corps = texte;
    }
    return { statut: res.status, etag: res.headers.get("etag"), corps };
  }

  beforeAll(async () => {
    // Données : deux apps du périmètre, une hors périmètre.
    await pool.query(
      `insert into app_registry (app_id, name) select a, a from unnest($1::text[]) a on conflict (app_id) do nothing`,
      [[A, B, C]],
    );
    // A regroupe ses erreurs en issues (v72) : les routes `/issues/{id}` ont un identifiant à lire.
    await pool.query("select error_grouping_activate($1, 'parite@test')", [A]);
    for (const [app, s, d] of [[A, "pa-1", 5], [A, "pa-2", 40], [B, "pb-1", 12], [C, "pc-1", 8]] as const) {
      await writeRows(pool, lot(app, s, d));
    }
    // Un jeton de lecture EN BASE (écran « Jetons de lecture ») : celui de `/api/rum/summary`.
    await pool.query(
      `insert into read_tokens (token_hash, app_id, label)
       values (encode(sha256(convert_to($1, 'utf8')), 'hex'), $2, 'parite')
       on conflict (token_hash) do nothing`,
      [JETON_BASE, A],
    );

    // Le service, construit et lancé comme dans son image, SOUS SON RÔLE : une
    // table que la liste blanche de `mip_api` oublie se voit ici comme un écart
    // avec la console (qui lit en propriétaire) — un 500, ou une liste vide.
    // Le rôle est global à l'instance : ouvert le temps du fichier, refermé après.
    await pool.query(`alter role mip_api login password '${motDePasseApi}'`);
    const urlApi = new URL(ENV.url!);
    urlApi.username = "mip_api";
    urlApi.password = motDePasseApi;
    await construire({ ecrire: true });
    const port = await portLibre();
    base = `http://127.0.0.1:${port}`;
    service = spawn(process.execPath, ["services/api/dist/server.mjs"], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: urlApi.toString(),
        PORT: String(port),
        CONSOLE_API_TOKENS: process.env.CONSOLE_API_TOKENS!,
        CONSOLE_API_RATE_LIMIT: "0",
        CONSOLE_API_ALLOWED_ORIGINS: process.env.CONSOLE_API_ALLOWED_ORIGINS!,
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    for (let i = 0; i < 100; i++) {
      const ok = await fetch(`${base}/health`).then((r) => r.ok, () => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Côté console : les modules de route réels, par la même table.
    vi.resetModules();
    const table = [];
    for (const f of fichiersDeRoutes()) {
      table.push({ chemin: cheminDuFichier(f.split("/app/").pop()), module: await import(f) });
    }
    routeurConsole = creerRouteur(table);
  }, 180_000);

  afterAll(async () => {
    service?.kill("SIGTERM");
    await pool.query("alter role mip_api nologin password null").catch(() => {});
    await pool.end();
    const { pool: poolConsole } = await import("../../apps/console/lib/db");
    await poolConsole.end().catch(() => {});
  });

  const auth = (jeton = ENV.jeton) => ({ headers: { authorization: `Bearer ${jeton}` } });

  const LECTURES = [
    "/api/v1",
    "/api/v1/apps",
    `/api/v1/overview?app=${A}&period=24h`,
    `/api/v1/overview?app=all&period=7d`,
    `/api/v1/vitals?app=${A}`,
    `/api/v1/pages?app=${A}`,
    `/api/v1/errors?app=${A}`,
    `/api/v1/events?app=${A}`,
    `/api/v1/actions?app=${A}`,
    `/api/v1/sessions?app=${A}`,
    `/api/v1/health?app=${A}`,
    `/api/v1/health-grid?app=${A}`,
    `/api/v1/tracing?app=${A}`,
    `/api/v1/correlation?app=${A}`,
    `/api/v1/mobile/summary?app=${A}`,
    `/api/v1/issues?app=${A}`,
    `/api/v1/explorer/schema?app=${A}`,
    `/api/v1/overview?app=${A}&device=mobile`,
    `/api/v1/errors?app=${A}&release=1.2.0`,
    `/api/v1/overview?app=${A}&period=24h&browser=Firefox`,
  ];

  it.each(LECTURES)("GET %s : même statut, même corps, même ETag", async (chemin) => {
    const [console_, api] = await Promise.all([appelerConsole(chemin, auth()), appelerService(chemin, auth())]);
    expect(api.statut, JSON.stringify(api.corps).slice(0, 300)).toBe(console_.statut);
    expect(normaliser(api.corps)).toEqual(normaliser(console_.corps));
    if (console_.statut === 200) expect(api.etag).toBe(console_.etag);
  });

  // Les routes à identifiant, et les GET que la liste ci-dessus ne couvre pas :
  // sous `mip_api`, chacune prouve que sa lecture est dans la liste blanche.
  it("les lectures à identifiant et les autres GET : même statut, même corps, même ETag", async () => {
    const erreurs = await appelerConsole(`/api/v1/errors?app=${A}`, auth());
    const fp = (erreurs.corps as { data: { groups: { fingerprint: string }[] } }).data.groups[0]?.fingerprint;
    const issues = await appelerConsole(`/api/v1/issues?app=${A}`, auth());
    const id = (issues.corps as { data: { issues: { id?: string }[] } }).data.issues.find((i) => i.id)?.id;
    expect(fp).toBeTruthy();
    expect(id).toBeTruthy();
    for (const [chemin, init, attendu] of [
      [`/api/v1/errors/${fp}?app=${A}`, auth(), 200],
      [`/api/v1/sessions/pa-1?app=${A}`, auth(), 200],
      [`/api/v1/issues/${id}?app=${A}`, auth(), 200],
      [`/api/v1/issues/${id}/activity?app=${A}`, auth(), 200],
      [`/api/v1/issues/${id}/tickets?app=${A}`, auth(), 200],
      [`/api/v1/explorer/views?app=${A}`, auth(), 403], // personnelles : aucun jeton n'en a
      ["/api/v1/openapi", auth(), 200],
      ["/api/rum/summary?window=7d", auth(JETON_BASE), 200],
    ] as const) {
      const [console_, api] = await Promise.all([appelerConsole(chemin, init), appelerService(chemin, init)]);
      expect(console_.statut, `${chemin} — ${JSON.stringify(console_.corps).slice(0, 300)}`).toBe(attendu);
      expect(api.statut, `${chemin} — ${JSON.stringify(api.corps).slice(0, 300)}`).toBe(console_.statut);
      expect(normaliser(api.corps), chemin).toEqual(normaliser(console_.corps));
      if (console_.statut === 200) expect(api.etag, chemin).toBe(console_.etag);
    }
  });

  it("les refus sont les mêmes : sans jeton 401, app hors périmètre 403, filtre invalide 400", async () => {
    for (const [chemin, init] of [
      ["/api/v1/apps", {}],
      [`/api/v1/overview?app=${C}`, auth()],
      [`/api/v1/overview?app=${A}&period=24h&from=2026-01-01T00:00:00Z`, auth()],
      [`/api/v1/overview?app=${A}&bogus_dimension=x`, auth()],
    ] as const) {
      const [console_, api] = await Promise.all([appelerConsole(chemin, init), appelerService(chemin, init)]);
      expect(api.statut, chemin).toBe(console_.statut);
      expect(normaliser(api.corps)).toEqual(normaliser(console_.corps));
    }
  });

  it("un jeton « toutes apps » voit la même chose des deux côtés", async () => {
    const chemin = `/api/v1/overview?app=${C}`;
    const [console_, api] = await Promise.all([appelerConsole(chemin, auth(ENV.jetonTout)), appelerService(chemin, auth(ENV.jetonTout))]);
    expect(api.statut).toBe(200);
    expect(normaliser(api.corps)).toEqual(normaliser(console_.corps));
  });

  it("OPTIONS : le même préflight CORS", async () => {
    const init = { method: "OPTIONS", headers: { origin: "https://front.parite.test", "access-control-request-method": "GET" } };
    const [console_, api] = await Promise.all([appelerConsole("/api/v1/apps", init), appelerService("/api/v1/apps", init)]);
    expect(api.statut).toBe(console_.statut);
  });

  it("l'Explorer (POST de lecture) rend la même chose", async () => {
    const corps = JSON.stringify({ app: A, period: "24h", query: { source: "metrics", measures: [{ fn: "count" }] } });
    const init = { method: "POST", headers: { ...auth().headers, "content-type": "application/json" }, body: corps };
    const [console_, api] = await Promise.all([appelerConsole("/api/v1/explorer/query", init), appelerService("/api/v1/explorer/query", init)]);
    expect(api.statut).toBe(console_.statut);
    expect(normaliser(api.corps)).toEqual(normaliser(console_.corps));
  });

  it("CE QUE LE SERVICE FAIT EN MOINS : un cookie de session ne vaut rien, une écriture répond 405", async () => {
    const cookie = { headers: { cookie: "mip_session=nimporte-quoi" } };
    expect((await appelerService("/api/v1/apps", cookie)).statut).toBe(401);
    const triage = await appelerService("/api/v1/issues/00000000-0000-0000-0000-000000000000/triage", { method: "POST", ...auth() });
    expect(triage.statut).toBe(405);
    const vue = await appelerService("/api/v1/explorer/views", { method: "POST", ...auth() });
    expect(vue.statut).toBe(405);
    const refusee = await fetch(`${base}/api/v1/explorer/views`, { method: "POST", ...auth() });
    expect(refusee.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    // Signée, comme toute réponse du service : 405, 404 et sondes compris.
    expect(refusee.headers.get("x-mip-api")).toBe("1");
    expect((await fetch(`${base}/api/v1/nexiste-pas`)).headers.get("x-mip-api")).toBe("1");
  });
});
