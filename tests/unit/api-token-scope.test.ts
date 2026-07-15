// Scoping des jetons machine (UTI-D) : parsing du format + périmètre du principal.
import { afterEach, describe, expect, it } from "vitest";
import { authenticateApi, bearerMatches, parseTokenConfig, secretEquals } from "../../apps/console/lib/api/auth";

describe("secretEquals / bearerMatches (comparaison timing-safe)", () => {
  it("secretEquals : vrai seulement si identique", () => {
    expect(secretEquals("s3cr3t", "s3cr3t")).toBe(true);
    expect(secretEquals("s3cr3t", "s3cr3T")).toBe(false);
    expect(secretEquals("court", "beaucoup-plus-long")).toBe(false); // longueurs != -> false
  });
  it("bearerMatches : extrait le token du header et compare", () => {
    expect(bearerMatches("Bearer s3cr3t", "s3cr3t")).toBe(true);
    expect(bearerMatches("bearer s3cr3t", "s3cr3t")).toBe(true); // insensible à la casse du schéma
    expect(bearerMatches("Bearer mauvais", "s3cr3t")).toBe(false);
    expect(bearerMatches("s3cr3t", "s3cr3t")).toBe(false); // pas de préfixe Bearer
    expect(bearerMatches(null, "s3cr3t")).toBe(false);
  });
});

afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
});

describe("parseTokenConfig", () => {
  it("jeton simple = toutes apps (rétro-compatible)", () => {
    expect(parseTokenConfig("secret-a, secret-b")).toEqual([
      { token: "secret-a", apps: null },
      { token: "secret-b", apps: null },
    ]);
  });
  it("jeton scopé token@app1;app2", () => {
    expect(parseTokenConfig("tok@uti")).toEqual([{ token: "tok", apps: ["uti"] }]);
    expect(parseTokenConfig("tok@uti;autre")).toEqual([{ token: "tok", apps: ["uti", "autre"] }]);
  });
  it("mélange simple + scopé, ignore le vide", () => {
    expect(parseTokenConfig(" global , scoped@uti , ")).toEqual([
      { token: "global", apps: null },
      { token: "scoped", apps: ["uti"] },
    ]);
  });
  it("@ sans apps -> null (toutes)", () => {
    expect(parseTokenConfig("tok@")).toEqual([{ token: "tok", apps: null }]);
  });
  it("vide / absent -> []", () => {
    expect(parseTokenConfig("")).toEqual([]);
    expect(parseTokenConfig(undefined)).toEqual([]);
  });
});

describe("authenticateApi — jeton scopé", () => {
  it("jeton simple -> apps null (toutes)", async () => {
    process.env.CONSOLE_API_TOKENS = "global-secret";
    expect(await authenticateApi("Bearer global-secret", null)).toEqual({
      kind: "token",
      role: "viewer",
      apps: null,
      subject: "api-token",
    });
  });
  it("jeton scopé -> apps limitées + subject explicite", async () => {
    process.env.CONSOLE_API_TOKENS = "uti-secret@uti";
    expect(await authenticateApi("Bearer uti-secret", null)).toEqual({
      kind: "token",
      role: "viewer",
      apps: ["uti"],
      subject: "api-token:uti",
    });
  });
  it("jeton inconnu -> null", async () => {
    process.env.CONSOLE_API_TOKENS = "uti-secret@uti";
    expect(await authenticateApi("Bearer autre", null)).toBeNull();
  });
});
