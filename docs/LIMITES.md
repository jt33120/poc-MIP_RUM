# Limites explicites du produit (POC)

Liste honnête, demandée par Julian, commencée le 10/06/2026 (v0.1) et complétée par des mises à jour **datées**, la plus récente en tête. Chaque section dit l'état à sa date : quand une section plus récente contredit une plus ancienne, c'est la plus récente qui vaut. Le bilan capacité par capacité est dans [`RUM_PARITY_STATUS.md`](RUM_PARITY_STATUS.md), ce qui tourne en production dans [`TOPOLOGIE_BACKEND.md`](TOPOLOGIE_BACKEND.md).

Tableaux d'origine (fin du document) : colonne « v0.2 » = traité dans le sprint nuit du 10→11/06 (cf. archive/ROADMAP_V02.md) ; « v0.3 » = sprint nuit 2 (cf. archive/ROADMAP_V03.md et la section v0.3) ; « Phase 1+ » = nécessite un vrai chantier produit MIP.

## Mise à jour du 26/09/2026 (ce que la CI et la production ont changé depuis P8.8)

Vérifié contre `.github/workflows/ci.yml`, `.railway/railway.ts`, les ADR et les relevés de production
(`docs/operations/releve-p0-2026-09-23.md`, `docs/TOPOLOGIE_BACKEND.md` « Relevé du 26/09/2026 »). Les
lignes de la mise à jour P8.8 que ces faits rendent fausses le disent en place.

| Sujet | Ce qui est garanti | Ce qui ne l'est pas |
|---|---|---|
| **Base de données** | La base est sur Neon (Francfort), offre gratuite, en mode dégradé assumé : cadences des travaux planifiés à 15 minutes dans le code ([ADR-0014](architecture/adr/0014-base-gratuite.md)). | **100 heures de calcul par mois.** Le quota a été dépassé le 24/09/2026 : calcul suspendu jusqu'au 01/10/2026, et tout ce qui dépend de la base (collecte, écrans, travaux planifiés) est à l'arrêt jusque-là. La collecte continue d'un vrai site suffirait à épuiser le quota ; le stockage est plafonné à 0,5 Go. |
| **Migrations en production** | Le `scheduler` est le seul migrateur, au pré-déploiement ; v86 est appliquée (23/09). | v87 → v93, sur `master`, attendent le prochain déploiement réussi du `scheduler` : tous échouent depuis le 24/09, faute de base. |
| **Chemin d'ingestion** | Le trafic entre par la console Vercel (`/api/ingest/v1/*`), avec le parseur et l'écriture de `@mip/backend`. Le service Railway `ingest`, qui tournait sans domaine public, a été supprimé le 21/09/2026. | Le `collector` qui doit reprendre la collecte (relais de la console, [ADR-0005](architecture/adr/0005-relais-ingestion.md)) est déclaré dans `.railway/railway.ts` mais **pas créé** ; le relais est livré à 0 %. D'ici là, la console lit et écrit la base directement. |
| **Recette sur vraie application** | Du trafic arrive : lu en base le 23/09, 378 événements pour `gip-plateforme`, le dernier ce jour-là à 13:01 UTC. | Aucun écran n'a été relu sur ce trafic ; le volume est faible. |
| **CI** | Depuis le 24/09 (#281) : typage de la console, des SDK, de l'agent Node et de l'extension ; construction depuis un dépôt propre ; les deux bancs de mesure sur une base semée ; les fenêtres de déploiement SQL, chacune avec sa base ; PostgreSQL 17 partout. Vert sur `master` à `09833f1` (25/09). | Le JavaScript du backend (`packages/backend`, `packages/db`, `packages/mcp-tools`, `services/*`, en `.mjs`) n'est typé par rien. Les bancs n'ont **aucun seuil de latence** : leurs temps sont imprimés, pas comparés. Les bancs de charge (`scripts/load-bench.mjs`, `scripts/bench/`) restent hors CI. |
| **Effacement et sauvegardes** | Une procédure de restauration qui repose les barrières d'effacement est **écrite** depuis le 24/09/2026 ([runbook](operations/runbook.md), § 8). | Elle n'a **jamais été éprouvée**, et sa partie « identités » reste manuelle. L'offre gratuite ne garde que 6 heures d'historique. |
| **Pays par adresse IP** | Le chemin est choisi (ADR-0005, 24/09) : collecte directe au `collector` (P6b.G), après le relais ; l'image du `collector` télécharge la base DB-IP Lite à sa construction. | **Aucun pays n'est résolu par adresse** : le `collector` n'est pas créé, garde le GeoIP éteint (`GEOIP_IP_SOURCE: "none"`), et le relais ne lui transmettra que le pays posé par Vercel. |

## Mise à jour P8.8 (18/09/2026 — ce que la recette finale a établi ou mesuré)

Bilan complet, capacité par capacité : [`RUM_PARITY_STATUS.md`](RUM_PARITY_STATUS.md). Ne figurent
ici que les limites **nouvelles**, ou dont ce relevé a changé la portée. Chacune a été vérifiée sur
`master` à `2f216cb` (P8.6 et P8.7 fusionnés), sur bases jetables ; aucune base de production n'a été
interrogée.

| Sujet | Ce qui est garanti | Ce qui ne l'est pas |
|---|---|---|
| **Recette sur vraie application** | Les suites locales et la CI sont vertes, sur fixtures et sur bases jetables. | **Aucun écran, aucune API, aucun outil MCP de P5 à P8 n'a été éprouvé sur des données réellement ingérées.** C'est la limite qui domine toutes les autres : un chiffre juste sur fixtures peut être faux sur du trafic. |
| **Chemin d'ingestion réellement joignable** | Le trafic entre par la console Vercel (`app/api/ingest/v1/traces/route.ts`), avec le même parseur et le même writer que le backend. | Au 18/09, le service Railway `ingest` **n'avait aucun domaine public** : il tournait, et rien ne l'atteignait. **Il a été supprimé le 21/09/2026** ; le `collector` qui le remplace dans le code n'est pas créé (mise à jour du 26/09). Tout ce qui n'existe que dans l'image backend ne s'exécute donc pas sur le trafic — à commencer par la base GeoIP de P8.7, et par le port direct `POST /v1/sourcemaps`. |
| **Vérification des types** | `pnpm --filter console exec tsc --noEmit` est vert. | **Levé** : le 18/09, `pnpm --filter @mip/rum-sdk exec tsc --noEmit` échouait (`src/replay.ts:242`) et aucun workflow ne jouait `tsc --noEmit` ; #213 (18/09) a corrigé le type et ajouté le typage des paquets et de la console à la CI, #281 (24/09) celui de l'extension. |
| **Construction du dépôt** | `pnpm -r build` est vert **après** `pnpm build:sdk` : 13 paquets. | **Corrigé le 24/09** (#281) : au 18/09, il échouait depuis un dépôt fraîchement installé, `apps/extension` copiant `packages/rum-sdk/dist/mip-rum.js` sans déclarer de dépendance ; elle est déclarée, et un job de la CI construit le dépôt sans `pnpm build:sdk` préalable. |
| **Couverture de la CI SQL** | `test:sql`, `test:isolation`, `test:alerting` et `test:svi` tournent à chaque PR, et sont verts. | **Levé** : au 18/09, deux suites étaient ignorées en silence, faute de leur variable. La fenêtre v82 vers v83 (`SQL_TEST_PRE_V83_DATABASE_URL`) est jouée depuis #213 (18/09), les deux bancs de mesure (`BENCH_DATABASE_URL`) par un job à part depuis #281 (24/09), sans seuil de latence. |
| **Fenêtre de déploiement de P8.2** | Elle passait sur `ed33e27`, avec sa base dédiée. | **Elle échoue depuis v85** : `column "geo_source" of relation "rum_session" does not exist`. Le cache de colonnes de `pg-ingest.mjs` est indexé par table et non par base ; la suite écrit dans une base au schéma v82 depuis le même processus et hérite de la liste de colonnes de la base complète. `_resetColonnesCache()` existe, neuf suites SQL l'appellent, celle-ci non. **La CI ne joue pas cette suite**, donc rien ne l'a signalé. **Corrigé le 18/09** par #213 (cache vidé avant chaque cas, base déclarée dans la CI) : 52 verts sur 52 le 23/09. |
| **Pays par base IP (P8.7, v85)** | Le code est fusionné, la migration appliquée, le service déployé ; aucune adresse IP n'est stockée, ni mise en cache, ni envoyée à un tiers. | **Il ne résout aucun pays sur le trafic actuel** : la base était dans l'image Railway d'`ingest`, sans domaine public puis supprimé le 21/09 ; elle est aujourd'hui dans l'image du `collector`, qui n'est pas créé. La route Vercel qui reçoit tout le trafic n'appelle délibérément pas la résolution locale. La base elle-même n'est pas versionnée : l'image du `collector` la télécharge à sa construction (mise à jour du 26/09). |
| **Connecteur de tickets (P8.6, v84)** | Le code est fusionné, la migration appliquée à 13:30:35 UTC, le connecteur déployé ; le lien manuel de P5.6 fonctionne toujours sans connecteur. | **Déployé et inerte** : aucune intégration configurée, `TICKET_INTEGRATIONS` non posé, interface d'administration cachée. Un seul fournisseur (GitHub Issues), et le produit dit lui-même que la cible reste l'ITSM de MIP, « ServiceNow, sous réserve de confirmation ». Aucune écriture vers le fournisseur après la création : résoudre une issue ne ferme pas le ticket. Le webhook n'a jamais reçu de livraison réelle. |
| **Compteur de visiteurs mobiles** | Le visiteur web est un tirage aléatoire persisté localement. | Le visiteur **mobile** est un tirage **mémoire**, remis à zéro à chaque lancement : le compteur de visiteurs mobiles **surestime** les personnes. Défaut connu, non corrigé. |
| **Compatibilité React Native** | Le paquet est construit, ses exports CJS/ESM/types sont vérifiés par 36 contrôles en CI. | **La matrice de compatibilité est vide.** Aucune version de React Native, React, Hermes, JSC, Metro, iOS, Android, Fabric, Paper, React Navigation ni Expo n'a été exécutée. Rien ne doit être promis sur ce point. |
| **Rétention** | `purge_rum_app` couvre les tables RUM, les agrégats et leurs marques d'invalidation. | Elle **ne purge toujours pas les tables SVI** — `erase_app_data` les vide, la rétention non. Vérifié en base le 18/09. |
| **Effacement et sauvegardes** | L'effacement est sérialisé avec tous les chemins d'écriture, et les barrières sont actives sans expiration. | **La garantie ne porte pas sur les sauvegardes** : une restauration PITR antérieure à un effacement devrait rejouer les barrières avant de rouvrir lectures et ingestion. Au 18/09, cette procédure n'était ni écrite ni éprouvée ; elle est écrite depuis le 24/09/2026 (runbook, § 8), **jamais éprouvée**. |
| **Export à la mort d'un processus** | Les envois acquittés ne sont jamais rejoués en double. | Trois pertes restent possibles : vidage durable non garanti à l'arrêt fatal d'un service Node ; chunk de rejeu web arrivé avant son ancre OTLP sous `enforce` (`425`, corps non persisté, SDK web sans rejeu) ; file mobile en mémoire, le stockage durable étant désactivé par défaut. |
| **Crashes natifs** | L'écran `/mobile` affiche « Non collecté ». | **Aucune table de crash natif n'existe**, délibérément : une table vide se lirait comme un zéro. Une erreur `ErrorUtils` n'est pas un crash natif. |

## Mise à jour P6.6 (18/09/2026 — agrégats pré-calculés et budget de lecture)

Quand l'Explorer répond depuis un agrégat plutôt que depuis les lignes, il le DIT : `meta.source` vaut
`rollup+raw`, `meta.approximate` passe à vrai et `meta.rollup.reason` donne, le cas échéant, la raison
pour laquelle l'agrégat n'a pas pu servir. Rien n'est arrondi en silence.

| Sujet | Ce qui est garanti | Ce qui ne l'est pas |
|---|---|---|
| Emploi d'un agrégat | Il ne répond que s'il porte **toutes** les dimensions demandées (regroupement ET filtres) et **exactement** la même population. Un agrégat sans colonne navigateur ne répond jamais à `browser=Firefox`. | Aucun rabattement « au plus près » : la lecture repasse aux lignes brutes, plus lente et juste. |
| Percentiles | Les distributions horaires sont **fusionnées**, puis le quantile est lu sur la distribution obtenue. | Jamais une moyenne de p75 horaires : elle donnerait à une heure creuse le poids d'une heure de pointe. Valeur approchée à une largeur de seau (2 %) près, annoncée par `meta.approximate`. |
| Dénominateur | L'agrégat sert le compte **observé** (`observed_count`, migration-v80), le même que la lecture brute. | `weighted_count` (poids d'échantillonnage, v61) reste réservé aux tuiles de qualité : les deux ne se comparent pas. |
| Partition agrégat / brut | Les heures **entières** consolidées sous le filigrane viennent de l'agrégat ; tout le reste — heure en cours comprise — est relu brut. Aucune ligne n'est comptée deux fois. | L'heure en cours n'est jamais servie par un agrégat, quelle que soit sa fraîcheur. |
| Arrivées tardives, DSAR | Une mesure arrivée après le filigrane est relue brute ; un effacement DSAR **marque** l'heure, que la lecture cesse de croire jusqu'au rafraîchissement suivant. | Aucun recalcul historique massif : une marque plus vieille que la fenêtre de rafraîchissement laisse son heure en lecture brute jusqu'à la reprise historique (P8). |
| Distincts (sessions, visiteurs, utilisateurs) | Toujours calculés sur les lignes. | Jamais une somme de distincts horaires : une session qui traverse une heure serait comptée deux fois. Aucune structure fusionnable (HLL, t-digest) n'existe dans ce dépôt. |
| Budget de lecture | `statement_timeout` posé en `SET LOCAL`, rendu avec la transaction : il ne fuit jamais vers la requête suivante du pooler. Dépassement → 503 `query_budget_exceeded`. | Jamais une série de zéros qu'on prendrait pour une absence de trafic. |
| Temps de réponse | Mesuré sur base jetable de 1,2 M d'événements sur 7 jours (voir l'en-tête de `migration-v80.sql`) : 26 à 337 ms selon la lecture, 1 030 ms au p95 pour la plus lourde. | Ce n'est pas un SLA de production : la mesure vaut pour ce matériel, ce volume et ce jeu de données. |

## Mise à jour P6.5 (18/09/2026 — tableaux de bord graphiques et vues enregistrées)

Ce que les bornes valent, et ce qu'elles n'ouvrent pas. Toutes sont appliquées avant SQL, et chacune a son test.

| Borne | Valeur | Ce qu'elle signifie |
|---|---|---|
| Cartes par tableau de bord | 24 | Inchangé depuis P1. Une carte illisible **compte** : elle n'est pas supprimée pour faire de la place. |
| Fenêtre propre d'une carte (`rangeOverride`) | preset glissant, ou 30 jours au plus | Elle est **affichée sur la carte**. Sans elle, la carte suit la fenêtre de l'écran — et le dit aussi. Elle n'étend jamais la rétention. |
| Conditions d'une carte | 10 au total (AST + carte) | Les filtres de la carte s'**ajoutent** à ceux de l'écran ; ils ne remplacent rien. Les drapeaux robots / apps internes ne peuvent que **restreindre** la population globale, jamais la rouvrir. |
| Lectures simultanées d'une grille | 4 | Vingt-quatre cartes lancées ensemble épuiseraient le pool de connexions. Aucun rafraîchissement automatique : pas de 24 requêtes lourdes toutes les 5 s. |
| Cache d'une grille | 10 s, 200 entrées, clé incluant le périmètre effectif | Deux cartes identiques ne posent la question qu'une fois. Une réponse calculée pour A ne peut pas servir à B. |
| Export CSV | 10 000 lignes, plafond **global** | La troncature est **écrite dans le fichier** : un export tronqué ne doit pas passer pour l'inventaire complet. Une cellule commençant par `=`, `+`, `-` ou `@` est préfixée d'une apostrophe — jamais une formule exécutée par un tableur. |
| Vues enregistrées | 50 par compte **et** par app, nom ≤ 100 caractères, AST ≤ 32 Kio | Le plafond est compté dans la transaction d'écriture, derrière un verrou : deux onglets ne peuvent pas passer à 51 chacun. |

Ce que P6.5 ne fait **pas** : aucun éditeur de formule libre (les représentations sont `value`, `toplist`,
`timeseries`, `table`, et rien d'autre) ; aucune vue publique ni partage app-wide — une vue enregistrée
appartient à un compte et à **une app nommée**, faute de quoi la même vue mesurerait une population
différente selon son lecteur ; aucun export PDF par service tiers (impression de la vue existante) ;
aucun agrégat pré-calculé ni budget de lecture mesuré — c'est P6.6.

## Mise à jour P6.3 (17/09/2026 — analyses prêtes à l'emploi et drill-downs)

Ce que les nouveaux chiffres mesurent EXACTEMENT, et ce qu'ils ne mesurent pas. Chaque définition est
affichée à l'écran (bulle de glossaire) et vérifiée par un test ; aucune n'emprunte une convention du
marché sans la nommer.

| Mesure affichée | Définition exacte | Ce qu'elle n'est PAS |
|---|---|---|
| Découpage par dimension (route, navigateur, système, pays estimé, appareil, release) | Regroupement des mesures sur la colonne de la dimension ; les lignes sans valeur forment un groupe « Inconnu » (`is null`). Groupes plafonnés, nombre réel affiché. | Pas de groupe « Autres » : additionner des p75 n'a pas de sens. Un onglet dont la dimension n'est pas collectée est **désactivé avec sa raison**, jamais rendu en l'ignorant. |
| `session_duration_observed` | `max(0, last_seen_at − started_at)`, sur les sessions **commencées** dans la fenêtre. Les sessions encore actives à la fin de la fenêtre sont comptées **et signalées**. | Pas du temps actif : un onglet laissé ouvert l'allonge, une fermeture brutale la raccourcit. |
| `single_view_session_rate` | Sessions ayant vu exactement une page / sessions ayant vu au moins une page. Affiché seulement au-delà de 30 sessions. | **Pas un taux de rebond** : aucune durée minimale ni interaction n'entre dans la définition, contrairement aux conventions — incompatibles entre elles — des autres outils. |
| Tendance des visiteurs observés | Identifiants de visiteur **distincts par seau**. | Non additionnable : la somme des seaux n'est pas le nombre de visiteurs de la fenêtre, et aucun total n'en est déduit. |
| Ressources (durée, taille, type, origine) | Les ressources **retenues par le SDK** : seuil de lenteur (300 ms par défaut) ou blocage du rendu, vingt au plus par page vue. | Pas un inventaire du réseau : échantillon volontairement biaisé vers le lent, jamais extrapolé. |
| Partage première / tierce partie | Hôte de l'URL déjà collectée comparé aux **origines déclarées** de l'application (`app_registry.allowed_origins`), application par application. | Aucun appel sortant : le serveur ne résout et ne récupère jamais une URL de ressource. Sans origine déclarée, le partage est annoncé **non calculable** plutôt qu'inventé. |
| Blocages du fil principal | Nombre de blocages par seau, p75 et pire cas ; Long Tasks et Long Animation Frames comptés **séparément**. | Aucune somme de durées : des blocages concurrents de plusieurs visiteurs ne s'additionnent pas en temps d'attente vécu. |
| Comparaison par version | Release déclarée **sur chaque mesure** (migration-v75) : vue, métrique et erreur portent la leur. Une session qui traverse un déploiement compte dans les deux versions. | La colonne « Sessions » n'est donc pas additionnable d'une ligne à l'autre. Avant v75, repli sur la release de session, annoncé à l'écran. |

Recherche de sessions : **égalité stricte** sur trois champs seulement — identifiant technique exact, route
normalisée, release. Ni motif, ni préfixe, ni recherche par identité (visiteur, compte, adresse) : une URL
partageable ne doit pas permettre de retrouver le parcours d'une personne. C'est une décision de produit,
pas une fonctionnalité en attente. La pagination utilise une clé stable `(last_seen_at, session_id)` : deux
pages successives ne peuvent ni répéter ni sauter une ligne.

## Mise à jour v0.8 (17/06/2026 — sécurité base + scrub PII serveur)

| Limite d'origine | Ce qui est livré en v0.8 |
|---|---|
| **Tables exposées via l'API publique** (alerte Supabase : `rls_disabled_in_public`, `console_user.password_hash` accessible) | RLS activé sur **toutes** les tables du schéma `public` (API `anon`/`authenticated` fermée ; ingestion via `service_role` et console via le rôle propriétaire continuent de fonctionner) ; vues retirées de l'API ; fonctions `SECURITY DEFINER` fermées à l'API et `search_path` figé. Migrations `v10`/`v11` idempotentes |
| **Scrub PII dépendant du seul `beforeSend` client** | Défense en profondeur **côté serveur** (A2) : `shared/scrub.mjs` nettoie emails, jetons (Bearer/Basic/JWT/clés `sk-`/`mip_`), affectations sensibles (`password=…`), IP et longues suites de chiffres dans `message`/`stack`/`url`/`referrer`/`source` et les `props` d'événements — front **et** back, avant écriture. Appliqué dans le parser partagé (parité dev-server ↔ edge) |

## Mise à jour v0.4 (11/06/2026 — tracing distribué)

| Limite d'origine | Ce qui est livré en v0.4 |
|---|---|
| **Tracing distribué front→back** (#6, annoncé Phase 2) | Livré pour le web→FastAPI : SDK propage `traceparent` (fetch + XHR/axios), middleware backend 1 fichier stdlib (posé sur uti-platform, inactif sans env vars), corrélation par trace_id en console (/tracing + timeline session). Limites assumées : un seul framework backend (FastAPI/Starlette), un seul saut (pas de propagation backend→backend ni DB span) |
| Backend ClickHouse (#13) | **Décision : reporté volontairement** (zéro budget MVP). Le chemin reste prouvé en local (bench Δ=0) ; bascule possible dès qu'un hébergement est financé |

## Mise à jour v0.3 (sprint nuit 2)

### Résolu en v0.3

| # d'origine | Limite | Ce qui est livré en v0.3 |
|---|---|---|
| 1 | Pas de session replay | Replay rrweb : module SDK **séparé lazy-chargé** (le bundle cœur ne bouge pas), opt-in par app (`replay_sample_rate`), masquage des saisies par défaut, respect du consent, caps 2 min / 1 Mo par session ; player dans la vue session |
| 9 | Rate limiting basique (mémoire, par isolat) | Rate limit **durable** : compteur SQL `rate_counter` + `rate_check()`, partagé entre isolats edge, fallback mémoire si SQL indisponible |
| 12 | `geo_country` vide | Géo **par timezone** (attribut `mip.tz` du SDK → mapping tz→pays à l'ingestion) — granularité pays, **zéro adresse IP stockée** |
| 13 | Backend Postgres, pas ClickHouse | Chemin ClickHouse **prouvé en local**, en laboratoire : docker-compose, schéma MergeTree, writer HTTP (`labs/clickhouse/writer.mjs`), bench 100 k events PG vs CH (`labs/clickhouse/NOTES.md`). Aucun receveur ne lit `STORE` : seul `scripts/load-bench.mjs` le fait. Expérience locale, jamais déployée |
| 17 (reliquat) | Alerting sans notification sortante fiable | Webhooks sortants : pg_net (cloud) + dispatcher node (local), payload JSON compatible Slack, traçabilité `alert_delivery` |
| 19 | Pas de RBAC / multi-utilisateurs | Login email+mot de passe (bcrypt, JWT cookie httpOnly), rôles admin/viewer, viewer scopé par liste d'apps, gestion des utilisateurs, `audit_log` des actions sensibles |
| 23 (reliquat) | Pas de détection automatique | Vue `v_anomaly` (z-score du LCP p75 horaire vs 7 j glissants, \|z\| > 3) + badge anomalies et **health score** composite en Overview (formule documentée dans `apps/console/lib/health.ts`) |

### Ce qui RESTE après v0.3 (les vraies barrières enterprise)

| Limite | Pourquoi c'est dur | Horizon |
|---|---|---|
| **SDK mobile natif** (iOS/Android) | Deux plateformes, des SDK à maintenir, intestable sans devices/CI mobile — exclusion assumée du sprint | Phase 3 (cadrage d'origine) |
| **Mapping auto route↔mesure synthétique** | Nécessite une convention de nommage côté équipe DEM (Ekara) ; aujourd'hui `route_hint` manuel — ne passe pas à l'échelle | Chantier produit avec l'équipe DEM |
| **Branchement API DEM réelle** | Accès API mippoc/Ekara non disponible à ce jour ; la corrélation tourne sur seed/export | Dès accès MIP (interface `SyntheticSource` prête) |
| **Tracing distribué front→back** | Agent côté serveur, propagation de contexte — un produit en soi | Phase 2 (cadrage d'origine) |
| **ML avancé** | v0.3 = z-score statistique (assumé, explicable) ; saisonnalité, multi-métriques, forecast = vraie R&D | Phase 2+ |
| **Multi-région / haute dispo** | Une seule région UE aujourd'hui ; réplication, failover, SLA = travail d'infra conséquent | Phase 2+ |
| **Certifications (SOC2, ISO 27001, CSPN)** | Processus longs et coûteux, hors de portée d'un POC — or souvent éliminatoires en AO grand compte | Décision MIP (12-18 mois) |
| **Support 24/7 / engagement de service** | Une organisation, pas du code | Décision MIP |
| **Test de charge cloud réel** | ~4 000 events/s vérifiés en local seulement ; le comportement du free tier sous vraie charge reste inconnu | Phase 1 |

---

## Tableaux d'origine (état v0.1 → v0.2)

## Collecte (SDK)

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 1 | **Pas de session replay** (ni vidéo, ni breadcrumbs) | on voit QUE les métriques, pas le parcours qui y mène | v0.2 : breadcrumbs (clics, navigations, erreurs) ; replay vidéo = Phase 1+ (rrweb, volumétrie, RGPD lourd) |
| 2 | **Pas de resource timings ni long tasks** | impossible de dire POURQUOI une page est lente (script tiers ? image ? JS bloquant ?) | v0.2 |
| 3 | **Pas de consent mode RGPD** | le SDK collecte dès l'init — OK POC interne, bloquant pour un déploiement client | v0.2 |
| 4 | **Pas de file de retry/offline** | événements perdus si l'ingestion est down ou le réseau coupe | v0.2 |
| 5 | **Pas de SDK mobile** (iOS/Android) | web uniquement | Phase 3 (cadrage d'origine) |
| 6 | **Pas de tracing distribué front→back** | on ne suit pas une requête lente jusqu'au backend | Phase 2 (agent serveur, cadrage d'origine) |
| 7 | `track()` accepté mais **non persisté** | les événements métier partent sur le fil mais ne sont pas stockés | v0.2 |

## Ingestion & sécurité

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 8 | **Endpoint ouvert** : aucune clé d'API | n'importe qui connaissant l'URL peut injecter de fausses données | v0.2 (clé par app, hashée) |
| 9 | **Pas de rate limiting** | vulnérable au flood (même accidentel) | v0.2 (basique) |
| 10 | **Pas de rétention/TTL** | la base grossit indéfiniment | v0.2 (purge 30 j) |
| 11 | **Mono-application de fait** | tout est câblé autour de `gip-plateforme` | v0.2 (registre d'apps) |
| 12 | `geo_country` vide | pas de vue géographique | Phase 1 (Collector/CDN frontal) |
| 13 | Backend **Postgres**, pas ClickHouse | OK jusqu'à ~10⁶-10⁷ events ; au-delà, requêtes p75 lentes | Phase 1 (chemin documenté alors dans `infra/`, aujourd'hui dans `labs/clickhouse/`) |

## Restitution (console)

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 14 | **Fenêtre fixe 24 h**, aucun filtre (période/device/app) | inutilisable pour investiguer | v0.2 |
| 15 | **Erreurs non regroupées** | 1000 occurrences de la même erreur = 1000 lignes (vs fingerprinting type Sentry) | v0.2 |
| 16 | **Pas de vue session détaillée** | on liste les sessions mais on ne peut pas « entrer dedans » | v0.2 |
| 17 | **Aucun alerting** | personne n'est prévenu si le LCP explose — un outil de monitoring qui n'alerte pas n'est pas un outil de monitoring | v0.2 (règles + webhook ; email = Phase 1) |
| 18 | **Console publique** (lecture seule mais ouverte) | données de perf du client visibles par quiconque a l'URL | v0.2 (basic auth) |
| 19 | Pas de RBAC/multi-tenant | tous les utilisateurs voient tout | Phase 1 (cadrage d'origine : hors POC) |

## Corrélation (le différenciateur)

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 20 | **Source synthétique = seed** (pas l'API DEM réelle) | la corrélation est démontrée mais pas branchée sur les vrais robots MIP — accès API non disponible à ce jour | interface `SyntheticSource` prête ; branchement dès accès MIP |
| 21 | **Mapping route↔mesure manuel** (`route_hint`) | ne passe pas à l'échelle | chantier produit Phase 1 avec l'équipe DEM (nommage des mesures) |
| 22 | Comparaison **LCP vs latence robot** = approximation | les deux ne mesurent pas exactement la même chose (premier rendu vs scénario complet) — honnête en démo, à raffiner | Phase 1 (comparer à `first_load_time` mippoc, constaté au sondage) |
| 23 | Écarts non historisés, pas de détection d'« angle mort » automatique | l'analyse reste visuelle | v0.2 |

## Industrialisation

| # | Limite | Impact | Traitement |
|---|---|---|---|
| 24 | **Pas de CI** (tests verts mais lancés à la main) | régressions silencieuses possibles | v0.2 (GitHub Actions) |
| 25 | **Pas de monitoring de l'outil lui-même** | si l'ingestion tombe, on ne le sait pas | v0.2 (dogfooding : la console s'auto-instrumente) |
| 26 | Edge function non testable en local (pas de runtime Deno) | validée en prod uniquement | v0.2 partiel (CI) ; propre = Phase 1 |
| 27 | Volume réel encaissé inconnu au-delà du test local (~4 000 events/s en local, 1 000 events en 0,3 s) | pas de certitude sur le free tier Supabase sous vraie charge | Phase 1 (test de charge cloud) |
