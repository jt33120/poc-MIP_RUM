-- migration-v88 — P5 : la livraison sort de la base, l'e-mail part du notifier.
--
-- Additive et rejouable, PostgreSQL 15 à 17. v87 (`platform_flag`, P3) est le
-- fichier précédent ; ce fichier prend v88 — le plan backend la réservait à
-- `mip_api` (P4), qui glisse à v89, et ainsi de suite.
--
-- ═══════════════════════════ 1. route_alert SANS pg_net ═════════════════════
--
-- CE QUI NE MARCHAIT PLUS. `route_alert` (v50) tentait l'envoi DEPUIS Postgres :
-- pg_net vers le webhook, et pour un canal e-mail, pg_net vers Resend avec une clé
-- lue au coffre Supabase, sinon vers le relais de la console. Sur Neon, ni pg_net
-- ni le coffre n'existent. Les webhooks s'en sortaient — la ligne restait `queued`
-- et le dispatcher local la postait —, mais une livraison e-mail sans clé au
-- coffre ni relais était soldée `skipped` ICI, avant qu'aucun livreur ne la voie.
-- Résultat, relevé en production : aucun e-mail d'alerte n'est jamais parti.
--
-- CE QUI CHANGE. `route_alert` ne fait plus qu'une chose : une ligne `queued` par
-- canal éligible (sévérité ≥ seuil du canal, canal de l'app ou global). L'envoi
-- appartient au livreur (`packages/backend/lib/dispatch-alerts.mjs`) : webhook
-- pour une URL, Resend pour une adresse — depuis le service `notifier`, seul
-- détenteur de la clé. Un livreur SANS clé Resend solde la ligne `skipped` avec
-- la raison : le fail-closed de v50 est conservé, il a seulement changé de côté.
--
-- La valeur rendue change de sens : le nombre de livraisons MISES EN FILE (v50 :
-- le nombre de requêtes pg_net, soit 0 sur Neon). Tous les appelants font
-- `perform route_alert(…)` ; aucun ne la lit.
--
-- ═══════════════════════════ 2. LE RELAIS DE LA CONSOLE ═════════════════════
--
-- `alert_config.email_relay_url` portait l'URL du relais `POST /api/alerts/email`
-- de la console, JETON COMPRIS : un secret en clair dans une colonne. La route est
-- retirée avec ce lot (Vercel ne détient plus de secret sortant) ; la valeur est
-- effacée, la colonne reste (contrat : on ne retire pas une colonne dans le lot
-- qui cesse de la lire). `email_from` n'est plus lu non plus : l'expéditeur est
-- `ALERT_EMAIL_FROM`, sur le notifier.
--
-- ═══════════════════════ 3. RÉFÉRENCES DE SECRETS DE TICKETS ════════════════
--
-- La contrainte de v84 accepte `env:<N'IMPORTE QUELLE VARIABLE>`. Or la valeur
-- résolue part en jeton porteur chez le fournisseur : `env:DATABASE_URL` ferait
-- sortir la chaîne de connexion. Le code refuse ces références depuis P1, à
-- l'écriture ET à la résolution (`integrations/tickets/secrets.mjs`) ; le schéma
-- s'aligne ici : `env:TICKET_…` seulement, hors des deux noms réservés
-- (`TICKET_SECRET_KEY…`, la clé qui déchiffre toutes les références `enc:` ;
-- `TICKET_INTEGRATIONS`, un interrupteur).
--
-- POURQUOI VALIDÉE, ET PAS NOT VALID. Une contrainte NOT VALID tolère la ligne
-- ancienne… mais contrôle toute ÉCRITURE sur elle, y compris celle du livreur qui
-- veut la passer en `degraded` : la ligne serait restée `active`, refusée à
-- chaque passe, sans que la console le montre (constaté en écrivant ce fichier).
-- Une ligne hors périmètre est donc NEUTRALISÉE avant la contrainte : référence
-- remplacée par `env:TICKET_REFERENCE_REFUSEE_V88` (un nom, jamais une valeur),
-- intégration désactivée, `degraded`, `variable_hors_perimetre` — l'état honnête :
-- elle ne pouvait déjà plus servir, la résolution la refusait. L'administrateur
-- la voit dans la console et y pose une variable `TICKET_…`. La production n'en
-- porte aucune (relevé du 23/09 : zéro intégration de tickets).

create or replace function route_alert(p_event_id bigint, p_app_id text, p_severity text, p_text text, p_payload jsonb)
returns int language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  ch record;
  en_file int := 0;
begin
  for ch in
    select * from notify_channel
     where active and severity_rank(severity_min) <= severity_rank(p_severity)
       and (app_id is null or app_id = p_app_id)
  loop
    insert into alert_delivery (alert_event_id, target) values (p_event_id, ch.target);
    en_file := en_file + 1;
  end loop;
  return en_file;
end $fn$;

comment on function route_alert(bigint, text, text, text, jsonb) is
  'Met en file une livraison queued par canal éligible (sévérité ≥ seuil). L''envoi — '
  'webhook ou e-mail Resend — appartient au livreur (service notifier), migration-v88.';

update alert_config set email_relay_url = null where email_relay_url is not null;

comment on column alert_config.email_relay_url is
  'OBSOLÈTE depuis migration-v88 : plus lue. Portait l''URL (jeton compris) du relais e-mail '
  'de la console, retiré ; l''e-mail part du service notifier.';
comment on column alert_config.email_from is
  'OBSOLÈTE depuis migration-v88 : plus lue. L''expéditeur est ALERT_EMAIL_FROM, sur le service notifier.';

update ticket_integration
   set credential_ref = 'env:TICKET_REFERENCE_REFUSEE_V88',
       enabled = false, state = 'degraded', last_error = 'variable_hors_perimetre',
       config_version = config_version + 1, updated_at = now()
 where not (
   (credential_ref ~ '^env:TICKET_[A-Z0-9_]{1,57}$'
      and credential_ref !~ '^env:TICKET_SECRET_KEY'
      and credential_ref <> 'env:TICKET_INTEGRATIONS')
   or (credential_ref ~ '^enc:v1:[A-Za-z0-9+/=]+$' and char_length(credential_ref) between 23 and 4096)
 );

-- Un secret de webhook hors périmètre : retiré. Sans lui, les webhooks entrants
-- de cette intégration sont refusés (non vérifiables) — un échec fermé.
update ticket_integration
   set webhook_secret_ref = null, state = 'degraded', last_error = 'variable_hors_perimetre',
       config_version = config_version + 1, updated_at = now()
 where webhook_secret_ref is not null and not (
   (webhook_secret_ref ~ '^env:TICKET_[A-Z0-9_]{1,57}$'
      and webhook_secret_ref !~ '^env:TICKET_SECRET_KEY'
      and webhook_secret_ref <> 'env:TICKET_INTEGRATIONS')
   or (webhook_secret_ref ~ '^enc:v1:[A-Za-z0-9+/=]+$' and char_length(webhook_secret_ref) between 23 and 4096)
 );

alter table ticket_integration drop constraint if exists ticket_integration_credential_v88;
alter table ticket_integration add constraint ticket_integration_credential_v88 check (
  (credential_ref ~ '^env:TICKET_[A-Z0-9_]{1,57}$'
     and credential_ref !~ '^env:TICKET_SECRET_KEY'
     and credential_ref <> 'env:TICKET_INTEGRATIONS')
  or (credential_ref ~ '^enc:v1:[A-Za-z0-9+/=]+$' and char_length(credential_ref) between 23 and 4096)
);

alter table ticket_integration drop constraint if exists ticket_integration_webhook_v88;
alter table ticket_integration add constraint ticket_integration_webhook_v88 check (
  webhook_secret_ref is null
  or (webhook_secret_ref ~ '^env:TICKET_[A-Z0-9_]{1,57}$'
        and webhook_secret_ref !~ '^env:TICKET_SECRET_KEY'
        and webhook_secret_ref <> 'env:TICKET_INTEGRATIONS')
  or (webhook_secret_ref ~ '^enc:v1:[A-Za-z0-9+/=]+$' and char_length(webhook_secret_ref) between 23 and 4096)
);
