// F62 — lectures SLO et alertes, exécutées sur PostgreSQL.
//
// L'histogramme des déclenchements était calculé EN MÉMOIRE sur les 100 derniers
// événements : au-delà, les jours anciens disparaissaient sans le dire. Ici, 150
// événements sur 30 jours doivent donner 150 — et `alertEvents`, qui garde sa
// liste des 100 derniers, en rend 100.
//
// Livraison (définition v49) : `delivered` = 2xx observé, `sent` = requête acceptée
// par pg_net, résultat en attente. Un événement « non livré » n'a NI l'un NI
// l'autre : un événement en attente n'y est pas compté.
//
// Deux bases :
//   SQL_TEST_DATABASE_URL=<base jetable> SQL_TEST_V68_DATABASE_URL=<autre base jetable> pnpm test:sql
// la seconde est remise à zéro et migrée jusqu'à v72 : console publiée avant la
// migration-v73 (sans table des notifications d'issue).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Filters } from "../../apps/console/lib/filters";
import { parseAnalyticsQuery, type AnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const urlSansV73 = process.env.SQL_TEST_V68_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const A = "f62-app-a";
const B = "f62-app-b";
const C = "f62-app-c";
const APPS = [A, B, C];
const SEVERITES = ["critical", "warning", "info"];

function fichiersSql(maxVersion = Number.POSITIVE_INFINITY): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f) && version(f) <= maxVersion)
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

async function nettoyer(c: pg.Client, v73 = true): Promise<void> {
  // Une issue supprimée emporte sa notification, qui emporte son événement (v73).
  if (v73) await c.query("delete from error_issue where app_id = any($1::text[])", [APPS]);
  await c.query("delete from alert_event where message like 'f62-%'");
  await c.query("delete from alert_rule where app_id = any($1::text[])", [APPS]);
  await c.query("delete from slo where app_id = any($1::text[])", [APPS]);
  await c.query("delete from app_registry where app_id = any($1::text[])", [APPS]);
}

/** Un événement à `heures` heures avant maintenant, et ses livraisons. */
async function evenement(
  c: pg.Client,
  source: { rule?: number; slo?: number },
  heures: number,
  severity: string,
  livraisons: string[] = [],
): Promise<number> {
  const {
    rows: [{ id }],
  } = await c.query<{ id: string }>(
    `insert into alert_event (rule_id, slo_id, value, message, severity, fired_at)
     values ($1, $2, 1, 'f62-evenement', $3, now() - $4::float8 * interval '1 hour') returning id`,
    [source.rule ?? null, source.slo ?? null, severity, heures],
  );
  for (const status of livraisons) {
    await c.query("insert into alert_delivery (alert_event_id, target, status) values ($1, 'https://hook.test', $2)", [id, status]);
  }
  return Number(id);
}

async function regle(c: pg.Client, app: string, metric: string, route: string | null): Promise<number> {
  const {
    rows: [{ id }],
  } = await c.query<{ id: string }>(
    `insert into alert_rule (app_id, metric, route, comparator, threshold, window_minutes, mode, severity)
     values ($1, $2, $3, '>', 2500, 15, 'threshold', 'critical') returning id`,
    [app, metric, route],
  );
  return Number(id);
}

async function slo(c: pg.Client, app: string, name: string): Promise<number> {
  const {
    rows: [{ id }],
  } = await c.query<{ id: string }>(
    `insert into slo (app_id, name, metric, objective, window_days, route)
     values ($1, $2, 'LCP', 0.9, 28, '/checkout') returning id`,
    [app, name],
  );
  return Number(id);
}

/** Livraisons par rang : livrée, en attente, échouée, échouée puis livrée, aucune. */
const LIVRAISONS = [["delivered"], ["sent"], ["failed"], ["failed", "delivered"], []];

/** Modules console branchés sur une base jetable (cf. query-contract-sql). */
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

function requete(qs: string, principal: ScopePrincipal = { role: "admin", apps: null }): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: Date.now() });
  if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}

/** Jour UTC à `decalage` jours d'aujourd'hui, `AAAA-MM-JJ`. */
const jourUtc = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);

(url ? describe : describe.skip)("F62 — lectures SLO et alertes sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;
  let regleA: number;
  let sloA: number;
  let issueA: string;
  let evenementIssue: number;
  let orphelin: number;
  const filtres = (qs: string, principal?: ScopePrincipal): Filters => lib.filtersOfQuery(requete(qs, principal));

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await c.query(
      `insert into app_registry (app_id, name, active, internal)
       select a, a, true, false from unnest($1::text[]) a on conflict (app_id) do nothing`,
      [APPS],
    );
    regleA = await regle(c, A, "LCP", "/checkout");
    sloA = await slo(c, A, "LCP bon sur /checkout");
    const regleB = await regle(c, B, "INP", null);

    // 150 événements de A sur ~28 jours : règle et SLO en alternance, trois
    // sévérités, cinq états de livraison ; le dernier vient d'une issue (v73).
    for (let k = 0; k < 149; k++) {
      await evenement(c, k % 2 === 0 ? { rule: regleA } : { slo: sloA }, k * 4.5, SEVERITES[k % 3], LIVRAISONS[k % 5]);
    }
    const {
      rows: [issue],
    } = await c.query<{ id: string }>(
      `insert into error_issue (app_id, grouping_version, grouping_key, grouping_basis, origin, first_seen, last_seen)
       values ($1, 2, repeat('f', 32), 'normalized_frame', 'new', now(), now()) returning id`,
      [A],
    );
    issueA = issue.id;
    evenementIssue = await evenement(c, {}, 149 * 4.5, SEVERITES[149 % 3], LIVRAISONS[149 % 5]);
    // Le déclencheur v73 a créé la notification ; on la relie à son événement.
    await c.query(
      `update error_issue_notification set alert_event_id = $1, state = 'delivered', delivered_at = now()
        where app_id = $2 and issue_id = $3`,
      [evenementIssue, A, issueA],
    );
    // Hors fenêtre : 31 jours.
    await evenement(c, { rule: regleA }, 31 * 24, "critical");
    // B : cinq déclenchements.
    for (let k = 0; k < 5; k++) await evenement(c, { rule: regleB }, k, "warning");
    // « Nouvelle erreur » de check_new_errors : ni règle, ni SLO, ni issue.
    orphelin = await evenement(c, {}, 2, "warning");
    lib = await consoleSur(url!);
  }, 300_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  it("150 événements sur 30 j : la somme des barres vaut 150, pas 100", async () => {
    const f = filtres(`app=${A}`);
    const parJour = await lib.alertEventsByDay(f);
    expect(parJour.reduce((s, r) => s + r.n, 0)).toBe(150);
    // 30 jours UTC, aujourd'hui compris, chaque sévérité chaque jour (jours vides à 0).
    const jours = [...new Set(parJour.map((r) => r.jour))];
    expect(jours).toHaveLength(30);
    expect(jours[0]).toBe(jourUtc(-29));
    expect(jours[29]).toBe(jourUtc(0));
    expect(parJour).toHaveLength(30 * 3);
    expect(parJour.some((r) => r.n === 0)).toBe(true);
    for (const severity of SEVERITES) {
      expect(parJour.filter((r) => r.severity === severity).reduce((s, r) => s + r.n, 0), severity).toBe(50);
    }
    // La liste historique reste les 100 derniers.
    expect(await lib.alertEvents(f)).toHaveLength(100);
  });

  it("non livrés sur 30 j : ni livrée ni en attente — un événement en attente n'est pas compté", async () => {
    const parJour = await lib.alertEventsByDay(filtres(`app=${A}`));
    // Rangs 2 (échouée) et 4 (aucune) sur 5 : 60 sur 150 ; le rang 1 (« sent ») n'y est pas.
    expect(lib.totalNonLivres(parJour)).toBe(60);

    await c.query("insert into app_registry (app_id, name, active, internal) values ($1, $1, true, false) on conflict do nothing", [C]);
    const regleC = await regle(c, C, "LCP", null);
    await evenement(c, { rule: regleC }, 1, "warning", ["sent"]);
    const enAttente = await lib.alertEventsByDay(filtres(`app=${C}`));
    expect(enAttente.reduce((s, r) => s + r.n, 0)).toBe(1);
    expect(lib.totalNonLivres(enAttente)).toBe(0);
    await evenement(c, { rule: regleC }, 1, "warning", ["failed"]);
    expect(lib.totalNonLivres(await lib.alertEventsByDay(filtres(`app=${C}`)))).toBe(1);
  });

  it("alertEvents rend slo_id : un déclenchement de SLO se relie à son SLO", async () => {
    const evenements = await lib.alertEvents(filtres(`app=${A}`));
    const deSlo = evenements.filter((e) => e.slo_id !== null);
    expect(deSlo.length).toBeGreaterThan(0);
    expect(deSlo.every((e) => e.slo_id === sloA && e.rule_id === null)).toBe(true);
    expect(evenements.filter((e) => e.rule_id !== null).every((e) => e.slo_id === null)).toBe(true);
  });

  it("alertFirings : une ligne par déclenchement de la fenêtre, source et libellé de piste", async () => {
    const { lignes, tronque } = await lib.alertFirings(filtres(`app=${A}`));
    expect(tronque).toBe(false);
    expect(lignes).toHaveLength(150);
    const parSource = (s: string) => lignes.filter((l) => l.source === s);
    expect(parSource("regle")).toHaveLength(75);
    expect(parSource("slo")).toHaveLength(74);
    expect(parSource("issue")).toEqual([
      expect.objectContaining({ source_id: issueA, libelle: `Issue ${issueA.slice(0, 8)}`, event_id: evenementIssue }),
    ]);
    expect(parSource("regle")[0]).toMatchObject({ source_id: String(regleA), libelle: "LCP (ms) · /checkout" });
    expect(parSource("slo")[0]).toMatchObject({ source_id: String(sloA), libelle: "LCP bon sur /checkout" });
    // Les plus récents d'abord ; livraison et acquittement rendus.
    const instants = lignes.map((l) => l.fired_at.getTime());
    expect([...instants].sort((a, b) => b - a)).toEqual(instants);
    expect(lignes[0]).toMatchObject({ delivered: 1, pending: 0, acknowledged: false, severity: "critical" });
    expect(lignes[1]).toMatchObject({ delivered: 0, pending: 1 });
  });

  it("alertFirings : au-delà du plafond, les plus récents et `tronque`", async () => {
    const tout = await lib.alertFirings(filtres(`app=${A}`));
    const { lignes, tronque } = await lib.alertFirings(filtres(`app=${A}`), 30, 100);
    expect(tronque).toBe(true);
    expect(lignes).toHaveLength(100);
    expect(lignes.map((l) => l.event_id)).toEqual(tout.lignes.slice(0, 100).map((l) => l.event_id));
    // Fenêtre de 7 jours : seulement les déclenchements des 7 derniers jours UTC.
    const semaine = await lib.alertFirings(filtres(`app=${A}`), 7);
    const debut = Date.parse(`${jourUtc(-6)}T00:00:00Z`);
    expect(semaine.lignes.length).toBeGreaterThan(0);
    expect(semaine.lignes.every((l) => l.fired_at.getTime() >= debut)).toBe(true);
    expect(semaine.lignes.length).toBe(tout.lignes.filter((l) => l.fired_at.getTime() >= debut).length);
  });

  it("la « nouvelle erreur » sans source a sa piste sous « toutes les apps », jamais sous une app", async () => {
    const tout = await lib.alertFirings(filtres(""));
    expect(tout.lignes.find((l) => l.event_id === orphelin)).toMatchObject({
      source: "nouvelle_erreur",
      source_id: "nouvelles-erreurs",
    });
    expect((await lib.alertFirings(filtres(`app=${A}`))).lignes.some((l) => l.event_id === orphelin)).toBe(false);
  });

  it("périmètre : un viewer de B ne compte que B ; apps = [] ne rend aucun déclenchement", async () => {
    const deB = await lib.alertEventsByDay(filtres("", { role: "viewer", apps: [B] }));
    expect(deB.reduce((s, r) => s + r.n, 0)).toBe(5);
    expect((await lib.alertFirings(filtres("", { role: "viewer", apps: [B] }))).lignes).toHaveLength(5);

    const vide = lib.filtersOfQuery({
      ...requete(`app=${A}`),
      scope: { requestedApp: A, authorizedApps: [A], effectiveApps: [] },
    });
    const parJour = await lib.alertEventsByDay(vide);
    expect(parJour).toHaveLength(90);
    expect(parJour.every((r) => r.n === 0 && r.non_livres === 0)).toBe(true);
    expect(await lib.alertFirings(vide)).toEqual({ lignes: [], tronque: false });
  });

  it("une fenêtre ou un plafond absurde est refusé avant toute requête", async () => {
    await expect(lib.alertEventsByDay(filtres(`app=${A}`), 0)).rejects.toThrow(/fenêtre de jours invalide/);
    await expect(lib.alertFirings(filtres(`app=${A}`), 30, 0)).rejects.toThrow(/plafond invalide/);
  });
});

// ═════════════ Fenêtre de déploiement : console publiée avant migration-v73 ═════════════

(urlSansV73 ? describe : describe.skip)("F62 — lectures d'alertes sur une base sans migration-v73", () => {
  const c = new pg.Client(urlSansV73 ? { connectionString: urlSansV73 } : {});
  let lib: Console;
  let regleA: number;
  let sloA: number;

  beforeAll(async () => {
    await c.connect();
    // Base dédiée aux anciens schémas : repartir de zéro garantit qu'aucun rejeu
    // précédent n'y a laissé v73.
    await c.query("drop schema public cascade; create schema public;");
    for (const file of fichiersSql(72)) await c.query(readFileSync(file, "utf8"));
    const { rows } = await c.query("select to_regclass('public.error_issue_notification') is null as sans_v73");
    expect(rows[0].sans_v73).toBe(true);
    await c.query("insert into app_registry (app_id, name, active, internal) values ($1, 'A', true, false)", [A]);
    regleA = await regle(c, A, "LCP", "/checkout");
    sloA = await slo(c, A, "SLO sans v73");
    await evenement(c, { rule: regleA }, 1, "critical", ["sent"]);
    await evenement(c, { slo: sloA }, 30, "warning");
    lib = await consoleSur(urlSansV73!);
  }, 300_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c, false);
    await c.end();
  });

  it("aucune erreur : même garde `to_regclass` que alertEvents, sources règle et SLO", async () => {
    const f = lib.filtersOfQuery(requete(`app=${A}`));
    const parJour = await lib.alertEventsByDay(f);
    expect(parJour.reduce((s, r) => s + r.n, 0)).toBe(2);
    expect(lib.totalNonLivres(parJour)).toBe(1);
    const { lignes } = await lib.alertFirings(f);
    expect(lignes.map((l) => l.source)).toEqual(["regle", "slo"]);
    const evenements = await lib.alertEvents(f);
    expect(evenements.map((e) => e.slo_id)).toEqual([null, sloA]);
    expect(await lib.unackedAlertCount(f)).toBe(2);
  });
});
