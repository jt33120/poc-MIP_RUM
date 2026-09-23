-- migration-v60 — les fenêtres de temps cessent d'être en UTC dans une interface
-- française.
--
-- Finding 2.8 de docs/AUDIT_RUM_EXTERNE.md (lot 5).
--
-- CE QUI ÉTAIT FAUX. Trente `date_trunc` dans apps/console/lib, aucun
-- `at time zone`, et aucune fixation de fuseau sur la connexion : les bornes
-- étaient celles du serveur PostgreSQL, en pratique UTC chez un hébergeur
-- managé. Trois conséquences, toutes silencieuses :
--
--   * la heatmap « jour × heure » affichait des heures UTC sous des libellés
--     français — en été, la colonne « 9 h » contient le trafic de 11 h à Paris ;
--   * la courbe journalière et le rapport quotidien coupaient la journée à 2 h
--     du matin heure locale, déplaçant le trafic de soirée sur le lendemain ;
--   * les deux dimanches de changement d'heure produisent une journée de 23 h et
--     une de 25 h — le z-score saisonnier compare « ce jour » à « le même jour la
--     semaine dernière », donc des fenêtres de longueurs différentes.
--
-- CE QU'ON NE CHANGE PAS : le pré-agrégat horaire reste en UTC. C'est le bon
-- grain — une heure dure une heure partout, changement d'heure compris — et
-- seul le REGROUPEMENT JOURNALIER bascule en local. Agréger l'horaire en local
-- rendrait l'historique dépendant du fuseau au moment de l'écriture.
alter table app_registry add column if not exists timezone text not null default 'Europe/Paris';

comment on column app_registry.timezone is
  'Fuseau IANA dans lequel les JOURNÉES de cette application sont découpées (heatmap, '
  'séries journalières, rapport quotidien). Le pré-agrégat horaire reste en UTC : une heure '
  'dure une heure partout, alors qu''une journée locale dure 23 ou 25 h deux fois par an.';

-- Un fuseau inconnu ferait échouer `at time zone` À L'EXÉCUTION — donc sur un
-- écran, plusieurs jours après la saisie, et sur TOUS les écrans à la fois. On
-- refuse à l'écriture.
--
-- UN DÉCLENCHEUR ET PAS UNE CONTRAINTE CHECK : PostgreSQL interdit les
-- sous-requêtes dans un CHECK, et `pg_timezone_names` est une vue. Écrire la
-- liste en dur serait pire — elle change avec les décisions politiques des
-- États, plusieurs fois par an.
create or replace function mip_verifier_fuseau() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'fuseau horaire inconnu : %', new.timezone
      using hint = 'utiliser un identifiant IANA, par exemple Europe/Paris';
  end if;
  return new;
end $$;

drop trigger if exists trg_app_registry_fuseau on app_registry;
create trigger trg_app_registry_fuseau
  before insert or update of timezone on app_registry
  for each row execute function mip_verifier_fuseau();
