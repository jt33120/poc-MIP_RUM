---
title: 'P5 — Error Tracking : collecte, regroupement, source maps et triage'
status: 'planned'
created: '2026-09-16'
baseline_commit: '11e9f346474db10abef111c8a120a1cecfd41997'
depends_on: ['P0', 'P1', 'P2', 'P3', 'P4']
---

# P5 — Error Tracking

Lire d’abord [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md). Toutes les cases ci-dessous sont à réaliser. Les noms « à créer » sont les destinations proposées, pas du code existant.

## 1. Objectif et état de départ

Un opérateur part d’une issue, voit ses occurrences et leur contexte exact, retrouve la session/l’action/la trace, attribue l’issue et distingue une vraie régression d’une vieille release encore ouverte. L’API/MCP rendent les mêmes données que la console.

Constats vérifiés au HEAD de référence :

- `packages/rum-sdk/src/index.ts` expose déjà `addError(error, context)` ; `wireErrorDrainLifecycle` draine les répétitions. Les réécrire ferait régresser P0/P2.
- `otlp.mjs:errorFingerprint` utilise encore type + message normalisé + premier frame ; `rum_error` conserve des champs fixes dans `pg-ingest.mjs`, dont `release`, `fingerprint`, `occurrences`, `action_id`, mais pas encore tous les champs d’enveloppe P2 ni le trace ID.
- `queries-v2.ts` possède un deuxième modèle de filtres. `errorGroupDetail` ne partage pas encore une seule population bornée pour groupe, exemplaire et occurrences.
- `app/api/sourcemaps/route.ts` accepte les maps avec cookie admin ; validation/taille et écriture sont faites map par map ; la symbolication est appliquée au dernier exemplaire affiché.
- `error_status` porte open/resolved/ignored et une note. La régression est calculée à la lecture. `migration-v64.sql` a déjà corrigé les nouvelles erreurs tardives via watermark d’ingestion : conserver cette protection jusqu’au remplacement prouvé.

## 2. Décisions d’architecture

1. Conserver `rum_error` comme table source des occurrences, idempotente au rejeu. Une issue devient une ressource stable `(app_id, issue_id)` ; ne pas utiliser un fingerprint changeant comme seul identifiant de workflow.
2. Le parseur OTLP reste pur. Extraire parsing de stack/normalisation dans `_shared/error-normalize.mjs` ; résolution de maps en I/O dans `apps/ingest/lib/error-symbolication.mjs`. Aucune lecture réseau arbitraire pendant l’ingestion.
3. Capture et comptage suivent le pipeline P2/P3 : contexte snapshot, scrub serveur, attribution causale à l’émission, consentement et sampling. Les hooks ne peuvent modifier les identifiants structurels.
4. P5 garde les périodes 1h/24h/7d. Ajouter un adaptateur borné `ErrorQuery` dans `queries-errors.ts` ; P6 remplacera seulement son alimentation par le contrat commun.
5. Notifications fondées sur transitions transactionnelles et clés d’idempotence. Un simple curseur d’ID croissant ne suffit pas : les transactions peuvent committer dans un ordre différent de l’allocation des IDs.
6. Regroupement v2 activé avec version explicite, migration de compatibilité et comparaison shadow. Aucune fusion destructive ni réécriture historique massive pendant un déploiement applicatif.

## 3. Contrat des données

Nouvelles migrations additives, découpables par sous-lot. Réutiliser un champ déjà ajouté par un autre lot après vérification.

| Objet | Champs proposés et contraintes | Usage |
|---|---|---|
| `rum_error` enrichi | `trace_id` nullable, 32 hex non nuls ; `source_parent_span_id` nullable, 16 hex ; `error_source` enum applicative `browser_js/browser_console/browser_resource/browser_csp/browser_network/node/python/react_native_js/native/otel` ; `handled` et `is_fatal` bool nullable | Corrélation sans inventer de session ni qualifier un fatal inconnu |
| `rum_error` contexte | `context jsonb {}`, `view_id`, `view_name`, `user_id_hash`, `account_id_hash`, `env`, `service` nullable | Snapshot P2, mêmes bornes/scrub/HMAC ; env/service réutilisés par P6 |
| `rum_error` regroupement | `issue_id uuid` nullable, `grouping_version smallint`, `grouping_key text`, `fingerprint_override_hash text` nullable, `symbolication_status pending/resolved/unavailable/failed`, `stack_symbolicated text` nullable | `fingerprint` et `stack` historiques restent disponibles ; pas de suppression pour basculer |
| `error_issue` à créer | `id uuid PK`, `app_id`, `grouping_version`, `grouping_key`, `status open/for_review/resolved/ignored`, `first_seen`, `last_seen`, `first_release`, `last_release`, `resolved_at/by/release/env`, `assignee_user_id` nullable, `revision bigint`, timestamps ; unique `(app_id,grouping_version,grouping_key)` | Identité durable et concurrence optimiste ; champs utilisateur FK vers l’identité interne existante, jamais l’email seul comme clé |
| `error_issue_alias` à créer | `(app_id,legacy_fingerprint,issue_id)` unique, FK app+issue | Un ancien groupe peut correspondre à plusieurs nouvelles issues ; ne pas supposer une bijection |
| `error_issue_activity` à créer | ID, app+issue, `kind status/assignee/comment/link/regression`, acteur interne ou `system`, ancien/nouveau statut, commentaire scrubbed ≤2 000 chars, timestamp | Historique append-only ; ne pas y recopier une stack ou un identifiant utilisateur RUM |
| `error_issue_ticket` à créer | ID, app+issue, URL HTTPS validée ≤2 048 chars, libellé ≤120, acteur/date | Lien manuel P5 ; synchronisation fournisseur P8 |
| `error_issue_notification` à créer | ID, app+issue, `kind new/regression/spike`, `event_key` unique, payload minimal, état pending/delivered/failed, attempts/next_attempt | Outbox reliée au mécanisme de livraison existant ; pas de second cron d’envoi concurrent |
| `sourcemap` existant | ajouter checksum SHA-256, byte_size, uploaded_at/by ; unicité app/release/filename existante à conserver | Upload atomique/idempotent ; collisions de contenu explicites |
| `sourcemap_upload_token` à créer | ID public, secret hashé, app_id, expiration, revoked_at, created_by ; privilège unique `sourcemaps:write` | Jeton CI distinct des tokens de lecture ; table non lisible par viewer |

Chaque FK enfant d’issue référence une clé unique `(app_id,id)` du parent. Ajouter RLS, grants minimaux, purge et effacement app/DSAR. Les compteurs d’issue persistés servent au cycle de vie ; les statistiques d’une fenêtre se recalculent sur les sources filtrées. Après DSAR, invalider/recalculer les résumés et exemples concernés ; ne pas laisser un ancien message en cache après suppression.

Index initiaux à confirmer par EXPLAIN : `rum_error(app_id,issue_id,ts DESC,id DESC)`, `rum_error(app_id,trace_id)` partiel, `error_issue(app_id,status,last_seen DESC,id)`, `error_issue_activity(app_id,issue_id,created_at,id)`. Gros index hors transaction via pré-déploiement concurrent. Pas de GIN sans requête qui le consomme.

### Idempotence multi-sources

- Une erreur navigateur dédiée conserve son span source.
- Pour plusieurs événements `exception` d’un même span OTel, générer une identité déterministe à partir d’app + trace + parent span + position de l’événement + timestamp natif. Garder le parent séparément : deux exceptions ne peuvent pas partager la contrainte unique de `rum_error.span_id`.
- Pour les nouveaux SDK émettant aussi un log d’exception, propager un `mip.exception_id` stable. Dédupliquer sur cette identité app-scopée. Sans ID commun, ne pas fusionner heuristiquement des occurrences distinctes ; signaler une éventuelle double instrumentation.
- Les compteurs d’issue et l’outbox utilisent seulement les lignes **effectivement insérées** (`RETURNING`), pas la taille du lot reçu. Les projections ne sont pas facturées une deuxième fois.
- Pour une exception dérivée d’un span/log déjà compté, conserver son origine (`origin_signal`, `source_event_id` internes) et adapter le métering pour compter une seule fois le signal reçu, tout en augmentant correctement la métrique d’occurrences d’erreur. Tester explicitement log+projection erreur et span avec plusieurs exception events ; documenter l’unité facturée avant de changer une formule existante.

## 4. Étapes d’implémentation

### P5.1 — détails fiables et corrélation (M, première livraison)

- [ ] Ajouter les champs d’enveloppe à `otlp.mjs`, `pg-ingest.mjs` et `buildEventIndex`. S’appuyer sur le HMAC injecté avant la file ; ne jamais accepter un hash client comme autorisation d’identité.
- [ ] Ajouter `apps/console/lib/queries-errors.ts` : base filtrée unique avec app, période `[from,to)`, device/tablet, bots/internal, segment. Liste, total, série, exemplaire et occurrences partagent les mêmes prédicats et un snapshot.
- [ ] Compter `sum(occurrences)` dans toutes les cartes/séries/exports. Pour utilisateurs touchés, rendre séparément `visitors_affected`, `identified_users_affected`, `sessions_affected` et `identity_coverage`; un backend sans session donne des identités inconnues, pas des faux zéros d’impact.
- [ ] Corriger le détail legacy par app+fingerprint : une app est nécessaire si plusieurs groupes autorisés portent le même fingerprint. Une URL ancienne ambiguë affiche un choix app-scopé, jamais `limit 1` arbitraire.
- [ ] Ajouter liens trace/session/action fondés sur les relations effectivement présentes ; valider app et parent span à la destination. Pour replay : implémenter un offset temporel dans le lecteur existant, borné au contenu disponible, sinon « Replay indisponible à cet instant ».
- [ ] Préserver les champs historiques API/MCP et ajouter les métadonnées de sampling. Ne pas annoncer « tous les utilisateurs » à partir de `user_hash` legacy.

Recette : erreurs A/B de même fingerprint, hors fenêtre, tablet, bot, répétitions 37+1, backend sans session et trace étrangère. Le détail, la liste, le CSV et l’API doivent donner 38 sur le même périmètre. La trace étrangère reste inaccessible. La pagination `(ts,id)` ne perd pas deux timestamps microseconde proches.

### P5.2 — collecte navigateur élargie (M)

- [ ] Réutiliser `addError`; ajouter un troisième argument optionnel `{fingerprint?: string}` sans casser `(error, context)`. Préserver le retour booléen actuel et le contexte local P2.
- [ ] Introduire une config `captureErrors` avec catégories explicites. Exceptions non interceptées/unhandled rejections existantes restent actives ; `console`, `resources`, `csp`, `network` sont **opt-in** pour maîtriser le changement de volume.
- [ ] `console.error` : appeler l’original exactement une fois, sans capturer la console du SDK ; extraire la stack d’un `Error`, borner sérialisation des objets/cycles ; ne pas rendre deux incidents du même objet capturé dans une même opération.
- [ ] Ressources : listener `error` en capture ; séparer Event de ressource et ErrorEvent JS ; URL nettoyée sans query/fragment. Le navigateur ne fournit pas toujours le statut HTTP : le garder null, jamais « 404 » inféré.
- [ ] CSP : `securitypolicyviolation` et ReportingObserver si disponible, dédupliqués ; stocker directive/origine nettoyées, pas `sample` brut ni texte inline. Indiquer les API non supportées.
- [ ] Réseau : exploiter les wrappers fetch/XHR existants ; échec réseau et 5xx opt-in, 4xx désactivés par défaut ; abort volontaire classé séparément et non incident par défaut. Garder un lien vers le span ; exclure endpoint ingest et origines non autorisées. Préserver les règles de causalité P3 lors d’un retour asynchrone tardif.
- [ ] Les nouvelles erreurs suivent le sampling des erreurs, y compris promotion error-biased, sans envoyer de contexte collecté après révocation du consentement. Caps existants + bornes par catégorie documentés et métriques de drops.

Tests : console récursive, objets cycliques, ressource sans statut, signal CSP dupliqué, fetch abort/500/404, XHR timeout, deux clics proches, révocation avant résolution réseau, requête d’ingestion qui échoue. Pas de request body, headers métier, query string ou JWT en base.

### P5.3 — ingestion des erreurs backend et OTel (M)

- [ ] Lire les événements `exception` des spans OTel ainsi que les logs structurés d’exception. Accepter `exception.type/message/stacktrace` ; éviter de transformer tout `console.error("texte")` en exception automatique.
- [ ] Traiter cette collecte avant les sorties précoces du parser des spans backend. Accepter `session_id=null` et `pageview_id=null` dans `rum_error`, conserver trace/service/env/release, sans créer une session artificielle.
- [ ] Même normalisation et symbolication pour navigateur, RN et backend. Conserver la source/runtime pour ne pas confondre frames Python, JVM ou JS.
- [ ] Node : corriger l’extraction `Error` de `register.ts` ; instrumenter les erreurs de requête avec stack, sans avaler l’erreur de l’application. Utiliser un mécanisme d’observation qui préserve la terminaison normale sur uncaught exception ; ne pas installer un handler qui transforme un crash en process survivant.
- [ ] FastAPI : une exception non gérée avant début de réponse produit HTTP 500 si le statut est connu, plus exception et trace. Si la réponse a déjà commencé, garder le statut réellement envoyé et un indicateur d’échec, pas un 500 inventé. Ne pas avaler l’exception ASGI.
- [ ] Une fermeture fatale ne garantit pas un dernier fetch réussi. Documenter le best-effort actuel ; buffers durables/native relèvent de P7/P8.

Tests : plusieurs exceptions dans un span, rejeu du même lot, exceptions avec/sans session, tags log+span avec même `mip.exception_id`, Node subprocess qui sort avec le code attendu, ASGI erreur avant/après headers et requêtes concurrentes sans mélange de trace.

### P5.4 — source maps automatisables (M)

- [ ] Extraire `lib/sourcemap.ts` dans un module partagé utilisable depuis le serveur d’ingestion et la console ; conserver un re-export pour les importateurs actuels. Réutiliser les dépendances déjà présentes.
- [ ] Upload de toutes les maps validé **avant** première écriture ; transaction par requête. Limite serveur entière en octets avant parse JSON, puis maximum 15 Mio/map sur le backend direct. Pour Vercel, le CLI utilise par défaut des lots ≤3 Mio et refuse une map indivisible trop grande avec indication d’utiliser le backend direct ; vérifier le plafond réel de la plateforme avant publication. Aucun faux succès partiel.
- [ ] Créer le port backend direct `POST /v1/sourcemaps` dans `apps/ingest/lib/receiver.mjs`, même validation et vérification des jetons dédiés via un module partagé `apps/ingest/lib/sourcemap-upload.mjs`. Corps complet ≤20 Mio et ≤15 Mio/map, auth avant buffering, timeout et débit bornés ; destination explicite, aucun endpoint supplémentaire supposé existant. Le CLI `--url` désigne l’URL complète d’upload. Le cookie admin reste réservé au port console ; le backend direct n’accepte que le jeton dédié.
- [ ] Valider version 3, types, mappings et chemins virtuels. Pas de chemin disque relatif exploitable, pas de `sourceRoot` récupéré par HTTP, pas de SSRF depuis sourceMappingURL. Maps externes/indexées non supportées : rejet explicite ou support borné testé.
- [ ] À contenu identique : idempotent. Même app/release/fichier avec contenu différent : `409`, remplacement admin explicite et audité ; pas de regroupement historique implicite.
- [ ] Créer le CLI `scripts/upload-sourcemaps.mjs` : `--app --release --dir --url`, token via variable `MIP_SOURCEMAP_TOKEN`, manifeste checksums, mapping bundle→map, dry-run, retries bornés, code de sortie non nul si incomplet. Token absent des arguments/logs et jamais inclus dans bundle client.
- [ ] Auth upload : cookie admin conservé ; jeton dédié app-scopé et expirant. UI admin création/révocation, secret affiché une fois. `CONSOLE_API_TOKENS` reste strictement read-only.
- [ ] Endpoints console `GET/POST /api/admin/sourcemap-tokens`, `DELETE /api/admin/sourcemap-tokens/:id` : admin session/Origin, scope app contrôlé. POST `{appId,name,expiresInDays}` (1..90, défaut 30) rend le secret une fois ; GET ne rend que ID/nom/app/expiration/révocation ; DELETE révoque et audite. Secret aléatoire fort, hash serveur comparé en temps constant ; rotation = nouveau token puis révocation ancien, jamais extension du token de lecture.
- [ ] Liste des maps par app/release avec fichier, taille, checksum, date, statut ; pas de contenu source dans une API publique. Code context ±3 lignes seulement pour l’admin ; stack symboliquée scrubbed lisible selon droits RUM existants.
- [ ] Précharger les maps utiles au lot avec cache borné (32 entrées/64 Mio maximum de contenu parsé à ajuster sur mesure) et budget de travail. Un fichier hostile ne bloque pas l’ingestion ; erreur stockée en brut scrubbed, `symbolication_status=failed` et diagnostic opérationnel.
- [ ] Un upload tardif peut améliorer l’affichage sans changer l’identité de l’issue. Reclassification historique seulement via P8.

Recette CLI local : bundle minifié réel compilé dans la fixture, map + release correspondantes, stack source retrouvée dans UI/API/MCP ; mauvaises release et map absente explicitement non résolues ; upload A ne touche pas B ; upload liste dont dernière map invalide ne persiste rien.

### P5.5 — regroupement stable et versionné (L)

- [ ] Parser frames Chrome/Firefox/Safari/Node/Python par adaptateurs, normaliser chemins de modules et hashes de build, conserver codes d’erreur sémantiques (404 et 500 distincts), supprimer les valeurs sensibles avant tout hash.
- [ ] Priorité de clé : override validé et hashé app-scopé → première frame applicative symboliquée + type/code → frame normalisée + type/code → repli marqué `low_confidence`. Un « Script error. » sans contexte reste explicitement peu discriminant.
- [ ] Un override est une clé opaque ≤100 caractères non sensible, rescrubbée puis hashée ; ne pas le recopier en métadonnée non filtrée. Ignorer un override vide après scrub avec diagnostic.
- [ ] Ne pas fonder le regroupement uniquement sur nom de fonction minifié ou release. Exclure vendor frames via chemins configurés et bornés, sans regex fournie dans l’API.
- [ ] Calculer `grouping_key_v2` en shadow sur les nouvelles entrées, sans muter issue/statut ; fixtures d’abord, puis statistiques anonymes splits/merges sur données disponibles.
- [ ] Activer par app un groupe v2. Créer `error_issue` et aliases de compatibilité ; initialiser état et première/dernière vue depuis les groupes legacy touchés, avec requêtes indexées bornées. Si plusieurs statuts legacy divergent, garder l’issue `for_review`, tracer la divergence, ne pas perdre les commentaires.
- [ ] Conserver les anciens liens. Un alias unique redirige vers `/errors/issues/:id?app=...` ; plusieurs correspondances rendent une sélection scoped. Les groupes non migrés restent lisibles dans la liste via adaptateur legacy, sans doubler les sources déjà attachées.
- [ ] Ne pas re-notifier les groupes connus lors du cutover. Une nouvelle clé v2 ambiguë par rapport au legacy est marquée migration, pas « nouveau bug » automatiquement.

Recette : même bug multi-navigateurs et deux builds minifiés → même groupe lorsque preuve source disponible ; 404/500 distincts ; override identique A/B ne fusionne pas les apps ; rejouer un lot ne modifie ni compteur ni activité ; rollback désactive v2 sans perdre triage et URLs.

### P5.6 — workflow, régression et alerte par issue (L)

- [ ] Modèle d’état : nouvelle issue `open`; admin peut `for_review/resolved/ignored/open`; l’assignation ne change pas le statut. Note legacy importée en activité une seule fois.
- [ ] Chaque mutation fournit `expectedRevision` ; `409` en cas d’édition concurrente, UI propose recharger. Validation du membre assigné dans le périmètre de l’app selon le modèle utilisateurs existant.
- [ ] Résolution stocke release et env de référence. Ordre des releases déterminé par marqueurs de déploiement dans la même app/env ; ni ordre lexical ni hypothèse SemVer sur un SHA.
- [ ] Régression confirmée : issue resolved, occurrence dont timestamp est après résolution et release strictement postérieure selon marqueur vérifié. Même release, ancienne release, release absente ou ordre inconnu : afficher « Réapparition à vérifier », sans rouvrir automatiquement. Une issue ignored reste ignored.
- [ ] Traiter ingestion de la nouvelle occurrence, transition d’état et entrée outbox dans une transaction. Deux workers simultanés ne créent qu’une activité et notification de régression. Une transaction anciennement commencée mais committée tard reste traitée.
- [ ] Nouvelle issue : outbox transactionnelle ; conserver le watermark v64 tant que des groupes legacy dépendent de lui, mais exclure les nouvelles issues du chemin legacy pour éviter double notification.
- [ ] Spike par issue : `issue:<uuid>` dans les règles existantes ; métrique = somme des occurrences observées, fenêtre de règle, scope/bots/env explicitement appliqués, cooldown et event key. Baseline exacte par fenêtre avec minimum de comparables et comportement MAD=0 alignés sur P4. Hors données suffisantes : no_data, pas zéro silencieux.
- [ ] Réutiliser `route_alert` et les jobs existants. Les commentaires/liens P5 n’envoient aucune donnée vers Jira/GitHub ; l’intégration est P8.6.

## 5. API/UI à livrer

### API nouvelle, additive

Réutiliser `lib/api/handle.ts`, auth, ratelimit, scope et enveloppe `{meta,data}`. Dates UTC ISO, bigints d’IDs/counters hors plage sûre sérialisés en chaînes selon une règle documentée et testée ; ne jamais les tronquer avec `::int`.

| Endpoint | Requête | Réponse / consommateur |
|---|---|---|
| `GET /api/v1/issues` | app, period, device, status, release?, source?, limit 1..100, cursor? | `data={issues,total,next_cursor,sampling,coverage}` ; liste erreurs et MCP |
| `GET /api/v1/issues/:id` | app + mêmes filtres | `data={issue,impact,trend,last_sample,occurrences,next_cursor,sampling}` ; détail et MCP |
| `POST /api/v1/issues/:id/triage` | `{app,status?,assigneeUserId?,expectedRevision}` ; au moins une mutation | Admin session ; issue actualisée + revision ; formulaire triage |
| `POST /api/v1/issues/:id/comments` | `{app,body,expectedRevision}` | Activité scrubbed ; formulaire commentaire |
| `POST /api/v1/issues/:id/links` | `{app,url,label,expectedRevision}` | Lien validé ; formulaire ticket manuel |
| `GET /api/v1/issues/:id/activity` | app, limit ≤100, cursor | Activités, `next_cursor` ; onglet historique |
| `POST /api/sourcemaps` | Contrat existant `{appId,release,maps:[{filename,content}]}` | `{uploaded}` conservé, checksums ajoutés ; CLI et admin |
| `GET /api/sourcemaps` | appId, release ; admin | Fichiers/checksums sans contenu ; page admin source maps |

Mutations : CSRF/Origin et identité session selon les mécanismes en place ; jeton de lecture refusé. `401` non authentifié ; `404` ressource inconnue/hors scope ; `403` principal authentifié sans droit d’écriture ; `400` contrat invalide ; `409` revision/contenu en conflit ; `413` taille ; `429` limite. Les anciens endpoints erreurs conservent leur contrat, via adaptateurs et tests de fixtures historiques. MCP : ajouter `mip_rum_list_issues` et `mip_rum_get_issue`, read-only ; ne pas renommer brutalement les outils existants ; catalogue/OpenAPI/docs et smoke suivent le même nombre réel d’outils.

### Écrans

- `/errors` : header, filtres/statut/source/release, compteurs globaux de la population, tableau avec message scrubbed, état, occurrences, sessions, dernière vue, release. Clic conserve app/range. L’action créer une alerte est visible seulement si droit d’écriture.
- `/errors/issues/:id` : titre et badge source, triage/assignation, impact, tendance puis onglets Occurrences / Stack / Activité. Chaque occurrence garde ses propres timestamp/release/trace, pas ceux du dernier exemplaire. Liens sessions/actions/replay uniquement disponibles si données réelles.
- `/admin/sourcemaps` : app + release, liste, upload, état du manifeste, jetons CI. Les secrets et sources ne sont pas exposés au demo/viewer.
- États communs : skeleton sans chiffres ; « Aucune erreur sur cette période » ; « Impossible de charger les erreurs » + Réessayer ; bandeau sampling/symbolication/legacy partiel avec raison ; succès avec heure de calcul. Sur mobile filtres repliables, liste en cartes ou table scrollable interne, boutons accessibles au clavier.

## 6. Carte de fichiers

**Modifier** : `packages/rum-sdk/src/{index,types,errors,apispans}.ts`, `apps/ingest/supabase/functions/_shared/otlp.mjs`, `apps/ingest/lib/{pg-ingest,ingest-differe}.mjs`, `packages/agent-node/src/{core,register}.ts`, `integrations/fastapi/mip_rum_middleware.py`, `apps/console/lib/{queries-v2,sourcemap,queries-sourcemap,dsar,queries-dsar}.ts`, `app/errors/**`, `components/errors/ErrorTriage.tsx`, `app/api/sourcemaps/route.ts`, `app/alerts/**`, `apps/ingest/jobs/planifie.mjs`, `apps/mcp/lib/catalogue.mjs`, OpenAPI, CI, docs SDK/MCP.

**Créer** : `_shared/error-normalize.mjs`, `lib/error-symbolication.mjs` côté ingest, `apps/console/lib/queries-errors.ts`, `apps/console/lib/error-issues.ts`, nouvelles routes/UI listées, CLI maps, migrations et pré-déploiements correspondants, tests ci-dessous. Avant de scinder `pg-ingest`, préserver ses signatures publiques via wrapper : P8.1 prendra en charge son API transactionnelle complète.

## 7. Recette, livraison, limites

- [ ] `tests/unit/error-grouping-v2.test.ts` : corpus multi-browser/build/source, override, privacy, ambiguïtés.
- [ ] `tests/unit/error-collection.test.ts` : captures opt-in, erreurs réseau/ressource/CSP, hooks et consentement.
- [ ] Étendre `sourcemap.test.ts`, `error-triage.test.ts`, `agent-node.test.ts` et tests FastAPI.
- [ ] `tests/integration/error-issues-sql.test.ts` : app A/B, doubles ingestions, transitions concurrentes, arrivées/commits tardifs, suppression DSAR/purge et ancien schéma.
- [ ] `tests/e2e/error-tracking.spec.ts` : liste→issue→session/trace, résolution/régression, erreur source map, viewer interdit d’écriture, clavier et 390/768/1440.
- [ ] Tests outbox avec HTTP stub local ; ne pas envoyer des alertes de fixtures aux destinations clients.
- [ ] Publication sous-lot par sous-lot, migration → ingestion → console/jobs, compatibilité pendant la transition. Vérifier SHA, issue réelle existante et API/MCP. Déclencher un crash/une alerte seulement dans l’app de recette prévue.

P5 terminé quand les six sous-lots ont leurs preuves. Pas besoin d’un SaaS d’error tracking pour P5. Les maps du client, les crashs natifs et les tickets synchronisés restent explicitement rattachés à P8. Aucune promesse de cause racine automatique ni de regroupement parfait des erreurs sans stack.

## 8. Références consultées

- [Datadog — Error Grouping](https://docs.datadoghq.com/real_user_monitoring/error_tracking/error_grouping/) : groupes et fingerprint personnalisé ; comparaison fonctionnelle, pas un algorithme à copier.
- [Vercel — Functions limits](https://vercel.com/docs/functions/limitations) : plafond publié de 4,5 MB pour corps requête/réponse ; d’où les lots CLI petits et le port backend direct pour une map volumineuse. La taille est mesurée après sérialisation du corps complet.
- [OpenTelemetry — exceptions on spans](https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-spans/) : au 16/09/2026, les conventions de span events sont dépréciées au profit des logs, avec compatibilité de transition. D’où l’obligation P5.3 de supporter les deux signaux et de tester la déduplication.
- [OpenTelemetry — recording errors](https://opentelemetry.io/docs/specs/semconv/general/recording-errors/) : distinguer exception, opération échouée et erreur gérée.
