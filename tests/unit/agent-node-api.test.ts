// P7.4 — API publique de l'agent Node, contre l'instrumentation RÉELLE.
//
// Ce fichier ne teste pas des constructeurs de spans (agent-node.test.ts le
// fait) : il installe le runtime, sert de vraies requêtes HTTP et vérifie ce qui
// ne se voit que là — que cent requêtes concurrentes ne se prêtent jamais leur
// contexte, qu'un scope imbriqué ou rejeté restaure le précédent, qu'un span de
// base de données se rattache au span de SA requête, et qu'une exception vue
// deux fois ne compte qu'une erreur.
//
// L'horloge est injectée : aucune durée ne dépend de la charge de la machine.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, get, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as agent from "../../packages/agent-node/src/index";
import { flattenOtlp, flattenOtlpLogs } from "../../packages/backend/shared/otlp.mjs";

type Attribut = { key: string; value: Record<string, unknown> };
type Lot = { url: string; corps: any };

const lots: Lot[] = [];
let horloge = 1_760_000_000_000;
let serveur: Server;
let port = 0;

const attrs = (liste: Attribut[] = []) =>
  Object.fromEntries(liste.map((a) => [a.key, Object.values(a.value)[0]]));
const spansEmis = () =>
  lots.flatMap((l) => l.corps.resourceSpans ?? []).flatMap((r: any) => r.scopeSpans).flatMap((s: any) => s.spans);
const logsEmis = () =>
  lots.flatMap((l) => l.corps.resourceLogs ?? []).flatMap((r: any) => r.scopeLogs).flatMap((s: any) => s.logRecords);

/** Appelle le serveur de test et attend la réponse complète. */
function appeler(chemin: string, entetes: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const requete = get({ host: "127.0.0.1", port, path: chemin, headers: entetes }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    requete.on("error", reject);
  });
}

beforeAll(async () => {
  agent.init({
    endpoint: "http://collecteur.invalide/v1/traces",
    appId: "p74",
    service: "api",
    quiet: true,
    // Aucun timer périodique : chaque test vide la file quand il l'a décidé.
    flushIntervalMs: 0,
    clock: () => horloge,
    transport: async (url, body) => {
      lots.push({ url, corps: JSON.parse(body) });
      return true;
    },
  });
  serveur = createServer(async (req, res) => {
    try {
      await traiter(req.url ?? "/");
      res.statusCode = 200;
    } catch {
      res.statusCode = 500;
    }
    res.end("ok");
  });
  await new Promise<void>((resolve) => serveur.listen(0, "127.0.0.1", resolve));
  const adresse = serveur.address();
  if (!adresse || typeof adresse === "string") throw new Error("serveur de test indisponible");
  port = adresse.port;
});

afterAll(async () => {
  await agent.shutdown({ timeoutMs: 100 });
  await new Promise<void>((resolve) => serveur.close(() => resolve()));
});

beforeEach(() => {
  lots.length = 0;
  agent.clearGlobalContext();
});

/** Gestionnaire du serveur de test : c'est lui qui pose les scopes. */
let traiter: (url: string) => Promise<void> = async () => {};

describe("agent-node — 100 requêtes concurrentes A/B, contextes distincts", () => {
  it("chaque requête garde SON contexte, imbriqué ou rejeté, et rien ne fuit", async () => {
    traiter = async (url) => {
      const [, groupe, brut] = url.split("/");
      const n = Number(brut);
      await agent.withContext({ userId: `u-${groupe}-${n}`, attributes: { groupe, n } }, async () => {
        // Ordonnancement croisé : la requête n finit après la requête n+1.
        await new Promise((resolve) => setTimeout(resolve, (n % 5) + 1));
        // Scope imbriqué : il hérite du parent et le restaure en sortant.
        await agent.withContext({ attributes: { etape: "calcul" } }, async () => {
          expect(agent.getContext()?.attributes).toEqual({ groupe, n, etape: "calcul" });
        });
        expect(agent.getContext()?.attributes).toEqual({ groupe, n });
        // Un scope rejeté restaure lui aussi le contexte précédent.
        if (n % 3 === 0) {
          await agent
            .withContext({ attributes: { etape: "paiement" } }, async () => {
              throw new Error(`rejet ${n}`);
            })
            .catch(() => {});
          expect(agent.getContext()?.attributes).toEqual({ groupe, n });
        }
        agent.track("etape_terminee", { n });
      });
      // Sortie du scope : la vue lexicale disparaît, mais ce que la requête a
      // DÉCLARÉ lui reste — c'est ce que portera son span.
      expect(agent.getContext()?.attributes).toEqual({
        groupe,
        n,
        etape: n % 3 === 0 ? "paiement" : "calcul",
      });
    };

    const chemins = Array.from({ length: 100 }, (_, i) => `/${i % 2 === 0 ? "a" : "b"}/${i}`);
    const codes = await Promise.all(chemins.map((chemin) => appeler(chemin)));
    expect(codes.every((code) => code === 200)).toBe(true);
    await agent.flush({ timeoutMs: 1000 });

    const requetes = spansEmis().filter((s: any) => s.name === "http.server");
    expect(requetes).toHaveLength(100);
    // Indexé par le contexte lui-même : c'est lui qu'une fuite mélangerait.
    const parContexte = new Map(
      requetes.map((s: any) => {
        const a = attrs(s.attributes);
        return [Number(JSON.parse(String(a["mip.context"])).n), a];
      }),
    );
    expect(parContexte.size).toBe(100);
    for (let i = 0; i < 100; i++) {
      const groupe = i % 2 === 0 ? "a" : "b";
      const a = parContexte.get(i);
      expect(a, `requête ${i}`).toBeTruthy();
      // Le contexte de la requête i n'a JAMAIS celui d'une autre.
      expect(JSON.parse(String(a!["mip.context"]))).toEqual({
        groupe,
        n: i,
        etape: i % 3 === 0 ? "paiement" : "calcul",
      });
      expect(a!["mip.identity.user_id"]).toBe(`u-${groupe}-${i}`);
      // La route reste templatée : la cardinalité ne suit pas les identifiants.
      expect(a!["mip.route"]).toBe(`/${groupe}/:id`);
    }
    // 100 événements métier, un par requête, chacun enfant de SON span.
    const evenements = spansEmis().filter((s: any) => String(s.name).startsWith("track."));
    expect(evenements).toHaveLength(100);
    const parents = new Set(evenements.map((s: any) => s.parentSpanId));
    expect(parents.size).toBe(100);

    // Hors de toute requête, il n'existe aucun contexte résiduel.
    expect(agent.getContext()).toBeNull();
  }, 30_000);
});

describe("agent-node — le contexte ne survit pas à son scope", () => {
  it("synchrone, asynchrone, levée et rejet restaurent tous le contexte précédent", async () => {
    expect(agent.getContext()).toBeNull();
    agent.withContext({ attributes: { a: 1 } }, () => {
      expect(agent.getContext()?.attributes).toEqual({ a: 1 });
    });
    expect(agent.getContext()).toBeNull();

    await agent.withContext({ attributes: { a: 2 } }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(agent.getContext()?.attributes).toEqual({ a: 2 });
    });
    expect(agent.getContext()).toBeNull();

    expect(() => agent.withContext({ attributes: { a: 3 } }, () => {
      throw new Error("boum");
    })).toThrow("boum");
    expect(agent.getContext()).toBeNull();

    await expect(agent.withContext({ attributes: { a: 4 } }, async () => {
      throw new Error("rejet");
    })).rejects.toThrow("rejet");
    expect(agent.getContext()).toBeNull();
  });

  it("un traceparent hostile ne rattache pas le scope à la trace d'un autre", () => {
    agent.withContext({ traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" }, () => {
      expect(agent.getContext()?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
      agent.withContext({ traceparent: "00-pas-un-traceparent-01" }, () => {
        // Hérite du parent plutôt que d'inventer une trace depuis l'en-tête.
        expect(agent.getContext()?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
      });
    });
  });
});

describe("agent-node — contexte global : service seulement", () => {
  it("les attributs de service partent sur chaque signal, un user est refusé", async () => {
    expect(agent.setGlobalContext({ region: "eu-west-3" })).toBe(true);
    expect(agent.setGlobalContext({ region: "eu-west-3", userId: "u-1" })).toBe(false);
    traiter = async () => {};
    await appeler("/service");
    await agent.flush({ timeoutMs: 1000 });
    const [span] = spansEmis().filter((s: any) => s.name === "http.server");
    // Le refus n'a rien modifié : seul le premier appel compte.
    expect(JSON.parse(String(attrs(span.attributes)["mip.context"]))).toEqual({ region: "eu-west-3" });
  });
});

describe("agent-node — une exception vue deux fois reste UNE erreur", () => {
  it("dédupliquée par l'identifiant porté par l'Error, jamais par ressemblance", async () => {
    const erreur = new TypeError("total indéfini");
    traiter = async () => {
      // Voie automatique (pont de journalisation) puis capture manuelle : la
      // même Error, donc le même `mip.exception_id`.
      console.error("échec de paiement", erreur);
      expect(agent.captureException(erreur, { moyen: "carte" })).toBe(true);
      // Deuxième capture du même objet : rien de plus.
      expect(agent.captureException(erreur)).toBe(false);
      // Une AUTRE Error, même message : deux erreurs distinctes, à dessein.
      expect(agent.captureException(new TypeError("total indéfini"))).toBe(true);
    };
    await appeler("/paiement");
    await agent.flush({ timeoutMs: 1000 });

    const [span] = spansEmis().filter((s: any) => s.name === "http.server");
    const evenements = (span.events ?? []) as Array<{ name: string; attributes: Attribut[] }>;
    expect(evenements.map((e) => e.name)).toEqual(["exception", "exception"]);
    const identifiants = evenements.map((e) => attrs(e.attributes)["mip.exception_id"]);
    expect(new Set(identifiants).size).toBe(2);
    // Capture manuelle : la requête a répondu 200, elle n'est pas en échec.
    expect(span.status).toEqual({ code: 1 });
    expect(attrs(evenements[0].attributes)["mip.error_handled"]).toBe(true);

    const log = logsEmis().find((l: any) => attrs(l.attributes)["exception.type"]);
    expect(attrs(log.attributes)["mip.exception_id"]).toBe(identifiants[0]);

    // À l'ingestion : le log et l'événement de span de la MÊME Error portent la
    // même identité de ligne ; la seconde Error en a une autre.
    const deSpan = lots.filter((l) => l.corps.resourceSpans).flatMap((l) => flattenOtlp(l.corps).errors);
    const deLog = lots.filter((l) => l.corps.resourceLogs).flatMap((l) => flattenOtlpLogs(l.corps).errors);
    expect(deSpan).toHaveLength(2);
    expect(deLog).toHaveLength(1);
    expect(deLog[0].span_id).toBe(deSpan[0].span_id);
    expect(deSpan[1].span_id).not.toBe(deSpan[0].span_id);
    // Le contexte du scope accompagne l'erreur, sans second canal.
    expect(deSpan[0].context).toEqual({ moyen: "carte" });
  });

  it("hors requête, la capture passe par le log d'exception", async () => {
    expect(agent.getContext()).toBeNull();
    expect(agent.captureException(new RangeError("hors limites"))).toBe(true);
    await agent.flush({ timeoutMs: 1000 });
    const derives = lots.filter((l) => l.corps.resourceLogs).flatMap((l) => flattenOtlpLogs(l.corps).errors);
    expect(derives).toHaveLength(1);
    expect(derives[0]).toMatchObject({ error_source: "node", origin_signal: "log", handled: true });
    // Aucune session inventée pour une erreur qui n'en a pas.
    expect(derives[0].session_claim).toBeNull();
  });
});

describe("agent-node — span de base de données rattaché au span de SA requête", () => {
  const dossier = mkdtempSync(join(tmpdir(), "mip-agent-pg-"));
  let faussePg: { Client: new () => { query: (sql: string) => Promise<unknown> } };

  beforeAll(() => {
    // L'agent patche `pg` au CHARGEMENT, via un hook `require` — il n'en dépend
    // jamais. On lui présente donc un pilote minimal sous ce nom exact : c'est
    // le vrai chemin d'instrumentation qui est exercé, pas une imitation.
    mkdirSync(join(dossier, "node_modules", "pg"), { recursive: true });
    writeFileSync(join(dossier, "node_modules", "pg", "package.json"), '{"name":"pg","main":"index.js"}');
    writeFileSync(
      join(dossier, "node_modules", "pg", "index.js"),
      `class Client { query(sql) { return Promise.resolve({ sql }); } }
       module.exports = { Client };`,
    );
    writeFileSync(join(dossier, "app.js"), "");
    faussePg = createRequire(join(dossier, "app.js"))("pg");
  });

  afterAll(() => rmSync(dossier, { recursive: true, force: true }));

  it("le span DB porte la trace et le parent de sa requête, pas ceux d'une autre", async () => {
    traiter = async (url) => {
      const n = Number(url.split("/")[2]);
      await new Promise((resolve) => setTimeout(resolve, (n % 3) + 1));
      horloge += 7; // durée déterministe de la requête SQL
      await new faussePg.Client().query(`select * from commandes where id = ${n}`);
    };
    await Promise.all([appeler("/db/1"), appeler("/db/2"), appeler("/db/3")]);
    await agent.flush({ timeoutMs: 1000 });

    const requetes = spansEmis().filter((s: any) => s.name === "http.server");
    const dbs = spansEmis().filter((s: any) => String(s.name).startsWith("select"));
    expect(requetes).toHaveLength(3);
    expect(dbs).toHaveLength(3);
    const parId = new Map(requetes.map((s: any) => [s.spanId, s.traceId]));
    for (const db of dbs) {
      // Enfant du span http.server de SA requête, dans la MÊME trace.
      expect(parId.get(db.parentSpanId)).toBe(db.traceId);
      // Littéraux normalisés : aucune valeur n'est exfiltrée dans db.statement.
      expect(attrs(db.attributes)["db.statement"]).toBe("select * from commandes where id = ?");
    }
    expect(new Set(dbs.map((s: any) => s.parentSpanId)).size).toBe(3);
  });
});

describe("agent-node — files bornées et arrêt borné", () => {
  it("au plafond, le plus ancien part et se compte : la mémoire ne grossit pas", async () => {
    agent.init({ maxQueue: 5, quiet: true });
    const avant = agent.getDiagnostics().droppedSpans;
    traiter = async () => {
      for (let i = 0; i < 20; i++) agent.track(`evenement_${i}`);
    };
    await appeler("/saturation");
    const diagnostics = agent.getDiagnostics();
    expect(diagnostics.queuedSpans).toBeLessThanOrEqual(5);
    expect(diagnostics.droppedSpans).toBeGreaterThan(avant);
    await agent.flush({ timeoutMs: 1000 });
    agent.init({ maxQueue: 1000, quiet: true });
  });

  it("un collecteur muet ne retient pas l'arrêt : flush borné, échec compté", async () => {
    agent.init({
      quiet: true,
      transport: (url, body, timeoutMs) =>
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    });
    agent.track("evenement_bloque");
    const debut = Date.now();
    await expect(agent.flush({ timeoutMs: 40 })).resolves.toBe(false);
    expect(Date.now() - debut).toBeLessThan(2000);
    expect(agent.getDiagnostics().failedFlushes).toBeGreaterThan(0);
    agent.init({
      quiet: true,
      transport: async (url, body) => {
        lots.push({ url, corps: JSON.parse(body) });
        return true;
      },
    });
  });

  it("réinitialiser ne réinstrumente rien : un console.error reste un seul log", async () => {
    agent.init({ quiet: true });
    agent.init({ quiet: true });
    lots.length = 0;
    console.error("une seule fois");
    await agent.flush({ timeoutMs: 1000 });
    expect(logsEmis().filter((l: any) => String(l.body?.stringValue) === "une seule fois")).toHaveLength(1);
  });
});
