-- migration-v58 — deux biais de mesure, tous deux invisibles à l'écran.
--
-- Findings 1.5 et 2.4 de docs/AUDIT_RUM_EXTERNE.md (lot 3, « le plus
-- structurant »). Ils vont dans des sens OPPOSÉS, ce qui explique qu'aucun des
-- deux n'ait sauté aux yeux : le premier rend le p75 optimiste, le second le
-- rend pessimiste. Se compenser n'est pas être juste.

-- ══════════ 1.5 — CLS et INP comptés plusieurs fois par page vue ═════════════
--
-- `web-vitals` rappelle `onCLS`/`onINP` à CHAQUE passage de l'onglet en
-- `hidden`, tant que le delta est non nul. Un onglet masqué puis réaffiché trois
-- fois produisait TROIS lignes pour UNE page vue. Et comme CLS et INP sont
-- monotones croissants sur la durée de vie de la page, les rapports
-- intermédiaires sont SYSTÉMATIQUEMENT plus favorables que le rapport final :
-- le p75 affiché penchait du bon côté, ce qui est la pire façon de se tromper.
--
-- Le SDK émettait déjà `webvital.id` — l'identifiant que la bibliothèque expose
-- exactement pour ça, stable sur toute la vie d'une métrique et différent d'un
-- chargement à l'autre — avec un commentaire disant qu'il sert à ne pas
-- double-compter. L'ingestion le jetait. L'information n'existait donc pas en
-- base, et le défaut n'était pas rattrapable au requêtage.
alter table rum_metric add column if not exists metric_uid text;

comment on column rum_metric.metric_uid is
  'webvital.id : identifie UNE métrique pour UN chargement de page. Plusieurs rapports '
  'successifs de la même métrique le partagent ; deux chargements ne le partagent jamais. '
  'NULL sur les lignes écrites avant le 09/09/2026 et par les SDK non mis à jour.';

-- Partiel : l'historique sans identifiant n'a rien à y faire, et deux lignes
-- anciennes ne doivent pas entrer en conflit.
create unique index if not exists uq_metric_report
  on rum_metric (session_id, name, metric_uid)
  where metric_uid is not null;

-- ═══════════ 2.4 — le poids d'échantillonnage, et pourquoi 1/taux est FAUX ════
--
-- `sampleRate` n'était stocké nulle part. À `sampleRate: 0.1` — que
-- docs/INTEGRATION.md RECOMMANDAIT — « Sessions », « Pages vues » et
-- « Occurrences » affichaient 10 % de la réalité, sans mention.
--
-- L'audit propose `weight = 1 / sample_rate`. CETTE FORMULE NE CORRIGE PAS LE
-- DÉFAUT LE PLUS VISIBLE, et on peut le montrer. L'échantillonnage de ce SDK
-- n'est pas uniforme : il est BIAISÉ-ERREURS (packages/rum-sdk/src/sampling.ts).
--
--   P(full)          = sr                      → tout est émis
--   P(error-biased)  = (1 - sr) · esr          → SEULES les erreurs sont émises,
--                                                 puis la session est promue
--   P(off)           = (1 - sr) · (1 - esr)    → rien n'est émis
--
-- Une session SANS erreur en mode `error-biased` n'émet donc RIEN : elle
-- n'apparaît pas. D'où deux probabilités d'inclusion distinctes :
--
--   session avec erreur : p = sr + (1 - sr) · esr
--   session sans erreur : p = sr
--
-- Avec sr = 0,1 et esr = 1 (les valeurs par défaut), sur 100 sessions dont 1 en
-- erreur — soit 1 % d'erreur réel :
--
--   poids naïf 1/sr = 10 partout   →  10 / 109  ≈ 9,2 %   (le défaut, intact)
--   poids par probabilité réelle   →   1 / 100  =  1 %     (juste)
--
-- Le poids est donc DÉRIVÉ, colonne générée, sur le modèle de `id_kind`
-- (migration-v57) : deux colonnes pour un seul fait finissent par se
-- contredire, et PostgreSQL refuse qu'on écrive une colonne générée.
alter table rum_session add column if not exists sample_rate double precision not null default 1;
alter table rum_session add column if not exists error_sample_rate double precision not null default 1;

-- Entretenu par l'ingestion au moment où une erreur de cette session arrive.
-- C'est ce qui permet de choisir la bonne probabilité d'inclusion.
alter table rum_session add column if not exists has_error boolean not null default false;

alter table rum_session add column if not exists weight double precision
  generated always as (
    case
      when has_error
        then 1.0 / greatest(sample_rate + (1 - sample_rate) * error_sample_rate, 1e-9)
      else 1.0 / greatest(sample_rate, 1e-9)
    end
  ) stored;

comment on column rum_session.sample_rate is
  'Fraction des sessions admises en collecte COMPLÈTE (MIPRumConfig.sampleRate). 1 = pas '
  'd''échantillonnage, et c''est le défaut de toutes les lignes antérieures.';
comment on column rum_session.error_sample_rate is
  'Fraction des sessions RESTANTES admises en collecte biaisée-erreurs (errorSampleRate). '
  'Ne sert qu''au calcul du poids : une session sans erreur y émet zéro span.';
comment on column rum_session.has_error is
  'Vrai dès qu''une erreur de cette session a été ingérée. Détermine LAQUELLE des deux '
  'probabilités d''inclusion s''applique — voir le commentaire de migration-v58.';
comment on column rum_session.weight is
  'DÉRIVÉE, non modifiable : inverse de la probabilité d''inclusion de cette session. '
  'Vaut 1 partout tant qu''aucun échantillonnage n''est configuré. Les agrégats de VOLUME '
  'somment ce poids au lieu de compter les lignes. Les PERCENTILES ne sont PAS corrigés — '
  'PostgreSQL n''a pas de percentile_cont pondéré ; la console l''annonce plutôt que de le taire.';

-- Le prédicat des requêtes de volume : app + fenêtre, sur les sessions échantillonnées.
create index if not exists idx_session_app_seen on rum_session (app_id, last_seen_at desc);
