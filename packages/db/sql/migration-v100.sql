-- migration-v100 — Vague 4 (lot 4c, 29/09/2026) : les alertes sur toutes les
-- mesures qui ont une règle MIP (`apps/console/lib/seuils.ts`).
--
-- Additive et rejouable, PostgreSQL 15 à 17. Seule `check_alerts()` est
-- redéfinie : aucune table, aucune colonne, aucun index, aucune ligne touchée.
-- `create or replace` garde son propriétaire et ses droits (PUBLIC retiré,
-- `mip_console` accordé par v93).
--
-- NUMÉRO. v97 est la dernière migration de master au 29/09/2026 ; v98
-- (`vague1/donnees`) et v99 (`vague1/sondes`) sont réservées par deux PR non
-- encore fusionnées. Ce fichier ne dépend d'AUCUN objet qu'elles créent
-- (`agregat_filigrane`, `sonde_*`, `collecte_fenetre`) et aucune des deux ne
-- redéfinit `check_alerts` (vérifié sur leurs branches le 29/09/2026) : il passe
-- que v98 et v99 soient appliquées ou non. Il doit en revanche FUSIONNER APRÈS
-- elles : `scripts/ci/migrations-figees.mjs` refuse une migration ajoutée sous la
-- dernière de master.
--
-- D'OÙ REPART LA FONCTION. De sa dernière définition, `migration-v86.sql` (mode
-- `release`, B52), reprise à l'octet près. Seules différences, toutes bornées aux
-- métriques nouvelles :
--
--   1. DÉBIT DESCENDANT (`DOWNLINK`) au 25ᵉ CENTILE. C'est la seule mesure où BAS
--      est mauvais (`sens: "bas-mauvais"`, `statistique: "p25"` dans `SEUILS_MIP`) :
--      « 75 % des visites au-dessus de la borne » se lit sur le p25. Jusqu'ici la
--      branche générique en faisait un p75 — un site dont 70 % des visiteurs sont
--      sous 1 Mbit/s y était « bon ». La règle se pose avec le comparateur « < »,
--      que `alert_rule.comparator` porte depuis v02. Les AUTRES mesures de
--      `rum_metric` (REDIRECT, DNS, TCP, TLS, REQUEST, RESPONSE, RTT) sont déjà des
--      p75 de la branche générique : rien ne change pour elles ;
--
--   2. QUATRE DURÉES HORS `rum_metric`, au p75 :
--        `longtask_p75`  `rum_longtask.duration_ms`, entrées Long Tasks
--                        (`source` 'longtask', ou NULL : lignes antérieures au
--                        09/09/2026, écrites avant l'arrivée de LoAF) ;
--        `loaf_p75`      `rum_longtask.duration_ms`, entrées LoAF (`source` 'loaf').
--                        Les deux API ne sont jamais actives ensemble (v55) :
--                        les séparer ne compte aucun blocage deux fois ;
--        `resource_p75`  `rum_resource.duration_ms` — ressources DÉJÀ lentes ou
--                        bloquantes : le SDK n'envoie rien sous 300 ms ;
--        `api_p75`       `rum_span.duration_ms` des spans `front` : la durée d'un
--                        fetch/XHR vue du navigateur (`http.duration_ms`).
--      La DURÉE, pas le blocage (`blocking_ms`) : `SEUILS_MIP.LONGTASK` et `.LOAF`
--      notent une durée. Index : `idx_longtask_app` (app_id, ts),
--      `idx_resource_app_route` (app_id, route, ts), `rum_span_app_tier_ts_idx`
--      (app_id, tier, ts desc) ;
--
--   3. TROIS PARTS DE SESSIONS TOUCHÉES (0..1, comme `SEUILS_MIP`) :
--        `rage_rate`                  au moins un `frustration.rage` (`rum_event`) ;
--        `dead_rate`                  au moins un `frustration.dead` ;
--        `browser_error_session_rate` au moins une erreur NAVIGATEUR
--                                     (`error_source like 'browser\_%'`, la
--                                     population du SLO d'erreurs depuis v94).
--      Dénominateur : les sessions qui ont une page vue dans la fenêtre (et sur la
--      route de la règle), la base de `partSessionsTouchees`
--      (`apps/console/lib/queries-errors.ts`). Sans une seule, la règle rend
--      no_data et le dit — jamais un 0 % ;
--
--   4. SEUIL FIXE SEULEMENT pour les métriques des points 1 à 3 : l'écart à
--      l'habitude (`metric_baseline`) ne sait les calculer (il ferait un p75
--      horaire de `rum_metric`, donc un p75 de débit contre un p25, ou aucune
--      fenêtre du tout). La règle rend no_data en le disant ; la console refuse
--      déjà ce couple (`regleDesChamps`) ;
--
--   5. TROIS DÉCIMALES dans le message et la charge utile d'une part de sessions,
--      deux pour le débit : `round(v, 1)` écrivait « 0.1 » pour 5 % et « 0.0 »
--      pour 3 %. Toutes les autres métriques gardent leur décimale.
--
-- CE QUI NE CHANGE PAS, À DESSEIN. `error_rate` reste « occurrences de TOUTES les
-- sources ÷ pages vues » (v38 à v86), quand le SLO d'erreurs ne compte que les
-- erreurs navigateur depuis v94. L'incohérence est connue (29/09/2026) et
-- signalée dans la PR ; la trancher changerait le verdict de règles existantes,
-- ce n'est pas l'objet de ce fichier. Les trois modes, les familles `event:`,
-- `issue:`, `ai_cost`, `log_errors`, les Web Vitals et le mode `release` sont
-- repris tels quels.
--
-- FENÊTRE DE DÉPLOIEMENT. Tant que ce fichier n'est pas appliqué, une règle sur
-- une métrique nouvelle passe par la branche générique de v86 : p75 de
-- `rum_metric` sous un nom qui n'y existe pas, donc no_data « aucune mesure sur
-- la fenêtre » — jamais un faux déclenchement. `DOWNLINK` y serait un p75 le
-- temps du déploiement.
--
-- VERROUS. `create or replace function` ne verrouille aucune table. Le
-- `lock_timeout` court suit la règle du migrateur (`packages/db/migrate.mjs`).
set local lock_timeout = '3s';

-- ── check_alerts : reprise intégrale de migration-v86, plus les mesures MIP ──
-- Les ajouts sont marqués « v100 » ; tout le reste est v86 à l'octet près.
create or replace function check_alerts() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare r record; v double precision; fired int := 0; ev_id bigint; req_id bigint;
        b record; breached boolean; msg text; lo double precision; hi double precision;
        event_sample_rate double precision;
        issue uuid; observable timestamptz; no_data text; inserees int;
        rel_b text; rel_a text; p75_b double precision; p75_a double precision;
        n_b integer; n_a integer; ecart numeric; rel_detail text; autres_env text;
        -- v100 : décimales du message et de la charge utile ; population d'une part.
        decimales int; sessions_vues int; sessions_touchees int;
begin
  for r in select * from alert_rule where active order by id loop
    -- Sérialise deux schedulers concurrents règle par règle. L'ordre par id
    -- empêche aussi un interblocage quand plusieurs règles sont actives.
    perform pg_advisory_xact_lock(r.id);
    v := null; event_sample_rate := null; no_data := null; issue := null;
    rel_b := null; rel_a := null; p75_b := null; p75_a := null; n_b := 0; n_a := 0;
    ecart := null; rel_detail := null; autres_env := null;
    sessions_vues := null; sessions_touchees := null;
    -- v100 : une part de sessions (0..1) perdait tout à une décimale ; un débit
    -- (Mbit/s, arrondi au centième par le SDK) en garde deux.
    decimales := case when r.metric in ('rage_rate', 'dead_rate', 'browser_error_session_rate') then 3
                      when r.metric = 'DOWNLINK' then 2
                      else 1 end;
    if r.mode = 'release' then
      -- v86 (B52) : p75 de la release en service en prod contre celle qu'elle a
      -- remplacée, même fenêtre et mêmes prédicats que le mode seuil d'un vital.
      -- Aucun verdict sans deux releases déclarées en prod ni sans 100 mesures de
      -- chaque côté.
      if r.metric not in ('LCP', 'INP', 'CLS', 'FCP', 'TTFB') then
        no_data := 'régression de release : réservée aux Web Vitals (p75 de LCP, INP, CLS, FCP ou TTFB)';
      elsif coalesce(r.threshold, 0) <= 0 then
        no_data := 'régression de release : hausse tolérée non positive, aucune comparaison';
      else
        select max(x.version) filter (where x.rang = 1), max(x.p75) filter (where x.rang = 1),
               coalesce(max(x.mesures) filter (where x.rang = 1), 0),
               max(x.version) filter (where x.rang = 2), max(x.p75) filter (where x.rang = 2),
               coalesce(max(x.mesures) filter (where x.rang = 2), 0)
          into rel_b, p75_b, n_b, rel_a, p75_a, n_a
          from alert_release_p75(r.app_id, r.metric, r.route, r.window_minutes) x;
        if rel_b is null then
          -- Des marqueurs sous un autre env (« production ») ne sont pas devinés :
          -- la raison les nomme, pour que le geste soit évident.
          select string_agg(e.env, ', ' order by e.env) into autres_env
            from (select distinct left(m.env, 40) as env from deploy_marker m
                   where m.app_id = r.app_id and m.env <> 'prod' and m.ts <= now()
                     and m.version is not null and btrim(m.version) <> '') e;
          no_data := 'aucune release déclarée en prod par un marqueur de déploiement (POST /api/v1/deploys, env « prod ») : rien à comparer'
                     || coalesce(' ; marqueurs d''autres env, non comparés : ' || left(autres_env, 120), '');
        elsif rel_a is null then
          no_data := format('une seule release déclarée en prod (%s) : il en faut deux pour comparer', left(rel_b, 120));
        elsif n_b < 100 or n_a < 100 then
          no_data := format('effectif insuffisant sur la fenêtre : %s mesure(s) %s pour %s, %s pour %s ; 100 requises par release',
                            n_b, r.metric, left(rel_b, 60), n_a, left(rel_a, 60));
        elsif p75_a <= 0 then
          no_data := format('p75 %s nul pour %s : aucun écart relatif calculable', r.metric, left(rel_a, 120));
        else
          v := p75_b;
          ecart := round(((p75_b / p75_a - 1) * 100)::numeric);
          rel_detail := format('%s : p75 %s (%s mesures) contre %s : p75 %s (%s mesures), %s%s %% pour +%s %% tolérés',
                               left(rel_b, 60), round(p75_b::numeric, case when r.metric = 'CLS' then 3 else 0 end), n_b,
                               left(rel_a, 60), round(p75_a::numeric, case when r.metric = 'CLS' then 3 else 0 end), n_a,
                               case when ecart >= 0 then '+' else '' end, ecart, r.threshold);
        end if;
      end if;
    elsif r.metric = 'error_rate' then
      select coalesce(sum(e.occurrences), 0)::float / greatest((select count(*) from rum_pageview p
               where p.app_id = r.app_id and (r.route is null or p.route = r.route)
                 and p.started_at > now() - (r.window_minutes || ' minutes')::interval), 1)
        into v from rum_error e
       where e.app_id = r.app_id and e.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or e.route = r.route);
    elsif r.metric = 'ai_cost' then
      select coalesce(sum(a.cost_usd), 0)::float into v from rum_ai a
       where a.app_id = r.app_id and a.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or a.route = r.route);
    elsif r.metric = 'log_errors' then
      select count(*)::float into v from rum_log l
       where l.app_id = r.app_id and l.severity_num >= 17
         and l.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or l.route = r.route);
    elsif r.metric like 'event:%' then
      select count(*)::float, min(coalesce(s.sample_rate, 1))::double precision
        into v, event_sample_rate
        from rum_event_index i
        join rum_event e
          on i.kind = 'event' and e.app_id = i.app_id and e.span_id = i.source_span_id
        left join rum_session s
          on s.app_id = i.app_id and s.session_id = i.session_id
       where i.app_id = r.app_id and e.name = substring(r.metric from 7)
         and coalesce(e.event_type, 'custom') = 'custom'
         and i.ts > now() - (r.window_minutes || ' minutes')::interval
         and i.ts <= now()
         and (r.route is null or i.route = r.route);
    elsif r.metric like 'issue:%' then
      issue := substring(r.metric from 7)::uuid;
      observable := issue_metric_observable_since(r.app_id, issue);
      if observable is null then
        no_data := 'issue absente de l''app ou regroupement v2 inactif';
      elsif observable > now() - (r.window_minutes || ' minutes')::interval then
        no_data := 'fenêtre incomplète : issue observable depuis '
                   || to_char(observable at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC';
      else
        select w.occurrences, w.min_inclusion into v, event_sample_rate
          from issue_metric_window(r.app_id, issue, r.route, r.env,
                                   now() - (r.window_minutes || ' minutes')::interval, now()) w;
      end if;
    elsif r.mode = 'baseline' and r.metric in ('DOWNLINK', 'longtask_p75', 'loaf_p75', 'resource_p75', 'api_p75',
                                               'rage_rate', 'dead_rate', 'browser_error_session_rate') then
      -- v100 : `metric_baseline` ferait un p75 horaire de `rum_metric` — un p75 de
      -- débit contre un p25, ou aucune fenêtre pour les autres. Rien n'est calculé.
      no_data := format('%s : seuil fixe seulement, l''écart à l''habitude ne sait pas calculer cette mesure', r.metric);
    elsif r.metric = 'DOWNLINK' then
      -- v100 : bas = mauvais, donc le 25ᵉ centile (`SEUILS_MIP.DOWNLINK`, lib/seuils.ts).
      select percentile_cont(0.25) within group (order by m.value) into v from rum_metric m
       where m.app_id = r.app_id and m.name = 'DOWNLINK'
         and m.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or m.route = r.route);
    elsif r.metric in ('longtask_p75', 'loaf_p75') then
      -- v100 : la durée d'une entrée, séparée par l'API qui l'a vue (v55). NULL :
      -- lignes d'avant la distinction, toutes venues de l'API Long Tasks.
      select percentile_cont(0.75) within group (order by l.duration_ms) into v from rum_longtask l
       where l.app_id = r.app_id
         and l.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or l.route = r.route)
         and case when r.metric = 'loaf_p75' then l.source = 'loaf' else l.source is distinct from 'loaf' end;
    elsif r.metric = 'resource_p75' then
      select percentile_cont(0.75) within group (order by x.duration_ms) into v from rum_resource x
       where x.app_id = r.app_id and x.duration_ms is not null
         and x.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or x.route = r.route);
    elsif r.metric = 'api_p75' then
      -- v100 : un span `front` est un fetch/XHR vu du navigateur (http.client).
      select percentile_cont(0.75) within group (order by sp.duration_ms) into v from rum_span sp
       where sp.app_id = r.app_id and sp.tier = 'front'
         and sp.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or sp.route = r.route);
    elsif r.metric in ('rage_rate', 'dead_rate') then
      -- v100 : part des sessions vues dans la fenêtre qui ont au moins un clic
      -- rageur (ou mort) dans la même fenêtre, sur la même route.
      select count(*)::int, count(t.session_id)::int into sessions_vues, sessions_touchees
        from (select distinct p.session_id from rum_pageview p
               where p.app_id = r.app_id and p.session_id is not null
                 and p.started_at > now() - (r.window_minutes || ' minutes')::interval
                 and (r.route is null or p.route = r.route)) vues
        left join (select distinct e.session_id from rum_event e
                    where e.app_id = r.app_id and e.session_id is not null
                      and e.name = case when r.metric = 'rage_rate' then 'frustration.rage' else 'frustration.dead' end
                      and e.ts > now() - (r.window_minutes || ' minutes')::interval
                      and (r.route is null or e.route = r.route)) t on t.session_id = vues.session_id;
      if sessions_vues > 0 then
        v := sessions_touchees::float / sessions_vues;
      else
        no_data := 'aucune session avec une page vue sur la fenêtre : part incalculable';
      end if;
    elsif r.metric = 'browser_error_session_rate' then
      -- v100 : même population, touchée par au moins une erreur NAVIGATEUR (v94).
      select count(*)::int, count(t.session_id)::int into sessions_vues, sessions_touchees
        from (select distinct p.session_id from rum_pageview p
               where p.app_id = r.app_id and p.session_id is not null
                 and p.started_at > now() - (r.window_minutes || ' minutes')::interval
                 and (r.route is null or p.route = r.route)) vues
        left join (select distinct e.session_id from rum_error e
                    where e.app_id = r.app_id and e.session_id is not null
                      and e.error_source like 'browser\_%'
                      and e.ts > now() - (r.window_minutes || ' minutes')::interval
                      and (r.route is null or e.route = r.route)) t on t.session_id = vues.session_id;
      if sessions_vues > 0 then
        v := sessions_touchees::float / sessions_vues;
      else
        no_data := 'aucune session avec une page vue sur la fenêtre : part incalculable';
      end if;
    else
      select percentile_cont(0.75) within group (order by m.value) into v from rum_metric m
       where m.app_id = r.app_id and m.name = r.metric
         and m.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or m.route = r.route);
    end if;

    breached := false; msg := null;
    if r.mode = 'release' then
      -- Règle de assessRegression (queries-deploys.ts) : régression dès que la
      -- récente atteint la précédente × (1 + seuil) ; comparé en numeric.
      if no_data is null then
        breached := p75_b::numeric >= p75_a::numeric * (1 + r.threshold::numeric / 100);
        if breached then
          msg := format('%s p75 en hausse de %s %% d''une release à l''autre : %s = %s contre %s = %s (seuil +%s %%, %s et %s mesures, fenêtre %s min, app %s%s) — même fenêtre, sans normalisation de trafic : l''écart mêle le code et le contexte',
            r.metric, ecart, left(rel_b, 120), round(p75_b::numeric, case when r.metric = 'CLS' then 3 else 0 end),
            left(rel_a, 120), round(p75_a::numeric, case when r.metric = 'CLS' then 3 else 0 end),
            r.threshold, n_b, n_a, r.window_minutes, r.app_id, coalesce(', route ' || left(r.route, 200), ''));
        end if;
      end if;
    elsif v is null then
      no_data := coalesce(no_data, 'aucune mesure sur la fenêtre');
    elsif r.mode = 'baseline' then
      if r.metric like 'event:%' then
        select * into b from event_metric_baseline(
          r.app_id, r.metric, r.route, r.baseline_weeks, r.window_minutes
        );
      elsif r.metric like 'issue:%' then
        select * into b from issue_metric_baseline(
          r.app_id, issue, r.route, r.env, r.baseline_weeks, r.window_minutes
        );
      else
        select * into b from metric_baseline(r.app_id, r.metric, r.route, r.baseline_weeks);
      end if;
      if b.n >= 4 and b.mad is not null then
        hi := b.med + r.sensitivity * b.mad;
        lo := b.med - r.sensitivity * b.mad;
        -- Une série parfaitement stable (souvent zéro pour un événement rare)
        -- a MAD=0 : le moindre écart dans le sens demandé est alors anormal.
        breached := (r.comparator = '>' and v > hi) or (r.comparator = '<' and v < lo);
        if breached then
          msg := case when b.mad > 0 then
            format('%s %s %s anormal (normal≈%s, écart %sσ_MAD, fenêtre %s min, app %s%s)',
              r.metric, r.comparator, round(v::numeric,1), round(b.med::numeric,1),
              round((abs(v - b.med)/b.mad)::numeric,1), r.window_minutes, r.app_id,
              coalesce(', route ' || left(r.route, 200), ''))
          else
            format('%s %s %s anormal (normal stable≈%s, MAD=0, fenêtre %s min, app %s%s)',
              r.metric, r.comparator, round(v::numeric,1), round(b.med::numeric,1),
              r.window_minutes, r.app_id, coalesce(', route ' || left(r.route, 200), ''))
          end;
        end if;
      else
        no_data := format('%s fenêtre(s) comparable(s), 4 requises', coalesce(b.n, 0));
      end if;
    else
      breached := (r.comparator = '>' and v > r.threshold) or (r.comparator = '<' and v < r.threshold);
      if breached then
        msg := format('%s %s %s (seuil %s, fenêtre %s min, app %s%s)',
          r.metric, r.comparator, round(v::numeric, decimales), r.threshold, r.window_minutes, r.app_id,
          coalesce(', route ' || left(r.route, 200), ''));
      end if;
    end if;

    if breached and r.metric like 'event:%' and event_sample_rate > 0 and event_sample_rate < 1 then
      msg := msg || format(
        ' — comptes observés sur un échantillon (taux minimal %s%%), sans extrapolation',
        round((event_sample_rate * 100)::numeric, 1)
      );
    elsif breached and r.metric like 'issue:%' then
      msg := msg || coalesce(' — env ' || r.env, '');
      if event_sample_rate > 0 and event_sample_rate < 1 then
        msg := msg || format(
          ' — occurrences observées sur un échantillon (probabilité d''inclusion minimale %s%%), sans extrapolation',
          round((event_sample_rate * 100)::numeric, 1)
        );
      end if;
    end if;

    update alert_rule
       set last_evaluated_at = now(),
           last_state = case when no_data is not null then 'no_data' when breached then 'breached' else 'ok' end,
           last_value = v,
           last_reason = left(coalesce(no_data, rel_detail), 300)
     where id = r.id;

    if breached and r.metric like 'issue:%' then
      if not exists (select 1 from alert_event ae
                      where ae.rule_id = r.id and not ae.acknowledged
                        and ae.fired_at > now() - (r.window_minutes || ' minutes')::interval)
         and not exists (select 1 from error_issue_notification n
                          where n.rule_id = r.id and n.state = 'pending') then
        insert into error_issue_notification (app_id, issue_id, kind, rule_id, event_key, payload)
        values (
          r.app_id, issue, 'spike', r.id,
          format('spike:%s:%s', r.id, floor(extract(epoch from now()) / (r.window_minutes * 60))::bigint),
          jsonb_build_object(
            'source', 'mip-rum', 'kind', 'spike', 'app_id', r.app_id, 'issue_id', issue, 'metric', r.metric,
            'route', left(r.route, 200), 'env', r.env, 'value', round(v::numeric, 1), 'severity', r.severity,
            'text', '[MIP RUM] ' || left(msg, 1500))
        )
        on conflict (event_key) do nothing;
        get diagnostics inserees = row_count;
        fired := fired + inserees;
      end if;
    elsif breached and not exists (select 1 from alert_event ae
                      where ae.rule_id = r.id and not ae.acknowledged
                        and ae.fired_at > now() - (r.window_minutes || ' minutes')::interval) then
      insert into alert_event (rule_id, value, message, severity)
      values (r.id, v, msg, r.severity) returning id into ev_id;
      fired := fired + 1;
      if r.webhook_url is not null then
        insert into alert_delivery (alert_event_id, target) values (ev_id, r.webhook_url);
        begin
          select net.http_post(url := r.webhook_url,
            body := jsonb_build_object('source','mip-rum','app_id',r.app_id,'metric',r.metric,
              'route',r.route,'value',round(v::numeric, decimales),'severity',r.severity,'text',msg))
            into req_id;
          update alert_delivery set status='sent', response='pg_net request '||req_id
            where alert_event_id = ev_id and target = r.webhook_url;
        exception when others then null; end;
      end if;
      perform route_alert(ev_id, r.app_id, r.severity, '[MIP RUM] ' || msg,
        jsonb_build_object('source','mip-rum','app_id',r.app_id,'metric',r.metric,
          'route',r.route,'value',round(v::numeric, decimales),'severity',r.severity,'text',msg));
    end if;
  end loop;
  return fired;
end $function$;

comment on function check_alerts() is
  'Évalue les règles d''alerte actives (v100) : vitals et phases réseau au p75 de rum_metric, DOWNLINK au p25, '
  'longtask_p75 / loaf_p75 / resource_p75 / api_p75 au p75 de leur table, rage_rate / dead_rate / '
  'browser_error_session_rate en part des sessions vues, plus error_rate, log_errors, event:, issue: et le mode release (v86).';
