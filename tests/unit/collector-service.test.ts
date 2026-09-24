// P2 — le point d'entrée `services/collector/server.mjs`, lancé pour de vrai.
//
// Sans base : le Postgres visé est un port FERMÉ. C'est voulu — ce fichier
// vérifie le câblage (configuration stricte, sondes du kit, nom du service,
// arrêt propre), pas l'écriture, que la preuve Docker et la fumée de CI
// couvrent sur un Postgres migré. Environnement EXPLICITE à chaque lancement :
// jamais celui du poste, qui peut porter une DATABASE_URL de production.
import { spawn } from "node:child_process";
import net from "node:net";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error module ESM partagé, sans déclarations
import { empreinteIdentite } from "../../packages/backend/lib/identity-hash.mjs";

const SECRET = "c".repeat(40);
const JETON = "m".repeat(40);

async function portLibre() {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

function lancer(env: Record<string, string>, args: string[] = []) {
  const lignes: any[] = [];
  let brut = "";
  const enfant = spawn(process.execPath, ["services/collector/server.mjs", ...args], {
    env: { LOG_LEVEL: "info", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lire = (flux: NodeJS.ReadableStream) => {
    let reste = "";
    flux.on("data", (d) => {
      brut += d;
      reste += d;
      const morceaux = reste.split("\n");
      reste = morceaux.pop()!;
      for (const l of morceaux) {
        try {
          if (l.trim()) lignes.push(JSON.parse(l));
        } catch {
          /* gabarit d'env : pas du JSON */
        }
      }
    });
  };
  lire(enfant.stdout!);
  lire(enfant.stderr!);
  const sortie = new Promise<[number | null, string | null]>((r) => enfant.on("exit", (c, s) => r([c, s])));
  return { enfant, lignes, sortie, brut: () => brut };
}

describe("collector — refus de démarrer (code 2), toutes les erreurs d'un coup", () => {
  it("secret d'identité sans empreinte : refus, dans la même liste que les autres erreurs", async () => {
    const { lignes, sortie, brut } = lancer({
      DATABASE_URL: "postgres://u:p@127.0.0.1:1/mip",
      IDENTITY_HASH_SECRET: SECRET,
      EDGE_PROXY_SECRET: "trop-court",
    });
    const [code] = await sortie;
    expect(code).toBe(2);
    const refus = lignes.find((l) => l.msg === "configuration invalide — le service refuse de démarrer");
    expect(refus.service).toBe("collector");
    expect(refus.erreurs.join("\n")).toMatch(/IDENTITY_HASH_FINGERPRINT est obligatoire/);
    expect(refus.erreurs.join("\n")).toMatch(/EDGE_PROXY_SECRET/);
    expect(brut()).not.toContain(SECRET);
    expect(brut()).not.toContain("trop-court");
  }, 15_000);

  it("sans DATABASE_URL : refus (plus de repli silencieux sur un Postgres local)", async () => {
    const { lignes, sortie } = lancer({});
    const [code] = await sortie;
    expect(code).toBe(2);
    expect(JSON.stringify(lignes)).toContain("DATABASE_URL : obligatoire, absente ou vide");
  }, 15_000);

  it("--print-env-example publie le gabarit tiré du schéma", async () => {
    const { sortie, brut } = lancer({}, ["--print-env-example"]);
    const [code] = await sortie;
    expect(code).toBe(0);
    for (const v of ["IDENTITY_HASH_SECRET", "IDENTITY_HASH_FINGERPRINT", "EDGE_PROXY_SECRET", "REQUIRE_API_KEY", "METRICS_TOKEN", "GEOIP_IP_SOURCE"]) {
      expect(brut()).toContain(`${v}=`);
    }
  }, 15_000);
});

describe("collector — démarré sur une base injoignable", () => {
  it("/health dit « collector », le protocole de bord et l'identité ; /ready sous jeton ; SIGTERM → 0 en < 10 s", async () => {
    const port = await portLibre();
    const fp = empreinteIdentite(SECRET);
    const { enfant, lignes, sortie, brut } = lancer({
      DATABASE_URL: "postgres://u:p@127.0.0.1:1/mip",
      PORT: String(port),
      METRICS_TOKEN: JETON,
      IDENTITY_HASH_SECRET: SECRET,
      IDENTITY_HASH_FINGERPRINT: fp,
    });
    try {
      await vi.waitFor(() => expect(lignes.some((l) => l.msg === "collector démarré")).toBe(true), { timeout: 5_000 });
      const demarre = lignes.find((l) => l.msg === "collector démarré");
      expect(demarre).toMatchObject({ service: "collector", identity: "active", id_fp: fp });

      const sante = await fetch(`http://127.0.0.1:${port}/health`);
      // Base injoignable : 503 — mais la description statique reste lisible.
      expect(sante.status).toBe(503);
      expect(await sante.json()).toMatchObject({
        status: "unavailable",
        service: "collector",
        edge_protocol: "mip-edge/1",
        identity: "active",
        id_fp: fp,
      });
      expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(404); // sans jeton
      const pret = await fetch(`http://127.0.0.1:${port}/ready`, { headers: { authorization: `Bearer ${JETON}` } });
      expect(pret.status).toBe(503);
      expect(await pret.json()).toMatchObject({ status: "not_ready", registry_loaded: false });

      const t0 = Date.now();
      enfant.kill("SIGTERM");
      const [code, signal] = await sortie;
      expect(signal).toBeNull();
      expect(code).toBe(0);
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(lignes.at(-1)).toMatchObject({ msg: "arrêt terminé", code: 0, service: "collector" });
      // Aucune ligne ne se réclame plus de l'ancien nom, et aucune ne porte le secret.
      expect(lignes.every((l) => l.service === "collector")).toBe(true);
      expect(brut()).not.toContain(SECRET);
    } finally {
      enfant.kill("SIGKILL");
    }
  }, 20_000);

  it("empreinte discordante : démarre, identité retirée, erreur claire", async () => {
    const port = await portLibre();
    const { enfant, lignes, sortie } = lancer({
      DATABASE_URL: "postgres://u:p@127.0.0.1:1/mip",
      PORT: String(port),
      IDENTITY_HASH_SECRET: SECRET,
      IDENTITY_HASH_FINGERPRINT: "000000000000",
    });
    try {
      await vi.waitFor(() => expect(lignes.some((l) => l.msg === "collector démarré")).toBe(true), { timeout: 5_000 });
      expect(lignes.find((l) => l.level === "error")?.msg).toMatch(/DISCORDANTE/);
      const corps = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
      expect(corps).toMatchObject({ identity: "discordante", identity_hash: { configured: false } });
      enfant.kill("SIGTERM");
      expect((await sortie)[0]).toBe(0);
    } finally {
      enfant.kill("SIGKILL");
    }
  }, 20_000);
});
