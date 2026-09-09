# Audit externe — MIP RUM

**Date** : 09/09/2026. **Objet** : le POC `poc-MIP_RUM` au commit `59caea9`.

## D'où vient ce rapport, et ce qu'il vaut

> Ce document a été produit par un **agent Claude** à qui l'on avait donné le rôle d'un ingénieur
> RUM senior venu de chez Dynatrace. Aucun ingénieur de Dynatrace n'a lu ce dépôt. Le dire
> autrement ici serait exactement le défaut que ce rapport traque ailleurs.
>
> Ce que cela change pour le lecteur :
>
> - Les constats sur **ce dépôt** sont vérifiables : chacun porte une citation `fichier:ligne`,
>   et vous pouvez ouvrir le fichier. C'est la partie qui a de la valeur.
> - Les comparaisons au **marché** sont une reconstitution à partir de littérature publique et de
>   pratiques répandues, pas un témoignage interne. Elles sont étiquetées dans le texte ; traitez-les
>   comme des hypothèses de travail, pas comme des faits sur un produit concurrent.
>
> **Vérification indépendante.** Les cinq findings jugés les plus lourds ont été relus un par un
> dans le code, hors de l'agent qui les a écrits, et tiennent : `user_hash` (1.3), durée des spans
> OTLP (1.4), plafond du score de santé (1.2), fenêtre du compteur d'occurrences (1.1), atteinte
> d'un SLO sans trafic (1.9). **Les vingt et un autres n'ont pas été recontrôlés** : ils portent
> leur citation, mais l'étiquette CONFIRMÉ y engage l'agent, pas une seconde lecture. À vérifier
> avant d'en tirer une décision coûteuse.

## Méthode et périmètre

L'auto-évaluation du dépôt (`apps/console/lib/specs.ts`, `components/presentation/Specs.tsx`,
`lib/dashboard-blocs.ts`, `docs/LIMITES.md`, `docs/CONFORMITE.md`, `DEPLOY.md`) a été lue en
premier. **Tout ce qui y figure est hors périmètre de cet audit** : volumétrie PostgreSQL,
absence de SDK mobile natif, hébergeurs de droit américain, absence de certification, clé
d'ingestion non obligatoire par défaut, RLS contournée par le rôle propriétaire, pas de couche
organisation, console non conteneurisée, débit cloud non mesuré, pas d'escalade, Speed Index et
opérateur réseau. Ces points sont admis, documentés, et souvent mieux expliqués que dans la
plupart des dossiers d'AO que j'ai lus.

Ce rapport porte **uniquement sur ce que le dépôt n'admet pas**.

Deux niveaux de preuve :

- **CONFIRMÉ** — citation `fichier:ligne` + raisonnement fermé, parfois exécution.
- **À VÉRIFIER** — piste sérieuse, preuve incomplète, à instrumenter avant d'agir.

Toute affirmation sur un produit concurrent est explicitement étiquetée comme **mon expérience**,
jamais comme une mesure. Aucun chiffre de performance concurrent n'est avancé.

**Décompte** : 26 findings retenus — **7 bloquants, 12 sérieux, 7 notables**. Répartition :
13 en partie 1 « FAUX » (4 bloquants, 7 sérieux, 2 notables), 13 en partie 2 « manquements »
(3 bloquants, 5 sérieux, 5 notables). Tous sont **CONFIRMÉS** ; trois pistes restées au niveau
« À VÉRIFIER » sont listées à part, à la fin de la partie 2, plutôt que gonflées en findings.

---

# PARTIE 1 — FAUX : ce que le produit affirme et que le code contredit

La consigne du projet est « rien de faux nulle part ». Les treize points ci-dessous sont des
écarts entre une affirmation portée par le produit (vitrine, docs, libellé d'écran, commentaire
faisant autorité, nom de colonne) et ce que le code fait réellement.

---

## 1.1 — Le compteur d'occurrences d'erreurs ignore la fenêtre qu'il affiche — CONFIRMÉ — bloquant

**Ce qui est en place.** L'écran Erreurs affiche une tuile dont le libellé est construit avec la
période sélectionnée : `apps/console/app/errors/page.tsx:86` — ``label={`Occurrences · ${periodLabel(f)}`}``.
La valeur vient de `apps/console/app/errors/page.tsx:73` : `groups.reduce((s, g) => s + g.occurrences, 0)`.
`g.occurrences` est lu dans la vue `v_error_group_ext` (`apps/console/lib/queries-v2.ts:100-109`),
dont la définition est `apps/ingest/sql/migration-v40.sql:50-63` :

```sql
select e.app_id, e.fingerprint, ..., count(*) as occurrences,
       count(distinct e.session_id) as sessions,
       count(distinct s.user_hash) as users_affected,
       min(e.ts) as first_seen, max(e.ts) as last_seen
  from rum_error e left join rum_session s on s.session_id = e.session_id
 where e.fingerprint is not null
 group by e.app_id, e.fingerprint;
```

**Aucune borne temporelle.** `errorGroups()` (`apps/console/lib/queries-v2.ts:121-134`) n'applique
la fenêtre qu'au **filtre de sélection des groupes** (`g.last_seen > now() - $2::interval`), jamais
aux compteurs.

**Pourquoi c'est un problème.** La tuile annonce « Occurrences · 1 h » et affiche le total depuis
la première ingestion (borné seulement par la purge de rétention). Sur une app en production
depuis trois semaines, un exploitant qui bascule 7 j → 24 h → 1 h voit **le même nombre** et en
conclut que rien ne se calme. Le tri (`ERROR_GROUP_ORDER`, `queries-v2.ts:112-119`,
`g.occurrences desc`) classe donc par volume historique : un bug corrigé il y a deux semaines mais
qui a explosé une fois reste en tête devant la régression du jour. Les colonnes « Sessions »,
« Utilisateurs » et « Première vue » ont le même défaut. Et l'histogramme 24 h de l'en-tête empile
`groups.slice(0, TOP_N)` (`errors/page.tsx:44`), c'est-à-dire les cinq groupes les plus gros
**de tous les temps** — qui peuvent tous valoir zéro sur les 24 dernières heures.

**Ce que fait un RUM du marché** (mon expérience) : les compteurs d'un groupe d'erreurs sont
toujours recalculés sur la fenêtre affichée, et le tri par défaut est « impact sur la fenêtre »
(utilisateurs distincts touchés), pas « volume brut cumulé ».

**À construire côté backend.** Remplacer la vue par une fonction paramétrée par la fenêtre —
`error_groups(p_app_id text, p_from timestamptz, p_to timestamptz)` — ou, mieux, adosser l'écran à
un agrégat horaire `error_group_hourly (app_id, fingerprint, hour, occurrences, sessions,
users_affected)` sommable sur n'importe quelle fenêtre. Détail en §3.2.

---

## 1.2 — Le « Score de santé /100 » est structurellement plafonné par des mesures qui ne peuvent pas être bonnes — CONFIRMÉ — bloquant

**Ce qui est en place.** Depuis la livraison de la décomposition réseau, le SDK émet les phases de
navigation **sur le canal des vitals** : `packages/rum-sdk/src/navtiming.ts:126` — ``emit(`webvital.${name}`, …)``
pour `REDIRECT`, `DNS`, `TCP`, `TLS`, `REQUEST`, `RESPONSE` (`navtiming.ts:38-45`) plus `RTT` et
`DOWNLINK` (`navtiming.ts:87-91`). Le commentaire d'en-tête assume le choix et explique que
`rating2026()` rendra `null` pour ces noms (`navtiming.ts:10-13`), ce que confirme
`apps/ingest/supabase/functions/_shared/otlp.mjs:24-28`. Ces lignes atterrissent donc dans
`rum_metric` avec `rating = null` (`otlp.mjs:586-598`).

Or le score de santé compte **toutes** les lignes de `rum_metric`, sans filtrer sur `m.name` :

```
apps/console/lib/health.ts:70-79
  sum(case when x.rating = 'good' then x.w else 0 end) as good_w,
  sum(x.w) as total_w
  from (select m.rating, case when m.name = 'LCP' then 2 else 1 end as w
        from rum_metric m ... where m.ts > now() - interval '…') x
```

**Pourquoi c'est un problème.** Par chargement de page, un navigateur Chromium produit au mieux
6 points pondérés notables (LCP×2, INP, CLS, FCP, TTFB) et **8 points pondérés non notables**
(6 phases réseau + RTT + DOWNLINK). Le rapport `good_w / total_w` d'un site **parfait** plafonne
donc autour de 6/14 ≈ 0,43 — soit ~17 points sur les 40 de la composante vitals. Avec les
composantes erreurs (30), stabilité (20) et anomalies (10) toutes au maximum, le score maximal
atteignable est de l'ordre de **77/100** sur Chromium, **80/100** sur Safari/Firefox (pas de
RTT/DOWNLINK). Le seuil « Excellent ≥ 90 » (`apps/console/lib/health.ts:18`) est **inatteignable
par construction**, et le libellé affiché par défaut sur un site sain est « Bon ».

Pire pour la comparabilité : la dilution dépend du **navigateur** et de la **présence d'une
interaction** (INP n'est émis que s'il y en a une). Deux apps identiques dont les parcs
navigateurs diffèrent auront des scores différents pour des raisons qui n'ont rien à voir avec
leur performance. Le même défaut affecte la heatmap 14 jours (`apps/console/lib/queries-grid.ts:46-58`)
et le pré-agrégat horaire (`apps/ingest/sql/migration-v12.sql:60-61`), donc les deux chemins
« brut » et « rollup » sont faux **de la même façon** — ce qui explique que la vérification
d'équivalence Δ=0 n'ait rien détecté.

Le commentaire d'en-tête de `health.ts:2` dit « part des mesures notées 'good' sur la fenêtre » :
littéralement exact, mais l'intention affichée à l'utilisateur — `lib/glossary.ts:76`,
« 40 % vitals (LCP ×2) » — ne l'est pas.

**Ce que fait un RUM du marché** (mon expérience) : un score composite ne mélange jamais des
mesures notables et des mesures sans barème ; les phases réseau y sont un signal de diagnostic,
pas un terme du score.

**À construire côté backend.** Restreindre la population du score et du rollup aux cinq CWV
(`and m.name in ('LCP','INP','CLS','FCP','TTFB')` dans `health.ts:74`, `queries-grid.ts:50`,
`migration-v12.sql:59-64`), puis **recalculer l'historique** de `rum_rollup_hourly`
(`refresh_rum_rollups` accepte déjà un nombre d'heures : `migration-v12.sql:51`). Coût : une
migration + un backfill, ~½ journée. C'est le correctif le moins cher et le plus visible du
rapport.

---

## 1.3 — `user_hash` n'identifie pas un utilisateur : c'est une empreinte de **classe d'appareil** — CONFIRMÉ — bloquant

**Ce qui est en place.**

```
packages/rum-sdk/src/session.ts:19-27
function computeUserHash(): string {
  const parts = [navigator.userAgent, navigator.language,
                 screen.width + "x" + screen.height,
                 String(new Date().getTimezoneOffset())].join("|");
  return fnv1a(parts);            // FNV-1a 32 bits -> 8 caractères hex
}
```

Aucune composante aléatoire, aucun sel, aucune persistance d'un identifiant tiré au hasard.
**Deux visiteurs différents utilisant le même modèle d'appareil, la même version de navigateur,
la même langue, la même résolution et le même décalage UTC obtiennent le même `user_hash`.**
Ce n'est pas une collision de hachage improbable : c'est le comportement nominal.

**Où ce champ fait autorité.**

| Usage | Emplacement |
|---|---|
| « Utilisateurs uniques » de l'API v1 `/summary` | `apps/console/lib/queries-summary.ts:148` — `count(distinct s.user_hash) as users` |
| Nouveaux vs revenants | `apps/console/lib/queries.ts:430-434` |
| Cohortes de rétention hebdomadaires | `apps/console/lib/queries-cohorts.ts:20-23` |
| « Utilisateurs » touchés par un groupe d'erreurs | `apps/ingest/sql/migration-v40.sql:57` |
| **Export et effacement RGPD (DSAR)** | `apps/console/lib/queries-dsar.ts:16`, `:63`, `:88` |

**Pourquoi c'est un problème, concrètement.**

1. *Comptage.* Sur un portail de service public (le créneau visé), le parc est homogène : mêmes
   postes Windows, même version de navigateur poussée par la DSI, mêmes écrans 1920×1080, même
   fuseau. Des milliers d'agents peuvent partager **un seul** `user_hash`. Le KPI « Utilisateurs »
   de l'API publique devient un compte de configurations, pas de personnes.
2. *Nouveaux vs revenants.* Le test est `exists(select 1 from rum_session s2 where s2.user_hash =
   s.user_hash and s2.started_at < s.started_at)` (`queries.ts:431-433`). Dès que la classe
   d'appareil a été vue une fois, **tout le monde devient « revenant »**. La sous-requête n'est de
   surcroît **pas bornée par `app_id`** : un hash vu sur l'app A rend « revenant » un premier
   visiteur de l'app B. Le bloc se présente pourtant comme « Répartition des visiteurs sur la
   fenêtre, **exacte** » (`apps/console/lib/dashboard-blocs.ts:81`).
3. *DSAR — le point qui tue en revue DPO.* `erase` supprime **toutes** les sessions portant le
   hash (`queries-dsar.ts:88`). Répondre à une demande d'effacement art. 17 détruit alors les
   données d'autres personnes concernées ; l'export art. 15 (`queries-dsar.ts:63`) **communique à
   un demandeur les sessions d'autres visiteurs**. C'est une violation en soi, produite par
   l'outil censé assurer la conformité.
4. *Le qualificatif « anonyme » est faux.* `dashboard-blocs.ts:88` (« un `user_hash` anonyme »),
   `docs/CONFORMITE.md:29` (« `user_hash` **anonymisé** côté client (pas de PII) »),
   `apps/ingest/sql/schema.sql:11` (« fingerprint ANONYMISÉ »), `app/retention/page.tsx:33`.
   Techniquement, c'est un **fingerprinting de terminal** : le RGPD et la doctrine CNIL sur le
   suivi sans cookie le traitent comme une donnée personnelle et comme un traceur soumis à
   consentement. L'anonymat au sens du considérant 26 supposerait l'impossibilité de
   ré-identification ; un hachage non salé de 32 bits sur un espace d'entrée aussi petit est
   inversible par force brute en quelques secondes.

**Ce que fait un RUM du marché** (mon expérience) : l'identifiant de visiteur est un UUID aléatoire
posé dans un stockage local, jamais dérivé de caractéristiques du terminal — précisément pour
éviter à la fois le fingerprinting et les collisions.

**À construire.** Côté SDK : remplacer `computeUserHash()` par un UUID aléatoire persisté dans le
même stockage que la session, sous consentement (§1.11). Côté backend : accepter le nouveau champ,
**ne pas rétro-remplir** (les anciens hash ne sont pas convertibles), marquer les sessions
antérieures `user_hash_kind = 'device_class'`, et **bloquer le DSAR sur ces lignes** — un export
qui ne peut pas garantir l'unicité de la personne ne doit pas s'exécuter. Détail en §3.1.

---

## 1.4 — Les spans OTLP ne portent aucune durée : la trace exportée est temporellement vide — CONFIRMÉ (mesuré) — bloquant

**Ce qui est en place.** L'émetteur maison fixe `endTime = startTime` à la création
(`packages/rum-sdk/src/otel.ts:181-182`) et, à la fermeture, `span.endTime = msToHr(epochMs ?? Date.now())`
(`otel.ts:204`). Or `realEmit` ferme le span **avec le même horodatage que son ouverture** quand un
`ts` est fourni :

```
packages/rum-sdk/src/index.ts:118-122
const span = ts != null ? tracer.startSpan(name, { startTime: ts }) : tracer.startSpan(name);
span.setAttributes(merged);
if (ts != null) span.end(ts); else span.end();
```

Et `apispans.ts:81` fournit précisément ce `ts` : l'instant de **début** de la requête. Pour les
spans sans `ts` (pageview, vitals, exceptions, tâches longues), l'ouverture et la fermeture sont
séparées par un seul appel `setAttributes`, donc par moins d'une milliseconde.

**Preuve exécutée.** Test temporaire monté sur le harnais existant de
`tests/unit/otlp-spans-natifs.test.ts` (faux DOM, `fetch` intercepté), supprimé après mesure :

```
span=pageview     durée_OTLP=1ms  attributs de durée: []
span=http.client  durée_OTLP=0ms  attributs de durée: ["http.duration_ms"]   ← appel réel de 420 ms
```

La durée réelle ne voyage que dans l'attribut propriétaire `http.duration_ms`, lu par notre propre
ingestion (`apps/ingest/supabase/functions/_shared/otlp.mjs:243-246` : `if (… typeof durationMs
!== "number") return null`).

**Pourquoi c'est un problème.** Trois affirmations du dépôt tombent :

- `apps/console/lib/specs.ts:309` — « la trace est un arbre enraciné, **lisible par un collecteur
  tiers** » ;
- `apps/console/lib/specs.ts:383` — « Un backend tiers affichera donc **le waterfall correctement**,
  mais ne comptera pas nos erreurs comme des erreurs » — c'est justement le waterfall qui ne
  s'affiche pas : dans Jaeger, Tempo ou n'importe quel backend OTel, chaque span est un trait de
  largeur nulle ; il n'y a aucun waterfall à lire ;
- `components/presentation/Specs.tsx:94-99` — « OTLP JSON complet ».

L'argument commercial « backend remplaçable, pas d'enfermement fournisseur »
(`lib/presentation-content.ts:19`) ne tient donc que pour la **structure** de la trace, pas pour
son contenu. Un prospect qui teste le flux avec son propre Collector — c'est le premier réflexe
d'un architecte devant une promesse OTel — voit immédiatement le problème. C'est le finding qui
fait le plus de dégâts en démonstration technique.

**À construire.** Côté SDK, propager la vraie fin : `emit(name, attrs, tsDebut, tsFin)` et
`span.end(tsFin)`. Côté ingestion, **préférer `endTimeUnixNano - startTimeUnixNano` quand l'écart
est non nul**, et ne retomber sur `http.duration_ms` que sinon (`otlp.mjs:240-264` porte déjà
`durationMsBetween`, utilisé pour les spans OTel standard en `otlp.mjs:464`). Le contrat
d'ingestion accepte alors indifféremment un capteur MIP et un agent OTel tiers. Effort : 1 journée,
plus un test de non-régression sur les deux chemins.

---

## 1.5 — Le p75 des Core Web Vitals n'est pas calculé sur la population annoncée, et CLS/INP y sont comptés plusieurs fois par page — CONFIRMÉ — sérieux

**Ce qui est en place.** `vitalsP75` (`apps/console/lib/queries.ts:56-75`) calcule
`percentile_cont(0.75)` sur les **lignes** de `rum_metric`. La vitrine décrit ce chiffre comme
« LCP, INP, CLS, FCP, TTFB au 75ᵉ percentile — **la qualité vécue par 3 visiteurs sur 4** »
(`apps/console/lib/presentation-content.ts:51`), et le critère de la section Specs annonce
« p75, comme l'exige le standard CWV » (`components/presentation/Specs.tsx:82-83`).

Deux écarts distincts :

**a) La population n'est ni « les visiteurs » ni « les pages vues ».** Le standard CWV (CrUX)
agrège par **chargement de page**. Ici la population est « les rapports de métrique ». Un visiteur
qui consulte 40 pages pèse 40 fois plus qu'un visiteur qui en consulte une. Ce n'est pas
nécessairement mauvais — c'est le choix de CrUX — mais ce n'est pas « 3 visiteurs sur 4 ».

**b) CLS et INP sont rapportés plusieurs fois par chargement, et chaque rapport devient une
ligne.** `initVitals` (`packages/rum-sdk/src/vitals.ts:77-81`) appelle `onCLS`/`onINP` sans
`reportAllChanges`. La documentation de la bibliothèque livrée
(`node_modules/.pnpm/web-vitals@5.3.0/…/dist/modules/onCLS.js`, en-tête) est explicite :

> *« `callback` is always called when the page's visibility state changes to hidden. As a result,
> the `callback` function might be called multiple times during the same page load. »*

`bindReporter` (même paquet, `dist/modules/lib/bindReporter.js:25-45`) rappelle à chaque passage en
`hidden` dès que le delta est non nul. Un onglet masqué puis réaffiché trois fois produit trois
lignes CLS pour **une seule** page vue. Comme CLS et INP sont monotones croissants sur la durée de
vie de la page, les rapports intermédiaires sont **systématiquement plus favorables** que le
rapport final : le p75 affiché est **optimiste**.

Le SDK a vu le problème et émet ce qu'il faut pour le résoudre — `webvital.id` et `webvital.delta`
(`vitals.ts:70-73`), avec un commentaire qui dit précisément « sans lui, un consommateur ne peut
pas sommer les rapports successifs sans double-comptage ». **Mais l'ingestion jette les deux
champs** : `otlp.mjs:586-598` ne construit que `span_id, session_id, app_id, route, name, value,
rating, attribution, ts`, et `pg-ingest.mjs:196-200` n'insère rien d'autre. L'information
nécessaire à la déduplication n'existe donc pas en base ; le défaut n'est pas rattrapable au
requêtage.

**Ce que fait un RUM du marché** (mon expérience) : une seule valeur finale par (page vue,
métrique) est retenue ; les rapports intermédiaires servent au streaming temps réel, pas à
l'agrégat.

**À construire côté backend.** Persister `metric_uid` (= `webvital.id`) et `pageview_span_id` sur
`rum_metric`, poser un index unique `(session_id, name, metric_uid)` et écrire en
`on conflict … do update set value = greatest(rum_metric.value, excluded.value), ts = excluded.ts`
pour CLS/INP (dernier rapport = valeur définitive), `do nothing` pour LCP/FCP/TTFB. Détail en §3.3.

---

## 1.6 — Trois définitions différentes derrière le même libellé « taux d'erreur » — CONFIRMÉ — sérieux

La console n'a qu'un libellé — `METRIC_LABELS.error_rate = "Taux d'erreur JS"`
(`apps/console/lib/queries-v2.ts:279`) — pour quatre calculs incompatibles :

| Où | Formule | Dénominateur |
|---|---|---|
| API v1 `/summary`, KPI console | `error_sessions / sessions` | **sessions** (`apps/console/lib/queries-summary.ts:161`, `:219`) |
| Moteur d'alerte `check_alerts()` | `count(rum_error) / greatest(count(rum_pageview), 1)` | **pages vues** (`apps/ingest/sql/migration-v38.sql:35-40`) |
| SLO `slo_status()` | `1 - count(rum_error) / greatest(count(rum_pageview), 1)` | **pages vues** (`apps/ingest/sql/migration-v17.sql:123-129`) |
| Carte d'expérience | `count(*) filter (status_code >= 400) / count(*)` | **spans HTTP** (`apps/console/lib/queries-map.ts:28`) |

**Pourquoi c'est un problème.** Un exploitant règle une alerte « taux d'erreur > 2 % » en regardant
le KPI de la vue d'ensemble. Les deux nombres ne sont pas commensurables : une session qui lève
30 erreurs sur 3 pages vaut 1/N côté KPI et 10 côté alerte. Le seuil réglé sur l'un ne veut rien
dire pour l'autre — et personne ne le sait, puisque l'écran d'édition de règle affiche le même
libellé que le KPI. Le `greatest(…, 1)` ajoute un piège : **0 page vue et 5 erreurs donnent un taux
de 500 %**, ce qui arrive à chaque fois qu'une session ne remonte que des exceptions (mode
d'échantillonnage biaisé-erreurs, §2.4).

**Ce que fait un RUM du marché** (mon expérience) : une métrique porte son dénominateur dans son
nom (« erreurs par vue », « % de sessions avec erreur ») et la définition est la même du tableau de
bord à l'alerte.

**À construire côté backend.** Deux métriques distinctes, nommées séparément et calculées par une
fonction SQL **unique** appelée par la console, le moteur d'alerte et le SLO :
`error_rate_per_view` et `error_session_ratio`. Migrer les règles existantes en les rattachant
explicitement à l'une des deux, avec un défaut conservateur.

---

## 1.7 — Le regroupement d'erreurs se réinitialise à chaque déploiement — CONFIRMÉ (exécuté) — sérieux

**Ce qui est en place.** L'empreinte est `fnv1a(type | message normalisé | première frame de stack)`
(`apps/ingest/supabase/functions/_shared/otlp.mjs:131-135`). `normalizeMessage`
(`otlp.mjs:108-114`) remplace URL, UUID et chiffres par `#` **dans le message**.
`firstStackFrame` (`otlp.mjs:117-124`) ne fait que retirer `:ligne:colonne` : **l'URL du bundle,
avec son empreinte de contenu, reste dans l'empreinte**.

**Preuve exécutée** (même erreur, deux déploiements Next.js successifs) :

```
déploiement N   : d218b59b   (…/chunks/main-4f2a9c1d.js)
déploiement N+1 : ec52be20   (…/chunks/main-7b3e88ff.js)
MÊME groupe ?   false
```

**Pourquoi c'est un problème.** Toute application moderne (Next.js, Vite, webpack, Angular CLI)
sert des bundles à nom haché. À chaque mise en production, **tous les groupes d'erreurs
repartent de zéro** : `first_seen` se réinitialise, le statut de triage `error_status`
(`queries-v2.ts:139-155`), clé `(app_id, fingerprint)`, ne suit pas — une erreur marquée
« résolue » réapparaît comme un groupe neuf, jamais comme une **régression**, et la détection de
régression (`queries-v2.ts:108`) ne se déclenche jamais. Le tableau « Comparaison par version »
affichera mécaniquement « nouvelles erreurs » à chaque déploiement.

L'affirmation contredite est explicite : « groupées par empreinte (type, message, première frame)
**pour qu'un même bug ne compte qu'une fois** » (`apps/console/lib/specs.ts:269`), reprise dans
`lib/glossary.ts:127-132` (« afin que les variantes d'une même erreur partagent une empreinte ») et
sur la vitrine (`lib/presentation-content.ts:76`, « dédupliquées par cause »).

**Ce que fait un RUM du marché** (mon expérience) : l'empreinte est calculée sur la stack
**dé-minifiée** quand une source map est disponible, et sinon sur un chemin normalisé dont
l'empreinte de contenu est retirée.

**À construire côté backend.** Immédiat et peu coûteux : normaliser l'URL dans `firstStackFrame` —
retirer l'origine, et remplacer le segment d'empreinte de contenu
(`/-[0-9a-f]{8,}\.(js|mjs)$/` et `/\.[0-9a-f]{8,20}\.(js|mjs)$/`) par `#`. Puis prévoir une table
de correspondance `error_fingerprint_alias (app_id, old_fp, new_fp)` peuplée par un job de
migration, pour ne pas perdre l'historique de triage. Effort : 1 journée. À faire **avant** tout
pilote client, sinon l'historique produit pendant le pilote sera inexploitable.

---

## 1.8 — Le trafic robot est exclu de certains écrans et compté dans d'autres — CONFIRMÉ — sérieux

**Ce qui est en place.** Le schéma affirme la règle : `rum_session.is_bot` — « trafic non humain
(**exclu par défaut côté console**) » (`apps/ingest/sql/schema.sql:15`). Le filtre existe
(`apps/console/lib/queries.ts:10-11`, `botClause`) et est appliqué dans 9 modules de requêtes sur
une trentaine. Il est **absent** de :

| Écran / mécanisme | Emplacement |
|---|---|
| Score de santé (les 4 composantes) | `apps/console/lib/health.ts:69-91` |
| Heatmap 14 j, trafic quotidien, courbe LCP 14 j | `apps/console/lib/queries-grid.ts:46-60`, `:105-127`, `:134-147` |
| Groupes d'erreurs et leurs compteurs | `apps/ingest/sql/migration-v40.sql:50-63` |
| Moteur d'alerte | `apps/ingest/sql/migration-v38.sql:33-56` |
| SLO et budget d'erreur | `apps/ingest/sql/migration-v17.sql:118-153` |
| Signaux de frustration, tracing, carte | `queries-frustration.ts`, `queries-tracing.ts`, `queries-map.ts` |
| Pré-agrégat horaire | `apps/ingest/sql/migration-v12.sql:58-64` |

**Pourquoi c'est un problème.** Sur la **même page** (Vue d'ensemble), la tuile « Core Web Vitals »
exclut les robots et la tuile « Score de santé » les inclut : deux nombres pour la même
population apparente, qui divergent d'autant plus que le site est indexé. Un passage de crawler la
nuit dégrade le score de santé et noircit la heatmap sans qu'aucun humain n'ait rien vécu. Côté
alerting, c'est pire : un robot mal élevé peut **déclencher une astreinte**. Et l'écran de
comparaison de versions, lui, filtre bien les robots (`queries-deploys.ts`), donc ne raconte pas la
même histoire que le score.

**À construire côté backend.** Une seule décision : soit le filtre est un **prédicat par défaut**
partout (le plus simple : une vue `rum_session_humaine` ou une colonne dénormalisée `is_bot` sur
les tables filles, posée à l'ingestion), soit il disparaît. La dénormalisation d'`is_bot` sur
`rum_metric` / `rum_error` / `rum_pageview` supprime en prime la jointure `rum_session` que
**toutes** les requêtes d'agrégat traînent aujourd'hui. Détail en §3.4.

---

## 1.9 — Un SLO sans données déclenche une alerte critique « budget brûlé » toutes les heures — CONFIRMÉ — sérieux

**Ce qui est en place.** L'atteinte d'un SLO sur un vital vaut
`count(*) filter (where m.rating = 'good') / greatest(count(*), 1)`
(`apps/ingest/sql/migration-v17.sql:130-134`, et `:143-148` pour la fenêtre 1 h). Sur une heure
**sans aucune mesure**, l'agrégat rend `0 / 1 = 0` : `attainment = 0`, pas `null`.

`fast_burn` vaut `(1 - att1h.attainment) >= 14.4 * (1 - s.objective)`
(`migration-v17.sql:119`). Avec `attainment = 0` et un objectif de 99 %, cela donne
`1 >= 0,144` → **vrai**. `check_slo_burn()` (`migration-v17.sql:273-293`) insère alors un
`alert_event` de sévérité `critical` et appelle `route_alert`, avec pour message
« SLO « … » en burn rapide : atteinte **0.00 %** ». La déduplication ne porte que sur une heure
(`migration-v17.sql:280-282`), et le scheduler passe toutes les 5 minutes
(`apps/console/lib/etat-latence.ts:18`).

De la même façon, `burned_pct` (`migration-v17.sql:117-118`) vaut `(1-0)/(1-0,99) × 100 = 10 000`,
plafonné à **999 %** — c'est ce que l'écran SLO affiche (`apps/console/app/slo/page.tsx:66`).

**Pourquoi c'est un problème.** Toute application à trafic discontinu — la majorité des portails
métier, qui n'ont personne entre 20 h et 7 h — reçoit **une alerte critique par heure toute la
nuit**, avec un message affirmant une atteinte de 0 %. Et la première fois que l'ingestion tombe
réellement, l'outil dit « votre LCP est en burn rapide » au lieu de « je ne reçois plus rien » :
le diagnostic est exactement inversé. Un exploitant qui a vécu deux nuits de ce régime coupe
l'alerting — et l'outil ne sert plus à rien.

**Ce que fait un RUM du marché** (mon expérience) : un SLO sur une fenêtre sans échantillon est
« indéterminé », jamais « non conforme » ; l'absence de données est un signal distinct, avec sa
propre alerte.

**À construire côté backend.** Dans `slo_status()`, rendre `attainment` **`null`** quand
`count(*) = 0` (remplacer `greatest(count(*),1)` par `nullif(count(*),0)`), propager le `null` dans
`fast_burn` et `burned_pct`, et exclure les lignes `attainment is null` de
`check_slo_burn()`. Ajouter en regard une règle « absence de données » (§3.5). Effort : 2 heures
pour le correctif, une demi-journée avec le test.

---

## 1.10 — Le dossier de conformité décrit un hébergeur et des sous-traitants qui n'existent plus — CONFIRMÉ — sérieux

**Ce qui est en place.** `apps/console/lib/legal.ts:33-37` déclare l'hébergement réel, vérifié le
08/09/2026 : **Neon**, `aws-eu-central-1` (Francfort), Vercel `fra1`, Railway `europe-west4`. Le
même fichier retire explicitement Mistral et Anthropic de la liste des sous-traitants
(`legal.ts:40-50`), dans la même modification que la suppression de l'assistant IA.

`docs/CONFORMITE.md` dit autre chose :

- `:9` — « Base **PostgreSQL (Supabase) en région `eu-west-3` (Paris)** » ;
- `:34` — « TLS de bout en bout (**CA Supabase** épinglée côté console) » ;
- `:63` — registre des sous-traitants : « Supabase | base PostgreSQL managée | UE (`eu-west-3`) » ;
- `:65` — « Mistral / Anthropic | assistant d'intégration optionnel | UE (Mistral) / **US** ».

Railway n'y figure pas du tout, alors que ce sous-traitant **reçoit les mesures RUM**.

**Pourquoi c'est un problème.** Ce fichier porte en tête « Pièce destinée aux grilles de notation
d'AO grand compte et aux DPO ». C'est exactement le document qu'un acheteur public annexe au
dossier. Il déclare un sous-traitant qui ne traite plus rien, en omet un qui traite, et se trompe
de pays d'hébergement. L'en-tête de `legal.ts:22-28` énonce pourtant la règle et rappelle
l'incident précédent — « elles ont déclaré Supabase / eu-west-3 Paris pendant douze jours après la
migration » : la règle a été appliquée à `legal.ts`, **pas** à `CONFORMITE.md`, qui n'est couvert
par aucun test.

**À construire.** `docs/CONFORMITE.md` doit être **généré** depuis `lib/legal.ts` (les mêmes
constantes `HOSTS` et `SUBPROCESSORS` que `/legal/mentions`), ou à défaut couvert par
`tests/unit/specs.test.ts`, qui sait déjà ouvrir un fichier et y chercher un marqueur. Effort :
2 heures. C'est le finding le moins technique et le plus dangereux commercialement.

---

## 1.11 — Le SDK écrit un identifiant persistant sur le terminal **avant** le consentement, et ne l'efface pas au refus — CONFIRMÉ — sérieux

**Ce qui est en place.** Ordre des opérations dans `init()` :

```
packages/rum-sdk/src/index.ts:82   session = getOrCreateSession();      // localStorage.setItem
packages/rum-sdk/src/index.ts:84   storeMode(session.sessionId, mode0); // localStorage.setItem
…
packages/rum-sdk/src/index.ts:130  gate = new ConsentGate(cfg.requireConsent ?? false);
```

`getOrCreateSession` écrit `mip_rum_session` (`session.ts:47-51`) et `storeMode` écrit
`mip_rum_sampling` (`sampling.ts:96-101`) — **48 lignes avant** que la barrière de consentement
n'existe. Au refus, `ConsentGate.set(false)` purge le tampon mémoire
(`consent.ts:62-65`) mais **ne touche pas au stockage** : `mip_rum_session`, `mip_rum_sampling` et
la file `mip_rum_retry` (`retry.ts:34`) survivent au refus, avec les spans déjà collectés qui
attendent dedans.

**Pourquoi c'est un problème.** `docs/CONFORMITE.md:31` affirme « `requireConsent` met le SDK en
tampon mémoire jusqu'à `MIPRum.consent(true)` ». C'est vrai du **réseau**, faux du **terminal**.
Or l'article 82 de la loi Informatique et Libertés (transposition de l'ePrivacy) vise toute
« action tendant à accéder à des informations déjà stockées ou à inscrire des informations » dans
l'équipement terminal, **quel que soit le support** — localStorage compris — et la mesure d'audience
n'est exemptée que sous des conditions strictes qu'un identifiant de visiteur persistant ne remplit
pas (mon expérience de la doctrine CNIL, pas une mesure). Deuxième point, plus opérationnel : après
un refus, l'identifiant reste sur le poste ; si l'utilisateur accepte plus tard, ou si l'app oublie
`requireConsent` sur une autre page, **la même session reprend** — la rétroactivité joue à
l'envers.

**À construire.** Côté SDK : n'appeler `getOrCreateSession()` qu'après `gate.granted`, garder
l'identifiant en mémoire en attendant, et purger les trois clés à `consent(false)`. Côté backend :
prévoir `POST /v1/forget` (session_id) qui déclenche `erase_session()` — un refus tardif doit
pouvoir effacer ce qui est déjà parti. Effort : 1 journée SDK + 2 heures backend.

---

## 1.12 — « Aucune adresse IP … ni même résolue » : il existe un chemin de géolocalisation par IP — CONFIRMÉ — notable

**Ce qui est en place.** Les deux chemins d'ingestion lisent l'en-tête pays du CDN en repli :

```
apps/ingest/lib/receiver.mjs:156
  const pays = entete(req, "x-vercel-ip-country") ?? entete(req, "cf-ipcountry");
  if (pays) for (const s of rows.sessions) s.geo_country = s.geo_country ?? pays;

apps/console/app/api/ingest/v1/traces/route.ts:63   (même chose)
```

**Pourquoi c'est un problème.** `apps/console/lib/specs.ts:261` affirme « pays DÉDUIT DU FUSEAU
HORAIRE — aucune adresse IP n'est stockée, **ni même résolue** », et `docs/CONFORMITE.md:27`
« géolocalisation **par timezone** (`mip.tz`) → pays seulement ». La résolution IP→pays a bien lieu
— elle est simplement effectuée par le CDN plutôt que par MIP, et son résultat est **écrit en
base**. La nuance est réelle (aucune IP ne transite ni n'est stockée côté MIP), mais l'affirmation
telle qu'elle est rédigée est fausse, et c'est précisément le genre de phrase qu'un DPO relit mot à
mot. Le repli n'est pas théorique : le chemin `apps/console/app/api/ingest/v1/traces` tourne sur
Vercel, qui pose systématiquement cet en-tête.

**À construire.** Soit retirer le repli (le fuseau suffit), soit dire la vérité en trois mots dans
`specs.ts` et `CONFORMITE.md` : « pays déduit du fuseau, ou de l'en-tête pays du CDN quand il y en
a un devant — aucune adresse IP n'est stockée ». Effort : 30 minutes. À faire avant la prochaine
relecture juridique.

---

## 1.13 — La table des options d'intégration se dit « complète » et omet celle qui porte la garantie de vie privée — CONFIRMÉ — notable

`docs/INTEGRATION.md:33` titre « Options de `MIPRum.init` (**complètes**, v0.2) ». Comparé à
`packages/rum-sdk/src/types.ts`, il manque **huit** options : `release` (`types.ts:11`, sans quoi
aucune dé-minification n'est possible), `replay` (`:43`), `replayEndpoint` (`:45`), **`replayMask`**
(`:62`), `trace` (`:68`), `frustration` (`:70`), `collectionSource` (`:85`), `feedback` (`:110`).

`replayMask` est celle que `docs/CONFORMITE.md:30` invoque comme garantie — « masquage par défaut
des saisies, du texte et des médias (**réglable par app via `replayMask`**) ». Le réglage sur
lequel repose l'engagement RGPD n'est documenté nulle part côté intégrateur. `trace` a une
conséquence pire encore : cf. §2.7.

---

# PARTIE 2 — MANQUEMENTS SÉRIEUX face à un RUM commercial

Classés par ce qui bloque réellement : d'abord ce qui fait échouer une démonstration ou un pilote,
puis ce qui casse en production, puis le confort.

---

## 2.1 — Aucun plafond ni déduplication sur les erreurs : la boucle d'amplification — CONFIRMÉ — bloquant

**Ce qui est en place.** Tous les collecteurs du SDK sont plafonnés par page — ressources 20
(`resources.ts:7`), tâches longues, frustration, appels API 100 (`apispans.ts:13`), fil d'Ariane —
via `makeCap` (`caps.ts:9-18`), remis à zéro à chaque page vue (`index.ts:201-205`).
**`initErrors` est le seul collecteur sans plafond** (`packages/rum-sdk/src/errors.ts:7-28`) : un
`addEventListener("error")` et un `addEventListener("unhandledrejection")` qui émettent un span à
chaque occurrence, sans compteur, sans déduplication, sans fenêtre de silence.

**Le mécanisme.** Une erreur dans un `requestAnimationFrame`, dans un rendu React qui reboucle ou
dans un `setInterval` produit des centaines d'exceptions par seconde. Chacune :

1. passe l'échantillonnage **quoi qu'il arrive** — `sampler.passes` laisse toujours passer
   `"exception"` (`sampling.ts:71`) et la première erreur **promeut** la session en collecte
   complète (`sampling.ts:73-78`) ;
2. remplit le tampon de 64 spans, qui déclenche un `POST` immédiat (`otel.ts:206`) ;
3. si l'ingestion répond 429 — ce qui arrivera, la limite est de 600 requêtes/minute/app
   (`services/ingest/server.mjs:54`) — l'exporteur marque `FAILED` (`otel.ts:119`) et le lot part
   en `localStorage` (`retry.ts:124-135`) pour être **rejoué au prochain chargement de page**.

Un seul client avec une boucle d'erreur sature donc sa propre limite de débit, puis rejoue son
retard à chaque navigation. Comme l'écriture est synchrone sur un pool de 8 connexions
(`services/ingest/server.mjs:34`) vers une base **partagée par tous les locataires**, la pression
n'est pas isolée : la limite est par app, la contention est globale.

**Ce que fait un RUM du marché** (mon expérience) : plafond d'événements par vue et par session,
plus une déduplication locale par empreinte avec fenêtre de silence — une même erreur répétée est
comptée, pas transmise mille fois.

**À construire.** Côté SDK : `makeCap(50)` sur les erreurs + une carte `empreinte → {n, dernierEnvoi}`
qui n'émet qu'un span par empreinte et par tranche de 10 s, avec un attribut `mip.error_count`.
Côté backend : accepter et sommer `mip.error_count` dans `rum_error` (colonne `occurrences`), pour
ne pas perdre le volume réel. C'est la condition pour que le plafond client ne fausse pas les
compteurs. Effort : 1 journée. **À faire avant le premier client réel.**

---

## 2.2 — La file de rejeu ne distingue pas une erreur réessayable d'une erreur définitive — CONFIRMÉ — bloquant

**Ce qui est en place.** `httpExporter` (`packages/rum-sdk/src/otel.ts:119`) : `cb({ code: res.ok
? SUCCESS : FAILED })`. **Tout** ce qui n'est pas 2xx est un échec réessayable : 400 (JSON
invalide), 403 (clé refusée), 413 (charge trop grosse), 429 (débit dépassé). Le décorateur
`RetryExporter` (`retry.ts:124-135`) persiste alors le lot, que `replayRetryQueue`
(`retry.ts:110-118`) rejoue au prochain `init()`. En cas de nouvel échec, il est **re-persisté**.

**Le mécanisme.** Trois scénarios très ordinaires deviennent des boucles :

- un client dont la clé d'API est mal saisie (403) rejoue indéfiniment jusqu'à la limite de 50 Ko
  de la file (`retry.ts:36`), à chaque page, pour rien ;
- un incident d'ingestion qui répond 503 fait converger **tous les navigateurs** vers un rejeu
  simultané à la reprise, sans dispersion ni retrait exponentiel : le retour de service reçoit un
  pic supérieur au trafic nominal ;
- l'en-tête `retry-after: 60` que l'ingestion prend soin de renvoyer sur un 429
  (`apps/ingest/lib/receiver.mjs:109`) **n'est lu par personne**.

Le commentaire de `retry.ts:5-9` assume les doublons (« assumé pour un POC ») mais ne dit rien de
l'amplification, qui est le vrai risque.

**À construire.** Côté SDK : ne mettre en file que les échecs réseau et les 5xx/429 ; jeter les
4xx définitifs en journalisant une fois ; ajouter un retrait exponentiel avec bruit et honorer
`Retry-After`. Côté backend : renvoyer un code applicatif distinguant « rejouable » de
« définitif » dans le corps, et exposer `retry-after` sur les 503 aussi. Effort : 1 journée.

---

## 2.3 — Ingestion synchrone, sans file ni contre-pression — CONFIRMÉ — bloquant en production

**Ce qui est en place.** `traiterOtlp` (`apps/ingest/lib/receiver.mjs:116-175`) fait tout dans la
requête : lecture du corps, `JSON.parse`, aplatissement, gardes (deux allers-retours SQL par app —
`checkApiKey` puis `rate_check`, `pg-ingest.mjs:392-412`), puis `writeRows` — une **transaction**
de 12 `INSERT` plus un `UPDATE` corrélé (`pg-ingest.mjs:151-283`). Pool de 8 connexions
(`services/ingest/server.mjs:34`). Aucun tampon, aucune file, aucun découplage.

**Le mécanisme.** Quand la base ralentit (verrou, autovacuum, bascule du pooler Neon), les
requêtes s'accumulent dans l'event loop de Node, les délais d'attente client expirent, l'exporteur
marque `FAILED` — et la file de rejeu de §2.2 amplifie. Le seul garde-fou est la limite de débit,
elle-même une requête SQL : **quand la base est le goulot, le mécanisme qui protège la base
consomme la base**. Le repli mémoire de `rateLimitedDurable` (`pg-ingest.mjs:409-412`) est
`return false` — c'est-à-dire **on laisse passer**.

`checkApiKey` est ouvert en cas d'échec par choix documenté (`pg-ingest.mjs:383-386`), ce qui est
défendable pour la disponibilité, mais combiné au repli du débit, l'ingestion **n'a plus aucune
protection** dès que la base est indisponible.

**Ce que fait un RUM du marché** (mon expérience) : le receveur écrit dans une file durable
(Kafka, Kinesis, ou au minimum une table d'attente) et répond 202 ; un travailleur consomme à son
rythme. C'est ce qui permet de survivre à une indisponibilité de la base sans perdre les beacons.

**À construire.** Étape 1, peu coûteuse : `COPY` binaire dans une table d'atterrissage
non journalisée `ingest_raw (id bigserial, app_id, received_at, payload jsonb)` puis un
travailleur du scheduler qui aplatit et écrit par lots de 500 — le chemin de requête ne fait plus
qu'une écriture séquentielle. Étape 2 : compteur de débit en mémoire par instance avec
réconciliation périodique, pour cesser d'interroger la base à chaque beacon. Détail en §3.6.

---

## 2.4 — L'échantillonnage n'est ni pondéré, ni tracé, ni corrigé : les volumes et les taux deviennent faux dès qu'il est activé — CONFIRMÉ — sérieux

**Ce qui est en place.** Trois modes décidés par session (`packages/rum-sdk/src/sampling.ts:39-47`).
`docs/INTEGRATION.md:112` recommande explicitement d'abaisser `sampleRate` « pour réduire la
volumétrie sur les sites à fort trafic », en promettant « on ne perd jamais une session d'erreur ».

**Le mécanisme.** Le taux d'échantillonnage n'est **stocké nulle part** : ni attribut de resource
(`otel.ts:139-150` ne l'émet pas), ni colonne de `rum_session`, ni dans `app_registry`. Aucune
requête de la console ne le corrige. Conséquences, toutes silencieuses :

- **Les volumes sont ceux de l'échantillon.** « Sessions », « Pages vues », « Occurrences »
  affichent 10 % de la réalité à `sampleRate: 0.1`, sans mention ni facteur d'extrapolation. Le
  rapport mensuel envoyé au client est faux d'un ordre de grandeur.
- **Le taux d'erreur est biaisé vers le haut, par conception.** L'échantillonnage biaisé-erreurs
  garde 100 % des sessions à incident (`sampling.ts:46`, `errorSampleRate` par défaut 1) et 10 %
  des autres. `error_sessions / sessions` (`queries-summary.ts:219`) est calculé sur cette
  population enrichie : à 1 % d'erreur réel et `sampleRate: 0.1`, le KPI affiche ~9 %. C'est le
  cas d'école du dénominateur qui n'est pas celui qu'on croit.
- **Le p75 n'est pas corrigé.** Un p75 sur échantillon aléatoire simple reste estimable, mais ici
  l'échantillon **n'est pas aléatoire** : les sessions à erreur, systématiquement plus lentes,
  y sont sur-représentées. Le p75 est donc pessimiste, en sens inverse du biais du §1.5.
- **Les SLO et les alertes sont réglés sur des taux biaisés.**

**Ce que fait un RUM du marché** (mon expérience) : chaque événement porte son poids d'inclusion
(`1/p`), et les agrégats somment les poids au lieu de compter les lignes ; les percentiles sont
calculés sur une distribution pondérée.

**À construire côté backend.** C'est le chantier le plus structurant du rapport. Détail en §3.3 :
attribut `mip.sample_rate` sur la resource, colonne `weight double precision not null default 1`
sur `rum_session` et les tables filles, `sum(weight)` au lieu de `count(*)`, et p75 pondéré. Tant
que ce n'est pas fait, **l'échantillonnage doit être présenté comme incompatible avec les
compteurs et les taux**, et la documentation ne doit pas le recommander.

---

## 2.5 — Ni bfcache, ni prerender : des pages vues fantômes et des LCP artificiellement bons — CONFIRMÉ — sérieux

**Ce qui est en place.** `initNavigation` (`packages/rum-sdk/src/context.ts:29-52`) écoute
`pushState`, `replaceState` et `popstate`. Aucun `pageshow`, aucun test de `event.persisted`,
aucune lecture de `document.prerendering` — vérifié : ces trois identifiants n'apparaissent nulle
part dans `packages/rum-sdk/src/`.

**Le mécanisme, deux cas.**

*Retour arrière depuis le bfcache.* La bibliothèque web-vitals, elle, gère le cas : `onBFCacheRestore`
réinitialise la métrique et en rapporte une nouvelle (`web-vitals@5.3.0/dist/modules/onCLS.js`,
`initMetric` avec `navigationType: 'back-forward-cache'`). Le SDK reçoit donc **de nouvelles
valeurs de LCP, CLS, INP** sans avoir ouvert de nouvelle page vue : pas de `newPageTrace()`
(`otel.ts:97-102`), pas de span `pageview`, pas de remise à zéro des plafonds. Ces mesures
s'accrochent à la **trace précédente** et à la route courante. Or un LCP après restauration bfcache
vaut typiquement quelques millisecondes : le p75 est tiré vers le bas par des chargements qui n'en
sont pas, et le rapport pages vues / mesures se déforme.

*Prérendu (Speculation Rules).* Une page prérendue exécute le SDK : `getOrCreateSession()`,
`pageview`, session créée. Si l'utilisateur ne clique jamais, la session et la page vue existent
quand même. Les volumes montent, le taux de rebond descend, et les vitals d'une page jamais vue
entrent dans le p75.

**Ce que fait un RUM du marché** (mon expérience) : une restauration bfcache ouvre une nouvelle
vue ; une page prérendue voit sa collecte différée jusqu'à `prerenderingchange`.

**À construire.** Côté SDK : écouter `pageshow` (`persisted === true` → `newPageTrace()` + span
`pageview` avec `mip.nav_type = "bfcache"`) et différer l'`init` réelle tant que
`document.prerendering` est vrai. Côté backend : accepter `nav_type in ('navigate','reload',
'back_forward','spa','bfcache','prerender')` et **exclure `prerender` par défaut** des agrégats —
une colonne, un prédicat, mais il faut le décider maintenant plutôt qu'après avoir mélangé les
populations. Effort : 1 journée SDK, 2 heures backend.

---

## 2.6 — Cardinalité de route non bornée, et un écran qui la parcourt sans limite — CONFIRMÉ — sérieux

**Ce qui est en place.** `normalizeRoute` (`context.ts:4-15`) ne normalise que trois formes :
entier pur, UUID, hexadécimal de 16 caractères ou plus. Ne sont **pas** normalisés : les
identifiants alphanumériques courts (`/cmd/A7F2X`), les slugs (`/produits/chaussure-rouge-42` →
le `42` devient `:id` mais le slug reste), les identifiants base64, les dates (`/journal/2026-09-09`),
les codes postaux, les numéros de dossier.

`slowRoutes` (`apps/console/lib/queries.ts:192-217`) fait un `group by m.route` **sans `LIMIT`**,
et chaque ligne déclenche **deux sous-requêtes corrélées** (comptage des pages vues et des tâches
longues, `queries.ts:196-201` et `:206-211`). Sur un catalogue de 20 000 URL distinctes, c'est
40 000 sous-requêtes et 20 000 lignes rendues en HTML.

**Le mécanisme.** La cardinalité de `route` n'est bornée par rien : ni à l'émission, ni à
l'ingestion (`otlp.mjs:538` — `const route = a["mip.route"] ?? null`, repris tel quel), ni au
requêtage. Un site e-commerce ou un portail de recherche fait exploser la dimension en quelques
heures. Ce n'est pas la limite de volumétrie déjà admise : c'est une explosion de **dimensions**,
qui dégrade la lisibilité (une statistique par page, donc aucune statistique) avant de dégrader les
performances.

**Ce que fait un RUM du marché** (mon expérience) : un plafond de cardinalité par application, avec
regroupement du dépassement sous une valeur `(other)`, et une règle de normalisation configurable
par le client.

**À construire côté backend.** Table `route_pattern (app_id, pattern, remplacement, priorite)`
appliquée à l'ingestion ; compteur de cardinalité par app et par jour ; au-delà d'un seuil
(2 000 routes, à régler), les nouvelles routes deviennent `(other)` et un avertissement remonte
dans la console. Plus, immédiatement : `LIMIT 200` et remplacement des sous-requêtes corrélées de
`slowRoutes` par des CTE agrégés. Détail en §3.7.

---

## 2.7 — Activer le tracing distribué peut casser les appels d'API du client — CONFIRMÉ — sérieux

**Ce qui est en place.** Quand `cfg.trace` contient des origines, le SDK pose deux en-têtes sur les
requêtes vers ces origines : `headers.set("traceparent", …)` et `headers.set("tracestate", …)`
(`packages/rum-sdk/src/apispans.ts:103-104` pour `fetch`, `:144-145` pour XHR).

**Le mécanisme.** Un en-tête personnalisé sur une requête **cross-origin** transforme une requête
simple en requête préalablement vérifiée : le navigateur envoie un `OPTIONS`, et si la réponse
n'inclut pas `traceparent, tracestate` dans `Access-Control-Allow-Headers`, **la requête est
bloquée**. L'application du client cesse de fonctionner à l'instant où l'on active la
fonctionnalité qui doit la mesurer. Le SDK ne peut pas récupérer : le `try/catch` de
`apispans.ts:117-119` n'attrape rien, l'échec est asynchrone.

Or l'option `trace` **n'est documentée nulle part** (§1.13), et `docs/INTEGRATION.md:143` ne parle
de CORS que pour l'ingestion. Un ingénieur d'avant-vente qui active le tracing pendant une
démonstration chez le prospect casse le site du prospect, en direct. Je l'ai vu se produire avec
d'autres agents ; c'est le genre d'incident dont un pilote ne se remet pas.

**À construire.** Côté SDK : une sonde préalable (`OPTIONS` de contrôle une fois par origine, résultat
mis en cache) ou, plus simple et plus sûr, propagation **désactivée par défaut** vers les origines
externes avec un message explicite. Côté backend : le wizard d'ajout de client
(`app/admin/customers/[appId]`) doit vérifier l'en-tête `Access-Control-Allow-Headers` de l'API
déclarée et refuser d'activer le tracing tant qu'elle ne l'autorise pas. Effort : 1 journée.

---

## 2.8 — Toutes les fenêtres de temps sont en UTC, tous les écrans sont en français — CONFIRMÉ — sérieux

**Ce qui est en place.** 30 usages de `date_trunc` / `date_bin` dans `apps/console/lib/` et aucun
`at time zone` — vérifié par recherche sur `apps/console/lib/*.ts` et `apps/ingest/sql/*.sql`. La
connexion ne fixe aucun fuseau (`apps/console/lib/db.ts:43-52`). Les bornes sont donc celles du
fuseau par défaut du serveur PostgreSQL, en pratique UTC chez un hébergeur managé.

**Le mécanisme.** La heatmap « jour × heure » (`queries-grid.ts:47-48` :
`date_trunc('day', m.ts)`, `extract(hour from m.ts)`) affiche des heures UTC dans une interface
française : en été, la colonne « 9 h » contient le trafic de 11 h à Paris. La courbe « 14 jours »
et le rapport quotidien coupent la journée à **2 h du matin** heure locale, ce qui déplace le
trafic de la soirée sur le lendemain. Enfin, les deux dimanches de changement d'heure produisent
une journée de 23 h et une de 25 h : la comparaison « jour vs même jour la semaine dernière »
— fondement du z-score saisonnier (`migration-v17.sql:78-99`) — compare des fenêtres de longueurs
différentes.

**À construire côté backend.** Colonne `timezone text not null default 'Europe/Paris'` sur
`app_registry` ; toutes les fonctions de bucket prennent le fuseau en paramètre et écrivent
`date_trunc('day', m.ts at time zone tz)`. Le pré-agrégat horaire reste en UTC (c'est le bon
grain) ; seul le regroupement journalier bascule. Effort : 1 journée, plus la reprise des écrans.

---

## 2.9 — Rien ne distingue le temps de l'événement du temps d'arrivée — CONFIRMÉ — notable

**Ce qui est en place.** La garde anti-dérive d'horloge existe et elle est bien faite
(`apps/ingest/supabase/functions/_shared/otlp.mjs:71-82`) : hors de la fenêtre `[maintenant − 7 j,
maintenant + 5 min]`, l'horodatage client est remplacé par l'heure de réception. Mais **aucune
table ne conserve l'heure de réception** : `rum_metric`, `rum_error`, `rum_pageview` n'ont qu'une
colonne `ts` (`apps/ingest/sql/schema.sql:33-45`, `:47-58`, `:21-31`).

**Le mécanisme.** Un poste dont l'horloge retarde de deux jours — cas banal sur des terminaux
d'entreprise mal synchronisés — voit ses mesures acceptées telles quelles et déposées deux jours
dans le passé. Elles n'apparaissent dans aucun tableau de bord « 24 h », et **modifient
rétroactivement** un historique déjà consulté. Symétriquement, aucun écran ne peut répondre à
« est-ce que je reçois toujours des données ? » : `max(ts)` mélange retard d'arrivée et absence
d'émission. La file de rejeu (jusqu'à 7 jours de retard toléré) a le même effet.

**À construire.** `received_at timestamptz not null default now()` sur les tables d'ingestion,
indexé, plus une métrique de retard `p95(received_at - ts)` par application dans l'écran
`/admin/health`. C'est aussi ce qui permettra de savoir quand un pré-agrégat doit être recalculé.
Effort : 3 heures.

---

## 2.10 — Percentiles calculés à chaque affichage, sur des lignes brutes, sans index de couverture — CONFIRMÉ — notable

**Ce qui est en place.** Le pré-agrégat horaire `rum_rollup_hourly` (`migration-v12.sql:20-29`) ne
porte que des **comptages** : `good_w`, `total_w`, `pageviews`, `errors`. Le commentaire
`queries-grid.ts:16-19` le dit : « les p75 restent sur les lignes brutes ». Chaque affichage de la
vue d'ensemble lance donc plusieurs `percentile_cont` sur `rum_metric`, plus les séries.

Les index existants sont `(app_id, route)`, `(name, ts)`, `(session_id)` et un BRIN sur `ts`
(`schema.sql:127-129`, `migration-v12.sql:13`). **Aucun index `(app_id, ts)`** — le prédicat
exact des requêtes. Sur `rum_session`, il n'y a **aucun index sur `user_hash`** ni sur
`last_seen_at`, alors que `visitStats` (`apps/console/lib/queries.ts:401-444`) exécute un
`exists(select 1 from rum_session s2 where s2.user_hash = s.user_hash …)` **par session de la
fenêtre**, sur toute la table, sans borne temporelle. Coût quadratique.

**Pourquoi ça compte séparément de la limite de volumétrie déjà admise.** La vitrine annonce
« ~10⁶–10⁷ sur PostgreSQL avant que les percentiles ne s'effondrent ». Une jointure quadratique
sans index s'effondre **bien avant** — ce n'est pas la limite du moteur, c'est la forme de la
requête. Il serait dommage d'attribuer à PostgreSQL une lenteur qui vient d'un index manquant.

**À construire.** Index `(app_id, ts desc)` sur `rum_metric`, `rum_error`, `rum_pageview` ;
`(user_hash)` et `(app_id, last_seen_at desc)` sur `rum_session` ; réécriture de `visitStats` avec
un pré-calcul `user_first_seen (app_id, user_hash, first_seen)` entretenu à l'ingestion. Puis
percentiles pré-agrégés (§3.8). Effort : 2 heures pour les index, 2 jours pour les percentiles.

---

## 2.11 — Le signal LOGS n'a aucune idempotence — CONFIRMÉ — notable

`writeLogs` (`apps/ingest/lib/pg-ingest.mjs:296-309`) insère sans clause `on conflict`, sur une
table à clé `bigserial` — le commentaire l'assume : « bigserial : pas de contrainte
d'idempotence ». Or le même `withRetry` que les traces enveloppe l'appel
(`apps/ingest/lib/receiver.mjs:143-145`). Un rejeu après un échec transitoire **duplique** les
lignes. Ces lignes alimentent la métrique d'alerte `log_errors`
(`apps/ingest/sql/migration-v38.sql:48-53`) : un incident réseau pendant un pic de logs gonfle le
compte et peut déclencher l'alerte que l'incident n'aurait pas justifiée.

**À construire.** Une clé naturelle `(app_id, trace_id, span_id, ts, hash(body))` en index unique
partiel, et `on conflict do nothing`. Effort : 2 heures.

---

## 2.12 — Une trace peut être cassée par une navigation SPA en vol, et rien n'expire les sessions longues — CONFIRMÉ — notable

**a) Trace cassée.** Le `traceId` d'un appel API est capté au **départ** de la requête
(`apispans.ts:98`), le span n'est créé qu'à son **retour** (`apispans.ts:109`). Entre les deux, une
navigation SPA appelle `newPageTrace()` (`index.ts:199`), qui change `pageTraceId` **et**
`pageSpanId` (`otel.ts:97-101`). Le span reçoit alors `parentSpanId = pageSpanId` de la **nouvelle**
page (`otel.ts:179`) puis se voit réattribuer le `traceId` de l'**ancienne** (`otel.ts:198`) : il
désigne un parent qui n'appartient pas à sa trace. Le waterfall de cette trace est orphelin, et
celui de la nouvelle page attend un enfant qui n'arrivera pas. C'est exactement ce que le
commentaire `otel.ts:75-84` cherchait à éviter dans l'autre sens.

**b) Sessions sans fin.** `getOrCreateSession` n'applique qu'un délai d'inactivité de 30 minutes
(`session.ts:2`, `:45-46`), sans **durée maximale**. Un poste de supervision ou un affichage mural
qui garde l'onglet ouvert conserve la même session pendant des semaines, avec un `started_at`
figé. Les requêtes qui bornent sur `s.started_at` cessent de la voir ; celles qui bornent sur
`last_seen_at` la comptent. La purge de rétention ne la supprimera jamais tant qu'elle vit
(`migration-v14.sql:37-47`).

**À construire.** Côté SDK : capturer `traceId` **et** `parentSpanId` au départ de la requête et les
porter dans les attributs ; plafonner la session à 4 h (standard analytics). Côté backend :
`rum_session.max_duration` n'est pas nécessaire — il suffit que le SDK ouvre une session neuve,
mais l'ingestion doit accepter deux sessions pour un même `user_hash` dans la même minute sans les
fusionner. Effort : ½ journée.

---

## 2.13 — Toutes les tablettes sont comptées comme des ordinateurs de bureau — CONFIRMÉ — notable

**Ce qui est en place.** Le SDK décide du type d'appareil avec
`/mobile|tablet/i.test(navigator.userAgent)` (`packages/rum-sdk/src/index.ts:105-107`). Le repli
serveur, lui, connaît le sujet — `/mobile|tablet|iphone|ipad|android|silk|kindle/i`
(`apps/ingest/supabase/functions/_shared/otlp.mjs:34`) — mais il n'est consulté **que si**
l'attribut du SDK est absent (`otlp.mjs:549` et `:572`, `a["mip.device_type"] ?? deviceFromUa(…)`).

**Le mécanisme.** Une tablette Android annonce « Android » sans « Mobile » : elle tombe dans
`desktop`. Un iPad sous iPadOS 13 ou plus récent s'annonce « Macintosh » par défaut : `desktop`
aussi. Le commentaire de `apps/ingest/sql/schema.sql:13` annonce pourtant
« mobile/desktop/tablet », le serveur MCP expose la valeur `tablet`
(`apps/mcp/serveur.mjs:44`) — qui ne correspondra jamais à aucune ligne — et le filtre de la
console ne connaît que deux valeurs (`apps/console/lib/filters.ts:42`).

**Pourquoi ça compte.** Le segment tablette est celui dont les performances divergent le plus du
bureau (CPU mobile, réseau mobile, écran tactile donc INP différent). Le noyer dans `desktop`
déplace vers le haut le p75 « bureau » et masque un problème réel. C'est aussi une question que
pose systématiquement un acheteur qui a un parc mixte.

**À construire.** Trois valeurs côté SDK (`mobile` / `tablet` / `desktop`) en s'appuyant sur
`navigator.userAgentData.mobile` quand il existe et sur la taille d'écran en repli ; côté backend,
étendre l'énumération et le filtre de la console, et **ne pas rétro-classer** l'existant (marquer
`device_source` pour distinguer). Effort : ½ journée.

---

## Pistes non conclues — À VÉRIFIER

Trois observations sérieuses dont je n'ai pas pu fermer la démonstration. Elles ne sont pas
comptées dans les findings.

1. **`pageview_id` est une clé étrangère morte.** `rum_metric.pageview_id` et
   `rum_error.pageview_id` existent au schéma (`apps/ingest/sql/schema.sql:37`, `:51`) mais ne
   figurent dans aucune liste de colonnes d'insertion (`apps/ingest/lib/pg-ingest.mjs:196-206`) :
   elles valent toujours `NULL`. Conséquence probable : les gardes de la purge de rétention
   `not exists (select 1 from rum_metric m where m.pageview_id = p.id)`
   (`apps/ingest/sql/migration-v14.sql:33-34`, repris en `migration-v30.sql:25-26`) sont
   **toujours vraies**, donc sans effet. Je n'ai pas vérifié si cela produit une suppression
   indésirable ou seulement du code mort ; à trancher avant de s'appuyer dessus. Le rattachement
   métrique → page vue serait par ailleurs la clé d'un p75 « par page vue » conforme au standard
   CWV (§1.5).
2. **`transfer_size` est collecté et jamais restitué.** Le SDK l'émet (`resources.ts:30`,
   `entry.transferSize ?? 0`), l'ingestion l'écrit (`pg-ingest.mjs:212`), et aucune requête de la
   console ne le lit (recherche `transfer_size` dans `apps/console` : aucun résultat). Or
   `apps/console/lib/specs.ts:277` annonce « type, **taille transférée**, blocage du rendu ».
   S'ajoute un doute de validité : pour une ressource d'une autre origine sans en-tête
   `Timing-Allow-Origin`, le navigateur rend `0`, indiscernable d'une vraie taille nulle —
   exactement les scripts tiers qu'on cherche à incriminer.
3. **Le pré-agrégat ne couvre pas la profondeur de l'écran qui le lit.** `refresh_rum_rollups`
   recalcule 26 heures par défaut (`apps/ingest/sql/migration-v12.sql:51`) alors que la heatmap lit
   14 jours dans la même table quand `RUM_USE_ROLLUPS=1` (`apps/console/lib/queries-grid.ts:13`,
   `GRID_DAYS = 14`, et la branche rollup en `:35-45`). Tant que le job tourne sans interruption, le remplissage est progressif et
   l'écran est juste. Après une coupure de plus de 26 heures, la heatmap devrait présenter un trou
   là où le chemin brut affiche des données. Le drapeau étant à `0` en production, je n'ai pas pu
   l'observer ; à tester avant de l'activer.

---

# PARTIE 3 — BACKEND : le plan pour combler

Ordre imposé par la dépendance et par le risque, pas par la difficulté. Les charges annoncées sont
des estimations d'ingénieur familier du dépôt, hors revue et déploiement. Les lots 0 à 2 totalisent
**7 jours** et suppriment l'essentiel de ce qui est faux ; les lots 3 et 4 (**10 jours**) sont ceux
qui rendent le produit tenable en production ; les lots 5 et 6 (**8 jours**) sont le chantier
structurel. Soit environ **cinq semaines-homme** pour l'ensemble.

## Lot 0 — Corriger ce qui est faux, à coût quasi nul (2 jours)

Aucun de ces cinq correctifs ne demande de schéma nouveau. Ils suppriment cinq affirmations
fausses.

| # | Correctif | Emplacement | Effort |
|---|---|---|---|
| 1.2 | `and m.name in ('LCP','INP','CLS','FCP','TTFB')` dans le score de santé, la heatmap et le rollup, puis `select refresh_rum_rollups(24*15)` pour recalculer l'historique | `health.ts:74`, `queries-grid.ts:50`, `migration-v12.sql:59-64` | ½ j |
| 1.9 | `nullif(count(*),0)` au lieu de `greatest(count(*),1)` dans `slo_status()`, `fast_burn` et `burned_pct` deviennent `null`, `check_slo_burn()` ignore les `null` | `migration-v17.sql:119`, `:130-148`, `:277` | 2 h |
| 1.10 | Générer `docs/CONFORMITE.md` depuis `lib/legal.ts`, ou l'ajouter à `tests/unit/specs.test.ts` | `docs/CONFORMITE.md` | 2 h |
| 1.12 | Dire le repli CDN dans `specs.ts:261` et `CONFORMITE.md:27`, ou retirer le repli | `receiver.mjs:156` | 30 min |
| 1.7 | Retirer l'origine et l'empreinte de contenu dans `firstStackFrame`, + table d'alias `error_fingerprint_alias (app_id, old_fp, new_fp)` et job de reprise | `otlp.mjs:117-124` | 1 j |

**Ordre d'exécution** : 1.10 et 1.12 d'abord (relecture juridique), puis 1.2, puis 1.9, puis 1.7.

## Lot 1 — Identité du visiteur (3 jours) — condition de toute promesse RGPD

*Contrat d'ingestion.* Nouvel attribut de span `mip.visitor_id` (UUID v4 aléatoire, tiré par le
SDK, persisté sous consentement). `mip.user_hash` continue d'être accepté en repli, avec une
marque d'origine.

*Schéma.*

```sql
alter table rum_session add column if not exists visitor_id text;
alter table rum_session add column if not exists id_kind text not null default 'device_class';
  -- 'random' | 'device_class'  (les lignes existantes restent 'device_class')
create index if not exists idx_session_visitor on rum_session (app_id, visitor_id)
  where visitor_id is not null;
```

*Requêtes.* `count(distinct visitor_id)` remplace `count(distinct user_hash)` partout
(`queries-summary.ts:148`, `migration-v40.sql:57`, `queries-cohorts.ts:20`). `visitStats`
(`queries.ts:430-434`) borne enfin par `app_id` et s'appuie sur un pré-calcul (voir Lot 5).

*Garde-fou DSAR.* `dsar_export()` et `erase_session()` **refusent** de s'exécuter sur une ligne
`id_kind = 'device_class'` et renvoient un message explicite. C'est moins confortable, mais
répondre partiellement à une demande art. 15 vaut mieux que communiquer les données d'un tiers.

## Lot 2 — Fenêtres et compteurs d'erreurs (2 jours)

*Schéma.*

```sql
create table if not exists error_group_hourly (
  app_id text not null, fingerprint text not null, hour timestamptz not null,
  occurrences bigint not null default 0,
  sessions    bigint not null default 0,
  visitors    bigint not null default 0,
  primary key (app_id, fingerprint, hour)
);
create index if not exists idx_egh_app_hour on error_group_hourly (app_id, hour desc);
```

*Job planifié.* `refresh_error_group_hourly(p_hours int default 26)`, calqué sur
`refresh_rum_rollups` (`migration-v12.sql:51-90`), branché sur le tick de 5 minutes du scheduler
(`services/scheduler/worker.mjs`, `CADENCES`).

*Requête.* `errorGroups()` somme sur la fenêtre demandée et trie par `visitors desc` (impact réel,
pas volume brut). `first_seen` reste lu dans une vue non bornée — c'est la seule valeur pour
laquelle « depuis toujours » est la bonne réponse — mais il faut le **libeller** ainsi.

## Lot 3 — Poids d'échantillonnage et déduplication des vitals (5 jours) — le lot le plus structurant

*Contrat d'ingestion.* Trois nouveaux champs :
`mip.sample_rate` (attribut de **resource**, la fraction effective de la session),
`webvital.id` et `webvital.delta` (déjà émis par le SDK, `vitals.ts:70-73`, aujourd'hui jetés).

*Schéma.*

```sql
alter table rum_session add column if not exists sample_rate double precision not null default 1;
alter table rum_metric  add column if not exists weight      double precision not null default 1;
alter table rum_metric  add column if not exists metric_uid  text;
alter table rum_pageview add column if not exists weight     double precision not null default 1;
alter table rum_error    add column if not exists weight     double precision not null default 1;

create unique index if not exists uq_metric_report
  on rum_metric (session_id, name, metric_uid) where metric_uid is not null;
```

*Écriture.* Dans `pg-ingest.mjs:196-200`, pour CLS et INP :
`on conflict (session_id, name, metric_uid) do update set value = excluded.value, rating =
excluded.rating, ts = excluded.ts` — le **dernier** rapport gagne, c'est la valeur définitive.
Pour LCP/FCP/TTFB : `do nothing`. `weight = 1 / sample_rate`, posé à l'ingestion depuis l'attribut
de resource.

*Requêtes.* `count(*)` → `sum(weight)` partout où un volume est affiché. Pour les percentiles
pondérés, PostgreSQL n'a pas de `percentile_cont` pondéré : la solution la moins coûteuse est de
passer par les histogrammes du Lot 5 (un percentile sur histogramme est naturellement pondéré). En
attendant, afficher un avertissement quand `min(sample_rate) < 1` sur la fenêtre — **une valeur
biaisée annoncée comme telle vaut mieux qu'une valeur biaisée présentée comme exacte**.

## Lot 4 — Protection de l'ingestion (5 jours)

*Schéma.*

```sql
create unlogged table if not exists ingest_raw (
  id bigserial primary key, app_id text not null, signal text not null,
  received_at timestamptz not null default now(), payload jsonb not null,
  processed_at timestamptz
);
create index if not exists idx_ingest_raw_todo on ingest_raw (id) where processed_at is null;
```

*Chemin de requête* (`receiver.mjs:116-175`) : validation de taille, `JSON.parse`, garde de clé sur
le cache mémoire **uniquement**, un `INSERT` dans `ingest_raw`, réponse 200. Plus de transaction de
12 `INSERT` dans la requête.

*Travailleur* (nouveau job du scheduler) : lot de 500 lignes `for update skip locked`, `flattenOtlp`,
`writeRows`, `processed_at = now()`. Une seule instance travaille grâce au bail existant
`scheduler_lease`.

*Débit.* Compteur en mémoire par instance, réconcilié en base toutes les 10 secondes — au lieu d'un
`rate_check()` par beacon (`pg-ingest.mjs:404-408`). En cas d'indisponibilité de la base, le
comportement de repli devient **refus** au-delà d'un plafond local, pas acceptation
inconditionnelle.

*Côté SDK, en parallèle* : plafond d'erreurs et déduplication (§2.1), tri 4xx/5xx et retrait
exponentiel dans la file de rejeu (§2.2). Ces deux correctifs client valent autant que le
découplage serveur.

## Lot 5 — Percentiles pré-agrégés et fuseau (5 jours)

*Schéma.*

```sql
create table if not exists metric_histogram_hourly (
  app_id text not null, device_type text not null default '', route text not null default '',
  name text not null, hour timestamptz not null,
  bucket int not null,              -- index d'un découpage log-linéaire figé
  weighted_count double precision not null,
  primary key (app_id, device_type, route, name, hour, bucket)
);
alter table app_registry add column if not exists timezone text not null default 'Europe/Paris';
```

Un p75 se lit alors par somme cumulée des seaux, **sommable sur n'importe quelle fenêtre**, et
**naturellement pondéré** (il résout donc aussi la moitié restante du Lot 3). Le découpage doit
être figé une fois pour toutes : le changer invalide l'historique. Le regroupement journalier passe
par `at time zone (select timezone from app_registry …)`.

## Lot 6 — Cardinalité (3 jours)

`route_pattern (app_id, pattern, remplacement, priorite)` appliquée dans `flattenOtlp`
(`otlp.mjs:538`), compteur `route_cardinality (app_id, day, n)` entretenu par le travailleur, et
bascule automatique vers `(other)` au-delà du seuil, avec un avertissement dans `/admin/health`.
Plus, immédiatement : `LIMIT 200` et suppression des sous-requêtes corrélées dans `slowRoutes`
(`queries.ts:192-217`).

## Ce qu'il ne faut pas faire dans cet ordre

Ne pas commencer par ClickHouse. Le chemin est prouvé et le bench de `infra/clickhouse.notes.md`
est honnête, mais migrer un modèle qui compte des rapports au lieu de pages vues, qui mélange les
fenêtres et qui ignore le poids d'échantillonnage ne ferait que **rendre les mêmes chiffres faux
plus vite**. Les lots 0 à 3 fixent la sémantique ; la migration de moteur vient après.

---

## Ce qui m'a impressionné, et qui doit être dit

Trois choses, parce qu'elles sont rares et qu'elles doivent survivre aux corrections ci-dessus :
la garde anti-dérive d'horloge (`otlp.mjs:71-82`) est mieux faite que dans la plupart des
ingestions que j'ai auditées ; le nettoyage PII en double barrière, client **et** serveur, avec
troncature **après** nettoyage (`otlp.mjs:600-601`), est le bon ordre et presque personne ne le
fait ; et le dispositif de `lib/specs.ts` — chaque affirmation de vitrine portant le fichier qui
peut la contredire en intégration continue — est un mécanisme que je n'ai vu dans aucun produit
commercial. Les findings de la partie 1 ne sont pas des oublis de rigueur : ce sont exactement les
endroits que ce dispositif ne couvre pas encore, parce qu'il vérifie qu'un fichier existe, pas
qu'un nombre veut dire ce qu'il prétend. **L'étendre aux valeurs — un test qui recalcule le score
de santé sur un jeu figé, un test qui compare le compteur d'occurrences à la fenêtre demandée — est
probablement le meilleur investissement du dépôt.**
