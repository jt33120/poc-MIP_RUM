-- migration-v55 — l'attribution des blocages du fil principal (Long Animation
-- Frames) entre dans `rum_longtask`, au lieu d'ouvrir une table à elle.
--
-- CE QU'ON GAGNE. Une entrée `longtask` disait « le fil principal a été bloqué
-- 180 ms ». Le symptôme, sans la cause : ni le script, ni la fonction, ni ce qui
-- l'a déclenchée. Un INP mauvais restait donc sans suite — la seule voie était
-- de reproduire le problème dans un profileur, sur un poste qui n'est pas celui
-- du visiteur. L'API Long Animation Frames porte cette attribution ; ces
-- colonnes sont ce qui la retient.
--
-- POURQUOI PAS UNE TABLE `rum_loaf`. Parce qu'une table applicative n'est jamais
-- seule dans ce schéma : elle doit être ajoutée à la purge de rétention
-- (migration-v09), à la purge par client (v14, v30), au comptage de volume
-- (v15), aux policies de cloisonnement (v16), à l'effacement RGPD (v18, v30) et
-- à lib/dsar.ts. Sept énumérations, dont l'oubli d'UNE SEULE veut dire soit une
-- donnée qui ne se purge jamais, soit une donnée qu'un effacement RGPD laisse
-- derrière lui. Or LoAF n'est pas un signal nouveau : c'est le MÊME fait —
-- le fil principal a bloqué — mieux décrit. Il se range donc là où il est déjà
-- purgé, compté, cloisonné et effaçable.
--
-- TOUTES LES COLONNES SONT NULLABLES, et c'est structurel : sur Safari et
-- Firefox l'API n'existe pas, le SDK retombe sur les Long Tasks, et les lignes
-- de ces navigateurs n'auront jamais d'attribution. `source` dit laquelle des
-- deux API a parlé — sans quoi une ligne sans script serait indistinguable
-- d'une frame dont le script n'a pas été identifié.

alter table rum_longtask add column if not exists source          text;
alter table rum_longtask add column if not exists blocking_ms     real;
alter table rum_longtask add column if not exists render_ms       real;
alter table rum_longtask add column if not exists script_url      text;
alter table rum_longtask add column if not exists script_function text;
alter table rum_longtask add column if not exists script_ms       real;
alter table rum_longtask add column if not exists invoker         text;

comment on column rum_longtask.source is
  '''longtask'' (API Long Tasks) ou ''loaf'' (Long Animation Frames). '
  'NULL sur les lignes antérieures au 09/09/2026, écrites avant que la distinction existe. '
  'Les deux API ne sont JAMAIS actives ensemble : un même blocage produit une entrée de chacune, '
  'et les compter toutes les deux doublerait le nombre de blocages.';
comment on column rum_longtask.blocking_ms is
  'Part de la frame qui a réellement bloqué le fil principal — plus petite que duration_ms, '
  'qui compte tout le cycle de rendu. C''est blocking_ms qui se rapproche de ce que vit l''utilisateur.';
comment on column rum_longtask.script_url is
  'URL du script le plus long de la frame, nettoyée de sa query string à la collecte. '
  'Un seul script est retenu, pas la liste : c''est celui qu''on corrige.';
comment on column rum_longtask.invoker is
  'Ce qui a lancé le script : ''BUTTON#payer.onclick'', ''Window.requestAnimationFrame''… '
  'Souvent plus parlant que le nom de la fonction, minifié en production.';

-- Le classement qu'on demande : « quels scripts bloquent le plus, sur cette app,
-- sur cette fenêtre ». Sans index, il faut lire toutes les lignes de la période.
-- Partiel : les lignes sans script — Long Tasks, ou frame non attribuée — n'ont
-- rien à y faire et représentent la majorité de l'historique.
create index if not exists idx_longtask_script
  on rum_longtask (app_id, ts, script_url)
  where script_url is not null;

-- ─────────────────────── RLS : rien à ajouter, et c'est le but ────────────────
-- `rum_longtask` porte déjà sa RLS et sa policy de lecture `console_ro` depuis
-- migration-v10 et migration-v16. Des COLONNES ajoutées à une table protégée
-- héritent de sa protection : c'est exactement ce qu'une table neuve n'aurait
-- pas fait, et la raison pour laquelle `scheduler_lease` a dû être rattrapée en
-- migration-v54. Vérifié plutôt qu'affirmé : le bloc ci-dessous échoue bruyamment
-- si l'héritage n'a pas eu lieu.
do $$
begin
  if not exists (
    select 1 from pg_tables where tablename = 'rum_longtask' and rowsecurity
  ) then
    raise exception 'rum_longtask sans RLS : les colonnes ajoutées ici seraient exposées';
  end if;
end $$;
