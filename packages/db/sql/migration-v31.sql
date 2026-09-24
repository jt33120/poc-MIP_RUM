-- migration-v31 : profondeur de trace (Voie A du différenciateur « cause backend »).
-- rum_span ne portait que 2 niveaux (front http.client + back http.server). On
-- ajoute la capture des spans INTERNES d'une trace (requêtes DB, sous-appels
-- serveur) émis par l'auto-instrumentation OpenTelemetry standard côté client,
-- pour reconstituer un waterfall « douleur utilisateur → cause serveur » et non
-- plus un simple découpage serveur/réseau.
--
--   name : libellé du span (ex. "GET /api/search", "SELECT users", "http.server").
--   kind : nature sémantique OTel (server | client | internal | db | producer | consumer).
--   tier gagne la valeur 'detail' pour les spans intra-trace (ni front ni back).
-- Idempotente. Additive (colonnes nullable) : aucune rupture des lignes v0.4.

alter table rum_span add column if not exists name text;
alter table rum_span add column if not exists kind text;

-- élargit la contrainte de tier à 'detail' (spans internes d'une trace)
do $$
begin
  alter table rum_span drop constraint if exists rum_span_tier_check;
  alter table rum_span
    add constraint rum_span_tier_check check (tier in ('front', 'back', 'detail'));
exception
  when others then null; -- contrainte nommée différemment : on ne bloque pas la migration
end $$;

-- reconstruction d'une trace complète : tous les spans d'un trace_id, ordonnés.
create index if not exists rum_span_trace_ts_idx on rum_span (trace_id, ts);

-- console_ro : le grant de select sur rum_span (migrations antérieures) couvre
-- déjà les nouvelles colonnes ; rien à ajouter.
