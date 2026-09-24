// F57 — lectures Robot et réel, exécutées sur PostgreSQL.
//
// Le test unitaire verrouille la FORME des requêtes (bornes liées, un contexte par
// instruction) ; seul PostgreSQL dit que les heures tombent dans la bonne case.
// Chaque cas a son app, pour que les attendus restent lisibles et qu'aucun cas ne
// déborde sur un autre :
//
// - MATRICE : les quatre heures du plan (§ 5.7 CR8) — ok/Bon, ok/Mauvais,
//   incident/Bon, ok/Mauvais sur 12 mesures seulement ;
// - BORNES : 2 500 ms est Bon, 4 000 ms est À améliorer, 4 001 ms est Mauvais ; plus
//   une heure robot seul, une heure réel seul, une heure à l'état robot inconnu ;
// - LENT : 60 heures en angle mort — le compte dit 60 là où `blindSpots` s'arrête à 50 ;
// - PANIER_A / PANIER_B : deux apps qui ont chacune `/checkout` ;
// - ARRET : un robot qui s'est arrêté 3 h avant la fin de la plage ;
// - SANS_ROBOT : une app du périmètre sans aucun passage ;
// - ROUTE_NULLE : robot ET réel à la même heure, sans route des deux côtés.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { lireSerie } from "../../apps/console/lib/correlation-serie";
import { retardRobot } from "../../apps/console/lib/correlation";
import type { Filters } from "../../apps/console/lib/filters";
import {
  bucketStarts,
  parseAnalyticsQuery,
  previousRange,
  type AnalyticsQuery,
  type ScopePrincipal,
} from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const MATRICE = "f57-matrice";
const BORNES = "f57-bornes";
const LENT = "f57-lent";
const PANIER_A = "f57-panier-a";
const PANIER_B = "f57-panier-b";
const ARRET = "f57-arret";
const SANS_ROBOT = "f57-sans-robot";
const ROUTE_NULLE = "f57-route-nulle";
const APPS = [MATRICE, BORNES, LENT, PANIER_A, PANIER_B, ARRET, SANS_ROBOT, ROUTE_NULLE];

const H = 3_600_000;
// Plage de recette : 72 heures pleines, terminées une heure avant maintenant.
const TO = new Date(Math.floor(Date.now() / H) * H - H);
const FROM = new Date(TO.getTime() - 72 * H);
/** Début de la i-ème heure de la plage. */
const heure = (i: number) => new Date(FROM.getTime() + i * H);

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client): Promise<void> {
  for (const table of ["rum_metric", "syn_snapshot", "rum_session", "app_registry"]) {
    await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
  }
}

let mesures = 0;

/** `n` mesures LCP identiques (le p75 vaut donc `valeur`) à la 10ᵉ minute de l'heure `i`. */
async function reel(c: pg.Client, app: string, route: string | null, i: number, valeur: number, n = 30): Promise<void> {
  const debut = new Date(heure(i).getTime() + 10 * 60_000);
  await c.query(
    `insert into rum_metric (span_id, session_id, app_id, route, name, value, ts)
     select $1 || '-' || g, $2, $3, $4, 'LCP', $5, $6::timestamptz + make_interval(secs => g)
       from generate_series(1, $7) g`,
    [`f57m${(mesures += 1)}`, `f57-s-${app}`, app, route, valeur, debut, n],
  );
}

/** Un passage du robot à la 20ᵉ minute de l'heure `i` (ou à l'instant donné). */
async function robot(
  c: pg.Client,
  app: string,
  route: string | null,
  quand: number | Date,
  etat: string | null,
  scenario = "Parcours",
  latence: number | null = 800,
): Promise<void> {
  const at = typeof quand === "number" ? new Date(heure(quand).getTime() + 20 * 60_000) : quand;
  await c.query(
    `insert into syn_snapshot (app_id, site, measure_id, measure_name, route_hint, score, state, latency_ms, captured_at)
     values ($1, 'recette F57', $2, $2, $3, 90, $4, $5, $6)`,
    [app, scenario, route, etat, latence, at],
  );
}

async function semer(c: pg.Client): Promise<void> {
  await c.query(
    `insert into app_registry (app_id, name, active, internal)
     select a, a, true, false from unnest($1::text[]) a
     on conflict (app_id) do update set active = true, internal = false`,
    [APPS],
  );
  for (const app of APPS) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, is_bot, client_id, collection_source, started_at, last_seen_at, sample_rate, error_sample_rate)
       values ($1, $2, 'desktop', false, 'mip', 'sdk', $3, $4, 1, 1)
       on conflict (session_id) do nothing`,
      [`f57-s-${app}`, app, FROM, TO],
    );
  }

  // MATRICE — les quatre heures du plan.
  await robot(c, MATRICE, "/accueil", 0, "ok");
  await reel(c, MATRICE, "/accueil", 0, 1200);
  await robot(c, MATRICE, "/accueil", 1, "ok");
  await reel(c, MATRICE, "/accueil", 1, 4500);
  await robot(c, MATRICE, "/accueil", 2, "incident");
  await reel(c, MATRICE, "/accueil", 2, 1200);
  await robot(c, MATRICE, "/accueil", 3, "ok");
  await reel(c, MATRICE, "/accueil", 3, 4500, 12);

  // BORNES — bon inclusif, mauvais strict ; puis les heures hors matrice.
  for (const [i, lcp] of [[0, 2500], [1, 4000], [2, 4001]] as const) {
    await robot(c, BORNES, "/b", i, "ok");
    await reel(c, BORNES, "/b", i, lcp);
  }
  await robot(c, BORNES, "/b", 3, "ok"); // robot seul
  await reel(c, BORNES, "/b", 4, 1200); // réel seul
  await robot(c, BORNES, "/b", 5, null); // état robot inconnu…
  await reel(c, BORNES, "/b", 5, 1200); // …avec assez de mesures

  // LENT — 60 heures en angle mort (robot ok, réel À améliorer).
  for (let i = 0; i < 60; i++) {
    await robot(c, LENT, "/lent", i, "ok", "Parcours lent");
    await reel(c, LENT, "/lent", i, 3000);
  }

  // PANIER_A : heures 0 et 2, rien à l'heure 1. PANIER_B : heures 0 et 1.
  for (const i of [0, 2]) {
    await robot(c, PANIER_A, "/checkout", i, "ok");
    await reel(c, PANIER_A, "/checkout", i, 1500);
  }
  for (const i of [0, 1]) {
    await robot(c, PANIER_B, "/checkout", i, "ok");
    await reel(c, PANIER_B, "/checkout", i, 5000);
  }

  // ROUTE_NULLE — la même heure des deux côtés, route inconnue des deux côtés.
  await robot(c, ROUTE_NULLE, null, 0, "ok");
  await reel(c, ROUTE_NULLE, null, 0, 1200);

  // ARRET — deux scénarios toutes les 15 min, jusqu'à 3 h avant la fin de la plage.
  for (let t = FROM.getTime(); t <= TO.getTime() - 3 * H; t += 15 * 60_000) {
    await robot(c, ARRET, "/", new Date(t), "ok", "Accueil");
    await robot(c, ARRET, "/", new Date(t), "ok", "Panier");
  }
}

/** Modules console branchés sur la base jetable (cf. query-contract-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const v2 = await import("../../apps/console/lib/queries-v2");
  const filters = await import("../../apps/console/lib/filters");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...v2, ...filters, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

(url ? describe : describe.skip)("F57 — lectures Robot et réel sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;

  const requete = (qs: string, principal: ScopePrincipal = { role: "admin", apps: null }): AnalyticsQuery => {
    const params = new URLSearchParams(qs);
    if (!params.has("from")) {
      params.set("from", FROM.toISOString());
      params.set("to", TO.toISOString());
    }
    const parsed = parseAnalyticsQuery(params, { principal, nowMs: Date.now() });
    if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
    return parsed.value;
  };
  const filtres = (qs: string, principal?: ScopePrincipal): Filters => lib.filtersOfQuery(requete(qs, principal));
  const cellule = (conc: Awaited<ReturnType<Console["correlationConcordance"]>>, robot: string, reel: string) =>
    conc.cellules.find((x) => x.robot === robot && x.reel === reel)!.heures;

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await semer(c);
    lib = await consoleSur(url!);
  }, 300_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  it("concordance : les quatre heures du plan tombent chacune dans leur case", async () => {
    const conc = await lib.correlationConcordance(filtres(`app=${MATRICE}`));
    expect(conc.cellules).toHaveLength(9);
    expect(cellule(conc, "ok", "good")).toBe(1); // diagonale : d'accord
    expect(cellule(conc, "ok", "poor")).toBe(1); // angle mort
    expect(cellule(conc, "incident", "good")).toBe(1); // alerte robot non ressentie
    expect(conc.reelInsuffisant).toBe(1); // ok/Mauvais sur 12 mesures : aucun verdict
    expect(conc.cellules.reduce((s, x) => s + x.heures, 0)).toBe(3);
    expect([conc.robotSeul, conc.reelSeul, conc.robotInconnu]).toEqual([0, 0, 0]);
    expect(conc.anglesMortsParRoute).toEqual([
      { serie: `${MATRICE}:${encodeURIComponent("/accueil")}`, app_id: MATRICE, route: "/accueil", heures: 1 },
    ]);
    expect(conc.bornesLcp).toEqual([2500, 4000]);
  });

  it("concordance : « Mauvais » seulement au-delà de 4 000 ms ; heures hors matrice comptées à part", async () => {
    const conc = await lib.correlationConcordance(filtres(`app=${BORNES}`));
    expect(cellule(conc, "ok", "good")).toBe(1); // 2 500 ms : bon inclusif
    expect(cellule(conc, "ok", "needs-improvement")).toBe(1); // 4 000 ms : pas encore Mauvais
    expect(cellule(conc, "ok", "poor")).toBe(1); // 4 001 ms
    expect(conc.robotSeul).toBe(1);
    expect(conc.reelSeul).toBe(1);
    expect(conc.robotInconnu).toBe(1);
    expect(conc.reelInsuffisant).toBe(0);
    expect(conc.anglesMortsParRoute).toEqual([expect.objectContaining({ app_id: BORNES, route: "/b", heures: 2 })]);
  });

  it("concordance : une heure sans route n'est comptée NI « robot seul » NI « réel seul »", async () => {
    // `using (app_id, route, bucket)` ne relie jamais deux routes NULL : la même
    // heure tombait deux fois hors matrice, une fois de chaque côté. Une heure sans
    // route ne désigne aucun couple : elle est exclue de la concordance.
    const conc = await lib.correlationConcordance(filtres(`app=${ROUTE_NULLE}`));
    expect([conc.robotSeul, conc.reelSeul, conc.reelInsuffisant, conc.robotInconnu]).toEqual([0, 0, 0, 0]);
    expect(conc.cellules.every((x) => x.heures === 0)).toBe(true);
    expect(conc.anglesMortsParRoute).toEqual([]);
  });

  it("60 heures en angle mort : le compte dit 60, la liste s'arrête à 50", async () => {
    const f = filtres(`app=${LENT}`);
    const conc = await lib.correlationConcordance(f);
    expect(cellule(conc, "ok", "needs-improvement")).toBe(60);
    expect(conc.anglesMortsParRoute).toEqual([expect.objectContaining({ route: "/lent", heures: 60 })]);
    const liste = await lib.blindSpots(f);
    expect(liste).toHaveLength(50);
    expect(liste.every((l) => l.rum_lcp_n === 30 && l.syn_measures === "Parcours lent" && l.syn_state === "ok")).toBe(true);
  });

  it("angles morts : une heure sous l'effectif minimal n'est pas listée", async () => {
    const liste = await lib.blindSpots(filtres(`app=${MATRICE}`));
    // Heure 1 (4 500 ms sur 30 mesures) : listée ; heure 3 (12 mesures) : non.
    expect(liste.map((l) => l.bucket.getTime())).toEqual([heure(1).getTime()]);
    // L'effectif est un paramètre : à 12, l'heure 3 redevient un angle mort.
    expect(await lib.blindSpots(filtres(`app=${MATRICE}`), 12)).toHaveLength(2);
  });

  it("deux apps avec /checkout : deux couples, une ligne par heure et par couple", async () => {
    const f = filtres("", { role: "viewer", apps: [PANIER_A, PANIER_B] });
    const couples = await lib.correlationRoutes(f);
    expect(couples).toEqual([
      { app_id: PANIER_A, route: "/checkout" },
      { app_id: PANIER_B, route: "/checkout" },
    ]);
    // L'ancien lien `serie=/checkout` désigne deux couples : il est ignoré.
    expect(lireSerie("/checkout", couples)).toBeNull();

    const a = await lib.correlationSeries(PANIER_A, "/checkout", f);
    expect(a.map((r) => r.bucket.getTime())).toEqual([heure(0).getTime(), heure(2).getTime()]);
    expect(a.every((r) => Number(r.rum_lcp_p75) === 1500 && r.rum_lcp_n === 30 && r.syn_state === "ok")).toBe(true);
    const b = await lib.correlationSeries(PANIER_B, "/checkout", f);
    expect(b.map((r) => Number(r.rum_lcp_p75))).toEqual([5000, 5000]);
  });

  it("heure vide : absente de la série, donc `null` une fois alignée sur la grille horaire", async () => {
    const serie = await lib.correlationSeries(PANIER_A, "/checkout", filtres(`app=${PANIER_A}`));
    // Alignement de la page (§ 5.7.3) : clé = début de seau ; `alignerSeaux` (F04) le fera.
    const grille = bucketStarts({ from: heure(0).toISOString(), to: heure(3).toISOString(), bucketSeconds: 3600 });
    const parSeau = new Map(serie.map((r) => [r.bucket.getTime(), r]));
    const lignes = grille.map((t) => parSeau.get(t) ?? null);
    expect(lignes.map((l) => (l ? Number(l.rum_lcp_p75) : null))).toEqual([1500, null, 1500]);
  });

  it("série d'une app hors périmètre : 0 ligne, même avec la bonne route", async () => {
    expect(await lib.correlationSeries(PANIER_B, "/checkout", filtres(`app=${PANIER_A}`))).toEqual([]);
  });

  it("robot arrêté : `dernier` ancien, intervalle médian de 15 min, bandeau de retard", async () => {
    const [fr] = await lib.syntheticFreshness(filtres(`app=${ARRET}`));
    expect(fr.app_id).toBe(ARRET);
    expect(fr.dernier!.getTime()).toBe(TO.getTime() - 3 * H);
    // Deux scénarios au même instant : l'intervalle se mesure par scénario, pas 0.
    expect(fr.intervalle_median_s).toBe(900);
    expect(fr.passages).toBe(2 * ((72 - 3) * 4 + 1));
    expect(retardRobot(fr, TO.getTime())).toEqual({ etat: "en_retard", retardMs: 3 * H, intervalleMs: 900_000 });
  });

  it("périmètre explicite : une app sans passage rend `dernier = null`, jamais une absence muette", async () => {
    const lignes = await lib.syntheticFreshness(filtres("", { role: "viewer", apps: [ARRET, SANS_ROBOT] }));
    expect(lignes.map((l) => l.app_id)).toEqual([ARRET, SANS_ROBOT]);
    expect(lignes[1]).toEqual({ app_id: SANS_ROBOT, dernier: null, intervalle_median_s: null, passages: 0 });
    expect(retardRobot(lignes[1], TO.getTime())).toEqual({ etat: "aucun_passage" });
  });

  it("période précédente : même lecture sur `previousRange`", async () => {
    // Plage [h4, h8) : rien ; sa précédente [h0, h4) porte les quatre heures du plan.
    const q = requete(`app=${MATRICE}&from=${heure(4).toISOString()}&to=${heure(8).toISOString()}`);
    const courante = await lib.correlationConcordance(lib.filtersOfQuery(q));
    expect(courante.cellules.every((x) => x.heures === 0)).toBe(true);
    const precedente = await lib.correlationConcordance(lib.filtersOfQuery({ ...q, range: previousRange(q.range) }));
    expect(cellule(precedente, "ok", "poor")).toBe(1);
    expect(precedente.reelInsuffisant).toBe(1);
  });

  it("apps = [] : aucune ligne, dans aucune lecture", async () => {
    const vide = lib.filtersOfQuery({
      ...requete(`app=${MATRICE}`),
      scope: { requestedApp: MATRICE, authorizedApps: [MATRICE], effectiveApps: [] },
    });
    expect(await lib.correlationCards(vide)).toEqual([]);
    expect(await lib.correlationRoutes(vide)).toEqual([]);
    expect(await lib.correlationSeries(MATRICE, "/accueil", vide)).toEqual([]);
    expect(await lib.blindSpots(vide)).toEqual([]);
    expect(await lib.syntheticFreshness(vide)).toEqual([]);
    const conc = await lib.correlationConcordance(vide);
    expect(conc.cellules.every((x) => x.heures === 0)).toBe(true);
    expect([conc.robotSeul, conc.reelSeul, conc.reelInsuffisant, conc.robotInconnu]).toEqual([0, 0, 0, 0]);
    expect(conc.anglesMortsParRoute).toEqual([]);
  });

  it("GET /api/v1/correlation : chaque champ historique est toujours rendu, avec son type", async () => {
    // Les deux lectures de la route d'API : leurs lignes gardent tous les champs
    // documentés ; F57 n'en ajoute que (rum_lcp_n, syn_measures), jamais n'en retire.
    const [carte] = await lib.correlationCards(filtres(`app=${MATRICE}`));
    expect(carte).toMatchObject({
      app_id: MATRICE,
      route: "/accueil",
      rum_lcp_p75: expect.any(Number),
      rum_inp_p75: null,
      rum_sessions: 1,
      syn_latency_avg: 800,
      syn_score_avg: 90,
      syn_state: "incident",
      syn_measures: "Parcours",
      rum_lcp_n: 30 * 3 + 12,
    });
    const [angle] = await lib.blindSpots(filtres(`app=${MATRICE}`));
    expect(angle).toMatchObject({
      app_id: MATRICE,
      route: "/accueil",
      bucket: heure(1),
      rum_lcp_p75: 4500,
      syn_latency_avg: 800,
      syn_state: "ok",
      gap_ms: 3700,
      rum_lcp_n: 30,
      syn_measures: "Parcours",
    });
  });
});
