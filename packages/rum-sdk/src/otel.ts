import type { Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  StackContextManager,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import type { MIPRumConfig } from "./types";

const SDK_NAME = "@mip/rum-sdk";
const SDK_VERSION = "0.1.0";

let provider: WebTracerProvider | null = null;

export function initOtel(cfg: MIPRumConfig): Tracer {
  const exporter = new OTLPTraceExporter({ url: cfg.endpoint });
  provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "mip-rum-web",
      "service.version": SDK_VERSION,
      "mip.app_id": cfg.appId,
      "mip.client_id": cfg.clientId ?? "",
      "deployment.environment.name": cfg.env ?? "dev",
    }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: cfg.flushIntervalMs ?? 3000,
        maxExportBatchSize: 64,
      }),
    ],
  });
  // StackContextManager: lean sync context, no zone.js (~80 KB saved)
  provider.register({ contextManager: new StackContextManager() });

  const flush = () => {
    provider?.forceFlush().catch(() => {});
  };
  // final values (INP/CLS) are reported by web-vitals on visibility hidden;
  // flush right after so sendBeacon survives the unload
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  return provider.getTracer(SDK_NAME, SDK_VERSION);
}

export function forceFlush(): Promise<void> {
  return provider ? provider.forceFlush() : Promise.resolve();
}
