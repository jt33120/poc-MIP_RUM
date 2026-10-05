// Un lot de spans du SDK web, et la forme canonique d'un message OTLP JSON : partagés
// par les deux contrôles de conformité à OpenTelemetry (ADR-0016) —
// tests/unit/otlp-conformite-officielle.test.ts (sérialiseur officiel) et
// tests/unit/otlp-collecteur-officiel.test.ts (collecteur officiel).
import { msToHr, type EmitSpan } from "../../packages/rum-sdk/src/otlp-encode";

export const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
export const RESSOURCE = {
  "service.name": "mip-rum-web",
  "service.version": "0.6.0",
  "mip.app_id": "demo",
  "mip.api_key": "mip_cle_de_test",
  "mip.user_agent": "Mozilla/5.0 Test",
};
export const SCOPE = { name: "@mip/rum-sdk", version: "0.4.0" };
// Une minute avant maintenant : l'ingestion ramène à « maintenant » une date trop
// ancienne, et deux lectures successives ne tomberaient plus sur la même.
export const T0 = Math.floor(Date.now() / 1000) - 60;

// Un lot qui couvre ce que le SDK émet : les trois natures de span, un parent, les
// trois issues, un événement `exception`, et les quatre types d'attributs.
export const SPANS: EmitSpan[] = [
  {
    name: "pageview", traceId: TRACE, spanId: "0000000000000001", kind: 1,
    startTime: msToHr((T0 + 0) * 1000), endTime: msToHr((T0 + 0) * 1000),
    attributes: { "mip.session_id": "sess-1", "mip.route": "/home", "mip.bfcache": false },
  },
  {
    name: "webvital.LCP", traceId: TRACE, spanId: "0000000000000002", parentSpanId: "0000000000000001", kind: 1,
    startTime: msToHr((T0 + 1) * 1000), endTime: msToHr((T0 + 1) * 1000),
    attributes: { "mip.session_id": "sess-1", "webvital.name": "LCP", "webvital.value": 2340.5 },
  },
  {
    name: "http.client", traceId: TRACE, spanId: "0000000000000003", parentSpanId: "0000000000000001", kind: 3,
    status: { code: 2 },
    startTime: [T0 + 2, 123_456_789], endTime: [T0 + 2, 987_654_321],
    attributes: {
      "mip.session_id": "sess-1", "http.request.method": "GET", "url.full": "https://api.demo.fr/search",
      "http.response.status_code": 503, "error.type": "503",
    },
  },
  {
    name: "exception", traceId: TRACE, spanId: "0000000000000004", parentSpanId: "0000000000000001", kind: 1,
    status: { code: 2 },
    startTime: msToHr((T0 + 3) * 1000), endTime: msToHr((T0 + 3) * 1000),
    attributes: { "mip.session_id": "sess-1", "exception.type": "TypeError", "mip.error_lineno": 42 },
    events: [{ name: "exception", time: msToHr((T0 + 3) * 1000), attributes: { "exception.type": "TypeError", "exception.message": "x is undefined" } }],
  },
  {
    name: "longtask", traceId: TRACE, spanId: "0000000000000005", kind: 1, status: { code: 1 },
    startTime: msToHr((T0 + 4) * 1000), endTime: msToHr((T0 + 4) * 1000 + 250),
    attributes: { "mip.session_id": "sess-1", "longtask.duration_ms": 250 },
  },
];

// Le seul champ que l'officiel écrit et que le SDK omet, et pourquoi c'est permis.
// `flags` (OTLP 1.1) porte les drapeaux W3C et « parent distant ou non » ; absent,
// il vaut 0, « inconnu » selon la spec — un récepteur ne doit rien en déduire.
export const OMISSIONS_PERMISES = new Set(["flags"]);

/**
 * Forme canonique d'un message JSON de protobuf : on retire ce qui vaut la valeur
 * par défaut (0, "", [], objet vide, undefined) — ce que tout décodeur conforme
 * reconstitue —, on écrit les int64 en chaîne, et on retire les omissions permises.
 */
export function canonique(v: unknown, cle = ""): unknown {
  if (Array.isArray(v)) {
    const t = v.map((x) => canonique(x)).filter((x) => x !== undefined);
    return t.length ? t : undefined;
  }
  if (v && typeof v === "object") {
    const sortie: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (OMISSIONS_PERMISES.has(k)) continue;
      const c = canonique(x, k);
      if (c !== undefined) sortie[k] = c;
    }
    return Object.keys(sortie).length ? sortie : undefined;
  }
  if (v === undefined || v === null || v === "" || v === 0 || v === false) {
    // `false` d'un boolValue n'est PAS une valeur par défaut à retirer : il est
    // dans un oneof, sa présence compte.
    return cle === "boolValue" && v === false ? false : undefined;
  }
  if (cle === "intValue" || /UnixNano$/.test(cle)) return String(v);
  return v;
}

