-- migration-v42 — Monitoring SYNTHÉTIQUE (uptime). Le RUM est passif : il ne voit
-- que ce que les vrais visiteurs déclenchent. Un check actif répond à « le site
-- est-il debout MÊME quand personne ne visite ? ». Checks HTTP périodiques sur
-- des URLs configurées, exécutés par l'edge function `uptime` (Deno fetch), qui
-- écrit les résultats ici et alerte sur bascule UP→DOWN.
--
-- 1) uptime_check  : configuration (une URL surveillée par ligne, scoping app).
-- 2) uptime_result : historique des sondes (ok/latence/status/erreur).
-- 3) v_uptime_status : dernier état + disponibilité 24 h par check (lecture console).
--
-- Rôles cloud (console_ro/anon/authenticated) gardés par if exists (pg_roles) —
-- absents de la base CI.

create table if not exists uptime_check (
  id            bigint generated always as identity primary key,
  app_id        text        not null,
  name          text        not null,
  url           text        not null,
  method        text        not null default 'GET',
  expect_status integer     not null default 200,
  timeout_ms    integer     not null default 10000,
  enabled       boolean     not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists uptime_result (
  id          bigint generated always as identity primary key,
  check_id    bigint      not null references uptime_check(id) on delete cascade,
  ts          timestamptz not null default now(),
  ok          boolean     not null,
  status_code integer,
  latency_ms  integer,
  error       text
);

create index if not exists idx_uptime_result_check_ts on uptime_result (check_id, ts desc);

alter table uptime_check  enable row level security;
alter table uptime_result enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert, update, delete on uptime_check to console_ro;
    grant select on uptime_result to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'uptime_check' and policyname = 'cro_all_uptime_check') then
      create policy cro_all_uptime_check on uptime_check for all to console_ro using (true) with check (true);
    end if;
    if not exists (select 1 from pg_policies where tablename = 'uptime_result' and policyname = 'cro_sel_uptime_result') then
      create policy cro_sel_uptime_result on uptime_result for select to console_ro using (true);
    end if;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on uptime_check from anon; revoke all on uptime_result from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on uptime_check from authenticated; revoke all on uptime_result from authenticated;
  end if;
end $$;

-- Dernier état + disponibilité sur 24 h (part de sondes ok), par check.
create or replace view v_uptime_status as
  select c.id, c.app_id, c.name, c.url, c.method, c.expect_status, c.enabled, c.created_at,
         last.ts          as last_checked_at,
         last.ok          as last_ok,
         last.status_code as last_status_code,
         last.latency_ms  as last_latency_ms,
         last.error       as last_error,
         agg.checks_24h,
         agg.up_24h,
         case when agg.checks_24h > 0
              then round(100.0 * agg.up_24h / agg.checks_24h, 2)
              else null end as uptime_pct_24h
    from uptime_check c
    left join lateral (
      select ts, ok, status_code, latency_ms, error
      from uptime_result r where r.check_id = c.id
      order by r.ts desc limit 1
    ) last on true
    left join lateral (
      select count(*) as checks_24h, count(*) filter (where ok) as up_24h
      from uptime_result r where r.check_id = c.id and r.ts > now() - interval '24 hours'
    ) agg on true;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on v_uptime_status to console_ro;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on v_uptime_status from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on v_uptime_status from authenticated; end if;
end $$;

-- Planification (cloud uniquement) : toutes les 5 min, déclenche l'edge function
-- `uptime` (verify_jwt=off) qui exécute les sondes. Faible risque : la fonction
-- ne fait que sonder les URLs DÉJÀ configurées ici et écrire les résultats — elle
-- n'accepte aucune donnée arbitraire. Gardé si pg_cron/pg_net absents (CI/local).
do $$
declare url text := 'https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/uptime';
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('mip-uptime', '*/5 * * * *', format($cron$
      select net.http_post(url := %L, headers := jsonb_build_object('content-type','application/json'))
    $cron$, url));
  end if;
end $$;

-- Enregistre une sonde + alerte sur bascule UP->DOWN (ou 1er état DOWN). Appelée
-- par l'edge function `uptime` (service_role). Le « transition-only » dédup
-- naturellement : pas de spam tant que le check reste DOWN.
create or replace function record_uptime_result(
  p_check_id bigint, p_ok boolean, p_status integer, p_latency integer, p_error text
) returns void
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare prev_ok boolean; c record; ev_id bigint; msg text;
begin
  select ok into prev_ok from uptime_result where check_id = p_check_id order by ts desc limit 1;
  insert into uptime_result (check_id, ok, status_code, latency_ms, error)
    values (p_check_id, p_ok, p_status, p_latency, p_error);
  if not p_ok and (prev_ok is null or prev_ok = true) then
    select * into c from uptime_check where id = p_check_id;
    msg := format('Uptime DOWN — %s (%s) : %s',
      c.name, c.url, coalesce(p_error, 'HTTP ' || coalesce(p_status::text, '?')));
    insert into alert_event (rule_id, slo_id, value, message, severity)
      values (null, null, coalesce(p_status, 0),
              format('uptime %s / app %s — %s', c.name, c.app_id, msg), 'critical')
      returning id into ev_id;
    perform route_alert(ev_id, c.app_id, 'critical', '[MIP RUM] ' || msg,
      jsonb_build_object('source', 'mip-rum', 'kind', 'uptime_down', 'app_id', c.app_id,
        'check', c.name, 'url', c.url, 'status', p_status, 'error', p_error, 'text', msg));
  end if;
end $function$;

do $$ begin
  revoke execute on function record_uptime_result(bigint, boolean, integer, integer, text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function record_uptime_result(bigint, boolean, integer, integer, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function record_uptime_result(bigint, boolean, integer, integer, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function record_uptime_result(bigint, boolean, integer, integer, text) to service_role;
  end if;
end $$;
