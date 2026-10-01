-- migration-v108 — L'escalade des alertes : niveaux, acquittement horodaté, relance (01/10/2026).
--
-- Additive et rejouable, PostgreSQL 15 à 17. v107 (inscription en libre-service)
-- est le fichier précédent. Aucune donnée existante ne change de sens.
--
-- POURQUOI. Une alerte part UNE fois, vers les canaux éligibles (`route_alert`,
-- v88), puis plus rien : si personne ne la voit, personne n'est relancé. Et
-- l'acquittement n'est qu'un booléen (v02) : on sait qu'une alerte a été prise en
-- charge, jamais quand — le délai d'acquittement (MTTA) ne se mesure pas.
--
-- CE QUI CHANGE.
--   1. `alert_event.acknowledged_at` et `acknowledged_by` : l'heure et l'auteur de
--      l'acquittement, écrits par la console (`acknowledgeAlertEvent`).
--   2. `alert_event.acquittement_horodate` : VRAI pour un déclenchement né après ce
--      fichier, NUL avant. Le MTTA ne compte que ceux-là : un déclenchement ancien,
--      resté ouvert puis acquitté demain, porterait un délai de plusieurs jours qui
--      ne mesure que l'absence d'horodatage, pas la réactivité de l'équipe.
--   3. `alert_escalation_step` : la politique, en étapes. Une étape dit « si un
--      déclenchement de cette application (ou de toutes), d'au moins cette
--      sévérité, reste non acquitté N minutes, envoie au canal C — niveau L ».
--      L'étape du DERNIER niveau peut relancer toutes les R minutes, K fois au plus.
--   4. `alert_delivery.escalation_level`, `escalation_step_id`, `escalation_relance` :
--      une livraison d'escalade dit son niveau et son rang de relance (0 : le
--      premier envoi du niveau). Une livraison du routage nominal les laisse NULL.
--   5. `escalate_alerts(p_maintenant)` : à chaque tick du scheduler, après
--      `check_slo_burn`, une livraison `queued` par niveau échu et par déclenchement
--      ouvert ; le livreur l'envoie comme les autres. L'acquittement arrête tout.
--
-- CE QUI NE CHANGE PAS. `route_alert` et `check_alerts` : le chemin nominal reste
-- identique, l'escalade ne fait qu'AJOUTER des livraisons. Pas d'astreinte (rotation,
-- SMS, outil tiers) : des niveaux vers les canaux déjà déclarés.
--
-- LE GRAIN EST LE TICK. `escalate_alerts` ne s'exécute qu'au passage du scheduler
-- (15 min en production, `SCHEDULER_TICK_MIN`) : un délai de 5 min part au tick
-- qui suit son échéance. La console le dit à côté des étapes.
--
-- QUELS DÉCLENCHEMENTS. Ceux qu'on peut ACQUITTER depuis la console : nés d'une
-- règle, d'un SLO ou d'une notification d'issue — leur application se lit par
-- jointure, comme le fait l'écran. Les alertes sans application connue de la base
-- (uptime, absence de collecte, nouvelle erreur historique) ne s'escaladent pas :
-- sans acquittement possible, elles relanceraient jusqu'au plafond sans que
-- personne puisse les arrêter. Seuls comptent les déclenchements nés APRÈS la
-- création de l'étape (pas d'avalanche sur l'arriéré) et depuis moins de 7 jours.
--
-- DROITS. Le scheduler (propriétaire) exécute la fonction. `mip_console`
-- (console-api) lit, crée et supprime les étapes : SELECT, INSERT, DELETE et sa
-- policy, comme les tables accordées après v93 (v103, v104). `console_ro` lit sous
-- la portée de sa session. Aucun droit pour `mip_api` : le service `api` ne nomme
-- pas cette table.
--
-- VERROUS. Des `alter table` brefs sur `alert_event` et `alert_delivery`, petites
-- tables ; `lock_timeout` : s'il expire, le migrateur annule le fichier et le rejoue.
set local lock_timeout = '3s';

-- ── 1. L'acquittement horodaté ────────────────────────────────────────────────
alter table alert_event add column if not exists acknowledged_at timestamptz;
alter table alert_event add column if not exists acknowledged_by text;

comment on column alert_event.acknowledged_at is
  'Heure de l''acquittement (v108), écrite par la console. NULL : non acquitté, ou acquitté avant v108.';
comment on column alert_event.acknowledged_by is
  'Adresse du compte qui a acquitté (v108). NULL : non acquitté, ou acquitté avant v108.';

-- ── 2. Le périmètre du MTTA ──────────────────────────────────────────────────
-- Ajoutée SANS défaut, la colonne laisse NULL sur les lignes existantes ; le
-- défaut posé ensuite ne vaut que pour les déclenchements à venir.
alter table alert_event add column if not exists acquittement_horodate boolean;
alter table alert_event alter column acquittement_horodate set default true;

comment on column alert_event.acquittement_horodate is
  'VRAI : déclenchement né après v108, dont l''heure d''acquittement est enregistrée — le seul périmètre du '
  'délai médian d''acquittement (MTTA). NULL : né avant v108.';

-- Les déclenchements OUVERTS, par date : ce que parcourt `escalate_alerts` à chaque
-- tick, et ce que compte le badge « non acquittées ».
create index if not exists idx_alert_event_ouverts on alert_event (fired_at) where not acknowledged;

-- ── 3. Les étapes d'escalade ─────────────────────────────────────────────────
create table if not exists alert_escalation_step (
  id             bigserial primary key,
  -- NULL : toutes les applications (réservé à l'administrateur de la plateforme).
  app_id         text,
  severity_min   text not null default 'warning',
  level          smallint not null,
  delay_minutes  integer not null,
  -- Supprimer un canal supprime les étapes qui y envoyaient : une étape sans
  -- destination ne dirait plus rien.
  channel_id     bigint not null references notify_channel (id) on delete cascade,
  repeat_minutes integer,
  repeat_max     integer,
  created_at     timestamptz not null default now(),
  created_by     text,
  constraint alert_escalation_step_severite check (severity_min in ('info', 'warning', 'critical')),
  constraint alert_escalation_step_niveau check (level between 1 and 9),
  constraint alert_escalation_step_delai check (delay_minutes between 0 and 10080),
  constraint alert_escalation_step_relance check (
    (repeat_minutes is null and repeat_max is null)
    or (repeat_minutes between 5 and 1440 and repeat_max between 1 and 48)
  )
);
create index if not exists idx_alert_escalation_step_app on alert_escalation_step (app_id);
create index if not exists idx_alert_escalation_step_canal on alert_escalation_step (channel_id);

comment on table alert_escalation_step is
  'Politique d''escalade (v108) : à chaque tick, un déclenchement non acquitté depuis delay_minutes reçoit '
  'un envoi au canal channel_id, niveau level ; le dernier niveau relance toutes les repeat_minutes, '
  'repeat_max fois au plus. L''acquittement arrête tout.';

-- ── 4. Les livraisons d'escalade ─────────────────────────────────────────────
alter table alert_delivery add column if not exists escalation_level smallint;
alter table alert_delivery add column if not exists escalation_step_id bigint;
alter table alert_delivery add column if not exists escalation_relance smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alert_delivery_escalation_step_fk') then
    -- Une étape supprimée laisse l'historique de ses envois : le niveau reste écrit.
    alter table alert_delivery add constraint alert_delivery_escalation_step_fk
      foreign key (escalation_step_id) references alert_escalation_step (id) on delete set null;
  end if;
end $$;

-- UN envoi par (déclenchement, étape, rang de relance) : deux passes concurrentes
-- (un redéploiement qui chevauche) n'envoient jamais deux fois le même niveau.
create unique index if not exists idx_alert_delivery_escalade
  on alert_delivery (alert_event_id, escalation_step_id, escalation_relance)
  where escalation_step_id is not null;

comment on column alert_delivery.escalation_level is
  'Niveau d''escalade de cet envoi (v108) ; NULL : envoi du routage nominal (route_alert).';
comment on column alert_delivery.escalation_relance is
  'Rang de relance (v108) : 0 pour le premier envoi du niveau, n pour la n-ième relance du dernier niveau.';

-- ── 5. L'escalade, à chaque tick ─────────────────────────────────────────────
--
-- Pour chaque déclenchement ouvert de moins de 7 jours dont l'application est
-- connue, et chaque étape qui le concerne (application, sévérité, créée avant le
-- déclenchement) :
--   · échéance = fired_at + delay_minutes ; passée, l'étape doit avoir son envoi
--     de rang 0 ;
--   · l'étape du DERNIER niveau de ce déclenchement, si elle relance, doit avoir
--     son envoi de rang k = ⌊(maintenant − échéance) / repeat_minutes⌋, plafonné
--     à repeat_max. Un tick manqué ne rattrape pas les relances sautées : il
--     envoie la plus récente due (un envoi par passe et par étape, au plus).
-- Le premier envoi d'un niveau précède toujours ses relances : sans envoi de rang
-- 0, c'est lui qui part, quel que soit le temps écoulé.
--
-- Le canal doit être actif et à la portée du déclenchement (global, ou de son
-- application) : une étape globale n'envoie jamais vers le canal d'une autre
-- application. `p_maintenant` sert aux tests ; le scheduler appelle sans argument.
-- Rend le nombre d'envois mis en file.
create or replace function escalate_alerts(p_maintenant timestamptz default now())
returns integer language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  en_file integer;
begin
  with ouverts as (
    -- L'application, par la source : règle, SLO, puis notification d'issue (une
    -- sous-requête, pas une jointure : elle ne peut pas dupliquer le déclenchement).
    select e.id, e.fired_at, e.severity,
           coalesce(r.app_id, s.app_id,
                    (select n.app_id from error_issue_notification n where n.alert_event_id = e.id limit 1)) as app_id
      from alert_event e
      left join alert_rule r on r.id = e.rule_id
      left join slo s on s.id = e.slo_id
     where not e.acknowledged
       and e.fired_at >= p_maintenant - interval '7 days'
       and e.fired_at <= p_maintenant
  ),
  etapes as (
    select o.id as event_id, o.app_id, st.id as step_id, st.level, st.channel_id,
           st.repeat_minutes, st.repeat_max,
           o.fired_at + make_interval(mins => st.delay_minutes) as echeance,
           max(st.level) over (partition by o.id) as dernier_niveau
      from ouverts o
      join alert_escalation_step st
        on (st.app_id is null or st.app_id = o.app_id)
       and severity_rank(st.severity_min) <= severity_rank(o.severity)
       and st.created_at <= o.fired_at
     where o.app_id is not null
  ),
  dues as (
    select et.event_id, et.step_id, et.level, c.target,
           case
             when et.level = et.dernier_niveau and et.repeat_minutes is not null
               then least(et.repeat_max,
                          floor(extract(epoch from (p_maintenant - et.echeance)) / 60.0 / et.repeat_minutes)::integer)
             else 0
           end as relance_due
      from etapes et
      join notify_channel c on c.id = et.channel_id and c.active
                           and (c.app_id is null or c.app_id = et.app_id)
     where et.echeance <= p_maintenant
  ),
  deja as (
    select d.alert_event_id, d.escalation_step_id, max(d.escalation_relance) as relance_max
      from alert_delivery d
     where d.escalation_step_id is not null
       and d.alert_event_id in (select event_id from dues)
     group by d.alert_event_id, d.escalation_step_id
  ),
  a_envoyer as (
    select du.event_id, du.step_id, du.level, du.target,
           case when dj.relance_max is null then 0 else du.relance_due end as relance
      from dues du
      left join deja dj on dj.alert_event_id = du.event_id and dj.escalation_step_id = du.step_id
     where dj.relance_max is null or du.relance_due > dj.relance_max
  ),
  inserees as (
    insert into alert_delivery (alert_event_id, target, escalation_level, escalation_step_id, escalation_relance)
    select event_id, target, level, step_id, relance from a_envoyer
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into en_file from inserees;
  return en_file;
end $fn$;

comment on function escalate_alerts(timestamptz) is
  'Escalade (v108) : met en file une livraison par niveau échu et par déclenchement non acquitté (règle, SLO, '
  'issue ; moins de 7 jours ; né après l''étape), puis les relances du dernier niveau. Étape du tick du scheduler.';

revoke execute on function escalate_alerts(timestamptz) from public;

-- ── 6. Droits et RLS ─────────────────────────────────────────────────────────
alter table alert_escalation_step enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    revoke all on alert_escalation_step from console_ro;
    grant select on alert_escalation_step to console_ro;
    -- Lecture sous la portée de la session, comme `notify_channel` (v47) : une étape
    -- globale n'est pas visible d'une session restreinte à une application.
    if not exists (select 1 from pg_policy where polrelid = 'public.alert_escalation_step'::regclass
                                               and polname = 'tenant_scope') then
      create policy tenant_scope on alert_escalation_step for select to console_ro
        using (app_id = any(current_app_ids()));
    end if;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on alert_escalation_step from anon;
    revoke all on sequence alert_escalation_step_id_seq from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on alert_escalation_step from authenticated;
    revoke all on sequence alert_escalation_step_id_seq from authenticated;
  end if;
end $$;

-- `mip_console` (console-api) : l'écran lit les étapes, les commandes en créent et
-- en suppriment (`creerEtapeEscalade`, `supprimerEtapeEscalade`). La policy n'ouvre
-- que les lignes ; le périmètre est appliqué par chaque requête (v93 § 4).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'mip_console') then
    grant select, insert, delete on alert_escalation_step to mip_console;
    grant usage on sequence alert_escalation_step_id_seq to mip_console;
    if not exists (select 1 from pg_policy where polrelid = 'public.alert_escalation_step'::regclass
                                               and polname = 'mip_console_acces') then
      create policy mip_console_acces on alert_escalation_step as permissive for all to mip_console
        using (true) with check (true);
    end if;
  end if;
end $$;
