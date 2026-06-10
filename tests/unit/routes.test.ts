// Normalisation des routes côté SDK (paramètres -> :id).
import { describe, expect, it } from "vitest";
import { normalizeRoute, scrubUrl } from "../../packages/rum-sdk/src/context";

describe("normalizeRoute", () => {
  it.each([
    ["/", "/"],
    ["/partners", "/partners"],
    ["/partners/42", "/partners/:id"],
    ["/partners/42/contracts/7", "/partners/:id/contracts/:id"],
    ["/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890", "/users/:id"],
    ["/files/deadbeefdeadbeef42", "/files/:id"],
    ["/about-us", "/about-us"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeRoute(input)).toBe(expected);
  });
});

describe("scrubUrl — retrait query/fragment (PII)", () => {
  it("retire la query string", () =>
    expect(scrubUrl("https://x.com/p?token=secret")).toBe("https://x.com/p"));
  it("retire le fragment", () =>
    expect(scrubUrl("https://x.com/p#section")).toBe("https://x.com/p"));
});
