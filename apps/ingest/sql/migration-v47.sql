-- migration-v47 — E1-S3 : l'isolation multi-tenant cesse d'être une façade.
--
-- CONSTAT (production, 29 juil. 2026). RLS est activé sur les 35 tables du schéma
-- public, chacune porte une policy, et l'audit conclut « RLS durci ». En réalité :
--
--   • 36 des 38 policies ont pour prédicat `USING (true)` — elles n'excluent
--     RIEN. Ce sont des autorisations de lecture écrites en policies, pas des
--     frontières d'isolation.
--   • `relforcerowsecurity` est false sur les 35 tables, et le propriétaire est
--     `postgres` : un propriétaire n'est pas soumis à RLS sans FORCE.
--   • Le rôle applicatif observé porte `rolbypassrls = true`, ce qui court-circuite
--     RLS quoi qu'il arrive.
--
-- Autrement dit : trois verrous en série, tous ouverts. L'isolation entre tenants
-- ne repose aujourd'hui QUE sur la présence d'un `WHERE app_id = …` dans chaque
-- requête applicative. Un oubli dans une seule requête suffit à faire fuir les
-- données d'un tenant vers un autre, sans que rien en base ne s'y oppose.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `current_app_ids()` — lit la portée du tenant dans la GUC
--      `app.current_app_id`. Non renseignée -> tableau vide -> AUCUNE ligne
--      visible (fail-closed, jamais fail-open).
--   2. Remplace les policies `USING (true)` par un prédicat réellement scopé, sur
--      toute table portant `app_id` (boucle : les tables futures sont couvertes
--      sans édition de cette migration).
--   3. Les tables filles sans `app_id` (alert_event, alert_delivery,
--      uptime_result) sont scopées via leur parent.
--
-- POURQUOI PAS `FORCE ROW LEVEL SECURITY`. Le seul effet de FORCE est de soumettre
-- le PROPRIÉTAIRE des tables à RLS — or le propriétaire est précisément l'identité
-- d'exploitation qui a besoin d'un accès inter-tenant : les 10 fonctions
-- `security definer` (check_alerts, check_slo_burn, route_alert, purge_old_data,
-- record_uptime_result, rate_check…) s'exécutent avec ses droits. Sous FORCE et
-- sans GUC, elles verraient ZÉRO ligne : alerting, purge, uptime et metering
-- casseraient en silence. En prod Supabase le rôle `postgres` porte BYPASSRLS et y
-- survivrait — mais pas une installation SELF-HOST, qui est justement l'argument de
-- vente. Le confinement applicatif ne vient pas de FORCE : il vient du fait que la
-- console se connecte en `console_ro`, non-propriétaire, donc déjà soumis à RLS.
--
-- CE QU'ELLE NE FAIT PAS — et c'est délibéré.
-- Elle ne change pas le rôle de connexion de la console. Tant que l'application
-- se connecte avec un rôle `BYPASSRLS`, ces policies restent inertes : elles sont
-- une CEINTURE, pas un remplacement du `WHERE app_id =`. La bascule (connecter la
-- console en `console_ro` + poser la GUC par transaction, cf. `withTenant()` dans
-- apps/console/lib/db.ts) est une décision d'exploitation : elle exige un
-- identifiant distinct dans l'environnement et un test de non-régression complet
-- de la console. Appliquer cette migration seule est SANS EFFET DE BORD.
--
-- Tables volontairement hors périmètre (non-tenant) : console_user (comptes),
-- audit_log (journal global), openrouter_balance (solde fournisseur).
--
-- Idempotente (rejouable : les policies sont recréées à l'identique). Retour
-- arrière : `drop policy tenant_scope on …` puis réappliquer les policies
-- `using (true)` de migration-v10/v34.

-- ── 1. Portée du tenant, lue dans la GUC ─────────────────────────────────────
-- Renvoie un tableau vide (et non NULL) quand la GUC est absente ou vide : un
-- tableau vide donne `app_id = any('{}')` = false, donc zéro ligne. C'est la
-- propriété qui rend l'oubli de configuration silencieusement SÛR plutôt que
-- silencieusement ouvert.
create or replace function current_app_ids() returns text[]
language sql stable
set search_path = pg_catalog, pg_temp as $$
  select coalesce(
    string_to_array(nullif(current_setting('app.current_app_id', true), ''), ','),
    '{}'::text[]
  );
$$;

comment on function current_app_ids() is
  'Portée tenant de la session, lue dans la GUC app.current_app_id (liste séparée '
  'par des virgules). Absente -> tableau vide -> aucune ligne visible (fail-closed).';

grant execute on function current_app_ids() to public;

-- ── 2. Purge des policies permissives résiduelles ────────────────────────────
-- POINT CRITIQUE, vérifié par le test d'isolation : les policies PERMISSIVES se
-- combinent en OU. Laisser UNE SEULE policy `using (true)` sur une table annule
-- toutes les policies scopées qu'on ajoute à côté — le filtrage devient
-- décoratif, et rien ne le signale.
--
-- On supprime donc par PRÉDICAT (`= 'true'`), jamais par nom : les noms hérités
-- sont hétérogènes (console_read_metric, cro_all_alert_event, cro_sel_delivery,
-- cro_sel_uptime_result…) et en oublier un rouvre silencieusement la table.
do $$
declare t text; pol record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and (exists (select 1 from pg_attribute a
                     where a.attrelid = c.oid and a.attname = 'app_id'
                       and a.attnum > 0 and not a.attisdropped)
            or c.relname in ('alert_event','alert_delivery','uptime_result'))
  loop
    for pol in select polname from pg_policy
                where polrelid = format('public.%I', t)::regclass
                  and pg_get_expr(polqual, polrelid) = 'true'
    loop
      execute format('drop policy %I on public.%I', pol.polname, t);
    end loop;
    execute format('drop policy if exists tenant_scope on public.%I', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ── 3. Policies scopées : tables portant app_id ──────────────────────────────
do $$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'app_id'
                      and a.attnum > 0 and not a.attisdropped)
  loop
    execute format(
      'create policy tenant_scope on public.%I for all using (app_id = any(current_app_ids()))', t);
  end loop;
end $$;

-- ── 4. Policies scopées : tables filles, via leur parent ─────────────────────
-- alert_event porte rule_id OU slo_id (jamais les deux) ; on remonte à l'app_id
-- par le parent correspondant.
create policy tenant_scope on alert_event for all using (
  exists (select 1 from alert_rule r where r.id = alert_event.rule_id
            and r.app_id = any(current_app_ids()))
  or
  exists (select 1 from slo s where s.id = alert_event.slo_id
            and s.app_id = any(current_app_ids()))
);

-- Pas de remontée explicite à app_id : la sous-requête sur alert_event est
-- elle-même soumise à RLS pour le rôle appelant, donc la portée se compose.
create policy tenant_scope on alert_delivery for all using (
  exists (select 1 from alert_event e where e.id = alert_delivery.alert_event_id)
);

create policy tenant_scope on uptime_result for all using (
  exists (select 1 from uptime_check u where u.id = uptime_result.check_id
            and u.app_id = any(current_app_ids()))
);

comment on function current_app_ids() is
  'Portée tenant de la session (GUC app.current_app_id). Socle des policies '
  'tenant_scope posées par migration-v47. Absente -> aucune ligne visible.';
