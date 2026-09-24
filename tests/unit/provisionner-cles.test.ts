// R8a — `scripts/ops/provisionner-cles.mjs` : ce qui se vérifie sans base.
//
// Le point dur est l'ALGORITHME : une clé provisionnée ici doit passer la
// vérification du collector (`createPgAuth.checkApiKey`) sous
// REQUIRE_API_KEY=true, sinon on aurait « provisionné » six apps pour les
// couper en 403 le jour où le drapeau passe. On le prouve en faisant vérifier
// la clé par le VRAI `createPgAuth`, pas en recopiant un sha256.
// La preuve sur Postgres (dry-run puis --appliquer) est dans le README du
// collector et dans le compte rendu de P2.
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM partagé, sans déclarations
import { createPgAuth } from "../../packages/backend/lib/pg-ingest.mjs";
// @ts-expect-error script d'exploitation, sans déclarations
import { empreinteCle, genererCle, lireArguments, provisionner } from "../../scripts/ops/provisionner-cles.mjs";

type Ligne = { app_id: string; active: boolean; api_key_hash: string | null };

/** Faux pool : un `app_registry` en mémoire, et les écritures enregistrées. */
function registre(lignes: Ligne[], { concurrent = [] as string[] } = {}) {
  const ecrites: Array<{ text: string; params?: unknown[] }> = [];
  const query = async (text: string, params: unknown[] = []) => {
    ecrites.push({ text, params });
    if (/^select app_id, active from app_registry/.test(text.trim())) {
      const filtre = params[0] as string[] | null;
      return {
        rows: lignes
          .filter((l) => l.api_key_hash == null && (!filtre || filtre.includes(l.app_id)))
          .map(({ app_id, active }) => ({ app_id, active })),
      };
    }
    if (text.startsWith("update app_registry")) {
      const [app, hash] = params as [string, string];
      const l = lignes.find((x) => x.app_id === app);
      // Une app provisionnée « entre-temps » par quelqu'un d'autre.
      if (concurrent.includes(app) && l) l.api_key_hash = "deja-la";
      if (!l || l.api_key_hash != null) return { rowCount: 0, rows: [] };
      l.api_key_hash = hash;
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) }, ecrites, lignes };
}

const ecritures = (ecrites: Array<{ text: string }>) =>
  ecrites.filter((q) => /^(update|insert)/.test(q.text)).map((q) => q.text.split(" ").slice(0, 2).join(" "));

describe("format et empreinte", () => {
  it("le format de la console : mip_ + 32 hex", () => {
    expect(genererCle()).toMatch(/^mip_[0-9a-f]{32}$/);
    expect(genererCle()).not.toBe(genererCle());
  });

  it("une clé provisionnée PASSE la vérification réelle du collector sous REQUIRE_API_KEY", async () => {
    const cle = genererCle();
    const pool = {
      query: async () => ({
        rows: [{ app_id: "gip-plateforme", api_key_hash: empreinteCle(cle), active: true, allowed_origins: [], ingestion_suspended_at: null }],
      }),
    };
    const auth = createPgAuth(pool, { requireApiKey: true });
    expect(await auth.checkApiKey("gip-plateforme", cle)).toBeNull();
    expect(await auth.checkApiKey("gip-plateforme", genererCle())).toMatch(/invalid api key/);
    expect(await auth.checkApiKey("gip-plateforme", null)).toMatch(/invalid api key/);
  });
});

describe("arguments", () => {
  it("--dry-run par défaut ; --appliquer écrit ; --app restreint (répétable)", () => {
    expect(lireArguments([])).toEqual({ appliquer: false, apps: [] });
    expect(lireArguments(["--appliquer", "--app", "a", "--app", "b"])).toEqual({ appliquer: true, apps: ["a", "b"] });
    expect(lireArguments(["--appliquer", "--dry-run"])).toEqual({ appliquer: false, apps: [] });
  });

  it("un argument inconnu est une erreur, jamais un mode par défaut", () => {
    expect(() => lireArguments(["--apply"])).toThrow(/argument inconnu/);
    expect(() => lireArguments(["--app"])).toThrow(/argument inconnu/);
  });
});

describe("provisionner", () => {
  const initial = (): Ligne[] => [
    { app_id: "a-sans-cle", active: true, api_key_hash: null },
    { app_id: "b-sans-cle", active: true, api_key_hash: null },
    { app_id: "c-avec-cle", active: true, api_key_hash: "x".repeat(64) },
    { app_id: "d-inactive", active: false, api_key_hash: null },
  ];

  it("dry-run : liste les actives sans clé, met les inactives à part, n'écrit RIEN", async () => {
    const { pool, ecrites } = registre(initial());
    const bilan = await provisionner(pool, {});
    expect(bilan).toEqual({ cibles: ["a-sans-cle", "b-sans-cle"], inactives: ["d-inactive"], cles: [], deja: [] });
    expect(ecritures(ecrites)).toEqual([]);
  });

  it("--appliquer : une clé par app active sans clé, l'empreinte en base, un audit par app", async () => {
    const { pool, ecrites, lignes } = registre(initial());
    const bilan = await provisionner(pool, { appliquer: true });
    expect(bilan.cles.map((c: any) => c.app_id)).toEqual(["a-sans-cle", "b-sans-cle"]);
    for (const { app_id, cle } of bilan.cles) {
      expect(lignes.find((l) => l.app_id === app_id)?.api_key_hash).toBe(empreinteCle(cle));
      // La clé en clair n'est JAMAIS écrite en base (seule l'empreinte l'est).
      expect(JSON.stringify(ecrites)).not.toContain(cle);
    }
    expect(lignes.find((l) => l.app_id === "c-avec-cle")?.api_key_hash).toBe("x".repeat(64));
    expect(lignes.find((l) => l.app_id === "d-inactive")?.api_key_hash).toBeNull();
    expect(ecrites.map((q) => q.text).filter((t) => t === "begin" || t === "commit")).toEqual(["begin", "commit"]);
    expect(ecritures(ecrites)).toEqual(["update app_registry", "insert into", "update app_registry", "insert into"]);
  });

  it("--app restreint la cible", async () => {
    const { pool } = registre(initial());
    const bilan = await provisionner(pool, { appliquer: true, apps: ["b-sans-cle"] });
    expect(bilan.cles.map((c: any) => c.app_id)).toEqual(["b-sans-cle"]);
  });

  it("une app provisionnée entre la lecture et l'écriture n'est PAS écrasée", async () => {
    const { pool, lignes } = registre(initial(), { concurrent: ["a-sans-cle"] });
    const bilan = await provisionner(pool, { appliquer: true });
    expect(bilan.deja).toEqual(["a-sans-cle"]);
    expect(bilan.cles.map((c: any) => c.app_id)).toEqual(["b-sans-cle"]);
    expect(lignes.find((l) => l.app_id === "a-sans-cle")?.api_key_hash).toBe("deja-la");
  });

  it("rejouer après coup ne fait rien : plus aucune cible", async () => {
    const { pool } = registre(initial());
    await provisionner(pool, { appliquer: true });
    const second = await provisionner(pool, { appliquer: true });
    expect(second).toMatchObject({ cibles: [], cles: [] });
  });
});
