// LES MARQUEURS DE DÉPLOIEMENT (Voie A · inc. 3) — ce que `POST /v1/deploys` fait
// de la base, partagé par ses deux ports : la console (`/api/v1/deploys`) et le
// collector (C11).
//
// Une CI signale un déploiement ; le marqueur est croisé ensuite aux mesures RUM
// (« la régression a commencé après le déploiement X »). Une ÉCRITURE DE MACHINE :
// un marqueur fabriqué décale la lecture des régressions. Le collector n'accepte
// qu'un jeton de CI de privilège `deploys:write` (migration-v92), lié à UNE
// application ; la console accepte aussi, pendant une fenêtre datée
// (`FIN_JETONS_HISTORIQUES`), les jetons d'API de CONSOLE_API_TOKENS.
//
// PAS IDEMPOTENT : `deploy_marker` n'a pas de clé naturelle, le même appel écrit
// deux marqueurs. Le relais de la console ne rejoue donc jamais une requête dont
// l'issue est incertaine.

/** Privilège du jeton de CI qui pose un marqueur. */
export const PRIVILEGE_DEPLOIEMENT = "deploys:write";

/**
 * Fin de la fenêtre où `/api/v1/deploys` accepte encore un jeton de
 * CONSOLE_API_TOKENS (annoncée par `Sunset`, RFC 8594). Au-delà, un jeton de CI
 * `deploys:write` seul.
 */
export const FIN_JETONS_HISTORIQUES = "2026-12-31T23:59:59Z";

/** Corps d'un marqueur : quelques champs courts. */
export const CORPS_DEPLOIEMENT_MAX = 16 * 1024;

/** Les refus, mot pour mot des deux côtés (contrat de parité). */
export const REFUS_DEPLOIEMENT = Object.freeze({
  sansJeton: "authentification requise (Authorization: Bearer <jeton de CI deploys:write>)",
  jetonInvalide: "jeton de CI « deploys:write » invalide, expiré ou révoqué",
  tropGros: "corps trop volumineux",
  /** @param {string} app */
  horsPerimetre: (app) => `app hors périmètre: ${app}`,
});

/**
 * Lit `{ app_id, version?, env?, ts? }`. Rend le marqueur, ou `{ erreur }` (400).
 * @param {unknown} corps
 */
export function lireDeploiement(corps) {
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) return { erreur: "corps JSON invalide" };
  const c = /** @type {Record<string, unknown>} */ (corps);
  const appId = typeof c.app_id === "string" ? c.app_id.trim() : "";
  if (!appId) return { erreur: "app_id requis" };
  const version = typeof c.version === "string" ? c.version.slice(0, 200) : null;
  const env = typeof c.env === "string" ? c.env.slice(0, 40) : "prod";
  let ts = null;
  if (c.ts != null) {
    const d = new Date(/** @type {string|number} */ (c.ts));
    if (!Number.isNaN(d.getTime())) ts = d;
  }
  return { deploiement: { appId, version, env, ts } };
}

/**
 * @param {{ query: Function }} db
 * @param {{ appId: string, version: string|null, env: string, ts: Date|null }} d
 * @param {"ci"|"manual"} source
 */
export async function enregistrerDeploiement(db, d, source) {
  await db.query(
    `insert into deploy_marker (app_id, version, env, source, ts)
     values ($1, $2, $3, $4, coalesce($5, now()))`,
    [d.appId, d.version, d.env, source, d.ts],
  );
}
