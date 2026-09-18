// P8.2 — reprise de la projection `rum_event_index` (besoin n° 2 de la spec).
//
// CE QUE CE MODULE NE FAIT PAS : il ne reparse rien. `rum_event_index` est une
// PROJECTION de collections déjà normalisées, et `buildEventIndex` est la
// fonction qui la construit à l'ingestion. C'est donc ELLE qu'on rappelle, sur
// des lignes relues en base, et non une copie d'un vieux parser recollée dans un
// script de migration — le défaut que la spec nomme explicitement. Si la
// taxonomie, la borne de route ou le filtre de span évoluent, les deux chemins
// évoluent ensemble ou aucun.
//
// UN SPAN ABSENT OU INVALIDE EST UN SKIP, PAS UN IDENTIFIANT INVENTÉ. L'identité
// publiée par la projection est l'identifiant de span OTLP 64 bits ; une ligne
// historique qui n'en porte pas (un vieux SDK, une ligne écrite avant la
// contrainte) n'a AUCUNE identité stable. Lui en fabriquer une — un hash de ses
// colonnes, un UUID — créerait une ligne d'API que rien ne relie au signal
// source, et un second passage en créerait une autre. On la compte, on dit
// pourquoi, on passe.
//
// AUCUN COMPTEUR DE FACTURATION N'AUGMENTE. `meter_tenant_usage` compte les
// tables SOURCES (migration-v70) ; `rum_event_index` en est explicitement
// absente. Écrire ici ne fait donc payer personne, et un test le vérifie plutôt
// que de s'en remettre au commentaire.
import { batchInsert } from "../pg-ingest.mjs";
import { buildEventIndex, isNativeSpanId } from "../../supabase/functions/_shared/otlp.mjs";
import { ISO_US } from "./commun.mjs";

/**
 * Les huit tables sources, et la collection de `buildEventIndex` que chacune
 * alimente. L'ordre est celui de `buildEventIndex` lui-même : une reprise
 * interrompue reprend au même endroit qu'une autre lancée le lendemain.
 */
export const SOURCES = Object.freeze([
  { table: "rum_pageview", ordre: "id", ts: "started_at", collection: "pageviews", kind: "pageview" },
  { table: "rum_metric", ordre: "id", ts: "ts", collection: "metrics", kind: "vital" },
  { table: "rum_error", ordre: "id", ts: "ts", collection: "errors", kind: "error" },
  { table: "rum_resource", ordre: "id", ts: "ts", collection: "resources", kind: "resource" },
  { table: "rum_longtask", ordre: "id", ts: "ts", collection: "longtasks", kind: "longtask" },
  { table: "rum_breadcrumb", ordre: "id", ts: "ts", collection: "breadcrumbs", kind: "breadcrumb" },
  { table: "rum_event", ordre: "id", ts: "ts", collection: "events", kind: "event" },
  { table: "rum_span", ordre: "id", ts: "ts", collection: "spans", kind: "span" },
]);

/**
 * Colonnes lues par table, au-delà du tronc commun.
 *
 * Elles sont nommées explicitement plutôt que `select *` : une colonne ajoutée
 * demain par un autre lot ne doit pas entrer d'elle-même dans la projection sans
 * que quiconque l'ait décidé.
 */
const COLONNES = Object.freeze({
  rum_pageview: ["env", "release"],
  rum_metric: ["name", "env", "release"],
  rum_error: ["env", "release", "service", "context", "user_id_hash", "account_id_hash",
    "view_id", "view_name", "action_id"],
  rum_resource: ["type", "env", "release"],
  rum_longtask: ["source", "env", "release"],
  rum_breadcrumb: ["type"],
  rum_event: ["name", "event_type", "context", "user_id_hash", "account_id_hash", "view_id",
    "view_name", "action_id", "timing_ms", "feature_flag_value", "env", "release"],
  rum_span: ["kind", "env", "release", "service"],
});

/** Colonnes de `rum_event_index` écrites par la reprise. */
const COLONNES_CIBLE = Object.freeze([
  "app_id", "session_id", "ts", "route", "kind", "source_name", "source_span_id",
  "event_type", "context", "user_id_hash", "account_id_hash", "view_id", "view_name",
  "action_id", "timing_ms", "feature_flag_value", "env", "release", "service",
]);

const segment = (nom) => SOURCES.find((s) => s.table === nom) ?? SOURCES[0];

/** SELECT d'un lot : tronc commun + colonnes propres à la table. */
function selectLot(source) {
  const extra = COLONNES[source.table].map((c) => `s.${c}`).join(", ");
  return `
    select s.id::text as _id,
           s.app_id, s.session_id, s.span_id, s.route,
           to_char(s.${source.ts} at time zone 'UTC', ${ISO_US}) as ts,
           -- En SECONDES, pas en jours entiers : la limite de purge se compare
           -- à l'instant près, et une rétention fractionnaire doit rester
           -- exprimable (les tests jouent la limite qui rattrape une reprise).
           s.${source.ts} < (now() - make_interval(secs => $6::double precision * 86400)) as _hors_retention,
           exists (select 1 from rum_event_index x
                    where x.app_id = s.app_id and x.kind = $7
                      and x.source_span_id = lower(s.span_id)) as _deja,
           ${extra}
      from ${source.table} s
     where s.app_id = $1 and s.${source.ts} >= $2::timestamptz and s.${source.ts} < $3::timestamptz
       and s.id > $4::bigint and ($5::bigint is null or s.id <= $5::bigint)
     order by s.id
     limit $8`;
}

export const EVENEMENT_INDEX = {
  nom: "event-index",
  sources: SOURCES,
  cibles: ["rum_event_index"],
  cleUnique: "rum_event_index (app_id, kind, source_span_id) — l'identifiant de span OTLP natif",

  /** Un segment par table source, dans l'ordre de `buildEventIndex`. PUR. */
  segments() {
    return SOURCES.map((s) => ({ nom: s.table, table: s.table }));
  },

  /**
   * Borne haute PAR TABLE ET PAR ORDRE DE CLÉ, relevée au plan.
   *
   * `max(id)` n'est PAS un instantané : une transaction ouverte avant ce relevé
   * peut commiter après, avec un identifiant inférieur. C'est exactement
   * pourquoi le runner fait un scan de réconciliation SANS borne haute après
   * avoir parcouru la fenêtre — et pourquoi ce champ s'appelle « borne » et non
   * « snapshot ».
   */
  async bornes(client, { app, from, to }) {
    const out = {};
    for (const s of SOURCES) {
      const { rows } = await client.query(
        `select coalesce(max(id), 0)::text as borne, count(*)::bigint as lignes
           from ${s.table}
          where app_id = $1 and ${s.ts} >= $2::timestamptz and ${s.ts} < $3::timestamptz`,
        [app, from, to],
      );
      out[s.table] = { ordre: s.ordre, borne_haute: rows[0].borne, lignes_sous_la_borne: Number(rows[0].lignes) };
    }
    return out;
  },

  /**
   * Comptes du plan : éligibles, déjà projetées, sans identifiant de source.
   *
   * Chaque compte passe par `compter()`, qui décide entre exact et échantillon
   * d'après le coût annoncé par PostgreSQL — et le DIT.
   */
  async comptes(client, plan, compter) {
    const par_table = {};
    let eligibles = 0;
    let deja = 0;
    let nuls = 0;
    let echantillonne = false;
    for (const s of SOURCES) {
      // LE PRÉDICAT EST PARENTHÉSÉ, et ce n'est pas de la cosmétique. `and` lie
      // plus fort que `or` : sans ces parenthèses, `… app_id = $1 and ts >= $2
      // and ts < $3 and not (valide) or span_id is null` se lit
      // `(app_id and ts and not valide) or (span_id is null)` — le compte des
      // identifiants absents s'échappait de l'application ET de la fenêtre, et
      // ramassait les lignes de tous les autres locataires.
      const base = (predicat) => `
        select count(*)::bigint as n from ${s.table} s
         where s.app_id = $1 and s.${s.ts} >= $2::timestamptz and s.${s.ts} < $3::timestamptz and (${predicat})`;
      const valide = "s.span_id ~ '^[0-9a-fA-F]{16}$'";
      const projete = `exists (select 1 from rum_event_index x
                                where x.app_id = s.app_id and x.kind = '${s.kind}'
                                  and x.source_span_id = lower(s.span_id))`;
      const [e, d, n] = await Promise.all([
        compter(client, { ...plan, sqlCompte: base(`${valide} and not ${projete}`), sqlHeure: base(`${valide} and not ${projete}`) }),
        compter(client, { ...plan, sqlCompte: base(`${valide} and ${projete}`), sqlHeure: base(`${valide} and ${projete}`) }),
        compter(client, { ...plan, sqlCompte: base(`not (${valide}) or s.span_id is null`), sqlHeure: base(`not (${valide}) or s.span_id is null`) }),
      ]);
      par_table[s.table] = { eligibles: e, deja_presentes: d, id_source_nul: n };
      eligibles += e.valeur;
      deja += d.valeur;
      nuls += n.valeur;
      echantillonne ||= [e, d, n].some((c) => c.methode === "echantillon");
    }
    return {
      // La méthode globale est la PIRE des méthodes par table : dire « exact »
      // parce que sept tables sur huit l'étaient serait un mensonge par moyenne.
      methode: echantillonne ? "echantillon" : "exact",
      eligibles: { valeur: eligibles, methode: echantillonne ? "echantillon" : "exact" },
      deja_presentes: { valeur: deja },
      id_source_nul: { valeur: nuls },
      par_table,
      note_occurrences:
        "Ces comptes sont des COMPTES DE LIGNES sources, pas des occurrences : la projection est "
        + "une ligne par signal source. Les occurrences d'erreur (`sum(occurrences)`) relèvent du "
        + "kind `rollups`.",
    };
  },

  /** Ambiguïtés que le plan doit nommer avant qu'on écrive quoi que ce soit. */
  async collisions(client, { app, from, to }) {
    const out = [];
    for (const s of SOURCES) {
      // Un même span déjà projeté sous UNE AUTRE application. La reprise ne
      // l'écrira pas (l'anti-jointure porte app_id), mais l'existence du cas
      // doit être visible : c'est le symptôme d'un identifiant client réutilisé.
      const { rows } = await client.query(
        `select count(*)::bigint as n from ${s.table} s
           join rum_event_index x on x.kind = $4 and x.source_span_id = lower(s.span_id)
                                 and x.app_id <> s.app_id
          where s.app_id = $1 and s.${s.ts} >= $2::timestamptz and s.${s.ts} < $3::timestamptz`,
        [app, from, to, s.kind],
      );
      if (Number(rows[0].n) > 0) {
        out.push({
          genre: "span_projete_sous_une_autre_app",
          table: s.table,
          lignes: Number(rows[0].n),
          consequence:
            "Non écrites, et c'est le comportement voulu : l'anti-jointure et la clé unique portent "
            + "app_id. Un identifiant de span partagé entre deux applications trahit un émetteur qui "
            + "réutilise ses identifiants, pas une projection manquante.",
        });
      }
    }
    return out;
  },

  /**
   * Lit un lot depuis la source, DANS la transaction de l'appelant.
   *
   * RELECTURE À CHAQUE TRANSACTION, jamais une copie en mémoire lue avant : un
   * effacement DSAR (P8.1) peut avoir commité entre deux lots, et réinsérer
   * depuis un tableau lu plus tôt ressusciterait exactement ce qu'il vient de
   * supprimer. C'est le point qui relie ce lot au précédent.
   */
  async lire(client, plan, seg, curseur, taille) {
    const source = segment(seg?.table);
    const borne = plan.phase === "reconciliation" ? null : plan.cutoffs?.[source.table]?.borne_haute ?? null;
    const { rows } = await client.query(selectLot(source), [
      plan.app, plan.from, plan.to, curseur ?? "0", borne, plan.retention_jours ?? 30, source.kind, taille,
    ]);
    const skips = {};
    const lignes = [];
    for (const r of rows) {
      if (r._hors_retention) {
        skips.hors_retention = (skips.hors_retention ?? 0) + 1;
        continue;
      }
      if (!isNativeSpanId(typeof r.span_id === "string" ? r.span_id.toLowerCase() : r.span_id)) {
        // Rapporté, jamais remplacé : un identifiant inventé n'est relié à rien.
        skips.span_id_invalide = (skips.span_id_invalide ?? 0) + 1;
        continue;
      }
      if (r._deja) {
        skips.deja_presente = (skips.deja_presente ?? 0) + 1;
        continue;
      }
      lignes.push({ ...r, collection: source.collection });
    }
    return {
      lignes,
      scanned: rows.length,
      skips,
      curseur: rows.length ? rows[rows.length - 1]._id : curseur,
      fini: rows.length < taille,
    };
  },

  /**
   * Construit la projection avec `buildEventIndex` et l'écrit.
   *
   * `on conflict do nothing` sur la vraie clé unique : l'anti-jointure de
   * lecture a déjà écarté ce qui existait, mais une ingestion concurrente peut
   * avoir écrit la même ligne entre les deux — le conflit est alors un
   * non-événement, pas un échec de migration.
   */
  async ecrire(client, plan, seg, lignes) {
    if (!lignes.length) return { written: 0, skips: {} };
    const collections = {};
    for (const l of lignes) {
      (collections[l.collection] ??= []).push(l);
    }
    const projection = buildEventIndex(collections);
    const perdues = lignes.length - projection.length;
    const res = await batchInsert(
      client,
      "rum_event_index",
      COLONNES_CIBLE,
      projection.map((e) => ({
        ...e,
        session_id: e.session_id ?? null,
        context: e.context ? JSON.stringify(e.context) : "{}",
        event_type: e.event_type ?? null,
        user_id_hash: e.user_id_hash ?? null,
        account_id_hash: e.account_id_hash ?? null,
        view_id: e.view_id ?? null,
        view_name: e.view_name ?? null,
        action_id: e.action_id ?? null,
        timing_ms: e.timing_ms ?? null,
        feature_flag_value: e.feature_flag_value ?? null,
        env: e.env ?? null,
        release: e.release ?? null,
        service: e.service ?? null,
      })),
      "on conflict (app_id, kind, source_span_id) do nothing",
    );
    const ecrites = res?.rowCount ?? 0;
    return {
      written: ecrites,
      skips: {
        // `buildEventIndex` a REFUSÉ la ligne (span non natif après relecture) :
        // le compte le dit au lieu de disparaître dans la différence.
        ...(perdues > 0 ? { refusee_par_build_event_index: perdues } : {}),
        ...(projection.length - ecrites > 0 ? { conflit_concurrent: projection.length - ecrites } : {}),
      },
    };
  },

  /**
   * Vérification INDÉPENDANTE du runner : elle ne lit ni le curseur, ni les
   * compteurs de l'exécution. Elle repose la question depuis les tables.
   */
  async verifier(client, plan) {
    const rapport = { par_table: {}, restant: 0, projete: 0, sans_source: 0 };
    for (const s of SOURCES) {
      const { rows } = await client.query(
        `select
           count(*) filter (where valide and not projete)::bigint as restant,
           count(*) filter (where valide and projete)::bigint     as projete,
           count(*) filter (where not valide)::bigint             as sans_identifiant
         from (
           select s.span_id ~ '^[0-9a-fA-F]{16}$' as valide,
                  exists (select 1 from rum_event_index x
                           where x.app_id = s.app_id and x.kind = $4
                             and x.source_span_id = lower(s.span_id)) as projete
             from ${s.table} s
            where s.app_id = $1 and s.${s.ts} >= $2::timestamptz and s.${s.ts} < $3::timestamptz
         ) t`,
        [plan.app, plan.from, plan.to, s.kind],
      );
      // Projection sans source : une ligne d'index dont le signal a disparu
      // (effacement, purge). Elle n'est pas une erreur de la reprise — elle est
      // comptée pour que personne ne l'attribue à la reprise.
      const { rows: orphelines } = await client.query(
        `select count(*)::bigint as n from rum_event_index x
          where x.app_id = $1 and x.kind = $4 and x.ts >= $2::timestamptz and x.ts < $3::timestamptz
            and not exists (select 1 from ${s.table} s
                             where s.app_id = x.app_id and lower(s.span_id) = x.source_span_id)`,
        [plan.app, plan.from, plan.to, s.kind],
      );
      rapport.par_table[s.table] = {
        restant: Number(rows[0].restant),
        projete: Number(rows[0].projete),
        sans_identifiant_de_source: Number(rows[0].sans_identifiant),
        projection_sans_source: Number(orphelines[0].n),
      };
      rapport.restant += Number(rows[0].restant);
      rapport.projete += Number(rows[0].projete);
      rapport.sans_source += Number(orphelines[0].n);
    }
    return rapport;
  },

  impossible: Object.freeze([
    {
      quoi: "les lignes source sans identifiant de span natif",
      raison:
        "La projection publie l'identifiant de span OTLP 64 bits. Une ligne qui n'en porte pas n'a "
        + "aucune identité stable ; en inventer une créerait une entrée d'API que rien ne relie au "
        + "signal source, et un second passage en créerait une autre.",
    },
    {
      quoi: "les signaux déjà purgés ou effacés",
      raison: "Une projection se dérive d'une source. Sans la source, il n'y a rien à projeter.",
    },
    {
      quoi: "les métadonnées jamais conservées par la source",
      raison:
        "`buildEventIndex` ne lit que les colonnes réellement présentes. Un `env` ou une `release` "
        + "absents de la ligne source restent NULL, c'est-à-dire « Inconnu » — jamais devinés depuis "
        + "la session.",
    },
  ]),
};
