// R11 — exports OTLP produits par le SDK OpenTelemetry OFFICIEL (JavaScript),
// sérialisés par ses propres encodeurs (`@opentelemetry/otlp-transformer`, ceux
// des exportateurs `*-otlp-proto` et `*-otlp-http`).
//
// POURQUOI UN FIXTURE PARTAGÉ. Le contrat de parité, le relais de bout en bout et
// le test SQL doivent envoyer les MÊMES octets qu'un agent Java, .NET ou Python :
// un lot fabriqué à la main aurait les angles morts du décodeur qu'il vérifie.
// Ce que l'export contient : une requête serveur (span SERVER, attributs semconv
// HTTP, session propagée par `tracestate: mip=s:<id>` comme la pose le SDK web),
// un appel SQL enfant, une exception enregistrée sur le span ; côté logs, une
// information et une exception, dans la même trace.
import { context, SpanKind, SpanStatusCode, trace, TraceFlags } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { TraceState } from "@opentelemetry/core";
import {
  JsonLogsSerializer,
  JsonTraceSerializer,
  ProtobufLogsSerializer,
  ProtobufTraceSerializer,
} from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  type LogRecordProcessor,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

export interface Emetteur {
  appId: string;
  cle: string | null;
  /** Session du navigateur, propagée au backend (`tracestate: mip=s:<id>`). */
  session: string;
  /** Instant de la requête (ms) ; les horodatages de l'export en découlent. */
  t0: number;
  /** Trace W3C du navigateur (32 hex), parent distant du span serveur. */
  traceId: string;
}

export interface Export {
  protobuf: Buffer;
  json: Buffer;
}

function ressource(e: Emetteur) {
  return resourceFromAttributes({
    "mip.app_id": e.appId,
    ...(e.cle ? { "mip.api_key": e.cle } : {}),
    "service.name": "facturation",
    "service.version": "4.2.0",
    "deployment.environment.name": "prod",
  });
}

function parentDistant(e: Emetteur) {
  return trace.setSpanContext(context.active(), {
    traceId: e.traceId,
    spanId: `${e.traceId.slice(0, 15)}1`,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
    traceState: new TraceState(`mip=s:${e.session}`),
  });
}

/**
 * Une requête HTTP serveur, son appel SQL et son exception, remis à `processeur`
 * (un vrai exportateur OTLP dans le test SQL, la mémoire ailleurs). Rend le
 * fournisseur, pour son `forceFlush`.
 */
export function emettreTraces(e: Emetteur, processeur: SpanProcessor) {
  const fournisseur = new BasicTracerProvider({ resource: ressource(e), spanProcessors: [processeur] });
  const traceur = fournisseur.getTracer("io.opentelemetry.tomcat-10.0", "2.9.0");
  const serveur = traceur.startSpan(
    "GET /factures/{id}",
    {
      kind: SpanKind.SERVER,
      startTime: e.t0,
      attributes: {
        "http.request.method": "GET",
        "http.route": "/factures/{id}",
        "url.path": "/factures/42",
        "http.response.status_code": 500,
      },
    },
    parentDistant(e),
  );
  const sql = traceur.startSpan(
    "SELECT factures",
    { kind: SpanKind.CLIENT, startTime: e.t0 + 5, attributes: { "db.system": "postgresql", "db.statement": "select * from factures where id = 42" } },
    trace.setSpan(context.active(), serveur),
  );
  sql.end(e.t0 + 25);
  serveur.recordException(Object.assign(new Error("montant négatif"), { name: "IllegalStateException" }), e.t0 + 30);
  serveur.setStatus({ code: SpanStatusCode.ERROR, message: "échec facturation" });
  serveur.end(e.t0 + 40);
  return fournisseur;
}

/** L'export de `emettreTraces`, sérialisé par les encodeurs officiels (protobuf et JSON). */
export function tracesOfficielles(e: Emetteur): Export {
  const memoire = new InMemorySpanExporter();
  emettreTraces(e, new SimpleSpanProcessor(memoire));
  const spans = memoire.getFinishedSpans();
  return {
    protobuf: Buffer.from(ProtobufTraceSerializer.serializeRequest(spans)!),
    json: Buffer.from(JsonTraceSerializer.serializeRequest(spans)!),
  };
}

/** Deux logs de la même trace, remis à `processeur` : une information, une exception (ERROR). */
export function emettreLogs(e: Emetteur, processeur: LogRecordProcessor) {
  const fournisseur = new LoggerProvider({ resource: ressource(e), processors: [processeur] });
  const journal = fournisseur.getLogger("com.exemple.Facturation", "1.0.0");
  const ctx = trace.setSpanContext(context.active(), {
    traceId: e.traceId,
    spanId: `${e.traceId.slice(0, 15)}2`,
    traceFlags: TraceFlags.SAMPLED,
  });
  journal.emit({
    timestamp: e.t0,
    observedTimestamp: e.t0 + 1,
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: "facture émise",
    attributes: { "mip.session_id": e.session, "mip.route": "/factures" },
    context: ctx,
  });
  journal.emit({
    timestamp: e.t0 + 10,
    observedTimestamp: e.t0 + 11,
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: "échec facturation",
    attributes: {
      "mip.session_id": e.session,
      "exception.type": "java.lang.IllegalStateException",
      "exception.message": "montant négatif",
      "exception.stacktrace": "java.lang.IllegalStateException: montant négatif\n\tat Facturation.emettre(Facturation.java:42)",
    },
    context: ctx,
  });
  return fournisseur;
}

/** L'export de `emettreLogs`, sérialisé par les encodeurs officiels (protobuf et JSON). */
export function logsOfficiels(e: Emetteur): Export {
  const memoire = new InMemoryLogRecordExporter();
  emettreLogs(e, new SimpleLogRecordProcessor({ exporter: memoire }));
  const logs = memoire.getFinishedLogRecords();
  return {
    protobuf: Buffer.from(ProtobufLogsSerializer.serializeRequest(logs)!),
    json: Buffer.from(JsonLogsSerializer.serializeRequest(logs)!),
  };
}
