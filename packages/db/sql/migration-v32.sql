-- migration-v32 : marqueurs de déploiement (Voie A · inc. 3). Un déploiement est
-- un événement daté rattaché à une app ; croisé aux métriques RUM, il répond à la
-- moitié « et l'heure de régression » du différenciateur : « la dégradation a
-- commencé après le déploiement X à 14h32 ». Alimenté par la CI/CD via l'API
-- (POST /api/v1/deploys) — le point d'intégration ITSM/CI-CD du pitch.
--
-- Parité console_ro GARDÉE (cf. migration-v16/v29) : grant SELECT + policy cro_*,
-- bloc sauté si le rôle n'existe pas (CI / local Docker).

create table if not exists deploy_marker (
  id         bigserial primary key,
  app_id     text not null,
  ts         timestamptz not null default now(), -- horodatage du déploiement
  version    text,                               -- libellé / release (git SHA, "1.4.2"…)
  env        text not null default 'prod',       -- prod | staging | …
  source     text not null default 'api',        -- api | ci | manual
  created_at timestamptz not null default now()
);

-- overlay chronologique + « dernier déploiement » : lecture par app, ts desc.
create index if not exists deploy_marker_app_ts on deploy_marker (app_id, ts desc);

alter table deploy_marker enable row level security;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'console_ro') then
    raise notice 'console_ro absent (CI/local) — parité deploy_marker sautée';
  else
    grant select on deploy_marker to console_ro;
    if not exists (
      select 1 from pg_policies where tablename = 'deploy_marker' and policyname = 'cro_sel_deploy_marker'
    ) then
      create policy cro_sel_deploy_marker on deploy_marker for select to console_ro using (true);
    end if;
  end if;
end $$;
