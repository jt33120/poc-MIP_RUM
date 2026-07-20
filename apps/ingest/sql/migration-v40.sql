-- migration-v40 — Triage d'erreurs (résolu / ignoré) + régression + utilisateurs impactés.
--
-- Contexte : /errors regroupe déjà par fingerprint, mais il manquait le workflow
-- « je traite cette erreur » : marquer résolue/ignorée, détecter qu'une erreur
-- résolue réapparaît (régression), et voir combien d'utilisateurs sont touchés
-- (pas seulement de sessions). C'est le principal écart fonctionnel vs Sentry.
--
-- 1) error_status : statut par (app_id, fingerprint), écrit par la console.
--    Pas de CHECK sur `status` — l'allow-list vit côté TS (convention alert_rule).
-- 2) v_error_group_ext : v_error_group + users_affected (distinct user_hash via
--    jointure 1:1 rum_session, donc pas de fan-out sur occurrences/sessions).
-- La régression est dérivée à la LECTURE (status='resolved' AND last_seen >
-- resolved_at) — aucun write de fond, aucun cron.

create table if not exists error_status (
  app_id       text        not null,
  fingerprint  text        not null,
  status       text        not null default 'open', -- 'open' | 'resolved' | 'ignored'
  resolved_at  timestamptz,
  resolved_by  text,                                 -- email de l'opérateur (audité par ailleurs)
  note         text,
  updated_at   timestamptz not null default now(),
  primary key (app_id, fingerprint)
);

alter table error_status enable row level security;

do $$ begin
  -- écriture réservée au rôle applicatif console (jamais anon/authenticated)
  grant select, insert, update, delete on error_status to console_ro;
  if not exists (select 1 from pg_policies where tablename = 'error_status' and policyname = 'cro_all_error_status') then
    create policy cro_all_error_status on error_status for all to console_ro using (true) with check (true);
  end if;
  revoke all on error_status from anon, authenticated;
end $$;

-- Vue étendue : occurrences + sessions + UTILISATEURS distincts touchés.
-- La jointure rum_session est 1:1 sur session_id (clé primaire) — count(*) et
-- count(distinct session_id) restent exacts.
create or replace view v_error_group_ext as
  select e.app_id,
         e.fingerprint,
         max(e.error_type)          as error_type,
         max(e.message)             as sample_message,
         count(*)                   as occurrences,
         count(distinct e.session_id) as sessions,
         count(distinct s.user_hash)  as users_affected,
         min(e.ts)                  as first_seen,
         max(e.ts)                  as last_seen
    from rum_error e
    left join rum_session s on s.session_id = e.session_id
   where e.fingerprint is not null
   group by e.app_id, e.fingerprint;

do $$ begin
  grant select on v_error_group_ext to console_ro;
  revoke all on v_error_group_ext from anon, authenticated;
end $$;
