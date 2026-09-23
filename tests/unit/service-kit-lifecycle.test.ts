// @mip/service-kit — lifecycle.mjs : SIGTERM simulé sur un faux processus.
// On vérifie l'ORDRE (503 → drainage → fermeture → sortie), les bornes
// (drainage abandonné au délai, sortie forcée si une fermeture pend) et les
// gardes (rejet et exception non capturés → arrêt propre en code 1).
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installLifecycle } from "../../packages/service-kit/lifecycle.mjs";

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function banc(options: Record<string, unknown> = {}) {
  const proc = new EventEmitter();
  const journal: { level: string; msg: string; champs: any }[] = [];
  const log = Object.fromEntries(
    ["debug", "info", "warn", "error"].map((level) => [level, (msg: string, champs: any) => journal.push({ level, msg, champs })]),
  );
  const etapes: string[] = [];
  const exit = vi.fn((code: number) => etapes.push(`exit:${code}`));
  const lc = installLifecycle({ log: log as any, proc: proc as any, exit, env: {}, ...options });
  return { proc, lc, exit, etapes, journal };
}

describe("service-kit/lifecycle — SIGTERM : l'ordre des étapes", () => {
  it("503 d'abord, puis drainage en parallèle, puis fermeture en ordre inverse, puis sortie 0", async () => {
    const { proc, lc, exit, etapes } = banc({ drainTimeoutMs: 1000, forceExitMs: 2000 });
    lc.onDrain("http", async () => {
      etapes.push(`drain:http:debut(draining=${lc.draining})`);
      await attendre(30);
      etapes.push("drain:http:fin");
    });
    lc.onDrain("boucle", async () => {
      etapes.push("drain:boucle:debut");
      await attendre(10);
      etapes.push("drain:boucle:fin");
    });
    lc.onClose("pg", () => etapes.push("close:pg"));
    lc.onClose("cache", () => etapes.push("close:cache")); // ouvert après pg → fermé avant

    expect(lc.draining).toBe(false);
    proc.emit("SIGTERM");
    // Synchrone : /ready bascule dès le signal, avant tout drainage.
    expect(lc.draining).toBe(true);
    expect(lc.state).toBe("draining");

    await lc.shutdown("attente du test");
    expect(etapes).toEqual([
      "drain:http:debut(draining=true)",
      "drain:boucle:debut",
      "drain:boucle:fin",
      "drain:http:fin",
      "close:cache",
      "close:pg",
      "exit:0",
    ]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(lc.state).toBe("stopped");
    lc.uninstall();
  });

  it("le délai de retrait garde le service ouvert, /ready à 503, AVANT de drainer", async () => {
    const { proc, lc, etapes } = banc({ unreadyDelayMs: 300, drainTimeoutMs: 1000, forceExitMs: 2000 });
    lc.onDrain("http", () => etapes.push("drain"));
    const t0 = Date.now();
    proc.emit("SIGTERM");
    await attendre(20);
    expect(lc.draining).toBe(true);
    expect(etapes).toEqual([]); // toujours en retrait : rien n'est drainé
    await lc.shutdown("x");
    expect(etapes[0]).toBe("drain");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
    lc.uninstall();
  });

  it("un drainage qui traîne est abandonné au délai (signal avorté), la fermeture a lieu quand même", async () => {
    const { proc, lc, etapes, journal } = banc({ drainTimeoutMs: 60, forceExitMs: 2000 });
    let signalRecu: AbortSignal | undefined;
    lc.onDrain("http", ({ signal }: { signal: AbortSignal }) => {
      signalRecu = signal;
      return new Promise(() => {}); // une connexion qui ne se ferme jamais
    });
    lc.onClose("pg", () => etapes.push("close:pg"));
    proc.emit("SIGTERM");
    await lc.shutdown("x");
    expect(signalRecu?.aborted).toBe(true);
    expect(etapes).toEqual(["close:pg", "exit:0"]);
    expect(journal.some((l) => l.level === "warn" && /drainage incomplet/.test(l.msg))).toBe(true);
    lc.uninstall();
  });

  it("sortie FORCÉE en 1 si une fermeture pend au-delà du délai", async () => {
    const { proc, lc, exit, journal } = banc({ drainTimeoutMs: 20, forceExitMs: 80 });
    lc.onClose("pg", () => new Promise(() => {})); // pool.end() qui ne rend jamais la main
    const t0 = Date.now();
    proc.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { timeout: 2000 });
    expect(exit).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
    expect(journal.some((l) => l.level === "error" && /sortie forcée/.test(l.msg))).toBe(true);
    lc.uninstall();
  });

  it("un second SIGTERM est ignoré ; deux Ctrl-C sortent tout de suite (130)", async () => {
    const { proc, lc, exit, journal } = banc({ drainTimeoutMs: 1000, forceExitMs: 2000 });
    lc.onDrain("lent", () => attendre(50));
    proc.emit("SIGTERM");
    proc.emit("SIGTERM");
    expect(journal.some((l) => /signal reçu pendant l'arrêt/.test(l.msg))).toBe(true);
    proc.emit("SIGINT");
    proc.emit("SIGINT");
    expect(exit).toHaveBeenCalledWith(130);
    await lc.shutdown("x");
    lc.uninstall();
  });
});

describe("service-kit/lifecycle — installé avant tout await", () => {
  it("SIGTERM pendant le démarrage, avant tout enregistrement : sortie 0, et une ressource créée APRÈS est fermée aussitôt", async () => {
    const { proc, lc, exit, etapes } = banc({ drainTimeoutMs: 100, forceExitMs: 500 });
    proc.emit("SIGTERM"); // pendant un `await` de boot : rien n'est encore enregistré
    await lc.shutdown("x");
    expect(exit).toHaveBeenCalledWith(0);
    // le boot reprend après son await et crée son pool : il est fermé sur-le-champ
    lc.onClose("pg-tardif", () => etapes.push("close:pg-tardif"));
    await attendre(0);
    expect(etapes).toContain("close:pg-tardif");
    lc.uninstall();
  });

  it("refuse une double installation sur le même processus ; uninstall retire tout", () => {
    const { proc, lc } = banc();
    expect(() => installLifecycle({ log: { info() {}, warn() {}, error() {}, debug() {} } as any, proc: proc as any, env: {} })).toThrow(/déjà installé/);
    expect(proc.listenerCount("SIGTERM")).toBe(1);
    lc.uninstall();
    expect(proc.listenerCount("SIGTERM")).toBe(0);
    expect(proc.listenerCount("unhandledRejection")).toBe(0);
  });
});

describe("service-kit/lifecycle — gardes de processus", () => {
  it("unhandledRejection : pile journalisée, arrêt propre, sortie 1", async () => {
    const { proc, lc, exit, journal, etapes } = banc({ drainTimeoutMs: 100, forceExitMs: 500 });
    lc.onClose("pg", () => etapes.push("close:pg"));
    const raison = new Error("promesse oubliée");
    proc.emit("unhandledRejection", raison, Promise.resolve());
    await lc.shutdown("x");
    const ligne = journal.find((l) => /rejet de promesse non capturé/.test(l.msg))!;
    expect(ligne.level).toBe("error");
    expect(ligne.champs.err).toBe(raison); // le logger en tirera la pile complète
    expect(etapes).toEqual(["close:pg", "exit:1"]);
    expect(exit).toHaveBeenCalledWith(1);
    lc.uninstall();
  });

  it("uncaughtException pendant un arrêt déjà lancé : le code de sortie passe à 1", async () => {
    const { proc, lc, exit } = banc({ drainTimeoutMs: 100, forceExitMs: 500 });
    lc.onDrain("http", () => attendre(20));
    proc.emit("SIGTERM");
    proc.emit("uncaughtException", new Error("boom"), "uncaughtException");
    await lc.shutdown("x");
    expect(exit).toHaveBeenCalledWith(1);
    lc.uninstall();
  });
});

describe("service-kit/lifecycle — budget", () => {
  it("lit RAILWAY_DEPLOYMENT_DRAINING_SECONDS : sortie forcée 1 s avant SIGKILL, 2 s réservées à la fermeture", async () => {
    const { proc, lc, journal } = banc({ env: { RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "20" } });
    proc.emit("SIGTERM");
    await lc.shutdown("x");
    const demande = journal.find((l) => /arrêt demandé/.test(l.msg))!;
    expect(demande.champs).toMatchObject({ sortie_forcee_ms: 19_000, drainage_ms: 17_000 });
    lc.uninstall();
  });

  it("prévient quand le drainage n'est pas configuré sur Railway (défaut Railway : SIGKILL immédiat)", () => {
    const { lc, journal } = banc({ env: { RAILWAY_DEPLOYMENT_ID: "dep-1" } });
    expect(journal.some((l) => l.level === "warn" && /drainage non configuré/.test(l.msg))).toBe(true);
    lc.uninstall();
    const { lc: lc2, journal: j2 } = banc({ env: { RAILWAY_DEPLOYMENT_ID: "dep-1", RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "25" } });
    expect(j2.some((l) => /drainage non configuré/.test(l.msg))).toBe(false);
    lc2.uninstall();
  });
});
