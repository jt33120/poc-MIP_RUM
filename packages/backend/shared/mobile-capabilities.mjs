// Capacités de collecte d'un runtime mobile (P7.5) — vocabulaire FERMÉ, validé
// côté serveur. JS pur, sans dépendance : importé par le parseur OTLP, par le
// writer et par la console.
//
// POURQUOI UN MODÈLE PLUTÔT QU'UNE DÉDUCTION. Sans déclaration, une console ne
// peut pas distinguer « cette application n'a pas planté » de « rien ne mesure
// les plantages de cette application ». Les deux rendent zéro ligne. Le premier
// est une bonne nouvelle, le second est un angle mort — et c'est exactement
// celui que P7 laisse ouvert pour le natif. Un badge « Non collecté » n'est donc
// pas un ornement : c'est la seule présentation qui ne ment pas.
//
// TROIS ÉTATS, PAS DEUX. Une capacité peut être :
//   · `active`      — le SDK l'a installée et l'observe ;
//   · `unavailable` — le SDK a REGARDÉ et n'a rien pu installer ;
//   · absente       — personne n'a rien dit (SDK antérieur, autre runtime).
// Fondre les deux derniers effacerait la différence entre « on sait que ce n'est
// pas mesuré » et « on ne sait pas ». La table garde donc une ligne pour les
// capacités déclarées INDISPONIBLES, et n'en garde aucune pour le silence.
//
// UNE CAPACITÉ ACTIVE N'EST PAS UN TEST PASSÉ. `declared` vient du client ; il
// dit ce que le SDK croit avoir installé, sur la foi de son propre code. Seule
// une recette d'opérateur peut écrire `verified_at` — aucun chemin d'ingestion
// ne touche cette colonne, et c'est vérifié par test.

/** Les six capacités du modèle. Toute autre valeur est REFUSÉE, jamais stockée. */
export const MOBILE_CAPABILITIES = Object.freeze([
  "js_errors",
  "native_crashes",
  "anr",
  "native_start",
  "offline_persistence",
  "screen_tracking",
]);

/** États déclarables par un SDK. « Vérifié » n'en fait pas partie : il ne se déclare pas. */
export const MOBILE_CAPABILITY_STATES = Object.freeze(["active", "unavailable"]);

/**
 * Runtimes mobiles reconnus. `runtimeClientMip` (otlp.mjs) rend `react_native`
 * pour le SDK React Native ; `browser` n'est pas un runtime mobile et n'entre
 * jamais dans ce modèle — un navigateur n'a ni crash natif ni ANR.
 */
export const MOBILE_RUNTIMES = Object.freeze(["react_native"]);

/** Attribut de resource qui porte la déclaration. */
export const CAPABILITY_ATTRIBUTE = "mip.capabilities";

/**
 * Au-delà, ce n'est pas une déclaration : six capacités et leur état tiennent en
 * moins de 150 octets. Une valeur plus longue est ignorée EN ENTIER plutôt que
 * tronquée — une troncature couperait un état en deux et en inventerait un autre.
 */
export const CAPABILITY_DECLARATION_MAX = 512;

const CAPABILITES = new Set(MOBILE_CAPABILITIES);
const ETATS = new Set(MOBILE_CAPABILITY_STATES);
const RUNTIMES = new Set(MOBILE_RUNTIMES);

export function isMobileCapability(value) {
  return typeof value === "string" && CAPABILITES.has(value);
}

export function isMobileRuntime(value) {
  return typeof value === "string" && RUNTIMES.has(value);
}

/**
 * Déclaration `nom:état,nom:état` d'une resource OTLP → liste normalisée.
 *
 * Grammaire volontairement pauvre : deux vocabulaires fermés et une virgule. Un
 * jeton inconnu, mal formé ou répété est ÉCARTÉ — le reste de la déclaration
 * passe. Un lot de télémétrie ne doit pas être perdu parce qu'une version future
 * du SDK a ajouté un septième nom ; et la valeur inconnue ne doit pas entrer en
 * base, où plus rien ne saurait la lire.
 *
 * Premier gagnant en cas de répétition : deux états contradictoires pour une
 * même capacité ne sont fiables ni l'un ni l'autre, mais le résultat doit être
 * déterministe — un « dernier gagnant » laisserait la fin d'une chaîne forgée
 * décider de l'état affiché.
 *
 * @param {unknown} raw valeur brute de `mip.capabilities`
 * @returns {{capability: string, declared: boolean}[]} triée par nom, sans doublon
 */
export function parseCapabilityDeclaration(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > CAPABILITY_DECLARATION_MAX) return [];
  const vues = new Map();
  for (const jeton of raw.split(",")) {
    const [nom, etat, ...reste] = jeton.trim().split(":");
    if (reste.length || !CAPABILITES.has(nom) || !ETATS.has(etat) || vues.has(nom)) continue;
    vues.set(nom, { capability: nom, declared: etat === "active" });
  }
  return [...vues.values()].sort((a, b) => a.capability.localeCompare(b.capability));
}

/**
 * Sérialise une déclaration (SDK, tests, documentation). Inverse exact de
 * `parseCapabilityDeclaration` : l'aller-retour est vérifié par test.
 *
 * @param {Record<string, boolean>} etats capacité → active ?
 */
export function formatCapabilityDeclaration(etats) {
  return MOBILE_CAPABILITIES.filter((nom) => nom in etats)
    .map((nom) => `${nom}:${etats[nom] ? "active" : "unavailable"}`)
    .join(",");
}

/**
 * Lignes `mobile_capabilities` d'une resource, ou tableau vide.
 *
 * `release` peut être NULL : une application qui ne déclare pas sa version reste
 * mesurable, et une release inventée serait pire qu'une release inconnue. Un
 * runtime non mobile ne produit aucune ligne.
 *
 * @param {{appId: string, runtime: string|null, release: string|null, raw: unknown}} entree
 */
export function capabilityRows({ appId, runtime, release, raw }) {
  if (!appId || !isMobileRuntime(runtime)) return [];
  return parseCapabilityDeclaration(raw).map((d) => ({
    app_id: appId,
    runtime,
    release: release ?? null,
    capability: d.capability,
    declared: d.declared,
  }));
}
