// L'EXTENSION NAVIGATEUR, CÔTÉ SERVEUR (Ext-B, Ext-D) — ce que ses deux routes
// publiques font de la base, partagé par ses deux ports : la console
// (`/api/extension/{resolve,heartbeat}`) et le collector (`/v1/extension/*`, C11).
//
// Deux routes PUBLIQUES et non authentifiées : le bundle d'une extension
// distribuée est lisible par son utilisateur, aucun secret n'y tient. Le modèle
// de sécurité est le registre serveur (`extension_scope`) :
//   · `resolve` rend l'application d'un domaine ENREGISTRÉ et actif, sinon rien —
//     et l'extension n'injecte alors strictement rien ;
//   · `heartbeat` déclare un poste. N'importe qui peut inventer un identifiant et
//     faire apparaître une ligne fantôme : un bruit d'inventaire, pas une fuite —
//     la route ne lit rien, n'écrit que ses deux tables, et `app_ids` est filtré
//     contre le registre (un poste ne se déclare que sur des applications
//     RÉELLEMENT servies par l'extension).

/** Plafonds par défaut : 120 résolutions / min / domaine ; 12 battements / h / poste ; 4 Kio par battement. */
export const LIMITES_EXTENSION = Object.freeze({
  resolveParMinute: 120,
  battementsParHeure: 12,
  corpsBattement: 4096,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L'application d'un domaine enregistré et actif, ou `null`.
 * @param {{ query: Function }} db
 * @param {string} domaine
 * @returns {Promise<{ app_id: string, endpoint: string|null, active: boolean } | null>}
 */
export async function resoudreDomaine(db, domaine) {
  const { rows } = await db.query(
    "select app_id, endpoint, active from extension_scope where domain = $1 and active limit 1",
    [domaine],
  );
  return rows[0] ?? null;
}

/**
 * Lit un battement : `{ install_id, version?, label?, app_ids? }`. Rend le
 * battement normalisé, ou `{ erreur, statut }`.
 * @param {string} brut
 */
export function lireBattement(brut) {
  if (brut.length > LIMITES_EXTENSION.corpsBattement) return { erreur: "corps trop volumineux", statut: 413 };
  let corps;
  try {
    corps = JSON.parse(brut);
  } catch {
    return { erreur: "JSON invalide", statut: 400 };
  }
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) return { erreur: "JSON invalide", statut: 400 };
  // L'identifiant DOIT être un UUID : c'est ce qui borne la clé du débit et
  // empêche une chaîne arbitraire de servir de clé de cardinalité illimitée.
  const installId = String(corps.install_id ?? "").trim();
  if (!UUID.test(installId)) return { erreur: "install_id invalide", statut: 400 };
  const version = typeof corps.version === "string" ? corps.version.trim().slice(0, 32) : null;
  const label = typeof corps.label === "string" && corps.label.trim() ? corps.label.trim().slice(0, 120) : null;
  const appIds = Array.isArray(corps.app_ids)
    ? [...new Set(corps.app_ids.filter((a) => typeof a === "string" && a.length > 0 && a.length <= 64))].slice(0, 32)
    : [];
  return { battement: { installId: installId.toLowerCase(), version, label, appIds } };
}

// ── L'User-Agent du poste — les mêmes règles que `apps/console/lib/format.ts`
// (un test tient l'égalité des deux) : l'inventaire affiche ce que ces fonctions
// écrivent.

/** @param {string|null} ua */
export function navigateurDe(ua) {
  if (!ua) return "—";
  if (/edg\//i.test(ua)) return "Edge";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/chrome|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Autre";
}

/** Version MAJEURE ; Edge se déclare aussi « Chrome/… » : son `Edg/` est lu d'abord. @param {string|null} ua */
export function versionMajeureDe(ua) {
  if (!ua) return null;
  for (const re of [/edg\/(\d+)/i, /firefox\/(\d+)/i, /chrome\/(\d+)/i, /version\/(\d+).*safari/i]) {
    const m = re.exec(ua);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Système du poste ; Windows 11 est indiscernable de 10 dans l'UA : « Windows ». @param {string|null} ua */
export function systemeDe(ua) {
  if (!ua) return null;
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

/**
 * Enregistre un battement. L'User-Agent est celui de la REQUÊTE, pas une donnée
 * envoyée par le client : une source de moins à croire.
 * @param {{ query: Function }} db
 * @param {{ installId: string, version: string|null, label: string|null, appIds: string[] }} b
 * @param {string|null} ua
 */
export async function enregistrerBattement(db, b, ua) {
  // `label` est écrasé sans coalesce : si la DSI retire le libellé de sa policy,
  // l'inventaire doit redevenir anonyme au battement suivant. Les autres champs
  // sont préservés quand le battement ne les porte pas (UA absent, version vide).
  await db.query(
    `insert into extension_install
       (install_id, label, ext_version, browser, browser_major, platform)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (install_id) do update set
       label         = excluded.label,
       ext_version   = coalesce(excluded.ext_version,   extension_install.ext_version),
       browser       = coalesce(excluded.browser,       extension_install.browser),
       browser_major = coalesce(excluded.browser_major, extension_install.browser_major),
       platform      = coalesce(excluded.platform,      extension_install.platform),
       last_seen_at  = now()`,
    [b.installId, b.label, b.version, ua ? navigateurDe(ua) : null, ua ? versionMajeureDe(ua) : null, ua ? systemeDe(ua) : null],
  );
  if (b.appIds.length === 0) return;
  await db.query(
    `insert into extension_install_app (install_id, app_id)
     select $1, s.app_id
       from (select distinct app_id from extension_scope where active) s
      where s.app_id = any($2::text[])
     on conflict (install_id, app_id) do update set last_seen_at = now()`,
    [b.installId, b.appIds],
  );
}

const DOMAINE = /^[a-z0-9.-]{1,253}$/;

/** Le domaine demandé à `resolve`, normalisé ; `null` s'il n'a pas la forme d'un nom d'hôte. @param {string|null} brut */
export function lireDomaine(brut) {
  const d = String(brut ?? "").trim().toLowerCase();
  return DOMAINE.test(d) ? d : null;
}

/**
 * Un débit par fenêtre fixe, en mémoire d'instance — le même compromis que la
 * console (`lib/api/ratelimit.ts`) : une borne par réplique, pas un quota global.
 * La table se purge d'elle-même : une clé expirée est oubliée dès qu'elle
 * dépasse 10 000 entrées.
 * @param {number} limite
 * @param {number} fenetreMs
 * @param {() => number} [maintenant]
 */
export function creerDebitFenetre(limite, fenetreMs, maintenant = Date.now) {
  /** @type {Map<string, { n: number, fin: number }>} */
  const cles = new Map();
  return {
    /** @param {string} cle */
    prendre(cle) {
      const t = maintenant();
      if (cles.size > 10_000) for (const [k, v] of cles) if (v.fin <= t) cles.delete(k);
      let e = cles.get(cle);
      if (!e || e.fin <= t) {
        e = { n: 0, fin: t + fenetreMs };
        cles.set(cle, e);
      }
      e.n += 1;
      return e.n <= limite ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((e.fin - t) / 1000)) };
    },
  };
}
