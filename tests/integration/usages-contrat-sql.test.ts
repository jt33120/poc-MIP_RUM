// B31 — lectures d'usage sur le contrat (plan § 6.3), sur un vrai PostgreSQL.
//
// `acquisition`, `acquisitionSerie`, `routeTransitions`, `entryExitRoutes`,
// `availableEvents`, `funnelReport`, `formEvents` et `retentionCohorts` lisaient
// `now() - interval` et filtraient l'app par « app demandée, ou toutes si elle est
// nulle » : sous `app=all`, elles lisaient TOUTES les apps de la base (la console
// se connecte en BYPASSRLS), et ni la plage personnalisée, ni la tablette, ni
// « Inconnu » ne s'appliquaient. Ce que la base seule peut dire :
//   · la fenêtre est `[from, to)` du contrat — preset, plage personnalisée, et
//     période précédente contiguë (`shift`, pour `cmp=prev`) ;
//   · le périmètre est celui du PRINCIPAL : un viewer restreint à A qui demande
//     « toutes les apps » ne lit rien de B ; `apps = []` ne lit rien ; sous
//     « toutes », un admin ne lit pas les apps internes (sauf `internal=1`) ;
//   · tablette et appareil inconnu s'appliquent ; les robots restent exclus ;
//   · les nouveautés : route d'entrée croisée par canal, série par seau, ancrage
//     `depuis`, sessions à une vue, LCP p75 des routes de bord.
//
// COMMENT L'EXÉCUTER. Ce fichier applique le schéma COMPLET : base JETABLE.
//   SQL_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/<jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery, type AnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const A_B31 = "b31-sql-a";
const B_B31 = "b31-sql-b";
const INTERNE_B31 = "b31-sql-interne";
const APPS_B31 = [A_B31, B_B31, INTERNE_B31];

const HEURE_B31 = 3_600_000;
const NOW_B31 = Date.now();
const IL_Y_A_B31 = (ms: number) => new Date(NOW_B31 - ms);

function fichiersSqlB31(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

async function nettoyerB31(c: pg.Client): Promise<void> {
  for (const table of ["rum_metric", "rum_event", "rum_pageview", "rum_session", "app_registry"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS_B31]);
  }
}

interface VueB31 {
  route: string;
  referrer?: string | null;
}

interface SessionB31 {
  id: string;
  app: string;
  device: string | null;
  quand: Date;
  visiteur: string | null;
  vues: VueB31[];
  evenements?: string[];
  formulaire?: { nom: "form.submit" | "form.abandon"; form: string };
  bot?: boolean;
}

// App A, dernières 24 h : a1 (desktop, recherche), a2 (mobile, site référent),
// a3 (tablette, directe, UNE vue), a4 (appareil inconnu, interne), a5 (robot).
// a9 : il y a 30 h (période précédente d'un `period=24h`) ; a8 : il y a 3 jours.
// App B : deux sessions récentes ; app interne : une session récente.
const SESSIONS_B31: SessionB31[] = [
  {
    id: "b31-a1",
    app: A_B31,
    device: "desktop",
    quand: IL_Y_A_B31(2 * HEURE_B31),
    visiteur: "b31-v1",
    vues: [{ route: "/", referrer: "https://www.google.com/search" }, { route: "/produit" }, { route: "/panier" }],
    evenements: ["checkout", "purchase"],
    formulaire: { nom: "form.submit", form: "contact" },
  },
  {
    id: "b31-a2",
    app: A_B31,
    device: "mobile",
    quand: IL_Y_A_B31(3 * HEURE_B31),
    visiteur: "b31-v2",
    vues: [{ route: "/produit", referrer: "https://partenaire.fr/article" }, { route: "/" }],
    evenements: ["checkout"],
    formulaire: { nom: "form.abandon", form: "contact" },
  },
  {
    id: "b31-a3",
    app: A_B31,
    device: "tablet",
    quand: IL_Y_A_B31(4 * HEURE_B31),
    visiteur: "b31-v3",
    vues: [{ route: "/", referrer: null }],
    formulaire: { nom: "form.submit", form: "newsletter" },
  },
  {
    id: "b31-a4",
    app: A_B31,
    device: null,
    quand: IL_Y_A_B31(5 * HEURE_B31),
    visiteur: "b31-v4",
    vues: [{ route: "/blog", referrer: "https://a.example/ailleurs" }, { route: "/" }],
  },
  {
    id: "b31-a5",
    app: A_B31,
    device: "desktop",
    quand: IL_Y_A_B31(2 * HEURE_B31),
    visiteur: "b31-v5",
    vues: [{ route: "/", referrer: "https://www.google.com/" }, { route: "/robot" }],
    evenements: ["checkout"],
    formulaire: { nom: "form.submit", form: "contact" },
    bot: true,
  },
  {
    id: "b31-a9",
    app: A_B31,
    device: "desktop",
    quand: IL_Y_A_B31(30 * HEURE_B31),
    visiteur: "b31-v9",
    vues: [{ route: "/", referrer: null }, { route: "/produit" }],
    evenements: ["checkout"],
    formulaire: { nom: "form.submit", form: "contact" },
  },
  {
    id: "b31-a8",
    app: A_B31,
    device: "desktop",
    quand: IL_Y_A_B31(72 * HEURE_B31),
    visiteur: "b31-v8",
    vues: [{ route: "/", referrer: null }],
  },
  {
    id: "b31-b1",
    app: B_B31,
    device: "desktop",
    quand: IL_Y_A_B31(2 * HEURE_B31),
    visiteur: "b31-vb1",
    vues: [{ route: "/b-entree", referrer: "https://ref-b.example/lien" }, { route: "/b-suite" }],
    evenements: ["checkout"],
    formulaire: { nom: "form.submit", form: "form-b" },
  },
  {
    id: "b31-b2",
    app: B_B31,
    device: "tablet",
    quand: IL_Y_A_B31(3 * HEURE_B31),
    visiteur: "b31-vb2",
    vues: [{ route: "/b-entree", referrer: "https://ref-b.example/lien" }],
  },
  {
    id: "b31-i1",
    app: INTERNE_B31,
    device: "desktop",
    quand: IL_Y_A_B31(2 * HEURE_B31),
    visiteur: "b31-vi1",
    vues: [{ route: "/interne", referrer: "https://ref-interne.example/" }],
  },
];

// LCP des routes de bord : « / » de A = 1 000, 2 000, 3 000, 4 000 ms (p75 = 3 250) ;
// « / » de B = 9 000 ms (ne doit jamais entrer dans le p75 de A) ; « /produit » sans mesure.
const LCP_B31: { app: string; session: string; route: string; valeur: number }[] = [
  { app: A_B31, session: "b31-a1", route: "/", valeur: 1000 },
  { app: A_B31, session: "b31-a2", route: "/", valeur: 2000 },
  { app: A_B31, session: "b31-a3", route: "/", valeur: 3000 },
  { app: A_B31, session: "b31-a4", route: "/", valeur: 4000 },
  { app: B_B31, session: "b31-b1", route: "/", valeur: 9000 },
];

async function semerB31(c: pg.Client): Promise<void> {
  for (const app of APPS_B31) {
    await c.query(
      `insert into app_registry (app_id, name, internal) values ($1, $1, $2)
       on conflict (app_id) do update set internal = excluded.internal`,
      [app, app === INTERNE_B31],
    );
  }
  for (const s of SESSIONS_B31) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, started_at, last_seen_at, page_count, visitor_id)
       values ($1, $2, $3, $4, $5, $5, $6, $7)`,
      [s.id, s.app, s.device, s.bot ?? false, s.quand, s.vues.length, s.visiteur],
    );
    for (const [i, v] of s.vues.entries()) {
      await c.query(
        `insert into rum_pageview (span_id, session_id, app_id, route, url, referrer, started_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [`${s.id}-pv${i}`, s.id, s.app, v.route, `https://a.example${v.route}`, v.referrer ?? null, new Date(s.quand.getTime() + i * 60_000)],
      );
    }
    for (const [i, nom] of (s.evenements ?? []).entries()) {
      await c.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, ts) values ($1, $2, $3, '/', $4, $5)`,
        [`${s.id}-ev${i}`, s.id, s.app, nom, new Date(s.quand.getTime() + (i + 5) * 60_000)],
      );
    }
    if (s.formulaire) {
      await c.query(
        `insert into rum_event (span_id, session_id, app_id, route, name, props, ts) values ($1, $2, $3, '/', $4, $5::jsonb, $6)`,
        [
          `${s.id}-form`,
          s.id,
          s.app,
          s.formulaire.nom,
          JSON.stringify({ form: s.formulaire.form, submitted: s.formulaire.nom === "form.submit", total_time_ms: 4000 }),
          new Date(s.quand.getTime() + 10 * 60_000),
        ],
      );
    }
  }
  for (const [i, m] of LCP_B31.entries()) {
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts) values ($1, $2, $3, $4, 'LCP', $5, $6)`,
      [`b31-lcp-${i}`, m.session, m.app, m.route, m.valeur, IL_Y_A_B31(2 * HEURE_B31)],
    );
  }
}

/** Modules console branchés sur la base jetable (cf. goals-sql). */
async function consoleSurB31(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const acquisition = await import("../../apps/console/lib/queries-acquisition");
  const paths = await import("../../apps/console/lib/queries-paths");
  const funnel = await import("../../apps/console/lib/queries-funnel");
  const forms = await import("../../apps/console/lib/queries-form-analytics");
  const cohorts = await import("../../apps/console/lib/queries-cohorts");
  const { sessionsAvecVue } = await import("../../apps/console/lib/queries");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...acquisition, ...paths, ...funnel, ...forms, ...cohorts, sessionsAvecVue, ...filters, pool };
}

const ADMIN_B31: ScopePrincipal = { role: "admin", apps: null };
const VIEWER_A_B31: ScopePrincipal = { role: "viewer", apps: [A_B31] };

function requeteB31(qs: string, principal: ScopePrincipal = ADMIN_B31): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

(url ? describe : describe.skip)("B31 — lectures d'usage sur le contrat (PostgreSQL)", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Awaited<ReturnType<typeof consoleSurB31>>;
  const f = (qs: string, principal: ScopePrincipal = ADMIN_B31) => lib.deviceFiltersOfQuery(requeteB31(qs, principal));
  const fA = (extra = "period=24h") => f(`app=${A_B31}&${extra}`);
  /** Périmètre vide : le principal n'a aucune app (jamais une erreur silencieuse, jamais une ligne). */
  const fVide = () => {
    const q = requeteB31("period=24h");
    return lib.deviceFiltersOfQuery({ ...q, scope: { requestedApp: null, authorizedApps: [], effectiveApps: [] } });
  };
  // Plage personnalisée autour de a9 (il y a 30 h).
  const plageA9 = () => `from=${IL_Y_A_B31(31 * HEURE_B31).toISOString()}&to=${IL_Y_A_B31(29 * HEURE_B31).toISOString()}`;

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSqlB31()) await c.query(readFileSync(file, "utf8"));
    await nettoyerB31(c);
    await semerB31(c);
    lib = await consoleSurB31(url!);
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyerB31(c);
    await c.end();
  });

  describe("acquisition", () => {
    it("1re vue de chaque session de la fenêtre : canaux, référents, route d'entrée par canal ; robot exclu", async () => {
      const rep = await lib.acquisition(fA());
      expect(rep.total).toBe(4); // a1-a4 ; a5 robot, a8 et a9 hors fenêtre
      expect(Object.fromEntries(rep.channels.map((ch) => [ch.channel, ch.sessions]))).toEqual({
        direct: 1, // a3
        search: 1, // a1
        social: 0,
        referral: 1, // a2
        internal: 1, // a4 : référent sur son propre hôte
      });
      expect(rep.referrers.map((r) => r.host).sort()).toEqual(["google.com", "partenaire.fr"]);
      expect(rep.routesEntree).toBe(3);
      expect(rep.entrees).toEqual([
        { route: "/", parCanal: { direct: 1, search: 1, social: 0, referral: 0, internal: 0 }, total: 2 },
        { route: "/blog", parCanal: { direct: 0, search: 0, social: 0, referral: 0, internal: 1 }, total: 1 },
        { route: "/produit", parCanal: { direct: 0, search: 0, social: 0, referral: 1, internal: 0 }, total: 1 },
      ]);
    });

    it("période précédente (shift) et plage personnalisée : [from, to) du contrat", async () => {
      expect((await lib.acquisition(fA(), undefined, true)).total).toBe(1); // a9
      const plage = await lib.acquisition(fA(plageA9()));
      expect(plage.total).toBe(1);
      expect(plage.channels.find((ch) => ch.channel === "direct")?.sessions).toBe(1);
    });

    it("tablette et appareil inconnu s'appliquent", async () => {
      expect((await lib.acquisition(fA("period=24h&device=tablet"))).total).toBe(1); // a3
      expect((await lib.acquisition(fA("period=24h&seg=v2:device:is_null"))).total).toBe(1); // a4
    });

    it("plafond : les PREMIÈRES sessions par identifiant", async () => {
      const rep = await lib.acquisition(fA(), 2);
      expect(rep.total).toBe(2);
      // Ordre (app_id, session_id) : a1 puis a2.
      expect(rep.channels.find((ch) => ch.channel === "search")?.sessions).toBe(1);
      expect(rep.channels.find((ch) => ch.channel === "referral")?.sessions).toBe(1);
    });

    it("périmètre : viewer restreint + app=all → A seule ; admin + toutes → ni l'app interne, sauf internal=1 ; apps = [] → rien", async () => {
      const viewer = await lib.acquisition(f("app=all&period=24h", VIEWER_A_B31));
      expect(viewer.total).toBe(4);
      expect(viewer.referrers.map((r) => r.host)).not.toContain("ref-b.example");
      const admin = await lib.acquisition(f("app=all&period=24h"));
      expect(admin.referrers.map((r) => r.host)).toContain("ref-b.example");
      expect(admin.referrers.map((r) => r.host)).not.toContain("ref-interne.example");
      expect((await lib.acquisition(f("app=all&period=24h&internal=1"))).referrers.map((r) => r.host)).toContain(
        "ref-interne.example",
      );
      expect((await lib.acquisition(fVide())).total).toBe(0);
    });

    it("acquisitionSerie : mêmes sessions que le report, dans le seau de leur 1re vue, zéros compris", async () => {
      const serie = await lib.acquisitionSerie(fA());
      expect(serie.length).toBeGreaterThanOrEqual(24);
      const somme = (canal: "direct" | "search" | "social" | "referral" | "internal") =>
        serie.reduce((s, p) => s + p.canaux[canal], 0);
      expect({ direct: somme("direct"), search: somme("search"), social: somme("social"), referral: somme("referral"), internal: somme("internal") }).toEqual({
        direct: 1,
        search: 1,
        social: 0,
        referral: 1,
        internal: 1,
      });
      // a1 (il y a 2 h, recherche) est dans le seau horaire qui contient son début.
      const seau = serie.find((p) => {
        const t = Date.parse(p.t);
        const debut = IL_Y_A_B31(2 * HEURE_B31).getTime();
        return t <= debut && debut < t + HEURE_B31;
      });
      expect(seau?.canaux.search).toBe(1);
      expect(await lib.acquisitionSerie(fVide())).toSatisfy((pts: { canaux: Record<string, number> }[]) =>
        pts.every((p) => Object.values(p.canaux).every((n) => n === 0)),
      );
    });
  });

  describe("parcours", () => {
    it("transitions hors boucles, par session (app_id, session_id) ; robot exclu", async () => {
      const t = await lib.routeTransitions(fA());
      expect(t.map((r) => [r.from_route, r.to_route, r.n])).toEqual([
        ["/", "/produit", 1],
        ["/blog", "/", 1],
        ["/produit", "/", 1],
        ["/produit", "/panier", 1],
      ]);
    });

    it("ancrage `depuis` : seules les transitions qui partent de la route, valeur liée", async () => {
      const t = await lib.routeTransitions(fA(), 50, { depuis: "/produit" });
      expect(t.map((r) => r.to_route).sort()).toEqual(["/", "/panier"]);
      expect(await lib.routeTransitions(fA(), 50, { depuis: "'; drop table rum_pageview; --" })).toEqual([]);
    });

    it("shift et plage personnalisée : a9 seule", async () => {
      expect((await lib.routeTransitions(fA(), 50, { shift: true })).map((r) => [r.from_route, r.to_route])).toEqual([["/", "/produit"]]);
      expect((await lib.routeTransitions(fA(plageA9()))).map((r) => [r.from_route, r.to_route])).toEqual([["/", "/produit"]]);
    });

    it("bords : entrées et sorties, sessions à une vue ; la somme des entrées vaut `sessionsAvecVue`", async () => {
      const { entries, exits } = await lib.entryExitRoutes(fA());
      expect(entries).toEqual([
        { route: "/", n: 2, une_vue: 1 }, // a1, a3 (une seule vue)
        { route: "/blog", n: 1, une_vue: 0 },
        { route: "/produit", n: 1, une_vue: 0 },
      ]);
      expect(exits).toEqual([
        { route: "/", n: 3, une_vue: 1 }, // a2, a3, a4
        { route: "/panier", n: 1, une_vue: 0 },
      ]);
      expect(entries.reduce((s, r) => s + r.n, 0)).toBe(await lib.sessionsAvecVue(fA()));
    });

    it("bords : tablette, inconnu, viewer restreint sous « toutes », apps = []", async () => {
      expect((await lib.entryExitRoutes(fA("period=24h&device=tablet"))).entries).toEqual([{ route: "/", n: 1, une_vue: 1 }]);
      expect((await lib.entryExitRoutes(fA("period=24h&seg=v2:device:is_null"))).entries).toEqual([{ route: "/blog", n: 1, une_vue: 0 }]);
      const viewer = await lib.entryExitRoutes(f("app=all&period=24h", VIEWER_A_B31));
      expect(viewer.entries.map((r) => r.route)).not.toContain("/b-entree");
      expect(viewer.entries.reduce((s, r) => s + r.n, 0)).toBe(4);
      expect(await lib.entryExitRoutes(fVide())).toEqual({ entries: [], exits: [] });
      expect(await lib.routeTransitions(fVide())).toEqual([]);
    });

    it("LCP p75 des routes de bord : même fenêtre, apps effectives ; route sans mesure absente", async () => {
      const lcp = await lib.lcpDesRoutes(fA(), ["/", "/produit"]);
      expect(lcp).toEqual([{ route: "/", p75: 3250, n: 4 }]);
      // Sous « toutes » pour un viewer de A : la mesure de B (9 000 ms) n'entre pas.
      expect(await lib.lcpDesRoutes(f("app=all&period=24h", VIEWER_A_B31), ["/"])).toEqual([{ route: "/", p75: 3250, n: 4 }]);
      expect(await lib.lcpDesRoutes(fA(), [])).toEqual([]);
      expect(await lib.lcpDesRoutes(fVide(), ["/"])).toEqual([]);
    });
  });

  describe("entonnoir", () => {
    it("événements disponibles : sessions comptées par (app_id, session_id) ; robot et B exclus", async () => {
      const ev = await lib.availableEvents(f("app=all&period=24h", VIEWER_A_B31));
      expect(ev.find((e) => e.name === "checkout")).toEqual({ name: "checkout", n: 2, sessions: 2 }); // a1, a2
      expect(ev.find((e) => e.name === "purchase")).toEqual({ name: "purchase", n: 1, sessions: 1 });
      expect(await lib.availableEvents(fVide())).toEqual([]);
    });

    it("rapport : étapes dans l'ordre ; shift et plage personnalisée lisent a9", async () => {
      const r = await lib.funnelReport(fA(), ["checkout", "purchase"]);
      expect(r.map((s) => s.reached)).toEqual([2, 1]);
      expect((await lib.funnelReport(fA(), ["checkout", "purchase"], true)).map((s) => s.reached)).toEqual([1, 0]);
      expect((await lib.funnelReport(fA(plageA9()), ["checkout", "purchase"])).map((s) => s.reached)).toEqual([1, 0]);
      // Viewer restreint sous « toutes » : le checkout de B ne compte pas.
      expect((await lib.funnelReport(f("app=all&period=24h", VIEWER_A_B31), ["checkout"])).map((s) => s.reached)).toEqual([2]);
      expect((await lib.funnelReport(fA("period=24h&device=mobile"), ["checkout", "purchase"])).map((s) => s.reached)).toEqual([1, 0]);
    });
  });

  describe("formulaires", () => {
    it("événements form.* de la fenêtre ; tablette, shift, plage, périmètre", async () => {
      const forms = (evs: { props: { form?: string } }[]) => evs.map((e) => e.props.form).sort();
      expect(forms(await lib.formEvents(fA()))).toEqual(["contact", "contact", "newsletter"]); // a1, a2, a3 ; a5 robot
      expect(forms(await lib.formEvents(fA("period=24h&device=tablet")))).toEqual(["newsletter"]);
      expect(forms(await lib.formEvents(fA(), 5000, true))).toEqual(["contact"]); // a9
      expect(forms(await lib.formEvents(fA(plageA9())))).toEqual(["contact"]);
      expect(forms(await lib.formEvents(f("app=all&period=24h", VIEWER_A_B31)))).not.toContain("form-b");
      expect(await lib.formEvents(fVide())).toEqual([]);
      expect(await lib.formEvents(fA(), 1)).toHaveLength(1);
    });
  });

  describe("rétention", () => {
    const visiteurs = (rows: { size: number }[]) => rows.reduce((s, r) => s + r.size, 0);

    it("visiteurs identifiés des N semaines ; robot exclu ; périmètre du principal", async () => {
      // a1-a4, a8, a9 identifiés (le robot a5 exclu).
      expect(visiteurs(await lib.retentionCohorts(fA(""), 4))).toBe(6);
      expect(visiteurs(await lib.retentionCohorts(f("app=all", VIEWER_A_B31), 4))).toBe(6); // 8 avec B
      expect(await lib.retentionCohorts(fVide(), 4)).toEqual([]);
    });

    it("tablette, appareil inconnu, et option `appareil` (figure « Par appareil »)", async () => {
      expect(visiteurs(await lib.retentionCohorts(fA("device=tablet"), 4))).toBe(1); // a3
      expect(visiteurs(await lib.retentionCohorts(fA("seg=v2:device:is_null"), 4))).toBe(1); // a4
      // L'option REMPLACE l'appareil de la requête résolue (sur le contrat, `{ ...f, device }` ne suffit plus).
      expect(visiteurs(await lib.retentionCohorts(fA(""), 4, { appareil: "mobile" }))).toBe(1); // a2
      expect(visiteurs(await lib.retentionCohorts(fA(""), 4, { appareil: "desktop" }))).toBe(3); // a1, a8, a9
      expect(visiteurs(await lib.retentionCohorts(fA(""), 4, { appareil: "tablet" }))).toBe(1);
    });

    it("une fenêtre de semaines hors bornes est refusée, jamais interpolée", async () => {
      await expect(lib.retentionCohorts(fA(""), 0)).rejects.toThrow("fenêtre de rétention invalide");
      await expect(lib.retentionCohorts(fA(""), 2.5)).rejects.toThrow("fenêtre de rétention invalide");
    });
  });

  it("un contexte par requête : deux lectures en parallèle ne partagent pas leurs paramètres", async () => {
    const [transitions, bords, ev, forms] = await Promise.all([
      lib.routeTransitions(fA("period=24h&device=tablet"), 50, { depuis: "/" }),
      lib.entryExitRoutes(fA("period=24h&device=mobile")),
      lib.availableEvents(fA("period=24h&device=desktop")),
      lib.formEvents(fA("period=24h&seg=v2:device:is_null")),
    ]);
    expect(transitions).toEqual([]); // a3 n'a qu'une vue
    expect(bords.entries).toEqual([{ route: "/produit", n: 1, une_vue: 0 }]);
    expect(ev.map((e) => e.name).sort()).toEqual(["checkout", "form.submit", "purchase"]);
    expect(forms).toEqual([]); // a4 n'a pas de formulaire
  });
});
