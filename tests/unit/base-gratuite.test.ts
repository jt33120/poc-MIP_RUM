// La base reste sur l'offre gratuite de Neon (décision du 24/09/2026) : les
// cadences ralentissent pour laisser le calcul s'endormir, et la vitrine le dit.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Une cadence hors grille : le passage horaire (HH:05) et le quotidien
//     (03:17) ne tomberaient plus dans la fenêtre d'éveil du tick, et
//     réveilleraient la base une fois de plus chacun.
//   - Un notifier désaligné du scheduler : deux cadences de 15 min décalées
//     réveillent la base deux fois plus souvent.
//   - Une vitrine qui afficherait « 5 minutes » quand le scheduler en tourne 15 —
//     l'affirmation statique qui devient fausse en silence.
//   - Un /ready qui crierait au retard sur une cadence volontairement lente.
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { TICKS_ADMIS_MIN, decrireCadences, prochainDelai, tolerancesMs } from "../../packages/backend/jobs/cadence.mjs";
import { CLE_CADENCE_TICK, publierCadenceTick } from "../../packages/backend/jobs/ordonnanceur.mjs";
import {
  DECALAGE_ALIGNEMENT_MS,
  creerLivreur,
  erreurIntervalle,
  prochainePasseAlignee,
} from "../../packages/backend/jobs/livreur.mjs";
import {
  CADENCE_TICK_MIN,
  RAISON_CADENCE_LENTE,
  cadencePubliee,
  ligneLatence,
} from "../../apps/console/lib/etat-latence";
import { latenceDepuis } from "../../apps/console/lib/etat-planifie";

const muet = { debug() {}, info() {}, warn() {}, error() {} };
const a = (iso: string) => new Date(iso).getTime();

describe("scheduler — cadence du tick réglable, sur la grille de l'heure", () => {
  it("15 min : :00, :15, :30, :45 — et le passage horaire de :05 tombe dans l'éveil de :00", () => {
    expect(prochainDelai("tick", a("2026-10-01T14:03:00Z"), { tickMin: 15 })).toBe(12 * 60_000);
    expect(prochainDelai("tick", a("2026-10-01T14:52:10Z"), { tickMin: 15 })).toBe(7 * 60_000 + 50_000);
    // Défaut inchangé : 5 min.
    expect(prochainDelai("tick", a("2026-10-01T14:03:00Z"))).toBe(2 * 60_000);
  });

  it("refuse une cadence hors grille au lieu d'en inventer une", () => {
    expect(TICKS_ADMIS_MIN).toEqual([5, 10, 15, 20, 30]);
    expect(() => prochainDelai("tick", Date.now(), { tickMin: 7 })).toThrow(/hors grille/);
  });

  it("la tolérance de /ready suit la cadence : trois passages manqués", () => {
    expect(tolerancesMs(15).tick).toBe(45 * 60_000);
    expect(tolerancesMs().tick).toBe(15 * 60_000);
    expect(decrireCadences(15).tick).toBe("toutes les 15 minutes");
  });

  it("publie sa cadence effective en base, n'écrit que si elle change, et ne lève jamais", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await publierCadenceTick(pool as never, 15)).toBe(true);
    const [sql, params] = pool.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("insert into platform_flag");
    expect(sql).toContain("is distinct from excluded.value");
    expect(params).toEqual([CLE_CADENCE_TICK, "15"]);
    // `platform_flag` absente (avant v87) : faux, et le worker retentera.
    const absente = { query: vi.fn(async () => Promise.reject(Object.assign(new Error("relation absente"), { code: "42P01" }))) };
    expect(await publierCadenceTick(absente as never, 15, { log: muet })).toBe(false);
  });
});

describe("notifier — passes alignées 45 s derrière le tick", () => {
  const Q = 15 * 60_000;

  it("à 15 min : :00:45, :15:45… — un seul réveil de la base pour les deux services", () => {
    expect(prochainePasseAlignee(Q, a("2026-10-01T14:00:10Z"))).toBe(35_000); // → 14:00:45
    expect(prochainePasseAlignee(Q, a("2026-10-01T14:00:50Z"))).toBe(Q - 5_000); // → 14:15:45
    expect(prochainePasseAlignee(Q, a("2026-10-01T14:14:00Z"))).toBe(105_000); // → 14:15:45
    expect(DECALAGE_ALIGNEMENT_MS).toBe(45_000);
  });

  it("jamais moins d'une seconde, et la réconciliation horaire tombe à HH:00:50", () => {
    expect(prochainePasseAlignee(Q, a("2026-10-01T14:00:44.500Z"))).toBe(1_000);
    expect(prochainePasseAlignee(3_600_000, a("2026-10-01T14:20:00Z"), 50_000)).toBe(40 * 60_000 + 50_000);
  });

  it("un intervalle aligné doit diviser l'heure ; sous 5 min, rien n'est exigé", () => {
    expect(erreurIntervalle(900_000)).toBeNull();
    expect(erreurIntervalle(15_000)).toBeNull();
    expect(erreurIntervalle(700_000)).toMatch(/diviseur de l'heure/);
  });

  it("/ready : une livraison qui attend la passe suivante (15 min) n'est pas « bloquée »", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{ en_attente: 1, plus_ancienne_s: 20 * 60 }] })),
      connect: vi.fn(),
    };
    const lent = creerLivreur({ pool: pool as never, log: muet, intervalleMs: Q, maintenant: () => 0 });
    expect((await lent.etat()).backlog.bloque).toBe(false); // 20 min < 2 × 15 min
    const rapide = creerLivreur({ pool: pool as never, log: muet, maintenant: () => 0 });
    expect((await rapide.etat()).backlog.bloque).toBe(true); // 20 min > 15 min
  });
});

describe("vitrine — la latence d'alerte dit la cadence qui tourne", () => {
  const MAINTENANT = a("2026-10-01T14:20:00Z");
  const ilYa = (min: number) => new Date(MAINTENANT - min * 60_000);

  it("15 min publiées : « partiel », avec la raison — jamais « 5 minutes » atteint", () => {
    const l = ligneLatence(ilYa(8), MAINTENANT, 15);
    expect(l.s).toBe("partiel");
    expect(l.reel).toContain("15 minutes");
    expect(l.reel).toContain(RAISON_CADENCE_LENTE);
    expect(l.reel).not.toMatch(new RegExp(`(^|\\D)${CADENCE_TICK_MIN} minutes`));
  });

  it("la tolérance suit la cadence publiée : 40 min sans passage n'est pas un arrêt à 15 min", () => {
    expect(ligneLatence(ilYa(40), MAINTENANT, 15).reel).not.toMatch(/à l'arrêt/);
    expect(ligneLatence(ilYa(46), MAINTENANT, 15).reel).toMatch(/à l'arrêt/);
  });

  it("sans cadence publiée : la cible, comme avant", () => {
    expect(latenceDepuis({ etat: "lu", date: ilYa(2) }, MAINTENANT)).toMatchObject({ s: "atteint" });
    expect(latenceDepuis({ etat: "lu", date: ilYa(2), cadenceMin: null }, MAINTENANT).reel).toContain("5 minutes");
  });

  it("ne croit qu'une valeur sur la grille", () => {
    expect(cadencePubliee("15")).toBe(15);
    expect(cadencePubliee("7")).toBeNull();
    expect(cadencePubliee("15; drop")).toBeNull();
    expect(cadencePubliee(undefined)).toBeNull();
  });
});

describe("services — les réglages sont refusés hors grille au démarrage", () => {
  const lancer = (entree: string, env: Record<string, string>) =>
    new Promise<{ code: number | null; sortie: string }>((r) => {
      const e = spawn(process.execPath, [entree], { env, stdio: ["ignore", "pipe", "pipe"] });
      let sortie = "";
      e.stdout!.on("data", (d) => (sortie += d));
      e.stderr!.on("data", (d) => (sortie += d));
      e.on("exit", (code) => r({ code, sortie }));
    });

  it("scheduler : SCHEDULER_TICK_MIN=7 refusé ; notifier : NOTIFIER_INTERVAL_MS=700000 refusé", async () => {
    const base = { DATABASE_URL: "postgres://u:p@localhost:1/x", LOG_LEVEL: "info" };
    const s = await lancer("services/scheduler/worker.mjs", { ...base, SCHEDULER_TICK_MIN: "7" });
    expect(s.code).toBe(2);
    expect(s.sortie).toContain("SCHEDULER_TICK_MIN : valeur hors liste");
    const n = await lancer("services/notifier/worker.mjs", { ...base, NOTIFIER_INTERVAL_MS: "700000" });
    expect(n.code).toBe(2);
    expect(n.sortie).toContain("NOTIFIER_INTERVAL_MS : à partir de 300000, un diviseur de l'heure");
  }, 15_000);
});
