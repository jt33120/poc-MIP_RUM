-- migration-v86 — B52 : alerte de régression de release (mode `release` de check_alerts).
--
-- Additive et rejouable, PostgreSQL 15 à 17. S'applique APRÈS migration-v73
-- (alert_rule.last_*) et migration-v75 (rum_metric.release), et refuse de
-- s'appliquer sans elles. v85 est le dernier fichier existant (P8.7) ; `pending/`
-- ne tient que v44 : ce fichier prend v86.
--
-- ═══════════════════════════════ 1. CE QUE FAIT CE MODE ═════════════════════
--
-- Une règle `mode = 'release'` compare le p75 d'un Web Vital de la release LA
-- PLUS RÉCENTE à celui de la release PRÉCÉDENTE, sur la MÊME fenêtre (celle de la
-- règle), avec les mêmes prédicats que le mode seuil d'un vital : app, nom de la
-- mesure, route, `ts > now() − fenêtre`. Elle se franchit quand
-- p75(récente) ≥ p75(précédente) × (1 + seuil / 100) — la règle exacte de
-- `assessRegression` (apps/console/lib/queries-deploys.ts, ratio 1,2). Le seuil
-- est stocké EN POUR CENT dans `alert_rule.threshold` : 20 veut dire +20 %, la
-- valeur par défaut de la console (plan § 3.2).
--
-- QUELLE RELEASE EST « LA PLUS RÉCENTE ». Celle du DERNIER marqueur de
-- déploiement déclaré en prod (`deploy_marker`, POST /api/v1/deploys) : la
-- release en service. La PRÉCÉDENTE est celle du dernier marqueur antérieur qui
-- porte une AUTRE version : la release en service juste avant. Un retour arrière
-- est donc un déploiement comme un autre — 1.0, 1.1, retour à 1.0, puis 1.1.1 :
-- 1.1.1 se compare à 1.0, pas à la 1.1 retirée — et redéployer la release en
-- service ne change pas la précédente. Deux marqueurs au même instant se
-- départagent par leur identifiant (le dernier déclaré), jamais par l'ordre
-- lexical des versions (« 1.9.0 » > « 1.10.0 »).
--
-- UN SEUL ENVIRONNEMENT : 'prod', la valeur par défaut de `deploy_marker.env`
-- (POST /api/v1/deploys sans `env`). Mêler les environnements daterait une
-- release de son passage en recette : 3.1.0 en recette, 3.0.9 (un correctif) en
-- prod, puis 3.1.0 promue en prod — 3.1.0 se compare à 3.0.9, et non l'inverse.
-- 'prod' plutôt que l'env du dernier marqueur : un déploiement en recette ne
-- détourne pas la règle de la production le temps de sa promotion. Une app qui
-- déclare ses mises en production sous un autre nom (« production ») n'est pas
-- devinée : la règle rend no_data, et sa raison nomme les env trouvés.
--
-- L'ordre suit les MARQUEURS, jamais les mesures : l'ordre de première mesure vue
-- a été écarté, car sur une fenêtre courte deux releases présentes dès son début
-- s'y départagent au hasard, et un onglet resté ouvert sur une vieille version
-- ne la rajeunit pas. Sans marqueur en prod, l'ordre des releases n'est pas
-- connu : la règle le dit au lieu de le deviner.
--
-- ═══════════════════════ 2. JAMAIS DE VERDICT SANS EFFECTIF ══════════════════
--
-- La règle rend `no_data`, avec sa raison, et n'écrit aucune valeur quand :
--   · la métrique n'est pas un Web Vital (le p75 n'a de sens que pour eux) ;
--   · moins de deux releases sont déclarées en prod ;
--   · l'une des deux compte moins de 100 mesures sur la fenêtre — le seuil sous
--     lequel la console refuse déjà tout écart entre deux p75 (`KpiTile`,
--     `FAIBLE_SOUS_DEFAUT`, plan § 3.12) ; un test unitaire lie les deux nombres ;
--   · le p75 de la précédente vaut 0 (un CLS parfait) : aucun écart relatif.
-- Une release sans mesure n'est pas une release à 0 ms.
--
-- Évaluée ou non, la règle dit CE QU'ELLE A COMPARÉ : `last_reason` porte la
-- raison du `no_data` comme avant, et, pour ce mode seulement, le détail de la
-- comparaison (releases, p75, effectifs, écart) quand elle a pu juger. Le message
-- d'un déclenchement finit par la phrase du plan (§ 3.2) : « même fenêtre, sans
-- normalisation de trafic : l'écart mêle le code et le contexte ».
--
-- LIMITES DITES. Seuls les MARQUEURS sont lus en prod ; les MESURES ne sont pas
-- filtrées par environnement (l'env du SDK, `rum_metric.env`, ne porte pas
-- forcément le nom de celui des marqueurs, et la colonne `env` d'une règle est
-- réservée aux issues depuis v73) : une release encore servie en recette pendant
-- la fenêtre y compte aussi ses mesures de recette. Aucune pondération par route
-- ni appareil.
--
-- ═════════════════════════ 3. FENÊTRE DE DÉPLOIEMENT ════════════════════════
--
--   · Code antérieur sur une base v86 : `check_alerts()` garde sa signature (le
--     tick de planifie.mjs, pg_cron et « Évaluer maintenant » l'appellent
--     inchangés) ; `alert_delivery` et `alert_event` ne bougent pas
--     (dispatch-alerts.mjs lit les mêmes colonnes) ; l'ancienne console ne sait
--     pas créer ce mode (`ALERT_MODES` le refuse) et lit `alert_rule` comme avant.
--   · Nouvelle console sur une base v85 : elle détecte l'absence de
--     `alert_release_p75` (`to_regprocedure`) et garde l'option désactivée avec
--     sa raison ; son action serveur REFUSE d'écrire une règle `release` — sans
--     quoi le check_alerts de v73 la prendrait pour un seuil fixe (LCP > 20 ms).
--
-- ══════════════════════════ 4. VERROUS, INDEX, DONNÉES ══════════════════════
--
-- Aucune donnée réécrite, aucune table créée, aucun index. Une contrainte NOT
-- VALID sur `alert_rule` (petite table, verrou bref) ; deux fonctions remplacées
-- ou créées. La lecture par release passe par le même index (name, ts) que le
-- mode seuil d'un vital, deux fois sur la fenêtre de la règle ; les marqueurs par
-- `deploy_marker_app_ts`. `lock_timeout` borne chaque attente ; s'il expire, le
-- fichier entier est annulé et le déploiement rejoué.
set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'alert_rule' and column_name = 'last_state') then
    raise exception 'v86 : migration-v73 (alert_rule.last_state) doit être appliquée avant ce fichier';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'rum_metric' and column_name = 'release') then
    raise exception 'v86 : migration-v75 (rum_metric.release) doit être appliquée avant ce fichier';
  end if;
end $$;

-- ── 1. Une règle de release ne porte que sur un Web Vital ───────────────────
-- NOT VALID : aucune ligne existante n'est relue (l'ancienne console refusait ce
-- mode). Les lignes écrites ou modifiées désormais y sont soumises. check_alerts
-- garde sa propre garde (no_data), défense en profondeur.
alter table alert_rule drop constraint if exists alert_rule_release_v86;
alter table alert_rule add constraint alert_rule_release_v86 check (
  mode <> 'release' or (metric in ('LCP', 'INP', 'CLS', 'FCP', 'TTFB') and threshold > 0)
) not valid;

comment on column alert_rule.mode is
  'threshold (seuil fixe), baseline (écart à l''habitude) ou release (v86 : p75 de la release la plus récente contre la précédente)';
comment on column alert_rule.threshold is
  'Seuil fixe du mode threshold ; en mode release (v86), hausse tolérée du p75 EN POUR CENT (20 = +20 %)';
comment on column alert_rule.last_reason is
  'Raison du dernier no_data ; en mode release (v86), aussi le détail de la comparaison quand la règle a pu juger';

-- ── 2. La release en service en prod, celle d'avant, et leur p75 ─────────────
-- Rang 1 = la version du dernier marqueur déclaré en prod ; rang 2 = la version du
-- dernier marqueur antérieur qui en porte une autre (§ 1). `deploye_le` est
-- l'instant du marqueur retenu. Ordre (ts, id) : à instant égal, le dernier
-- déclaré. Marqueurs futurs, hors prod et versions vides ignorés. `mesures` vaut
-- 0 — et `p75` NULL — pour une release sans mesure sur la fenêtre.
create or replace function alert_release_p75(
  p_app_id text, p_metric text, p_route text, p_window_minutes integer
) returns table (rang integer, version text, deploye_le timestamptz, p75 double precision, mesures integer)
language sql stable set search_path = public, pg_temp as $$
  with marqueurs as (
    select m.id, m.ts, m.version
      from deploy_marker m
     where m.app_id = p_app_id and m.env = 'prod' and m.ts <= now()
       and m.version is not null and btrim(m.version) <> ''
  ), en_service as (
    select k.version, k.ts
      from marqueurs k
     order by k.ts desc, k.id desc
     limit 1
  ), remplacee as (
    -- Tout autre marqueur est antérieur au dernier dans l'ordre (ts, id) : il
    -- suffit de prendre le plus récent qui porte une autre version.
    select k.version, k.ts
      from marqueurs k, en_service s
     where k.version <> s.version
     order by k.ts desc, k.id desc
     limit 1
  ), deux as (
    select 1 as rang, s.version, s.ts as deploye_le from en_service s
    union all
    select 2, p.version, p.ts from remplacee p
  )
  select deux.rang, deux.version, deux.deploye_le, x.p75, x.mesures
    from deux
   cross join lateral (
     select percentile_cont(0.75) within group (order by mt.value) as p75, count(*)::int as mesures
       from rum_metric mt
      where mt.app_id = p_app_id and mt.name = p_metric and mt.release = deux.version
        and mt.ts > now() - make_interval(mins => greatest(p_window_minutes, 1))
        and (p_route is null or mt.route = p_route)
   ) x
   order by deux.rang
$$;

comment on function alert_release_p75(text, text, text, integer) is
  'B52 (v86) : la release en service en prod (dernier marqueur) et celle qu''elle a remplacée (dernier marqueur antérieur d''une autre version), avec le p75 d''un vital de chacune sur la fenêtre';

do $$
begin
  execute 'revoke execute on function public.alert_release_p75(text,text,text,integer) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.alert_release_p75(text,text,text,integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function public.alert_release_p75(text,text,text,integer) from authenticated';
  end if;
end $$;

-- ── 3. check_alerts : reprise intégrale de migration-v73, plus le mode release ─
-- Seules différences avec v73, toutes bornées au mode release :
--   • une branche `r.mode = 'release'` avant le calcul par métrique (qui ne tourne
--     donc pas pour ce mode) ;
--   • une branche de décision `r.mode = 'release'` avant `v is null` ;
--   • `last_reason` reçoit, pour ce mode seulement, le détail de la comparaison.
-- Les modes threshold et baseline, les familles event:, issue:, error_rate,
-- ai_cost et log_errors sont inchangés à l'octet près.
create or replace function check_alerts() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare r record; v double precision; fired int := 0; ev_id bigint; req_id bigint;
        b record; breached boolean; msg text; lo double precision; hi double precision;
        event_sample_rate double precision;
        issue uuid; observable timestamptz; no_data text; inserees int;
        rel_b text; rel_a text; p75_b double precision; p75_a double precision;
        n_b integer; n_a integer; ecart numeric; rel_detail text; autres_env text;
begin
  for r in select * from alert_rule where active order by id loop
    -- Sérialise deux schedulers concurrents règle par règle. L'ordre par id
    -- empêche aussi un interblocage quand plusieurs règles sont actives.
    perform pg_advisory_xact_lock(r.id);
    v := null; event_sample_rate := null; no_data := null; issue := null;
    rel_b := null; rel_a := null; p75_b := null; p75_a := null; n_b := 0; n_a := 0;
    ecart := null; rel_detail := null; autres_env := null;
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
          r.metric, r.comparator, round(v::numeric,1), r.threshold, r.window_minutes, r.app_id,
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
              'route',r.route,'value',round(v::numeric,1),'severity',r.severity,'text',msg))
            into req_id;
          update alert_delivery set status='sent', response='pg_net request '||req_id
            where alert_event_id = ev_id and target = r.webhook_url;
        exception when others then null; end;
      end if;
      perform route_alert(ev_id, r.app_id, r.severity, '[MIP RUM] ' || msg,
        jsonb_build_object('source','mip-rum','app_id',r.app_id,'metric',r.metric,
          'route',r.route,'value',round(v::numeric,1),'severity',r.severity,'text',msg));
    end if;
  end loop;
  return fired;
end $function$;
