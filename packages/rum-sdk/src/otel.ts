import type { Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  StackContextManager,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import { RetryExporter } from "./retry";
import type { MIPRumConfig } from "./types";

const SDK_NAME = "@mip/rum-sdk";
const SDK_VERSION = "0.4.0";

let provider: WebTracerProvider | null = null;

export function initOtel(cfg: MIPRumConfig): Tracer {
  // décorateur retry : export raté -> file localStorage, rejouée au prochain init
  const exporter = new RetryExporter(new OTLPTraceExporter({ url: cfg.endpoint }));
  provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "mip-rum-web",
      "service.version": SDK_VERSION,
      "mip.app_id": cfg.appId,
      "mip.client_id": cfg.clientId ?? "",
      "mip.user_agent": navigator.userAgent,
      "deployment.environment.name": cfg.env ?? "dev",
      // release pour la dé-minification des stacks (association à la source map)
      ...(cfg.release ? { "mip.release": cfg.release } : {}),
      // sendBeacon ne porte pas de headers : la clé voyage en attribut resource
      ...(cfg.apiKey ? { "mip.api_key": cfg.apiKey } : {}),
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
