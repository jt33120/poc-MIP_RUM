// @mip/service-kit — pg.mjs : le pool reçoit `pg` en paramètre (zéro
// dépendance), pose son écouteur 'error' (sans lui, un client inactif coupé
// par le pooler tue le processus), borne toutes ses attentes, se nomme dans
// pg_stat_activity — et n'envoie AUCUN SET de session.
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPool, describeTarget, optionsSsl, ping } from "../../packages/service-kit/pg.mjs";
import { createMetrics } from "../../packages/service-kit/metrics.mjs";

/** Un faux module `pg` : un Pool qui note sa configuration et ses requêtes. */
function fauxPg() {
  const instances: any[] = [];
  class Pool extends EventEmitter {
    config: any;
    requetes: any[] = [];
    fins = 0;
    totalCount = 3;
    idleCount = 2;
    waitingCount = 0;
    reponse: () => Promise<unknown> = async () => ({ rows: [{ "?column?": 1 }] });
    constructor(config: any) {
      super();
      this.config = config;
      instances.push(this);
    }
    query(q: any) {
      this.requetes.push(q);
      return this.reponse();
    }
    async end() {
      this.fins += 1;
      if (this.fins > 1) throw new Error("Called end on pool more than once");
    }
  }
  return { Pool, instances };
}

const CS = "postgres://u:p@db.exemple.fr:5432/mip";

describe("service-kit/pg — createPool", () => {
  it("pose les délais, le nom d'application et le keepalive ; TLS vérifié hors réseau privé", () => {
    const pg = fauxPg();
    createPool(pg, { connectionString: CS, applicationName: "mip-scheduler", max: 4 });
    expect(pg.instances[0].config).toEqual({
      connectionString: CS,
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      query_timeout: 30000,
      application_name: "mip-scheduler",
      keepAlive: true,
      ssl: { rejectUnauthorized: true },
    });
  });

  it("aucun SET de session : ni requête à la création, ni écouteur 'connect', ni statement_timeout", () => {
    const pg = fauxPg();
    const pool = createPool(pg, { connectionString: CS, applicationName: "x" });
    expect(pool.requetes).toHaveLength(0);
    expect(pool.listenerCount("connect")).toBe(0);
    expect(pool.listenerCount("acquire")).toBe(0);
    expect(JSON.stringify(pool.config)).not.toMatch(/statement_timeout|options/);
  });

  it("pose on('error') : un client inactif coupé est journalisé et compté, le processus vit", () => {
    const pg = fauxPg();
    const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const metrics = createMetrics();
    const pool = createPool(pg, { connectionString: CS, applicationName: "x", log: log as any, metrics });
    expect(pool.listenerCount("error")).toBe(1);
    // Sans écouteur, EventEmitter LÈVERAIT ici : c'est la mort du processus.
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("connexion inactive perdue"), expect.objectContaining({ err: expect.any(Error) }));
  });

  it("expose l'état du pool en métriques", async () => {
    const pg = fauxPg();
    const metrics = createMetrics();
    const pool = createPool(pg, { connectionString: CS, applicationName: "x", metrics });
    pool.emit("error", new Error("coupé"));
    const texte = await metrics.render();
    expect(texte).toContain('pg_pool_connections{state="total"} 3');
    expect(texte).toContain('pg_pool_connections{state="idle"} 2');
    expect(texte).toContain("pg_pool_errors_total 1");
  });

  it("nettoie le nom d'application (ASCII, 63 caractères) et refuse les oublis", () => {
    const pg = fauxPg();
    createPool(pg, { connectionString: CS, applicationName: `mip-é-${"x".repeat(80)}` });
    const nom = pg.instances[0].config.application_name;
    expect(nom).toMatch(/^mip-_-x+$/);
    expect(nom).toHaveLength(63);
    expect(() => createPool(pg, { applicationName: "x" } as any)).toThrow(/connectionString/);
    expect(() => createPool(pg, { connectionString: CS } as any)).toThrow(/applicationName/);
    expect(() => createPool({} as any, { connectionString: CS, applicationName: "x" })).toThrow(/pg/);
  });

  it("avec un cycle de vie : pool.end() enregistré en fermeture, idempotent", async () => {
    const pg = fauxPg();
    const fermetures: Array<() => unknown> = [];
    const lifecycle = { onClose: (_nom: string, fn: () => unknown) => fermetures.push(fn) };
    const pool = createPool(pg, { connectionString: CS, applicationName: "x", lifecycle: lifecycle as any });
    expect(fermetures).toHaveLength(1);
    await fermetures[0]();
    await fermetures[0]();
    expect(pool.fins).toBe(1);
  });
});

describe("service-kit/pg — ping", () => {
  afterEach(() => vi.useRealTimers());

  it("fait un select 1 borné par query_timeout", async () => {
    const pg = fauxPg();
    const pool = createPool(pg, { connectionString: CS, applicationName: "x" });
    await ping(pool, { timeoutMs: 500 });
    expect(pool.requetes[0]).toEqual({ text: "select 1", query_timeout: 500 });
  });

  it("rend la main au délai même si la requête pend, sans rejet orphelin", async () => {
    const pg = fauxPg();
    const pool = createPool(pg, { connectionString: CS, applicationName: "x" });
    let rejeterTard: (e: Error) => void = () => {};
    pool.reponse = () => new Promise((_, rej) => (rejeterTard = rej));
    const orphelins: unknown[] = [];
    const surRejet = (r: unknown) => orphelins.push(r);
    process.on("unhandledRejection", surRejet);
    try {
      const debut = Date.now();
      await expect(ping(pool, { timeoutMs: 50 })).rejects.toThrow(/pas de réponse en 50 ms/);
      expect(Date.now() - debut).toBeLessThan(1000);
      rejeterTard(new Error("la requête perdante échoue plus tard"));
      await new Promise((r) => setTimeout(r, 20));
      expect(orphelins).toEqual([]);
    } finally {
      process.off("unhandledRejection", surRejet);
    }
  });
});

describe("service-kit/pg — TLS et cible", () => {
  it("optionsSsl : TLS vérifié hors réseau privé, jamais désactivé", () => {
    expect(optionsSsl("postgres://u:p@db:5432/mip")).toBeUndefined();
    expect(optionsSsl("postgres://u:p@ep-x.neon.tech/neondb")).toEqual({ rejectUnauthorized: true });
    expect(optionsSsl("pas une url")).toEqual({ rejectUnauthorized: true });
  });

  it("describeTarget ne rend jamais le mot de passe", () => {
    expect(describeTarget(CS)).toEqual({ host: "db.exemple.fr:5432", database: "mip", user: "u" });
    expect(JSON.stringify(describeTarget("postgres://u:secret@@@"))).not.toContain("secret");
  });
});
