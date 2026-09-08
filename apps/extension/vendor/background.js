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

// lib/install.ts
var BEAT_INTERVAL_MS = 6 * 60 * 60 * 1e3;
var RETRY_MIN_MS = 15 * 60 * 1e3;
var LABEL_MAX = 120;
function readState(raw, freshId) {
  const o = raw ?? {};
  const id = typeof o.installId === "string" && o.installId.length > 0 ? o.installId : freshId;
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
  const apps = Array.isArray(o.appIds) ? [...new Set(o.appIds.filter((a) => typeof a === "string" && a.length > 0))].sort() : [];
  return { installId: id, lastBeatAt: num(o.lastBeatAt), lastTryAt: num(o.lastTryAt), appIds: apps };
}
function withAppId(appIds, appId) {
  if (!appId) return null;
  if (appIds.includes(appId)) return null;
  return [...appIds, appId].sort();
}
function beatDue(state, nowMs, perimeterChanged, intervalMs = BEAT_INTERVAL_MS, retryMs = RETRY_MIN_MS) {
  if (perimeterChanged) return true;
  const sinceTry = nowMs - state.lastTryAt;
  if (sinceTry >= 0 && sinceTry < retryMs) return false;
  const age = nowMs - state.lastBeatAt;
  return age >= intervalMs || age < 0;
}
function normalizeLabel(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, LABEL_MAX);
  return t.length > 0 ? t : null;
}
function buildBeat(state, version, label) {
  return { install_id: state.installId, version, label, app_ids: state.appIds };
}
function heartbeatUrlFrom(resolveUrl) {
  const cleaned = resolveUrl.replace(/\/+$/, "");
  return cleaned.endsWith("/resolve") ? `${cleaned.slice(0, -"/resolve".length)}/heartbeat` : null;
}

// src/background.ts
var DEFAULTS = {
  resolveUrl: "https://mip-rum-console.vercel.app/api/extension/resolve",
  defaultEndpoint: "https://mip-rum-console.vercel.app/api/ingest/v1/traces"
};
var CACHE_TTL_MS = 60 * 1e3;
var LOG = "[MIP RUM]";
var cache = /* @__PURE__ */ new Map();
async function getConfig() {
  try {
    const o = await chrome.storage.local.get(["mip_resolve_url", "mip_default_endpoint"]);
    return {
      resolveUrl: typeof o.mip_resolve_url === "string" ? o.mip_resolve_url : DEFAULTS.resolveUrl,
      defaultEndpoint: typeof o.mip_default_endpoint === "string" ? o.mip_default_endpoint : DEFAULTS.defaultEndpoint
    };
  } catch {
    return DEFAULTS;
  }
}
async function resolveDomain(host) {
  const cached = cache.get(host);
  if (isFresh(cached, Date.now(), CACHE_TTL_MS)) return cached.scope;
  try {
    const { resolveUrl } = await getConfig();
    const res = await fetch(`${resolveUrl}?domain=${encodeURIComponent(host)}`);
    if (res.status !== 200 && res.status !== 404) {
      console.warn(`${LOG} r\xE9solution ${host} : HTTP ${res.status}`);
    }
    const scope = res.status === 200 ? await res.json() : null;
    cache.set(host, { scope, at: Date.now() });
    return scope;
  } catch (e) {
    console.warn(`${LOG} r\xE9solution ${host} indisponible, repli sur le dernier verdict`, e);
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
  try {
    const { defaultEndpoint } = await getConfig();
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["vendor/mip-rum.js"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (cfg) => {
        window.MIPRum?.init(cfg);
      },
      args: [{ endpoint: endpoint ?? defaultEndpoint, appId, collectionSource: "extension" }]
    });
  } catch (e) {
    console.warn(`${LOG} injection tab ${tabId} \xE9chou\xE9e`, e);
  }
}
async function maybeInject(tabId, url) {
  let host;
  try {
    host = normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
  if (!host) return null;
  const scope = await resolveDomain(host);
  if (!scope || !scope.active) {
    await chrome.storage.session.set({ [`mip_rum_tab_${tabId}`]: { host, decision: null } });
    return null;
  }
  let origin;
  try {
    origin = `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });
  const sdkAlreadyPresent = hasPermission ? await probeSdkPresent(tabId) : false;
  const decision = decideInjection({ scope, hasPermission, sdkAlreadyPresent });
  await chrome.storage.session.set({ [`mip_rum_tab_${tabId}`]: { host, decision } });
  if (decision.inject && decision.appId) {
    await inject(tabId, decision.appId, decision.endpoint);
    return decision.appId;
  }
  return null;
}
var INSTALL_KEY = "mip_install";
async function loadInstall() {
  const o = await chrome.storage.local.get(INSTALL_KEY);
  return readState(o[INSTALL_KEY], crypto.randomUUID());
}
async function managedLabel() {
  try {
    const o = await chrome.storage.managed.get("poste");
    return normalizeLabel(o?.poste);
  } catch {
    return null;
  }
}
async function heartbeat(injectedAppId) {
  let next;
  try {
    const state = await loadInstall();
    const merged = withAppId(state.appIds, injectedAppId);
    next = merged ? { ...state, appIds: merged } : state;
    if (!beatDue(next, Date.now(), merged !== null)) return;
  } catch {
    return;
  }
  const { resolveUrl } = await getConfig();
  const url = heartbeatUrlFrom(resolveUrl);
  const tried = { ...next, lastTryAt: Date.now() };
  await chrome.storage.local.set({ [INSTALL_KEY]: tried });
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildBeat(tried, chrome.runtime.getManifest().version, await managedLabel())
      )
    });
    if (!res.ok) {
      console.warn(`${LOG} inventaire : HTTP ${res.status}`);
      return;
    }
    await chrome.storage.local.set({ [INSTALL_KEY]: { ...tried, lastBeatAt: Date.now() } });
  } catch (e) {
    console.warn(`${LOG} inventaire indisponible`, e);
  }
}
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void maybeInject(details.tabId, details.url).then(heartbeat);
});
chrome.runtime.onInstalled.addListener(() => {
  void heartbeat(null);
});
