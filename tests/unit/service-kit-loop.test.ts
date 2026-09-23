// @mip/service-kit — loop.mjs : jamais deux tours en parallèle, même quand un
// tour dure plus que l'intervalle ; un échec ne tue pas la boucle ; l'arrêt
// attend le tour en cours sans l'interrompre ; chaque tour a son run_id.
import { describe, expect, it, vi } from "vitest";
import { startLoop } from "../../packages/service-kit/loop.mjs";
import { createLogger } from "../../packages/service-kit/log.mjs";
import { createMetrics } from "../../packages/service-kit/metrics.mjs";

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function journal() {
  const lignes: any[] = [];
  const log = createLogger("test-boucle", {
    version: "",
    replica: "",
    level: "debug",
    sink: { out: (l: string) => lignes.push(JSON.parse(l)), err: (l: string) => lignes.push(JSON.parse(l)) },
  });
  return { log, lignes };
}

describe("service-kit/loop — pas de chevauchement", () => {
  it("un tour plus long que l'intervalle ne se double jamais", async () => {
    const { log } = journal();
    let enCours = 0;
    let maxSimultanes = 0;
    let tours = 0;
    const boucle = startLoop({
      name: "lent",
      intervalMs: 5,
      jitter: 0,
      immediate: true,
      log,
      run: async () => {
        enCours += 1;
        tours += 1;
        maxSimultanes = Math.max(maxSimultanes, enCours);
        await attendre(25); // cinq fois l'intervalle
        enCours -= 1;
      },
    });
    // runNow() pendant un tour rend CE tour, il n'en lance pas un second
    await attendre(5);
    const a = boucle.runNow();
    const b = boucle.runNow();
    expect(a).toBe(b);
    await vi.waitFor(() => expect(tours).toBeGreaterThanOrEqual(3), { timeout: 3000 });
    await boucle.stop();
    expect(maxSimultanes).toBe(1);
  });

  it("le délai court à partir de la FIN du tour, pas de son début", async () => {
    const { log } = journal();
    const debuts: number[] = [];
    const fins: number[] = [];
    const boucle = startLoop({
      name: "espacement",
      intervalMs: 30,
      jitter: 0,
      immediate: true,
      log,
      run: async () => {
        debuts.push(Date.now());
        await attendre(20);
        fins.push(Date.now());
      },
    });
    await vi.waitFor(() => expect(debuts.length).toBeGreaterThanOrEqual(3), { timeout: 3000 });
    await boucle.stop();
    for (let i = 1; i < debuts.length; i++) expect(debuts[i] - fins[i - 1]).toBeGreaterThanOrEqual(25);
  });
});

describe("service-kit/loop — robustesse et arrêt", () => {
  it("un tour qui lève est journalisé avec sa pile et compté ; le suivant part quand même", async () => {
    const { log, lignes } = journal();
    const metrics = createMetrics();
    let n = 0;
    const boucle = startLoop({
      name: "fragile",
      intervalMs: 5,
      jitter: 0,
      immediate: true,
      log,
      metrics,
      run: async () => {
        n += 1;
        if (n === 1) throw new Error("base injoignable");
      },
    });
    await vi.waitFor(() => expect(n).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    await boucle.stop();
    const echec = lignes.find((l) => /tour de boucle en échec/.test(l.msg));
    expect(echec.err.stack).toContain("base injoignable");
    expect(echec.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(boucle.stats()).toMatchObject({ failures: 1, lastError: "base injoignable" });
    const texte = await metrics.render();
    expect(texte).toContain('loop_runs_total{loop="fragile",result="error"} 1');
    expect(texte).toMatch(/loop_runs_total\{loop="fragile",result="ok"\} [1-9]/);
    expect(texte).toMatch(/loop_last_success_timestamp_seconds\{loop="fragile"\} \d/);
  });

  it("stop() attend la fin du tour en cours, sans l'interrompre, et plus rien ne part ensuite", async () => {
    const { log } = journal();
    let fini = false;
    let tours = 0;
    const boucle = startLoop({
      name: "arret",
      intervalMs: 5,
      jitter: 0,
      immediate: true,
      log,
      run: async ({ signal }: { signal: AbortSignal }) => {
        tours += 1;
        await attendre(40);
        fini = !signal.aborted;
      },
    });
    await attendre(5);
    expect(boucle.running).toBe(true);
    await boucle.stop();
    expect(fini).toBe(true); // le tour est allé au bout, signal non avorté
    const apres = tours;
    await attendre(40);
    expect(tours).toBe(apres);
    expect(boucle.stopped).toBe(true);
  });

  it("le signal du tour avorte quand le délai de drainage est atteint", async () => {
    const { log } = journal();
    let avorte = false;
    const boucle = startLoop({
      name: "cooperatif",
      intervalMs: 1000,
      immediate: true,
      log,
      run: ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((r) =>
          signal.addEventListener("abort", () => {
            avorte = true;
            r();
          }),
        ),
    });
    await attendre(5);
    const drain = new AbortController();
    const arret = boucle.stop({ signal: drain.signal });
    drain.abort(new Error("délai de drainage atteint"));
    await arret;
    expect(avorte).toBe(true);
  });

  it("s'enregistre auprès du cycle de vie, et ne démarre pas si l'arrêt est déjà en cours", async () => {
    const { log } = journal();
    const crochets: Array<(c: { signal: AbortSignal }) => unknown> = [];
    const lifecycle = { draining: false, onDrain: (_n: string, fn: any) => crochets.push(fn) };
    let tours = 0;
    const boucle = startLoop({ name: "lc", intervalMs: 5, jitter: 0, immediate: true, log, lifecycle: lifecycle as any, run: () => void (tours += 1) });
    expect(crochets).toHaveLength(1);
    await attendre(20);
    await crochets[0]({ signal: new AbortController().signal });
    expect(boucle.stopped).toBe(true);

    const enArret = { draining: true, onDrain: () => {} };
    let toursApres = 0;
    startLoop({ name: "tardive", intervalMs: 5, immediate: true, log, lifecycle: enArret as any, run: () => void (toursApres += 1) });
    await attendre(20);
    expect(toursApres).toBe(0);
  });
});

describe("service-kit/loop — jitter et validation", () => {
  it("le jitter reste dans ±jitter × intervalle", async () => {
    const { log } = journal();
    // On observe le délai DEMANDÉ à setTimeout, sans attendre qu'il s'écoule.
    const espion = vi.spyOn(globalThis, "setTimeout");
    try {
      const delais: number[] = [];
      for (const r of [0, 0.5, 0.999]) {
        espion.mockClear();
        const boucle = startLoop({ name: `j${r}`, intervalMs: 1000, jitter: 0.1, log, random: () => r, run: () => {} });
        delais.push(Number(espion.mock.calls[0][1]));
        await boucle.stop();
      }
      expect(delais).toEqual([900, 1000, 1100]);
    } finally {
      espion.mockRestore();
    }
  });

  // Le scheduler vise une GRILLE (:00, :05… ; 03:17 UTC), pas un intervalle :
  // le délai est recalculé à chaque armement, sans jitter.
  it("nextDelay : le délai est recalculé à chaque armement et remplace intervalle et jitter", async () => {
    const { log } = journal();
    const espion = vi.spyOn(globalThis, "setTimeout");
    try {
      const demandes = [30, 10];
      let appels = 0;
      let tours = 0;
      const boucle = startLoop({
        name: "grille",
        nextDelay: () => demandes[Math.min(appels++, demandes.length - 1)],
        jitter: 0.5,
        random: () => 0.999,
        log,
        run: () => void (tours += 1),
      });
      expect(Number(espion.mock.calls.at(-1)?.[1])).toBe(30); // ni 30 × 1,5, ni intervalle
      await vi.waitFor(() => expect(tours).toBeGreaterThanOrEqual(2), { timeout: 3000 });
      await boucle.stop();
      expect(appels).toBeGreaterThanOrEqual(2);
    } finally {
      espion.mockRestore();
    }
  });

  it("nextDelay : refuse une valeur non finie plutôt que d'armer une boucle serrée", () => {
    const { log } = journal();
    expect(() => startLoop({ name: "nan", nextDelay: () => Number.NaN, log, run: () => {} })).toThrow(RangeError);
    expect(() => startLoop({ name: "pas-fn", nextDelay: 5 as any, log, run: () => {} })).toThrow(TypeError);
  });

  it("refuse un intervalle nul, un jitter hors [0,1), un run manquant", () => {
    const { log } = journal();
    expect(() => startLoop({ name: "x", intervalMs: 0, run: () => {}, log })).toThrow(RangeError);
    expect(() => startLoop({ name: "x", intervalMs: 10, jitter: 1, run: () => {}, log })).toThrow(RangeError);
    expect(() => startLoop({ name: "x", intervalMs: 10, log } as any)).toThrow(/run/);
  });
});
