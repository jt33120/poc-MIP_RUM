-- migration-v110 — Collecte : une exception serveur venue d'un journal reprend la
-- session et la route de son span (07/10/2026).
--
-- Additive et rejouable, PostgreSQL 15 à 17. v109 (écriture en un aller-retour)
-- est le fichier précédent. Aucune table n'est modifiée, aucune ligne existante ne
-- bouge : deux fonctions et deux déclencheurs, qui n'agissent que sur ce qui
-- s'écrit APRÈS ce fichier.
--
-- LE DÉFAUT. Les agents OpenTelemetry officiels de Java, .NET et Python exportent
-- leurs journaux AVANT leurs spans (captures de `tests/fixtures/otlp-agents/`).
-- L'exception d'une requête en échec est donc comptée par le journal ERROR du
-- framework (Tomcat, Kestrel, Flask), qui porte `trace_id` et `span_id` mais ni
-- session ni route : la ligne `rum_error` naît avec `session_id` et `route` à NULL
-- et `origin_signal = 'log'`. Le span serveur de la même requête (500), qui arrive
-- ensuite, porte bien la route (`http.route`) et la session (revendiquée par le
-- `tracestate` du navigateur) ; l'événement `exception` qu'il porte a la MÊME
-- identité que le journal (« Une panne, une occurrence », otlp.mjs) et tombe sur
-- `on conflict (span_id) do nothing` — .NET n'en pose même pas. L'erreur restait
-- orpheline : absente de la session, rangée sous aucune route.
--
-- LA RÈGLE. Une exception dérivée d'un journal (`origin_signal = 'log'`) dont le
-- span porteur (`source_parent_span_id`, le `span_id` du journal) est un span
-- serveur (`rum_span.tier = 'back'`) de la MÊME application et de la MÊME trace
-- prend, pour ce qui lui manque, la route de ce span et sa session — celle-ci
-- seulement si elle existe dans la même application et n'est sous aucune barrière
-- d'effacement (mêmes conditions que `rattacherSessions`, pg-ingest.mjs). Rien de ce
-- que l'erreur porte déjà n'est remplacé, et `origin_signal` reste `log` : c'est
-- bien le journal qui l'a comptée (le métering ne change pas).
--
-- QUEL QUE SOIT L'ORDRE D'ARRIVÉE :
--   1. span d'abord : `trg_rum_error_contexte_span_v110` (BEFORE INSERT sur
--      rum_error) lit le span par sa clé unique au moment où l'erreur s'écrit ;
--   2. journal d'abord : `trg_rum_span_complete_erreurs_v110` (AFTER INSERT sur
--      rum_span, une fois par instruction, sur les seules lignes INSÉRÉES) complète
--      les erreurs déjà écrites ;
--   3. même lot (une erreur et son span dans un même appel) : les deux chemins
--      écrivent les erreurs avant les spans, et c'est le cas 2 ;
--   4. rejeu : un span déjà écrit n'est pas réinséré (`on conflict do nothing`),
--      une erreur déjà écrite non plus ; ce qui a été complété le reste. Aucune
--      ligne n'est créée : pas de double comptage.
--
-- POURQUOI DES DÉCLENCHEURS, ET NON `mip_ingerer_lot_v2`. Trois écrivains écrivent
-- ces deux tables : le chemin historique (`writeRowsWithClient`), la fonction en un
-- aller-retour (`mip_ingerer_lot_v1`, v109, le chemin actif) et le drain de la file
-- différée, qui passe par le premier avec son propre client. Un déclencheur les
-- rend équivalents PAR CONSTRUCTION, sans toucher à v109 ni au JavaScript, et sans
-- aller-retour de plus. C'est aussi la forme déjà retenue pour la route
-- (`trg_route_*`, v62).
--
-- LA BARRIÈRE (v81). Les deux déclencheurs s'exécutent dans la transaction de
-- l'écrivain, donc sous le verrou consultatif de l'application, comme l'écriture
-- qu'ils prolongent : un effacement ne peut pas s'intercaler. Un span d'une session
-- effacée a déjà été retiré du lot par le filtrage ; une session effacée n'est plus
-- dans `rum_session`, et la barrière est relue par précaution.
--
-- LA FENÊTRE. Le cas 2 cherche les erreurs ingérées depuis UNE HEURE au plus, par
-- l'index existant `idx_error_ingested_at_id` (v64) : `rum_error` n'a aucun index
-- sur la trace (v80 les a refusés), et parcourir la table à chaque lot de spans
-- serait hors de prix. Les agents envoient journal et span à quelques secondes
-- d'écart ; une heure couvre les reprises et la file différée ordinaire. Au-delà,
-- l'erreur reste sans session ni route, comme avant ce fichier.
--
-- L'ORDRE DES DÉCLENCHEURS BEFORE (alphabétique) : `trg_route_rum_error` passe
-- AVANT `trg_rum_error_contexte_span_v110`. La route recopiée est celle du span,
-- déjà normalisée et bornée par `trg_route_rum_span` : elle n'a pas à repasser par
-- le plafond (v62, « BEFORE INSERT seulement, jamais UPDATE »).
--
-- LIMITE ASSUMÉE. Seul le span du journal compte, pas ses ancêtres : un journal
-- émis dans un span interne (tier `detail`) ne remonte pas au span serveur. Les
-- trois agents capturés journalisent l'exception dans le span serveur lui-même.
--
-- RETOUR ARRIÈRE : `drop trigger trg_rum_error_contexte_span_v110 on rum_error;
-- drop trigger trg_rum_span_complete_erreurs_v110 on rum_span;` — les erreurs déjà
-- complétées le restent, ce qui est le comportement voulu.
--
-- VERROUS. `create trigger` prend un SHARE ROW EXCLUSIVE bref sur rum_error et
-- rum_span : les écritures attendent la fin de ce fichier, sans parcours de table.
set local lock_timeout = '3s';

-- ── 1. Span déjà là : l'erreur se complète en s'écrivant ──────────────────────
create or replace function mip_erreur_contexte_span_v110() returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $fn$
declare
  v_route   text;
  v_session text;
begin
  -- La clé unique de rum_span. Un émetteur JSON peut écrire ses identifiants en
  -- majuscules, l'exception les porte en minuscules : les deux formes, par l'index.
  select s.route, s.session_id into v_route, v_session
    from rum_span s
   where s.span_id in (new.source_parent_span_id, upper(new.source_parent_span_id))
     and s.app_id = new.app_id
     and s.tier = 'back'
     and lower(s.trace_id) = new.trace_id
   limit 1;
  if not found then
    return new;
  end if;
  if new.route is null then
    new.route := v_route;
  end if;
  if new.session_id is null and v_session is not null then
    new.session_id := (select rs.session_id from rum_session rs
                        where rs.session_id = v_session and rs.app_id = new.app_id
                          and not exists (select 1 from privacy_erasure_barrier b
                                           where b.app_id = new.app_id and b.subject_kind = 'session'
                                             and b.subject_key = v_session
                                             and (b.expires_at is null or b.expires_at > now())));
  end if;
  return new;
end
$fn$;

comment on function mip_erreur_contexte_span_v110() is
  'BEFORE INSERT sur rum_error (v110) : une exception dérivée d''un journal prend la route et la session '
  '(existante, même application, hors barrière) de son span serveur déjà écrit. Ne remplace rien.';

drop trigger if exists trg_rum_error_contexte_span_v110 on rum_error;
create trigger trg_rum_error_contexte_span_v110 before insert on rum_error
  for each row
  when (new.origin_signal = 'log' and new.source_parent_span_id is not null and new.trace_id is not null
        and (new.session_id is null or new.route is null))
  execute function mip_erreur_contexte_span_v110();

-- ── 2. Journal d'abord : le span, en arrivant, complète l'erreur ─────────────
create or replace function mip_span_complete_erreurs_v110() returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $fn$
begin
  -- Un lot du navigateur (spans `front`) ou de détail ne déclenche rien de plus
  -- que cette lecture de la table de transition.
  if not exists (select 1 from nouveaux n where n.tier = 'back' and (n.route is not null or n.session_id is not null)) then
    return null;
  end if;
  update rum_error e
     set route      = coalesce(e.route, c.route),
         session_id = coalesce(e.session_id, c.session_id)
    from (select n.app_id, lower(n.trace_id) as trace_id, lower(n.span_id) as span_id, n.route,
                 (select rs.session_id from rum_session rs
                   where rs.session_id = n.session_id and rs.app_id = n.app_id
                     and not exists (select 1 from privacy_erasure_barrier b
                                      where b.app_id = n.app_id and b.subject_kind = 'session'
                                        and b.subject_key = n.session_id
                                        and (b.expires_at is null or b.expires_at > now()))) as session_id
            from nouveaux n
           where n.tier = 'back') c
   where e.ingested_at >= now() - interval '1 hour'
     and e.origin_signal = 'log'
     and e.app_id = c.app_id
     and e.source_parent_span_id = c.span_id
     and e.trace_id = c.trace_id
     -- Seulement ce qui change : une mise à jour à vide laisserait une version morte.
     and ((e.route is null and c.route is not null) or (e.session_id is null and c.session_id is not null));
  return null;
end
$fn$;

comment on function mip_span_complete_erreurs_v110() is
  'AFTER INSERT sur rum_span, par instruction (v110) : les exceptions dérivées d''un journal, ingérées '
  'depuis une heure au plus, prennent la route et la session (existante, même application, hors '
  'barrière) du span serveur qui vient d''être inséré. Ne remplace rien.';

drop trigger if exists trg_rum_span_complete_erreurs_v110 on rum_span;
create trigger trg_rum_span_complete_erreurs_v110 after insert on rum_span
  referencing new table as nouveaux
  for each statement
  execute function mip_span_complete_erreurs_v110();

-- Des fonctions de déclencheur : personne n'a à les appeler.
do $$
declare f text;
begin
  foreach f in array array[
    'public.mip_erreur_contexte_span_v110()',
    'public.mip_span_complete_erreurs_v110()'
  ] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'console_ro') then
      execute format('revoke execute on function %s from console_ro', f);
    end if;
  end loop;
end $$;
