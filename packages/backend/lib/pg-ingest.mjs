// Cœur d'ingestion sur Postgres NU (pg) — source UNIQUE partagée par le
// dev-server Node (local/CI) et les routes Next.js de la console (prod).
//
// Pourquoi ce module existe. L'ingestion de prod tournait en edge functions
// Supabase (Deno + supabase-js). Le projet Supabase ayant disparu, l'ingestion
// est repartie sur Vercel, où tourne déjà la console — donc sur `pg`, comme le
// dev-server. Plutôt que de laisser deux implémentations diverger (le défaut
// exact que shared/otlp.mjs et shared/cors.mjs avaient été créés pour fermer),
// la logique d'écriture et d'auth vit ici, et les deux chemins l'appellent.
//
// Aucune dépendance à Deno ni à supabase-js : `pg` et rien d'autre.
import { createHash } from "node:crypto";
import { isNativeSpanId } from "../shared/otlp.mjs";
import { finaliserIssues, regrouperErreurs } from "./error-grouping.mjs";
import { symbolicateurIngestion } from "./error-symbolication.mjs";
import {
  appsDuLot,
  barriereActivee,
  ErreurPorteeApp,
  filtrerParBarrieres,
  sessionSousBarriere,
  withAppIngestTransaction,
} from "./privacy-barriere.mjs";

// ───────────────────────────── Écriture ─────────────────────────────

/** Insert multi-lignes (une requête par table), paramétré. */
export function batchInsert(client, table, cols, rows, conflictClause) {
  if (!rows.length) return Promise.resolve();
  const params = [];
  const tuples = rows
    .map(
      (row) =>
        `(${cols
          .map((c) => {
            params.push(row[c]);
            return `$${params.length}`;
          })
          .join(",")})`,
    )
    .join(",");
  return client.query(
    `insert into ${table} (${cols.join(",")}) values ${tuples} ${conflictClause}`,
    params,
  );
}

// Colonnes RÉELLEMENT présentes sur rum_session, relues périodiquement.
//
// POURQUOI CE GARDE-FOU EXISTE. Sur ce projet le déploiement est automatique et
// la migration est MANUELLE : entre le déploiement d'un code qui écrit une
// nouvelle colonne et le `psql` qui la crée, il existe une fenêtre où l'INSERT
// référence une colonne absente. Postgres rejette alors la requête ENTIÈRE, donc
// la transaction, donc le lot : ce n'est pas le champ nouveau qui se perd, c'est
// TOUTE la télémétrie, jusqu'à ce qu'un humain lance la migration. Un écart de
// quelques minutes vaut un trou de quelques minutes ; un oubli d'un jour vaut un
// trou d'un jour, sans erreur visible côté client (le SDK poste en beacon).
//
// Le TTL est ce qui rend la reprise automatique : sans lui, une instance
// serverless chaude garderait indéfiniment la liste d'avant la migration et
// n'écrirait jamais les nouvelles colonnes, même une fois celles-ci créées.
const TTL_COLONNES_MS = 60_000;
/** Un cache PAR TABLE : `rum_session` et `rum_longtask` ont chacune gagné des
 *  colonnes à des dates différentes, et un cache partagé les confondrait. */
const colonnesCache = new Map();

async function colonnesDe(client, table) {
  const vu = colonnesCache.get(table);
  if (vu && Date.now() - vu.at < TTL_COLONNES_MS) return vu.set;
  const { rows } = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  const set = new Set(rows.map((r) => r.column_name));
  colonnesCache.set(table, { at: Date.now(), set });
  return set;
}

const colonnesSession = (client) => colonnesDe(client, "rum_session");

/** Réinitialise le cache de colonnes (tests). */
export function _resetColonnesCache() {
  colonnesCache.clear();
}

/** Colonnes d'attribution LoAF, ajoutées par migration-v55. */
const OPTIONNELLES_LONGTASK = [
  "source",
  "blocking_ms",
  "render_ms",
  "script_url",
  "script_function",
  "script_ms",
  "invoker",
];

/**
 * Dimensions déclarées d'un événement (migration-v75), réduites à ce que la table
 * porte : env et release, plus service sur rum_span et rum_event_index.
 *
 * Même garde-fou que les autres colonnes optionnelles : écrites avant la
 * migration, elles feraient rejeter le lot ENTIER. La valeur voyage sur chaque
 * ligne depuis flattenOtlp ; elle n'est jamais relue sur la session.
 */
export function colonnesDimensions(dispo, { service = false } = {}) {
  return ["env", "release", ...(service ? ["service"] : [])].filter((c) => dispo.has(c));
}

/**
 * Colonnes de l'INSERT rum_longtask, réduites à ce que la base porte.
 *
 * Même garde-fou que pour rum_session, pour la même raison : une colonne
 * référencée mais absente fait rejeter par Postgres la requête ENTIÈRE, donc la
 * transaction, donc TOUT le lot — ce n'est pas l'attribution qui se perd, c'est
 * la télémétrie complète, en silence (le SDK poste en beacon). Le déploiement
 * applique bien les migrations en pre-deploy, mais ce chemin sert aussi aux
 * installations qui ne passent pas par lui.
 */
export function colonnesLongtask(dispo) {
  return [
    "span_id",
    "session_id",
    "app_id",
    "route",
    "duration_ms",
    ...OPTIONNELLES_LONGTASK.filter((c) => dispo.has(c)),
    ...colonnesDimensions(dispo),
    "ts",
  ];
}

/** Colonnes optionnelles de rum_error, dans l'ordre où elles s'insèrent. */
const OPTIONNELLES_ERREUR = [
  // v59 : répétitions comptées par le SDK ; v67 : action causale.
  "occurrences", "action_id",
  // v69 (P5.1) : corrélation, source, caractère géré/fatal, snapshot P2 et
  // dimensions déclarées par l'émetteur.
  "trace_id", "source_parent_span_id", "error_source", "handled", "is_fatal", "context",
  "view_id", "view_name", "user_id_hash", "account_id_hash", "env", "service",
  // v70 (P5.3) : origine d'une exception dérivée d'un span ou d'un log.
  "origin_signal", "exception_id",
  // v71 (P5.4) : résultat de la symbolication faite avant l'écriture.
  "symbolication_status", "stack_symbolicated",
  // v72 (P5.5) : clé de regroupement v2 en ombre, clé déclarée hachée, et issue
  // quand l'app a activé le regroupement v2.
  "grouping_version", "grouping_key", "grouping_basis", "fingerprint_override_hash", "grouping_diagnostic", "issue_id",
];

/**
 * Colonnes de l'INSERT rum_error, réduites à ce que la base porte.
 *
 * Même garde-fou que pour rum_session : le code part en production AVANT que le
 * pre-deploy n'applique migration-v69, et une colonne absente ferait rejeter
 * tout le lot, pas seulement le champ nouveau.
 */
export function colonnesErreur(dispo) {
  return [
    "span_id", "session_id", "app_id", "route", "kind", "message", "error_type",
    "stack", "source", "lineno", "colno", "release", "fingerprint",
    ...OPTIONNELLES_ERREUR.filter((c) => dispo.has(c)),
    "ts",
  ];
}

/** Lignes par INSERT rum_error : très en deçà des 65 535 paramètres d'une requête. */
const ERREURS_PAR_INSERT = 1000;

/** Sources dont la stack n'est pas du JavaScript livré (miroir de stackSymbolisable côté console). */
const STACK_BACKEND = new Set(["node", "python", "otel", "native"]);

/**
 * Rattache chaque exception dérivée à la session qu'elle déclare, SI cette
 * session existe dans la même app ; sinon `session_id` reste NULL.
 *
 * Une session revendiquée n'est pas une session prouvée : un backend la lit dans
 * un `tracestate` que n'importe qui peut forger, et le lot du navigateur qui la
 * crée peut arriver après, ou jamais (échantillonnage). Écrite telle quelle, elle
 * violerait la clé étrangère et ferait perdre le lot entier, ou rattacherait
 * l'erreur à la session d'un autre tenant. Aucune session n'est créée pour
 * l'occasion : la trace suffit à relier l'erreur au parcours quand il existe.
 *
 * `for key share` verrouille les sessions trouvées jusqu'au commit : un
 * effacement concurrent ne peut pas les supprimer entre cette lecture et
 * l'INSERT — il attend, ou il est passé et la session n'est plus trouvée.
 */
async function rattacherSessions(client, errors) {
  const revendiquees = errors.filter((e) => e.session_claim);
  if (!revendiquees.length) return errors;
  const { rows } = await client.query(
    `select app_id, session_id from rum_session
      where (app_id, session_id) in (select * from unnest($1::text[], $2::text[]))
      for key share`,
    [revendiquees.map((e) => e.app_id), revendiquees.map((e) => e.session_claim)],
  );
  const connues = new Set(rows.map((r) => JSON.stringify([r.app_id, r.session_id])));
  return errors.map((e) => (e.session_claim
    ? { ...e, session_id: connues.has(JSON.stringify([e.app_id, e.session_claim])) ? e.session_claim : null }
    : e));
}

/**
 * Écrit les erreurs d'un lot et rend ce qui a RÉELLEMENT été inséré.
 *
 * `inserees` vient de `RETURNING` : un rejeu, une exception déjà reçue par
 * l'autre signal (même `mip.exception_id`) ou une identité déjà connue ne
 * comptent pas. Tout compteur en aval part de ce nombre, jamais de la taille du
 * lot reçu.
 *
 * AVANT migration-v70, une exception dérivée n'est PAS écrite : sans colonne
 * `origin_signal`, le métering la compterait comme un événement de plus alors
 * que son span porteur l'est déjà. La collecte P5.3 s'active donc avec sa
 * migration ; les erreurs des SDK client, elles, s'écrivent comme avant.
 *
 * À PARTIR DE migration-v72, chaque erreur porte sa clé de regroupement v2, et
 * celles d'une app activée leur issue (error-grouping.mjs). Première et dernière
 * vue des issues suivent les lignes RETURNING : `finaliser` les applique en fin
 * de transaction, juste avant le commit, pour ne tenir le verrou d'une issue
 * chaude que le temps de celui-ci. Dès migration-v73, il y décide aussi la
 * régression d'une issue résolue (P5.6), jamais un travail planifié après coup.
 *
 * @returns {Promise<{ bilan: {recues: number, inserees: number, ignorees: number}, finaliser: () => Promise<void> }>}
 */
async function ecrireErreurs(client, errors) {
  if (!errors.length) return { bilan: { recues: 0, inserees: 0, ignorees: 0 }, finaliser: async () => {} };
  const dispo = await colonnesDe(client, "rum_error");
  const retenues = dispo.has("origin_signal") ? errors : errors.filter((e) => !e.origin_signal);
  const rattachees = await rattacherSessions(client, retenues);
  const { lignes, plan } = dispo.has("grouping_key")
    ? await regrouperErreurs(client, rattachees)
    : { lignes: rattachees, plan: null };
  const cols = colonnesErreur(dispo);
  const inserees = [];
  for (let debut = 0; debut < lignes.length; debut += ERREURS_PAR_INSERT) {
    const { rows } = await batchInsert(
      client,
      "rum_error",
      cols,
      // `context` est NOT NULL en v69 : une ligne sans snapshot (lot différé
      // antérieur, émetteur sans contexte) écrit l'objet vide, jamais NULL. Les
      // autres champs absents de ces lots deviennent NULL, c'est-à-dire inconnus.
      lignes.slice(debut, debut + ERREURS_PAR_INSERT).map((e) => ({ ...e, context: JSON.stringify(e.context ?? {}) })),
      plan ? "on conflict (span_id) do nothing returning id, app_id, issue_id, ts, release, env" : "on conflict (span_id) do nothing returning id",
    );
    inserees.push(...rows);
  }
  // v73 (P5.6) : la régression d'une issue résolue se décide dans cette transaction.
  const regression = plan !== null && (await colonnesDe(client, "error_issue_activity")).size > 0;
  return {
    bilan: { recues: errors.length, inserees: inserees.length, ignorees: errors.length - retenues.length },
    finaliser: () => finaliserIssues(client, plan, inserees, { regression }),
  };
}

/** Colonnes optionnelles de rum_session, dans l'ordre où elles s'insèrent. */
const OPTIONNELLES = [
  "collection_source", "release", "net_type", "visitor_id",
  // v58 : échantillonnage. `weight` n'y figure PAS — c'est une colonne générée,
  // que PostgreSQL refuse qu'on écrive.
  "sample_rate", "error_sample_rate", "has_error",
  // v66 : identité métier pseudonymisée + snapshot global de session.
  "user_id_hash", "account_id_hash", "context",
  // v75 (P6.1) : navigateur et système déduits de l'user-agent.
  "browser", "browser_version", "os", "os_version",
  // v82 (P7.5) : runtime de l'émetteur — la population de l'écran /mobile.
  "runtime",
  // v85 (P8.7) : d'où vient `geo_country`, et avec quelle livraison DB-IP. Deux
  // colonnes, jamais une adresse : l'IP ne franchit pas la frontière du process.
  "geo_source", "geo_db_version",
];

/**
 * Liste de colonnes de l'INSERT, réduite à ce que la base porte réellement.
 * PURE, donc testable : c'est ici qu'une erreur se paie par le rejet de tout
 * le lot, pas seulement par la perte d'un champ.
 */
export function colonnesInsert(dispo) {
  return [
    "session_id", "app_id", "client_id", "user_hash", "user_agent", "device_type",
    "geo_country", "is_bot",
    ...OPTIONNELLES.filter((c) => dispo.has(c)),
    "started_at", "last_seen_at", "page_count",
  ];
}

/**
 * Clause `on conflict`. Assemblée en LISTE et non en chaîne à trous : une clause
 * optionnelle interpolée laisse une virgule orpheline quand elle est vide, et une
 * colonne assignée deux fois fait rejeter tout l'INSERT par Postgres
 * (« multiple assignments to same column »). Les deux ont été commis ici.
 *
 * `collection_source` en est délibérément absent : la source est figée à la
 * première vue de la session (cf. flattenOtlp).
 */
export function clauseConflitSession(dispo) {
  const set = [
    "last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at)",
    "user_agent  = coalesce(rum_session.user_agent, excluded.user_agent)",
    "geo_country = coalesce(rum_session.geo_country, excluded.geo_country)",
    "device_type = coalesce(rum_session.device_type, excluded.device_type)",
    // v53 : posés au premier lot qui les porte, jamais écrasés ensuite. net_type
    // arrive après l'événement load, donc dans un lot POSTÉRIEUR à celui qui a
    // créé la session : sans coalesce, la colonne resterait vide.
    // `visitor_id` rejoint la liste pour la même raison, plus une : la file de
    // retry peut rejouer un lot d'un SDK antérieur, sans identifiant. Le
    // coalesce garantit qu'un identifiant déjà connu n'est jamais effacé par un
    // lot qui n'en porte pas.
    // v75 : navigateur et système, figés à la première valeur connue comme
    // l'user-agent dont ils dérivent.
    // v82 : `runtime` rejoint la liste des champs figés à la première valeur
    // CONNUE. Un lot d'un SDK antérieur au marqueur, ou d'une bibliothèque OTel
    // tierce posée dans la même application, n'en porte pas : sans coalesce, il
    // ferait retomber la session à « inconnu » et la sortirait de la population
    // de /mobile après coup.
    ...["release", "net_type", "visitor_id", "user_id_hash", "account_id_hash",
      "browser", "browser_version", "os", "os_version", "runtime"]
      .filter((c) => dispo.has(c))
      .map((c) => `${c} = coalesce(rum_session.${c}, excluded.${c})`),
    // v85 (P8.7) — LA PROVENANCE SUIT LE PAYS, DANS LE MÊME GESTE. `geo_country`
    // est figé à la première valeur connue (coalesce, ci-dessus) : la provenance
    // ne doit donc changer QUE si c'est le lot courant qui a posé le pays. Sans
    // cette condition, une session dont le pays vient du fuseau se verrait
    // étiquetée `geoip` au lot suivant — et le chiffre affirmerait une mesure
    // qui n'a jamais eu lieu. C'est aussi ce qui interdit de réécrire une
    // ancienne session avec une adresse d'aujourd'hui.
    ...["geo_source", "geo_db_version"]
      .filter((c) => dispo.has(c))
      .map((c) => `${c} = case when rum_session.geo_country is null and excluded.geo_country is not null
                               then excluded.${c} else rum_session.${c} end`),
    ...(dispo.has("context")
      ? ["context = case when excluded.context <> '{}'::jsonb then excluded.context else rum_session.context end"]
      : []),
    // v58 — `has_error` ne redescend JAMAIS. Les spans d'une session arrivent en
    // plusieurs lots ; celui qui portait l'exception peut être suivi d'un lot
    // sans erreur, et un `= excluded.has_error` remettrait le drapeau à faux.
    // La session changerait alors de poids après coup, ce qui ferait bouger des
    // agrégats déjà affichés.
    ...(dispo.has("has_error")
      ? ["has_error = rum_session.has_error or excluded.has_error"]
      : []),
    // `sample_rate` et `error_sample_rate` sont délibérément ABSENTS de cette
    // liste, pour la même raison que `collection_source` : le taux est figé à la
    // première vue de la session. Un lot rejoué par un SDK antérieur, qui ne
    // porte pas l'attribut, retomberait sur 1 et effacerait l'échantillonnage —
    // multipliant d'un coup tous les volumes de cette session par son taux.
  ];
  // LA CLAUSE EST BORNÉE À L'APPLICATION. La cible du conflit est `session_id`
  // seul — c'est la clé primaire —, donc un lot déclarant l'app B avec un
  // identifiant déjà stocké sous A mettait à jour la ligne de A : horodatage,
  // release, identité. `writeRowsWithClient` refuse déjà ce lot avant d'écrire ;
  // ce garde-fou couvre la fenêtre restante, où deux applications écrivent en
  // parallèle sous DEUX verrous différents et ne s'attendent donc pas.
  return `on conflict (session_id) do update set ${set.join(", ")}
            where rum_session.app_id = excluded.app_id`;
}

/**
 * Capacités déclarées d'un runtime mobile (P7.5, migration-v82).
 *
 * TROIS RAISONS À CETTE FONCTION, chacune une ligne de code :
 *
 *   · `to_regclass` d'abord. Comme pour les colonnes optionnelles, la console est
 *     publiée avant que la migration ne tourne. Une table absente ferait rejeter
 *     par Postgres la requête ENTIÈRE, donc la transaction, donc TOUT le lot : on
 *     perdrait la télémétrie pour une déclaration de capacité.
 *   · `verified_at`, `verified_by` et `verified_note` sont ABSENTS du
 *     `do update set`. C'est là, et nulle part ailleurs, que se joue la règle
 *     « une capacité activée n'est pas un test natif passé » : aucun chemin
 *     d'ingestion ne peut écrire une vérification, quoi que le client envoie.
 *   · `first_declared_at` n'est pas non plus mis à jour : « depuis quand cette
 *     release déclare-t-elle collecter ceci » se perdrait au premier lot suivant.
 *
 * La table ne compte dans aucun quota : elle ne porte pas un événement de
 * télémétrie de plus, seulement ce qu'un runtime dit savoir observer.
 */
async function ecrireCapacites(client, capabilities) {
  if (!capabilities?.length) return;
  const { rows } = await client.query("select to_regclass('public.mobile_capabilities') as t");
  if (rows[0]?.t == null) return;
  await batchInsert(
    client,
    "mobile_capabilities",
    ["app_id", "runtime", "release", "capability", "declared"],
    capabilities,
    `on conflict (app_id, runtime, release, capability) do update
       set declared = excluded.declared, last_declared_at = now()`,
  );
}

const COLONNES_METRIQUE = [
  "span_id", "session_id", "app_id", "route", "name", "value", "rating", "attribution", "ts",
];

/** Une seule ligne par vital consolidé dans un même lot (CLS/INP inclus). */
function consoliderMetriques(metrics) {
  const uniques = new Map();
  for (const metric of metrics) {
    if (!metric.metric_uid) {
      uniques.set(Symbol(), metric);
      continue;
    }
    const key = `${metric.app_id}\u0000${metric.session_id}\u0000${metric.name}\u0000${metric.metric_uid}`;
    const previous = uniques.get(key);
    // La première ligne conserve l'identité span_id canonique ; les rapports
    // ultérieurs ne peuvent améliorer que la valeur/ts/rating, jamais la clé.
    if (!previous || metric.value > previous.value) {
      uniques.set(key, previous
        ? { ...metric, span_id: previous.span_id }
        : metric);
    }
  }
  return [...uniques.values()];
}

/**
 * Écrit les Web Vitals, en DEUX passes — et la raison n'est pas cosmétique.
 *
 * CLS et INP sont rapportés PLUSIEURS FOIS par chargement de page : `web-vitals`
 * rappelle son callback à chaque passage de l'onglet en `hidden`. Chaque rapport
 * devenait une ligne, et comme ces métriques croissent au fil de la page, les
 * rapports intermédiaires — systématiquement plus favorables — tiraient le p75
 * vers le bas. Le SDK émet `webvital.id`, qui identifie la métrique pour ce
 * chargement ; l'ingestion le jetait (finding 1.5).
 *
 * POURQUOI DEUX PASSES. PostgreSQL n'accepte qu'UNE clause `on conflict` par
 * ordre. Les lignes qui portent `metric_uid` se dédupliquent sur l'index partiel
 * `uq_metric_report` ; celles qui n'en portent pas — historique et SDK non mis à
 * jour — n'y figurent pas et doivent retomber sur l'unicité de `span_id`. Les
 * mélanger ferait échouer la seconde catégorie sur une violation d'unicité, donc
 * avorter TOUTE la transaction : un lot entier perdu pour une ligne ancienne.
 *
 * POURQUOI `greatest` ET PAS « le dernier gagne ». Les cinq vitals sont monotones
 * croissantes sur la vie d'une page (CLS cumule, INP retient la pire interaction,
 * LCP ne peut que grandir ; FCP et TTFB ne sont rapportés qu'une fois, où
 * `greatest` ne fait rien). Prendre le maximum donne le même résultat que « le
 * dernier » quand les lots arrivent dans l'ordre, et reste juste quand ils
 * arrivent dans le désordre — ce qui se produit dès qu'un lot passe par la file
 * de rejeu. Une seule règle pour les cinq, donc aucune branche qui puisse dériver.
 */
async function ecrireMetriques(client, metrics) {
  const consolidées = consoliderMetriques(metrics);
  const dispo = await colonnesDe(client, "rum_metric");
  const avecUid = dispo.has("metric_uid");
  // Les dimensions (v75) restent celles du premier rapport : tous les rapports
  // d'une même métrique viennent du même chargement de page, donc de la même release.
  const cols = [...COLONNES_METRIQUE, ...(avecUid ? ["metric_uid"] : []), ...colonnesDimensions(dispo)];
  const prep = (m) => ({ ...m, attribution: m.attribution ? JSON.stringify(m.attribution) : null });

  if (!avecUid) {
    await batchInsert(client, "rum_metric", cols, consolidées.map(prep), "on conflict (span_id) do nothing");
    return;
  }
  const identifiees = consolidées.filter((m) => m.metric_uid);
  const anonymes = consolidées.filter((m) => !m.metric_uid);

  await batchInsert(
    client,
    "rum_metric",
    cols,
    identifiees.map(prep),
    `on conflict (session_id, name, metric_uid) where metric_uid is not null do update set
       value  = greatest(rum_metric.value, excluded.value),
       rating = case when excluded.value > rum_metric.value then excluded.rating else rum_metric.rating end,
       ts     = case when excluded.value > rum_metric.value then excluded.ts     else rum_metric.ts     end`,
  );
  await batchInsert(client, "rum_metric", cols, anonymes.map(prep), "on conflict (span_id) do nothing");
}

/**
 * Les rapports CLS/INP peuvent porter plusieurs span_id pour le même
 * webvital.id. Après l'upsert de rum_metric, on reprend donc l'identité de la
 * ligne canonique (celle qui survit au conflit metric_uid) avant d'indexer.
 * Le reste des kinds conserve son span OTLP natif du lot.
 */
async function indexAvecVitalsConsolides(client, eventIndex, metrics) {
  const metricBySpan = new Map(
    (metrics ?? [])
      .filter((metric) => metric?.metric_uid && isNativeSpanId(metric.span_id))
      .map((metric) => [metric.span_id.toLowerCase(), metric]),
  );

  const resolved = await Promise.all(eventIndex.map(async (event) => {
    if (event.kind !== "vital") return event;
    const metric = metricBySpan.get(event.source_span_id);
    if (!metric) return event;
    const { rows } = await client.query(
      `select app_id, session_id, ts, route, name, span_id
         from rum_metric
        where app_id = $1 and session_id = $2 and name = $3 and metric_uid = $4
        limit 1`,
      [metric.app_id, metric.session_id, metric.name, metric.metric_uid],
    );
    const canonical = rows[0];
    if (!canonical || !isNativeSpanId(canonical.span_id)) return null;
    return {
      ...event,
      app_id: canonical.app_id,
      session_id: canonical.session_id,
      ts: canonical.ts,
      route: canonical.route,
      source_span_id: canonical.span_id.toLowerCase(),
    };
  }));
  return resolved.filter(Boolean);
}

/**
 * Symbolique les erreurs d'un lot et REPORTE le résultat SUR chaque ligne.
 *
 * Le résultat voyageait par POSITION dans le tableau d'origine. Il ne peut plus :
 * le filtrage par barrières (P8.1) retire des lignes entre la symbolication et
 * l'écriture, et un tableau indexé se serait décalé en silence — la stack d'une
 * personne serait allée sur l'erreur d'une autre.
 *
 * Fait AVANT la transaction par `writeRows` : charger une source map de plusieurs
 * Mio ne doit pas prolonger la tenue du verrou d'application.
 */
export async function appliquerSymbolication(client, errors, symbolicateur = symbolicateurIngestion) {
  if (!errors?.length || !symbolicateur) return errors ?? [];
  const dispo = await colonnesDe(client, "rum_error");
  if (!dispo.has("symbolication_status")) return errors;
  const resultats = await symbolicateur.symboliquerLot(client, errors);
  // Jamais sur une stack backend (P5.3) : une map navigateur n'en décrit aucune
  // frame. `symbolicated_frames` n'est pas une colonne : la clé v2 la lit, puis
  // elle disparaît avec la ligne.
  return errors.map((e, i) => (STACK_BACKEND.has(e.error_source)
    ? e
    : {
        ...e,
        symbolication_status: resultats[i]?.status ?? null,
        stack_symbolicated: resultats[i]?.stack ?? null,
        symbolicated_frames: resultats[i]?.positions ?? null,
      }));
}

/**
 * Une session déjà enregistrée sous une AUTRE application ne peut pas être
 * ÉCRITE par celle-ci.
 *
 * `on conflict (session_id) do update` ne porte PAS l'app dans sa cible : un lot
 * qui déclare l'app B avec un identifiant de session déjà stocké sous A mettait
 * à jour la ligne de A — horodatage, release, identité. Écrire chez un autre
 * locataire n'est pas un conflit à fusionner : c'est une demande hors portée, et
 * la rejouer donnerait le même résultat. On refuse le lot, en le disant.
 *
 * SEULE la collection `sessions` est contrôlée, et c'est délibéré : ce sont les
 * seules lignes qui déclenchent l'upsert. Une ligne enfant qui REVENDIQUE une
 * session d'une autre app relève d'un autre mécanisme, déjà en place — P5.3 ne
 * rattache une exception que si la session existe dans la MÊME app, et les
 * autres tables s'écrivent en `on conflict do nothing`, qui ne met rien à jour
 * chez le voisin.
 *
 * Le message ne porte AUCUN identifiant de session : les deux applications
 * suffisent à diagnostiquer, et un journal n'a pas à recevoir de pseudonyme.
 */
async function verifierPorteeSessions(client, rows) {
  const revendiques = new Map();
  for (const ligne of rows.sessions ?? []) {
    const { app_id: app, session_id: session } = ligne ?? {};
    if (typeof app !== "string" || !app) continue;
    if (typeof session !== "string" || !session) continue;
    let apps = revendiques.get(session);
    if (!apps) revendiques.set(session, (apps = new Set()));
    apps.add(app);
  }
  if (!revendiques.size) return;
  const { rows: stockees } = await client.query(
    "select session_id, app_id from rum_session where session_id = any($1::text[])",
    [[...revendiques.keys()]],
  );
  for (const { session_id: session, app_id: proprietaire } of stockees) {
    const apps = revendiques.get(session);
    if (apps && !apps.has(proprietaire)) {
      throw new ErreurPorteeApp(
        `session déjà enregistrée pour « ${proprietaire} », revendiquée par « ${[...apps].join(", ")} »`,
      );
    }
  }
}

/**
 * Écrit un lot OTLP aplati (sortie de flattenOtlp) avec un client DÉJÀ dans une
 * transaction, qui tient DÉJÀ le verrou de ses applications.
 *
 * Ni begin, ni commit, ni release : l'appelant les possède. C'est ce qui permet
 * au drain de la file d'écrire les tables finales AVEC LE MÊME CLIENT que celui
 * qui tient sa ligne de file — l'ancien code appelait `writeRows(pool, …)`, qui
 * ouvrait sa propre transaction sur une autre connexion, et les deux n'étaient
 * donc sérialisées avec rien.
 *
 * Les erreurs doivent déjà porter leur symbolication (`appliquerSymbolication`).
 * Idempotent au rejeu : `on conflict do nothing` partout, `greatest` sur les
 * horodatages de session — c'est ce qui autorise le retry côté appelant.
 * @returns {Promise<{erreurs: {recues: number, inserees: number, ignorees: number}}>}
 */
export async function writeRowsWithClient(client, {
  sessions,
  pageviews,
  metrics,
  errors,
  resources,
  longtasks,
  breadcrumbs,
  events,
  actions = [],
  spans,
  eventIndex = [],
  sviCalls,
  sviSteps,
  sviLegs,
  // P7.5 — capacités DÉCLARÉES par un runtime mobile. Défaut `[]` : un lot
  // antérieur au modèle, ou déposé avant lui dans `ingest_raw`, n'en porte pas.
  capabilities = [],
}) {
  {
    await verifierPorteeSessions(client, { sessions });
    // Colonnes optionnelles : présentes une fois la migration passée, ignorées
    // avant. Le reste du lot part normalement dans les deux cas.
    const dispo = await colonnesSession(client);
    await batchInsert(
      client,
      "rum_session",
      // `collection_source` MANQUAIT de cette liste. batchInsert construit l'INSERT
      // strictement depuis elle : toute clé absente est jetée en silence, et la
      // colonne retombait sur son DEFAULT 'sdk'. Aucune session ne pouvait donc
      // être enregistrée comme venant de l'extension sur ce chemin — le seul
      // utilisé en production — alors que le SDK envoyait bien l'attribut.
      colonnesInsert(dispo),
      sessions.map((s) => ({
        ...s,
        context: s.context ? JSON.stringify(s.context) : "{}",
        started_at: s.last_seen_at,
        page_count: 0,
      })),
      clauseConflitSession(dispo),
    );
    await batchInsert(
      client,
      "rum_pageview",
      ["span_id", "session_id", "app_id", "route", "url", "referrer", "nav_type",
       ...colonnesDimensions(await colonnesDe(client, "rum_pageview")), "started_at"],
      pageviews.map((p) => ({ ...p, started_at: p.ts })),
      "on conflict (span_id) do nothing",
    );
    await ecrireMetriques(client, metrics);
    // La racine est écrite avant tous les enfants liés dans la transaction.
    // Pas de FK synchrone : le retry/déploiement progressif restent possibles.
    const actionDispo = await colonnesDe(client, "rum_action");
    if (actionDispo.has("action_id")) {
      await batchInsert(
        client,
        "rum_action",
        ["action_id", "span_id", "session_id", "app_id", "type", "name", "route", "context",
         ...colonnesDimensions(actionDispo), "ts"],
        actions.map((action) => ({
          ...action,
          context: action.context ? JSON.stringify(action.context) : "{}",
        })),
        "on conflict (action_id) do nothing",
      );
    }
    // Après les sessions du lot : une exception backend qui revendique l'une
    // d'elles la trouve déjà écrite. La symbolication voyage SUR chaque ligne
    // (cf. appliquerSymbolication) : ni le filtrage pré-v70, ni le rattachement
    // de session, ni le filtrage par barrières ne peuvent la décaler.
    const erreurs = await ecrireErreurs(client, errors);
    const resourceDispo = await colonnesDe(client, "rum_resource");
    await batchInsert(
      client,
      "rum_resource",
      ["span_id", "session_id", "app_id", "route", "url", "type", "duration_ms", "transfer_size", "render_blocking",
       ...(resourceDispo.has("action_id") ? ["action_id"] : []), ...colonnesDimensions(resourceDispo), "ts"],
      resources,
      "on conflict (span_id) do nothing",
    );
    await batchInsert(
      client,
      "rum_longtask",
      colonnesLongtask(await colonnesDe(client, "rum_longtask")),
      longtasks,
      "on conflict (span_id) do nothing",
    );
    const breadcrumbDispo = await colonnesDe(client, "rum_breadcrumb");
    await batchInsert(
      client,
      "rum_breadcrumb",
      ["span_id", "session_id", "app_id", ...(breadcrumbDispo.has("route") ? ["route"] : []), "type", "label", "seq",
       ...(breadcrumbDispo.has("action_id") ? ["action_id"] : []), "ts"],
      breadcrumbs,
      "on conflict (span_id) do nothing",
    );
    const eventDispo = await colonnesDe(client, "rum_event");
    const eventOptionnelles = [
      "event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name",
      "action_id", "timing_ms", "feature_flag_value",
    ].filter((col) => eventDispo.has(col)).concat(colonnesDimensions(eventDispo));
    await batchInsert(
      client,
      "rum_event",
      ["span_id", "session_id", "app_id", "route", "name", "props", ...eventOptionnelles, "ts"],
      events.map((e) => ({
        ...e,
        props: e.props ? JSON.stringify(e.props) : null,
        context: e.context ? JSON.stringify(e.context) : "{}",
      })),
      "on conflict (span_id) do nothing",
    );
    const spanDispo = await colonnesDe(client, "rum_span");
    await batchInsert(
      client,
      "rum_span",
      ["span_id", "trace_id", "parent_span_id", "tier", "session_id", "app_id", "route", "url", "method", "status_code", "duration_ms", "name", "kind",
       ...(spanDispo.has("action_id") ? ["action_id"] : []), ...colonnesDimensions(spanDispo, { service: true }), "ts"],
      spans ?? [],
      "on conflict (span_id) do nothing",
    );
    // Projection append-only, dérivée à partir de collections déjà scrubbed par
    // flattenOtlp. Elle n'entre volontairement dans AUCUN compteur de quota :
    // un même signal source produit une ligne de lecture, pas un événement de
    // télémétrie supplémentaire.
    // Comme les autres ajouts de schéma, ne jamais faire tomber les écritures
    // sources pendant l'intervalle code-déployé / migration-appliquée.
    if ((await colonnesDe(client, "rum_event_index")).has("source_span_id")) {
      let projection = await indexAvecVitalsConsolides(client, eventIndex, metrics);
      if (!actionDispo.has("action_id")) {
        projection = projection.map((event) => event.source_name === "frustration.error"
          ? { ...event, source_name: "track" }
          : event);
      }
      const indexDispo = await colonnesDe(client, "rum_event_index");
      const indexOptionnelles = [
        "event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name",
        "action_id", "timing_ms", "feature_flag_value",
      ].filter((col) => indexDispo.has(col)).concat(colonnesDimensions(indexDispo, { service: true }));
      await batchInsert(
        client,
        "rum_event_index",
        ["app_id", "session_id", "ts", "route", "kind", "source_name", "source_span_id", ...indexOptionnelles],
        projection.map((event) => ({
          ...event,
          context: event.context ? JSON.stringify(event.context) : "{}",
        })),
        "on conflict (app_id, kind, source_span_id) do nothing",
      );
    }

    // SVI (migration-v51) : la fusion des lots est non triviale (ne jamais
    // régresser un champ vers NULL, retenir le début le plus tôt / la fin la
    // plus tard, ne jamais rouvrir un appel clos) — elle vit en base, appelée
    // à l'identique par tous les chemins d'ingestion.
    for (const call of sviCalls ?? []) {
      await client.query("select upsert_svi_call($1::jsonb)", [JSON.stringify(call)]);
    }
    await batchInsert(
      client,
      "svi_step",
      ["step_id", "parent_step_id", "app_id", "call_id", "seq", "kind", "node_id", "node_label",
       "menu_path", "depth", "branch", "input_class", "input_len", "input_sensitive",
       "no_match", "no_input", "reprompt_index", "asr_confidence", "rejected",
       "milestone", "flow_outcome", "started_at", "duration_ms", "exit_reason"],
      sviSteps ?? [],
      "on conflict (step_id) do nothing",
    );
    await batchInsert(
      client,
      "svi_leg",
      ["app_id", "call_id", "leg_ref", "role", "dir", "codec", "ptime_ms", "sample_rate",
       "carrier", "mos_method", "mos_avg", "mos_min", "r_factor_avg", "r_factor_min",
       "jitter_avg_ms", "jitter_max_ms", "loss_avg_pct", "loss_max_pct", "rtt_avg_ms",
       "rtt_max_ms", "packets_sent", "packets_lost", "e_model_params", "started_at", "ended_at"],
      (sviLegs ?? []).map((l) => ({ ...l,
        e_model_params: l.e_model_params ? JSON.stringify(l.e_model_params) : null })),
      "on conflict (app_id, call_id, leg_ref, dir) do nothing",
    );
    // P7.5 : ce que le runtime mobile DÉCLARE collecter. Dans la transaction du
    // lot, comme le reste : une déclaration écrite alors que la télémétrie qui
    // l'accompagne est annulée décrirait une collecte qui n'a pas eu lieu.
    await ecrireCapacites(client, capabilities);
    // page_count DÉRIVÉ du compte réel de pageviews (idempotent au rejeu, cf.
    // migration-v07) plutôt qu'incrémenté.
    if (sessions.length) {
      // Compté et recollé PAR APPLICATION : `session_id` seul joignait un
      // identifiant émis par le client, donc deux applications qui émettent la
      // même valeur échangeaient leur nombre de pages — la même correction que
      // celle apportée à l'histogramme en v80.
      await client.query(
        `update rum_session s
           set page_count = sub.c
          from (select app_id, session_id, count(*) c from rum_pageview
                 where (app_id, session_id) in (select * from unnest($1::text[], $2::text[]))
                 group by app_id, session_id) sub
         where s.app_id = sub.app_id and s.session_id = sub.session_id`,
        [sessions.map((s) => s.app_id), sessions.map((s) => s.session_id)],
      );
    }
    await erreurs.finaliser();
    return { erreurs: erreurs.bilan };
  }
}

/**
 * Wrapper compatible : ouvre la transaction, verrouille la ou les applications
 * du lot, filtre par barrières, puis délègue à `writeRowsWithClient`.
 *
 * La symbolication reste AVANT la transaction : charger une source map de
 * plusieurs Mio sous le verrou d'application ferait attendre tout le trafic de
 * cette app. Son résultat voyage sur chaque ligne, donc le filtrage qui suit ne
 * peut pas le décaler.
 *
 * `opts.client` permet à un appelant qui tient DÉJÀ une transaction verrouillée
 * de réutiliser ce chemin sans en rouvrir une seconde.
 *
 * `opts.verrou` ({ delaiVerrouMs, tentatives }) borne l'attente du verrou
 * d'application ; absent, la stratégie par défaut (`STRATEGIE_VERROU`). Le
 * collector la resserre pour tenir son budget de requête (P2).
 * @returns {Promise<{erreurs: {recues: number, inserees: number, ignorees: number}, refuses?: object}>}
 */
export async function writeRows(pool, rows, { symbolicateur = symbolicateurIngestion, client: fourni = null, verrou = {} } = {}) {
  const client = fourni ?? (await pool.connect());
  try {
    // Client fourni : il est déjà dans une transaction verrouillée par son
    // appelant, et symboliquer ici allonge la tenue de ce verrou. C'est le prix
    // à payer : rouvrir une connexion pour symboliquer romprait la
    // sérialisation, c'est-à-dire exactement le défaut qu'on répare.
    const symbolisees = { ...rows, errors: await appliquerSymbolication(client, rows.errors ?? [], symbolicateur) };
    const travail = async (c) => {
      const filtre = await filtrerParBarrieres(c, symbolisees);
      const bilan = await writeRowsWithClient(c, filtre.rows);
      return filtre.total ? { ...bilan, refuses: filtre.refuses } : bilan;
    };
    if (fourni) return await travail(client);
    return await withAppIngestTransaction(pool, appsDuLot(symbolisees), travail, { ...verrou, client });
  } finally {
    if (!fourni) client.release();
  }
}

/**
 * Signal LOGS OTel -> rum_log, et les exceptions structurées qu'il porte ->
 * rum_error (P5.3), avec un client DÉJÀ transactionnel et verrouillé.
 *
 * Une seule transaction : un échec n'écrit ni le log ni son exception, et le
 * rejeu de l'appelant ne peut pas laisser une exception sans le log qui l'a
 * portée. Les exceptions, elles, sont idempotentes au rejeu.
 * @returns {Promise<{logs: number, erreurs: {recues: number, inserees: number, ignorees: number}}>}
 */
export async function writeLogsWithClient(client, logs, errors = []) {
  await batchInsert(
    client,
    "rum_log",
    ["app_id", "ts", "severity_num", "severity_text", "body", "source", "trace_id", "span_id", "session_id", "route", "attributes"],
    logs.map((l) => ({ ...l, attributes: l.attributes ? JSON.stringify(l.attributes) : null })),
    "",
  );
  const erreurs = await ecrireErreurs(client, errors);
  await erreurs.finaliser();
  return { logs: logs.length, erreurs: erreurs.bilan };
}

/** Wrapper compatible de `writeLogsWithClient` : transaction, verrou, barrières. */
export async function writeLogs(pool, logs, errors = [], { client: fourni = null, verrou = {} } = {}) {
  if (!logs.length && !errors.length) return { logs: 0, erreurs: { recues: 0, inserees: 0, ignorees: 0 } };
  const travail = async (c) => {
    // Un log et une exception portent app_id, session_id et, pour l'exception,
    // les HMAC d'identité : ils passent par la MÊME barrière que les traces.
    const filtre = await filtrerParBarrieres(c, { logs, errors });
    const bilan = await writeLogsWithClient(c, filtre.rows.logs, filtre.rows.errors);
    return filtre.total ? { ...bilan, refuses: filtre.refuses } : bilan;
  };
  if (fourni) return travail(fourni);
  return withAppIngestTransaction(pool, appsDuLot({ logs, errors }), travail, verrou);
}

/**
 * Chunk rrweb (corps gzip) -> replay_chunk, avec un client déjà transactionnel.
 *
 * LA SESSION MINIMALE N'EST PLUS CRÉÉE AVEUGLÉMENT. Elle l'était parce qu'un
 * chunk peut précéder le premier lot OTLP et que la clé étrangère l'exige — mais
 * cette création contournait la barrière : elle recréait l'ancre d'une session
 * effacée, et le rejeu de la personne revenait avec elle. Désormais :
 *
 *   · session sous barrière              -> refus DÉFINITIF, corps non persisté ;
 *   · session inconnue, app en `enforce`  -> refus TEMPORAIRE borné : le SDK
 *     rejoue après que l'ancre OTLP est arrivée. Le corps n'est pas persisté ;
 *   · session connue d'une AUTRE app      -> erreur de portée ;
 *   · sinon                               -> comportement historique.
 *
 * LIMITE ASSUMÉE, et c'est pour cela que le refus temporaire est derrière
 * l'activation : le transport de rejeu du SDK web ne rejoue pas (cf.
 * packages/rum-sdk/src/replay.ts, « best effort : chunk perdu »). Sous `enforce`,
 * un chunk arrivé avant son ancre est donc PERDU, pas différé. On l'annonce au
 * lieu de contourner la barrière.
 * @returns {Promise<{etat: "ecrit"|"refus_barriere"|"attente_session", retryAfterS?: number}>}
 */
export async function writeReplayChunkWithClient(client, { sessionId, appId, seq, body, eventsCount }) {
  if (await sessionSousBarriere(client, appId, sessionId)) {
    return { etat: "refus_barriere" };
  }
  const { rows: connue } = await client.query(
    "select app_id from rum_session where session_id = $1",
    [sessionId],
  );
  if (connue.length && connue[0].app_id !== appId) {
    throw new ErreurPorteeApp(
      `session de rejeu déjà enregistrée pour « ${connue[0].app_id} », revendiquée par « ${appId} »`,
    );
  }
  if (!connue.length) {
    if (await barriereActivee(client, appId)) return { etat: "attente_session", retryAfterS: 5 };
    await client.query(
      `insert into rum_session (session_id, app_id) values ($1, $2)
         on conflict (session_id) do nothing`,
      [sessionId, appId],
    );
  }
  await client.query(
    `insert into replay_chunk (session_id, app_id, seq, events_count, body)
       values ($1, $2, $3, $4, $5)
       on conflict (session_id, seq) do nothing`,
    [sessionId, appId, seq, eventsCount, body],
  );
  return { etat: "ecrit" };
}

/** Wrapper compatible : transaction, verrou d'application, puis délégation. */
export function writeReplayChunk(pool, chunk, { client: fourni = null, verrou = {} } = {}) {
  if (fourni) return writeReplayChunkWithClient(fourni, chunk);
  return withAppIngestTransaction(pool, chunk.appId, (c) => writeReplayChunkWithClient(c, chunk), verrou);
}

// ───────────────────────── Auth / registre / débit ─────────────────────────

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Helpers d'auth adossés à un pool `pg`. Même modèle de décision que
 * shared/auth.mjs (qui parlait supabase-js) : cache de registre 60 s,
 * fail-open si le registre n'a JAMAIS pu être chargé (indisponibilité DB au
 * démarrage > rejeter 100 % du trafic), rate limit durable via rate_check().
 *
 * L'état (cache, compteurs) est par instance — exactement comme l'isolat Deno
 * d'avant : en serverless chaque instance a le sien, et le compteur durable en
 * base est ce qui rend la limite globale.
 */
export function createPgAuth(pool, opts = {}) {
  const requireApiKey = opts.requireApiKey ?? false;
  const rateLimitPerMin = opts.rateLimitPerMin ?? 600;
  /**
   * Part du plafond nominal qu'une SEULE instance s'autorise quand le compteur
   * durable est injoignable. Un quart : avec quatre instances on retombe
   * approximativement sur la limite globale, et avec une seule on reste
   * nettement au-dessus du trafic ordinaire d'une application.
   */
  const plafondRepli = Math.max(1, Math.ceil(rateLimitPerMin * (opts.fractionRepli ?? 0.25)));
  const log = opts.log ?? {};
  const now = opts.now ?? (() => Date.now());

  let appRegistry = new Map();
  let registryLoadedAt = 0;
  let registryEverLoaded = false;

  async function getAppRegistry() {
    if (now() - registryLoadedAt < 60_000 && appRegistry.size) return appRegistry;
    try {
      const { rows } = await pool.query(
        // `to_jsonb(...)->>` et non une colonne citée : le code part en
        // production AVANT que le pré-déploiement n'applique v81, et citer une
        // colonne absente ferait échouer TOUT le chargement du registre — donc
        // basculer l'ingestion entière en repli fail-open. L'opérateur de jsonb
        // rend NULL quand la clé n'existe pas.
        `select app_id, api_key_hash, active, allowed_origins,
                (to_jsonb(app_registry.*) ->> 'ingestion_suspended_at') as ingestion_suspended_at
           from app_registry`,
      );
      appRegistry = new Map(rows.map((r) => [r.app_id, r]));
      registryLoadedAt = now();
      registryEverLoaded = true;
    } catch (err) {
      log.error?.("app_registry load failed", { err: String(err) });
    }
    return appRegistry;
  }

  /** null si accepté, sinon la raison du 403. */
  async function checkApiKey(appId, apiKey) {
    const registry = await getAppRegistry();
    if (!registryEverLoaded) {
      if (requireApiKey) log.warn?.("api key check fail-open (registry never loaded)", { app_id: appId });
      return null;
    }
    // SUSPENSION D'INGESTION (P8.1) — vérifiée AVANT `requireApiKey`, et donc
    // même quand aucune clé n'est exigée. `erase_app_data` efface les données
    // d'une application ET pose cette marque dans la même transaction : sans ce
    // contrôle, le prochain beacon recréerait des lignes dans l'application que
    // l'on vient de vider, et l'effacement n'aurait garanti le silence que
    // jusqu'au message suivant. La reprise est une opération d'exploitation
    // explicite — on efface la marque à la main — jamais l'effet d'un événement.
    const suspendue = registry.get(appId)?.ingestion_suspended_at;
    if (suspendue != null) return `ingestion suspended for app: ${appId}`;
    if (!requireApiKey) return null;
    const app = registry.get(appId);
    if (!app || !app.active) return `unknown or inactive app: ${appId}`;
    // Durcissement E1-S1 : sous REQUIRE_API_KEY, une app SANS clé est rejetée.
    if (app.api_key_hash == null) return `app requires an API key: ${appId}`;
    if (!apiKey || sha256(apiKey) !== app.api_key_hash)
      return `invalid api key for app: ${appId}`;
    return null;
  }

  // ════════════════ Le compteur mémoire, et son plafond de repli ═══════════════
  //
  // Finding 2.3 de docs/AUDIT_RUM_EXTERNE.md — bloquant.
  //
  // « QUAND LA BASE EST LE GOULOT, LE MÉCANISME QUI PROTÈGE LA BASE CONSOMME LA
  // BASE. » Le limiteur interrogeait `rate_check()` à CHAQUE beacon, et son
  // repli en cas d'échec SQL était `return false` — c'est-à-dire « on laisse
  // passer », au moment précis où la base ne répond plus. Combiné au fail-open
  // documenté de `checkApiKey`, l'ingestion se retrouvait sans AUCUNE protection
  // dès que la base était indisponible : le seul moment où elle en a besoin.
  const rateHits = new Map();

  /**
   * Enregistre un coup et rend le nombre de coups de la dernière minute POUR
   * CETTE INSTANCE, celui-ci compris.
   *
   * Un seul compteur, deux seuils : compter deux fois le même beacon — une fois
   * pour le pré-filtre, une fois pour le repli — le refuserait deux fois plus
   * vite qu'annoncé.
   */
  function compterLocal(appId) {
    const t = now();
    const hits = rateHits.get(appId) ?? [];
    while (hits.length && hits[0] <= t - 60_000) hits.shift();
    hits.push(t);
    rateHits.set(appId, hits);
    return hits.length;
  }

  /**
   * Pré-filtre mémoire, puis compteur durable partagé.
   *
   * LE REPLI REFUSE, il n'accepte plus. Le compteur mémoire est PAR INSTANCE :
   * pendant une indisponibilité de la base, chaque instance ne voit que sa part
   * du trafic, donc appliquer le plafond nominal en local autoriserait
   * `instances × plafond` requêtes au total. On applique donc un plafond de
   * repli plus bas — assez pour laisser passer le trafic ordinaire d'une
   * instance, pas assez pour qu'une boucle d'erreurs achève une base déjà à
   * terre.
   *
   * Ce n'est pas une limite exacte : c'en est une DÉGRADÉE, et c'est le point.
   * Refuser un peu trop pendant un incident est réparable ; accepter tout ne
   * l'est pas.
   */
  async function rateLimitedDurable(appId) {
    const local = compterLocal(appId);
    if (local > rateLimitPerMin) return true;
    try {
      const { rows } = await pool.query("select rate_check($1, $2) as ok", [
        appId,
        rateLimitPerMin,
      ]);
      return rows[0].ok === false;
    } catch (err) {
      const refuse = local > plafondRepli;
      log.warn?.("rate_check sql failed (repli mémoire, fermé)", {
        err: String(err),
        app_id: appId,
        coups_locaux: local,
        plafond_repli: plafondRepli,
        refuse,
      });
      return refuse;
    }
  }

  /**
   * Le registre a-t-il été chargé AU MOINS UNE FOIS ? C'est la question de
   * `/ready` (P2) : tant qu'il ne l'a pas été, `checkApiKey` est en fail-open —
   * une instance qui démarre sur une base injoignable accepterait tout. Une
   * fois chargé, un échec de rafraîchissement garde l'ancien registre : l'état
   * reste sain, et c'est voulu.
   */
  function registryLoaded() {
    return registryEverLoaded;
  }

  return { getAppRegistry, checkApiKey, rateLimitedDurable, registryLoaded, plafondRepli };
}
