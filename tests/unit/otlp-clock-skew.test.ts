// Garde anti-dérive d'horloge (clock skew) dans nanosToDate : les timestamps
// clients hors fenêtre [now-7j, now+5min] retombent sur l'heure de réception.
import { describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans types
import { nanosToDate } from "../../packages/backend/shared/otlp.mjs";

const NOW = 1_700_000_000_000; // référence fixe (ms)
const nanos = (ms: number | bigint) => (BigInt(ms) * 1_000_000n).toString();

describe("nanosToDate — garde anti-dérive d'horloge", () => {
  it("conserve un ts dans la fenêtre valide", () => {
    const ts = NOW - 1000; // il y a 1 s
    expect(nanosToDate(nanos(ts), NOW).getTime()).toBe(ts);
  });

  it("conserve un retry légitime (quelques heures dans le passé)", () => {
    const ts = NOW - 3 * 60 * 60 * 1000; // -3 h
    expect(nanosToDate(nanos(ts), NOW).getTime()).toBe(ts);
  });

  it("ramène un ts futur (> +5 min) à l'heure de réception", () => {
    expect(nanosToDate(nanos(NOW + 10 * 60 * 1000), NOW).getTime()).toBe(NOW);
  });

  it("ramène un ts trop ancien (> 7 j) à l'heure de réception", () => {
    expect(nanosToDate(nanos(NOW - 8 * 24 * 60 * 60 * 1000), NOW).getTime()).toBe(NOW);
  });

  it("tolère les bornes exactes (now+5min et now-7j restent inchangés)", () => {
    expect(nanosToDate(nanos(NOW + 5 * 60 * 1000), NOW).getTime()).toBe(NOW + 5 * 60 * 1000);
    expect(nanosToDate(nanos(NOW - 7 * 24 * 60 * 60 * 1000), NOW).getTime()).toBe(
      NOW - 7 * 24 * 60 * 60 * 1000,
    );
  });

  it("nanos absent ou invalide -> heure de réception", () => {
    expect(nanosToDate(0, NOW).getTime()).toBe(NOW);
    expect(nanosToDate("pas-un-nombre", NOW).getTime()).toBe(NOW);
  });
});
