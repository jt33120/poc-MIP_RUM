// SVI I0 — routage des spans `svi.*` dans l'ingestion OTLP.
//
// Le point critique tenu par ces tests : la branche svi.* doit être évaluée AVANT
// la branche « span interne », qui capture tout span sans mip.session_id puis
// rejette faute de session. Placée après, elle serait du code mort — aucun appel
// téléphonique n'a de session web. Le test « ne casse pas le routage RUM » garde
// l'autre côté : router le SVI ne doit rien changer aux spans existants.
import { describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs sans types (partagé avec les edge functions)
import { flattenOtlp, numOrNull } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const NS = (ms: number) => String(ms * 1_000_000);
const kv = (k: string, v: unknown) => ({
  key: k,
  value:
    typeof v === "number" ? { doubleValue: v }
    : typeof v === "boolean" ? { boolValue: v }
    : { stringValue: String(v) },
});

function payload(spans: Record<string, unknown>[]) {
  return {
    resourceSpans: [{
      resource: { attributes: [kv("mip.app_id", "app-a")] },
      scopeSpans: [{ spans }],
    }],
  };
}

const CALL = "c-1";
const t0 = Date.UTC(2026, 6, 30, 9, 0, 0);

describe("routage svi.*", () => {
  it("un svi.call est routé vers sviCalls, jamais vers spans", () => {
    const r = flattenOtlp(payload([{
      name: "svi.call", traceId: "a".repeat(32), spanId: "b".repeat(16),
      startTimeUnixNano: NS(t0), endTimeUnixNano: NS(t0 + 1000),
      attributes: [kv("svi.call_id", CALL), kv("svi.platform", "asterisk"),
                   kv("svi.adapter_version", "0.1.0"), kv("svi.status", "closed"),
                   kv("svi.outcome", "contained")],
    }]));
    expect(r.sviCalls).toHaveLength(1);
    expect(r.spans).toHaveLength(0);
    expect(r.sviCalls[0].call_id).toBe(CALL);
    expect(r.sviCalls[0].outcome).toBe("contained");
    expect(r.rejected).toBe(0);
  });

  it("un appel OUVERT n'a jamais d'issue, même si l'émetteur en envoie une", () => {
    const r = flattenOtlp(payload([{
      name: "svi.call", traceId: "a".repeat(32), spanId: "b".repeat(16),
      startTimeUnixNano: NS(t0),
      attributes: [kv("svi.call_id", CALL), kv("svi.status", "open"),
                   kv("svi.outcome", "contained")],
    }]));
    // La contrainte svi_call_outcome_ck refuserait la ligne : on ne la fabrique pas.
    expect(r.sviCalls[0].outcome).toBeNull();
  });

  it("un appel clos sans issue déclarée retombe sur 'failed', pas sur null", () => {
    const r = flattenOtlp(payload([{
      name: "svi.call", traceId: "a".repeat(32), spanId: "b".repeat(16),
      startTimeUnixNano: NS(t0),
      attributes: [kv("svi.call_id", CALL), kv("svi.status", "closed")],
    }]));
    expect(r.sviCalls[0].outcome).toBe("failed");
  });

  it("un nœud de saisie SENSIBLE perd sa longueur côté serveur", () => {
    const r = flattenOtlp(payload([{
      name: "svi.step", traceId: "a".repeat(32), spanId: "b".repeat(16),
      startTimeUnixNano: NS(t0),
      attributes: [kv("svi.call_id", CALL), kv("svi.seq", 3), kv("svi.kind", "input"),
                   kv("svi.input_sensitive", true), kv("svi.input_len", 16),
                   kv("svi.input_class", "digits")],
    }]));
    // On ne fait pas dépendre une garantie PCI de la bonne conduite du client.
    expect(r.sviSteps[0].input_len).toBeNull();
    expect(r.sviSteps[0].input_class).toBe("masked");
  });

  it("une étape non sensible conserve classe et longueur", () => {
    const r = flattenOtlp(payload([{
      name: "svi.step", traceId: "a".repeat(32), spanId: "b".repeat(16),
      startTimeUnixNano: NS(t0),
      attributes: [kv("svi.call_id", CALL), kv("svi.seq", 1), kv("svi.kind", "menu"),
                   kv("svi.input_class", "menu_choice"), kv("svi.input_len", 1)],
    }]));
    expect(r.sviSteps[0].input_class).toBe("menu_choice");
    expect(r.sviSteps[0].input_len).toBe(1);
  });

  it("un tronçon sans méthode de mesure du MOS est REJETÉ", () => {
    const base = {
      name: "svi.leg", traceId: "a".repeat(32), spanId: "b".repeat(16),
      startTimeUnixNano: NS(t0),
    };
    const sans = flattenOtlp(payload([{ ...base,
      attributes: [kv("svi.call_id", CALL), kv("svi.leg_ref", "L1"), kv("svi.dir", "rx"),
                   kv("svi.mos_avg", 4.1)] }]));
    expect(sans.sviLegs).toHaveLength(0);
    expect(sans.rejected).toBe(1);

    const avec = flattenOtlp(payload([{ ...base,
      attributes: [kv("svi.call_id", CALL), kv("svi.leg_ref", "L1"), kv("svi.dir", "rx"),
                   kv("svi.mos_method", "g107_e_model"), kv("svi.mos_avg", 4.1)] }]));
    expect(avec.sviLegs).toHaveLength(1);
    expect(avec.sviLegs[0].mos_avg).toBe(4.1);
  });

  it("sans call_id, la ligne est rejetée — jamais d'orpheline", () => {
    const r = flattenOtlp(payload([{
      name: "svi.call", traceId: "a".repeat(32), spanId: "b".repeat(16),
      startTimeUnixNano: NS(t0), attributes: [kv("svi.platform", "asterisk")],
    }]));
    expect(r.sviCalls).toHaveLength(0);
    expect(r.rejected).toBe(1);
  });

  it("un svi.* inconnu est compté, jamais deviné", () => {
    const r = flattenOtlp(payload([{
      name: "svi.inconnu", traceId: "a".repeat(32), spanId: "b".repeat(16),
      startTimeUnixNano: NS(t0), attributes: [kv("svi.call_id", CALL)],
    }]));
    expect(r.sviCalls).toHaveLength(0);
    expect(r.sviSteps).toHaveLength(0);
    expect(r.sviLegs).toHaveLength(0);
    expect(r.rejected).toBe(1);
  });

  it("ne casse pas le routage RUM : un http.server reste un span back", () => {
    const r = flattenOtlp(payload([
      { name: "http.server", traceId: "a".repeat(32), spanId: "b".repeat(16),
        startTimeUnixNano: NS(t0),
        attributes: [kv("mip.trace_id", "a".repeat(32)), kv("mip.span_id", "b".repeat(16)),
                     kv("http.duration_ms", 12), kv("mip.route", "/x")] },
      { name: "svi.call", traceId: "c".repeat(32), spanId: "d".repeat(16),
        startTimeUnixNano: NS(t0),
        attributes: [kv("svi.call_id", CALL), kv("svi.status", "open")] },
    ]));
    expect(r.spans).toHaveLength(1);
    expect(r.spans[0].tier).toBe("back");
    expect(r.sviCalls).toHaveLength(1);
  });
});

describe("numOrNull", () => {
  it("écarte le vide plutôt que de le convertir en 0", () => {
    // Number("") === 0 et Number(null) === 0 : deux valeurs qui passeraient
    // pour des mesures réelles.
    expect(numOrNull("")).toBeNull();
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull("abc")).toBeNull();
    expect(numOrNull(Number.NaN)).toBeNull();
    expect(numOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it("accepte les nombres et les chaînes numériques", () => {
    expect(numOrNull(0)).toBe(0);
    expect(numOrNull("1200")).toBe(1200);
    expect(numOrNull(4.1)).toBe(4.1);
  });
});
