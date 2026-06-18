// QA-fix #2 — résolution du secret JWT : fail-closed en production.
import { describe, expect, it } from "vitest";
import { resolveAuthSecret } from "../../apps/console/lib/auth";

describe("resolveAuthSecret", () => {
  it("retourne AUTH_SECRET quand présent (prod)", () => {
    expect(resolveAuthSecret({ AUTH_SECRET: "s3cr3t", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("s3cr3t");
  });

  it("retourne AUTH_SECRET quand présent (dev)", () => {
    expect(resolveAuthSecret({ AUTH_SECRET: "s3cr3t", NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("s3cr3t");
  });

  it("LÈVE en production si AUTH_SECRET absent (pas de secret de dev en prod)", () => {
    expect(() => resolveAuthSecret({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/AUTH_SECRET obligatoire/);
  });

  it("tolère l'absence hors production (fallback dev)", () => {
    expect(resolveAuthSecret({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("dev-secret-mip-rum");
  });

  it("AUTH_SECRET vide en production = absent → lève", () => {
    expect(() => resolveAuthSecret({ AUTH_SECRET: "", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow();
  });
});
