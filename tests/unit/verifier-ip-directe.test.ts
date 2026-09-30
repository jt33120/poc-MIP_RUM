// scripts/ops/verifier-ip-directe.mjs — la preuve exigée avant d'allumer le GeoIP
// de la collecte directe : la façade Railway écrase-t-elle une adresse forgée ?
//
// Un vrai serveur du kit, câblé comme le collector (sonde, préflight CORS,
// diagnostic derrière le jeton), et trois façades simulées DEVANT lui par le
// `fetch` injecté : une qui écrase `X-Real-IP` (comme on l'attend de Railway),
// une qui le laisse passer, et aucune (requête arrivée hors façade). Le script ne
// doit conclure « sûr » que dans le premier cas, et « forgeable » passe devant
// tout autre échec.
import { afterEach, describe, expect, it } from "vitest";
import { startService } from "../../packages/service-kit/http.mjs";
import { createLogger } from "../../packages/service-kit/log.mjs";
// @ts-expect-error modules ESM partagés, sans déclarations
import { diagnostiquerFacade } from "../../packages/backend/shared/client-ip.mjs";
// @ts-expect-error idem
import { corsHeaders, REPLAY_ALLOW_HEADERS } from "../../packages/backend/shared/cors.mjs";
// @ts-expect-error idem
import { verifier } from "../../scripts/ops/verifier-ip-directe.mjs";

const JETON = "m".repeat(40);
const ORIGINE = "https://mip-rum-console.vercel.app";
const aFermer: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(aFermer.splice(0).map((f) => f()));
});

async function collector({
  origines = [ORIGINE],
  geoip = { source_ip: "none", etat: "eteint" },
  enTetesRejeu = REPLAY_ALLOW_HEADERS as string,
} = {}) {
  const log = createLogger("test-verif", { version: "", replica: "", level: "error", sink: { out: () => {}, err: () => {} } });
  const svc = startService({
    name: "collector",
    log,
    port: 0,
    host: "127.0.0.1",
    metricsToken: JETON,
    details: () => ({ service: "collector", geoip }),
    diagnostics: { "/diagnostic/ip": (req: any) => ({ source_ip: geoip.source_ip, ...diagnostiquerFacade(req) }) },
    handler: (req: any, res: any) => {
      // Le préflight du receveur : même module CORS que le collector, en-têtes
      // `x-mip-*` annoncés sur le rejeu seulement (`receiver.mjs`).
      const rejeu = String(req.url).startsWith("/v1/replay");
      res.writeHead(
        req.method === "OPTIONS" ? 204 : 404,
        corsHeaders(req.headers.origin ?? "", origines, rejeu ? { allowHeaders: enTetesRejeu } : undefined),
      );
      res.end();
    },
  } as any);
  const { port } = await svc.listening;
  aFermer.push(() => svc.close({ signal: AbortSignal.abort() }));
  return `http://127.0.0.1:${port}`;
}

/** Une façade simulée : ce qu'elle fait des en-têtes du client avant de les passer au service. */
function facade(transformer: (h: Headers) => void): typeof fetch {
  return (url: any, init: any = {}) => {
    const h = new Headers(init.headers);
    transformer(h);
    return fetch(url, { ...init, headers: h });
  };
}
const ECRASE = facade((h) => {
  h.set("x-railway-edge", "railway/europe-west4");
  h.set("x-real-ip", "212.27.38.253");
  h.set("x-forwarded-for", `${h.get("x-forwarded-for")}, 212.27.38.253`);
});
const LAISSE_PASSER = facade((h) => h.set("x-railway-edge", "railway/europe-west4"));

describe("verifier-ip-directe — trois lectures, et un verdict", () => {
  it("façade qui écrase + CORS accepté : code 0, et aucune adresse dans ce qui s'affiche", async () => {
    const collecteur = await collector();
    const { lignes, code } = await verifier({ collector: collecteur, origine: ORIGINE, jeton: JETON, fetch: ECRASE });
    expect(code).toBe(0);
    expect(lignes.join("\n")).toContain("la façade écrase l'adresse forgée");
    expect(lignes.join("\n")).toContain(`CORS : ${ORIGINE} est acceptée`);
    expect(lignes.join("\n")).not.toContain("212.27.38.253");
  });

  it("façade qui laisse passer le X-Real-IP du client : code 1, NE PAS allumer", async () => {
    const collecteur = await collector();
    const { lignes, code } = await verifier({ collector: collecteur, origine: ORIGINE, jeton: JETON, fetch: LAISSE_PASSER });
    expect(code).toBe(1);
    expect(lignes.join("\n")).toContain("FORGEABLE");
  });

  it("« forgeable » passe devant un autre échec (ici, le CORS)", async () => {
    const collecteur = await collector({ origines: [] });
    const { code } = await verifier({ collector: collecteur, origine: ORIGINE, jeton: JETON, fetch: LAISSE_PASSER });
    expect(code).toBe(1);
  });

  it("sans façade devant (requête directe au processus) : rien de prouvé, code 2", async () => {
    const collecteur = await collector();
    const { lignes, code } = await verifier({ collector: collecteur, origine: ORIGINE, jeton: JETON });
    expect(code).toBe(2);
    expect(lignes.join("\n")).toContain("indéterminé");
  });

  it("origine de la console refusée au CORS : code 2, et le registre à corriger est nommé", async () => {
    const collecteur = await collector({ origines: [] });
    const { lignes, code } = await verifier({ collector: collecteur, origine: ORIGINE, jeton: JETON, fetch: ECRASE });
    expect(code).toBe(2);
    expect(lignes.join("\n")).toContain("app_registry.allowed_origins");
  });

  it("origine d'un site client (`--origine`) : ses deux préflights, et le registre de SON application en cas de refus", async () => {
    const CLIENT = "https://app.client.test";
    const accepte = await collector({ origines: [CLIENT] });
    const ok = await verifier({ collector: accepte, origine: CLIENT, jeton: JETON, fetch: ECRASE });
    expect(ok.code).toBe(0);
    expect(ok.lignes.join("\n")).toContain(`✓ CORS : ${CLIENT} est acceptée`);
    expect(ok.lignes.join("\n")).toContain("✓ CORS du rejeu");

    const refuse = await collector({ origines: [] });
    const ko = await verifier({ collector: refuse, origine: CLIENT, jeton: JETON, fetch: ECRASE });
    expect(ko.code).toBe(2);
    expect(ko.lignes.join("\n")).toContain("de l'application de ce site");
  });

  it("rejeu sans les en-têtes x-mip-* annoncés : code 2, et lesquels manquent", async () => {
    const collecteur = await collector({ enTetesRejeu: "content-type" });
    const { lignes, code } = await verifier({ collector: collecteur, origine: ORIGINE, jeton: JETON, fetch: ECRASE });
    expect(code).toBe(2);
    expect(lignes.join("\n")).toContain("x-mip-session");
  });

  it("jeton faux (ou collector sans le diagnostic) : 404, code 2", async () => {
    const collecteur = await collector();
    const { lignes, code } = await verifier({ collector: collecteur, origine: ORIGINE, jeton: "faux", fetch: ECRASE });
    expect(code).toBe(2);
    expect(lignes.join("\n")).toContain("404");
  });

  it("après l'apply : source « railway » avec une base éteinte est un échec, pas un succès", async () => {
    const collecteur = await collector({ geoip: { source_ip: "railway", etat: "eteint" } });
    const { lignes, code } = await verifier({ collector: collecteur, origine: ORIGINE, jeton: JETON, fetch: ECRASE });
    expect(code).toBe(2);
    expect(lignes.join("\n")).toContain("base éteinte");
  });
});
