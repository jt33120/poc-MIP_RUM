export interface MIPRumConfig {
  /** OTLP/HTTP JSON endpoint, ex: https://<ingest>/v1/traces */
  endpoint: string;
  /** Application identifier, ex: 'gip-plateforme' */
  appId: string;
  /** Client identifier, ex: 'groupement-it' */
  clientId?: string;
  env?: string;
  /** 0..1, fraction of sessions instrumented (default 1.0) */
  sampleRate?: number;
  /** Batch flush interval in ms (default 3000) */
  flushIntervalMs?: number;
  /** Last-chance PII filter applied to every span's attributes; return null to drop */
  beforeSend?: (attributes: Record<string, unknown>) => Record<string, unknown> | null;
}

export type VitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
