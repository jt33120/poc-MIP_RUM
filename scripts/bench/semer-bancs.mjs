#!/usr/bin/env node
// Sème la base JETABLE des deux bancs de mesure : l'Explorer (P6.6,
// `tests/integration/explorer-bench-p66.test.ts`) et l'écran /mobile (P7.5,
// `tests/integration/rum-mobile-bench-p75.test.ts`).
//
// POURQUOI CE SCRIPT EXISTE. Les deux bancs « lisent une base préparée à part » et
// ne sèment rien eux-mêmes — à raison : un banc qui construirait ses 3 M de lignes
// à chaque lancement mesurerait surtout sa propre construction. Mais la recette de
// cette base n'existait qu'en PROSE, dans les en-têtes de `migration-v80.sql` et
// de `migration-v82.sql`. Personne ne pouvait donc rejouer les chiffres publiés,
// et la CI ne les jouait jamais (R9 ; `F3` de docs/RUM_PARITY_STATUS.md :
// `BENCH_DATABASE_URL` absente de ci.yml). Ce script fait de la prose un
// programme, et le job « Bancs de mesure » de ci.yml l'enchaîne avec les bancs.
//
// CE QU'IL SÈME — les volumes des deux en-têtes, sur 7 jours glissants jusqu'à
// `now()`, par `generate_series` seul : AUCUNE donnée client n'entre dans un banc.
//
//   P6.6 (apps p66-a, p66-b, p66-c — p66-a est celle que le banc lit)
//     rum_session    120 000   6 % de robots, 4 appareils, 12 releases
//     rum_event    1 200 000   A 1 000 000 · B 150 000 · C 50 000 ; env « prod »
//                              majoritaire (60 %), « dev » sélectif (4 %)
//     rum_metric     600 000   les 5 Core Web Vitals
//     rum_pageview   400 000
//     rum_error      250 000   occurrences de 1 à 4
//   P7.5 (app p75-bench)
//     rum_session    120 000   dont 30 000 React Native
//     rum_error      250 000   `react_native_js` sur les sessions RN, sinon `browser_js`
//     rum_pageview   400 000
//
// Puis l'agrégat horaire des Web Vitals est calculé sur les 7 jours
// (`refresh_metric_histogram`) — la lecture « p75 LCP par appareil » passe par lui,
// comme en production —, et les tables sont analysées : sans statistiques, le
// planificateur choisirait ses plans sur une table qu'il croit vide, et le banc
// P7.5 ne dirait rien de l'index qu'il juge.
//
// DÉTERMINISTE À LA GRAINE PRÈS (`setseed`) : deux semis rendent les mêmes lignes,
// à l'horloge près (tout est daté relativement à `now()`).
//
// CE QU'IL NE FAIT PAS. Il ne migre pas : le schéma se monte d'abord par le
// migrateur de production, comme partout (`node services/scheduler/migrate.mjs`
// avec DATABASE_URL = la base de banc). Il ne ressème pas une base déjà semée : il
// le dit et sort en 0 — recréer la base pour repartir de zéro.
//
// Usage — base JETABLE explicite, jamais DATABASE_URL :
//   BENCH_DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum_bench \
//     node scripts/bench/semer-bancs.mjs
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const URL_BANC = process.env.BENCH_DATABASE_URL;

/**
 * Les gardes. Ce script écrit 3 M de lignes : il ne doit JAMAIS pouvoir viser une
 * base réelle. D'où trois refus, cumulatifs :
 *   · BENCH_DATABASE_URL obligatoire — DATABASE_URL n'est jamais lue, le `.env` du
 *     poste la fait pointer sur la production ;
 *   · le NOM de la base doit contenir « bench » (celle de production s'appelle
 *     autrement, et toutes les bases de banc du dépôt suivent cette règle) ;
 *   · l'hôte doit être local, sauf `BANC_HOTE_DISTANT=oui` explicite.
 * Exportée pour être testée sans base.
 *
 * @param {string | undefined} url
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true } | { ok: false, raison: string }}
 */
export function verifierCible(url, env = process.env) {
  if (!url) return { ok: false, raison: "BENCH_DATABASE_URL (base JETABLE) est obligatoire ; DATABASE_URL n'est jamais utilisée" };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, raison: "BENCH_DATABASE_URL n'est pas une URL lisible" };
  }
  const base = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!/bench/i.test(base)) return { ok: false, raison: `la base « ${base} » ne porte pas « bench » dans son nom : refus d'y semer 3 M de lignes` };
  const locaux = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "host.docker.internal", ""]);
  if (!locaux.has(u.hostname) && env.BANC_HOTE_DISTANT !== "oui") {
    return { ok: false, raison: `hôte « ${u.hostname} » non local : poser BANC_HOTE_DISTANT=oui si c'est VRAIMENT une base de banc` };
  }
  return { ok: true };
}

/** Les douze releases de P6.6, de la plus ancienne à la plus récente ; le banc filtre sur r3.0.0. */
const RELEASES = "array['r1.0.0','r1.1.0','r1.2.0','r1.3.0','r2.0.0','r2.1.0','r2.2.0','r2.3.0','r3.0.0','r3.1.0','r3.2.0','r3.3.0']";

// Tirages réutilisés. Un tirage de release biaisé vers les plus récentes
// (racine carrée d'un uniforme) : r3.0.0 pèse ~12 %, présente sur toute la fenêtre.
const TIRE_RELEASE = `(${RELEASES})[least(12, 1 + floor(12 * sqrt(random())))::int]`;
// env : prod 60 %, staging 30 %, preprod 6 %, dev 4 % (la valeur sélective du banc).
const TIRE_ENV = `(case when e < 0.60 then 'prod' when e < 0.90 then 'staging' when e < 0.96 then 'preprod' else 'dev' end)`;
const DANS_LA_FENETRE = `now() - random() * interval '7 days'`;

/** Les étapes du semis, dans l'ordre. Chacune est une requête, chronométrée. */
const ETAPES = [
  {
    nom: "applications",
    sql: `insert into app_registry (app_id, name) values
            ('p66-a', 'Banc P6.6 — A'), ('p66-b', 'Banc P6.6 — B'), ('p66-c', 'Banc P6.6 — C'),
            ('p75-bench', 'Banc P7.5 — mobile')
          on conflict (app_id) do nothing`,
  },
  {
    nom: "P6.6 — rum_session (120 000)",
    sql: `select setseed(0.66);
          insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at,
                                   last_seen_at, page_count, release, runtime)
          select s.app_id || '-s' || s.i, s.app_id,
                 s.app_id || '-v' || floor(s.v * s.sessions * 0.4)::int,
                 case when s.d < 0.50 then 'desktop' when s.d < 0.90 then 'mobile'
                      when s.d < 0.98 then 'tablet' else 'other' end,
                 s.b < 0.06, s.debut, least(now(), s.debut + s.duree * interval '30 minutes'),
                 1 + floor(s.duree * 6)::int, s.release, 'browser'
            from (select a.app_id, a.sessions, i, random() as v, random() as d, random() as b,
                         ${DANS_LA_FENETRE} as debut, random() as duree, ${TIRE_RELEASE} as release
                    from (values ('p66-a', 100000), ('p66-b', 15000), ('p66-c', 5000)) a(app_id, sessions)
                    cross join generate_series(1, a.sessions) i) s`,
  },
  {
    nom: "P6.6 — rum_event (1 200 000)",
    sql: `select setseed(0.661);
          insert into rum_event (session_id, app_id, name, event_type, timing_ms, props, ts, env, release)
          select s.app_id || '-s' || (1 + floor(s.x * s.sessions)::int), s.app_id,
                 (array['add_to_cart','checkout','search','signup','share','filter_apply','video_play','login'])
                   [1 + floor(s.n * 8)::int],
                 case when s.t < 0.05 then 'timing' else 'custom' end,
                 case when s.t < 0.05 then round((s.n * 2000)::numeric, 1)::float8 end,
                 case when s.p < 0.20 then jsonb_build_object('valeur', floor(s.n * 500)::int) end,
                 s.ts, ${TIRE_ENV}, s.release
            from (select a.app_id, a.sessions, random() as x, random() as n, random() as t, random() as p,
                         random() as e, ${DANS_LA_FENETRE} as ts, ${TIRE_RELEASE} as release
                    from (values ('p66-a', 100000, 1000000), ('p66-b', 15000, 150000), ('p66-c', 5000, 50000))
                           a(app_id, sessions, lignes)
                    cross join generate_series(1, a.lignes)) s`,
  },
  {
    nom: "P6.6 — rum_metric (600 000)",
    sql: `select setseed(0.662);
          insert into rum_metric (session_id, app_id, name, value, rating, ts, env, release)
          select v.session_id, v.app_id, v.name, v.value,
                 case when v.value <= v.bon then 'good' when v.value <= v.mauvais then 'needs-improvement' else 'poor' end,
                 v.ts, v.env, v.release
            from (select s.session_id, s.app_id, s.name, s.ts, s.release, ${TIRE_ENV} as env,
                         -- Des ordres de grandeur plausibles par mesure (ms, CLS sans unité),
                         -- et les seuils « bon / mauvais » publiés des Web Vitals.
                         case s.name when 'LCP' then 800 + s.r * s.r * 5000 when 'INP' then 40 + s.r * s.r * 600
                                     when 'CLS' then s.r * s.r * s.r * 0.6 when 'FCP' then 400 + s.r * s.r * 3000
                                     else 80 + s.r * s.r * 1500 end as value,
                         case s.name when 'LCP' then 2500 when 'INP' then 200 when 'CLS' then 0.1
                                     when 'FCP' then 1800 else 800 end as bon,
                         case s.name when 'LCP' then 4000 when 'INP' then 500 when 'CLS' then 0.25
                                     when 'FCP' then 3000 else 1800 end as mauvais
                    from (select a.app_id || '-s' || (1 + floor(random() * a.sessions)::int) as session_id, a.app_id,
                                 (array['LCP','INP','CLS','FCP','TTFB'])[1 + floor(random() * 5)::int] as name,
                                 random() as r, random() as e, ${DANS_LA_FENETRE} as ts, ${TIRE_RELEASE} as release
                            from (values ('p66-a', 100000, 500000), ('p66-b', 15000, 75000), ('p66-c', 5000, 25000))
                                   a(app_id, sessions, lignes)
                            cross join generate_series(1, a.lignes)) s) v`,
  },
  {
    nom: "P6.6 — rum_pageview (400 000)",
    sql: `select setseed(0.663);
          insert into rum_pageview (session_id, app_id, route, url, nav_type, started_at, env, release)
          select s.app_id || '-s' || (1 + floor(s.x * s.sessions)::int), s.app_id, s.route,
                 'https://banc.invalid' || s.route, 'navigate', s.ts, ${TIRE_ENV}, s.release
            from (select a.app_id, a.sessions, random() as x, '/page-' || floor(random() * 40)::int as route,
                         random() as e, ${DANS_LA_FENETRE} as ts, ${TIRE_RELEASE} as release
                    from (values ('p66-a', 100000, 330000), ('p66-b', 15000, 50000), ('p66-c', 5000, 20000))
                           a(app_id, sessions, lignes)
                    cross join generate_series(1, a.lignes)) s`,
  },
  {
    nom: "P6.6 — rum_error (250 000)",
    sql: `select setseed(0.664);
          insert into rum_error (session_id, app_id, kind, message, error_type, fingerprint, occurrences,
                                 error_source, ts, env, release)
          select s.app_id || '-s' || (1 + floor(s.x * s.sessions)::int), s.app_id, 'error',
                 'Erreur de banc ' || s.fp, 'TypeError', 'banc-' || s.fp, 1 + floor(s.o * 4)::int,
                 'browser_js', s.ts, ${TIRE_ENV}, s.release
            from (select a.app_id, a.sessions, random() as x, floor(random() * 400)::int as fp, random() as o,
                         random() as e, ${DANS_LA_FENETRE} as ts, ${TIRE_RELEASE} as release
                    from (values ('p66-a', 100000, 210000), ('p66-b', 15000, 30000), ('p66-c', 5000, 10000))
                           a(app_id, sessions, lignes)
                    cross join generate_series(1, a.lignes)) s`,
  },
  {
    // Une session sur quatre est React Native : l'indice de la session suffit
    // ensuite à savoir si une erreur tirée sur elle est `react_native_js`.
    nom: "P7.5 — rum_session (120 000, dont 30 000 React Native)",
    sql: `select setseed(0.75);
          insert into rum_session (session_id, app_id, visitor_id, device_type, is_bot, started_at,
                                   last_seen_at, page_count, release, runtime)
          select 'p75-bench-s' || s.i, 'p75-bench', 'p75-bench-v' || floor(s.v * 48000)::int,
                 case when s.i % 4 = 0 then 'mobile' when s.d < 0.55 then 'desktop' when s.d < 0.95 then 'mobile'
                      else 'tablet' end,
                 s.b < 0.06, s.debut, least(now(), s.debut + s.duree * interval '30 minutes'),
                 1 + floor(s.duree * 6)::int, s.release,
                 case when s.i % 4 = 0 then 'react_native' else 'browser' end
            from (select i, random() as v, random() as d, random() as b, ${DANS_LA_FENETRE} as debut,
                         random() as duree, ${TIRE_RELEASE} as release
                    from generate_series(1, 120000) i) s`,
  },
  {
    nom: "P7.5 — rum_error (250 000)",
    sql: `select setseed(0.751);
          insert into rum_error (session_id, app_id, kind, message, error_type, fingerprint, occurrences,
                                 error_source, ts, release)
          select 'p75-bench-s' || s.n, 'p75-bench', 'error', 'Erreur de banc ' || s.fp, 'TypeError',
                 'banc-rn-' || s.fp, 1 + floor(s.o * 4)::int,
                 case when s.n % 4 = 0 then 'react_native_js' else 'browser_js' end, s.ts, s.release
            from (select 1 + floor(random() * 120000)::int as n, floor(random() * 300)::int as fp,
                         random() as o, ${DANS_LA_FENETRE} as ts, ${TIRE_RELEASE} as release
                    from generate_series(1, 250000)) s`,
  },
  {
    nom: "P7.5 — rum_pageview (400 000)",
    sql: `select setseed(0.752);
          insert into rum_pageview (session_id, app_id, route, url, nav_type, started_at, release)
          select 'p75-bench-s' || (1 + floor(s.x * 120000)::int), 'p75-bench', s.route,
                 'https://banc.invalid' || s.route, 'navigate', s.ts, s.release
            from (select random() as x, '/ecran-' || floor(random() * 30)::int as route,
                         ${DANS_LA_FENETRE} as ts, ${TIRE_RELEASE} as release
                    from generate_series(1, 400000)) s`,
  },
];

async function principal() {
  const cible = verifierCible(URL_BANC);
  if (!cible.ok) {
    console.error(`[semer-bancs] ${cible.raison}`);
    return 2;
  }
  const client = new pg.Client({ connectionString: URL_BANC });
  await client.connect();
  try {
    const { rows: [schema] } = await client.query(
      "select to_regclass('public.rum_event') is not null as ok, to_regprocedure('refresh_metric_histogram(int)') is not null as agregat",
    );
    if (!schema.ok || !schema.agregat) {
      console.error(
        "[semer-bancs] schéma absent ou incomplet : migrer d'abord la base de banc\n" +
          "              (DATABASE_URL=<base de banc> node services/scheduler/migrate.mjs)",
      );
      return 2;
    }
    const { rows: [deja] } = await client.query(
      "select exists (select 1 from rum_session where app_id in ('p66-a', 'p75-bench')) as oui",
    );
    if (deja.oui) {
      console.log("[semer-bancs] base déjà semée : rien à faire (recréer la base pour repartir de zéro)");
      return 0;
    }

    const debut = performance.now();
    // UNE transaction pour tout le semis : un échec à mi-chemin ne laisse pas une
    // base à moitié semée que le contrôle « déjà semée » prendrait pour complète.
    await client.query("begin");
    for (const etape of ETAPES) {
      const t0 = performance.now();
      const res = await client.query(etape.sql);
      const lignes = [res].flat().at(-1)?.rowCount ?? 0;
      console.log(`[semer-bancs] ${etape.nom.padEnd(56)} ${String(lignes).padStart(9)} lignes  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    }
    await client.query("commit");

    // L'agrégat horaire sur toute la fenêtre (7 jours + la marge de l'heure pleine).
    let t0 = performance.now();
    const { rows: [agg] } = await client.query("select refresh_metric_histogram(7 * 24 + 2) as cellules");
    console.log(`[semer-bancs] ${"agrégat horaire des Web Vitals".padEnd(56)} ${String(agg.cellules).padStart(9)} cellules ${((performance.now() - t0) / 1000).toFixed(1)} s`);

    // VACUUM hors transaction : carte de visibilité (parcours d'index seuls) et
    // statistiques du planificateur, comme une base que l'autovacuum a déjà vue.
    t0 = performance.now();
    await client.query(
      "vacuum (analyze) rum_session, rum_event, rum_metric, rum_pageview, rum_error, metric_histogram_hourly",
    );
    console.log(`[semer-bancs] ${"vacuum (analyze)".padEnd(56)} ${"".padStart(9)}        ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    console.log(`[semer-bancs] base de banc prête en ${((performance.now() - debut) / 1000).toFixed(1)} s`);
    return 0;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error(`[semer-bancs] semis en échec, rien n'a été écrit : ${err?.message ?? err}`);
    return 1;
  } finally {
    await client.end();
  }
}

// Exécution directe seulement : le module s'importe sans effet (tests des gardes).
// `pathToFileURL` et non une concaténation `file://` : un espace ou un accent
// dans le chemin ferait échouer la comparaison naïve, et le script ne ferait
// RIEN, sans erreur (même piège que `@mip/db/migrate.mjs`).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await principal();
}
