// Résolution domaine -> décision d'injection — logique PURE, testée (Ext-B).
// Aucun accès chrome.*/fetch ici : ce module reçoit des primitives et renvoie
// une décision. L'appelant (background.ts, impur) fait les appels réseau/API
// navigateur et applique la décision.

export interface ScopeEntry {
  app_id: string;
  endpoint: string | null;
  active: boolean;
}

export type InjectReason =
  | "domain-not-scoped"
  | "sdk-already-present"
  | "permission-required"
  | "ok";

export interface InjectDecision {
  inject: boolean;
  reason: InjectReason;
  appId: string | null;
  endpoint: string | null;
}

/** Normalise un hostname (minuscules, sans espace) — clé de résolution/cache. */
export function normalizeHost(hostname: string | null | undefined): string {
  return (hostname ?? "").trim().toLowerCase();
}

/**
 * Décide si le SDK doit être injecté sur cet onglet, à partir :
 *  - `scope` : l'entrée du registre pour ce domaine (null = domaine non enregistré) ;
 *  - `hasPermission` : la permission host_permissions est-elle déjà accordée ;
 *  - `sdkAlreadyPresent` : `window.MIPRum` existe déjà sur la page (site déjà
 *    instrumenté par son propre SDK) — anti double-comptage (cf. CADRAGE_EXTENSION §2.4).
 *
 * Ordre des vérifications volontaire : un domaine non enregistré ne doit JAMAIS
 * déclencher de collecte, quelle que soit la permission — c'est l'invariant de
 * confidentialité central de l'extension (jamais de <all_urls> silencieux).
 */
export function decideInjection(input: {
  scope: ScopeEntry | null;
  hasPermission: boolean;
  sdkAlreadyPresent: boolean;
}): InjectDecision {
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

export interface CacheEntry {
  scope: ScopeEntry | null;
  at: number;
}

/** Un cache est frais si son âge est < ttlMs — évite un appel réseau par navigation. */
export function isFresh(entry: CacheEntry | undefined, nowMs: number, ttlMs: number): boolean {
  return entry != null && nowMs - entry.at < ttlMs;
}
