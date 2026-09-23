-- migration-v49 — la boucle d'alerte se ferme : e-mail livré, et « envoyé » cesse
-- de vouloir dire « mis dans la file ».
--
-- DEUX CONSTATS
--
-- 1. `route_alert` marquait le canal e-mail `skipped` avec le message « canal
--    payant non branché ». Aucune alerte ne partait donc vers un humain — 0
--    livraison sur 639 événements en production.
--
-- 2. Moins visible et plus gênant : pour les canaux webhook/slack, `route_alert`
--    écrit `status = 'sent'` DÈS QUE `net.http_post` rend la main. Or pg_net est
--    ASYNCHRONE : il retourne un identifiant de requête, pas un résultat. Le code
--    HTTP réel arrive plus tard dans `net._http_response`. Autrement dit, un
--    webhook qui répond 404, 500, ou qui expire, était jusqu'ici enregistré
--    « sent » — indistinguable d'une livraison réussie. La table qui doit prouver
--    que la boucle est fermée ne prouvait que l'intention de l'ouvrir.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. `alert_delivery` mémorise `request_id` (identifiant pg_net) et `http_status`.
--   2. `route_alert` gère `kind='email'` en relayant vers la console, qui détient
--      le fournisseur d'envoi et sa clé. Le secret reste hors de la base : la
--      seule chose stockée est l'URL du relais — même modèle de confiance qu'une
--      URL de webhook Slack, déjà stockée en clair dans `notify_channel.target`.
--   3. `reconcile_alert_deliveries()` relit `net._http_response` et transforme
--      `sent` en `delivered` (2xx) ou `failed` (tout le reste, y compris
--      l'expiration), en conservant le code et un extrait de la réponse.
--      Planifiée toutes les 5 minutes.
--
-- STATUTS APRÈS CETTE MIGRATION
--   queued    -> insérée, pas encore transmise
--   sent      -> requête acceptée par pg_net, RÉSULTAT INCONNU (état transitoire)
--   delivered -> 2xx confirmé par la réponse HTTP
--   failed    -> non-2xx, expiration, ou erreur réseau
--   skipped   -> aucun relais configuré (l'e-mail ne peut pas partir)
--
-- `delivered` est le seul statut qui autorise à dire que la boucle est fermée.
-- Une console qui afficherait `sent` comme un succès mentirait ; c'est corrigé
-- côté interface dans le même incrément.
--
-- Idempotente.

-- ── 1. Traçabilité du résultat réel ──────────────────────────────────────────
alter table alert_delivery add column if not exists request_id  bigint;
alter table alert_delivery add column if not exists http_status int;

comment on column alert_delivery.request_id is
  'Identifiant de requête pg_net. Sert à retrouver le résultat dans net._http_response.';
comment on column alert_delivery.http_status is
  'Code HTTP réellement observé. NULL tant que la réconciliation n''a pas eu lieu.';

create index if not exists idx_delivery_pending
  on alert_delivery (request_id) where status = 'sent';

-- ── 2. Où relayer les e-mails ────────────────────────────────────────────────
-- Table à ligne unique. `email_relay_url` pointe l'endpoint de la console
-- (/api/alerts/email) et porte son jeton dans l'URL : c'est un SECRET, au même
-- titre qu'une URL de webhook Slack. On ne stocke pas de clé de fournisseur ici —
-- elle vit dans l'environnement de la console, où elle a sa place.
create table if not exists alert_config (
  singleton       boolean primary key default true check (singleton),
  email_relay_url text,
  updated_at      timestamptz not null default now()
);
insert into alert_config (singleton) values (true) on conflict do nothing;

-- Créée APRÈS les migrations de grants : la console ne la lirait pas sans ceci.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on alert_config to console_ro;
  end if;
end $$;

comment on table alert_config is
  'Configuration globale du routage d''alertes. email_relay_url contient un secret '
  '(jeton dans l''URL) : même modèle de confiance qu''une URL de webhook.';

-- ── 3. Routage : l'e-mail part réellement, et on retient le request_id ───────
create or replace function route_alert(p_event_id bigint, p_app_id text, p_severity text, p_text text, p_payload jsonb)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  ch record; req_id bigint; sent int := 0;
  relay text;
begin
  select email_relay_url into relay from alert_config where singleton;

  for ch in
    select * from notify_channel
     where active and severity_rank(severity_min) <= severity_rank(p_severity)
       and (app_id is null or app_id = p_app_id)
  loop
    insert into alert_delivery (alert_event_id, target) values (p_event_id, ch.target);

    -- E-mail sans relais configuré : on le dit explicitement plutôt que de
    -- laisser croire à un envoi. `skipped` n'est PAS un succès.
    if ch.kind = 'email' and (relay is null or relay = '') then
      update alert_delivery
         set status = 'skipped',
             response = 'aucun relais e-mail configuré (alert_config.email_relay_url)'
       where alert_event_id = p_event_id and target = ch.target and status = 'queued';
      continue;
    end if;

    begin
      select net.http_post(
        url := case when ch.kind = 'email' then relay else ch.target end,
        body := case
                  when ch.kind = 'email' then jsonb_build_object(
                    'to', ch.target, 'severity', p_severity,
                    'text', p_text, 'payload', p_payload)
                  when ch.kind = 'slack' then jsonb_build_object('text', p_text)
                  else p_payload
                end
      ) into req_id;

      update alert_delivery
         set status = 'sent', request_id = req_id,
             response = 'pg_net request ' || req_id || ' (résultat non encore réconcilié)'
       where alert_event_id = p_event_id and target = ch.target and status = 'queued';
      sent := sent + 1;
    exception when others then
      -- Pas de pg_net (local/CI) : la ligne RESTE `queued`, elle n'est pas `failed`.
      -- La distinction n'est pas cosmétique : dispatch-alerts.mjs traite `queued`
      -- immédiatement, mais `failed` seulement après un délai de reprise
      -- (30 s × 2^attempts) et en consommant une tentative. Marquer `failed` ce
      -- qui n'a jamais été tenté retarderait la livraison locale.
      update alert_delivery
         set response = 'pg_net indisponible, remis au dispatcher local : ' || sqlerrm
       where alert_event_id = p_event_id and target = ch.target and status = 'queued';
    end;
  end loop;
  return sent;
end $$;

-- ── 4. Réconciliation : « sent » devient « delivered » ou « failed » ─────────
-- Sans cette fonction, `sent` est un statut terminal qui ne prouve rien. pg_net
-- range le résultat dans net._http_response (purgée périodiquement, d'où la
-- réconciliation fréquente). Une livraison restée `sent` au-delà d'une heure est
-- déclarée `failed` : l'absence durable de réponse est un échec, pas un suspens.
create or replace function reconcile_alert_deliveries() returns int
language plpgsql security definer
set search_path = public, pg_temp as $$
declare n int := 0;
begin
  begin
    with r as (
      select d.id,
             resp.status_code,
             coalesce(left(resp.content, 300), resp.error_msg) as body
        from alert_delivery d
        join net._http_response resp on resp.id = d.request_id
       where d.status = 'sent' and d.request_id is not null
    )
    update alert_delivery d
       set status      = case when r.status_code between 200 and 299 then 'delivered' else 'failed' end,
           http_status = r.status_code,
           response    = coalesce('HTTP ' || r.status_code || ' — ' || r.body, 'HTTP ' || r.status_code)
      from r where d.id = r.id;
    get diagnostics n = row_count;
  exception when undefined_table then
    -- pg_net absent (local/CI) : rien à rapprocher, mais on NE SORT PAS — le
    -- balayage des livraisons expirées ci-dessous doit avoir lieu quand même.
    n := 0;
  end;

  -- Sans réponse au bout d'une heure, la requête est perdue (réponse purgée,
  -- expiration réseau). On tranche plutôt que de laisser un statut ambigu.
  update alert_delivery
     set status = 'failed',
         response = 'aucune réponse HTTP après 1 h (requête perdue ou expirée)'
   where status = 'sent' and attempted_at < now() - interval '1 hour';

  return n;
end $$;

comment on function reconcile_alert_deliveries() is
  'Transforme les livraisons « sent » (requête pg_net acceptée) en « delivered » '
  '(2xx confirmé) ou « failed ». Sans elle, « sent » ne prouve aucune livraison.';

-- ── 5. Planification ─────────────────────────────────────────────────────────
do $$
begin
  perform cron.schedule('reconcile-alert-deliveries', '*/5 * * * *',
                        $c$select reconcile_alert_deliveries();$c$);
exception when others then
  null; -- pg_cron absent (local/CI) : la fonction reste appelable à la main
end $$;
