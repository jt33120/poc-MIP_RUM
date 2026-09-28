// Garde-fou commun des scripts qui ÉCRIVENT hors du chemin d'exploitation prévu :
// vérifications (`scripts/verify-*.mjs`), semeurs (`seed-*`), générateurs de
// trafic (`gen-*`), bancs, et l'E2E (`playwright.config.ts`).
//
// POURQUOI. Le 16/09/2026, `scripts/verify-tenant-isolation.mjs` a été lancé
// avec `DATABASE_URL` pointée sur la production — le `.env` du poste la désigne.
// Il a créé ses applications de test `app-a` et `app-b` EN PRODUCTION. Rien ne
// l'en empêchait : ces scripts lisent `DATABASE_URL` (ou, à défaut, les
// variables `PG*` de libpq) sans regarder où elle mène.
//
// LA RÈGLE, sur le modèle de `scripts/bench/semer-bancs.mjs` : une cible dont
// l'hôte n'est pas local est REFUSÉE, sauf dérogation explicite.
//
// LA DÉROGATION NOMME L'HÔTE. `MIP_CIBLE_DISTANTE` doit valoir l'hôte exact
// visé (plusieurs, séparés par des virgules), jamais « oui » : une valeur
// générique, posée une fois dans un `.env`, désarmerait le garde-fou pour tous
// les scripts et pour toujours. Recopier l'hôte oblige à lire où l'on écrit.
//
// Ce qui n'est PAS gardé ici, volontairement : les outils d'exploitation voulus
// (`services/scheduler/migrate.mjs`, `scripts/backfill-rum.mjs` qui a sa propre
// variable, `scripts/ops/*`). Leur cible distante est leur raison d'être.
// `tests/unit/cible-locale.test.ts` liste les scripts écrivants et vérifie
// qu'ils appellent ce garde-fou.

/** Variable de dérogation : l'hôte distant exact, jamais une valeur générique. */
export const DEROGATION = "MIP_CIBLE_DISTANTE";

const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "0.0.0.0"]);

/** Hôte local : boucle locale (127.0.0.0/8, ::1), `*.localhost`, socket Unix. */
export function hoteLocal(hote) {
  const h = String(hote ?? "").toLowerCase();
  return h === "" || h.startsWith("/") || HOTES_LOCAUX.has(h) || /^127(?:\.\d{1,3}){3}$/.test(h) || h.endsWith(".localhost");
}

/**
 * Hôte d'une cible : URL `postgres://`, `postgresql://`, `http(s)://`.
 * Sans URL, un client `pg` lit `PGHOST`, puis se connecte en local : on suit la
 * même règle, pour que `new pg.Client({})` ne passe pas sous le garde-fou.
 * @returns {{ ok: true, hote: string } | { ok: false, raison: string }}
 */
export function hoteDe(cible, env = process.env) {
  if (cible == null || cible === "") return { ok: true, hote: env.PGHOST ?? "" };
  let u;
  try {
    u = new URL(String(cible));
  } catch {
    return { ok: false, raison: "cible illisible (ni URL postgres:// ni http(s)://) : refusée plutôt que devinée" };
  }
  // `?host=/var/run/postgresql` : libpq donne la priorité au paramètre sur l'autorité.
  const parametre = u.searchParams.get("host");
  return { ok: true, hote: parametre ?? u.hostname };
}

/**
 * La cible est-elle acceptable ? Locale, ou distante ET nommée par la dérogation.
 * PURE : tout vient des arguments, rien n'est connecté.
 * @returns {{ ok: true, hote: string } | { ok: false, raison: string }}
 */
export function verifierCibleLocale(cible, { env = process.env, quoi = "la base" } = {}) {
  const lu = hoteDe(cible, env);
  if (!lu.ok) return { ok: false, raison: `${quoi} : ${lu.raison}` };
  if (hoteLocal(lu.hote)) return { ok: true, hote: lu.hote };
  const autorises = String(env[DEROGATION] ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (autorises.includes(lu.hote.toLowerCase())) return { ok: true, hote: lu.hote };
  return {
    ok: false,
    raison: `${quoi} vise l'hôte distant « ${lu.hote} ». Ce script écrit : il ne tourne que sur une cible locale. ` +
      `Si c'est VRAIMENT voulu (base jetable distante), relancer avec ${DEROGATION}=${lu.hote}.`,
  };
}

/**
 * Arrête le script (code 2) si la cible n'est pas acceptable ; rend la cible sinon.
 * À appeler AVANT toute connexion.
 */
export function exigerCibleLocale(cible, { env = process.env, quoi = "la base", script = "script" } = {}) {
  const r = verifierCibleLocale(cible, { env, quoi });
  if (!r.ok) {
    console.error(`[${script}] REFUS — ${r.raison}`);
    process.exit(2);
  }
  return cible;
}
