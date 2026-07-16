-- migration-v38 — Deux nouvelles métriques d'alerte : `ai_cost` (budget IA) et
-- `log_errors` (pics d'erreurs applicatives). Étend le moteur d'alerte EXISTANT
-- (check_alerts / metric_baseline) plutôt que d'en créer un parallèle : mêmes
-- modes (threshold ET baseline saisonnier), même dédup, même routage par
-- sévérité, mêmes canaux. Un client peut ainsi poser « alerte si coût IA >
-- 10 $/jour » (threshold, fenêtre 1440 min) ou « erreurs anormales vs
-- d'habitude » (baseline).
--
-- Sémantique des deux nouvelles métriques :
--   • ai_cost     = somme cost_usd (rum_ai) sur la fenêtre. Comparateur '>'
--                   attendu (dépassement de budget).
--   • log_errors  = nombre de logs ERROR (rum_log, severity_num >= 17) sur la
--                   fenêtre. Comparateur '>' attendu.
-- Ce sont des métriques de COMPTAGE (pas des p75) : le mode baseline remplit
-- donc les heures sans activité à 0 (generate_series) — sinon la médiane
-- saisonnière serait biaisée vers le haut (n'échantillonnant que les heures
-- actives). Une heure typiquement calme -> mad = 0 -> check_alerts ne déclenche
-- pas (garde `mad > 0` déjà en place) : comportement sûr.
--
-- IMPORTANT : ces deux métriques ne sont PAS des cibles de SLO (le modèle SLO
-- est « % de mesures conformes », incompatible avec un coût/compte absolu).
-- Côté console, SLO_METRICS reste la liste d'origine ; slo_status() n'est donc
-- pas touchée. Fonctions recréées à l'identique de la prod + branches ajoutées
-- (SECURITY DEFINER, search_path figé conservés).

-- ─────────────────────── check_alerts() ───────────────────────
create or replace function check_alerts() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
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
    elsif r.metric = 'ai_cost' then
      select coalesce(sum(a.cost_usd), 0)::float into v
        from rum_ai a
       where a.app_id = r.app_id and a.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or a.route = r.route);
    elsif r.metric = 'log_errors' then
      select count(*)::float into v
        from rum_log l
       where l.app_id = r.app_id and l.severity_num >= 17
         and l.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or l.route = r.route);
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
end $function$;

-- ─────────────────────── metric_baseline() ───────────────────────
-- Ajoute les branches ai_cost / log_errors (comptage -> zero-fill des heures
-- inactives). Les branches error_rate et p75 (else) sont identiques à la prod.
create or replace function metric_baseline(p_app_id text, p_metric text, p_route text, p_weeks integer)
  returns table(med double precision, mad double precision, n integer)
  language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
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
  elsif p_metric = 'ai_cost' then
    return query
    with span as (
      select generate_series(lo, hi - interval '1 hour', interval '1 hour') as h
    ), raw as (
      select date_trunc('hour', ts) h, sum(cost_usd)::float c from rum_ai
      where app_id = p_app_id and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), hourly as (
      select span.h, coalesce(raw.c, 0) as val from span left join raw using (h)
    ), seasonal as (
      select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())
    ), m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m),
           percentile_cont(0.5) within group (order by abs(val - (select v from m))),
           count(*)::int
    from seasonal;
  elsif p_metric = 'log_errors' then
    return query
    with span as (
      select generate_series(lo, hi - interval '1 hour', interval '1 hour') as h
    ), raw as (
      select date_trunc('hour', ts) h, count(*)::float c from rum_log
      where app_id = p_app_id and severity_num >= 17 and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), hourly as (
      select span.h, coalesce(raw.c, 0) as val from span left join raw using (h)
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
end $function$;

-- Les grants d'EXECUTE (service_role, console_ro ; révocation anon/authenticated)
-- de la migration-v34 sont préservés par `create or replace` (ils portent sur
-- l'objet fonction, pas sur son corps). Rien à re-grant ici.
