-- migration-v96 — Recette du 26/09/2026 : effacer les adresses IP que le journal
-- d'audit gardait (démo, connexions bloquées).
--
-- Rejouable, PostgreSQL 15 à 17. v95 (échéance des jetons de lecture) est le
-- fichier précédent.
--
-- CE QUI ÉTAIT FAUX. Jusqu'à la recette, la console écrivait l'adresse IP du
-- visiteur dans `audit_log.detail` à chaque ouverture de `/demo`
-- (`{"ip": …, "apps": […]}`) et à chaque connexion bloquée (`{"ip": …}`). Le
-- journal est en ajout seul (v90) : ces adresses y seraient restées pour toujours,
-- alors que la vitrine et la politique de confidentialité disent qu'aucune adresse
-- IP de visiteur n'est conservée. Le code ne les écrit plus ; cette migration retire
-- celles déjà écrites.
--
-- POURQUOI LE DÉCLENCHEUR EST SUSPENDU. `trg_audit_log_ajout_seul` (v90) refuse
-- toute modification du journal, à bon droit. Retirer une donnée personnelle qu'on
-- n'aurait jamais dû garder est la seule exception : le déclencheur est suspendu
-- le temps de cette mise à jour, DANS la transaction de la migration, et remis
-- aussitôt. Seule la clé `ip` disparaît ; l'action, l'horodatage, l'utilisateur et
-- le reste du détail restent.
--
-- Un détail qui n'est pas du JSON (formes anciennes) est laissé tel quel.
do $$
declare
  ligne record;
  n integer := 0;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit_log_ajout_seul') then
    -- v90 absente (auto-hébergement partiel) : rien ne protège le journal, rien à suspendre.
    null;
  else
    alter table audit_log disable trigger trg_audit_log_ajout_seul;
  end if;

  for ligne in
    -- Toutes les actions : `demo_session` et `login_blocked` sont les deux connues,
    -- mais une forme plus ancienne a pu en écrire ailleurs (clé `ip` au premier niveau).
    select id, detail from audit_log
     where detail like '%"ip"%'
  loop
    begin
      if (ligne.detail::jsonb) ? 'ip' then
        update audit_log set detail = (ligne.detail::jsonb - 'ip')::text where id = ligne.id;
        n := n + 1;
      end if;
    exception when others then
      -- détail illisible en JSON : on n'y touche pas.
      null;
    end;
  end loop;

  if exists (select 1 from pg_trigger where tgname = 'trg_audit_log_ajout_seul') then
    alter table audit_log enable trigger trg_audit_log_ajout_seul;
  end if;

  raise notice 'migration-v96 : % ligne(s) du journal d''audit sans adresse IP', n;
end $$;
