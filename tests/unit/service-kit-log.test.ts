// @mip/service-kit — log.mjs : ce que le journal ajoute (version, réplique,
// contexte, pile complète) et ce qu'il ne laisse JAMAIS sortir (secret, IP,
// e-mail). Plus la garantie de continuité : `@mip/backend/shared/log.mjs` rend
// exactement le même logger, ses appelants n'ont rien à changer.
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, LOG_LEVELS, setLogContextProvider } from "../../packages/service-kit/log.mjs";
import { currentContext, withContext } from "../../packages/service-kit/context.mjs";
import * as relais from "../../packages/backend/shared/log.mjs";

/** Un logger qui écrit dans des tableaux plutôt que sur la console. */
function capturer(options: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const log = createLogger("svc", { version: "", replica: "", ...options, sink: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } });
  const lignes = () => [...out, ...err].map((l) => JSON.parse(l));
  return { log, out, err, lignes };
}

describe("service-kit/log — identité du processus", () => {
  it("porte version et réplique quand elles sont connues", () => {
    const { log, lignes } = capturer({ version: "abc123", replica: "r-1" });
    log.info("x");
    expect(lignes()[0]).toMatchObject({ level: "info", service: "svc", version: "abc123", replica: "r-1", msg: "x" });
  });

  it("les lit dans l'env Railway par défaut (SHA court), et les omet hors Railway", () => {
    const avant = { ...process.env };
    try {
      process.env.RAILWAY_GIT_COMMIT_SHA = "0123456789abcdef0123";
      process.env.RAILWAY_REPLICA_ID = "replica-42";
      delete process.env.SERVICE_VERSION;
      const out: string[] = [];
      createLogger("svc", { sink: { out: (l: string) => out.push(l), err: () => {} } }).info("x");
      expect(JSON.parse(out[0])).toMatchObject({ version: "0123456789ab", replica: "replica-42" });

      delete process.env.RAILWAY_GIT_COMMIT_SHA;
      delete process.env.RAILWAY_REPLICA_ID;
      const out2: string[] = [];
      createLogger("svc", { sink: { out: (l: string) => out2.push(l), err: () => {} } }).info("x");
      const o = JSON.parse(out2[0]);
      expect("version" in o).toBe(false);
      expect("replica" in o).toBe(false);
    } finally {
      process.env = avant;
    }
  });

  it("respecte le seuil de niveau et sépare les flux", () => {
    const { log, out, err } = capturer({ level: "warn" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(out).toHaveLength(0);
    expect(err).toHaveLength(2);
    expect(LOG_LEVELS.warn).toBeLessThan(LOG_LEVELS.error);
  });
});

describe("service-kit/log — erreurs", () => {
  it("garde la pile COMPLÈTE et la cause", () => {
    const { log, lignes } = capturer();
    const cause = new Error("connexion coupée");
    const e = Object.assign(new Error("écriture impossible", { cause }), { code: "57P01" });
    log.error("boom", { err: e });
    const o = lignes()[0];
    expect(o.err).toMatchObject({ name: "Error", message: "écriture impossible", code: "57P01" });
    expect(o.err.stack).toContain("écriture impossible");
    expect(o.err.stack).toContain("service-kit-log.test");
    expect(o.err.cause.message).toBe("connexion coupée");
    expect(o.err.cause.stack).toBeTypeOf("string");
  });

  it("ne recopie pas les propriétés arbitraires d'une erreur (ni `detail` pg)", () => {
    const { log, lignes } = capturer();
    const e = Object.assign(new Error("duplicate key"), { detail: "Key (email)=(a@b.fr) already exists", config: { password: "x" } });
    log.error("boom", { err: e });
    const texte = JSON.stringify(lignes()[0]);
    expect(texte).not.toContain("a@b.fr");
    expect(texte).not.toContain('"password"');
  });

  it("survit à une cause cyclique", () => {
    const { log, lignes } = capturer();
    const e: Error & { cause?: unknown } = new Error("boucle");
    e.cause = e;
    expect(() => log.error("x", { err: e })).not.toThrow();
    expect(JSON.stringify(lignes()[0])).toContain("[circular]");
  });
});

describe("service-kit/log — ce qui ne sort jamais", () => {
  it("expurge les adresses IP, où qu'elles soient rangées", () => {
    const { log, lignes } = capturer();
    log.info("req", {
      ip: "203.0.113.7",
      client_ip: "203.0.113.8",
      headers: { "x-forwarded-for": "203.0.113.9", "X-Real-IP": "203.0.113.10", "user-agent": "curl" },
      remoteAddress: "203.0.113.11",
    });
    const texte = JSON.stringify(lignes()[0]);
    expect(texte).not.toMatch(/203\.0\.113/);
    expect(lignes()[0].headers["user-agent"]).toBe("curl");
    expect(lignes()[0].ip).toBe("[redacted]");
  });

  it("expurge secrets et e-mails, sans toucher aux clés voisines", () => {
    const { log, lignes } = capturer();
    log.info("x", { authorization: "Bearer t", cookie: "s=1", email: "a@b.fr", database_url: "postgres://u:p@h/db", secret_configure: true });
    const o = lignes()[0];
    expect(o.authorization).toBe("[redacted]");
    expect(o.cookie).toBe("[redacted]");
    expect(o.email).toBe("[redacted]");
    expect(o.database_url).toBe("[redacted]");
    expect(o.secret_configure).toBe(true);
  });

  it("tronque au-delà de la profondeur maximale au lieu de sortir l'objet non expurgé", () => {
    const { log, lignes } = capturer();
    log.info("x", { a: { b: { c: { d: { e: { f: { g: { token: "fuite" } } } } } } } });
    expect(JSON.stringify(lignes()[0])).not.toContain("fuite");
    expect(JSON.stringify(lignes()[0])).toContain("[tronqué]");
  });

  it("ne lève jamais chez l'appelant, même si la sortie casse", () => {
    const log = createLogger("svc", { sink: { out: () => { throw new Error("EPIPE"); }, err: () => {} } });
    expect(() => log.info("x", { n: 1n })).not.toThrow();
  });
});

describe("service-kit/log — contexte (request_id, run_id)", () => {
  afterEach(() => {
    // context.mjs rebranche son fournisseur à l'import ; on le restaure.
    setLogContextProvider(() => currentContext());
  });

  it("une ligne émise sous withContext porte ses champs, même à travers des await", async () => {
    const { log, lignes } = capturer();
    await withContext({ request_id: "req-1" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      log.info("au fond du pipeline");
    });
    log.info("hors contexte");
    expect(lignes()[0].request_id).toBe("req-1");
    expect("request_id" in lignes()[1]).toBe(false);
  });

  it("les contextes s'emboîtent : un tour de boucle garde son run_id dans une requête", () => {
    const { log, lignes } = capturer();
    withContext({ run_id: "run-9" }, () => withContext({ request_id: "req-2" }, () => log.info("x")));
    expect(lignes()[0]).toMatchObject({ run_id: "run-9", request_id: "req-2" });
  });

  it("un fournisseur qui lève ne coûte que le contexte, pas la ligne", () => {
    setLogContextProvider(() => {
      throw new Error("cassé");
    });
    const { log, lignes } = capturer();
    log.info("toujours là");
    expect(lignes()[0].msg).toBe("toujours là");
  });

  it("child() hérite, et les sous-loggers se déclinent à nouveau", () => {
    const { log, lignes } = capturer();
    log.child({ app_id: "demo" }).child({ job: "tick" }).warn("x", { n: 1 });
    expect(lignes()[0]).toMatchObject({ app_id: "demo", job: "tick", n: 1, level: "warn" });
  });
});

describe("@mip/backend/shared/log.mjs — relais du kit", () => {
  it("réexporte le même logger : un seul endroit décide de l'expurgation", () => {
    expect(relais.createLogger).toBe(createLogger);
    expect(relais.LOG_LEVELS).toBe(LOG_LEVELS);
  });
});
