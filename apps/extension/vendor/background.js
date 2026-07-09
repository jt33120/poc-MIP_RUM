// lib/scope.ts
function normalizeHost(hostname) {
  return (hostname ?? "").trim().toLowerCase();
}
function decideInjection(input) {
  const { scope, hasPermission, sdkAlreadyPresent } = input;
  if (!scope || !scope.active) {
    return { inject: false, reason: "domain-not-scoped", appId: null, endpoint: null };
  }
  if (sdkAlreadyPresent) {
    return { inject: false, reason: "sdk-already-present", appId: scope.app_id, endpoint: scope.endpoint };
  }
  if (!hasPermission) {
    return { inject: false, reason: "permission-required", appId: scope.app_id, endpoint: scope.endpoint };
  }
  return { inject: true, reason: "ok", appId: scope.app_id, endpoint: scope.endpoint };
}
function isFresh(entry, nowMs, ttlMs) {
  return entry != null && nowMs - entry.at < ttlMs;
}

// src/background.ts
var RESOLVE_URL = "https://mip-rum-console.vercel.app/api/extension/resolve";
var DEFAULT_ENDPOINT = "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces";
var CACHE_TTL_MS = 5 * 60 * 1e3;
var cache = /* @__PURE__ */ new Map();
async function resolveDomain(host) {
  const cached = cache.get(host);
  if (isFresh(cached, Date.now(), CACHE_TTL_MS)) return cached.scope;
  try {
    const res = await fetch(`${RESOLVE_URL}?domain=${encodeURIComponent(host)}`);
    const scope = res.status === 200 ? await res.json() : null;
    cache.set(host, { scope, at: Date.now() });
    return scope;
  } catch {
    return cached?.scope ?? null;
  }
}
async function probeSdkPresent(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => Boolean(window.MIPRum)
    });
    return Boolean(injection?.result);
  } catch {
    return false;
  }
}
async function inject(tabId, appId, endpoint) {
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["vendor/mip-rum.js"] });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (cfg) => {
      window.MIPRum?.init(cfg);
    },
    args: [{ endpoint: endpoint ?? DEFAULT_ENDPOINT, appId, collectionSource: "extension" }]
  });
}
async function maybeInject(tabId, url) {
  let host;
  try {
    host = normalizeHost(new URL(url).hostname);
  } catch {
    return;
  }
  if (!host) return;
  const scope = await resolveDomain(host);
  if (!scope || !scope.active) {
    await chrome.storage.session.set({ [`mip_rum_tab_${tabId}`]: { host, decision: null } });
    return;
  }
  let origin;
  try {
    origin = `${new URL(url).origin}/*`;
  } catch {
    return;
  }
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });
  const sdkAlreadyPresent = hasPermission ? await probeSdkPresent(tabId) : false;
  const decision = decideInjection({ scope, hasPermission, sdkAlreadyPresent });
  await chrome.storage.session.set({ [`mip_rum_tab_${tabId}`]: { host, decision } });
  if (decision.inject && decision.appId) await inject(tabId, decision.appId, decision.endpoint);
}
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void maybeInject(details.tabId, details.url);
});
