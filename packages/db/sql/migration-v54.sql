-- migration-v54 — `scheduler_lease` entre dans le schéma, au lieu d'apparaître
-- par effet de bord.
--
-- LE SYMPTÔME. Dans le journal Postgres du job CI « E2E Playwright » :
--
--   ERROR:  relation "scheduler_lease" does not exist
--   STATEMENT: select max(expires_at)::text as t from scheduler_lease where job = 'tick'
--
-- LA CAUSE. La table naissait UNIQUEMENT à l'exécution : sa DDL vit dans
-- apps/ingest/jobs/bail.mjs (constante SQL_TABLE) et n'était exécutée que par
-- services/scheduler/worker.mjs, à chaque prise de bail. Aucune migration ne la
-- créait. Or la console la LIT — `dernierTickScheduler()` dans
-- lib/queries-planifie.ts alimente la ligne « Latence d'alerte » de la vitrine.
--
-- POURQUOI ÇA COMPTE, alors que la lecture est en échec doux (elle renvoie null,
-- la page affiche « aucun passage constaté » et rien ne casse) :
--
--   1. /presentation est la vitrine PUBLIQUE, servie avant login. Dans tout
--      environnement où le scheduler n'a pas encore tourné — self-host neuf,
--      preview, CI — CHAQUE visite anonyme émettait cette erreur.
--   2. Surtout, une table créée par effet de bord d'un service n'est décrite
--      nulle part dans le schéma. C'est l'inverse exact de l'invariant que
--      DEPLOY.md § 1 bis énonce : « les migrations sont une étape du
--      déploiement, le schéma ne peut plus être en retard sur le code ». Une
--      base reconstruite depuis ce dépôt n'était pas identique à la production.
--
-- La DDL ci-dessous est le COPIE CONFORME de SQL_TABLE. L'appel runtime reste en
-- place — il est `if not exists`, donc inoffensif, et garde le scheduler
-- déployable seul sur une base non migrée. La source de vérité, c'est ce fichier.

create table if not exists scheduler_lease (
  job        text primary key,
  holder     text        not null,
  expires_at timestamptz not null
);

comment on table scheduler_lease is
  'Bail d''exclusion des travaux planifiés : une seule instance à la fois par cadence. '
  'Un bail est une LIGNE et non un verrou consultatif, parce que le pooler Neon '
  '(PgBouncer en mode transaction) annule les verrous de session. '
  'La ligne SURVIT à sa libération (expires_at = now()) : `max(expires_at)` est le '
  'battement de cœur que lit la vitrine pour dire la latence d''alerte réelle.';
comment on column scheduler_lease.holder is
  'Identité du process porteur (RAILWAY_DEPLOYMENT_ID, ou local-<uuid>). Aucune donnée client.';

-- ─────────────────────── RLS, par cohérence et à dessein ───────────────────────
-- migration-v10 active la RLS EN BOUCLE sur toutes les tables de `public`
-- existantes à sa date. `scheduler_lease` naissant après elle, à l'exécution,
-- elle y échappait : c'était la seule table applicative sans RLS, donc
-- exactement ce qu'un audit signale et qu'on « corrige » ensuite sans regarder
-- le chemin de lecture. On l'aligne ici plutôt que de laisser l'anomalie.
--
-- CE QUE ÇA NE CHANGE PAS AUJOURD'HUI : la console et le scheduler se connectent
-- tous deux avec le rôle PROPRIÉTAIRE (`neondb_owner` en production, cf. l'encadré
-- de DEPLOY.md), qui n'est pas soumis à la RLS de ses propres tables.
--
-- LE PIÈGE À CONNAÎTRE, s'il fallait un jour connecter la console avec un rôle
-- restreint : sans policy, la lecture ne LÈVE PAS d'erreur, elle renvoie zéro
-- ligne. `dernierTickScheduler()` répondrait null, et la vitrine afficherait
-- « aucun passage constaté » pendant que le scheduler tourne — une affirmation
-- fausse, présentée comme mesurée. D'où la policy de lecture ci-dessous, posée
-- en même temps que la RLS et non après coup.
alter table scheduler_lease enable row level security;

do $$
begin
  -- Gardé : `console_ro` n'existe ni en CI ni en local, le bloc est alors sauté.
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    -- Lecture seule : la console LIT le battement de cœur, c'est le scheduler
    -- (rôle propriétaire) qui écrit. Lui donner l'écriture lui permettrait de
    -- libérer le bail d'un autre process.
    grant select on scheduler_lease to console_ro;
    if not exists (
      select 1 from pg_policies
      where tablename = 'scheduler_lease' and policyname = 'cro_sel_scheduler_lease'
    ) then
      create policy cro_sel_scheduler_lease on scheduler_lease
        for select to console_ro using (true);
    end if;
  end if;
end $$;
