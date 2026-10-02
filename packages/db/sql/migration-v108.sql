-- migration-v108 — L'escalade des alertes : niveaux, acquittement horodaté, relance (01/10/2026).
--
-- Additive et rejouable, PostgreSQL 15 à 17. v107 (inscription en libre-service)
-- est le fichier précédent. Aucune donnée existante ne change de sens.
--
-- POURQUOI. Un déclenchement part vers les canaux éligibles (`route_alert`, v88),
-- toujours les mêmes : une règle qui reste franchie en lève un nouveau à chaque
-- fenêtre (`check_alerts`), un SLO selon sa cadence (v45), mais rien ne monte d'un
-- cran — si personne ne les voit, personne d'autre n'est prévenu. Et l'acquittement
-- n'est qu'un booléen (v02) : on sait qu'une alerte a été prise en charge, jamais
-- quand — le délai d'acquittement (MTTA) ne se mesure pas.
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
--      `check_slo_burn`, une livraison `queued` par niveau échu et par INCIDENT
--      ouvert ; le livreur l'envoie comme les autres. L'acquittement arrête tout.
--   6. Deux index sur `alert_delivery` : par étape (le compte de l'écran, la clé
--      étrangère `on delete set null`) et par déclenchement (le suivi de l'écran,
--      la cascade de la purge), qui n'en avait aucun.
--
-- L'INCIDENT, PAS LA LIGNE. Une règle qui reste franchie et non acquittée lève un
-- déclenchement par fenêtre : huit en deux heures pour une fenêtre de 15 min.
-- Escalader chacun enverrait huit fois chaque niveau. L'escalade se fait donc par
-- incident : les déclenchements ouverts d'une même SOURCE (la règle, le SLO, ou
-- l'issue d'une notification sans règle), chacun à moins de 24 h du précédent —
-- 24 h couvre la plus longue fenêtre de règle (1 440 min) et la cadence d'un SLO
-- (16 h au plus, v45). Un incident s'escalade UNE fois, depuis son premier
-- déclenchement, et ses envois s'attachent à ce déclenchement-là. Un écart de plus
-- de 24 h ouvre un nouvel incident : un déclenchement oublié il y a dix jours
-- n'éteint pas l'escalade d'une rechute. La console acquitte d'un geste tous les
-- déclenchements ouverts de la source (`acknowledgeAlertEvent`) : l'acquittement
-- arrête l'incident, pas seulement sa ligne. Si la règle reste franchie, le
-- déclenchement suivant (au passage suivant, comme avant v108) ouvre un nouvel
-- incident, qui s'escalade à son tour.
--
-- CE QUI NE CHANGE PAS. `route_alert` et `check_alerts` : le chemin nominal reste
-- identique, l'escalade ne fait qu'AJOUTER des livraisons. Pas d'astreinte (rotation,
-- SMS, outil tiers) : des niveaux vers les canaux déjà déclarés.
--
-- CE QUE L'ESCALADE NE REGARDE PAS. La sévérité minimale du CANAL
-- (`notify_channel.severity_min`) règle le routage nominal ; une étape vise son
-- canal explicitement, et c'est la sévérité de l'ÉTAPE qui compte — un canal réglé
-- sur « critique » reçoit l'escalade d'un avertissement si une étape le vise. Une
-- règle désactivée ne lève plus rien, mais ses déclenchements déjà ouverts restent
-- à traiter : ils s'escaladent jusqu'à leur acquittement, leur plafond ou 7 jours.
--
-- LE GRAIN EST LE TICK. `escalate_alerts` ne s'exécute qu'au passage du scheduler
-- (15 min en production, `SCHEDULER_TICK_MIN`) : tout délai part au premier tick
-- qui suit son échéance. Une relance plus rapprochée que le tick part au rythme
-- des ticks, une par passage, sans sauter de rang. La console le dit à côté des
-- étapes.
--
-- QUELS DÉCLENCHEMENTS. Ceux qu'on peut ACQUITTER depuis la console : nés d'une
-- règle, d'un SLO ou d'une notification d'issue — leur application se lit par
-- jointure, comme le fait l'écran. Les alertes sans application connue de la base
-- (uptime, absence de collecte, nouvelle erreur historique) ne s'escaladent pas :
-- sans acquittement possible, elles relanceraient jusqu'au plafond sans que
-- personne puisse les arrêter. Seuls comptent les incidents nés APRÈS la création
-- de l'étape (pas d'avalanche sur l'arriéré) et depuis moins de 7 jours.
--
-- DROITS. Le scheduler (propriétaire) exécute la fonction. `mip_console`
-- (console-api) lit, crée et supprime les étapes : SELECT, INSERT, DELETE et sa
-- policy, comme les tables accordées après v93 (v103, v104). `console_ro` lit sous
-- la portée de sa session. Aucun droit pour `mip_api` : le service `api` ne nomme
-- pas cette table.
--
-- VERROUS. Des `alter table` brefs sur `alert_event` et `alert_delivery`, et des
-- index construits sans `concurrently` : petites tables, purgées à 30 jours ;
-- `lock_timeout` : s'il expire, le migrateur annule le fichier et le rejoue.
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
  'Politique d''escalade (v108) : à chaque tick, un incident (déclenchements ouverts d''une même source) non '
  'acquitté depuis delay_minutes reçoit un envoi au canal channel_id, niveau level ; le dernier niveau relance '
  'toutes les repeat_minutes, repeat_max fois au plus, une fois par tick au plus. L''acquittement arrête tout.';

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

-- Par étape : le compte « envois · 30 j » de l'écran et la clé étrangère (`on
-- delete set null` à la suppression d'une étape) ne parcourent plus toute la table.
create index if not exists idx_alert_delivery_etape
  on alert_delivery (escalation_step_id)
  where escalation_step_id is not null;
-- Par déclenchement : le suivi de l'écran (niveau atteint, une recherche par ligne
-- affichée) et la cascade de la purge de `alert_event`. La table n'en avait aucun ;
-- bornée à 30 jours par la purge, elle reste petite : l'index se construit vite.
create index if not exists idx_alert_delivery_evenement on alert_delivery (alert_event_id);

comment on column alert_delivery.escalation_level is
  'Niveau d''escalade de cet envoi (v108) ; NULL : envoi du routage nominal (route_alert).';
comment on column alert_delivery.escalation_relance is
  'Rang de relance (v108) : 0 pour le premier envoi du niveau, n pour la n-ième relance du dernier niveau.';

-- ── 5. L'escalade, à chaque tick ─────────────────────────────────────────────
--
-- Les déclenchements ouverts se regroupent en INCIDENTS (voir l'en-tête) : par
-- source, une suite de déclenchements chacun à moins de 24 h du précédent. Seul
-- le dernier incident de chaque source compte, ancré sur son PREMIER déclenchement,
-- s'il a moins de 7 jours et une application connue. Pour lui, chaque étape qui le
-- concerne (application, sévérité — la plus haute de l'incident —, créée avant son
-- début), vers un canal actif à sa portée :
--   · échéance = début de l'incident + delay_minutes ; passée, l'étape doit avoir
--     son envoi de rang 0 ;
--   · l'étape du DERNIER niveau de l'incident, si elle relance, envoie ensuite le
--     rang SUIVANT dès qu'il est dû — le rang k l'est à échéance + k × repeat_minutes,
--     jusqu'à repeat_max. Un envoi par passe et par étape, au plus : une cadence plus
--     courte que le tick, ou un tick manqué, retarde les relances sans en sauter
--     aucune, et le destinataire lit des rangs qui se suivent.
-- Le premier envoi d'un niveau précède toujours ses relances : sans envoi de rang
-- 0, c'est lui qui part, quel que soit le temps écoulé.
--
-- Le dernier niveau se lit APRÈS le filtre des canaux : un niveau dont le canal est
-- éteint n'envoie rien, et ne fait pas non plus taire la relance du niveau d'en
-- dessous. Le canal doit être actif et à la portée de l'incident (global, ou de
-- son application) : une étape globale n'envoie jamais vers le canal d'une autre
-- application. `p_maintenant` sert aux tests ; le scheduler appelle sans argument.
-- Rend le nombre d'envois mis en file.
create or replace function escalate_alerts(p_maintenant timestamptz default now())
returns integer language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  en_file integer;
begin
  with ouverts as (
    -- L'application et la source, par la règle, le SLO, puis la notification
    -- d'issue (latérale et bornée à une ligne : elle ne peut pas dupliquer le
    -- déclenchement). 8 jours suffisent : 7 pour l'âge d'un incident, plus l'écart
    -- maximal de 24 h entre deux déclenchements d'un même incident — un incident
    -- plus ancien commence forcément avant le premier jour lu, et reste dehors.
    select e.id, e.fired_at, severity_rank(e.severity) as rang,
           coalesce(r.app_id, s.app_id, n.app_id) as app_id,
           case
             when e.rule_id is not null then 'regle:' || e.rule_id
             when e.slo_id is not null then 'slo:' || e.slo_id
             when n.issue_id is not null then 'issue:' || n.app_id || ':' || n.issue_id
           end as source
      from alert_event e
      left join alert_rule r on r.id = e.rule_id
      left join slo s on s.id = e.slo_id
      left join lateral (
        select n.app_id, n.issue_id from error_issue_notification n where n.alert_event_id = e.id limit 1
      ) n on true
     where not e.acknowledged
       and e.fired_at >= p_maintenant - interval '8 days'
       and e.fired_at <= p_maintenant
  ),
  suites as (
    select o.*, lag(o.fired_at) over (partition by o.source order by o.fired_at, o.id) as precedent
      from ouverts o
     where o.source is not null and o.app_id is not null
  ),
  episodes as (
    -- Le numéro d'incident de chaque déclenchement, dans sa source : +1 à chaque
    -- écart de plus de 24 h.
    select su.*,
           count(*) filter (where su.precedent is null or su.fired_at - su.precedent > interval '24 hours')
             over (partition by su.source order by su.fired_at, su.id) as episode
      from suites su
  ),
  incidents as (
    -- Le dernier incident de chaque source, par son premier déclenchement ; sa
    -- sévérité est la plus haute de ses déclenchements.
    select distinct on (ep.source) ep.id, ep.app_id, ep.fired_at,
           max(ep.rang) over (partition by ep.source, ep.episode) as rang
      from episodes ep
     order by ep.source, ep.episode desc, ep.fired_at, ep.id
  ),
  etapes as (
    select i.id as event_id, st.id as step_id, st.level, c.target,
           st.repeat_minutes, st.repeat_max,
           i.fired_at + make_interval(mins => st.delay_minutes) as echeance,
           max(st.level) over (partition by i.id) as dernier_niveau
      from incidents i
      join alert_escalation_step st
        on (st.app_id is null or st.app_id = i.app_id)
       and severity_rank(st.severity_min) <= i.rang
       and st.created_at <= i.fired_at
      join notify_channel c on c.id = st.channel_id and c.active
                           and (c.app_id is null or c.app_id = i.app_id)
     where i.fired_at >= p_maintenant - interval '7 days'
  ),
  dues as (
    select et.event_id, et.step_id, et.level, et.target,
           case
             when et.level = et.dernier_niveau and et.repeat_minutes is not null
               then least(et.repeat_max,
                          floor(extract(epoch from (p_maintenant - et.echeance)) / 60.0 / et.repeat_minutes)::integer)
             else 0
           end as relance_due
      from etapes et
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
    -- Sans envoi, le rang 0 ; ensuite, le rang qui suit le dernier envoyé, s'il est dû.
    select du.event_id, du.step_id, du.level, du.target,
           case when dj.relance_max is null then 0 else dj.relance_max + 1 end as relance
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
  'Escalade (v108) : met en file une livraison par niveau échu et par incident non acquitté — les déclenchements '
  'ouverts d''une même règle, d''un même SLO ou d''une même issue, à moins de 24 h l''un de l''autre ; moins de '
  '7 jours ; né après l''étape —, puis les relances du dernier niveau, une par passage. Étape du tick du scheduler.';

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
