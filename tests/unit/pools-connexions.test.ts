// C0 — LA SOMME DES POOLS tient sous `max_connections` de Neon.
//
// Chaque service Railway ouvre au plus `répliques × PGPOOL_MAX` connexions. Neon
// en accepte 112 (relevé du 23/09/2026, `show max_connections`), pour TOUT : les
// services, la console Vercel (un pool par instance serverless, 10 par défaut,
// autant d'instances que le trafic en réveille — `AutoRefresh` rejoue chaque
// écran toutes les 5 s), les migrations et l'exploitation (`psql`, relevés).
//
// Ce test lit `.railway/railway.ts` : une réplique ou un pool de plus, et le
// budget des services Railway est dépassé AVANT la production, pas pendant un pic.
// À M4 la console n'ouvre plus de pool (C12) ; sa réserve reviendra aux services.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAX_CONNECTIONS_NEON = 112;
/** Ce que les services Railway peuvent prendre : le reste va à la console Vercel, aux migrations, à l'exploitation. */
const BUDGET_RAILWAY = 72;
/** `PGPOOL_MAX` du scheduler, conservé (`preserve()`) : la valeur relevée en production le 23/09. */
const POOL_SCHEDULER_PRODUCTION = 4;

const iac = readFileSync(".railway/railway.ts", "utf8");

/** Les services déclarés, avec leurs répliques et leur pool. */
function services(): { nom: string; repliques: number; pool: number | "preserve" | null }[] {
  const blocs = iac.split(/\n  const \w+ = service\(/).slice(1);
  return blocs.map((b) => {
    const nom = b.match(/^"([a-z-]+)"/)![1];
    const repliques = Number(b.match(/replicas: \{ \[REGION\]: (\d+) \}/)?.[1] ?? 1);
    const pool = /PGPOOL_MAX: preserve\(\)/.test(b) ? "preserve" : b.match(/PGPOOL_MAX: "(\d+)"/) ? Number(b.match(/PGPOOL_MAX: "(\d+)"/)![1]) : null;
    return { nom, repliques, pool };
  });
}

describe("C0 — connexions : la somme des pools tient sous max_connections", () => {
  it("chaque service qui atteint la base déclare son pool ; mcp n'en a pas", () => {
    const liste = services();
    expect(liste.map((s) => s.nom).sort()).toEqual(["api", "collector", "console-api", "mcp", "notifier", "scheduler"]);
    for (const s of liste) {
      if (s.nom === "mcp") expect(s.pool, "mcp n'atteint pas la base").toBeNull();
      else expect(s.pool, `${s.nom} : PGPOOL_MAX déclaré`).not.toBeNull();
    }
  });

  it(`les services Railway prennent au plus ${BUDGET_RAILWAY} des ${MAX_CONNECTIONS_NEON} connexions`, () => {
    const total = services().reduce((n, s) => {
      const pool = s.pool === "preserve" ? POOL_SCHEDULER_PRODUCTION : s.pool ?? 0;
      return n + s.repliques * pool;
    }, 0);
    // Aujourd'hui : collector 2×8, api 2×6, console-api 2×6, scheduler 4, notifier 2.
    expect(total).toBe(46);
    expect(total).toBeLessThanOrEqual(BUDGET_RAILWAY);
    expect(BUDGET_RAILWAY).toBeLessThan(MAX_CONNECTIONS_NEON);
  });
});
