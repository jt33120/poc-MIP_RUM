-- migration-v50 — l'e-mail part de Postgres, pas de la console.
--
-- CORRECTION DE CONCEPTION SUR migration-v49. v49 faisait relayer l'e-mail par la
-- console (POST /api/alerts/email), au motif de garder la clé du fournisseur hors
-- de la base. L'intention était bonne, la conséquence mauvaise :
--
--   • Un système d'alerte ne doit pas dépendre du système qu'il surveille. Faire
--     passer les notifications par la console, c'est perdre les alertes
--     exactement quand la console tombe — le moment où elles comptent le plus.
--   • Un saut réseau de plus, un jeton de plus, un déploiement de plus à faire
--     vivre, pour zéro bénéfice de sécurité réel.
--
-- pg_net sait poser des en-têtes HTTP : Postgres peut appeler l'API du
-- fournisseur directement. Et le secret n'a pas à vivre dans une colonne : le
-- coffre Supabase (`vault`) le chiffre au repos et le tient hors des sauvegardes
-- en clair et des journaux.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `alert_config.email_from` — l'adresse d'expédition (publique, pas secrète).
--   2. `route_alert` : `kind='email'` appelle l'API du fournisseur directement,
--      clé lue dans `vault.decrypted_secrets` sous le nom `alert_email_api_key`.
--   3. Sujet construit en SQL : sévérité + première ligne du message, pour qu'une
--      alerte se lise dans la liste des messages sans avoir à l'ouvrir.
--
-- LE RELAIS PAR LA CONSOLE RESTE DISPONIBLE, et c'est délibéré : `vault` est une
-- extension Supabase. Une installation SELF-HOST sans coffre garde le chemin de
-- v49 en renseignant `alert_config.email_relay_url`. L'ordre de préférence est
-- explicite : coffre d'abord, relais ensuite, `skipped` sinon.
--
-- FAIL-CLOSED CONSERVÉ. Sans clé ET sans relais, la livraison est `skipped` avec
-- sa raison — jamais un statut qui laisserait croire à un envoi.
--
-- Idempotente.

alter table alert_config add column if not exists email_from text;

comment on column alert_config.email_from is
  'Adresse d''expédition des alertes (doit être vérifiée chez le fournisseur). '
  'Publique : la clé d''API, elle, vit dans vault sous le nom alert_email_api_key.';

-- ── Routage ──────────────────────────────────────────────────────────────────
create or replace function route_alert(p_event_id bigint, p_app_id text, p_severity text, p_text text, p_payload jsonb)
returns int language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  ch record; req_id bigint; sent int := 0;
  relay text; from_addr text; api_key text; subject text;
begin
  select email_relay_url, email_from into relay, from_addr from alert_config where singleton;

  -- Clé du fournisseur : lue dans le coffre. Absent (self-host) -> null, et on
  -- retombe proprement sur le relais console ou sur `skipped`.
  begin
    select decrypted_secret into api_key
      from vault.decrypted_secrets where name = 'alert_email_api_key';
  exception when others then
    api_key := null;
  end;

  -- Sujet lisible dans une liste de messages : sévérité + première ligne.
  subject := '[MIP RUM ' || upper(p_severity) || '] ' || left(split_part(p_text, E'\n', 1), 120);

  for ch in
    select * from notify_channel
     where active and severity_rank(severity_min) <= severity_rank(p_severity)
       and (app_id is null or app_id = p_app_id)
  loop
    insert into alert_delivery (alert_event_id, target) values (p_event_id, ch.target);

    if ch.kind = 'email'
       and (api_key is null or from_addr is null or from_addr = '')
       and (relay is null or relay = '') then
      update alert_delivery
         set status = 'skipped',
             response = 'e-mail non configuré : ni clé au coffre (alert_email_api_key) '
                        || 'ni relais (alert_config.email_relay_url)'
       where alert_event_id = p_event_id and target = ch.target and status = 'queued';
      continue;
    end if;

    begin
      if ch.kind = 'email' and api_key is not null and coalesce(from_addr, '') <> '' then
        -- Chemin direct : Postgres -> fournisseur. Aucune dépendance à la console.
        select net.http_post(
          url := 'https://api.resend.com/emails',
          body := jsonb_build_object(
            'from', from_addr,
            'to', jsonb_build_array(ch.target),
            'subject', subject,
            'text', p_text || E'\n\nSévérité : ' || p_severity
                    || E'\n\nDétail :\n' || coalesce(p_payload::text, '{}')
                    || E'\n\n— MIP RUM, supervision automatique.'),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || api_key)
        ) into req_id;
      elsif ch.kind = 'email' then
        -- Repli self-host : relais par la console (migration-v49).
        select net.http_post(
          url := relay,
          body := jsonb_build_object('to', ch.target, 'severity', p_severity,
                                     'text', p_text, 'payload', p_payload)
        ) into req_id;
      else
        select net.http_post(
          url := ch.target,
          body := case when ch.kind = 'slack' then jsonb_build_object('text', p_text)
                       else p_payload end
        ) into req_id;
      end if;

      update alert_delivery
         set status = 'sent', request_id = req_id,
             response = 'pg_net request ' || req_id || ' (résultat non encore réconcilié)'
       where alert_event_id = p_event_id and target = ch.target and status = 'queued';
      sent := sent + 1;
    exception when others then
      -- Pas de pg_net (local/CI) : la ligne RESTE `queued` — contrat du
      -- dispatcher local, qui traite `queued` tout de suite mais `failed`
      -- seulement après un délai de reprise.
      update alert_delivery
         set response = 'pg_net indisponible, remis au dispatcher local : ' || sqlerrm
       where alert_event_id = p_event_id and target = ch.target and status = 'queued';
    end;
  end loop;
  return sent;
end $fn$;

comment on function route_alert(bigint, text, text, text, jsonb) is
  'Notifie les canaux éligibles. E-mail : appel direct au fournisseur (clé au '
  'coffre), sinon relais console, sinon skipped. Le statut « sent » ne vaut pas '
  'livraison : voir reconcile_alert_deliveries().';
