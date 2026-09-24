// Livraison des webhooks d'alerte par safe-fetch (P1).
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Que le dispatcher poste vers les métadonnées cloud, le réseau privé Railway
//     ou la boucle locale parce qu'une URL a été écrite avant le contrôle de la
//     console (ou directement en base) ;
//   - qu'un refus de politique soit rejoué cinq fois avec backoff : il est soldé
//     `skipped`, sans tentative comptée, avec son motif dans `response`.
import { describe, expect, it, vi } from "vitest";
import { dispatchOnce } from "../../packages/backend/lib/dispatch-alerts.mjs";
import { ErreurCibleRefusee } from "../../packages/backend/lib/net/safe-fetch.mjs";

/** Pool factice : une livraison réservée par cible, puis plus rien ; retient les mises à jour. */
function poolAvec(cibles: string[]) {
  const file = cibles.map((target, i) => ({ id: i + 1, target, attempts: 0, message: "m", severity: "warning" }));
  const misesAJour: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("update alert_delivery")) misesAJour.push({ sql, params });
      if (sql.includes("from alert_delivery d")) return { rows: file.length ? [file.shift()] : [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    misesAJour,
    query: vi.fn(async () => ({ rows: [{ v73: true }] })),
    connect: vi.fn(async () => client),
  };
}

describe("dispatchOnce — sortie par safe-fetch", () => {
  it("solde skipped, sans la poster, une cible de métadonnées ou du réseau privé Railway", async () => {
    const pool = poolAvec([
      "http://169.254.169.254/latest/meta-data/",
      "http://[::ffff:169.254.169.254]/",
      "https://hook.railway.internal/x",
    ]);
    // Aucun `fetchImpl` passé : c'est le safe-fetch de production qui juge.
    const bilan = await dispatchOnce(pool as never);
    expect(bilan).toEqual({ sent: 0, failed: 0, dead: 0, skipped: 3 });
    for (const { sql, params } of pool.misesAJour) {
      expect(sql).toContain("status = 'skipped'");
      expect(sql).not.toContain("attempts = attempts + 1");
      expect(String(params[0])).toMatch(/^cible refusée : /);
    }
  });

  it("un refus après résolution DNS est soldé de même ; une cible acceptée est livrée", async () => {
    const pool = poolAvec(["https://piege.exemple.test/", "https://hooks.exemple.test/ok"]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("piege")) throw new ErreurCibleRefusee("adresse_interdite", "boucle locale");
      return { status: 200, ok: true, body: null } as unknown as Response;
    });
    const bilan = await dispatchOnce(pool as never, { fetchImpl });
    expect(bilan).toEqual({ sent: 1, failed: 0, dead: 0, skipped: 1 });
    expect(pool.misesAJour[0].params[0]).toMatch(/^cible refusée : .*\(boucle locale\)$/);
    expect(pool.misesAJour[1].params.slice(0, 2)).toEqual(["delivered", "http 200"]);
    // Le délai est passé aux deux formes : `signal` (fetch) et `timeoutMs` (safeFetch).
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: expect.any(AbortSignal),
      timeoutMs: expect.any(Number),
    });
  });

  it("une panne de transport reste un échec rejouable, avec le code système", async () => {
    const pool = poolAvec(["https://hooks.exemple.test/ko"]);
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    expect(await dispatchOnce(pool as never, { fetchImpl })).toEqual({ sent: 0, failed: 1, dead: 0, skipped: 0 });
    expect(pool.misesAJour[0].params.slice(0, 2)).toEqual(["failed", "ECONNREFUSED"]);
  });
});
