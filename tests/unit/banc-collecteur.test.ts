// P2 — banc du collector : on teste ce qui fait les CHIFFRES de la porte
// go/no-go, sans base ni réseau.
//
//   - la sonde client (`scripts/bench/sonde-pg.mjs`) : c'est elle qui dit
//     « tenue du verrou », « utilisation » et « allers-retours par lot ». Une
//     erreur d'horodatage ou de découpage de transaction ferait mentir le
//     rapport sans rien faire échouer ; on la joue donc sur un faux `pg` dont
//     on maîtrise chaque réponse ;
//   - l'échantillonneur serveur (`pg_locks`), seule lecture possible sur staging ;
//   - les arrivées de la boucle ouverte de `load-bench.mjs` (débit IMPOSÉ) ;
//   - les identifiants et la clé d'un lot de banc, validés par le vrai parser.
import { describe, expect, it } from "vitest";
import { analyser, etiquette, installerSonde } from "../../scripts/bench/sonde-pg.mjs";
import { resumer, SQL_ECHANTILLON } from "../../scripts/bench/echantillonner-verrou.mjs";
import { arrivalTimes, buildPayload, prng } from "../../scripts/load-bench.mjs";
import { VERROU_INGESTION_NS } from "../../packages/backend/lib/privacy-barriere.mjs";
import { flattenOtlp, isNativeSpanId } from "../../packages/backend/shared/otlp.mjs";

/** Un faux module `pg` : chaque requête répond après `delai(texte)` ms. */
function fauxPg(delai: (texte: string) => number) {
  class Client {
    query(config: string | { text: string }, values?: unknown, callback?: unknown) {
      const texte = typeof config === "string" ? config : config.text;
      const cb = typeof values === "function" ? values : callback;
      const fini = new Promise((r) => setTimeout(() => r({ rows: [] }), delai(texte)));
      if (typeof cb === "function") {
        fini.then((res) => (cb as (e: unknown, r: unknown) => void)(null, res));
        return undefined;
      }
      return fini;
    }
  }
  return { Client };
}

describe("etiquette — ce qui compose un lot", () => {
  it("nomme les étapes d'une transaction d'ingestion", () => {
    expect(etiquette("begin")).toBe("begin");
    expect(etiquette("  COMMIT ")).toBe("commit");
    expect(etiquette("set local lock_timeout = '1500ms'")).toBe("set local");
    expect(etiquette("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)")).toBe("verrou");
    expect(etiquette("insert into rum_session (session_id) values ($1)")).toBe("insert rum_session");
    expect(etiquette("update rum_session s set page_count = 1")).toBe("update rum_session");
    expect(etiquette("select rate_check($1, $2) as ok")).toBe("select rate_check()");
    expect(etiquette("select subject_kind from privacy_erasure_barrier where app_id = $1")).toBe("select privacy_erasure_barrier");
  });
});

describe("installerSonde — tenue, attente et allers-retours, vus du client", () => {
  it("découpe une transaction verrouillée et compte ses allers-retours ; le hors-transaction à part", async () => {
    const pg = fauxPg((t) => (t.includes("pg_advisory_xact_lock") ? 30 : 5));
    const sonde = installerSonde(pg);
    try {
      const c = new pg.Client();
      await c.query("select rate_check($1, $2) as ok", ["app", 600]);
      await c.query("begin");
      await c.query("set local lock_timeout = '1500ms'");
      await c.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [VERROU_INGESTION_NS, "app"]);
      await c.query("insert into rum_session (session_id) values ($1)", ["s"]);
      // Deux requêtes lancées ensemble : `pg` ne pipeline pas, ce sont DEUX allers-retours.
      await Promise.all([c.query("select 1 from rum_metric", []), c.query("select 2 from rum_metric", [])]);
      // Forme rappel (celle de pg-pool) : chronométrée aussi.
      await new Promise((r) => c.query("commit", (e: unknown, res: unknown) => r(res)));
      const { lots, horsTransaction } = sonde.releve();
      expect(horsTransaction.map((q: { genre: string }) => q.genre)).toEqual(["select rate_check()"]);
      expect(lots).toHaveLength(1);
      const [lot] = lots;
      expect(lot.app).toBe("app");
      expect(lot.issue).toBe("commit");
      expect(lot.requetes).toBe(7); // begin, set, verrou, insert, 2 × select, commit
      expect(lot.genres).toEqual(["begin", "set local", "verrou", "insert rum_session", "select rum_metric", "select rum_metric", "commit"]);
      // Attente vue du client ≈ la réponse du verrou (30 ms) ; tenue = verrou rendu → COMMIT rendu (≈ 3 × 5 ms).
      expect(lot.verrouFin - lot.verrouDebut).toBeGreaterThanOrEqual(28);
      expect(lot.fin - lot.verrouFin).toBeGreaterThanOrEqual(13);
      expect(lot.fin - lot.verrouFin).toBeLessThan(lot.fin - lot.debut);
    } finally {
      sonde.desinstaller();
    }
  });

  it("n'attribue au verrou d'ingestion que SON espace de noms ; une transaction sans lui n'est pas un lot", async () => {
    const pg = fauxPg(() => 1);
    const sonde = installerSonde(pg);
    try {
      const c = new pg.Client();
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock($1::int4, hashtext($2)::int4)", [811_100, "migrate"]);
      await c.query("commit");
      expect(sonde.releve().lots).toHaveLength(0);
      expect(sonde.releve().autres).toBe(1);
    } finally {
      sonde.desinstaller();
    }
  });

  it("ne change ni le résultat ni l'erreur d'une requête", async () => {
    class Client {
      query() {
        return Promise.reject(new Error("55P03"));
      }
    }
    const sonde = installerSonde({ Client });
    try {
      await expect(new Client().query()).rejects.toThrow("55P03");
    } finally {
      sonde.desinstaller();
    }
  });
});

describe("analyser — la lecture de la porte P2", () => {
  const lot = (debut: number, attente: number, tenu: number, requetes = 18) => ({
    debut, verrouDebut: debut + 2, verrouFin: debut + 2 + attente, fin: debut + 2 + attente + tenu,
    requetes, issue: "commit", genres: null, app: "a",
  });

  it("utilisation = tenues cumulées / fenêtre ; attente nette = brute − aller-retour", () => {
    // 10 lots sur 1 s, chacun tient le verrou 30 ms : 300 ms / 1000 ms.
    const lots = Array.from({ length: 10 }, (_, i) => lot(i * 100, 10, 30));
    const r = analyser({ lots, horsTransaction: lots.map((l) => ({ t: l.debut, genre: "select rate_check()" })) },
      { depuis: 0, jusqua: 1000, rttMs: 9 });
    expect(r.lots).toBe(10);
    expect(r.lotsParSeconde).toBe(10);
    expect(r.utilisation).toBeCloseTo(0.3, 5);
    expect(r.tenuMs.p50).toBe(30);
    expect(r.attenteVerrouMs.p50).toBe(10);
    expect(r.attenteVerrouMs.nette_p50).toBe(1);
    expect(r.allersRetoursParLot.dansTransaction.p50).toBe(18);
    expect(r.allersRetoursParLot.horsTransaction).toBe(1);
  });

  it("écarte la sonde d'attente (4 requêtes) et les lots refusés ; rogne la tenue à la fenêtre", () => {
    const lots = [
      lot(0, 0, 50),
      { ...lot(100, 0, 1, 4) }, // sonde de bench-verrou : begin, set, verrou, commit
      { ...lot(200, 1500, 0), verrouFin: null, issue: "rollback" }, // lock_timeout épuisé
      lot(950, 0, 100), // déborde de la fenêtre : 48 ms comptées sur 100
    ];
    const r = analyser({ lots, horsTransaction: [] }, { depuis: 0, jusqua: 1000 });
    expect(r.lots).toBe(2);
    expect(r.refusOuAnnulations).toBe(1);
    expect(r.utilisation).toBeCloseTo((50 + 48) / 1000, 5);
  });
});

describe("echantillonner-verrou — la lecture qui restera sur staging", () => {
  it("utilisation = part des échantillons où le verrou est tenu, dans la fenêtre ; file moyenne et max", () => {
    const e = [
      { t: 0, tenus: 1, enAttente: 0 },
      { t: 10, tenus: 1, enAttente: 2 },
      { t: 20, tenus: 0, enAttente: 0 },
      { t: 30, tenus: 0, enAttente: 0 },
      { t: 99, tenus: 1, enAttente: 5 }, // hors fenêtre
    ];
    const r = resumer(e, { depuis: 0, jusqua: 30 });
    expect(r.echantillons).toBe(4);
    expect(r.utilisation).toBe(0.5);
    expect(r.fileMoyenne).toBe(0.5);
    expect(r.fileMax).toBe(2);
    expect(r.ecartType).toBe(0.25);
    expect(resumer([], {}).utilisation).toBeNull();
  });

  it("vise la clé exacte d'`pg_advisory_xact_lock(int4, int4)` : espace de noms en classid, objid masqué sur 32 bits", () => {
    expect(SQL_ECHANTILLON).toContain("locktype = 'advisory'");
    expect(SQL_ECHANTILLON).toContain("objsubid = 2");
    expect(SQL_ECHANTILLON).toMatch(/hashtext\(\$2\)::int8\) & 4294967295/);
  });
});

describe("load-bench — boucle ouverte et lots de banc", () => {
  it("arrivées uniformes : un métronome exact ; poissonniennes : rejouables à la graine", () => {
    expect(arrivalTimes(2, 2000, { arrivals: "uniform" })).toEqual([500, 1000, 1500, 2000]);
    const a = arrivalTimes(50, 60_000, { rng: prng(7) });
    const b = arrivalTimes(50, 60_000, { rng: prng(7) });
    expect(a).toEqual(b);
    // Loi des grands nombres : ~3 000 arrivées à ±5 %.
    expect(a.length).toBeGreaterThan(2850);
    expect(a.length).toBeLessThan(3150);
    expect(arrivalTimes(0, 1000)).toEqual([]);
  });

  it("identifiants préfixés par le run, hexadécimaux valides, distincts d'un run à l'autre", () => {
    const un = buildPayload(123, { run: 42, errorRate: 0 }).resourceSpans[0].scopeSpans[0].spans;
    const deux = buildPayload(123, { run: 43, errorRate: 0 }).resourceSpans[0].scopeSpans[0].spans;
    for (const s of un) {
      expect(isNativeSpanId(s.spanId)).toBe(true);
      expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(new Set(un.map((s: { spanId: string }) => s.spanId)).size).toBe(un.length);
    expect(un[0].spanId).not.toBe(deux[0].spanId);
  });

  it("clé d'ingestion sur la resource et `webvital.id` comme le SDK (VITAL_IDS=0 : profil d'avant)", () => {
    const rows = flattenOtlp(buildPayload(1, { run: 1, errorRate: 0, apiKey: "mip_cle", app: "banc" }));
    expect(rows.rejected).toBe(0);
    expect(rows.apiKeys).toEqual([{ app_id: "banc", api_key: "mip_cle" }]);
    expect(rows.metrics.every((m: { metric_uid: string | null }) => typeof m.metric_uid === "string")).toBe(true);
    const sans = flattenOtlp(buildPayload(1, { run: 1, errorRate: 0, apiKey: null, vitalIds: false }));
    expect(sans.apiKeys[0].api_key).toBeNull();
    expect(sans.metrics.every((m: { metric_uid: string | null }) => m.metric_uid === null)).toBe(true);
  });
});
