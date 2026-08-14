// Service worker MV3 — Ext-B. Sur chaque navigation top-level, résout le
// domaine visité via le registre MIP (extension_scope, exposé par
// GET /api/extension/resolve), et injecte le SDK RUM (vendor/mip-rum.js) SEULEMENT
// si le domaine est enregistré + la permission déjà accordée + le site n'a pas
// déjà son propre SDK (anti double-comptage). Aucun secret embarqué : le
// registre est public en lecture (zéro PII, cf. docs/CADRAGE_EXTENSION.md §5).
/// <reference types="chrome" />
import { decideInjection, isFresh, normalizeHost, type CacheEntry, type ScopeEntry } from "../lib/scope";

// Défauts prod. Surchargeable via chrome.storage.local (clés `mip_resolve_url` /
// `mip_default_endpoint`) pour pointer un environnement de staging ou de test sans
// rebuild — utile en pré-prod et pour l'E2E qui charge l'extension dans Chromium.
const DEFAULTS = {
  resolveUrl: "https://mip-rum-console.vercel.app/api/extension/resolve",
  defaultEndpoint: "https://mip-rum-console.vercel.app/api/ingest/v1/traces",
};
// Kill-switch : un domaine désactivé (active=false) cesse d'être injecté sous ce
// délai. 60 s (aligné sur le cache-control de /api/extension/resolve).
const CACHE_TTL_MS = 60 * 1000;
const LOG = "[MIP RUM]";

const cache = new Map<string, CacheEntry>();

async function getConfig(): Promise<{ resolveUrl: string; defaultEndpoint: string }> {
  try {
    const o = await chrome.storage.local.get(["mip_resolve_url", "mip_default_endpoint"]);
    return {
      resolveUrl: typeof o.mip_resolve_url === "string" ? o.mip_resolve_url : DEFAULTS.resolveUrl,
      defaultEndpoint:
        typeof o.mip_default_endpoint === "string" ? o.mip_default_endpoint : DEFAULTS.defaultEndpoint,
    };
  } catch {
    return DEFAULTS;
  }
}

async function resolveDomain(host: string): Promise<ScopeEntry | null> {
  const cached = cache.get(host);
  if (isFresh(cached, Date.now(), CACHE_TTL_MS)) return cached!.scope;
  try {
    const { resolveUrl } = await getConfig();
    const res = await fetch(`${resolveUrl}?domain=${encodeURIComponent(host)}`);
    if (res.status !== 200 && res.status !== 404) {
      console.warn(`${LOG} résolution ${host} : HTTP ${res.status}`);
    }
    const scope: ScopeEntry | null = res.status === 200 ? await res.json() : null;
    cache.set(host, { scope, at: Date.now() });
    return scope;
  } catch (e) {
    // panne réseau : reste sur le dernier verdict connu (sinon rien -> pas d'injection)
    console.warn(`${LOG} résolution ${host} indisponible, repli sur le dernier verdict`, e);
    return cached?.scope ?? null;
  }
}

/** true si `window.MIPRum` existe déjà sur la page (site instrumenté par son propre SDK). */
async function probeSdkPresent(tabId: number): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => Boolean((window as unknown as { MIPRum?: unknown }).MIPRum),
    });
    return Boolean(injection?.result);
  } catch {
    return false; // page non injectable (chrome://, store, pdf viewer…) -> pas d'injection de toute façon
  }
}

async function inject(tabId: number, appId: string, endpoint: string | null): Promise<void> {
  try {
    const { defaultEndpoint } = await getConfig();
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["vendor/mip-rum.js"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (cfg: { endpoint: string; appId: string; collectionSource: "extension" }) => {
        (window as unknown as { MIPRum?: { init: (c: unknown) => void } }).MIPRum?.init(cfg);
      },
      args: [{ endpoint: endpoint ?? defaultEndpoint, appId, collectionSource: "extension" }],
    });
  } catch (e) {
    // page devenue non injectable entre la décision et l'injection (navigation, fermeture)
    console.warn(`${LOG} injection tab ${tabId} échouée`, e);
  }
}

async function maybeInject(tabId: number, url: string): Promise<void> {
  let host: string;
  try {
    host = normalizeHost(new URL(url).hostname);
  } catch {
    return; // URL non-http (chrome://, about:, …)
  }
  if (!host) return;

  const scope = await resolveDomain(host);
  // Domaine non enregistré : on s'arrête ICI, avant toute autre vérification —
  // aucun appel chrome.permissions/scripting sur un domaine hors périmètre.
  if (!scope || !scope.active) {
    await chrome.storage.session.set({ [`mip_rum_tab_${tabId}`]: { host, decision: null } });
    return;
  }

  let origin: string;
  try {
    origin = `${new URL(url).origin}/*`;
  } catch {
    return;
  }
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });
  const sdkAlreadyPresent = hasPermission ? await probeSdkPresent(tabId) : false;

  const decision = decideInjection({ scope, hasPermission, sdkAlreadyPresent });
  // État lu par le popup (Ext-C) : "domaine reconnu, permission requise" déclenche
  // le bouton chrome.permissions.request() côté UI (geste utilisateur nécessaire).
  await chrome.storage.session.set({ [`mip_rum_tab_${tabId}`]: { host, decision } });

  if (decision.inject && decision.appId) await inject(tabId, decision.appId, decision.endpoint);
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // top-level uniquement (pas les iframes)
  void maybeInject(details.tabId, details.url);
});
