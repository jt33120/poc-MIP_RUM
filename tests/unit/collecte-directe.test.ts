// P6b.G — la collecte DIRECTE : un navigateur qui écrit au collector sans passer
// par la console, telle que le SDK la fait (`packages/rum-sdk/src/otel.ts`,
// `replay.ts`), vue du receveur (`creerReceveur`).
//
// POURQUOI UN FICHIER À PART. `collector-receveur.test.ts` éprouve le receveur
// pièce par pièce, avec un GeoIP factice et le socle CORS statique. Ici, c'est le
// PARCOURS d'une page cliente qu'on rejoue, avec ce que la production aura :
//   - une origine enregistrée au registre de l'app (`allowed_origins`), pas le socle ;
//   - la clé exigée (`REQUIRE_API_KEY: "true"` dans `.railway/railway.ts`) ;
//   - `GEOIP_IP_SOURCE=railway` : `X-Real-IP` ET un marqueur d'arête Railway ;
//   - une VRAIE base DB-IP (quatre plages) chargée par `creerGeoip`, pas un
//     résolveur factice : c'est elle qui doit faire écrire `geo_source = 'geoip'`.
// Le faux pool enregistre les requêtes : aucune base n'est touchée.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error module ESM partagé, sans déclarations
import { creerReceveur } from "../../packages/backend/lib/receiver.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { creerGeoip } from "../../packages/backend/lib/geoip-db.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { parseSourceIp } from "../../packages/backend/shared/client-ip.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { MAX_BODY_BYTES } from "../../packages/backend/shared/limits.mjs";
import { deriveReplayEndpoint } from "../../packages/rum-sdk/src/replay";
import { classerReponse, lireRetryAfter } from "../../packages/rum-sdk/src/retry";

const ORIGINE = "https://app.client.test";
const CLE = `mip_${"a1".repeat(16)}`;
const APP = "client-direct";
/** Une adresse publique que la base d'essai range en France (plage 2.0.0.0/12). */
const IP_FR = "2.3.4.5";
const EDGE = "e".repeat(40);

/** Le registre tel que `createPgAuth` le lit : une app active, sa clé hachée, son origine. */
const REGISTRE = [
  {
    app_id: APP,
    api_key_hash: createHash("sha256").update(CLE).digest("hex"),
    active: true,
    allowed_origins: [ORIGINE],
    ingestion_suspended_at: null,
  },
];

/** Colonnes optionnelles que `writeRows` sonde (même jeu que collector-receveur). */
const OPTIONNELLES: Record<string, string[]> = {
  rum_session: ["collection_source", "release", "net_type", "visitor_id", "sample_rate", "error_sample_rate", "has_error", "user_id_hash", "account_id_hash", "context", "geo_source", "geo_db_version"],
  rum_event: ["event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name", "action_id", "timing_ms", "feature_flag_value"],
};

function fauxPool({ debitDepasse = false } = {}) {
  const requetes: { text: string; params?: unknown[] }[] = [];
  const query = async (text: string, params?: unknown[]) => {
    requetes.push({ text, params });
    if (text.includes("from app_registry")) return { rows: REGISTRE };
    if (text.includes("information_schema.columns")) {
      return { rows: (OPTIONNELLES[String(params?.[0])] ?? []).map((column_name) => ({ column_name })) };
    }
    if (text.includes("rate_check")) return { rows: [{ ok: !debitDepasse }] };
    return { rows: [] };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) }, requetes };
}

// ── La base DB-IP d'essai : même format et même nom que la livraison réelle ──
let dossier = "";
let geoip: ReturnType<typeof creerGeoip>;
beforeAll(async () => {
  dossier = mkdtempSync(join(tmpdir(), "mip-geoip-"));
  const chemin = join(dossier, "dbip-country-lite-2026-09.csv");
  writeFileSync(
    chemin,
    [
      "0.0.0.0,0.255.255.255,ZZ",
      "1.0.0.0,1.0.0.255,AU",
      "2.0.0.0,2.15.255.255,FR",
      "2a01:cb00::,2a01:cbff:ffff:ffff:ffff:ffff:ffff:ffff,FR",
    ].join("\n"),
  );
  // L'âge de la livraison se lit dans son nom : horloge figée, le test ne périme pas.
  geoip = creerGeoip({ env: { GEOIP_DB_PATH: chemin }, maintenant: () => Date.UTC(2026, 8, 30) });
  await geoip.pret;
  expect(geoip.etat()).toBe("actif");
});
afterAll(() => rmSync(dossier, { recursive: true, force: true }));

const aFermer: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(aFermer.splice(0).map((f) => f()));
});

async function collector(opts: { debitDepasse?: boolean } = {}) {
  const { pool, requetes } = fauxPool(opts);
  const muet = { debug() {}, info() {}, warn() {}, error() {} };
  const receveur = creerReceveur(pool, {
    log: muet,
    env: {},
    requireApiKey: true,
    edgeSecrets: [EDGE],
    sourceIp: parseSourceIp("railway"),
    geoip,
  });
  const server = createServer(receveur.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  aFermer.push(() => new Promise((r) => server.close(() => r())));
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("port de test indisponible");
  return { base: `http://127.0.0.1:${adresse.port}`, requetes };
}

/** Le corps qu'envoie le SDK : resource avec `mip.api_key`, pageview avec `mip.tz`. */
function lotSdk({ cle = CLE as string | null, session = "direct-1" } = {}) {
  const t = (BigInt(Date.now()) * 1_000_000n).toString();
  const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  return JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [attr("mip.app_id", APP), ...(cle ? [attr("mip.api_key", cle)] : [])] },
      scopeSpans: [{ spans: [{
        name: "rum.pageview", traceId: "c".repeat(32), spanId: "d".repeat(16), startTimeUnixNano: t, endTimeUnixNano: t,
        attributes: [
          attr("mip.session_id", session),
          attr("mip.event_type", "pageview"),
          attr("mip.page", "/"),
          // Un fuseau new-yorkais : s'il gagnait, la session serait « US ».
          attr("mip.tz", "America/New_York"),
        ],
      }] }],
    }],
  });
}

/** Ce que pose la façade Railway sur une requête qui l'a traversée. */
const ARETE = { "x-real-ip": IP_FR, "x-railway-request-id": "req-1", "x-railway-edge": "railway/europe-west4" };

function sessionEcrite(requetes: { text: string; params?: unknown[] }[]) {
  const q = requetes.find((r) => /insert into rum_session/i.test(r.text));
  return JSON.stringify(q?.params ?? []);
}

describe("préflight CORS du navigateur", () => {
  it("traces : l'origine du registre est reflétée, `content-type` annoncé, POST permis", async () => {
    const { base } = await collector();
    const r = await fetch(`${base}/v1/traces`, {
      method: "OPTIONS",
      headers: { origin: ORIGINE, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGINE);
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
    expect(r.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("rejeu : chaque en-tête `x-mip-*` que le SDK pose est annoncé", async () => {
    const { base } = await collector();
    const r = await fetch(`${base}/v1/replay`, {
      method: "OPTIONS",
      headers: {
        origin: ORIGINE,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-mip-session,x-mip-app,x-mip-seq,x-mip-key",
      },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGINE);
    const annonces = (r.headers.get("access-control-allow-headers") ?? "").split(",").map((h) => h.trim());
    for (const h of ["content-type", "x-mip-session", "x-mip-app", "x-mip-seq", "x-mip-key"]) expect(annonces).toContain(h);
  });

  it("une origine absente du registre ne reçoit aucune autorisation", async () => {
    const { base } = await collector();
    const r = await fetch(`${base}/v1/traces`, { method: "OPTIONS", headers: { origin: "https://autre.test" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("traces en direct : clé, pays par adresse IP", () => {
  it("clé juste + arête Railway : 200, et le pays vient de l'ADRESSE (geoip), pas du fuseau", async () => {
    const { base, requetes } = await collector();
    const r = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { origin: ORIGINE, "content-type": "application/json", ...ARETE },
      body: lotSdk(),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGINE);
    const params = sessionEcrite(requetes);
    expect(params).toContain('"FR"');
    expect(params).toContain('"geoip"');
    expect(params).toContain('"dbip-country-lite-2026-09"');
    expect(params).not.toContain('"US"');
    // L'adresse n'est écrite nulle part : ni dans la session, ni dans une autre requête.
    expect(JSON.stringify(requetes)).not.toContain(IP_FR);
  });

  it("sans marqueur d'arête (appel qui n'a pas traversé la façade) : le fuseau reste", async () => {
    const { base, requetes } = await collector();
    const r = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { origin: ORIGINE, "content-type": "application/json", "x-real-ip": IP_FR },
      body: lotSdk(),
    });
    expect(r.status).toBe(200);
    const params = sessionEcrite(requetes);
    expect(params).toContain('"US"');
    expect(params).toContain('"timezone"');
    expect(params).not.toContain('"geoip"');
  });

  it("relayée par la console (bord signé) : jamais de GeoIP, même avec une adresse", async () => {
    const { base, requetes } = await collector();
    const r = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ARETE, "x-mip-edge-auth": EDGE, "x-mip-edge-country": "DE" },
      body: lotSdk(),
    });
    expect(r.status).toBe(200);
    expect(sessionEcrite(requetes)).not.toContain('"geoip"');
  });

  it("sans clé : 403 LISIBLE par la page (CORS posé), que le SDK ne rejoue pas", async () => {
    const { base, requetes } = await collector();
    const r = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { origin: ORIGINE, "content-type": "application/json", ...ARETE },
      body: lotSdk({ cle: null }),
    });
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGINE);
    expect(classerReponse(r.status).retryable).toBe(false);
    expect(requetes.some((q) => /insert into rum_session/i.test(q.text))).toBe(false);
  });

  it("débit dépassé : 429 dont la page peut lire `retry-after` (Expose-Headers)", async () => {
    const { base } = await collector({ debitDepasse: true });
    const r = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { origin: ORIGINE, "content-type": "application/json", ...ARETE },
      body: lotSdk(),
    });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    // Sans cette ligne, un navigateur rend `null` à `res.headers.get("retry-after")`.
    expect(r.headers.get("access-control-expose-headers")).toContain("retry-after");
    expect(lireRetryAfter(r.headers.get("retry-after"))).toBe(60_000);
    expect(classerReponse(r.status).retryable).toBe(true);
  });

  it("corps au-delà du plafond : 413 avec CORS (sinon le navigateur voit une erreur réseau muette)", async () => {
    const { base } = await collector();
    const r = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { origin: ORIGINE, "content-type": "application/json" },
      body: "x".repeat(MAX_BODY_BYTES + 1),
    });
    expect(r.status).toBe(413);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGINE);
  });
});

describe("rejeu en direct", () => {
  const morceau = gzipSync(Buffer.from(JSON.stringify([{ type: 4, data: {} }])));

  it("le SDK dérive `/v1/replay` de l'adresse directe", () => {
    expect(deriveReplayEndpoint("https://collector.test/v1/traces")).toBe("https://collector.test/v1/replay");
  });

  it("clé en `x-mip-key` + séquence : 200", async () => {
    const { base, requetes } = await collector();
    const r = await fetch(`${base}/v1/replay`, {
      method: "POST",
      headers: {
        origin: ORIGINE,
        "content-type": "application/octet-stream",
        "x-mip-session": "direct-1",
        "x-mip-app": APP,
        "x-mip-seq": "0",
        "x-mip-key": CLE,
        ...ARETE,
      },
      body: morceau,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGINE);
    expect(requetes.some((q) => /insert into replay_chunk/i.test(q.text))).toBe(true);
  });

  it("sans `x-mip-seq` : 400, rien d'écrit", async () => {
    const { base, requetes } = await collector();
    const r = await fetch(`${base}/v1/replay`, {
      method: "POST",
      headers: { origin: ORIGINE, "content-type": "application/octet-stream", "x-mip-session": "direct-1", "x-mip-app": APP, "x-mip-key": CLE },
      body: morceau,
    });
    expect(r.status).toBe(400);
    expect(requetes.some((q) => /replay_chunk/i.test(q.text))).toBe(false);
  });

  it("clé fausse : 403", async () => {
    const { base } = await collector();
    const r = await fetch(`${base}/v1/replay`, {
      method: "POST",
      headers: { origin: ORIGINE, "content-type": "application/octet-stream", "x-mip-session": "direct-1", "x-mip-app": APP, "x-mip-seq": "0", "x-mip-key": "mip_faux" },
      body: morceau,
    });
    expect(r.status).toBe(403);
  });
});
