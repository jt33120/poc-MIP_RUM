// Auth d'ingestion partagée — source UNIQUE pour v1-traces ET v1-replay, au même
// titre que otlp.mjs / cors.mjs. Élimine par construction la divergence des règles
// d'authentification entre les deux endpoints d'ingestion (un endpoint durci et
// l'autre grand ouvert est exactement le trou qu'on corrige ici).
//
// Trois briques, encapsulant chacune un état d'isolat (cache 60 s / compteurs) :
//   • getAppRegistry() : registre app_registry (app_id, api_key_hash, active,
//     allowed_origins), cache paresseux 60 s. Réutilisé aussi pour le CORS.
//   • checkApiKey(appId, key) : null si accepté, sinon raison du 403. Modèle :
//       - requireApiKey=false            -> jamais de rejet (CI/local).
//       - registre jamais chargé (panne) -> fail-open (dispo > rejet 100 %).
//       - app inconnue / inactive        -> rejet.
//       - api_key_hash null (keyless)    -> accepté (continuité clients keyless).
//       - sinon                          -> la clé fournie doit matcher le hash.
//   • rateLimitedDurable(appId) : fenêtre glissante 60 s, pré-filtre mémoire +
//     compteur durable rate_check() partagé entre isolats (fallback mémoire).
//
// JS pur (Deno prod + Node tests) : logique testable unitairement avec un faux
// client supabase, contrairement à l'ancienne version inline des edge functions.

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fabrique les helpers d'auth liés à un client supabase (service_role).
 * @param {{ from:Function, rpc:Function }} supabase  client supabase-js.
 * @param {{ requireApiKey?: boolean, rateLimitPerMin?: number,
 *          log?: { warn?:Function, error?:Function }, now?: () => number }} [opts]
 */
export function createAuth(supabase, opts = {}) {
  const requireApiKey = opts.requireApiKey ?? false;
  const rateLimitPerMin = opts.rateLimitPerMin ?? 600;
  const log = opts.log ?? {};
  const now = opts.now ?? (() => Date.now());

  let appRegistry = new Map();
  let registryLoadedAt = 0;
  let registryEverLoaded = false;

  async function getAppRegistry() {
    if (now() - registryLoadedAt < 60_000 && appRegistry.size) return appRegistry;
    const { data, error } = await supabase
      .from("app_registry")
      .select("app_id, api_key_hash, active, allowed_origins");
    if (!error && data) {
      appRegistry = new Map(data.map((r) => [r.app_id, r]));
      registryLoadedAt = now();
      registryEverLoaded = true;
    } else if (error) {
      log.error?.("app_registry load failed", { err: error });
    }
    return appRegistry;
  }

  /** null si accepté, sinon raison du 403. */
  async function checkApiKey(appId, apiKey) {
    if (!requireApiKey) return null;
    const registry = await getAppRegistry();
    if (!registryEverLoaded) {
      // panne DB au démarrage : fail-open plutôt que rejeter 100 % du trafic.
      log.warn?.("api key check fail-open (registry never loaded)", { app_id: appId });
      return null;
    }
    const app = registry.get(appId);
    if (!app || !app.active) return `unknown or inactive app: ${appId}`;
    // Durcissement (E1-S1) : sous REQUIRE_API_KEY, une app SANS clé est REJETÉE
    // (fin du « keyless toléré » — vecteur de data-poisoning). Rollout : donner
    // une clé à CHAQUE app active AVANT de passer REQUIRE_API_KEY=true, sinon 403.
    // Sans le flag (défaut), aucun effet : cette fonction retourne null d'entrée.
    if (app.api_key_hash == null) return `app requires an API key: ${appId}`;
    if (!apiKey || (await sha256(apiKey)) !== app.api_key_hash)
      return `invalid api key for app: ${appId}`;
    return null;
  }

  const rateHits = new Map();
  function rateLimited(appId) {
    const t = now();
    const hits = rateHits.get(appId) ?? [];
    while (hits.length && hits[0] <= t - 60_000) hits.shift();
    if (hits.length >= rateLimitPerMin) return true;
    hits.push(t);
    rateHits.set(appId, hits);
    return false;
  }

  async function rateLimitedDurable(appId) {
    if (rateLimited(appId)) return true;
    try {
      const { data, error } = await supabase.rpc("rate_check", {
        p_app_id: appId,
        p_limit: rateLimitPerMin,
      });
      if (error) throw error;
      return data === false;
    } catch (err) {
      log.warn?.("rate_check rpc failed (fallback mémoire)", { err: String(err) });
      return false; // le compteur mémoire a déjà accepté
    }
  }

  return { getAppRegistry, checkApiKey, rateLimitedDurable };
}
