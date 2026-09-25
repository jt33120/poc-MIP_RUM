// C12 — les gardes de M4 : ce qui prouve que la console n'a plus de base.
// Aujourd'hui en relevé (CI, non bloquant) ; la PR de bascule les passe en
// `--strict`. Ce fichier tient leur mécanique : ce qu'elles voient, ce qu'elles
// laissent passer.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error script ESM, sans déclarations
import { gardeEnvironnement, importsInterdits, INTERDITS, specificateurs, traceInterdite } from "../../scripts/ci/console-sans-base.mjs";

describe("console sans base (C12)", () => {
  it("voit les imports statiques, dynamiques, `require` et les réexports ; pas un `import type`", () => {
    const src = `import pg from "pg";
import type { Pool } from "pg";
const m = await import("@mip/backend/lib/pg-ingest.mjs");
const b = require("bcryptjs");
export { x } from "@mip/db/migrate.mjs";
import "./local";`;
    const s = specificateurs(src) as { spec: string; type: boolean }[];
    expect(s.filter((x) => !x.type && INTERDITS.test(x.spec)).map((x) => x.spec)).toEqual([
      "pg",
      "@mip/db/migrate.mjs",
      "@mip/backend/lib/pg-ingest.mjs",
      "bcryptjs",
    ]);
    expect(INTERDITS.test("pg-cursor-maison")).toBe(false);
    expect(INTERDITS.test("@mip/console-contract")).toBe(false);
  });

  it("relève les fichiers d'une arborescence, et ce qu'un traçage de build embarque", () => {
    const racine = mkdtempSync(path.join(tmpdir(), "sans-base-"));
    mkdirSync(path.join(racine, "lib"));
    writeFileSync(path.join(racine, "lib", "db.ts"), 'import { Pool } from "pg";\n');
    writeFileSync(path.join(racine, "lib", "pur.ts"), 'import type { Pool } from "pg";\nimport { x } from "@mip/console-contract";\n');
    expect(importsInterdits(racine)).toEqual(["lib/db.ts → pg"]);

    const next = path.join(racine, ".next");
    mkdirSync(path.join(next, "server", "app"), { recursive: true });
    writeFileSync(path.join(next, "server", "app", "page.js.nft.json"), JSON.stringify({ files: ["../../../node_modules/.pnpm/pg@8.13.0/node_modules/pg/lib/index.js"] }));
    writeFileSync(path.join(next, "server", "app", "vitrine.js.nft.json"), JSON.stringify({ files: ["../../chunks/ui.js"] }));
    expect(traceInterdite(next)).toEqual(["app/page.js.nft.json trace pg"]);
    expect(traceInterdite(path.join(racine, "absent"))).toBeNull();
  });

  it("la garde d'environnement est dans next.config, et refuse une base quand MIP_CONSOLE_SANS_BASE=1", async () => {
    expect(gardeEnvironnement()).toBe(true);
    const avant = { ...process.env };
    try {
      process.env.MIP_CONSOLE_SANS_BASE = "1";
      process.env.DATABASE_URL = "postgres://x";
      const config = (etiquette: string) =>
        import(/* @vite-ignore */ `${pathToFileURL(path.resolve("apps/console/next.config.mjs")).href}?${etiquette}=${Date.now()}`);
      await expect(config("refus")).rejects.toThrow(/DATABASE_URL/);
      delete process.env.DATABASE_URL;
      for (const nom of Object.keys(process.env)) if (/^(PG|POSTGRES_|NEON_|IDENTITY_HASH_SECRET|TICKET_SECRET_KEY|AUTH_SECRET)/.test(nom)) delete process.env[nom];
      await expect(config("passe")).resolves.toBeTruthy();
    } finally {
      for (const nom of Object.keys(process.env)) if (!(nom in avant)) delete process.env[nom];
      Object.assign(process.env, avant);
    }
  });
});
