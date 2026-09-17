-- migration-v70 — P5.3 : exceptions backend et OpenTelemetry.
--
-- Additif, sans backfill et sans index. Une exception peut désormais être
-- DÉRIVÉE d'un autre signal : un événement `exception` posé sur un span backend
-- (agent Node, middleware FastAPI, SDK OpenTelemetry) ou un log ERROR portant
-- `exception.type/message/stacktrace`. Elle est écrite dans rum_error comme les
-- autres, sans session inventée, avec son origine :
--
--   origin_signal  'span_event' ou 'log' ; NULL pour une ligne qui EST le signal
--                  reçu (span dédié `exception` des SDK client, lignes
--                  antérieures).
--   exception_id   `mip.exception_id` déclaré par l'émetteur (32 hex ou UUID) :
--                  la même exception publiée en log ET en span porte le même
--                  identifiant, et l'ingestion n'en écrit qu'une ligne.
--
-- L'identité d'une ligne dérivée occupe `span_id` (contrainte unique existante) :
-- 32 hex d'un SHA-256 app-scopé, jamais un span OTLP natif de 16 hex. Le span
-- porteur reste dans `source_parent_span_id`. Aucun index : l'idempotence passe
-- par rum_error_span_id_key, et aucun lecteur ne filtre encore sur l'origine.
--
-- VERROU. Comme v69, `alter table` prend un ACCESS EXCLUSIVE sur rum_error
-- jusqu'au commit : l'attente est bornée. Si elle expire, le fichier est annulé et
-- rejoué ; le code tolère un schéma sans v70 (détection des colonnes).
--
-- CONTRAINTE NOT VALID. Les lignes existantes portent NULL et satisfont la règle ;
-- la valider parcourrait la table la plus chaude sous ce même verrou.
--
-- RÉTENTION ET EFFACEMENTS. Les lignes dérivées vivent dans rum_error : la purge
-- par app (purge_rum_app), l'effacement d'app (erase_app_data) et celui d'une
-- session (erase_session) les emportent sans redéfinition. Une exception backend
-- n'est rattachée à une session que si celle-ci existe dans la même app ; sans
-- session, l'effacement par identité HMAC l'atteint directement (queries-dsar.ts).
set local lock_timeout = '5s';

alter table rum_error
  add column if not exists origin_signal text,
  add column if not exists exception_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.rum_error'::regclass
       and conname = 'rum_error_origin_v70'
  ) then
    alter table rum_error add constraint rum_error_origin_v70 check (
      (origin_signal is null or origin_signal in ('span_event', 'log')) and
      (exception_id is null or (
        origin_signal is not null and
        exception_id ~ '^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
      ))
    ) not valid;
  end if;
end $$;

comment on column rum_error.origin_signal is
  'Signal dont l''exception est dérivée (span_event, log) ; NULL si la ligne est elle-même le signal reçu';
comment on column rum_error.exception_id is
  'mip.exception_id déclaré par l''émetteur (32 hex ou UUID) : clé de déduplication log + span, jamais un texte libre';

-- ─────────────────────── UNITÉ FACTURÉE, AVANT LA FORMULE ───────────────────────
--
-- tenant_usage_daily.events compte les SIGNAUX SOURCES stockés du jour : une ligne
-- de rum_pageview, rum_metric, rum_error, rum_resource, rum_longtask,
-- rum_breadcrumb, rum_event ou rum_span. Les logs (rum_log) n'y entrent pas, ni
-- les projections (rum_event_index, rum_action).
--
-- Une exception DÉRIVÉE n'est pas un signal de plus : le span qui la porte est
-- déjà compté dans rum_span, et le log qui la porte n'est pas facturé. La compter
-- facturerait deux fois un même span, ou ferait payer un log comme un événement.
-- Elle est donc exclue de `events` (origin_signal IS NULL) et reste comptée dans
-- `errors`, la somme des occurrences d'erreur, dérivées comprises.
--
-- Rien ne change pour les lignes déjà écrites : aucune ne porte d'origine.
--
-- `ev full join er` et non plus `ev left join er` : jusqu'ici toute ligne d'erreur
-- était un événement, donc une app avec des erreurs figurait toujours dans `ev`.
-- Une app qui n'envoie que des logs d'exception n'a plus d'événement facturé ; ses
-- occurrences d'erreur doivent rester mesurées.
create or replace function meter_tenant_usage(p_day date default (current_date - 1))
returns jsonb language plpgsql as $$
declare lo timestamptz := p_day::timestamptz; hi timestamptz := (p_day + 1)::timestamptz; n int;
begin
  with ev as (
    select app_id, count(*) as c from (
      select app_id from rum_metric     where ts >= lo and ts < hi
      union all select app_id from rum_error      where ts >= lo and ts < hi and origin_signal is null
      union all select app_id from rum_resource   where ts >= lo and ts < hi
      union all select app_id from rum_longtask   where ts >= lo and ts < hi
      union all select app_id from rum_breadcrumb where ts >= lo and ts < hi
      union all select app_id from rum_event      where ts >= lo and ts < hi
      union all select app_id from rum_span       where ts >= lo and ts < hi
      union all select app_id from rum_pageview   where started_at >= lo and started_at < hi
    ) x group by app_id
  ),
  se as (select app_id, count(distinct session_id) as c from rum_pageview where started_at >= lo and started_at < hi group by app_id),
  er as (select app_id, coalesce(sum(occurrences), 0)::bigint as c from rum_error where ts >= lo and ts < hi group by app_id),
  up as (
    insert into tenant_usage_daily (app_id, day, events, sessions, errors, metered_at)
    select app_id, p_day, coalesce(ev.c, 0), coalesce(se.c, 0), coalesce(er.c, 0), clock_timestamp()
    from ev full join er using (app_id) left join se using (app_id)
    on conflict (app_id, day) do update
      set events = excluded.events, sessions = excluded.sessions,
          errors = excluded.errors, metered_at = clock_timestamp()
    returning 1
  )
  select count(*) into n from up;
  return jsonb_build_object('day', p_day, 'apps_metered', n);
end $$;
