// Signaux d'opt-out navigateur (DNT / GPC) — logique pure.
import { describe, expect, it } from "vitest";
import {
  dntEnabled,
  gpcEnabled,
  readPrivacySignals,
  signalsOptOut,
} from "../../packages/rum-sdk/src/privacy";

describe("dntEnabled", () => {
  it("actif pour \"1\" (standard) et \"yes\" (ancien window.doNotTrack)", () => {
    expect(dntEnabled({ doNotTrack: "1" })).toBe(true);
    expect(dntEnabled({ doNotTrack: "yes" })).toBe(true);
  });
  it("inactif pour \"0\", \"unspecified\", null/absent", () => {
    expect(dntEnabled({ doNotTrack: "0" })).toBe(false);
    expect(dntEnabled({ doNotTrack: "unspecified" })).toBe(false);
    expect(dntEnabled({ doNotTrack: null })).toBe(false);
    expect(dntEnabled({})).toBe(false);
  });
  it("prend le repli msDoNotTrack (IE) si doNotTrack absent", () => {
    expect(dntEnabled({ msDoNotTrack: "1" })).toBe(true);
    expect(dntEnabled({ doNotTrack: null, msDoNotTrack: "1" })).toBe(true);
    expect(dntEnabled({ msDoNotTrack: "0" })).toBe(false);
  });
});

describe("gpcEnabled", () => {
  it("actif uniquement pour true strict", () => {
    expect(gpcEnabled({ globalPrivacyControl: true })).toBe(true);
    expect(gpcEnabled({ globalPrivacyControl: false })).toBe(false);
    expect(gpcEnabled({})).toBe(false);
  });
});

describe("signalsOptOut", () => {
  it("opt-out si DNT OU GPC ; sinon non", () => {
    expect(signalsOptOut({ doNotTrack: "1" })).toBe(true);
    expect(signalsOptOut({ globalPrivacyControl: true })).toBe(true);
    expect(signalsOptOut({ doNotTrack: "1", globalPrivacyControl: false })).toBe(true);
    expect(signalsOptOut({ doNotTrack: "0" })).toBe(false);
    expect(signalsOptOut({})).toBe(false);
  });
});

describe("readPrivacySignals", () => {
  it("hors navigateur (nav undefined) : source neutre", () => {
    expect(signalsOptOut(readPrivacySignals(undefined, undefined))).toBe(false);
  });
  it("fusionne navigator.doNotTrack", () => {
    const nav = { doNotTrack: "1" } as unknown as Navigator;
    expect(signalsOptOut(readPrivacySignals(nav, undefined))).toBe(true);
  });
  it("replie sur window.doNotTrack (ancien Firefox : \"yes\")", () => {
    const nav = { doNotTrack: null } as unknown as Navigator;
    const win = { doNotTrack: "yes" } as unknown as Window;
    expect(signalsOptOut(readPrivacySignals(nav, win))).toBe(true);
  });
  it("lit navigator.globalPrivacyControl", () => {
    const nav = { globalPrivacyControl: true } as unknown as Navigator;
    expect(signalsOptOut(readPrivacySignals(nav, undefined))).toBe(true);
  });
});
