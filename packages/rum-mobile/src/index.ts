// Runtime React Native du SDK mobile MIP RUM. Capte crashes (ErrorUtils), écrans,
// appels réseau (patch fetch + traceparent) et événements métier, puis émet en
// OTLP vers MIP — via le cœur pur (core.ts). Best-effort : ne casse jamais l'app.
// Globals RN typés en souple ; construit par esbuild (dist/). RN >= fetch global.
import {
  buildExceptionSpan,
  buildHttpSpan,
  buildPayload,
  buildScreenSpan,
  buildTrackSpan,
  type Ctx,
  type MobileConfig,
} from "./core";

// --- globals RN / JS (déclarés en souple pour éviter une dépendance react-native)
declare const global: any;

export interface InitOptions {
  endpoint: string;
  appId: string;
  apiKey?: string;
  clientId?: string;
  env?: string;
  appVersion?: string;
  /** 'ios' | 'android' — sert de device_type et compose le user-agent. */
  platform?: string;
  osVersion?: string;
  /** Origines supplémentaires où propager le traceparent (défaut : toutes sauf l'endpoint). */
  traceOrigins?: string[];
  flushIntervalMs?: number;
}

let cfg: MobileConfig | null = null;
let ctx: Ctx | null = null;
let traceOrigins: string[] = [];
let endpointOrigin = "";
const buffer: Record<string, unknown>[] = [];
let started = false;

/** hex aléatoire (RN-safe : Math.random, suffisant pour des identifiants de corrélation). */
function hex(bytes: number): string {
  let s = "";
  for (let i = 0; i < bytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return s;
}
function now(): number {
  return Date.now();
}

function originOf(url: string): string | null {
  const m = /^[a-z]+:\/\/[^/]+/i.exec(url);
  return m ? m[0].toLowerCase() : null;
}

async function flush(): Promise<void> {
  if (!cfg || !buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await global.fetch(cfg.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(cfg, batch)),
    });
  } catch {
    /* best-effort */
  }
}
function enqueue(span: Record<string, unknown>): void {
  buffer.push(span);
  if (buffer.length >= 64) void flush();
}

// --- capture crashes (ErrorUtils : handler global RN) ------------------------
function installCrashHandler(): void {
  const EU = global.ErrorUtils;
  if (!EU?.getGlobalHandler || !EU?.setGlobalHandler) return;
  const prev = EU.getGlobalHandler();
  EU.setGlobalHandler((err: any, isFatal: boolean) => {
    try {
      if (ctx) {
        enqueue(
          buildExceptionSpan(
            ctx,
            { message: String(err?.message ?? err), type: err?.name ?? null, stack: err?.stack ?? null },
            now(),
            hex(8),
          ),
        );
      }
      void flush(); // l'app peut mourir : on tente l'envoi immédiat (keepalive implicite)
    } catch {
      /* ignore */
    }
    prev?.(err, isFatal); // on ne masque pas le comportement d'origine (redbox / crash)
  });
}

// --- patch réseau (fetch) : span http.client + propagation traceparent -------
function installFetchPatch(): void {
  const orig = global.fetch;
  if (typeof orig !== "function" || orig.__mipPatched) return;
  const patched = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    const origin = originOf(url);
    const sameOrTraced =
      origin && origin !== endpointOrigin && (traceOrigins.length === 0 || traceOrigins.includes(origin));
    const traceId = hex(16);
    const spanId = hex(8);
    if (sameOrTraced && ctx) {
      const headers = new global.Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
      headers.set("traceparent", `00-${traceId}-${spanId}-01`);
      headers.set("tracestate", `mip=s:${ctx.sessionId}`);
      init = { ...init, headers };
    }
    const start = now();
    try {
      const res = await orig(input, init);
      if (ctx && origin && origin !== endpointOrigin) {
        enqueue(buildHttpSpan(ctx, { traceId, url, method: (init.method ?? "GET").toUpperCase(), status: res.status, durationMs: now() - start }, start, spanId));
      }
      return res;
    } catch (e) {
      if (ctx && origin && origin !== endpointOrigin) {
        enqueue(buildHttpSpan(ctx, { traceId, url, method: (init.method ?? "GET").toUpperCase(), status: 0, durationMs: now() - start }, start, spanId));
      }
      throw e;
    }
  };
  (patched as any).__mipPatched = true;
  global.fetch = patched;
}

// --- cycle de vie : nouvelle session au retour au premier plan ---------------
function installAppState(): void {
  try {
    // require optionnel : pas de dépendance dure à react-native
    const rn = (global.require ?? (() => null))("react-native");
    rn?.AppState?.addEventListener?.("change", (state: string) => {
      if (state === "active" && ctx) ctx.sessionId = hex(16);
    });
  } catch {
    /* AppState indisponible : session unique par lancement */
  }
}

/** Démarre la collecte mobile. Idempotent. */
export function init(opts: InitOptions): void {
  if (started || !opts?.endpoint || !opts?.appId) return;
  started = true;
  const platform = opts.platform ?? "mobile";
  cfg = {
    endpoint: opts.endpoint,
    appId: opts.appId,
    apiKey: opts.apiKey ?? null,
    env: opts.env ?? "prod",
    clientId: opts.clientId ?? null,
    appVersion: opts.appVersion ?? null,
    userAgent: `MIP-RN/0.1 (${platform}${opts.osVersion ? ` ${opts.osVersion}` : ""})`,
  };
  ctx = { sessionId: hex(16), route: null, userHash: null, tz: null, deviceType: platform };
  traceOrigins = (opts.traceOrigins ?? []).map((o) => o.replace(/\/+$/, "").toLowerCase());
  endpointOrigin = originOf(opts.endpoint) ?? "";

  installCrashHandler();
  installFetchPatch();
  installAppState();

  const timer = setInterval(() => void flush(), opts.flushIntervalMs ?? 3000);
  if (timer?.unref) timer.unref();
}

/** Déclare l'écran courant (route) et émet une vue. */
export function screen(name: string): void {
  if (!ctx) return;
  ctx.route = name;
  enqueue(buildScreenSpan(ctx, now(), hex(8)));
}

/** Événement métier : track("checkout", { amount: 42 }). */
export function track(name: string, props: Record<string, unknown> = {}): void {
  if (!ctx) return;
  enqueue(buildTrackSpan(ctx, name, props, now(), hex(8)));
}

/** Force l'envoi des spans en attente. */
export function flushNow(): Promise<void> {
  return flush();
}

export default { init, screen, track, flushNow };
