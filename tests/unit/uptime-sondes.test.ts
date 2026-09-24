// Sondes uptime du scheduler (P1) : concurrence bornée, confirmation avant DOWN,
// sortie par safe-fetch.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Mille checks configurés = mille connexions simultanées depuis le scheduler ;
//   - un échec isolé enregistré DOWN (donc une alerte `critical`) sans second essai ;
//   - un refus de politique (URL interne) rejoué pour rien, ou pris pour une panne
//     silencieuse : il est enregistré DOWN, avec son motif ;
//   - une sonde qui repasse par `fetch` nu au lieu de safe-fetch.
import { describe, expect, it, vi } from "vitest";
import {
  CONCURRENCE_UPTIME,
  sonderUneFois,
  sonderUptime,
} from "../../packages/backend/jobs/planifie.mjs";

const muet = { info() {}, warn() {}, error() {} };

type Check = { id: number; url: string; method?: string; expect_status?: number; timeout_ms?: number };
type Verdict = { ok: boolean; statut: number | null; erreur: string | null; ms: number; definitif: boolean };

/** Pool factice : rend les checks, retient les résultats enregistrés. */
function poolAvec(checks: Check[]) {
  const enregistres: unknown[][] = [];
  return {
    enregistres,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("from uptime_check")) return { rows: checks };
      if (sql.includes("record_uptime_result")) enregistres.push(params ?? []);
      return { rows: [] };
    }),
  };
}

const up: Verdict = { ok: true, statut: 200, erreur: null, ms: 5, definitif: false };
const down = (erreur = "HTTP 503"): Verdict => ({ ok: false, statut: 503, erreur, ms: 5, definitif: false });

describe("sonderUptime — concurrence et confirmation", () => {
  it(`jamais plus de ${CONCURRENCE_UPTIME} sondes en vol`, async () => {
    const checks = Array.from({ length: 35 }, (_, i) => ({ id: i + 1, url: `https://s${i}.exemple.test/` }));
    let enVol = 0;
    let pic = 0;
    const sonder = vi.fn(async () => {
      enVol++;
      pic = Math.max(pic, enVol);
      await new Promise((fin) => setTimeout(fin, 5));
      enVol--;
      return up;
    });
    const pool = poolAvec(checks);
    const bilan = await sonderUptime(pool as never, muet, { sonder, pauseMs: 0 });
    expect(CONCURRENCE_UPTIME).toBe(10);
    expect(pic).toBe(10);
    expect(bilan).toEqual({ ran: 35, down: 0, rattrapes: 0 });
    expect(pool.enregistres).toHaveLength(35);
  });

  it("un échec suivi d'un succès est rattrapé : enregistré UP, sans alerte", async () => {
    const sonder = vi.fn<(c: Check) => Promise<Verdict>>().mockResolvedValueOnce(down("délai dépassé")).mockResolvedValueOnce(up);
    const pool = poolAvec([{ id: 7, url: "https://site.exemple.test/" }]);
    const bilan = await sonderUptime(pool as never, muet, { sonder, pauseMs: 0 });
    expect(sonder).toHaveBeenCalledTimes(2);
    expect(bilan).toEqual({ ran: 1, down: 0, rattrapes: 1 });
    expect(pool.enregistres).toEqual([[7, true, 200, 5, null]]);
  });

  it("deux échecs : DOWN enregistré avec le verdict de la confirmation", async () => {
    const sonder = vi.fn<(c: Check) => Promise<Verdict>>().mockResolvedValueOnce(down("HTTP 502")).mockResolvedValueOnce(down("HTTP 503"));
    const pool = poolAvec([{ id: 8, url: "https://site.exemple.test/" }]);
    const bilan = await sonderUptime(pool as never, muet, { sonder, pauseMs: 0 });
    expect(sonder).toHaveBeenCalledTimes(2);
    expect(bilan).toEqual({ ran: 1, down: 1, rattrapes: 0 });
    expect(pool.enregistres).toEqual([[8, false, 503, 5, "HTTP 503"]]);
  });

  it("la confirmation attend la pause avant de rejouer", async () => {
    const instants: number[] = [];
    const sonder = vi.fn(async () => {
      instants.push(Date.now());
      return down();
    });
    await sonderUptime(poolAvec([{ id: 1, url: "https://s.exemple.test/" }]) as never, muet, { sonder, pauseMs: 40 });
    expect(instants[1] - instants[0]).toBeGreaterThanOrEqual(35);
  });
});

describe("sonderUneFois — par safe-fetch", () => {
  it("une URL de métadonnées est refusée sans réseau, sans second essai, et enregistrée DOWN avec son motif", async () => {
    const pool = poolAvec([
      { id: 1, url: "http://169.254.169.254/latest/meta-data/" },
      { id: 2, url: "http://[::ffff:169.254.169.254]/" },
      { id: 3, url: "http://postgres.railway.internal:5432/" },
    ]);
    const bilan = await sonderUptime(pool as never, muet, { pauseMs: 60_000 });
    // La pause de 60 s n'a pas été attendue : un refus de politique n'est pas confirmé.
    expect(bilan).toEqual({ ran: 3, down: 3, rattrapes: 0 });
    const parId = new Map(pool.enregistres.map((p) => [p[0], p]));
    expect(parId.get(1)).toMatchObject([1, false, null, expect.any(Number), expect.stringMatching(/^cible refusée : Adresse IP littérale/)]);
    expect(parId.get(2)?.[4]).toMatch(/^cible refusée : Adresse IP littérale/);
    expect(parId.get(3)?.[4]).toMatch(/^cible refusée : Nom d'hôte interne/);
  });

  it("juge le statut attendu, passe méthode et délai, et annule le corps sans le lire", async () => {
    const annule = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ({ status: 204, body: { cancel: annule } }) as unknown as Response);
    const verdict = await sonderUneFois(
      { url: "https://api.exemple.test/health", method: "HEAD", expect_status: 204, timeout_ms: 3000 },
      { fetchImpl },
    );
    expect(verdict).toMatchObject({ ok: true, statut: 204, erreur: null, definitif: false });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.exemple.test/health", { method: "HEAD", timeoutMs: 3000 });
    expect(annule).toHaveBeenCalledOnce();
  });

  it("un statut inattendu ou une panne de transport sont des échecs à confirmer", async () => {
    const statut = await sonderUneFois({ url: "https://a.exemple.test/" }, {
      fetchImpl: async () => ({ status: 500, body: null }) as unknown as Response,
    });
    expect(statut).toMatchObject({ ok: false, statut: 500, erreur: "HTTP 500", definitif: false });
    const panne = await sonderUneFois({ url: "https://a.exemple.test/" }, {
      fetchImpl: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      },
    });
    expect(panne).toMatchObject({ ok: false, statut: null, erreur: "connect ECONNREFUSED", definitif: false });
  });
});
