-- migration-v57 — l'identité du visiteur cesse d'être une empreinte de terminal.
--
-- Finding 1.3 de docs/AUDIT_RUM_EXTERNE.md, le seul dont la conséquence soit
-- juridique plutôt que cosmétique.
--
-- CE QUE `user_hash` ÉTAIT. `fnv1a(userAgent | langue | résolution | décalage
-- UTC)` : aucun aléa, aucun sel, aucun tirage persisté. Deux personnes sur le
-- même modèle de poste, la même version de navigateur, la même langue, la même
-- résolution et le même fuseau obtenaient LE MÊME identifiant. Ce n'était pas
-- une collision improbable, c'était le comportement nominal — et sur le créneau
-- visé (portails de service public, parcs gérés par une DSI) c'est le cas
-- majoritaire.
--
-- CE QUE ÇA CASSAIT :
--
--   * « Utilisateurs uniques » comptait des CONFIGURATIONS, pas des personnes ;
--   * « nouveaux vs revenants » déclarait tout le monde revenant dès qu'une
--     classe d'appareil avait été vue une fois ;
--   * l'effacement RGPD par cet identifiant supprimait les données d'AUTRES
--     personnes, et l'export art. 15 leur en communiquait. L'outil censé assurer
--     la conformité produisait la violation.
--
-- CE QU'ON NE FAIT PAS : rétro-remplir. Un `user_hash` n'est pas convertible en
-- identifiant de personne — l'information n'a jamais existé. Les lignes
-- antérieures restent donc marquées pour ce qu'elles sont, et le DSAR refuse de
-- s'exécuter sur elles.

alter table rum_session add column if not exists visitor_id text;

comment on column rum_session.visitor_id is
  'Identifiant de visiteur : tirage ALÉATOIRE du SDK, persisté côté navigateur, jamais dérivé '
  'du terminal. Seule clé sur laquelle un export ou un effacement RGPD peut s''exécuter. '
  'NULL sur les sessions écrites avant le 09/09/2026 et sur celles des SDK non encore mis à jour.';

comment on column rum_session.user_hash is
  'ANCIENNE empreinte de classe d''appareil (fnv1a de userAgent+langue+résolution+fuseau). '
  'N''identifie PAS une personne : plusieurs visiteurs d''un parc homogène partagent la même '
  'valeur. Conservée pour ne pas perdre l''historique, mais ne doit servir NI à compter des '
  'personnes, NI à répondre à une demande d''accès ou d''effacement. Le SDK ne l''émet plus.';

-- ────────────────────── `id_kind` est DÉRIVÉ, pas maintenu ─────────────────────
--
-- L'audit proposait une colonne `id_kind text not null default 'device_class'`
-- écrite par l'ingestion. Deux colonnes pour un seul fait finissent par se
-- contredire — c'est le défaut que ce dépôt passe son temps à corriger ailleurs.
-- Une colonne GÉNÉRÉE donne la même lisibilité (un DPO qui lit la table voit le
-- mot, pas une convention à connaître) sans qu'aucun code puisse la désynchroniser :
-- PostgreSQL refuse qu'on l'écrive.
alter table rum_session add column if not exists id_kind text
  generated always as (
    case when visitor_id is not null then 'random' else 'device_class' end
  ) stored;

comment on column rum_session.id_kind is
  'DÉRIVÉE de visitor_id, non modifiable : ''random'' = identifiant de visiteur tiré au hasard, '
  'sur lequel le DSAR s''exécute ; ''device_class'' = empreinte de terminal héritée, sur laquelle '
  'il REFUSE de s''exécuter, parce qu''elle peut désigner plusieurs personnes.';

-- Le classement par visiteur, sur une app et une fenêtre. Partiel : les lignes
-- sans identifiant — tout l'historique — n'ont rien à y faire.
create index if not exists idx_session_visitor
  on rum_session (app_id, visitor_id)
  where visitor_id is not null;

-- ───────────── « Utilisateurs touchés » par un groupe d'erreurs ────────────────
-- `v_error_group_ext` (migration-v40) comptait `count(distinct s.user_hash)` sous
-- l'intitulé `users_affected`. Sur un parc homogène, cent personnes touchées par
-- le même bug s'y comptaient comme une. La vue passe au visiteur ; les sessions
-- sans identifiant ne sont plus comptées du tout, parce qu'un compte partiel
-- honnête vaut mieux qu'un compte complet faux.
create or replace view v_error_group_ext as
  select e.app_id,
         e.fingerprint,
         max(e.error_type)             as error_type,
         max(e.message)                as sample_message,
         count(*)                      as occurrences,
         count(distinct e.session_id)  as sessions,
         count(distinct s.visitor_id)  as users_affected,
         min(e.ts)                     as first_seen,
         max(e.ts)                     as last_seen
    from rum_error e
    left join rum_session s on s.session_id = e.session_id
   where e.fingerprint is not null
   group by e.app_id, e.fingerprint;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on v_error_group_ext to console_ro;
  end if;
end $$;
