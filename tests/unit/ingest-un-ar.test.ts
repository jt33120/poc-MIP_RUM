// Migration-v109 — garde-fous SANS base de l'écriture en un aller-retour.
//
// 1. LES COLONNES. `mip_ingerer_lot_v1` écrit des listes de colonnes figées à sa
//    création ; l'ancien chemin les calcule (`colonnesInsert`, `colonnesErreur`…).
//    Une colonne ajoutée côté JavaScript sans nouvelle version de la fonction se
//    perdrait EN SILENCE sur le nouveau chemin : ce test la fait échouer.
// 2. L'ENCODAGE. Chaque valeur part comme `pg` l'aurait envoyée ; les champs
//    `__x` disent ce que les barrières et la consolidation des vitals lisent.
// 3. LE DRAPEAU. Toute valeur qui n'est pas un entier de 0 à 100 vaut 0.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import { colonnesUnAR } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error module JS sans déclarations
import { encoderLot, lirePourcentage } from "../../packages/backend/lib/ingest-un-ar.mjs";

const SQL = readFileSync(join(__dirname, "..", "..", "packages", "db", "sql", "migration-v109.sql"), "utf8");
const corps = SQL.slice(SQL.indexOf("create or replace function mip_ingerer_lot_v1"), SQL.indexOf("comment on function mip_ingerer_lot_v1"));

/** Colonnes de chaque `insert into <table> (…)` de la fonction. */
function insertsDeLaFonction(): Map<string, string[][]> {
  const parTable = new Map<string, string[][]>();
  for (const m of corps.matchAll(/insert into (\w+)\s*\(([^)]*)\)/g)) {
    const cols = m[2].split(",").map((c) => c.trim()).filter(Boolean);
    parTable.set(m[1], [...(parTable.get(m[1]) ?? []), cols]);
  }
  return parTable;
}

const TABLES: Record<string, string> = {
  rum_log: "log",
  rum_session: "session",
  rum_pageview: "pageview",
  rum_metric: "metrique",
  rum_action: "action",
  rum_error: "erreur",
  rum_resource: "resource",
  rum_longtask: "longtask",
  rum_breadcrumb: "breadcrumb",
  rum_event: "evenement",
  rum_span: "span",
  rum_event_index: "index",
  mobile_capabilities: "capacite",
};

describe("migration-v109 — la fonction écrit les colonnes de l'ancien chemin", () => {
  const inserts = insertsDeLaFonction();
  const colonnes = colonnesUnAR() as Record<string, string[]>;

  it("chaque table du lot a son INSERT, et aucune autre", () => {
    expect([...inserts.keys()].sort()).toEqual(Object.keys(TABLES).sort());
  });

  for (const [table, cle] of Object.entries(TABLES)) {
    it(`${table} : mêmes colonnes que le chemin historique au schéma complet`, () => {
      for (const cols of inserts.get(table) ?? []) {
        expect([...cols].sort(), table).toEqual([...colonnes[cle]].sort());
        // Chaque colonne est relue dans la ligne encodée (`r->>'col'`).
        for (const c of cols) expect(corps, `${table}.${c}`).toContain(`r->>'${c}'`);
      }
    });
  }
});

describe("migration-v109 — encodage d'un lot", () => {
  const colonnes = colonnesUnAR();

  it("une valeur part comme un paramètre `pg` : texte, Date locale, JSON sérialisé, moitié de paire remplacée", () => {
    const ts = new Date(Date.UTC(2026, 9, 6, 10, 0, 0, 123));
    const lot = encoderLot({
      sessions: [{ session_id: "s1", app_id: "a", last_seen_at: ts, is_bot: false, sample_rate: 0.5, context: { plan: "pro" }, user_agent: "x\uD800y" }],
      pageviews: [],
    }, colonnes);
    const s = lot.sessions[0];
    expect(s.started_at).toBe(s.last_seen_at);
    expect(new Date(s.last_seen_at).getTime()).toBe(ts.getTime());
    expect(s.is_bot).toBe("false");
    expect(s.sample_rate).toBe("0.5");
    expect(s.page_count).toBe("0");
    expect(s.context).toBe('{"plan":"pro"}');
    expect(s.user_agent).toBe("x�y");
    expect(s.__app).toBe("a");
    expect(s.__s).toBe("s1");
    expect(lot.pageviews).toEqual([]);
    expect(lot).not.toHaveProperty("logs");
  });

  it("les sujets de barrière ne sont que des chaînes non vides, comme dans `filtrerLot`", () => {
    const lot = encoderLot({ events: [{ app_id: "a", session_id: 12, visitor_id: "", user_id_hash: "h", span_id: "x" }] }, colonnes);
    const e = lot.events[0];
    expect(e.session_id).toBe("12");
    expect(e).not.toHaveProperty("__s");
    expect(e).not.toHaveProperty("__v");
    expect(e.__u).toBe("h");
  });

  it("vitals : clé de consolidation et span natif seulement avec un `webvital.id`, valeur comparée en nombre", () => {
    const lot = encoderLot({
      metrics: [
        { app_id: "a", session_id: "s", name: "CLS", metric_uid: "u1", span_id: "ABCDEF0123456789", value: 0.1 },
        { app_id: "a", session_id: "s", name: "FCP", metric_uid: null, span_id: "abcdef0123456780", value: Number.NaN },
      ],
    }, colonnes);
    expect(JSON.parse(lot.metrics[0].__mk)).toEqual(["a", "s", "CLS", "u1"]);
    expect(lot.metrics[0].__ns).toBe("abcdef0123456789");
    expect(lot.metrics[0].__mv).toBe(0.1);
    expect(lot.metrics[1]).not.toHaveProperty("__mk");
    expect(lot.metrics[1]).not.toHaveProperty("__ns");
    expect(lot.metrics[1].__mv).toBeNull();
    expect(lot.metrics[1].value).toBe("NaN");
  });

  it("une revendication de session : cherchée si c'est une chaîne, sinon la session reste vide", () => {
    const lot = encoderLot({ errors: [
      { app_id: "a", span_id: "1", session_claim: "s" },
      { app_id: "a", span_id: "2", session_claim: 7 },
      { app_id: "a", span_id: "3" },
    ] }, colonnes);
    expect(lot.errors[0].__claim).toBe("s");
    expect(lot.errors[1].__claim_nul).toBe(true);
    expect(lot.errors[2]).not.toHaveProperty("__claim");
    expect(lot.errors[2].context).toBe("{}");
  });
});

describe("migration-v109 — le banc sait mesurer le nouveau chemin", () => {
  it("la sonde reconnaît l'appel unique, et l'analyse compte sa tenue", async () => {
    // @ts-expect-error module JS sans déclarations
    const { analyser, etiquette } = await import("../../scripts/bench/sonde-pg.mjs");
    expect(etiquette("select mip_ingerer_lot_v1($1::text[], $2::jsonb, $3::jsonb) as r")).toBe("select mip_ingerer_lot_v1()");
    const lot = { debut: 0, verrouDebut: 0, verrouFin: 92, fin: 100, requetes: 1, unAR: true, issue: "commit", genres: ["select mip_ingerer_lot_v1()"] };
    const r = analyser({ lots: [lot], horsTransaction: [{ t: 0, genre: "select rate_check()" }] }, { depuis: 0, jusqua: 1000 });
    expect(r.lots).toBe(1);
    expect(r.tenuMs.p50).toBe(8);
    expect(r.allersRetoursParLot.dansTransaction.p50).toBe(1);
    expect(r.allersRetoursParLot.horsTransaction).toBe(1);
  });
});

describe("migration-v109 — le drapeau", () => {
  it("un entier de 0 à 100, sinon 0 (le chemin historique)", () => {
    expect(lirePourcentage("0")).toBe(0);
    expect(lirePourcentage("37")).toBe(37);
    expect(lirePourcentage("100")).toBe(100);
    for (const v of [undefined, null, "", "101", "-1", "10%", " 5", "05", "1e2"]) expect(lirePourcentage(v)).toBe(0);
  });
});
