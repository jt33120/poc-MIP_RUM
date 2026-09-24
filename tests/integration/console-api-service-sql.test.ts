// C0a — le service console-api LANCÉ POUR DE VRAI : son bundle, le kit, une base migrée.
//
// Les gardes du pipeline sont prouvées une à une dans `tests/unit/console-api-c0a.test.ts`.
// Ici, ce qui ne se voit qu'en processus :
//
//   · le bundle démarre, les sondes du kit répondent sans secret client, et tout
//     le reste répond 404 NU sans lui ;
//   · la poignée de main se vérifie avec la clé PUBLIQUE seule — ce que fera la
//     console — et annonce l'empreinte du contrat ;
//   · l'état de la plateforme servi est EXACTEMENT celui que lit la console
//     aujourd'hui (`lib/queries-planifie.ts`), sur la même base : C0b pourra
//     débrancher la vitrine de la base sans que rien ne change à l'écran ;
//   · un démarrage refusé l'est en bloc, code 2, sans valeur de secret au journal ;
//   · SIGTERM rend la main, code 0.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { lignesDuContrat, messageDePoignee, OPERATIONS } from "@mip/console-contract";
import { empreinte, verifierSignature } from "@mip/console-api";
// @ts-expect-error module ESM, sans déclarations
import { construire } from "../../services/console-api/build.mjs";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const SECRET = randomBytes(24).toString("hex");

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

async function jeuDeCles(kid: string) {
  const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
  return { keys: [{ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, kid, alg: "ES256", use: "sig" }] };
}

function portLibre(): Promise<number> {
  return new Promise((resoudre) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resoudre(port));
    });
  });
}

const BUNDLE = "services/console-api/dist/server.mjs";

(url ? describe : describe.skip)("C0a — le service console-api, sur PostgreSQL", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 2 } : {});
  let service: ChildProcess;
  let base = "";
  let cles: Awaited<ReturnType<typeof jeuDeCles>>;
  const journalService: string[] = [];

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    // Un témoin à lire : la cadence publiée. Le tick et le passage quotidien sont
    // lus tels que la base de test les porte (on ne pose pas de bail : le
    // scheduler des autres fichiers en prend un).
    await pool.query(
      `insert into platform_flag (key, value, updated_by) values ('scheduler_tick_min', '15', 'c0a@test')
       on conflict (key) do update set value = excluded.value`,
    );
    await construire({ ecrire: true });
    cles = await jeuDeCles("session-20260924-c0a1");
    const port = await portLibre();
    base = `http://127.0.0.1:${port}`;
    service = spawn(process.execPath, [BUNDLE], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: url!,
        PORT: String(port),
        CONSOLE_API_CLIENT_SECRETS: SECRET,
        SESSION_SIGNING_KEYS: JSON.stringify(cles),
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    service.stdout?.on("data", (d) => journalService.push(String(d)));
    service.stderr?.on("data", (d) => journalService.push(String(d)));
    for (let i = 0; i < 100; i++) {
      if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 120_000);

  afterAll(async () => {
    if (service && service.exitCode === null) service.kill("SIGKILL");
    await pool.query("delete from platform_flag where key = 'scheduler_tick_min' and updated_by = 'c0a@test'").catch(() => {});
    await pool.end();
  });

  const avecSecret = { headers: { "x-mip-client": SECRET } };

  it("les sondes du kit répondent sans secret ; tout le reste répond 404 nu sans lui", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/live`)).status).toBe(200);
    const nu = await fetch(`${base}/v1/public/platform-status`);
    expect(nu.status).toBe(404);
    expect(await nu.text()).toBe("");
    expect(nu.headers.get("x-mip-console-api")).toBeNull();
    const inconnu = await fetch(`${base}/v1/nulle-part`, avecSecret);
    expect(inconnu.status).toBe(404);
    expect(inconnu.headers.get("x-mip-console-api")).toBe("1");
  });

  it("la poignée de main se vérifie avec la clé publique seule, et annonce le contrat servi", async () => {
    const nonce = randomBytes(24).toString("base64url");
    const rep = await fetch(`${base}/v1/version?nonce=${nonce}`);
    expect(rep.status).toBe(200);
    const { data } = await rep.json();
    expect(data).toMatchObject({ service: "console-api", nonce, version: "dev", kid: "session-20260924-c0a1" });
    expect(data.contrat).toBe(await empreinte(lignesDuContrat(OPERATIONS)));
    const jwks = await (await fetch(`${base}/v1/.well-known/jwks.json`)).json();
    expect(jwks.keys[0]).not.toHaveProperty("d");
    expect(await verifierSignature(jwks.keys[0], messageDePoignee(data), data.signature)).toBe(true);
  });

  it("l'état de la plateforme est celui que la console lit aujourd'hui, à l'octet près", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = url;
    const planifie = await import("../../apps/console/lib/queries-planifie");
    const { pool: poolConsole } = await import("../../apps/console/lib/db");
    try {
      const [quotidien, tick] = await Promise.all([planifie.dernierPassagePlanifie(), planifie.dernierTickScheduler()]);
      const rep = await fetch(`${base}/v1/public/platform-status`, avecSecret);
      expect(rep.status).toBe(200);
      expect(rep.headers.get("cache-control")).toBe("no-store");
      const { data } = await rep.json();
      // Ce que la console affichait, passé par JSON : ce qu'elle recevra de console-api.
      expect(data).toEqual(JSON.parse(JSON.stringify({ quotidien, tick })));
      expect(data.tick.cadenceMin).toBe(15);
    } finally {
      await poolConsole.end().catch(() => {});
    }
  });

  it("un navigateur est refusé même sur une opération publique", async () => {
    const rep = await fetch(`${base}/v1/public/platform-status`, { headers: { ...avecSecret.headers, origin: "https://mip-rum-console.vercel.app" } });
    expect(rep.status).toBe(403);
  });

  it("SIGTERM : le service rend la main, code 0", async () => {
    const fin = new Promise<number | null>((r) => service.once("exit", (code) => r(code)));
    service.kill("SIGTERM");
    const code = await Promise.race([fin, new Promise<string>((r) => setTimeout(() => r("délai"), 10_000))]);
    expect(code).toBe(0);
    expect(journalService.join("")).toContain("console-api démarré");
  }, 15_000);

  it("refuse de démarrer en bloc : clé de test en production, secret client trop court — sans citer de secret", async () => {
    const test = await jeuDeCles("cle-test-01");
    const r = spawnSync(process.execPath, [BUNDLE], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: url!,
        PORT: "18099",
        NODE_ENV: "production",
        CONSOLE_API_CLIENT_SECRETS: SECRET,
        SESSION_SIGNING_KEYS: JSON.stringify(test),
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toContain("de test refusé");
    expect(r.stdout + r.stderr).not.toContain(test.keys[0].d);

    const court = spawnSync(process.execPath, [BUNDLE], {
      env: { PATH: process.env.PATH, DATABASE_URL: url!, PORT: "18099", CONSOLE_API_CLIENT_SECRETS: "court", SESSION_SIGNING_KEYS: JSON.stringify(cles) },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(court.status).toBe(2);
    expect(court.stdout + court.stderr).toContain("CONSOLE_API_CLIENT_SECRETS");
    expect(court.stdout + court.stderr).not.toContain(cles.keys[0].d);
  }, 40_000);
});
