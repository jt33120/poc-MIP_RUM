// R11 — OTLP/HTTP PROTOBUF à l'ingestion : le décodeur, l'aiguillage par
// en-têtes, et le receveur du collector de bout en bout (sans base).
//
// LES PAYLOADS SONT RÉELS. Ils sortent des sérialiseurs OFFICIELS
// d'OpenTelemetry JS (`@opentelemetry/otlp-transformer`, ceux qu'emploient
// `exporter-*-otlp-proto` et `exporter-*-otlp-http`), à partir de spans et de
// logs produits par le SDK officiel. Un encodeur écrit ici aurait les mêmes
// angles morts que le décodeur qu'il prétend vérifier.
//
// Ce qui est prouvé :
//   1. aller-retour : décoder le protobuf d'un export rend l'objet que donne le
//      JSON du MÊME export, et `flattenOtlp` / `flattenOtlpLogs` en tirent
//      exactement les mêmes lignes ;
//   2. le décodeur est borné : vide, tronqué, varint trop long, longueur hors du
//      corps, imbrication excessive, type de fil inconnu → `ErreurProtobuf` ; un
//      champ inconnu est ignoré ;
//   3. l'aiguillage : JSON inchangé, protobuf décodé, autre type → 415, gzip et
//      deflate décompressés sous la même borne que le corps en clair (bombe → 413) ;
//   4. le receveur du collector : même SQL pour le même export en JSON ou en
//      protobuf, réponse protobuf (corps vide sur 200, `google.rpc.Status` sur un
//      refus), mêmes gardes.
import { createServer } from "node:http";
import { deflateSync, gzipSync } from "node:zlib";
import { SpanKind, SpanStatusCode, context, trace, TraceFlags } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { TraceState } from "@opentelemetry/core";
import {
  JsonLogsSerializer,
  JsonTraceSerializer,
  ProtobufLogsSerializer,
  ProtobufTraceSerializer,
} from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import {
  decoderLogsProtobuf,
  decoderTracesProtobuf,
  encoderStatusProtobuf,
  ErreurProtobuf,
  PROFONDEUR_MAX_PROTOBUF,
  // @ts-expect-error module ESM partagé, sans déclarations
} from "../../packages/backend/shared/otlp-protobuf.mjs";
import {
  corpsReponseOtlp,
  decoderCorpsOtlp,
  formatOtlp,
  RefusCorpsOtlp,
  // @ts-expect-error module ESM partagé, sans déclarations
} from "../../packages/backend/shared/otlp-corps.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { flattenOtlp, flattenOtlpLogs } from "../../packages/backend/shared/otlp.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { MAX_BODY_BYTES } from "../../packages/backend/shared/limits.mjs";
// @ts-expect-error module ESM partagé, sans déclarations
import { creerReceveur } from "../../packages/backend/lib/receiver.mjs";

type Objet = Record<string, unknown>;

// ─────────────────────── Exports réels du SDK officiel ───────────────────────

const RESSOURCE = {
  "mip.app_id": "r11-app",
  "mip.api_key": "r11-cle",
  "service.name": "facturation",
  "service.version": "4.2.0",
  "deployment.environment.name": "prod",
  "process.pid": 4242,
  "host.arch.bits": 64.5,
  "feature.enabled": false,
  "process.command_args": ["java", "-jar", "app.jar"],
};

/** Un export de traces réaliste : ce qu'un agent serveur émet pour une requête. */
function spansReels() {
  const memoire = new InMemorySpanExporter();
  const fournisseur = new BasicTracerProvider({
    resource: resourceFromAttributes(RESSOURCE),
    spanProcessors: [new SimpleSpanProcessor(memoire)],
  });
  const traceur = fournisseur.getTracer("io.opentelemetry.tomcat-10.0", "2.9.0");
  // Parent DISTANT porteur d'un tracestate `mip=s:<session>` : c'est ainsi que la
  // session du navigateur arrive jusqu'au span serveur (propagation W3C).
  const parent = trace.setSpanContext(context.active(), {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
    traceState: new TraceState("mip=s:r11-session,vendor=x"),
  });
  const serveur = traceur.startSpan(
    "GET /factures/{id}",
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": "GET",
        "http.route": "/factures/{id}",
        "url.path": "/factures/42",
        "url.full": "https://api.exemple.fr/factures/42?jeton=secret",
        "http.response.status_code": 500,
        "grand.entier": 2 ** 60,
        "entier.negatif": -17,
      },
    },
    parent,
  );
  const enfant = traceur.startSpan(
    "SELECT factures",
    { kind: SpanKind.CLIENT, attributes: { "db.system": "postgresql", "db.statement": "select * from factures where id = 42" } },
    trace.setSpan(context.active(), serveur),
  );
  enfant.end();
  serveur.recordException(Object.assign(new Error("montant négatif"), { name: "IllegalStateException" }));
  serveur.setStatus({ code: SpanStatusCode.ERROR, message: "échec facturation" });
  serveur.addLink({ context: { traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }, attributes: { lien: "oui" } });
  serveur.end();
  return memoire.getFinishedSpans();
}

/** Un export de logs réaliste : une info et une exception, dans la trace. */
function logsReels() {
  const memoire = new InMemoryLogRecordExporter();
  const fournisseur = new LoggerProvider({
    resource: resourceFromAttributes(RESSOURCE),
    processors: [new SimpleLogRecordProcessor({ exporter: memoire })],
  });
  const journal = fournisseur.getLogger("com.exemple.Facturation", "1.0.0");
  const ctx = trace.setSpanContext(context.active(), {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    traceFlags: TraceFlags.SAMPLED,
  });
  journal.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: "facture émise",
    attributes: { "mip.route": "/factures", "facture.id": 42 },
    context: ctx,
  });
  journal.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: { message: "échec", code: 7, details: ["a", "b"] },
    attributes: {
      "exception.type": "java.lang.IllegalStateException",
      "exception.message": "montant négatif",
      "exception.stacktrace": "java.lang.IllegalStateException: montant négatif\n\tat Facturation.emettre(Facturation.java:42)",
    },
    context: ctx,
  });
  return memoire.getFinishedLogRecords();
}

const SPANS = spansReels();
const LOGS = logsReels();
const PROTO_TRACES = Buffer.from(ProtobufTraceSerializer.serializeRequest(SPANS)!);
const JSON_TRACES = JSON.parse(new TextDecoder().decode(JsonTraceSerializer.serializeRequest(SPANS)!));
const PROTO_LOGS = Buffer.from(ProtobufLogsSerializer.serializeRequest(LOGS)!);
const JSON_LOGS = JSON.parse(new TextDecoder().decode(JsonLogsSerializer.serializeRequest(LOGS)!));

/**
 * Forme comparable : ce que le mapping JSON omet ou écrit autrement sans que le
 * sens change. Tableaux vides retirés (le décodeur les pose toujours, un
 * exportateur JSON les omet parfois) ; `intValue` ramené au Number que
 * `anyValue` en tirera de toute façon (le JSON de JS l'écrit en Number, arrondi
 * au-delà de 2^53 ; le décodeur le rend exact, en chaîne).
 */
function comparable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(comparable);
  if (!v || typeof v !== "object") return v;
  const sortie: Objet = {};
  for (const [cle, val] of Object.entries(v as Objet)) {
    if (Array.isArray(val) && val.length === 0) continue;
    sortie[cle] = cle === "intValue" ? Number(val) : comparable(val);
  }
  return sortie;
}

// ─────────────────────── Encodage manuel (cas limites) ───────────────────────

const varint = (n: number | bigint) => {
  let v = BigInt(n);
  const octets: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    octets.push(b);
  } while (v > 0n);
  return Buffer.from(octets);
};
const etiquette = (champ: number, fil: number) => varint((champ << 3) | fil);
const delimite = (champ: number, contenu: Buffer) => Buffer.concat([etiquette(champ, 2), varint(contenu.length), contenu]);
const chaine = (champ: number, s: string) => delimite(champ, Buffer.from(s, "utf8"));

/** Une requête traces minimale : ressource `mip.app_id`, un span nommé. */
function requeteMinimale(extraSpan: Buffer = Buffer.alloc(0)) {
  const kv = Buffer.concat([chaine(1, "mip.app_id"), delimite(2, chaine(1, "r11-app"))]);
  const ressource = delimite(1, delimite(1, kv));
  const span = delimite(2, Buffer.concat([
    delimite(1, Buffer.from("0af7651916cd43dd8448eb211c80319c", "hex")),
    delimite(2, Buffer.from("b7ad6b7169203331", "hex")),
    chaine(5, "SELECT"),
    extraSpan,
  ]));
  return delimite(1, Buffer.concat([ressource, delimite(2, span)]));
}

// ════════════════════════════ 1. Aller-retour ═══════════════════════════════

describe("décodeur protobuf — aller-retour avec les sérialiseurs officiels", () => {
  it("traces : l'objet décodé est celui du JSON du même export", () => {
    const decode = decoderTracesProtobuf(PROTO_TRACES);
    expect(comparable(decode)).toEqual(comparable(JSON_TRACES));
  });

  it("traces : ids en hexadécimal, horodatages en chaîne de nanosecondes, enums en entiers", () => {
    const decode = decoderTracesProtobuf(PROTO_TRACES) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Objet[] }> }> };
    const serveur = decode.resourceSpans[0].scopeSpans[0].spans.find((s) => s.name === "GET /factures/{id}")!;
    expect(serveur.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(serveur.parentSpanId).toBe("00f067aa0ba902b7");
    expect(serveur.traceState).toBe("mip=s:r11-session,vendor=x");
    expect(serveur.kind).toBe(2);
    expect(serveur.startTimeUnixNano).toMatch(/^\d{19}$/);
    expect(serveur.status).toEqual({ code: 2, message: "échec facturation" });
    // 2^60 exact, là où le JSON de JS l'arrondit en Number.
    const attributs = serveur.attributes as Array<{ key: string; value: Objet }>;
    expect(attributs.find((a) => a.key === "grand.entier")!.value).toEqual({ intValue: "1152921504606846976" });
    expect(attributs.find((a) => a.key === "entier.negatif")!.value).toEqual({ intValue: -17 });
  });

  it("traces : flattenOtlp en tire EXACTEMENT les lignes du JSON (le pipeline aval ne change pas)", () => {
    const now = Date.now();
    const depuisProto = flattenOtlp(decoderTracesProtobuf(PROTO_TRACES), { now });
    const depuisJson = flattenOtlp(JSON_TRACES, { now });
    expect(depuisProto).toEqual(depuisJson);
    // Et ce ne sont pas des lignes vides : span serveur, détail SQL, exception.
    expect(depuisProto.apiKeys).toEqual([{ app_id: "r11-app", api_key: "r11-cle" }]);
    expect(depuisProto.spans.map((s: Objet) => s.tier).sort()).toEqual(["back", "detail"]);
    expect(depuisProto.spans.find((s: Objet) => s.tier === "back").session_id).toBe("r11-session");
    expect(depuisProto.errors).toHaveLength(1);
  });

  it("logs : l'objet décodé est celui du JSON du même export, et flattenOtlpLogs rend les mêmes lignes", () => {
    const decode = decoderLogsProtobuf(PROTO_LOGS);
    expect(comparable(decode)).toEqual(comparable(JSON_LOGS));
    const now = Date.now();
    const depuisProto = flattenOtlpLogs(decode, { now });
    expect(depuisProto).toEqual(flattenOtlpLogs(JSON_LOGS, { now }));
    expect(depuisProto.logs).toHaveLength(2);
    expect(depuisProto.errors).toHaveLength(1);
  });

  it("logs : corps structuré (kvlistValue, arrayValue) décodé comme en JSON", () => {
    const decode = decoderLogsProtobuf(PROTO_LOGS) as { resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Objet[] }> }> };
    const erreur = decode.resourceLogs[0].scopeLogs[0].logRecords[1];
    expect(erreur.severityNumber).toBe(17);
    expect(erreur.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(comparable(erreur.body)).toEqual({
      kvlistValue: {
        values: [
          { key: "message", value: { stringValue: "échec" } },
          { key: "code", value: { intValue: 7 } },
          { key: "details", value: { arrayValue: { values: [{ stringValue: "a" }, { stringValue: "b" }] } } },
        ],
      },
    });
  });

  it("bytesValue : en base64, comme le mapping JSON", () => {
    const valeur = delimite(7, Buffer.from([0, 1, 2, 250]));
    const attribut = delimite(9, Buffer.concat([chaine(1, "octets"), delimite(2, valeur)]));
    const decode = decoderTracesProtobuf(requeteMinimale(attribut));
    expect(decode.resourceSpans[0].scopeSpans[0].spans[0].attributes).toEqual([
      { key: "octets", value: { bytesValue: "AAEC+g==" } },
    ]);
  });
});

// ═══════════════════════════ 2. Borné, défensif ═════════════════════════════

describe("décodeur protobuf — borné et défensif", () => {
  it("corps vide : une requête valide sans rien dedans", () => {
    expect(decoderTracesProtobuf(Buffer.alloc(0))).toEqual({ resourceSpans: [] });
    expect(decoderLogsProtobuf(Buffer.alloc(0))).toEqual({ resourceLogs: [] });
  });

  it("corps tronqué (n'importe où) : ErreurProtobuf, jamais une exception brute", () => {
    for (let n = 1; n < PROTO_TRACES.length; n += 7) {
      try {
        decoderTracesProtobuf(PROTO_TRACES.subarray(0, n));
      } catch (err) {
        expect(err).toBeInstanceOf(ErreurProtobuf);
      }
    }
    // Coupé au milieu du premier message : forcément illisible.
    expect(() => decoderTracesProtobuf(PROTO_TRACES.subarray(0, 20))).toThrow(ErreurProtobuf);
  });

  it("varint de plus de 10 octets : refusé", () => {
    const trop = Buffer.concat([Buffer.from([0x08]), Buffer.alloc(10, 0xff), Buffer.from([0x01])]);
    expect(() => decoderTracesProtobuf(trop)).toThrow(/varint trop long/);
  });

  it("longueur annoncée au-delà du corps : refusée, sans allocation", () => {
    const menteur = Buffer.concat([etiquette(1, 2), varint(2_000_000_000), Buffer.from([1, 2, 3])]);
    expect(() => decoderTracesProtobuf(menteur)).toThrow(/longueur protobuf hors du corps/);
  });

  it("un champ ne déborde pas de son message parent", () => {
    // Le span annonce 3 octets, mais sa chaîne interne en réclame 10.
    const span = Buffer.concat([etiquette(5, 2), varint(10), Buffer.from("abcdefghij")]);
    const ressourceSpans = Buffer.concat([etiquette(2, 2), varint(span.length), span]);
    const faux = Buffer.concat([etiquette(1, 2), varint(3), ressourceSpans.subarray(0, 3)]);
    expect(() => decoderTracesProtobuf(faux)).toThrow(ErreurProtobuf);
  });

  it("imbrication excessive (arrayValue dans arrayValue…) : refusée au-delà de la borne", () => {
    let valeur = chaine(1, "fond");
    for (let i = 0; i < PROFONDEUR_MAX_PROTOBUF; i++) valeur = delimite(5, delimite(1, valeur));
    const attribut = delimite(9, Buffer.concat([chaine(1, "profond"), delimite(2, valeur)]));
    expect(() => decoderTracesProtobuf(requeteMinimale(attribut))).toThrow(/imbrication protobuf trop profonde/);
    // Une imbrication raisonnable passe.
    let raisonnable = chaine(1, "fond");
    for (let i = 0; i < 5; i++) raisonnable = delimite(5, delimite(1, raisonnable));
    const ok = delimite(9, Buffer.concat([chaine(1, "profond"), delimite(2, raisonnable)]));
    expect(() => decoderTracesProtobuf(requeteMinimale(ok))).not.toThrow();
  });

  it("champs inconnus ignorés (OTLP plus récent), types de fil discordants ignorés", () => {
    const inconnus = Buffer.concat([
      etiquette(99, 0), varint(12345), // varint inconnu
      etiquette(98, 1), Buffer.alloc(8, 7), // fixed64 inconnu
      etiquette(97, 5), Buffer.alloc(4, 7), // fixed32 inconnu
      chaine(96, "inconnu"), // length-delimited inconnu
      etiquette(5, 0), varint(3), // `name` attendu en chaîne, reçu en varint : ignoré
    ]);
    const decode = decoderTracesProtobuf(requeteMinimale(inconnus));
    const span = decode.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("SELECT");
    expect(span.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(Object.keys(span).sort()).toEqual(["attributes", "events", "links", "name", "spanId", "traceId"]);
  });

  it("groupes (types de fil 3/4) et types de fil invalides : refusés", () => {
    expect(() => decoderTracesProtobuf(Buffer.from([0x0b]))).toThrow(/type de fil/); // champ 1, groupe
    expect(() => decoderTracesProtobuf(Buffer.from([0x0e]))).toThrow(/type de fil/); // champ 1, fil 6
  });

  it("numéro de champ nul : refusé", () => {
    expect(() => decoderTracesProtobuf(Buffer.from([0x00, 0x00]))).toThrow(/numéro de champ/);
  });

  it("UTF-8 invalide dans une chaîne : caractère de remplacement, comme le chemin JSON", () => {
    const nom = Buffer.concat([etiquette(5, 2), varint(3), Buffer.from([0x61, 0xff, 0x62])]);
    const decode = decoderTracesProtobuf(requeteMinimale(nom));
    expect(decode.resourceSpans[0].scopeSpans[0].spans[0].name).toBe("a�b");
  });
});

// ═════════════════════ 3. Aiguillage, compression, réponse ══════════════════

describe("aiguillage OTLP — content-type et content-encoding", () => {
  it("formatOtlp : JSON (et absence d'en-tête), protobuf, le reste refusé", () => {
    expect(formatOtlp("application/json")).toBe("json");
    expect(formatOtlp("Application/JSON; charset=utf-8")).toBe("json");
    expect(formatOtlp(null)).toBe("json");
    expect(formatOtlp("")).toBe("json");
    expect(formatOtlp("application/x-protobuf")).toBe("protobuf");
    expect(formatOtlp("text/plain")).toBeNull();
    expect(formatOtlp("application/protobuf")).toBeNull();
    expect(formatOtlp("multipart/form-data")).toBeNull();
  });

  it("JSON inchangé ; protobuf décodé vers le même objet", () => {
    const json = decoderCorpsOtlp(Buffer.from(JSON.stringify(JSON_TRACES)), { signal: "traces", contentType: "application/json" });
    const proto = decoderCorpsOtlp(PROTO_TRACES, { signal: "traces", contentType: "application/x-protobuf" });
    expect(json.format).toBe("json");
    expect(proto.format).toBe("protobuf");
    expect(comparable(proto.payload)).toEqual(comparable(json.payload));
  });

  it("content-type non pris en charge → 415, sans recopier l'en-tête reçu", () => {
    const essai = () => decoderCorpsOtlp(Buffer.from("{}"), { signal: "traces", contentType: "text/html<script>" });
    expect(essai).toThrow(RefusCorpsOtlp);
    try {
      essai();
    } catch (err) {
      expect((err as { statut: number }).statut).toBe(415);
      expect(String((err as Error).message)).not.toContain("script");
    }
  });

  it("gzip et deflate : décompressés avant décodage, JSON comme protobuf", () => {
    for (const [encodage, compresser] of [["gzip", gzipSync], ["deflate", deflateSync]] as const) {
      const proto = decoderCorpsOtlp(compresser(PROTO_TRACES), { signal: "traces", contentType: "application/x-protobuf", contentEncoding: encodage });
      expect(comparable(proto.payload)).toEqual(comparable(JSON_TRACES));
      const json = decoderCorpsOtlp(compresser(Buffer.from(JSON.stringify(JSON_LOGS))), { signal: "logs", contentType: "application/json", contentEncoding: encodage });
      expect(json.payload).toEqual(JSON_LOGS);
    }
  });

  it("content-encoding inconnu → 415 ; gzip illisible → 400 ; identity accepté", () => {
    const statut = (f: () => unknown) => {
      try {
        f();
        return 200;
      } catch (err) {
        return (err as { statut: number }).statut;
      }
    };
    expect(statut(() => decoderCorpsOtlp(PROTO_TRACES, { signal: "traces", contentType: "application/x-protobuf", contentEncoding: "br" }))).toBe(415);
    expect(statut(() => decoderCorpsOtlp(PROTO_TRACES, { signal: "traces", contentType: "application/x-protobuf", contentEncoding: "gzip" }))).toBe(400);
    expect(statut(() => decoderCorpsOtlp(PROTO_TRACES, { signal: "traces", contentType: "application/x-protobuf", contentEncoding: "identity" }))).toBe(200);
  });

  it("bombe gzip : la sortie est bornée au plafond d'un corps en clair → 413", () => {
    const bombe = gzipSync(Buffer.alloc(MAX_BODY_BYTES + 1, 0x20), { level: 9 });
    expect(bombe.length).toBeLessThan(10_000);
    try {
      decoderCorpsOtlp(bombe, { signal: "traces", contentType: "application/json", contentEncoding: "gzip" });
      throw new Error("aurait dû refuser");
    } catch (err) {
      expect(err).toBeInstanceOf(RefusCorpsOtlp);
      expect((err as { statut: number }).statut).toBe(413);
    }
    // Juste sous la borne : accepté (ici, un JSON illisible → 400, pas 413).
    const juste = gzipSync(Buffer.alloc(MAX_BODY_BYTES, 0x20));
    expect(() => decoderCorpsOtlp(juste, { signal: "traces", contentType: "application/json", contentEncoding: "gzip" })).toThrow(/invalid json body/);
  });

  it("protobuf illisible → 400 « invalid protobuf body » ; JSON illisible → 400 « invalid json body » (message historique)", () => {
    expect(() => decoderCorpsOtlp(Buffer.from([0x0a, 0x7f]), { signal: "traces", contentType: "application/x-protobuf" })).toThrow(/invalid protobuf body/);
    expect(() => decoderCorpsOtlp(Buffer.from("{pas"), { signal: "logs", contentType: "application/json" })).toThrow(/invalid json body/);
  });
});

describe("réponse OTLP — au format de la requête", () => {
  it("JSON : l'objet tel quel", () => {
    const r = corpsReponseOtlp("json", 200, { partialSuccess: {} });
    expect(r.contentType).toBe("application/json");
    expect(r.octets.toString()).toBe('{"partialSuccess":{}}');
  });

  it("protobuf 2xx : corps VIDE, que le désérialiseur officiel lit comme un succès complet", () => {
    const r = corpsReponseOtlp("protobuf", 200, { partialSuccess: {} });
    expect(r.contentType).toBe("application/x-protobuf");
    expect(r.octets.length).toBe(0);
    expect(ProtobufTraceSerializer.deserializeResponse(new Uint8Array(r.octets))).toEqual({});
    expect(ProtobufLogsSerializer.deserializeResponse(new Uint8Array(r.octets))).toEqual({});
  });

  it("protobuf 4xx/5xx : google.rpc.Status { message }, longueur sur plusieurs octets comprise", () => {
    const court = corpsReponseOtlp("protobuf", 403, { error: "invalid api key" }).octets;
    expect(court).toEqual(Buffer.concat([Buffer.from([0x12, 15]), Buffer.from("invalid api key")]));
    const long = encoderStatusProtobuf("é".repeat(100)); // 200 octets UTF-8 : varint sur 2 octets
    expect([...long.subarray(0, 3)]).toEqual([0x12, 0xc8, 0x01]);
    expect(long.subarray(3).toString("utf8")).toBe("é".repeat(100));
    expect(encoderStatusProtobuf("").length).toBe(0);
  });
});

// ═══════════════════ 4. Receveur du collector, sans base ════════════════════

/** Faux pool : enregistre chaque requête SQL, répond des lignes vides. */
function fauxPool() {
  const requetes: Array<{ text: string; params?: unknown[] }> = [];
  const query = async (text: string, params?: unknown[]) => {
    requetes.push({ text, params });
    if (text.includes("rate_check")) return { rows: [{ ok: true }] };
    if (text.includes("from app_registry")) {
      return { rows: [{ app_id: "r11-app", api_key_hash: null, active: true, allowed_origins: null, ingestion_suspended_at: null, privacy_barrier_mode: "off" }] };
    }
    return { rows: [] };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) }, requetes };
}

const aFermer: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(aFermer.splice(0).map((f) => f()));
});

async function servir(opts: Record<string, unknown> = {}) {
  const { pool, requetes } = fauxPool();
  const muet = { debug() {}, info() {}, warn() {}, error() {} };
  const receveur = creerReceveur(pool, { log: muet, requireApiKey: false, env: {}, ...opts });
  const server = createServer(receveur.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  aFermer.push(() => new Promise((r) => server.close(() => r())));
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("port de test indisponible");
  return { base: `http://127.0.0.1:${adresse.port}`, requetes };
}

/** Le SQL d'écriture seul (ni registre, ni débit, ni sondes de colonnes). */
const ecritures = (requetes: Array<{ text: string; params?: unknown[] }>) =>
  requetes.filter((r) => /^\s*insert|^\s*update/i.test(r.text) && !r.text.includes("rate_counter"));

describe("receveur du collector — protobuf de bout en bout (faux pool)", () => {
  it("traces : même SQL d'écriture pour le même export en JSON et en protobuf", async () => {
    const json = await servir();
    const rj = await fetch(`${json.base}/v1/traces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(JSON_TRACES) });
    expect(rj.status).toBe(200);
    const proto = await servir();
    const rp = await fetch(`${proto.base}/v1/traces`, { method: "POST", headers: { "content-type": "application/x-protobuf" }, body: PROTO_TRACES });
    expect(rp.status).toBe(200);
    expect(ecritures(proto.requetes).length).toBeGreaterThan(0);
    expect(ecritures(proto.requetes)).toEqual(ecritures(json.requetes));
    expect(JSON.stringify(ecritures(proto.requetes))).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("réponse à une requête protobuf : 200, application/x-protobuf, corps vide", async () => {
    const { base } = await servir();
    const r = await fetch(`${base}/api/ingest/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/x-protobuf", "content-encoding": "gzip" },
      body: gzipSync(PROTO_TRACES),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/x-protobuf");
    expect((await r.arrayBuffer()).byteLength).toBe(0);
  });

  it("logs protobuf : 200 et écriture dans rum_log", async () => {
    const { base, requetes } = await servir();
    const r = await fetch(`${base}/v1/logs`, { method: "POST", headers: { "content-type": "application/x-protobuf" }, body: PROTO_LOGS });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/x-protobuf");
    expect(requetes.some((q) => /insert into rum_log/i.test(q.text))).toBe(true);
  });

  it("protobuf illisible : 400 en google.rpc.Status, rien d'écrit", async () => {
    const { base, requetes } = await servir();
    const r = await fetch(`${base}/v1/traces`, { method: "POST", headers: { "content-type": "application/x-protobuf" }, body: Buffer.from([0x0a, 0x7f, 0x01]) });
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toBe("application/x-protobuf");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(encoderStatusProtobuf("invalid protobuf body"));
    expect(ecritures(requetes)).toHaveLength(0);
  });

  it("content-type inconnu : 415 en JSON (la requête n'est pas protobuf)", async () => {
    const { base } = await servir();
    const r = await fetch(`${base}/v1/traces`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(JSON_TRACES) });
    expect(r.status).toBe(415);
    expect(r.headers.get("content-type")).toBe("application/json");
  });

  it("les MÊMES gardes : sans clé sous REQUIRE_API_KEY, 403 en google.rpc.Status, rien d'écrit", async () => {
    const { base, requetes } = await servir({ requireApiKey: true });
    const sansCle = decoderTracesProtobuf(requeteMinimale());
    expect(sansCle.resourceSpans[0].resource.attributes).toHaveLength(1);
    const r = await fetch(`${base}/v1/traces`, { method: "POST", headers: { "content-type": "application/x-protobuf" }, body: requeteMinimale() });
    expect(r.status).toBe(403);
    expect(r.headers.get("content-type")).toBe("application/x-protobuf");
    expect(Buffer.from(await r.arrayBuffer())[0]).toBe(0x12);
    expect(ecritures(requetes)).toHaveLength(0);
  });

  it("bombe gzip protobuf : 413, rien d'écrit", async () => {
    const { base, requetes } = await servir();
    const r = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/x-protobuf", "content-encoding": "gzip" },
      body: gzipSync(Buffer.alloc(MAX_BODY_BYTES + 1, 0)),
    });
    expect(r.status).toBe(413);
    expect(ecritures(requetes)).toHaveLength(0);
  });
});
