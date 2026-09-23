-- migration-v62 — la cardinalité de `route`, bornée à l'écriture, et une règle
-- de normalisation que le client peut écrire.
--
-- Finding 2.6 de docs/AUDIT_RUM_EXTERNE.md, seconde moitié. Le lot 6 a borné la
-- LECTURE (`slowRoutes` limité à 200 routes, plafond visible à l'écran). Ce qui
-- restait ouvert est l'ÉCRITURE : `normalizeRoute` dans le SDK ne remplace que
-- les entiers, les UUID et les hexadécimaux longs. Ni les slugs, ni les dates,
-- ni les références de commande. Un catalogue e-commerce produit alors une
-- statistique par page, c'est-à-dire aucune statistique.
--
-- ═════════════ POURQUOI UN DÉCLENCHEUR ET PAS L'APPLICATIF ═══════════════════
--
-- Deux chemins d'ingestion écrivent ces tables : le receveur Railway
-- (apps/ingest/lib/receiver.mjs) et la fonction edge Supabase héritée
-- (functions/v1-traces). Poser la normalisation dans `flattenOtlp` obligerait à
-- charger les motifs dans les DEUX, et un troisième chemin ajouté plus tard
-- passerait à côté sans que rien ne le signale. La base est le seul point que
-- personne ne contourne.
--
-- Le coût de ce choix est mesuré, pas supposé : scripts/bench-route-trigger.mjs
-- compare l'insertion d'un lot réaliste avec et sans le déclencheur, sur un
-- PostgreSQL réel, en passes alternées. Résultat : 8 à 16 µs par ligne insérée
-- selon les exécutions, soit +25 à +66 % du temps d'INSERT brut. C'est beaucoup
-- en relatif et négligeable en absolu — un beacon d'une douzaine de lignes prend
-- 0,1 à 0,2 ms de plus, sur une requête HTTP qui en coûte des dizaines.
--
-- ═════════════ CE QUE ÇA FAIT À L'HISTORIQUE, ET COMMENT ON LE TRAITE ════════
--
-- C'est la raison pour laquelle ce chantier avait été différé. Ajouter un motif
-- ne réécrit pas le passé : `/produit/chaise-bleue` reste tel quel tandis que
-- les nouvelles lignes deviennent `/produit/:slug`. La série d'une route se
-- COUPE en deux à l'instant où le motif est créé, et les deux moitiés ont l'air
-- de deux routes différentes — un graphe qui tombe à zéro sans que rien ne soit
-- tombé.
--
-- On ne diffère plus : `backfill_route_patterns(app_id)` réécrit l'historique
-- avec les mêmes motifs, dans toutes les tables portant une route. La série
-- reste continue. LE PRIX EST RÉEL ET DÉFINITIF : la route d'origine n'est
-- conservée nulle part, un motif trop large détruit du détail sans retour
-- possible. La fonction renvoie donc le compte des lignes touchées par table, et
-- `mip_apercu_backfill()` permet de le voir AVANT d'écrire.

-- ─────────────────────────── Les motifs ──────────────────────────────────────
--
-- Expression rationnelle POSIX (`~`) et `regexp_replace`, pas de langage maison :
-- le client écrit ce qu'il écrirait ailleurs, et `\1` fonctionne.
create table if not exists route_pattern (
  id           bigserial primary key,
  app_id       text not null,
  motif        text not null,
  remplacement text not null,
  priorite     int not null default 100,
  created_at   timestamptz not null default now(),
  unique (app_id, motif)
);

comment on table route_pattern is
  'Règles de normalisation de route, par application. Le PREMIER motif qui correspond, dans '
  'l''ordre (priorite, id), gagne : une règle ne s''applique jamais sur le résultat d''une autre, '
  'ce qui rendrait le résultat dépendant de l''ordre d''insertion. Appliquées à l''écriture par '
  'le déclencheur mip_trigger_route, et à l''historique par backfill_route_patterns().';

create index if not exists idx_route_pattern_app on route_pattern (app_id, priorite, id);

-- ─────────────────── Le plafond de cardinalité ───────────────────────────────
--
-- `route_registry` retient les routes DÉJÀ vues d'une application ; au-delà du
-- plafond, une route inédite devient `(other)`. Le compte est tenu à part plutôt
-- que recompté : un `count(*)` sur deux mille lignes à chaque insertion de
-- métrique coûterait plus cher que tout le reste du déclencheur.
alter table app_registry add column if not exists route_limit int not null default 2000;

comment on column app_registry.route_limit is
  'Nombre maximal de routes DISTINCTES retenues pour cette application. Au-delà, les routes '
  'inédites sont regroupées sous (other) — la dimension cesse de croître, et /admin/health le '
  'signale. 2 000 par défaut : au-dessus, un tableau par route n''est déjà plus lisible.';

create table if not exists route_registry (
  app_id        text not null,
  route         text not null,
  first_seen_at timestamptz not null default now(),
  primary key (app_id, route)
);

create table if not exists route_cardinality (
  app_id text primary key,
  n      int not null default 0
);

comment on table route_cardinality is
  'Compteur de routes distinctes par application. Tenu par mip_router_ou_autre() lors de la '
  'PREMIÈRE vue d''une route — donc rarement écrit après la montée en charge initiale, et sans '
  'contention sur le chemin chaud.';

/** La valeur de regroupement. Écrite une fois, lue partout. */
create or replace function mip_route_autre() returns text
language sql immutable parallel safe as $$ select '(other)'::text $$;

-- ────────────────────────── La normalisation ─────────────────────────────────

create or replace function mip_normaliser_route(p_app_id text, p_route text) returns text
language sql stable parallel safe as $$
  -- Écrite en SQL et non en PL/pgSQL — mais SANS le gain qu'on en attendait, et
  -- c'est dit parce que c'est mesuré : la boucle PL/pgSQL coûtait 8,0 µs par
  -- ligne, ce `select` unique en coûte 7,4. Le prix est l'ACCÈS À LA TABLE, pas
  -- la forme de la boucle. On garde cette version, plus courte, sans lui
  -- attribuer une performance qu'elle n'a pas.
  --
  -- Le PREMIER motif qui correspond gagne, et on s'arrête là. Enchaîner les
  -- motifs rendrait le résultat dépendant de l'ordre d'insertion des règles,
  -- donc irreproductible entre le déclencheur et le rattrapage d'historique.
  select coalesce(
    (select regexp_replace(p_route, rp.motif, rp.remplacement)
       from route_pattern rp
      where rp.app_id = p_app_id and p_route ~ rp.motif
      order by rp.priorite, rp.id
      limit 1),
    p_route);
$$;

comment on function mip_normaliser_route(text, text) is
  'Applique le premier motif route_pattern qui correspond. STABLE et non IMMUTABLE : elle lit une '
  'table, donc son résultat change quand le client change ses règles — la déclarer immutable la '
  'rendrait indexable et figerait un résultat périmé dans l''index.';

create or replace function mip_router_ou_autre(p_app_id text, p_route text) returns text
language plpgsql as $$
declare v_route text; v_limite int; v_n int; v_inseree boolean;
begin
  if p_route is null then return null; end if;

  -- DEUX recherches, et c'est le minimum — mesuré, pas supposé. Le coût est
  -- l'accès à une table depuis le déclencheur, environ 8 µs par ligne et par
  -- table : scripts/bench-route-trigger.mjs isole 1,1 µs pour un déclencheur à
  -- VIDE, 7,4 µs pour la normalisation seule, 17 µs pour les deux. Les fusionner
  -- en une requête à sous-requêtes imbriquées a été essayé et MESURÉ : 105 µs —
  -- le planificateur cesse alors d'intégrer mip_normaliser_route. On garde donc
  -- la forme lisible, qui se trouve être aussi la rapide.
  v_route := mip_normaliser_route(p_app_id, p_route);

  -- Route déjà connue : le cas de très loin le plus fréquent en régime
  -- permanent, et le seul qui compte pour le coût. Une recherche sur la clé
  -- primaire, aucune écriture.
  if exists (select 1 from route_registry where app_id = p_app_id and route = v_route) then
    return v_route;
  end if;

  select coalesce(route_limit, 2000) into v_limite from app_registry where app_id = p_app_id;
  select rc.n into v_n from route_cardinality rc where rc.app_id = p_app_id;
  if coalesce(v_n, 0) >= coalesce(v_limite, 2000) then
    return mip_route_autre();
  end if;
  -- `row_count` et non un second `exists` : deux insertions concurrentes de la
  -- même route inédite passent toutes les deux le test ci-dessus, mais une seule
  -- insère réellement — et une seule doit incrémenter le compteur.
  insert into route_registry (app_id, route) values (p_app_id, v_route)
    on conflict do nothing;
  get diagnostics v_inseree = row_count;
  if v_inseree then
    insert into route_cardinality (app_id, n) values (p_app_id, 1)
      on conflict (app_id) do update set n = route_cardinality.n + 1;
  end if;
  return v_route;
end $$;

comment on function mip_router_ou_autre(text, text) is
  'Normalise puis borne : au-delà de app_registry.route_limit routes distinctes, une route inédite '
  'devient (other). Coût mesuré sur le chemin d''écriture, sur trois exécutions du banc : 8 à 16 µs '
  'par ligne insérée, soit +25 à +66 %% du temps d''INSERT brut. La fourchette est large parce que '
  'la mesure l''est ; le chiffre bas n''est pas plus vrai que le haut. Rapporté à un beacon d''une '
  'douzaine de lignes cela fait 0,1 à 0,2 ms, contre des dizaines de millisecondes de requête '
  'HTTP. Le banc est scripts/bench-route-trigger.mjs.';

create or replace function mip_trigger_route() returns trigger language plpgsql as $$
begin
  new.route := mip_router_ou_autre(new.app_id, new.route);
  return new;
end $$;

comment on function mip_trigger_route() is
  'BEFORE INSERT seulement, jamais UPDATE : le rattrapage d''historique écrit des routes DÉJÀ '
  'normalisées, et les repasser dans le plafond ferait basculer en (other) des routes qui '
  'existaient avant lui.';

-- Toutes les tables de DONNÉES portant une route. `alert_rule.route` et
-- `slo.route` en portent une aussi, mais comme FILTRE de configuration : les
-- réécrire changerait la règle d'un client, pas sa télémétrie.
do $$
declare t text;
begin
  foreach t in array array['rum_metric', 'rum_pageview', 'rum_error', 'rum_longtask',
                           'rum_resource', 'rum_event', 'rum_span', 'rum_log', 'rum_ai'] loop
    execute format('drop trigger if exists trg_route_%1$s on %1$I', t);
    execute format(
      'create trigger trg_route_%1$s before insert on %1$I
       for each row when (new.route is not null) execute function mip_trigger_route()', t);
  end loop;
end $$;

-- ─────────── L'amorçage : ce que la base contient DÉJÀ compte ────────────────
--
-- Sans ça, `route_cardinality` partirait de zéro sur une base qui porte déjà
-- 6 000 routes, et le plafond ne se déclencherait qu'après 2 000 routes de PLUS.
insert into route_registry (app_id, route, first_seen_at)
select app_id, route, min(ts) from rum_metric where route is not null group by 1, 2
on conflict do nothing;
insert into route_registry (app_id, route, first_seen_at)
select app_id, route, min(started_at) from rum_pageview where route is not null group by 1, 2
on conflict do nothing;

insert into route_cardinality (app_id, n)
select app_id, count(*)::int from route_registry group by 1
on conflict (app_id) do update set n = excluded.n;

-- ──────────────── Le rattrapage d'historique, et son aperçu ──────────────────

create or replace function mip_apercu_backfill(p_app_id text)
returns table (route_avant text, route_apres text, lignes bigint)
language sql stable as $$
  select route, mip_normaliser_route(p_app_id, route), count(*)
    from (select route from rum_metric where app_id = p_app_id and route is not null
          union all
          select route from rum_pageview where app_id = p_app_id and route is not null) x
   group by 1, 2
  having route is distinct from mip_normaliser_route(p_app_id, route)
   order by 3 desc;
$$;

comment on function mip_apercu_backfill(text) is
  'Ce que backfill_route_patterns() CHANGERAIT, sans rien écrire. À lire avant : la réécriture est '
  'définitive, la route d''origine n''est conservée nulle part.';

create or replace function backfill_route_patterns(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); t text; n bigint; v_distinctes int;
begin
  foreach t in array array['rum_metric', 'rum_pageview', 'rum_error', 'rum_longtask',
                           'rum_resource', 'rum_event', 'rum_span', 'rum_log', 'rum_ai'] loop
    execute format(
      'update %1$I set route = mip_normaliser_route(app_id, route)
        where app_id = $1 and route is not null
          and route is distinct from mip_normaliser_route(app_id, route)', t)
      using p_app_id;
    get diagnostics n = row_count;
    result := result || jsonb_build_object(t, n);
  end loop;

  -- Le registre suit : les routes d'avant normalisation n'existent plus, les
  -- laisser gonflerait le compteur et déclencherait le plafond à tort.
  delete from route_registry where app_id = p_app_id;
  insert into route_registry (app_id, route, first_seen_at)
  select app_id, route, min(ts) from rum_metric where app_id = p_app_id and route is not null group by 1, 2
  on conflict do nothing;
  insert into route_registry (app_id, route, first_seen_at)
  select app_id, route, min(started_at) from rum_pageview where app_id = p_app_id and route is not null group by 1, 2
  on conflict do nothing;
  insert into route_cardinality (app_id, n)
  select p_app_id, count(*)::int from route_registry where app_id = p_app_id
  on conflict (app_id) do update set n = excluded.n;

  -- `v_distinctes` et non un sous-select sur `n` : la variable locale `n` porte
  -- le même nom que la colonne, et PL/pgSQL refuse l'ambiguïté au lieu de
  -- choisir — ce qui est la bonne décision, et un rappel d'être explicite.
  select rc.n into v_distinctes from route_cardinality rc where rc.app_id = p_app_id;
  return result || jsonb_build_object('routes_distinctes', v_distinctes);
end $$;

-- ──────────── Les trois tables entrent dans TOUTES les énumérations ──────────
--
-- Pas dans la purge de RÉTENTION : un motif et un registre de routes ne sont pas
-- de la télémétrie datée, les effacer au bout de 30 jours ferait repartir le
-- plafond de zéro et perdrait la configuration du client. Dans l'effacement d'un
-- client, en revanche, tout part.

create or replace function erase_app_data(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); n bigint;
begin
  delete from rum_metric     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log        where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from route_pattern     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_pattern', n);
  delete from route_registry    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_registry', n);
  delete from route_cardinality where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_cardinality', n);
  delete from sourcemap      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from syn_snapshot   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from alert_event    where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;

-- Isolation multi-locataire, comme toute table portant un app_id.
do $$
declare t text;
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    foreach t in array array['route_pattern', 'route_registry', 'route_cardinality'] loop
      execute format('alter table %I enable row level security', t);
      execute format('drop policy if exists tenant_scope on %I', t);
      execute format('create policy tenant_scope on %I for select to console_ro
                      using (app_id = any (current_app_ids()))', t);
      execute format('grant select on %I to console_ro', t);
    end loop;
    grant execute on function mip_normaliser_route(text, text) to console_ro;
    grant execute on function mip_route_autre() to console_ro;
    grant execute on function mip_apercu_backfill(text) to console_ro;
  end if;
end $$;
