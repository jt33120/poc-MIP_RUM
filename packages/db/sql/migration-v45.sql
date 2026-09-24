-- migration-v45 — Fatigue d'alerte : cadence dégressive sur le burn de SLO.
--
-- (v44 est réservé à la suppression définitive des objets IA dépréciés, en
--  attente dans sql/pending/ — d'où le saut de numéro.)
--
-- CONSTAT qui motive ce correctif (production, 2 juil. → 29 juil. 2026) :
--   • 637 alertes déclenchées, dont 624 en burn de SLO ;
--   • sur UN SEUL SLO, soit environ 23 par jour ;
--   • 0 acquittée, 0 livrée.
--
-- ⚠ CORRECTION (migration-v46) : le diagnostic ci-dessous est INCOMPLET. La
-- cadence n'était que le symptôme. La cause racine est un `slo.objective` stocké
-- en pourcent (99 au lieu de 0,99) qui rendait `fast_burn` TOUJOURS vrai — les
-- 624 alertes ne détectaient rien. Appliquée seule, cette migration aurait fait
-- passer 23 FAUSSES alertes par jour à ~3 FAUSSES alertes par jour. v45 reste
-- utile (elle borne la répétition d'une dégradation réelle), mais c'est v46 qui
-- corrige le défaut.
--
-- Le coupable n'est pas un bug mais une règle trop simple : check_slo_burn()
-- ré-alertait dès qu'aucun événement NON ACQUITTÉ n'existait dans la dernière
-- heure. Personne n'acquittant jamais, la garde se réduisait à « une alerte par
-- heure », indéfiniment, tant que le SLO brûle — soit 24 par jour pour un SLO
-- durablement dégradé. C'est le cas d'école de la fatigue d'alerte : le signal
-- se noie dans sa propre répétition.
--
-- CORRECTIF — cadence dégressive (backoff exponentiel plafonné) : tant que la
-- même dégradation persiste, on ré-alerte de moins en moins souvent.
--
--   alertes déjà émises (24 h) │ 0    1    2    3    ≥4
--   délai avant la suivante    │ 1 h  2 h  4 h  8 h  16 h
--
-- Un SLO chroniquement dégradé produit donc ~5 alertes en 31 h au lieu de 24 par
-- jour : la dégradation reste VISIBLE (on n'éteint rien), elle cesse d'être du
-- bruit. La cadence se réinitialise d'elle-même dès que le SLO tient 24 h sans
-- alerte — aucun état à stocker, aucune tâche de nettoyage.
--
-- CHANGEMENT DE SÉMANTIQUE ASSUMÉ : l'acquittement n'ouvre plus la porte à une
-- ré-alerte immédiate. Acquitter veut dire « j'ai vu », pas « renvoie-le-moi
-- tout de suite » ; l'ancienne lecture était précisément ce qui rendait la garde
-- inopérante en l'absence d'acquittement.
--
-- Idempotente (create or replace), aucune donnée déplacée, aucun objet supprimé.
-- Retour arrière : réappliquer la définition de check_slo_burn() de
-- migration-v17.sql (section 6).

create or replace function check_slo_burn() returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  s record; fired int := 0; ev_id bigint; msg text;
  episode int;          -- alertes déjà émises pour ce SLO sur 24 h
  cooldown interval;    -- délai minimal avant la prochaine
begin
  for s in select * from slo_status() where fast_burn loop
    select count(*) into episode
      from alert_event ae
     where ae.slo_id = s.slo_id
       and ae.fired_at > now() - interval '24 hours';

    -- 1 h, 2 h, 4 h, 8 h, puis 16 h (plafond) : le plafond garantit qu'une
    -- dégradation longue reste rappelée au moins une fois par demi-journée.
    cooldown := make_interval(hours => least(power(2, least(episode, 4))::int, 16));

    if not exists (
      select 1 from alert_event ae
       where ae.slo_id = s.slo_id
         and ae.fired_at > now() - cooldown
    ) then
      msg := format('SLO « %s » en burn rapide : atteinte %s%% (objectif %s%%, budget consommé %s%%, app %s%s)',
        s.name, round((s.attainment*100)::numeric,2), round((s.objective*100)::numeric,2),
        round(coalesce(s.burned_pct,0)::numeric,0), s.app_id, coalesce(', route ' || s.route, ''));
      insert into alert_event (slo_id, value, message, severity)
      values (s.slo_id, s.attainment, msg, 'critical') returning id into ev_id;
      fired := fired + 1;
      perform route_alert(ev_id, s.app_id, 'critical', '[MIP RUM] ' || msg,
        jsonb_build_object('source','mip-rum','app_id',s.app_id,'slo',s.name,
          'attainment',round(s.attainment::numeric,4),'severity','critical','text',msg));
    end if;
  end loop;
  return fired;
end $$;

comment on function check_slo_burn() is
  'Burn rapide de SLO -> alert_event + routage. Cadence dégressive 1/2/4/8/16 h '
  'selon le nombre d''alertes déjà émises sur 24 h (anti-fatigue, cf. migration-v45).';
