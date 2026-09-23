// Données de la recette transverse du domaine performance (F27, plan § 6.5).
//
// Une app À ELLE, qui remplit les HUIT écrans du domaine d'un coup — Vue d'ensemble,
// Pages, Erreurs, détail d'erreur, Interactions, Actions, Journal, Satisfaction : la
// recette y cherche le premier élément de CHAQUE figure (P8), les bandes de seuil
// (P2), l'axe unique (P5) et l'alternative textuelle (P10). Une figure vide ne
// prouverait rien : chaque lecture a ici de quoi dessiner.
//
// Pourquoi un fichier à part, et pas le `beforeAll` du bloc : le même semis est
// relu, hors navigateur, par les lectures de la console sur une base jetable avant
// la première exécution en CI (la PR de vague). Le spec et cette vérification
// sèment donc EXACTEMENT les mêmes lignes.
//
// FORME DES DONNÉES. 60 sessions, une toutes les 100 minutes (≈ 4 jours, dans une
// plage `7d`), sur trois routes aux verdicts distincts — `/f27-panier` au-delà de
// « Bon » (LCP 3,2 s, INP 350 ms), `/f27-accueil` et `/f27-produit` en deçà —, sous
// deux releases (la plus récente déployée il y a 51 h), chacune avec un chargement
// et un changement de route SPA. Une instruction par table (`generate_series`).

/** Ce dont le semis a besoin d'un client PostgreSQL (`pg.Pool` ou `pg.Client`). */
export interface RequetableF27 {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

export const APP_F27 = "f27-e2e-recette";
/** Route d'indice `g % 3` de la session `g` ; la vue SPA passe à la suivante. */
export const ROUTES_F27 = ["/f27-panier", "/f27-accueil", "/f27-produit"] as const;
/** Groupe d'erreurs de `/f27-panier` : le détail d'erreur de la recette. */
export const FP_F27 = "f27fp-paiement";
const EMPREINTES_F27 = [FP_F27, "f27fp-panier-vide", "f27fp-jeton"];
const MESSAGES_F27 = ["Paiement refusé", "Panier vide", "Jeton expiré"];
/** Sessions 1 à 30 (les plus récentes) sous la release déployée il y a 51 h. */
export const RELEASES_F27 = ["f27-1.0", "f27-1.1"] as const;
const CIBLES_INP_F27 = ["button#f27-payer", "a#f27-menu", "input#f27-recherche"];
const ACTIONS_F27 = ["Payer", "Ouvrir le menu", "Rechercher"];

/** Instant de la session `g` (colonne SQL `g`) : une toutes les 100 minutes. */
const T = (decalage = "0 seconds") => `now() - g * interval '100 minutes' + interval '${decalage}'`;
const RELEASE = `case when g <= 30 then 'f27-1.1' else 'f27-1.0' end`;

/** Enfants d'abord : les clés étrangères pointent vers `rum_session`. */
export async function nettoyerF27(pool: RequetableF27): Promise<void> {
  for (const t of [
    "rum_event_index",
    "rum_event",
    "rum_error",
    "rum_action",
    "rum_metric",
    "rum_longtask",
    "rum_pageview",
    "rum_session",
    "deploy_marker",
    "error_status",
  ]) {
    await pool.query(`delete from ${t} where app_id = $1`, [APP_F27]);
  }
}

export async function semerF27(pool: RequetableF27): Promise<void> {
  await nettoyerF27(pool);
  const routes = [...ROUTES_F27];
  await pool.query(
    `insert into app_registry (app_id, name) values ($1, 'Recette du domaine F27 (e2e)') on conflict (app_id) do nothing`,
    [APP_F27],
  );
  await pool.query(
    `insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at, last_seen_at, page_count,
                              release, geo_country, browser, os, runtime, sample_rate, error_sample_rate)
     select $1 || '-s' || g, $1, $1 || '-v' || g, 'desktop', false, ${T()}, ${T("3 minutes")}, 2,
            ${RELEASE}, 'FR', 'Chrome', 'Windows', 'browser', 1, 1
       from generate_series(1, 60) g`,
    [APP_F27],
  );
  // Un chargement sur la route `g % 3`, puis un changement de route SPA vers la suivante.
  await pool.query(
    `insert into rum_pageview (span_id, session_id, app_id, route, nav_type, started_at, release)
     select $1 || '-pv' || g || '-' || t.n, $1 || '-s' || g, $1, ($2::text[])[1 + (g + t.n) % 3], t.nav,
            ${T()} + t.n * interval '1 minute', ${RELEASE}
       from generate_series(1, 60) g, (values (0, 'navigate'), (1, 'spa')) t(n, nav)`,
    [APP_F27, routes],
  );
  // Vitals du chargement : valeur de base par route (+ un pas pour ne pas avoir que des
  // égalités), verdict cohérent avec les bornes web.dev ; phases réseau sans verdict.
  await pool.query(
    `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, attribution, ts, release)
     select $1 || '-m' || g || '-' || v.nom, $1 || '-s' || g, $1, ($2::text[])[1 + g % 3], v.nom,
            v.base + (g % 7) * v.pas, v.verdict,
            case when v.nom = 'INP' then jsonb_build_object('interactionTarget', ($3::text[])[1 + g % 3]) end,
            ${T("10 seconds")}, ${RELEASE}
       from generate_series(1, 60) g
       join (values
              (0, 'LCP', 3200::float8, 10::float8, 'needs-improvement'),
              (0, 'INP', 350, 5, 'needs-improvement'),
              (0, 'CLS', 0.18, 0.001, 'needs-improvement'),
              (0, 'FCP', 2000, 10, 'needs-improvement'),
              (0, 'TTFB', 900, 10, 'needs-improvement'),
              (1, 'LCP', 1200, 10, 'good'),
              (1, 'INP', 120, 2, 'good'),
              (1, 'CLS', 0.02, 0.001, 'good'),
              (1, 'FCP', 900, 10, 'good'),
              (1, 'TTFB', 300, 10, 'good'),
              (2, 'LCP', 1900, 10, 'good'),
              (2, 'INP', 180, 2, 'good'),
              (2, 'CLS', 0.06, 0.001, 'good'),
              (2, 'FCP', 1200, 10, 'good'),
              (2, 'TTFB', 500, 10, 'good'),
              (null, 'DNS', 10, 1, null),
              (null, 'TCP', 20, 1, null),
              (null, 'TLS', 30, 1, null),
              (null, 'REQUEST', 60, 1, null),
              (null, 'RESPONSE', 80, 1, null)
            ) v(route, nom, base, pas, verdict) on v.route is null or v.route = g % 3`,
    [APP_F27, routes, CIBLES_INP_F27],
  );
  // Une action causale toutes les dix sessions ; celles des sessions 20, 40 et 60 sont
  // suivies d'une erreur (identifiants hexadécimaux imposés par `rum_action`).
  await pool.query(
    `insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, ts, release)
     select 'f27a' || lpad(to_hex(g), 28, '0'), 'f27b' || lpad(to_hex(g), 12, '0'), $1 || '-s' || g, $1, 'click',
            ($3::text[])[1 + g % 3], ($2::text[])[1 + g % 3], ${T("20 seconds")}, ${RELEASE}
       from generate_series(10, 60, 10) g`,
    [APP_F27, routes, ACTIONS_F27],
  );
  // Une erreur navigateur toutes les quatre sessions : trois groupes, un par route.
  await pool.query(
    `insert into rum_error (span_id, session_id, app_id, route, kind, message, error_type, fingerprint, occurrences,
                            error_source, action_id, ts, release)
     select $1 || '-e' || g, $1 || '-s' || g, $1, ($2::text[])[1 + g % 3], 'error', ($3::text[])[1 + g % 3], 'TypeError',
            ($4::text[])[1 + g % 3], 2 + g % 3, 'browser_js',
            case when g % 10 = 0 then 'f27a' || lpad(to_hex(g), 28, '0') end, ${T("30 seconds")}, ${RELEASE}
       from generate_series(4, 60, 4) g`,
    [APP_F27, routes, MESSAGES_F27, EMPREINTES_F27],
  );
  // Tâches longues attribuées (LoAF) : la série du fil principal et les scripts de /ux.
  await pool.query(
    `insert into rum_longtask (span_id, session_id, app_id, route, duration_ms, source, blocking_ms,
                               script_url, script_function, ts, release)
     select $1 || '-lt' || g, $1 || '-s' || g, $1, ($2::text[])[1 + g % 3], 130 + (g % 5) * 20, 'loaf', 80 + (g % 5) * 20,
            'https://f27.example.fr/panier.js', 'f27Recalcul', ${T("15 seconds")}, ${RELEASE}
       from generate_series(3, 60, 3) g`,
    [APP_F27, routes],
  );
  // Signaux de frustration (une session sur cinq), avis notés (12 par route : trois
  // pages éligibles au nuage LCP × CSAT) et un événement custom tous les six.
  await pool.query(
    `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
     select $1 || '-sig' || g, $1 || '-s' || g, $1, ($2::text[])[1 + g % 3],
            'frustration.' || (array['rage', 'dead', 'error'])[1 + g % 3],
            jsonb_build_object('target', 'Payer', 'count', 1), ${T("40 seconds")}
       from generate_series(5, 60, 5) g
     union all
     select $1 || '-fb' || g, $1 || '-s' || g, $1, ($2::text[])[1 + g % 3], 'feedback',
            jsonb_build_object('score', (array[2, 5, 4, 1, 4, 3])[1 + g % 6], 'comment', 'Avis F27 n° ' || g), ${T("50 seconds")}
       from generate_series(1, 36) g
     union all
     select 'f27e' || lpad(to_hex(g), 12, '0'), $1 || '-s' || g, $1, ($2::text[])[1 + g % 3], 'f27-achat',
            jsonb_build_object('plan', 'pro'), ${T("45 seconds")}
       from generate_series(6, 60, 6) g`,
    [APP_F27, routes],
  );
  // Le Journal lit l'index des événements (v65), qui pointe vers leur ligne source.
  await pool.query(
    `insert into rum_event_index (app_id, session_id, ts, route, kind, source_name, source_span_id)
     select $1, $1 || '-s' || g, ${T("45 seconds")}, ($2::text[])[1 + g % 3], 'event', 'track', 'f27e' || lpad(to_hex(g), 12, '0')
       from generate_series(6, 60, 6) g
     on conflict (app_id, kind, source_span_id) do nothing`,
    [APP_F27, routes],
  );
  // Le déploiement de la release récente, dans la plage ; la précédente, avant elle.
  await pool.query(
    `insert into deploy_marker (app_id, version, env, source, ts)
     values ($1, 'f27-1.1', 'prod', 'ci', now() - interval '51 hours'), ($1, 'f27-1.0', 'prod', 'ci', now() - interval '9 days')`,
    [APP_F27],
  );
}
