-- migration-v105 — Deux suites des sondes de la chaîne de mesure (v103) : l'état
-- « hors collecte » des règles d'alerte, et le battement attendu par application.
--
-- Additive et rejouable, PostgreSQL 15 à 17. Refonte du monitoring, lots L3 et L5
-- de l'étude des sondes (30/09/2026). Aucune table créée, aucune ligne de données
-- touchée : une contrainte élargie, `check_alerts()` redéfinie, trois fonctions
-- nouvelles.
--
-- 1. « HORS COLLECTE » POUR LES RÈGLES D'ALERTE. Jusqu'ici,
--    `alert_rule.last_state = 'no_data'` disait « aucune mesure sur la fenêtre »
--    sans distinguer « rien reçu » de « rien ne s'est passé ». Pendant la coupure
--    du 24 au 27/09/2026, une règle aurait conclu « normale » sur une fenêtre où
--    rien n'était mesuré, ou, au retour, « franchie » sur une fenêtre à moitié
--    vide. Désormais, quand la fenêtre d'évaluation d'une règle recoupe une
--    fenêtre `interrompue` du registre (`collecte_fenetre`, étage `chaine`, portée
--    `'*'` ou l'application de la règle), l'état devient `hors_collecte`, la raison
--    date la fenêtre et en donne la cause, et AUCUNE alerte ne part : ni
--    déclenchement, ni retour à la normale. Une fenêtre seulement `degradee` ne
--    suspend rien : la mesure y arrive, par un seul chemin ou lentement.
--
--    D'OÙ REPART LA FONCTION. De sa dernière définition, `migration-v100.sql`,
--    reprise à l'octet près. Seuls ajouts, marqués « v105 » : la variable `hc` et
--    le bloc qui, en tête de chaque règle, lit le registre et passe à la suivante.
--    Le registre tient quelques lignes par mois : la lecture par
--    `collecte_fenetre_portee_debut_idx` ne coûte rien à côté des calculs évités.
--
-- 2. LE BATTEMENT ATTENDU PAR APPLICATION (`sonde_attendue`, v103). Une application
--    peut déclarer un signal régulier : aujourd'hui un span serveur sur une route
--    (`signal = 'span_route'`). Le scheduler (`packages/backend/jobs/sondes.mjs`,
--    `traiterBattements`) lit, à chaque tick, par `sonde_etat_battements` : le
--    dernier span de la route et le nombre reçu depuis `tolerance_min` minutes,
--    par l'index `rum_span_back_route_idx (app_id, route, ts desc) where tier =
--    'back'` (v04). S'ils manquent alors que la chaîne de la plateforme est `ok`,
--    l'interruption est PROPRE à l'application : `sonde_ouvrir_battement` ouvre
--    une fenêtre `interrompue` à sa portée (étage `chaine` : ses graphiques sont
--    hachurés et ses règles passent « hors collecte », comme pour la plateforme),
--    cause « l'application n'émet plus son battement », et lève UNE alerte pour
--    l'épisode (`sonde_alerter`, v103). `sonde_fermer_battement` la ferme au
--    premier battement revenu.
--
--    PAS DE LIGNE DÉCLARÉE ICI. L'étude A3 décrit un battement de fait de
--    `gip-plateforme` (une sonde externe sur `/health/db`, toutes les 15 min), lu
--    en production par une requête d'étude. Rien dans ce dépôt ne le porte : ni
--    code, ni test, ni document (le backend de l'application est hors dépôt), et
--    la requête d'étude hésite elle-même entre la route et le nom du span. Un
--    battement déclaré qui n'arrive jamais sous cette route ne lèverait rien (un
--    battement jamais reçu n'ouvre aucune fenêtre) ; mais une sonde externe qui
--    s'arrête pour une raison étrangère à la collecte hachurerait l'application
--    et suspendrait ses règles. La ligne se pose donc à la main, une fois la
--    route relue en base.
--
-- VERROUS. `alter table alert_rule` (contrainte redéfinie) prend un ACCESS
-- EXCLUSIVE bref sur une table de quelques lignes ; la validation relit la table.
-- `create or replace function` ne verrouille aucune table. `lock_timeout` : s'il
-- expire, le migrateur annule le fichier et le rejoue.
set local lock_timeout = '3s';

-- ── 1. `hors_collecte`, un état admis ───────────────────────────────────────
--
-- La contrainte de v73 porte aussi la forme des règles `issue:` et de `env` :
-- elle est reposée à l'identique, un état en plus.
alter table alert_rule drop constraint if exists alert_rule_issue_metric_v73;
alter table alert_rule add constraint alert_rule_issue_metric_v73 check (
  (metric not like 'issue:%' or
   substring(metric from 7) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') and
  (env is null or (metric like 'issue:%' and char_length(env) between 1 and 120 and env !~ '[[:cntrl:]]')) and
  (last_state is null or last_state in ('ok', 'breached', 'no_data', 'hors_collecte')) and
  (last_reason is null or char_length(last_reason) <= 300)
);

comment on column alert_rule.last_state is
  'Dernière évaluation par check_alerts : ok, breached, no_data (données insuffisantes, jamais un zéro) '
  'ou hors_collecte (v105 : la fenêtre recoupe une collecte interrompue, aucune alerte ne part)';

-- ── 2. check_alerts : reprise intégrale de migration-v100, plus « hors collecte » ──
-- Les ajouts sont marqués « v105 » ; tout le reste est v100 à l'octet près.
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
        -- v105 : la fenêtre de collecte interrompue qui recoupe celle de la règle.
        hc record;
begin
  for r in select * from alert_rule where active order by id loop
    -- Sérialise deux schedulers concurrents règle par règle. L'ordre par id
    -- empêche aussi un interblocage quand plusieurs règles sont actives.
    perform pg_advisory_xact_lock(r.id);
    v := null; event_sample_rate := null; no_data := null; issue := null;
    rel_b := null; rel_a := null; p75_b := null; p75_a := null; n_b := 0; n_a := 0;
    ecart := null; rel_detail := null; autres_env := null;
    sessions_vues := null; sessions_touchees := null;
    -- v105 : une fenêtre d'évaluation qui recoupe une collecte INTERROMPUE (la
    -- plateforme, ou l'application de la règle) ne prouve rien : « rien reçu » n'y
    -- est pas « rien ne s'est passé ». Aucun calcul, AUCUNE alerte — ni
    -- déclenchement, ni retour à la normale — et l'état dit pourquoi, fenêtre datée.
    select f.portee, f.debut, f.fin, f.cause into hc
      from collecte_fenetre f
     where f.etage = 'chaine' and f.etat = 'interrompue'
       and f.portee in ('*', r.app_id)
       and f.debut < now()
       and coalesce(f.fin, 'infinity'::timestamptz) > now() - (r.window_minutes || ' minutes')::interval
     order by f.fin is null desc, f.fin desc, f.debut desc
     limit 1;
    if found then
      update alert_rule
         set last_evaluated_at = now(),
             last_state = 'hors_collecte',
             last_value = null,
             last_reason = left(format('collecte interrompue %s %s%s',
                 case when hc.portee = '*' then 'sur la plateforme' else 'pour cette application' end,
                 case when hc.fin is null
                      then format('depuis le %s UTC (en cours)', to_char(hc.debut at time zone 'UTC', 'DD/MM/YYYY HH24:MI'))
                      else format('du %s au %s UTC', to_char(hc.debut at time zone 'UTC', 'DD/MM/YYYY HH24:MI'),
                                  to_char(hc.fin at time zone 'UTC', 'DD/MM/YYYY HH24:MI')) end,
                 coalesce(' : ' || hc.cause, '')), 300)
       where id = r.id;
      continue;
    end if;
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
  'browser_error_session_rate en part des sessions vues, plus error_rate, log_errors, event:, issue: et le mode release (v86). '
  'v105 : une fenêtre qui recoupe une collecte interrompue (collecte_fenetre) rend hors_collecte, sans alerte.';

-- ── 3. Le battement attendu par application ─────────────────────────────────
--
-- Les faits en UNE requête, une ligne par battement déclaré actif : le dernier
-- span de la route (horizon 7 jours) et le compte reçu depuis `tolerance_min`,
-- tous deux par `rum_span_back_route_idx` (le prédicat `tier = 'back'` est
-- celui de l'index partiel) ; plus la fenêtre de sonde ouverte de l'application.
-- Une application inactive, sonde, ou dont l'ingestion est suspendue n'est pas
-- jugée : son silence est voulu. La décision est prise par le scheduler
-- (`decisionBattement`, testée sans base).
create or replace function sonde_etat_battements()
returns table (
  app_id text, route text, cadence_min int, tolerance_min int,
  dernier timestamptz, recents int, fenetre_id bigint, fenetre_debut timestamptz
) language sql stable set search_path = public, pg_temp as $$
  select a.app_id, a.route, a.cadence_min::int, a.tolerance_min::int, d.ts, coalesce(n.recents, 0), f.id, f.debut
    from sonde_attendue a
    join app_registry r on r.app_id = a.app_id
    left join lateral (
      select s.ts from rum_span s
       where s.app_id = a.app_id and s.tier = 'back' and s.route = a.route
         and s.ts > now() - interval '7 days'
         -- Une horloge en avance ne doit pas masquer une absence.
         and s.ts <= now() + interval '5 minutes'
       order by s.ts desc limit 1
    ) d on true
    left join lateral (
      select count(*)::int as recents from rum_span s
       where s.app_id = a.app_id and s.tier = 'back' and s.route = a.route
         and s.ts > now() - make_interval(mins => a.tolerance_min::int)
         and s.ts <= now() + interval '5 minutes'
    ) n on true
    left join collecte_fenetre f
      on f.portee = a.app_id and f.etage = 'chaine' and f.fin is null and f.source = 'sonde'
   where a.active and a.signal = 'span_route'
     and r.active and not r.sonde
     -- `to_jsonb` : la colonne vient de v81 ; la lire ainsi ne casse rien.
     and (to_jsonb(r) ->> 'ingestion_suspended_at') is null
   order by a.app_id, a.route
$$;

-- Ouvre la fenêtre `interrompue` d'une application, datée de son dernier
-- battement, et lève son alerte — une seule : la fenêtre ouverte est unique par
-- (portée, étage), un second appel ne trouve rien à ouvrir. Rend l'alerte.
--
-- Les faits sont RELUS ici, pas reçus du scheduler : le dernier battement garde
-- sa précision (la microseconde, que JavaScript perd, fait qu'un battement déjà
-- vu passerait pour revenu à la fermeture), et un battement arrivé entre la
-- lecture et l'ouverture n'ouvre rien.
create or replace function sonde_ouvrir_battement(p_app_id text, p_preuve text)
returns bigint language plpgsql set search_path = public, pg_temp as $$
declare fid bigint; msg text; v_dernier timestamptz; v_recents int;
begin
  select max(b.dernier), coalesce(sum(b.recents), 0) into v_dernier, v_recents
    from sonde_etat_battements() b where b.app_id = p_app_id;
  if v_dernier is null or v_recents > 0 then
    return null;
  end if;
  insert into collecte_fenetre (portee, etage, etat, debut, cause, preuve, source)
  values (p_app_id, 'chaine', 'interrompue', least(v_dernier, now()),
          'l''application n''émet plus son battement', left(p_preuve, 300), 'sonde')
  on conflict (portee, etage) where fin is null do nothing
  returning id into fid;
  if fid is null then
    return null;
  end if;
  msg := format('Collecte interrompue — app %s : l''application n''émet plus son battement, '
                'alors que la chaîne de mesure est en service (%s)', p_app_id, coalesce(p_preuve, 'sans détail'));
  return sonde_alerter(fid, p_app_id, 'warning', msg,
                       jsonb_build_object('kind', 'battement_absent', 'dernier_battement', v_dernier, 'text', msg));
end $$;

-- Ferme la fenêtre de battement au premier battement revenu (sinon maintenant).
create or replace function sonde_fermer_battement(p_fenetre_id bigint)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare f record; retour timestamptz;
begin
  select id, portee, debut into f from collecte_fenetre
   where id = p_fenetre_id and etage = 'chaine' and source = 'sonde' and fin is null for update;
  if f.id is null then
    return false;
  end if;
  select min(x.ts) into retour
    from sonde_attendue a
    cross join lateral (
      select s.ts from rum_span s
       where s.app_id = a.app_id and s.tier = 'back' and s.route = a.route and s.ts > f.debut
       order by s.ts limit 1
    ) x
   where a.app_id = f.portee and a.active and a.signal = 'span_route';
  update collecte_fenetre
     set fin = greatest(least(coalesce(retour, now()), now()), f.debut + interval '1 second'), updated_at = now()
   where id = f.id;
  return true;
end $$;

-- Écritures : exécutées par le scheduler (propriétaire) seulement, comme v103.
do $$
declare fn text;
begin
  foreach fn in array array[
    'sonde_ouvrir_battement(text, text)',
    'sonde_fermer_battement(bigint)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
  end loop;
end $$;

comment on function sonde_etat_battements() is
  'Battements attendus (v105) : par ligne active de sonde_attendue, dernier span de la route, compte depuis '
  'tolerance_min et fenêtre de sonde ouverte de l''application.';
comment on function sonde_ouvrir_battement(text, text) is
  'Ouvre la fenêtre interrompue d''une application muette (battement absent) et lève UNE alerte (v105).';
