// Encodage OTLP/HTTP JSON — remplace le SDK @opentelemetry (~52 Ko minifiés du
// bundle cœur). Le format de fil produit ici est EXACTEMENT celui qu'attend
// l'ingestion (`flattenOtlp`) : `resourceSpans[].resource.attributes` +
// `scopeSpans[].spans[]`, valeurs en AnyValue typé (stringValue / intValue en
// chaîne / doubleValue / boolValue) et `timeUnixNano` en chaîne (la précision
// nanoseconde dépasse 2^53, donc pas de number). Logique 100 % pure, sans
// dépendance ni API navigateur -> verrouillée par un test round-trip contre
// flattenOtlp (tests/unit/otlp-emitter.test.ts).

/** [secondes epoch, nanosecondes] — même découpage que l'HrTime OpenTelemetry. */
export type HrTime = [number, number];

export type Attributes = Record<string, unknown>;

/** Span prêt à sérialiser : représentation interne de l'émetteur. */
export interface EmitSpan {
  name: string;
  traceId: string; // hex 16 octets (32 caractères)
  spanId: string; // hex 8 octets (16 caractères)
  /** Span parent DANS LE CHAMP NATIF. Absent = span racine de sa trace. */
  parentSpanId?: string;
  kind?: SpanKind;
  status?: SpanStatus;
  startTime: HrTime;
  endTime: HrTime;
  attributes: Attributes;
}

// ───────────────────────── Champs natifs OTLP (traces v1) ─────────────────────
//
// POURQUOI ILS ARRIVENT SEULEMENT MAINTENANT. L'émetteur ne sérialisait que
// traceId / spanId / name / horodatage / attributs. Le reste — la parenté, la
// nature du span, son issue — voyageait dans des attributs `mip.*` que SEUL
// notre backend sait relire. Conséquence, écrite noir sur blanc sur la vitrine :
// un collecteur OpenTelemetry tiers acceptait le flux mais reconstruisait mal le
// waterfall, et « backend remplaçable » n'était vrai qu'à moitié.
//
// Les attributs `mip.*` RESTENT émis : un SDK déjà posé chez un client continue
// d'alimenter l'ingestion, et l'ingestion continue de les lire en repli. On
// ajoute la vérité standard à côté de la vérité propriétaire ; on ne la remplace
// pas dans le même mouvement.

/** SpanKind OTLP. Valeurs numériques de la spec — jamais des chaînes. */
export const SPAN_KIND = {
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
} as const;
export type SpanKind = (typeof SPAN_KIND)[keyof typeof SPAN_KIND];

/** StatusCode OTLP. UNSET (0) est le défaut : on ne le sérialise pas. */
export const STATUS_CODE = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;
export type StatusCode = (typeof STATUS_CODE)[keyof typeof STATUS_CODE];

export interface SpanStatus {
  code: StatusCode;
}

/**
 * Nature du span, déduite de son nom.
 *
 * Un appel réseau sortant est CLIENT — c'est ce qui, chez un backend OTel,
 * l'apparie au span SERVER d'en face et fait apparaître le saut réseau. Tout le
 * reste de ce que produit un navigateur (page vue, métrique, erreur, tâche
 * longue…) est du travail interne au document : INTERNAL.
 *
 * `http.server` n'est pas émis par ce SDK — il vient de l'agent Node — mais la
 * fonction le connaît pour rester la SEULE table de correspondance du dépôt.
 */
export function kindPour(name: string): SpanKind {
  if (name === "http.client") return SPAN_KIND.CLIENT;
  if (name === "http.server") return SPAN_KIND.SERVER;
  return SPAN_KIND.INTERNAL;
}

/**
 * Issue du span. `undefined` quand rien ne permet de trancher — c'est UNSET,
 * et UNSET ne se sérialise pas : affirmer « OK » sur un span dont on ne sait
 * rien serait une information fausse, pas une valeur par défaut.
 *
 * AUCUN `message` n'est joint, même sur une erreur. Le message d'exception
 * voyage déjà dans `exception.message`, où il est nettoyé de la PII à
 * l'émission ET à l'ingestion ; le recopier dans `status.message` créerait un
 * second chemin, celui-là non nettoyé côté serveur.
 */
export function statutPour(name: string, attrs: Attributes): SpanStatus | undefined {
  if (name === "exception") return { code: STATUS_CODE.ERROR };
  if (name === "http.client" || name === "http.server") {
    const code = attrs["http.status_code"];
    if (typeof code !== "number") return undefined; // requête coupée : on ne sait pas
    // 4xx et 5xx sont des erreurs pour un span CLIENT (spec HTTP semconv : côté
    // serveur seul le 5xx l'est, mais ce SDK n'émet pas de span serveur).
    return { code: code >= 400 ? STATUS_CODE.ERROR : STATUS_CODE.OK };
  }
  return undefined;
}

/**
 * AnyValue OTLP. Encodage aligné sur `anyValue()` côté ingestion :
 * chaîne -> stringValue ; booléen -> boolValue ; entier -> intValue (en chaîne,
 * convention int64) ; réel -> doubleValue.
 */
export function toAnyValue(v: string | number | boolean): Record<string, unknown> {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
}

/**
 * Tableau OTLP `[{key, value}]`. Ignore null/undefined (attribut absent) et les
 * valeurs non scalaires (le contrat MIP passe les objets déjà sérialisés en JSON
 * string en amont, ex. mip.props / webvital.attribution).
 */
export function encodeAttributes(
  attrs: Attributes,
): Array<{ key: string; value: Record<string, unknown> }> {
  const out: Array<{ key: string; value: Record<string, unknown> }> = [];
  for (const [key, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
      out.push({ key, value: toAnyValue(v) });
    }
  }
  return out;
}

/** HrTime -> nanosecondes epoch en chaîne (fixed64) ; précision préservée. */
export function hrToNanos(hr: HrTime): string {
  return `${hr[0]}${String(hr[1]).padStart(9, "0")}`;
}

/** Epoch millisecondes (entier) -> HrTime. Les timestamps MIP sont en ms entières. */
export function msToHr(ms: number): HrTime {
  const m = Math.round(ms);
  return [Math.floor(m / 1000), (m % 1000) * 1_000_000];
}

const SCOPE = { name: "@mip/rum-sdk", version: "0.4.0" };

/** Enveloppe OTLP/HTTP JSON complète pour un lot de spans. */
export function buildResourceSpans(resourceAttrs: Attributes, spans: EmitSpan[]): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: encodeAttributes(resourceAttrs) },
        scopeSpans: [
          {
            scope: SCOPE,
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              // Champs OMIS quand ils ne sont pas connus, jamais mis à zéro :
              // `parentSpanId: ""` désigne explicitement un span racine, et
              // `status: {code: 0}` affirme « rien à signaler ». Les deux
              // seraient des affirmations, là où l'absence est une abstention.
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              ...(s.kind ? { kind: s.kind } : {}),
              ...(s.status ? { status: s.status } : {}),
              name: s.name,
              startTimeUnixNano: hrToNanos(s.startTime),
              endTimeUnixNano: hrToNanos(s.endTime),
              attributes: encodeAttributes(s.attributes),
            })),
          },
        ],
      },
    ],
  };
}
