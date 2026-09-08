// Identité d'installation et battement de cœur — logique PURE, testée (Ext-D).
// Même partage que scope.ts : aucun accès chrome.*/fetch ici. Ce module reçoit
// des primitives et rend une décision ; background.ts fait les appels navigateur
// et réseau.
//
// CE QUE CE MODULE NE FAIT PAS, VOLONTAIREMENT : il ne dérive rien du poste.
// L'identifiant d'installation est un UUID tiré au hasard une seule fois, pas une
// empreinte. Une empreinte (userAgent + résolution + fuseau, à la façon du
// user_hash du SDK) serait inutilisable ici : sur un parc géré, tous les postes
// sortis du même master la partagent, et elle change à chaque mise à jour de
// Chrome. On veut compter des postes et les suivre dans le temps — l'inverse
// exact de ce qu'une empreinte sait faire.

/** État persisté dans chrome.storage.local, sous la clé `mip_install`. */
export interface InstallState {
  /** UUID aléatoire, stable pour la durée de vie de l'installation. */
  installId: string;
  /** Horodatage du dernier battement ACCEPTÉ par le serveur (0 = jamais). */
  lastBeatAt: number;
  /** Horodatage de la dernière TENTATIVE, réussie ou non (0 = jamais). */
  lastTryAt: number;
  /** app_id pour lesquels ce poste a déjà injecté le SDK, triés, sans doublon. */
  appIds: string[];
}

/** Charge utile envoyée au serveur. Aucune URL, aucune caractéristique du poste. */
export interface Beat {
  install_id: string;
  version: string;
  label: string | null;
  app_ids: string[];
}

/** 6 h : assez pour qu'un poste allumé de la journée se signale, assez peu pour
 *  que l'inventaire coûte 4 requêtes par poste et par jour. */
export const BEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Après un échec (serveur injoignable), délai minimal avant de retenter. Sans
 *  lui, un inventaire en panne transformerait CHAQUE navigation en requête. */
export const RETRY_MIN_MS = 15 * 60 * 1000;

/** Un libellé de policy plus long est tronqué : il ne sert qu'à l'affichage. */
export const LABEL_MAX = 120;

/**
 * Relit l'état stocké en se méfiant de tout : le stockage d'une extension est
 * lisible ET modifiable par l'utilisateur (chrome://extensions → service worker →
 * console). Une valeur absente, d'un mauvais type ou corrompue repart d'un état
 * neuf construit sur `freshId`, jamais d'un crash du service worker.
 */
export function readState(raw: unknown, freshId: string): InstallState {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = typeof o.installId === "string" && o.installId.length > 0 ? o.installId : freshId;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const apps = Array.isArray(o.appIds)
    ? [...new Set(o.appIds.filter((a): a is string => typeof a === "string" && a.length > 0))].sort()
    : [];
  return { installId: id, lastBeatAt: num(o.lastBeatAt), lastTryAt: num(o.lastTryAt), appIds: apps };
}

/**
 * Ajoute un app_id au périmètre connu du poste.
 * Renvoie `null` quand rien ne change — le seul moyen pour l'appelant de savoir
 * qu'il n'a NI écriture de stockage NI battement anticipé à faire. Sans ce
 * signal, chaque navigation sur un domaine supervisé réécrirait le stockage.
 */
export function withAppId(appIds: string[], appId: string | null | undefined): string[] | null {
  if (!appId) return null;
  if (appIds.includes(appId)) return null;
  return [...appIds, appId].sort();
}

/**
 * Faut-il émettre un battement ?
 *
 * Trois règles, dans cet ordre :
 *  1. `perimeterChanged` court-circuite tout — quand un poste se met à alimenter
 *     une nouvelle application, l'inventaire doit le savoir tout de suite, sinon
 *     la colonne « applications » de la console ment pendant une demi-journée.
 *     Sans risque de rafale : le périmètre d'un poste change au plus une fois
 *     par application supervisée.
 *  2. Sinon, on respecte le délai de reprise : une tentative récente (réussie ou
 *     non) suffit à se taire. C'est ce qui empêche un serveur injoignable de
 *     transformer chaque navigation en requête.
 *  3. Sinon, l'intervalle nominal depuis le dernier battement accepté.
 */
export function beatDue(
  state: InstallState,
  nowMs: number,
  perimeterChanged: boolean,
  intervalMs: number = BEAT_INTERVAL_MS,
  retryMs: number = RETRY_MIN_MS,
): boolean {
  if (perimeterChanged) return true;
  const sinceTry = nowMs - state.lastTryAt;
  if (sinceTry >= 0 && sinceTry < retryMs) return false;
  // Horloge reculée (correction NTP, changement de fuseau) : un lastBeatAt dans
  // le futur bloquerait l'inventaire indéfiniment. Un écart négatif vaut « dû ».
  const age = nowMs - state.lastBeatAt;
  return age >= intervalMs || age < 0;
}

/** Normalise le libellé venu de la policy d'entreprise (jamais de nous). */
export function normalizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, LABEL_MAX);
  return t.length > 0 ? t : null;
}

/** Charge utile du battement. */
export function buildBeat(state: InstallState, version: string, label: string | null): Beat {
  return { install_id: state.installId, version, label, app_ids: state.appIds };
}

/**
 * URL du battement, dérivée de celle de résolution : les deux vivent sur le même
 * déploiement, donc un override de staging (`mip_resolve_url`) doit emmener le
 * battement avec lui — sinon la pré-prod déclarerait ses postes en production.
 *
 * Renvoie `null` si l'URL ne se termine pas par `/resolve` : mieux vaut un
 * inventaire muet qu'un POST envoyé à une route qui n'est pas la sienne.
 */
export function heartbeatUrlFrom(resolveUrl: string): string | null {
  const cleaned = resolveUrl.replace(/\/+$/, "");
  return cleaned.endsWith("/resolve") ? `${cleaned.slice(0, -"/resolve".length)}/heartbeat` : null;
}
