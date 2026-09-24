-- migration-v53 — Contexte manquant sur la session : version de l'app, qualité du lien.
--
-- POURQUOI SUR LA SESSION ET NON EN MÉTRIQUE. Ce sont des DIMENSIONS, pas des
-- mesures : on segmente par elles (« le p75 s'est dégradé sur quelle version ? »,
-- « nos utilisateurs en 3g souffrent-ils plus ? »), on ne les agrège pas. Les
-- porter sur rum_session les rend disponibles à toutes les tables filles par
-- jointure, exactement comme is_bot et collection_source.
--
-- `release` existait déjà sur rum_error, pour choisir la bonne source map à la
-- dé-minification. Il ne servait donc qu'aux erreurs : impossible de rattacher une
-- régression de PERFORMANCE à une mise en production, alors que c'est la première
-- question qu'on se pose devant une courbe qui décroche.
--
-- `net_type` vient de navigator.connection.effectiveType. Deux limites à connaître
-- avant de s'en servir : c'est une ESTIMATION du navigateur d'après les temps
-- observés — un wifi saturé s'y déclare « 3g » — et l'API n'existe que sur
-- Chromium, donc la colonne reste NULL sur Safari et Firefox. Ce n'est pas
-- l'opérateur réseau, qu'aucun navigateur n'expose : l'obtenir exigerait une
-- résolution IP -> ASN à l'ingestion, incompatible avec l'engagement « aucune
-- adresse IP stockée ».
alter table rum_session add column if not exists release  text;
alter table rum_session add column if not exists net_type text;

comment on column rum_session.release is
  'Version de l''app déclarée par le SDK (mip.release) — segmentation par mise en production.';
comment on column rum_session.net_type is
  'Qualité de lien estimée par le navigateur (4g/3g/2g/slow-2g). NULL hors Chromium. Jamais l''opérateur.';

-- Segmenter par version est la lecture visée ; sans index, elle scanne la table.
create index if not exists idx_session_app_release on rum_session (app_id, release)
  where release is not null;
