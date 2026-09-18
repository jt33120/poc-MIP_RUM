// P8.2 — dimensions dérivables AVEC CERTITUDE des données encore présentes
// (besoin n° 3 de la spec).
//
// ═══════════════ CE QUI EST DÉRIVABLE, ET CE QUI NE L'EST PAS ════════════════
//
// DEUX dérivations seulement sont certaines, et ce module ne fait qu'elles :
//
//   1. `rum_session.user_agent` → navigateur et système. L'user-agent est
//      STOCKÉ ; `clientDimensions` (P6.1) est la fonction qui en déduit ces
//      champs à l'ingestion. On la rappelle, telle quelle, sur la valeur
//      stockée. Rien n'est deviné : ce que le parseur ne sait pas nommer reste
//      NULL, c'est-à-dire « Inconnu ».
//
//   2. `rum_event_index.env / release / service` → ceux de la LIGNE SOURCE que
//      la projection projette. Le rattachement passe par la vraie clé unique
//      (app_id, kind, source_span_id) : ce n'est pas une inférence, c'est la
//      même ligne, lue par son identité.
//
// CE QUI EST INTERDIT, ET POURQUOI. Attribuer aux anciennes lignes la DERNIÈRE
// release ou le dernier `env` de leur session serait faux par construction :
// P6.1 a séparé les deux frontières précisément parce qu'une mise en production
// pendant une visite change la release des événements SUIVANTS, jamais des
// précédents. Une session commencée en 4.7.0 et finie en 4.8.0 verrait toutes
// ses vues attribuées à 4.8.0, et la régression qu'on cherche disparaîtrait dans
// la version qui l'a corrigée. INCONNU RESTE INCONNU.
//
// `device_type` N'EST PAS TOUCHÉ, ET C'EST DÉLIBÉRÉ. `clientDimensions` sait
// aussi le déduire, et il est souvent plus juste que l'indice du SDK (qui range
// les tablettes Android en « desktop »). Mais `device_type` est une CLÉ de
// `rum_rollup_hourly` et de `metric_histogram_hourly` : le réécrire déplacerait
// silencieusement des agrégats historiques d'une colonne à l'autre, sans que les
// agrégats soient recalculés. Une reprise de dimensions ne doit pas fausser une
// heatmap. L'écart est compté et dit ; le corriger serait un autre lot, avec un
// recalcul d'agrégats dans la même transaction.
import { clientDimensions } from "../../supabase/functions/_shared/dimensions.mjs";
import { ISO_US } from "./commun.mjs";

export const SOURCES = Object.freeze([
  { table: "rum_session", ordre: "session_id", ts: "last_seen_at" },
  { table: "rum_event_index", ordre: "id", ts: "ts" },
]);

/** Les tables sources dont `rum_event_index` reprend env/release/service. */
const PROJETEES = Object.freeze([
  { kind: "pageview", table: "rum_pageview", service: false },
  { kind: "vital", table: "rum_metric", service: false },
  { kind: "error", table: "rum_error", service: true },
  { kind: "resource", table: "rum_resource", service: false },
  { kind: "longtask", table: "rum_longtask", service: false },
  { kind: "event", table: "rum_event", service: false },
  { kind: "span", table: "rum_span", service: true },
]);

export const DIMENSIONS = {
  nom: "dimensions",
  sources: SOURCES,
  cibles: ["rum_session", "rum_event_index"],
  cleUnique: "rum_session (session_id) et rum_event_index (app_id, kind, source_span_id)",

  segments() {
    return [{ nom: "rum_session" }, { nom: "rum_event_index" }];
  },

  async bornes(client, { app, from, to }) {
    const { rows: sessions } = await client.query(
      `select coalesce(max(session_id), '') as borne, count(*)::bigint as lignes
         from rum_session
        where app_id = $1 and last_seen_at >= $2::timestamptz and last_seen_at < $3::timestamptz`,
      [app, from, to],
    );
    const { rows: index } = await client.query(
      `select coalesce(max(id), 0)::text as borne, count(*)::bigint as lignes
         from rum_event_index
        where app_id = $1 and ts >= $2::timestamptz and ts < $3::timestamptz`,
      [app, from, to],
    );
    return {
      // La clé d'ordre de `rum_session` est son identifiant TEXTE : la table n'a
      // pas de séquence. L'ordre est celui de PostgreSQL, et le curseur est donc
      // comparé par le serveur, jamais trié côté JavaScript — deux collations
      // différentes sauteraient des lignes.
      rum_session: { ordre: "session_id", borne_haute: sessions[0].borne, lignes_sous_la_borne: Number(sessions[0].lignes) },
      rum_event_index: { ordre: "id", borne_haute: index[0].borne, lignes_sous_la_borne: Number(index[0].lignes) },
    };
  },

  async comptes(client, plan, compter) {
    const { app, from, to } = plan;
    const sessions = await compter(client, {
      ...plan,
      sqlCompte: `select count(*)::bigint as n from rum_session
                   where app_id = $1 and last_seen_at >= $2::timestamptz and last_seen_at < $3::timestamptz
                     and browser is null and os is null and user_agent is not null and not is_bot`,
      sqlHeure: `select count(*)::bigint as n from rum_session
                  where app_id = $1 and last_seen_at >= $2::timestamptz and last_seen_at < $3::timestamptz
                    and browser is null and os is null and user_agent is not null and not is_bot`,
    });
    const { rows: sansUa } = await client.query(
      `select count(*) filter (where user_agent is null)::bigint  as sans_user_agent,
              count(*) filter (where is_bot)::bigint              as robots,
              count(*) filter (where browser is not null or os is not null)::bigint as deja
         from rum_session
        where app_id = $1 and last_seen_at >= $2::timestamptz and last_seen_at < $3::timestamptz`,
      [app, from, to],
    );
    const { rows: index } = await client.query(
      `select count(*) filter (where x.env is null and x.release is null)::bigint as a_completer,
              count(*) filter (where x.env is not null or x.release is not null)::bigint as deja
         from rum_event_index x
        where x.app_id = $1 and x.ts >= $2::timestamptz and x.ts < $3::timestamptz`,
      [app, from, to],
    );
    return {
      methode: sessions.methode,
      eligibles: {
        valeur: sessions.valeur + Number(index[0].a_completer),
        methode: sessions.methode,
        detail: { rum_session: sessions, rum_event_index: Number(index[0].a_completer) },
      },
      deja_presentes: { valeur: Number(sansUa[0].deja) + Number(index[0].deja) },
      id_source_nul: {
        valeur: Number(sansUa[0].sans_user_agent),
        quoi: "sessions sans user-agent stocké : rien à dériver, elles restent « Inconnu »",
      },
      robots_ignores: {
        valeur: Number(sansUa[0].robots),
        quoi:
          "Un robot n'a ni navigateur ni système : `is_bot` le dit déjà, et lui prêter "
          + "« Chrome / Linux » gonflerait ces familles dès qu'on inclut les robots dans une analyse.",
      },
    };
  },

  async collisions(client, { app, from, to }) {
    const out = [];
    // Une session dont la release change en cours de route : la preuve, sur ces
    // données-ci, que recopier « la » release de la session serait faux.
    const { rows } = await client.query(
      `select count(*)::bigint as n from (
         select e.session_id from rum_event e
          where e.app_id = $1 and e.ts >= $2::timestamptz and e.ts < $3::timestamptz and e.release is not null
          group by e.session_id having count(distinct e.release) > 1
       ) t`,
      [app, from, to],
    );
    if (Number(rows[0].n) > 0) {
      out.push({
        genre: "release_variable_dans_une_session",
        lignes: Number(rows[0].n),
        consequence:
          "Ces sessions portent PLUSIEURS releases. Attribuer « la » release de la session à toutes "
          + "leurs anciennes lignes daterait une régression de la version qui l'a corrigée. Rien "
          + "n'est recopié depuis la session.",
      });
    }
    return out;
  },

  async lire(client, plan, seg, curseur, taille) {
    if (seg.nom === "rum_session") {
      const borne = plan.phase === "reconciliation" ? null : plan.cutoffs?.rum_session?.borne_haute ?? null;
      const { rows } = await client.query(
        `select s.session_id, s.user_agent, s.device_type,
                s.last_seen_at < (now() - make_interval(secs => $6::double precision * 86400)) as _hors_retention
           from rum_session s
          where s.app_id = $1 and s.last_seen_at >= $2::timestamptz and s.last_seen_at < $3::timestamptz
            and s.session_id > $4::text and ($5::text is null or $5::text = '' or s.session_id <= $5::text)
            and s.browser is null and s.os is null
          order by s.session_id limit $7`,
        [plan.app, plan.from, plan.to, curseur ?? "", borne, plan.retention_jours ?? 30, taille],
      );
      const skips = {};
      const lignes = [];
      for (const r of rows) {
        if (r._hors_retention) {
          skips.hors_retention = (skips.hors_retention ?? 0) + 1;
          continue;
        }
        // LE normalisateur de P6.1, pas une seconde règle écrite ici.
        const dims = clientDimensions(r.user_agent)(r.device_type);
        if (!dims.browser && !dims.os) {
          // Robot, user-agent absent ou famille non reconnue : inconnu reste
          // inconnu. Compté, pas écrit.
          skips.indeterminable = (skips.indeterminable ?? 0) + 1;
          continue;
        }
        lignes.push({
          session_id: r.session_id,
          browser: dims.browser,
          browser_version: dims.browser_version,
          os: dims.os,
          os_version: dims.os_version,
        });
      }
      return {
        lignes,
        scanned: rows.length,
        skips,
        curseur: rows.length ? rows[rows.length - 1].session_id : curseur,
        fini: rows.length < taille,
      };
    }

    const borne = plan.phase === "reconciliation" ? null : plan.cutoffs?.rum_event_index?.borne_haute ?? null;
    // Une seule requête par lot, toutes familles confondues : la source de
    // chaque ligne de projection est retrouvée par sa vraie clé unique.
    const jointures = PROJETEES.map((p) => `
      select x.id, x.kind, s.env, s.release, ${p.service ? "s.service" : "null::text as service"}
        from rum_event_index x
        join ${p.table} s on s.app_id = x.app_id and lower(s.span_id) = x.source_span_id
       where x.app_id = $1 and x.kind = '${p.kind}'
         and x.ts >= $2::timestamptz and x.ts < $3::timestamptz
         and x.id > $4::bigint and ($5::bigint is null or x.id <= $5::bigint)
         and x.env is null and x.release is null
         and (s.env is not null or s.release is not null${p.service ? " or s.service is not null" : ""})`).join(" union all ");
    const { rows } = await client.query(
      `select id::text as id, kind, env, release, service from (${jointures}) t order by id limit $6`,
      [plan.app, plan.from, plan.to, curseur ?? "0", borne, taille],
    );
    return {
      lignes: rows,
      scanned: rows.length,
      skips: {},
      curseur: rows.length ? rows[rows.length - 1].id : curseur,
      fini: rows.length < taille,
    };
  },

  /**
   * Écriture DÉTERMINISTE : `is null` dans le prédicat, jamais d'écrasement.
   *
   * Rejouer le lot ne change rien — non parce qu'on compare les valeurs, mais
   * parce qu'une colonne déjà renseignée sort du prédicat. Une valeur posée par
   * l'ingestion (qui, elle, a vu la resource OTLP) prime toujours sur une valeur
   * dérivée après coup.
   */
  async ecrire(client, plan, seg, lignes) {
    if (!lignes.length) return { written: 0, skips: {} };
    if (seg.nom === "rum_session") {
      const { rowCount } = await client.query(
        `update rum_session s
            set browser = n.browser, browser_version = n.browser_version,
                os = n.os, os_version = n.os_version
           from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
             as n (session_id, browser, browser_version, os, os_version)
          where s.app_id = $1 and s.session_id = n.session_id
            and s.browser is null and s.os is null`,
        [
          plan.app,
          lignes.map((l) => l.session_id),
          lignes.map((l) => l.browser),
          lignes.map((l) => l.browser_version),
          lignes.map((l) => l.os),
          lignes.map((l) => l.os_version),
        ],
      );
      return { written: rowCount ?? 0, skips: lignes.length - (rowCount ?? 0) > 0
        ? { deja_renseignee_entre_temps: lignes.length - (rowCount ?? 0) }
        : {} };
    }
    const { rowCount } = await client.query(
      `update rum_event_index x
          set env = n.env, release = n.release, service = coalesce(n.service, x.service)
         from unnest($2::bigint[], $3::text[], $4::text[], $5::text[])
           as n (id, env, release, service)
        where x.app_id = $1 and x.id = n.id and x.env is null and x.release is null`,
      [
        plan.app,
        lignes.map((l) => l.id),
        lignes.map((l) => l.env),
        lignes.map((l) => l.release),
        lignes.map((l) => l.service),
      ],
    );
    return { written: rowCount ?? 0, skips: lignes.length - (rowCount ?? 0) > 0
      ? { deja_renseignee_entre_temps: lignes.length - (rowCount ?? 0) }
      : {} };
  },

  async verifier(client, plan) {
    const { rows: sessions } = await client.query(
      `select
         count(*) filter (where browser is null and os is null and user_agent is not null and not is_bot)::bigint as restantes,
         count(*) filter (where browser is not null or os is not null)::bigint as renseignees,
         count(*) filter (where user_agent is null)::bigint as sans_user_agent,
         count(*) filter (where is_bot)::bigint as robots
       from rum_session
      where app_id = $1 and last_seen_at >= $2::timestamptz and last_seen_at < $3::timestamptz`,
      [plan.app, plan.from, plan.to],
    );
    // Contrôle SOURCE contre PROJECTION : une ligne d'index dont la source
    // porte une dimension que la projection n'a pas.
    const desaccords = await client.query(
      `select coalesce(sum(n), 0)::bigint as n from (${PROJETEES.map((p) => `
         select count(*)::bigint as n from rum_event_index x
           join ${p.table} s on s.app_id = x.app_id and lower(s.span_id) = x.source_span_id
          where x.app_id = $1 and x.kind = '${p.kind}' and x.ts >= $2::timestamptz and x.ts < $3::timestamptz
            and x.env is null and x.release is null and (s.env is not null or s.release is not null)`).join(" union all ")}) t`,
      [plan.app, plan.from, plan.to],
    );
    const { rows: horodatage } = await client.query(
      `select to_char(max(last_seen_at) at time zone 'UTC', ${ISO_US}) as derniere
         from rum_session where app_id = $1 and last_seen_at < $2::timestamptz`,
      [plan.app, plan.to],
    );
    return {
      sessions_restantes: Number(sessions[0].restantes),
      sessions_renseignees: Number(sessions[0].renseignees),
      sessions_sans_user_agent: Number(sessions[0].sans_user_agent),
      sessions_robots: Number(sessions[0].robots),
      projections_sans_dimension_dont_la_source_en_a: Number(desaccords.rows[0].n),
      derniere_session_de_la_fenetre: horodatage[0].derniere,
      note:
        "`sessions_sans_user_agent` et `sessions_robots` ne sont pas des échecs : ce sont des "
        + "« Inconnu » qui le resteront. `device_type` n'est volontairement pas recalculé.",
    };
  },

  impossible: Object.freeze([
    {
      quoi: "l'environnement et la release des anciennes lignes de signal (avant v75)",
      raison:
        "Ces valeurs viennent de la resource OTLP du lot, qui n'est pas conservée. Les prendre sur "
        + "la session attribuerait à toutes les lignes la DERNIÈRE release vue — une régression "
        + "serait datée de la version qui l'a corrigée. Inconnu reste inconnu.",
    },
    {
      quoi: "le navigateur et le système des sessions sans user-agent stocké",
      raison: "Il n'y a rien à dériver. Une session sans user-agent reste « Inconnu ».",
    },
    {
      quoi: "le navigateur et le système des sessions de robots",
      raison:
        "`clientDimensions` ne lit pas l'user-agent d'un robot, à dessein : lui prêter une famille "
        + "gonflerait celle-ci dès qu'une analyse inclut les robots.",
    },
    {
      quoi: "la classe d'appareil (`device_type`)",
      raison:
        "Elle est CLÉ de `rum_rollup_hourly` et de `metric_histogram_hourly`. La réécrire "
        + "déplacerait des agrégats historiques d'une colonne à l'autre sans les recalculer.",
    },
  ]),
};
