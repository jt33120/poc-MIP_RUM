-- migration-v17 : ALERTING MATURE (P1) — 3 piliers par-dessus l'alerting statique.
--   1. BASELINES DYNAMIQUES : règle en mode 'baseline' → alerte sur l'écart au
--      normal SAISONNIER (même jour-de-semaine + heure, médiane/MAD robustes sur
--      N semaines), au lieu d'un seuil fixe. Réduit le bruit (le #1 reproche).
--   2. SLO + ERROR-BUDGET : objectifs (ex. 99% LCP 'good' / 28 j), atteinte +
--      budget + burn-rate ; un burn rapide déclenche un alert_event (flux unifié).
--   3. ROUTING multi-canal + SÉVÉRITÉ : règles taguées info/warning/critical ;
--      notification vers N canaux (webhook/Slack) filtrés par sévérité, en plus du
--      webhook historique de la règle. E-mail/SMS = canal documenté, NON livré ici
--      (service externe payant) — hook prêt.
-- Idempotente, gardée (pg_cron/console_ro absents en CI/local → blocs sautés).

-- ───────────────────────── 1) Schéma ─────────────────────────
-- Règles : mode + sévérité + paramètres baseline (rétro-compatible : défauts =
-- comportement v0.3 'threshold'/'warning').
alter table alert_rule add column if not exists mode           text   not null default 'threshold'; -- threshold|baseline
alter table alert_rule add column if not exists severity       text   not null default 'warning';   -- info|warning|critical
alter table alert_rule add column if not exists sensitivity    double precision not null default 3;  -- k (MAD) en mode baseline
alter table alert_rule add column if not exists baseline_weeks int    not null default 4;            -- profondeur de l'historique saisonnier

-- SLO (objectifs de service) — base de l'error-budget.
create table if not exists slo (
  id          bigserial primary key,
  app_id      text not null,
  name        text not null,
  metric      text not null,                 -- LCP|INP|CLS|FCP|TTFB (part 'good') | error_rate (part sans erreur)
  objective   double precision not null,     -- 0..1 (ex. 0.99)
  window_days int  not null default 28,
  route       text,                          -- null = toutes routes
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Canaux de notification (routing). kind='webhook'|'slack' livrés ; 'email' réservé.
create table if not exists notify_channel (
  id           bigserial primary key,
  app_id       text,                         -- null = tous les tenants
  kind         text not null default 'webhook',
  target       text not null,                -- URL (webhook/slack)
  severity_min text not null default 'warning', -- ne reçoit qu'à partir de cette sévérité
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_channel_app on notify_channel (app_id) where active;

-- alert_event : rattachable à une règle OU à un SLO (flux d'événements unifié).
alter table alert_event add column if not exists slo_id   bigint references slo(id) on delete cascade;
alter table alert_event add column if not exists severity text not null default 'warning';
alter table alert_event alter column rule_id drop not null;

-- Ordre de sévérité (info<warning<critical) pour les comparaisons de routing.
create or replace function severity_rank(s text) returns int language sql immutable as $$
  select case s when 'critical' then 3 when 'warning' then 2 when 'info' then 1 else 0 end;
$$;

-- ───────────────────────── 2) Baseline saisonnière ─────────────────────────
-- Médiane + MAD des échantillons HORAIRES au même créneau (jour-de-semaine, heure)
-- sur p_weeks semaines, hors heure courante. p75 pour les vitals ; taux d'erreur
-- horaire pour 'error_rate'. n = nb d'échantillons (fiabilité).
create or replace function metric_baseline(p_app_id text, p_metric text, p_route text, p_weeks int)
returns table(med double precision, mad double precision, n int)
language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare lo timestamptz := date_trunc('hour', now()) - make_interval(days => greatest(p_weeks,1) * 7);
        hi timestamptz := date_trunc('hour', now());
begin
  if p_metric = 'error_rate' then
    return query
    with pv as (
      select date_trunc('hour', started_at) h, count(*) n from rum_pageview
      where app_id = p_app_id and (p_route is null or route = p_route) and started_at >= lo and started_at < hi
      group by 1
    ), er as (
      select date_trunc('hour', ts) h, count(*) n from rum_error
      where app_id = p_app_id and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), hourly as (
      select pv.h, coalesce(er.n,0)::float / greatest(pv.n,1) as val from pv left join er using (h)
    ), seasonal as (
      select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())
    ), m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m),
           percentile_cont(0.5) within group (order by abs(val - (select v from m))),
           count(*)::int
    from seasonal;
  else
    return query
    with hourly as (
      select date_trunc('hour', ts) h, percentile_cont(0.75) within group (order by value) as val
      from rum_metric
      where app_id = p_app_id and name = p_metric and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), seasonal as (
      select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())
    ), m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m),
           percentile_cont(0.5) within group (order by abs(val - (select v from m))),
           count(*)::int
    from seasonal;
  end if;
end $$;

-- ───────────────────────── 3) SLO : statut + error-budget ─────────────────────────
-- attainment = part conforme sur la fenêtre (vital 'good' | 1 - taux d'erreur).
-- budget = 1 - objective ; burned_pct = consommation du budget ; fast_burn = le
-- taux non conforme de la DERNIÈRE HEURE dépasse 14,4× le budget (burn-rate SRE).
create or replace function slo_status(p_app_id text default null)
returns table(slo_id bigint, app_id text, name text, metric text, route text,
              objective double precision, window_days int,
              attainment double precision, budget double precision,
              burned_pct double precision, fast_burn boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select s.id, s.app_id, s.name, s.metric, s.route, s.objective, s.window_days,
         att.attainment,
         (1 - s.objective) as budget,
         case when (1 - s.objective) > 0
              then least(greatest((1 - att.attainment) / (1 - s.objective), 0) * 100, 999) end as burned_pct,
         (1 - att1h.attainment) >= 14.4 * (1 - s.objective) as fast_burn
  from slo s
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select count(*)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.ts > now() - make_interval(days => s.window_days))
            / greatest((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - make_interval(days => s.window_days)), 1)
      else
        (select count(*) filter (where m.rating = 'good')::float / greatest(count(*),1)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - make_interval(days => s.window_days))
    end as attainment
  ) att
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select count(*)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.ts > now() - interval '1 hour')
            / greatest((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - interval '1 hour'), 1)
      else
        (select count(*) filter (where m.rating = 'good')::float / greatest(count(*),1)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - interval '1 hour')
    end as attainment
  ) att1h
  where s.active and (p_app_id is null or s.app_id = p_app_id)
  order by burned_pct desc nulls last;
$$;

-- ───────────────────────── 4) Routing : notifier N canaux ─────────────────────────
-- Insère alert_delivery + tente pg_net pour chaque canal éligible (sévérité ≥ seuil
-- du canal, app correspondante ou globale). Slack → payload {text} ; webhook → JSON
-- complet. E-mail : tracé 'skipped' (non livré ici). Réutilisable par règle ET SLO.
create or replace function route_alert(p_event_id bigint, p_app_id text, p_severity text, p_text text, p_payload jsonb)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare ch record; req_id bigint; sent int := 0;
begin
  for ch in
    select * from notify_channel
     where active and severity_rank(severity_min) <= severity_rank(p_severity)
       and (app_id is null or app_id = p_app_id)
  loop
    insert into alert_delivery (alert_event_id, target) values (p_event_id, ch.target);
    if ch.kind = 'email' then
      update alert_delivery set status = 'skipped', response = 'email non livré (canal payant non branché)'
        where alert_event_id = p_event_id and target = ch.target and status = 'queued';
      continue;
    end if;
    begin
      select net.http_post(
        url := ch.target,
        body := case when ch.kind = 'slack' then jsonb_build_object('text', p_text) else p_payload end
      ) into req_id;
      update alert_delivery set status = 'sent', response = 'pg_net request ' || req_id
        where alert_event_id = p_event_id and target = ch.target and status = 'queued';
      sent := sent + 1;
    exception when others then
      null; -- pas de pg_net (local) : dispatch via apps/ingest/dispatch-alerts.mjs
    end;
  end loop;
  return sent;
end $$;

-- ───────────────────────── 5) check_alerts : threshold + baseline + routing ─────────────────────────
create or replace function check_alerts() returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare r record; v double precision; fired int := 0; ev_id bigint; req_id bigint;
        b record; breached boolean; msg text; lo double precision; hi double precision;
begin
  for r in select * from alert_rule where active loop
    -- valeur courante observée (identique aux deux modes)
    if r.metric = 'error_rate' then
      select count(*)::float / greatest((select count(*) from rum_pageview p
               where p.app_id = r.app_id and (r.route is null or p.route = r.route)
                 and p.started_at > now() - (r.window_minutes || ' minutes')::interval), 1)
        into v from rum_error e
       where e.app_id = r.app_id and e.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or e.route = r.route);
    else
      select percentile_cont(0.75) within group (order by m.value) into v
        from rum_metric m
       where m.app_id = r.app_id and m.name = r.metric
         and m.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or m.route = r.route);
    end if;

    breached := false; msg := null;
    if v is not null then
      if r.mode = 'baseline' then
        select * into b from metric_baseline(r.app_id, r.metric, r.route, r.baseline_weeks);
        -- baseline exploitable : ≥ 4 échantillons saisonniers et dispersion non nulle
        if b.n >= 4 and b.mad is not null and b.mad > 0 then
          hi := b.med + r.sensitivity * b.mad;
          lo := b.med - r.sensitivity * b.mad;
          breached := (r.comparator = '>' and v > hi) or (r.comparator = '<' and v < lo);
          if breached then
            msg := format('%s %s %s anormal (normal≈%s, écart %sσ_MAD, fenêtre %s min, app %s%s)',
              r.metric, r.comparator, round(v::numeric,1), round(b.med::numeric,1),
              round((abs(v - b.med)/b.mad)::numeric,1), r.window_minutes, r.app_id,
              coalesce(', route ' || r.route, ''));
          end if;
        end if;
      else
        breached := (r.comparator = '>' and v > r.threshold) or (r.comparator = '<' and v < r.threshold);
        if breached then
          msg := format('%s %s %s (seuil %s, fenêtre %s min, app %s%s)',
            r.metric, r.comparator, round(v::numeric,1), r.threshold, r.window_minutes, r.app_id,
            coalesce(', route ' || r.route, ''));
        end if;
      end if;
    end if;

    if breached then
      -- dédup : pas d'événement non acquitté récent pour cette règle
      if not exists (select 1 from alert_event ae
                      where ae.rule_id = r.id and not ae.acknowledged
                        and ae.fired_at > now() - (r.window_minutes || ' minutes')::interval) then
        insert into alert_event (rule_id, value, message, severity)
        values (r.id, v, msg, r.severity) returning id into ev_id;
        fired := fired + 1;
        -- 1) webhook historique de la règle (rétro-compat)
        if r.webhook_url is not null then
          insert into alert_delivery (alert_event_id, target) values (ev_id, r.webhook_url);
          begin
            select net.http_post(url := r.webhook_url,
              body := jsonb_build_object('source','mip-rum','app_id',r.app_id,'metric',r.metric,
                'route',r.route,'value',round(v::numeric,1),'severity',r.severity,'text',msg))
              into req_id;
            update alert_delivery set status='sent', response='pg_net request '||req_id
              where alert_event_id = ev_id and target = r.webhook_url;
          exception when others then null; end;
        end if;
        -- 2) canaux de notification (routing par sévérité)
        perform route_alert(ev_id, r.app_id, r.severity,
          '[MIP RUM] ' || msg,
          jsonb_build_object('source','mip-rum','app_id',r.app_id,'metric',r.metric,
            'route',r.route,'value',round(v::numeric,1),'severity',r.severity,'text',msg));
      end if;
    end if;
  end loop;
  return fired;
end $$;

-- ───────────────────────── 6) check_slo_burn : burn rapide → alert_event ─────────────────────────
create or replace function check_slo_burn() returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare s record; fired int := 0; ev_id bigint; msg text;
begin
  for s in select * from slo_status() where fast_burn loop
    -- dédup : un burn non acquitté récent pour ce SLO suffit
    if not exists (select 1 from alert_event ae
                    where ae.slo_id = s.slo_id and not ae.acknowledged
                      and ae.fired_at > now() - interval '1 hour') then
      msg := format('SLO « %s » en burn rapide : atteinte %s%% (objectif %s%%, budget consommé %s%%, app %s%s)',
        s.name, round((s.attainment*100)::numeric,2), round((s.objective*100)::numeric,2),
        round(coalesce(s.burned_pct,0)::numeric,0), s.app_id, coalesce(', route ' || s.route, ''));
      insert into alert_event (slo_id, value, message, severity)
      values (s.slo_id, s.attainment, msg, 'critical') returning id into ev_id;
      fired := fired + 1;
      perform route_alert(ev_id, s.app_id, 'critical', '[MIP RUM] ' || msg,
        jsonb_build_object('source','mip-rum','app_id',s.app_id,'slo',s.name,
          'attainment',round(s.attainment::numeric,4),'severity','critical','text',msg));
    end if;
  end loop;
  return fired;
end $$;

-- ───────────────────────── 7) Accès console_ro (parité, motif #1) ─────────────────────────
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert, update, delete on slo to console_ro;
    grant usage, select on sequence slo_id_seq to console_ro;
    if not exists (select 1 from pg_policies where tablename='slo' and policyname='cro_all_slo') then
      create policy cro_all_slo on slo for all to console_ro using (true) with check (true);
    end if;
    grant select, insert, update, delete on notify_channel to console_ro;
    grant usage, select on sequence notify_channel_id_seq to console_ro;
    if not exists (select 1 from pg_policies where tablename='notify_channel' and policyname='cro_all_channel') then
      create policy cro_all_channel on notify_channel for all to console_ro using (true) with check (true);
    end if;
    -- self-suffisant si la parité v16 n'a pas (encore) tourné : alert_rule/alert_event
    grant select, insert, update, delete on alert_rule, alert_event to console_ro;
    if not exists (select 1 from pg_policies where tablename='alert_rule' and policyname='cro_all_alert_rule') then
      create policy cro_all_alert_rule on alert_rule for all to console_ro using (true) with check (true);
    end if;
    if not exists (select 1 from pg_policies where tablename='alert_event' and policyname='cro_all_alert_event') then
      create policy cro_all_alert_event on alert_event for all to console_ro using (true) with check (true);
    end if;
  end if;
end $$;

-- ───────────────────────── 8) Planification (pg_cron cloud) ─────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mip-slo-burn') then
      perform cron.unschedule('mip-slo-burn');
    end if;
    perform cron.schedule('mip-slo-burn', '*/5 * * * *', 'select check_slo_burn()');
  end if;
end $$;
