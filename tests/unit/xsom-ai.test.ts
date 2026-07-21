// Façade xSOM (ADR-0001, sens 2). Verrouille le contrat de dégradation :
// fetchAiSummary ne lève JAMAIS et renvoie `null` dès que xSOM n'est pas
// exploitable (non configuré / 4xx-5xx / payload malformé / réseau). Côté
// rumSummary, ce `null` → ai_status="unavailable" (aucun recalcul local).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAiSummary } from "../../apps/console/lib/xsom-ai";

const OK_PAYLOAD = {
  ai_calls: 3,
  ai_tokens: 100,
  ai_cost_usd: 0.5,
  ai_p75_latency_ms: 200,
  ai_error_rate: 0,
  ai_by_model: [],
  ai_top_users: [],
  ai_by_operation: [],
  ai_series: [],
};

function configure() {
  vi.stubEnv("XSOM_AI_URL", "https://xsom.example/v1");
  vi.stubEnv("XSOM_AI_TOKEN", "xsr_test");
}

describe("fetchAiSummary — façade xSOM (null = indisponible, jamais d'exception)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("null si XSOM_AI_URL / XSOM_AI_TOKEN non configuré", async () => {
    vi.stubEnv("XSOM_AI_URL", "");
    vi.stubEnv("XSOM_AI_TOKEN", "");
    expect(await fetchAiSummary("gip-plateforme", "7d")).toBeNull();
  });

  it("renvoie les champs IA sur 200 valide", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(OK_PAYLOAD), { status: 200 })),
    );
    const r = await fetchAiSummary("gip-plateforme", "7d");
    expect(r?.ai_calls).toBe(3);
    expect(Array.isArray(r?.ai_by_operation)).toBe(true);
  });

  it("null sur 4xx/5xx (dégradation douce)", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    expect(await fetchAiSummary("gip-plateforme", "7d")).toBeNull();
  });

  it("null sur payload malformé (garde de forme)", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ oops: true }), { status: 200 })),
    );
    expect(await fetchAiSummary("gip-plateforme", "7d")).toBeNull();
  });

  it("null sur erreur réseau (fetch rejette) — pas de propagation", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchAiSummary("gip-plateforme", "7d")).resolves.toBeNull();
  });
});
