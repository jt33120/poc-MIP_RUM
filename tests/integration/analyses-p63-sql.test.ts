// P6.3 — les analyses prêtes à l'emploi, exécutées sur PostgreSQL.
//
// Les tests unitaires verrouillent les décisions (onglet proposable, cible d'un
// lien, définition d'un taux) ; seul PostgreSQL dit que les requêtes comptent les
// bonnes lignes. La population est construite pour que chaque affirmation ait son
// contre-exemple dans la même base :
//
//   · deux navigateurs, deux systèmes, deux pays, deux releases, et des lignes
//     SANS dimension — « Inconnu » doit rester un groupe à part ;
//   · une session qui traverse un déploiement, pour que la release par occurrence
//     se distingue de la release de session ;
//   · une ressource de l'app A servie par un hôte déclaré de l'app B, pour que
//     l'allowlist d'un tenant ne classe pas les ressources d'un autre ;
//   · des blocages LoAF ET Long Tasks, qui ne doivent jamais être additionnés ;
//   · des sessions commencées avant la fenêtre, et une encore active à sa fin.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Filters } from "../../apps/console/lib/filters";
import { parseAnalyticsQuery, type AnalyticsQuery } from "../../apps/console/lib/query-contract";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");

const A = "p63-app-a";
const B = "p63-app-b";
const APPS = [A, B];

// Fenêtre de recette : une heure pleine terminée, pour que `to` ne soit jamais futur.
const TO = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
const FROM = new Date(TO.getTime() - 3_600_000);
const T = (minutes: number) => new Date(FROM.getTime() + minutes * 60_000);
const AVANT = new Date(FROM.getTime() - 60_000);

function fichiersSql(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return [
    "schema.sql",
    ...readdirSync(SQL_DIR)
      .filter((f) => /^migration-v\d+\.sql$/.test(f))
      .sort((a, b) => version(a) - version(b)),
  ].map((f) => join(SQL_DIR, f));
}

const TABLES = [
  "rum_error",
  "rum_event_index",
  "rum_event",
  "rum_action",
  "rum_longtask",
  "rum_resource",
  "rum_metric",
  "rum_pageview",
  "rum_session",
  "app_registry",
];

async function nettoyer(c: pg.Client): Promise<void> {
  for (const table of TABLES) await c.query(`delete from ${table} where app_id = any($1::text[])`, [APPS]);
}

const hex = (prefixe: string, i: number, taille: number) => (prefixe + i.toString(16).padStart(4, "0")).padEnd(taille, "0");

interface Semence {
  id: string;
  app: string;
  browser: string | null;
  os: string | null;
  pays: string | null;
  device: string;
  /** Release DE SESSION : la première vue, jamais réécrite. */
  releaseSession: string | null;
  debut: Date;
  fin: Date;
  vues: number;
  visiteur: string | null;
  bot?: boolean;
}

// Six sessions humaines de A, une de B. « a-inconnu » n'a ni navigateur, ni
// système, ni pays : c'est le contre-exemple de chaque découpage.
const SESSIONS: Semence[] = [
  { id: "p63-a-1", app: A, browser: "Chrome", os: "Windows", pays: "FR", device: "desktop", releaseSession: "1.0.0", debut: T(1), fin: T(11), vues: 3, visiteur: "p63-v1" },
  { id: "p63-a-2", app: A, browser: "Chrome", os: "macOS", pays: "FR", device: "desktop", releaseSession: "1.0.0", debut: T(2), fin: T(4), vues: 1, visiteur: "p63-v1" },
  { id: "p63-a-3", app: A, browser: "Firefox", os: "Windows", pays: "DE", device: "mobile", releaseSession: "1.0.0", debut: T(3), fin: T(3), vues: 1, visiteur: "p63-v2" },
  { id: "p63-a-4", app: A, browser: null, os: null, pays: null, device: "desktop", releaseSession: null, debut: T(5), fin: T(25), vues: 2, visiteur: null },
  // Session à cheval sur un déploiement : ouverte en 1.0.0, ses dernières vues
  // sont en 2.0.0. C'est elle qui distingue les deux lectures de release.
  { id: "p63-a-pont", app: A, browser: "Chrome", os: "Windows", pays: "FR", device: "desktop", releaseSession: "1.0.0", debut: T(6), fin: T(28), vues: 2, visiteur: "p63-v3" },
  // Encore active à la fin de la fenêtre : sa durée n'est pas finie.
  { id: "p63-a-active", app: A, browser: "Chrome", os: "Windows", pays: "FR", device: "desktop", releaseSession: "2.0.0", debut: T(50), fin: T(59), vues: 1, visiteur: "p63-v4" },
  { id: "p63-b-1", app: B, browser: "Safari", os: "iOS", pays: "FR", device: "mobile", releaseSession: "9.9.9", debut: T(7), fin: T(8), vues: 1, visiteur: "p63-v9" },
];

// Session commencée AVANT la fenêtre mais revue dedans : dans la liste, hors de
// l'engagement (qui ne compte que les sessions commencées dans la fenêtre).
const AVANT_FENETRE: Semence = {
  id: "p63-a-avant",
  app: A,
  browser: "Chrome",
  os: "Windows",
  pays: "FR",
  device: "desktop",
  releaseSession: "1.0.0",
  debut: AVANT,
  fin: T(10),
  vues: 4,
  visiteur: "p63-v5",
};

async function semer(c: pg.Client): Promise<void> {
  await c.query(
    `insert into app_registry (app_id, name, active, internal, allowed_origins)
     values ($1, 'A', true, false, array['https://app-a.example.fr', 'http://localhost:8080']),
            ($2, 'B', true, false, array['https://app-b.example.fr'])
     on conflict (app_id) do update set active = true, allowed_origins = excluded.allowed_origins`,
    [A, B],
  );

  const toutes = [...SESSIONS, AVANT_FENETRE];
  for (const s of toutes) {
    await c.query(
      `insert into rum_session (session_id, app_id, device_type, browser, os, geo_country, is_bot, visitor_id,
                                release, client_id, collection_source, started_at, last_seen_at, page_count,
                                sample_rate, error_sample_rate)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'mip', 'sdk', $10, $11, $12, 1, 1)
       on conflict (session_id) do update set last_seen_at = excluded.last_seen_at`,
      [s.id, s.app, s.device, s.browser, s.os, s.pays, s.bot === true, s.visiteur, s.releaseSession, s.debut, s.fin, s.vues],
    );
  }

  // Vues, mesures et erreurs portent la release DE L'ÉVÉNEMENT. La session pont
  // en émet sous les deux versions.
  let n = 0;
  const vue = async (s: Semence, route: string, release: string | null, ts: Date) => {
    await c.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, release, started_at) values ($1, $2, $3, $4, $5, $6)`,
      [hex("bb", n++, 16), s.id, s.app, route, release, ts],
    );
  };
  const mesure = async (s: Semence, nom: string, valeur: number, route: string, release: string | null, ts: Date) => {
    await c.query(
      `insert into rum_metric (span_id, session_id, app_id, route, release, name, value, rating, ts)
       values ($1, $2, $3, $4, $5, $6, $7, 'good', $8)`,
      [hex("cc", n++, 16), s.id, s.app, route, release, nom, valeur, ts],
    );
  };

  for (const s of SESSIONS) {
    const release = s.id === "p63-a-pont" ? "1.0.0" : s.releaseSession;
    await vue(s, "/accueil", release, s.debut);
    await mesure(s, "LCP", 1000, "/accueil", release, s.debut);
    await mesure(s, "INP", 100, "/accueil", release, s.debut);
    await mesure(s, "CLS", 0.05, "/accueil", release, s.debut);
    // Une mesure hors des trois vitals affichés : elle ne doit pas gonfler
    // l'échantillon du découpage.
    await mesure(s, "TTFB", 300, "/accueil", release, s.debut);
  }
  // La session pont bascule en 2.0.0 : une vue, un LCP et une erreur de plus.
  const pont = SESSIONS.find((s) => s.id === "p63-a-pont")!;
  await vue(pont, "/panier", "2.0.0", T(27));
  await mesure(pont, "LCP", 4000, "/panier", "2.0.0", T(27));
  // Une session de A sans release sur ses mesures : le groupe « non renseignée ».
  const inconnue = SESSIONS.find((s) => s.id === "p63-a-4")!;
  await vue(inconnue, "/panier", null, T(6));
  await mesure(inconnue, "LCP", 2500, "/panier", null, T(6));

  // Erreurs : une répétée (occurrences = 5) et une unique, deux signatures.
  const erreur = async (s: Semence, fingerprint: string, route: string, release: string | null, occurrences: number, ts: Date) => {
    await c.query(
      `insert into rum_error (app_id, session_id, fingerprint, error_type, message, kind, route, release, occurrences, ts)
       values ($1, $2, $3, 'TypeError', 'boom', 'error', $4, $5, $6, $7)`,
      [s.app, s.id, fingerprint, route, release, occurrences, ts],
    );
  };
  await erreur(SESSIONS[0], "p63fp1", "/accueil", "1.0.0", 5, T(9));
  await erreur(SESSIONS[2], "p63fp2", "/accueil", "1.0.0", 1, T(9));
  await erreur(pont, "p63fp1", "/panier", "2.0.0", 2, T(27));
  // Erreur backend : aucune session rattachée, une release quand même.
  await c.query(
    `insert into rum_error (app_id, session_id, fingerprint, error_type, message, kind, route, release, occurrences, ts)
     values ($1, null, 'p63fp3', 'ValueError', 'serveur', 'error', null, '2.0.0', 3, $2)`,
    [A, T(9)],
  );

  // Ressources : deux hôtes déclarés de A, un hôte tiers, un hôte déclaré de B
  // (tiers vu de A), et une URL sans hôte lisible.
  const ressource = async (app: string, session: string, urlRes: string, type: string, duree: number, taille: number) => {
    await c.query(
      `insert into rum_resource (span_id, session_id, app_id, route, url, type, duration_ms, transfer_size, ts)
       values ($1, $2, $3, '/accueil', $4, $5, $6, $7, $8)`,
      [hex("dd", n++, 16), session, app, urlRes, type, duree, taille, T(12)],
    );
  };
  await ressource(A, "p63-a-1", "https://app-a.example.fr/bundle.js", "script", 900, 120_000);
  await ressource(A, "p63-a-1", "https://APP-A.example.fr:443/vendor.js", "script", 500, 80_000);
  await ressource(A, "p63-a-2", "https://cdn.tiers.net/police.woff2", "font", 1200, 30_000);
  await ressource(A, "p63-a-2", "https://app-b.example.fr/widget.js", "script", 300, 10_000);
  await ressource(A, "p63-a-3", "/relatif/sans-hote.css", "link", 200, 5_000);
  await ressource(B, "p63-b-1", "https://app-b.example.fr/b.js", "script", 400, 20_000);

  // Blocages : LoAF, Long Tasks et une ligne antérieure à la distinction.
  const blocage = async (session: string, app: string, source: string | null, blocking: number, ts: Date, script?: string) => {
    await c.query(
      `insert into rum_longtask (span_id, session_id, app_id, route, duration_ms, source, blocking_ms, script_url, script_function, ts)
       values ($1, $2, $3, '/accueil', $4::float8, $5, $4::real, $6, $7, $8)`,
      [hex("ee", n++, 16), session, app, blocking, source, script ?? null, script ? "recalculer" : null, ts],
    );
  };
  await blocage("p63-a-1", A, "loaf", 380, T(13), "https://app-a.example.fr/panier.js");
  await blocage("p63-a-1", A, "loaf", 90, T(13));
  await blocage("p63-a-3", A, "longtask", 120, T(14));
  await blocage("p63-a-4", A, null, 60, T(15));
  await blocage("p63-b-1", B, "loaf", 999, T(13));
}

/** Modules console branchés sur la base jetable (cf. query-contract-sql). */
async function consoleSur(databaseUrl: string) {
  delete (globalThis as { pgPool?: unknown }).pgPool;
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const queries = await import("../../apps/console/lib/queries");
  const breakdowns = await import("../../apps/console/lib/queries-breakdowns");
  const resources = await import("../../apps/console/lib/queries-resources");
  const longtasks = await import("../../apps/console/lib/queries-longtasks");
  const sessions = await import("../../apps/console/lib/queries-sessions");
  const deploys = await import("../../apps/console/lib/queries-deploys");
  const recherche = await import("../../apps/console/lib/sessions-search");
  const filters = await import("../../apps/console/lib/filters");
  const schema = await import("../../apps/console/lib/query-schema");
  const { pool } = await import("../../apps/console/lib/db");
  return { ...queries, ...breakdowns, ...resources, ...longtasks, ...sessions, ...deploys, ...recherche, ...filters, ...schema, pool };
}
type Console = Awaited<ReturnType<typeof consoleSur>>;

(url ? describe : describe.skip)("analyses prêtes à l'emploi P6.3 sur PostgreSQL", () => {
  const c = new pg.Client(url ? { connectionString: url } : {});
  let lib: Console;

  const requete = (qs: string): AnalyticsQuery => {
    const params = new URLSearchParams(qs);
    params.set("from", FROM.toISOString());
    params.set("to", TO.toISOString());
    const parsed = parseAnalyticsQuery(params, { principal: { role: "admin", apps: null }, nowMs: Date.now() });
    if (!parsed.ok) throw new Error(`${parsed.error.code} — ${parsed.error.message}`);
    return parsed.value;
  };
  const filtres = (qs: string): Filters => lib.filtersOfQuery(requete(qs));

  beforeAll(async () => {
    await c.connect();
    for (const file of fichiersSql()) await c.query(readFileSync(file, "utf8"));
    await nettoyer(c);
    await semer(c);
    lib = await consoleSur(url!);
    lib.forgetDimensionSchema();
  }, 180_000);

  afterAll(async () => {
    await lib?.pool.end();
    await nettoyer(c);
    await c.end();
  });

  // ──────────────────────────── Découpages ──────────────────────────────────

  describe("découpage des Web Vitals", () => {
    it("compte les trois vitals affichés, et eux seuls", async () => {
      const { rows } = await lib.vitalsBreakdown(filtres(`app=${A}`), "browser");
      const chrome = rows.find((r) => r.valeur === "Chrome")!;
      // 4 sessions Chrome × 3 vitals, plus le LCP que la session pont émet sous
      // 2.0.0 : le TTFB semé, lui, n'entre pas dans l'échantillon.
      expect(chrome.samples).toBe(13);
      expect(chrome.lcp_n + chrome.inp_n + chrome.cls_n).toBe(chrome.samples);
    });

    it("« Inconnu » est un groupe null, jamais une chaîne", async () => {
      const { rows } = await lib.vitalsBreakdown(filtres(`app=${A}`), "browser");
      const inconnu = rows.find((r) => r.valeur === null)!;
      expect(inconnu).toBeDefined();
      expect(inconnu.samples).toBe(4);
      expect(rows.some((r) => r.valeur === "Inconnu")).toBe(false);
    });

    it("rend un p75 par vital, et null quand le vital manque", async () => {
      const { rows } = await lib.vitalsBreakdown(filtres(`app=${A}`), "route");
      const panier = rows.find((r) => r.valeur === "/panier")!;
      // /panier ne porte que des LCP : INP et CLS n'y ont aucun échantillon.
      expect(Number(panier.lcp_p75)).toBeGreaterThan(0);
      expect(panier.inp_p75).toBeNull();
      expect(panier.cls_p75).toBeNull();
    });

    it("groupe par la release DE LA MESURE, pas par celle de la session", async () => {
      const { rows } = await lib.vitalsBreakdown(filtres(`app=${A}`), "release");
      const deux = rows.find((r) => r.valeur === "2.0.0")!;
      // La session pont a démarré en 1.0.0 : sa mesure de /panier compte pourtant en 2.0.0.
      expect(deux.samples).toBe(4);
      expect(rows.find((r) => r.valeur === null)!.samples).toBe(4);
    });

    it("dit le nombre RÉEL de groupes, et signale la troncature", async () => {
      const complet = await lib.vitalsBreakdown(filtres(`app=${A}`), "os");
      expect(complet.groups).toBe(3); // Windows, macOS, Inconnu
      expect(complet.truncated).toBe(false);
      const coupe = await lib.vitalsBreakdown(filtres(`app=${A}`), "os", 1);
      expect(coupe.rows).toHaveLength(1);
      expect(coupe.groups).toBe(3);
      expect(coupe.truncated).toBe(true);
    });

    it("le découpage respecte le périmètre d'apps et les filtres du contrat", async () => {
      const b = await lib.vitalsBreakdown(filtres(`app=${B}`), "browser");
      expect(b.rows.map((r) => r.valeur)).toEqual(["Safari"]);
      const mobile = await lib.vitalsBreakdown(filtres(`app=${A}&device=mobile`), "browser");
      expect(mobile.rows.map((r) => r.valeur)).toEqual(["Firefox"]);
    });

    it("un drill-down rend exactement le groupe cliqué", async () => {
      const tout = await lib.vitalsBreakdown(filtres(`app=${A}`), "browser");
      const firefox = tout.rows.find((r) => r.valeur === "Firefox")!;
      const filtre = await lib.vitalsBreakdown(filtres(`app=${A}&browser=Firefox`), "browser");
      expect(filtre.rows).toHaveLength(1);
      expect(filtre.rows[0].samples).toBe(firefox.samples);
    });

    it("le drill-down « Inconnu » se compile en is null", async () => {
      const filtre = await lib.vitalsBreakdown(filtres(`app=${A}&seg=v2:browser:is_null`), "route");
      expect(filtre.rows.reduce((s, r) => s + r.samples, 0)).toBe(4);
    });
  });

  describe("découpage des erreurs", () => {
    it("somme les occurrences, ne compte pas les lignes", async () => {
      const { rows } = await lib.errorsBreakdown(filtres(`app=${A}`), "release");
      const une = rows.find((r) => r.valeur === "1.0.0")!;
      expect(Number(une.occurrences)).toBe(6); // 5 + 1, sur deux lignes
      expect(une.signatures).toBe(2);
      const deux = rows.find((r) => r.valeur === "2.0.0")!;
      expect(Number(deux.occurrences)).toBe(5); // 2 (pont) + 3 (backend)
    });

    it("les sessions touchées ne comptent pas l'erreur backend sans session", async () => {
      const { rows } = await lib.errorsBreakdown(filtres(`app=${A}`), "release");
      const deux = rows.find((r) => r.valeur === "2.0.0")!;
      expect(deux.sessions).toBe(1);
    });

    it("découpe par les dimensions de session que les erreurs portent", async () => {
      const { rows } = await lib.errorsBreakdown(filtres(`app=${A}`), "browser");
      expect(rows.find((r) => r.valeur === "Chrome")!.occurrences).toBe(7);
      expect(rows.find((r) => r.valeur === "Firefox")!.occurrences).toBe(1);
      // L'erreur backend n'a pas de session : elle est « Inconnu », pas Chrome.
      expect(rows.find((r) => r.valeur === null)!.occurrences).toBe(3);
    });
  });

  // ──────────────────────────── Ressources ──────────────────────────────────

  describe("ressources", () => {
    it("classe première/tierce partie sur les origines DÉCLARÉES de l'app", async () => {
      const vue = await lib.resourcesVue(filtres(`app=${A}`));
      const part = (p: string) => vue.parParty.find((ligne) => ligne.party === p)?.n ?? 0;
      expect(part("first")).toBe(2); // app-a.example.fr, port et casse compris
      expect(part("third")).toBe(2); // cdn.tiers.net et app-b.example.fr
      expect(part("unknown")).toBe(1); // URL sans hôte lisible
      expect(vue.partageCalculable).toBe(true);
    });

    it("l'allowlist d'un tenant ne classe pas les ressources d'un autre", async () => {
      // Vue « toutes apps » : la ressource de B servie par son propre domaine
      // reste première partie, alors que la même URL vue de A est tierce.
      const vue = await lib.resourcesVue(filtres(""));
      const b = vue.parOrigine.filter((ligne) => ligne.cle === "app-b.example.fr");
      expect(b.map((ligne) => ligne.party).sort()).toEqual(["first", "third"]);
    });

    it("rend durée p75 et octets par type, bornés et comptés", async () => {
      const vue = await lib.resourcesVue(filtres(`app=${A}`));
      const script = vue.parType.find((ligne) => ligne.cle === "script")!;
      expect(script.n).toBe(3);
      expect(Number(script.p75_ms)).toBeGreaterThan(0);
      expect(Number(script.octets)).toBe(210_000);
      expect(vue.total).toBe(5);
    });

    it("le plafond est visible : les groupes réels sont comptés", async () => {
      const vue = await lib.resourcesVue(filtres(`app=${A}`), 1);
      expect(vue.parOrigine).toHaveLength(1);
      expect(vue.originesTotal).toBe(4);
      expect(vue.originesTronquees).toBe(true);
      // Le partage, lui, n'est jamais tronqué : il porte sur toute la population.
      expect(vue.parParty.reduce((s, ligne) => s + ligne.n, 0)).toBe(5);
    });

    it("sans origine déclarée, aucune ressource n'est dite tierce", async () => {
      await c.query(`update app_registry set allowed_origins = '{}' where app_id = $1`, [A]);
      try {
        const vue = await lib.resourcesVue(filtres(`app=${A}`));
        expect(vue.parParty.map((ligne) => ligne.party)).toEqual(["unknown"]);
        expect(vue.partageCalculable).toBe(false);
      } finally {
        await c.query(
          `update app_registry set allowed_origins = array['https://app-a.example.fr', 'http://localhost:8080'] where app_id = $1`,
          [A],
        );
      }
    });
  });

  // ───────────────────────── Blocages du fil principal ──────────────────────

  describe("tâches longues et LoAF", () => {
    it("garde les deux API séparées et ne les additionne pas", async () => {
      const serie = await lib.longtaskSeries(filtres(`app=${A}`));
      const total = (cle: "loaf" | "longtask" | "inconnu") => serie.reduce((s, point) => s + point[cle], 0);
      expect(total("loaf")).toBe(2);
      expect(total("longtask")).toBe(1);
      expect(total("inconnu")).toBe(1);
    });

    it("remplit les seaux vides de zéros, sans p75 inventé", async () => {
      const serie = await lib.longtaskSeries(filtres(`app=${A}`));
      expect(serie.length).toBeGreaterThan(1);
      const vides = serie.filter((point) => point.loaf + point.longtask + point.inconnu === 0);
      expect(vides.length).toBeGreaterThan(0);
      for (const point of vides) expect(point.p75_ms).toBeNull();
    });

    it("les pires blocages portent leur session, celle de la MÊME app", async () => {
      const pires = await lib.worstLongtasks(filtres(`app=${A}`), 3);
      expect(pires[0].blocking_ms).toBe(380);
      expect(pires[0].session_id).toBe("p63-a-1");
      expect(pires.every((ligne) => ligne.session_id?.startsWith("p63-a-"))).toBe(true);
      // Le blocage de 999 ms appartient à B : il n'entre pas dans la vue de A.
      expect(pires.some((ligne) => ligne.blocking_ms === 999)).toBe(false);
    });

    it("nomme ce qui a bloqué, même sans attribution", async () => {
      const pires = await lib.worstLongtasks(filtres(`app=${A}`), 10);
      expect(pires.find((ligne) => ligne.blocking_ms === 90)!.quoi).toContain("frame longue");
      expect(pires.find((ligne) => ligne.blocking_ms === 120)!.quoi).toContain("tâche longue");
    });
  });

  // ────────────────────── Engagement et visiteurs observés ──────────────────

  describe("durée observée et sessions à une vue", () => {
    it("ne compte que les sessions COMMENCÉES dans la fenêtre", async () => {
      const stats = await lib.engagementStats(filtres(`app=${A}`));
      expect(stats.sessions_started).toBe(6); // la session ouverte avant la fenêtre est exclue
      expect(stats.sessions_with_view).toBe(6);
    });

    it("single_view_session_rate = sessions à une vue / sessions à au moins une vue", async () => {
      const stats = await lib.engagementStats(filtres(`app=${A}`));
      expect(stats.single_view_sessions).toBe(3); // a-2, a-3, a-active
      expect(stats.single_view_sessions / stats.sessions_with_view).toBeCloseTo(0.5);
    });

    it("signale les sessions encore actives à la fin de la fenêtre", async () => {
      const stats = await lib.engagementStats(filtres(`app=${A}`));
      expect(stats.still_active).toBe(1);
    });

    it("session_duration_observed = dernière observation − première, jamais négative", async () => {
      const stats = await lib.engagementStats(filtres(`app=${A}`));
      // Durées semées : 600, 120, 0, 1200, 1440, 540 s → médiane 570.
      expect(Number(stats.duration_p50_s)).toBeCloseTo(570, 0);
      expect(Number(stats.duration_p75_s)).toBeGreaterThanOrEqual(Number(stats.duration_p50_s));
    });

    it("tendance des visiteurs : des distincts par seau, jamais une somme", async () => {
      const serie = await lib.observedVisitorsTrend(filtres(`app=${A}`));
      const sessions = serie.reduce((s, point) => s + point.sessions, 0);
      expect(sessions).toBe(6);
      // v1 ouvre deux sessions dans le même seau : un visiteur, pas deux.
      const premier = serie.find((point) => point.sessions > 0)!;
      expect(premier.visitors).toBeLessThan(premier.sessions);
      expect(serie.reduce((s, point) => s + point.sans_identifiant, 0)).toBe(1);
    });
  });

  // ─────────────────── Recherche et pagination des sessions ─────────────────

  describe("recherche et pagination des sessions", () => {
    it("trouve une session par son identifiant technique exact", async () => {
      const rows = await lib.listSessions(filtres(`app=${A}`), { search: { field: "session", value: "p63-a-3" } });
      expect(rows.map((r) => r.session_id)).toEqual(["p63-a-3"]);
    });

    it("ne trouve rien sur un préfixe : l'égalité est stricte", async () => {
      const rows = await lib.listSessions(filtres(`app=${A}`), { search: { field: "session", value: "p63-a" } });
      expect(rows).toHaveLength(0);
    });

    it("trouve les sessions ayant vu une route normalisée", async () => {
      const rows = await lib.listSessions(filtres(`app=${A}`), { search: { field: "route", value: "/panier" } });
      expect(rows.map((r) => r.session_id).sort()).toEqual(["p63-a-4", "p63-a-pont"]);
    });

    it("cherche la release PAR OCCURRENCE : la session pont sort sur les deux", async () => {
      expect(await lib.releaseRechercheParOccurrence()).toBe(true);
      const une = await lib.listSessions(filtres(`app=${A}`), { search: { field: "release", value: "1.0.0" } });
      const deux = await lib.listSessions(filtres(`app=${A}`), { search: { field: "release", value: "2.0.0" } });
      expect(une.map((r) => r.session_id)).toContain("p63-a-pont");
      expect(deux.map((r) => r.session_id).sort()).toEqual(["p63-a-active", "p63-a-pont"]);
    });

    it("pagine par clé stable : aucune ligne répétée ni sautée", async () => {
      const page1 = await lib.listSessions(filtres(`app=${A}`), { limit: 3 });
      expect(page1).toHaveLength(3);
      const curseur = lib.parseSessionCursor(
        lib.encodeSessionCursor({ cursor_ts: page1[2].cursor_ts, session_id: page1[2].session_id }),
      );
      expect(curseur).not.toBeUndefined();
      const page2 = await lib.listSessions(filtres(`app=${A}`), { limit: 3, cursor: curseur! });
      const ids = [...page1, ...page2].map((r) => r.session_id);
      expect(new Set(ids).size).toBe(ids.length);
      // La suite reprend strictement après la dernière ligne de la page 1.
      expect(page2.every((r) => r.last_seen_at <= page1[2].last_seen_at)).toBe(true);
    });

    it("une session vue entre deux pages ne décale pas la pagination", async () => {
      const page1 = await lib.listSessions(filtres(`app=${A}`), { limit: 2 });
      const curseur = lib.parseSessionCursor(
        lib.encodeSessionCursor({ cursor_ts: page1[1].cursor_ts, session_id: page1[1].session_id }),
      )!;
      // Une session ancienne remonte en tête : avec un OFFSET, la page 2 aurait
      // sauté une ligne. Avec la clé, elle reprend au même endroit.
      await c.query(`update rum_session set last_seen_at = $2 where session_id = $1`, ["p63-a-2", TO]);
      try {
        const page2 = await lib.listSessions(filtres(`app=${A}`), { limit: 2, cursor: curseur });
        expect(page2.map((r) => r.session_id)).not.toContain(page1[0].session_id);
        expect(page2.map((r) => r.session_id)).not.toContain(page1[1].session_id);
      } finally {
        await c.query(`update rum_session set last_seen_at = $2 where session_id = $1`, ["p63-a-2", T(4)]);
      }
    });

    it("la recherche reste bornée par le périmètre d'apps", async () => {
      const rows = await lib.listSessions(filtres(`app=${A}`), { search: { field: "session", value: "p63-b-1" } });
      expect(rows).toHaveLength(0);
    });
  });

  // ───────────────────── Comparaison de versions par occurrence ─────────────

  describe("comparaison des versions", () => {
    it("lit la release de chaque mesure, pas celle de la session", async () => {
      const { rows, source } = await lib.comparaisonVersions(filtres(`app=${A}`));
      expect(source).toBe("occurrence");
      const versions = Object.fromEntries(rows.map((r) => [r.version, r]));
      // La session pont a commencé en 1.0.0 : elle compte AUSSI en 2.0.0.
      expect(versions["2.0.0"].sessions).toBe(2); // a-active + a-pont
      expect(versions["1.0.0"].sessions).toBe(4);
      expect(versions["2.0.0"].lcp).not.toBeNull();
    });

    it("les erreurs sont attribuées à la release de l'occurrence", async () => {
      const { rows } = await lib.comparaisonVersions(filtres(`app=${A}`));
      const versions = Object.fromEntries(rows.map((r) => [r.version, r]));
      expect(versions["2.0.0"].erreurs).toBe(5);
      expect(versions["2.0.0"].sessionsEnErreur).toBe(1);
      expect(versions["1.0.0"].erreurs).toBe(6);
    });

    it("les mesures sans release forment leur propre groupe", async () => {
      const { rows } = await lib.comparaisonVersions(filtres(`app=${A}`));
      expect(rows.some((r) => r.version === "(non renseignée)")).toBe(true);
    });
  });
});
