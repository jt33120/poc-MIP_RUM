-- migration-v85 — P8.7 : provenance du pays estimé (GeoIP optionnel).
--
-- Additive et rejouable, PostgreSQL 15 à 17. DEUX COLONNES, AUCUNE TABLE.
-- v81 est prise par P8.1, v82 par P7.5, v83 par P8.2, v84 est réservée à P8.6
-- (développé en parallèle) : ce fichier prend v85.
--
-- ═══════════════ 1. POURQUOI AUCUNE TABLE, ET AUCUNE FONCTION TOUCHÉE ════════
--
-- Ce lot n'ajoute pas une donnée nouvelle : il dit d'OÙ VIENT une donnée qui
-- existe déjà. `rum_session.geo_country` est écrit depuis le lot B1 ; ce qui
-- manquait, c'est de savoir s'il a été déduit du fuseau horaire du terminal, lu
-- dans une base IP→pays locale, ou repris d'un en-tête posé par un CDN. Trois
-- provenances qui ne valent pas la même chose, et que rien ne distinguait une
-- fois la ligne écrite.
--
-- Deux colonnes sur une table QUI EXISTE DÉJÀ, c'est aussi :
--   · aucune ligne à raccrocher à `erase_app_data`, `purge_rum_app`,
--     `erase_session` ni aux exports DSAR — `rum_session` est l'ANCRE de ce
--     périmètre, et un `select *` / `delete` sur elle emporte ses colonnes ;
--   · aucune entrée à ajouter à `DSAR_CHILD_TABLES`, dont le contrat est « toute
--     table portant un `session_id` ». Créer ici une table `rum_session_geo`
--     aurait obligé à l'y inscrire, sous peine d'un export art. 15 incomplet et
--     d'un effacement art. 17 partiel. La plus petite migration qui dit la
--     vérité est celle qui n'ajoute pas ce qu'il faudrait ensuite rattraper.
--   · aucune recopie de définition de fonction — le geste qui a fait perdre
--     `analytics_saved_view` et `dashboard` entre v79 et v80.
--
-- ═══════════════════ 2. CE QUE CES COLONNES DISENT, ET NE DISENT PAS ═════════
--
-- `geo_source` ∈ {geoip, timezone, cdn} :
--   · `timezone` — déduit de `mip.tz`, un RÉGLAGE du terminal. Le client le
--     choisit ; une zone couvre souvent plusieurs pays. C'est la provenance de
--     tout l'historique antérieur à ce lot, et elle reste le défaut.
--   · `geoip`    — lu dans une base DB-IP Lite chargée en mémoire du processus
--     d'ingestion. Situe une ADRESSE, le plus souvent celle d'un opérateur, d'un
--     relais d'entreprise ou d'un VPN. Ce n'est pas la position d'une personne.
--   · `cdn`      — en-tête pays d'un CDN en façade. Même nature que `geoip`,
--     mais la résolution a eu lieu chez un tiers.
--
-- `geo_db_version` ne vaut quelque chose QUE pour `geoip` : le nom de la
-- livraison DB-IP qui a répondu (`dbip-country-lite-2026-09`). Une base se
-- périme — les plages se réattribuent d'un pays à l'autre —, et savoir avec
-- quelle livraison une ligne a été écrite est la seule façon de relire un
-- chiffre ancien sans le surinterpréter.
--
-- AUCUNE ADRESSE IP N'EST STOCKÉE ICI, NI AILLEURS. Ni en clair, ni hachée, ni
-- tronquée, ni temporairement. Il n'existe donc aucune colonne à purger, et
-- aucun backfill GeoIP ne sera jamais possible sur l'historique : l'information
-- de départ n'a jamais existé. Ce n'est pas un manque à combler plus tard, c'est
-- une limite définitive — et c'est le résultat voulu de la minimisation.
--
-- ═════════════════════════════ 3. HISTORIQUE ════════════════════════════════
--
-- Aucun backfill. Les lignes antérieures gardent `geo_source` à NULL, et c'est
-- EXACT : on ne sait pas de quelle provenance elles viennent. Les écrans les
-- annoncent « Inconnue », jamais « fuseau » — inférer que tout l'historique
-- vient du fuseau serait vraisemblable, et faux pour les lignes écrites derrière
-- un CDN qui posait déjà son en-tête pays.
--
-- ══════════════════════════════ 4. INDEX : AUCUN ════════════════════════════
--
-- `geo_source` a trois valeurs et NULL : un index b-tree n'y a aucune
-- sélectivité, et le planificateur ne le choisirait pas. Les lectures de ce lot
-- filtrent d'abord par `(app_id, last_seen_at)`, déjà indexé
-- (`idx_session_app_seen`), et la provenance ne fait que raffiner un ensemble
-- déjà réduit. Le premier lecteur qui mesurerait le contraire le créera, sur sa
-- table, avec son pré-déploiement CONCURRENTLY.
--
-- ══════════════════════════════ 5. VERROUS ══════════════════════════════════
--
-- Un seul `alter table` sur `rum_session`, ACCESS EXCLUSIVE tenu jusqu'au commit.
-- L'instruction ne modifie que le catalogue (colonnes nullables sans défaut :
-- aucune réécriture de table). `lock_timeout` borne l'attente ; s'il expire, le
-- fichier entier est annulé et le déploiement rejoué.
--
-- FENÊTRE DE DÉPLOIEMENT. Le code de P8.7 publié AVANT ce fichier détecte
-- l'absence des colonnes (`colonnesInsert`/`clauseConflitSession` sondent le
-- schéma) et écrit comme avant. Le code ANTÉRIEUR encore en service APRÈS ce
-- fichier n'écrit pas ces colonnes : NULL, c'est-à-dire inconnu. Aucune
-- contrainte ne porte sur une colonne existante — une ligne écrite par l'ancien
-- code ne peut pas faire échouer un lot.
set local lock_timeout = '5s';

alter table rum_session
  add column if not exists geo_source text,
  add column if not exists geo_db_version text,
  drop constraint if exists rum_session_geo_v85,
  add constraint rum_session_geo_v85 check (
    (geo_source is null or geo_source in ('geoip', 'timezone', 'cdn'))
    -- La version de base n'a de sens que pour une résolution locale : la porter
    -- sur une provenance `timezone` laisserait croire qu'une base a répondu.
    and (geo_db_version is null or geo_source = 'geoip')
    and (geo_db_version is null or geo_db_version ~ '^dbip-country-lite-[0-9]{4}-[0-9]{2}$')
    -- Une provenance sans pays ne veut rien dire : on ne trace pas l'origine
    -- d'une valeur absente.
    and (geo_source is null or geo_country is not null)
  ) not valid;

-- NOT VALID, ET C'EST MESURÉ. Les lignes antérieures portent NULL des deux
-- côtés et respectent donc la contrainte ; la valider parcourrait `rum_session`
-- entière sous verrou pour ne rien démontrer de plus. La contrainte s'applique
-- intégralement aux lignes NOUVELLES, qui sont les seules concernées.

comment on column rum_session.geo_source is
  'D''où vient geo_country : geoip (base IP→pays locale, en mémoire du processus d''ingestion), '
  'timezone (déduit de mip.tz, un réglage du terminal), cdn (en-tête pays d''un CDN en façade). '
  'NULL = provenance inconnue, cas de tout l''historique antérieur à v85. Aucune de ces provenances '
  'ne localise une personne : elles situent une adresse ou décrivent un réglage.';
comment on column rum_session.geo_db_version is
  'Livraison DB-IP Lite qui a répondu (dbip-country-lite-AAAA-MM), et seulement quand geo_source '
  'vaut geoip. Les plages se réattribuent d''un pays à l''autre : sans la version, un pays ancien '
  'ne serait plus relisible.';
