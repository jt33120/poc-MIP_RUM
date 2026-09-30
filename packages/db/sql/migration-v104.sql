-- migration-v104 — `mip_console` lit les détections : `vital_horaire` et
-- `signal_detecte` (v101).
--
-- Additive et rejouable, PostgreSQL 15 à 17. Suite de la refonte du monitoring
-- (30/09/2026).
--
-- POURQUOI. La vue d'ensemble (`/`) trace la plage habituelle horaire des vitals
-- (`vital_horaire`) et montre les constats détectés par calcul (`signal_detecte`).
-- Faute de droit pour `mip_console`, ces lectures tournaient dans la console seule
-- (`chargerComplementLocal`, PR #364) : le bundle de `console-api` ne devait pas
-- nommer ces tables, sans quoi sa garde (`scripts/ci/verify-db-roles-console.mjs`)
-- le refusait. Avec ces droits, elles rejoignent `chargerOverview`, servi aussi par
-- `console-api`, et les deux tables rejoignent `packages/db/roles/console-api.mjs`.
--
-- DROITS. Motif de v103 § 6 bis (`collecte_fenetre`) : SELECT et une policy de
-- lecture propre à `mip_console`, `using (true)` — le chargeur borne lui-même la
-- lecture au périmètre de la session (`compileScope`, `lib/queries-detections.ts`), comme
-- pour toutes les tables de ce rôle (v93). Les policies de `console_ro` (v101,
-- `tenant_scope`) ne changent pas : une policy ne vaut que pour les rôles qu'elle
-- nomme. PAS de droit pour `mip_api` : le bundle du service `api` ne nomme pas ces
-- tables, et sa garde (`scripts/ci/verify-db-roles.mjs`) signale une table
-- accordée que son bundle ne nomme pas.
--
-- VERROUS. `grant` et `create policy` prennent un verrou bref sur chaque table ;
-- `lock_timeout` : s'il expire, le migrateur annule le fichier et le rejoue.
set local lock_timeout = '3s';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'mip_console') then
    grant select on vital_horaire to mip_console;
    if not exists (select 1 from pg_policy where polrelid = 'public.vital_horaire'::regclass
                                               and polname = 'mip_console_acces') then
      create policy mip_console_acces on vital_horaire as permissive for select to mip_console using (true);
    end if;
    grant select on signal_detecte to mip_console;
    if not exists (select 1 from pg_policy where polrelid = 'public.signal_detecte'::regclass
                                               and polname = 'mip_console_acces') then
      create policy mip_console_acces on signal_detecte as permissive for select to mip_console using (true);
    end if;
  end if;
end $$;
