// Service worker MV3 — Ext-B. Sur chaque navigation top-level, résout le
// domaine visité via le registre MIP (extension_scope, exposé par
// GET /api/extension/resolve), et injecte le SDK RUM (vendor/mip-rum.js) SEULEMENT
// si le domaine est enregistré + la permission déjà accordée + le site n'a pas
// déjà son propre SDK (anti double-comptage). Aucun secret embarqué : le
// registre est public en lecture (zéro PII, cf. docs/CADRAGE_EXTENSION.md §5).
/// <reference types="chrome" />
import { decideInjection, isFresh, normalizeHost, type CacheEntry, type ScopeEntry } from "../lib/scope";
import {
  beatDue,
  buildBeat,
  heartbeatUrlFrom,
  normalizeLabel,
  readState,
  withAppId,
  type InstallState,
} from "../lib/install";

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

/** Renvoie l'app_id pour lequel le SDK a été RÉELLEMENT injecté, sinon null. */
async function maybeInject(tabId: number, url: string): Promise<string | null> {
  let host: string;
  try {
    host = normalizeHost(new URL(url).hostname);
  } catch {
    return null; // URL non-http (chrome://, about:, …)
  }
  if (!host) return null;

  const scope = await resolveDomain(host);
  // Domaine non enregistré : on s'arrête ICI, avant toute autre vérification —
  // aucun appel chrome.permissions/scripting sur un domaine hors périmètre.
  if (!scope || !scope.active) {
    await chrome.storage.session.set({ [`mip_rum_tab_${tabId}`]: { host, decision: null } });
    return null;
  }

  let origin: string;
  try {
    origin = `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });
  const sdkAlreadyPresent = hasPermission ? await probeSdkPresent(tabId) : false;

  const decision = decideInjection({ scope, hasPermission, sdkAlreadyPresent });
  // État lu par le popup (Ext-C) : "domaine reconnu, permission requise" déclenche
  // le bouton chrome.permissions.request() côté UI (geste utilisateur nécessaire).
  await chrome.storage.session.set({ [`mip_rum_tab_${tabId}`]: { host, decision } });

  if (decision.inject && decision.appId) {
    await inject(tabId, decision.appId, decision.endpoint);
    return decision.appId;
  }
  return null;
}

// ── Inventaire de parc (Ext-D) ───────────────────────────────────────────────
// Un battement de cœur périodique déclare CETTE installation à la console :
// identifiant d'installation, version de l'extension, applications alimentées.
// Jamais l'URL visitée — l'inventaire répond à « quels postes sont équipés »,
// pas à « où ils vont ». Cf. migration-v52 pour le modèle et ses limites.
const INSTALL_KEY = "mip_install";

async function loadInstall(): Promise<InstallState> {
  const o = await chrome.storage.local.get(INSTALL_KEY);
  // L'UUID n'est tiré QUE si le stockage n'en porte pas encore un ; readState
  // ignore l'argument dès qu'un identifiant valide existe.
  return readState(o[INSTALL_KEY], crypto.randomUUID());
}

/**
 * Libellé du poste — lu dans la policy d'entreprise, JAMAIS fabriqué ici.
 * chrome.storage.managed est en lecture seule et alimenté par la DSI du client
 * (clé `poste` de managed-schema.json). Sans policy, l'inventaire reste anonyme :
 * c'est le cas normal, pas une erreur.
 */
async function managedLabel(): Promise<string | null> {
  try {
    const o = await chrome.storage.managed.get("poste");
    return normalizeLabel(o?.poste);
  } catch {
    return null; // aucune policy sur ce poste
  }
}

async function heartbeat(injectedAppId: string | null): Promise<void> {
  let next: InstallState;
  try {
    const state = await loadInstall();
    const merged = withAppId(state.appIds, injectedAppId);
    next = merged ? { ...state, appIds: merged } : state;
    if (!beatDue(next, Date.now(), merged !== null)) return;
  } catch {
    return; // stockage indisponible : pas d'inventaire, mais la collecte continue
  }

  const { resolveUrl } = await getConfig();
  const url = heartbeatUrlFrom(resolveUrl);

  // On persiste AVANT l'envoi. L'identifiant et le périmètre doivent survivre à
  // une panne réseau : sinon chaque démarrage hors ligne tirerait un nouvel UUID
  // et l'inventaire compterait un poste de plus à chaque fois. `lastTryAt` posé
  // ici est ce qui empêche un serveur injoignable de faire marteler le réseau.
  const tried = { ...next, lastTryAt: Date.now() };
  await chrome.storage.local.set({ [INSTALL_KEY]: tried });
  if (!url) return; // URL de résolution non standard : inventaire muet, jamais mal adressé

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildBeat(tried, chrome.runtime.getManifest().version, await managedLabel()),
      ),
    });
    if (!res.ok) {
      console.warn(`${LOG} inventaire : HTTP ${res.status}`);
      return; // lastBeatAt inchangé -> nouvelle tentative après le délai de reprise
    }
    await chrome.storage.local.set({ [INSTALL_KEY]: { ...tried, lastBeatAt: Date.now() } });
  } catch (e) {
    console.warn(`${LOG} inventaire indisponible`, e);
  }
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // top-level uniquement (pas les iframes)
  // Le battement suit l'injection pour connaître l'app_id éventuel, mais il part
  // même quand rien n'est injecté : un poste équipé qui ne visite aucun domaine
  // supervisé doit apparaître à l'inventaire — c'est justement le cas qu'on veut voir.
  void maybeInject(details.tabId, details.url).then(heartbeat);
});

// Première déclaration à l'installation et après chaque mise à jour : sans elle,
// un poste fraîchement équipé resterait invisible jusqu'à sa prochaine navigation.
chrome.runtime.onInstalled.addListener(() => {
  void heartbeat(null);
});
