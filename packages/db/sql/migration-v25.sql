-- migration-v25.sql — Lot 8b : objectifs & conversions (goals persistants).
-- Un objectif = une condition (page vue OU événement) évaluée sur la fenêtre :
-- une session « convertit » si elle satisfait la condition au moins une fois.
-- Défini/géré côté admin ; le report (taux de conversion) est lu par la console.

create table if not exists goal (
  id          bigserial primary key,
  app_id      text not null,
  name        text not null,
  kind        text not null check (kind in ('pageview', 'event')),
  pattern     text not null,                 -- route (pageview) ou nom d'événement (event)
  match_type  text not null default 'exact' check (match_type in ('exact', 'contains')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_goal_app on goal (app_id) where active;

-- Accès console (même rôle que les autres tables applicatives).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert, update, delete on goal to console_ro;
    grant usage, select on sequence goal_id_seq to console_ro;
  end if;
end $$;
