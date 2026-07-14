-- migration-v29 : signal LOGS (3e signal OTel) -> table rum_log + page supervision.
-- Les logs applicatifs (SDK web, extension, backend, syslog via collecteur) sont
-- ingérés par le parser resourceLogs (_shared/otlp.mjs) et l'endpoint /v1/logs, en
-- MIROIR des traces (resourceSpans / /v1/traces). Corrélables aux spans par
-- trace_id/span_id (mêmes identifiants OTel).
--
-- Parité console_ro GARDÉE (cf. migration-v16) : la console lit sous le rôle
-- restreint console_ro -> grant SELECT + policy cro_*. Bloc sauté si le rôle
-- n'existe pas (CI / local Docker sans console_ro).

create table if not exists rum_log (
  id            bigserial primary key,
  app_id        text not null,
  ts            timestamptz not null default now(),
  severity_num  smallint,                       -- OTLP severityNumber 1..24 (INFO 9..12, WARN 13..16, ERROR 17..20, FATAL 21..24)
  severity_text text,                            -- libellé émetteur ('INFO','WARN','ERROR'...)
  body          text,                            -- message (scrubbé PII, tronqué à 4000)
  source        text not null default 'sdk',     -- sdk | extension | backend | syslog
  trace_id      text,                            -- corrélation avec rum_span
  span_id       text,
  session_id    text,
  route         text,
  attributes    jsonb,                           -- attributs OTLP restants (scrubbés)
  created_at    timestamptz not null default now()
);

-- Accès de la page : listing récent par app + fenêtre (ts desc), filtre sévérité,
-- et jointure de corrélation par trace_id. L'index ts prépare aussi la purge TTL.
create index if not exists rum_log_app_ts  on rum_log (app_id, ts desc);
create index if not exists rum_log_app_sev on rum_log (app_id, severity_num);
create index if not exists rum_log_trace   on rum_log (trace_id) where trace_id is not null;

-- RLS : ferme l'accès par défaut (comme les autres tables télémétrie). L'ingestion
-- écrit sous le rôle propriétaire (BYPASSRLS) ; la console lit via policy console_ro.
alter table rum_log enable row level security;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'console_ro') then
    raise notice 'console_ro absent (CI/local) — parité rum_log sautée';
  else
    grant select on rum_log to console_ro;
    if not exists (
      select 1 from pg_policies where tablename = 'rum_log' and policyname = 'cro_sel_rum_log'
    ) then
      create policy cro_sel_rum_log on rum_log for select to console_ro using (true);
    end if;
  end if;
end $$;

-- SUIVI : intégrer rum_log à purge_rum_app (migration-v14) pour la rétention TTL
-- (l'index rum_log_app_ts est déjà en place). Volume dogfooding faible en attendant.
