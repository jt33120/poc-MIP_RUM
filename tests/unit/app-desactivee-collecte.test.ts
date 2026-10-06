// Désactiver une application coupe sa collecte (recette du 26/09/2026).
//
// La production tourne en `REQUIRE_API_KEY=false` (console sur Vercel comme
// collector sur Railway), et le bouton « Désactiver » de l'administration promet
// que la collecte s'arrête. Le contrôle de `active` vivait derrière le
// court-circuit de `requireApiKey` dans `createPgAuth.checkApiKey` : une
// application désactivée continuait d'écrire. Depuis C12 (06/10/2026), le
// collector est le SEUL port qui écrit (la console relaie) : ce fichier lui
// envoie le lot et exige le 403, sans une ligne écrite.
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const { requetes, poolDeTest } = vi.hoisted(() => {
  const requetes: string[] = [];
  const REGISTRE = [
    { app_id: "app-coupee", api_key_hash: null, active: false, allowed_origins: [], ingestion_suspended_at: null },
    { app_id: "app-ouverte", api_key_hash: null, active: true, allowed_origins: [], ingestion_suspended_at: null },
  ];
  const query = async (text: string) => {
    requetes.push(text);
    if (text.includes("app_registry")) return { rows: REGISTRE.map((r) => ({ ...r })) };
    if (text.includes("rate_check")) return { rows: [{ ok: true }] };
    return { rows: [] };
  };
  return { requetes, poolDeTest: { query, connect: async () => ({ query, release() {} }) } };
});

// @ts-expect-error module ESM partagé, sans déclarations
import { creerReceveur } from "../../packages/backend/lib/receiver.mjs";

function lot(app: string): string {
  const t = (BigInt(Date.now()) * 1_000_000n).toString();
  const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  return JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [attr("mip.app_id", app)] },
      scopeSpans: [{ spans: [{
        name: "rum.pageview", traceId: "c".repeat(32), spanId: "d".repeat(16), startTimeUnixNano: t, endTimeUnixNano: t,
        attributes: [attr("mip.session_id", `${app}-session`), attr("mip.event_type", "pageview"), attr("mip.page", "/")],
      }] }],
    }],
  });
}

/** Une requête d'écriture : tout ce qui n'est ni le registre, ni le débit, ni le sondage de colonnes. */
const ecritures = () =>
  requetes.filter((q) => /\b(insert|update|delete)\b/i.test(q) && !q.includes("rate_check"));

const silencieux = { debug() {}, info() {}, warn() {}, error() {} };

async function posterAuCollector(corps: string): Promise<Response> {
  const { handler } = creerReceveur(poolDeTest, { requireApiKey: false, log: silencieux, env: {} });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const adresse = server.address();
    if (!adresse || typeof adresse === "string") throw new Error("port de test indisponible");
    return await fetch(`http://127.0.0.1:${adresse.port}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: corps,
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

afterEach(() => {
  requetes.length = 0;
});

describe("application désactivée, REQUIRE_API_KEY=false : la collecte est coupée", () => {
  it("collector : 403, rien d'écrit", async () => {
    const res = await posterAuCollector(lot("app-coupee"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "inactive app: app-coupee" });
    expect(ecritures()).toEqual([]);
  });

  it("une application active passe toujours", async () => {
    expect((await posterAuCollector(lot("app-ouverte"))).status).toBe(200);
    expect(ecritures().length).toBeGreaterThan(0);
  });
});
