---
title: 'P8 — Effacement concurrent, backfills et dépendances externes'
status: 'planned'
created: '2026-09-16'
baseline_commit: '11e9f346474db10abef111c8a120a1cecfd41997'
depends_on: ['P5', 'P6', 'P7']
---

# P8 — Opérations et intégrations

Lire [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md). P8 n’est pas un lot intégralement dépendant d’un fournisseur : P8.1 et P8.2 sont développables dans le dépôt. Seules certaines activations et validations finales nécessitent une décision, une fenêtre de production, une application cliente ou un compte externe.

## 1. Résultat attendu et distinction des autorités

Le produit sait effacer sans qu’un writer concurrent recrée les lignes, reprendre son historique de façon idempotente et auditable, puis raccorder les capacités externes retenues avec une preuve sur le vrai système. Aucun backfill ne réinjecte des données hors rétention ni déjà effacées.

L’utilisateur a autorisé les migrations Neon ordinaires, push et merge. La préparation des outils, tests, migrations additives et dry-runs ne requiert pas un nouveau « go ». L’exécution historique exige un périmètre app/fenêtre/charge concret qui n’a pas été choisi dans le dialogue ; le préparer avant de demander cette décision. Une installation payante, une destination de données ou une politique nouvelle d’expiration des tombstones demande également un choix concret.

## 2. P8.1 — effacement sérialisé avec l’ingestion (L)

### Faille à traiter, observée dans le code actuel

`queries-dsar.ts` identifie les sessions existantes ; les lots/identités arrivant après le snapshot peuvent échapper à l’effacement. `ingest-differe.mjs` tient un verrou de ligne de file via `client`, mais appelle `writeRows(pool,...)`, qui ouvre sa **propre transaction sur une autre connexion**. Logs, traces et replay ont leurs writers distincts. Ajouter un verrou seulement au formulaire DSAR ne ferme pas ces chemins.

### Contrat de suppression

1. Après commit d’un effacement, aucune donnée d’une session explicitement effacée ne peut être recréée par replay/retry/backfill.
2. Pour un effacement par user/account/visitor connu, les writers rejettent les payloads rattachables à cet identifiant supprimé tant que la barrière est active. L’égalité repose sur les identifiants techniques/HMAC app-scopés, jamais sur texte brut.
3. Les autres personnes/applications continuent d’être ingérées ; une course provoque attente bornée/retry ou rejet identifié, jamais un succès avec persistance de l’identité supprimée.
4. La preuve porte sur les identifiants fournis ou déjà liés. Un événement totalement anonyme avec nouvelle session et sans aucun identifiant commun ne peut pas être attribué magiquement à une personne effacée. Cette limite est affichée dans le rapport DSAR.

### Décision technique : verrou transactionnel par app

Utiliser une seule primitive `withAppIngestTransaction(pool, appId, work)` avec `pg_advisory_xact_lock` sur une clé déterministe, namespace dédié et app. Compatible avec le pooler Neon transactionnel ; pas de verrou de session. Première version : un verrou par app, simple à prouver ; benchmark sous contention avant activation. Si le coût est excessif, optimisation par identités/session dans un sous-lot ultérieur avec preuve équivalente, pas un protocole différent improvisé sur chaque writer.

Pour un lot multi-app, le scinder en apps déjà authentifiées et valider sa totalité avant écriture, ou prendre les verrous dans un ordre déterministe commun à tous les chemins. Ne jamais faire confiance à `app_id` porté seulement par le client pour accéder à une autre app.

### Modèle proposé

| Objet | Champs/contraintes | Rétention |
|---|---|---|
| `privacy_erasure_barrier` | app_id, subject_kind `session/visitor/user/account`, subject_key (ID session/visitor technique ou HMAC), erased_at, request_id, expires_at nullable ; PK app/kind/key | Pas d’expiration automatique par défaut tant que les sources de retries/restauration peuvent revenir ; politique à valider avant activation durable |
| `privacy_erasure_request` | UUID, app_id, acteur admin, timestamps, statut planned/running/completed/failed, counts JSON, motif d’échec borné | Audit sans identifiant brut ni payload ; durée suit politique opérateur existante |
| `backfill_run` | cf. section 3 | Historique technique app-scopé, aucun extrait RUM |

La barrière durable est elle-même une donnée pseudonyme ; ne pas prétendre qu’elle n’en est pas une. La durée, la réactivation éventuelle après une nouvelle collecte autorisée et le traitement des sauvegardes sont une décision de politique P8.1. Le code doit pouvoir conserver une barrière sans expiration ; ne pas inventer une purge à 30 jours puis garantir contre un vieux backup. Tant que cette décision manque, livrer le protocole/tests derrière activation explicite et déclarer la protection durable non activée.

**Réactivation :** aucune voie permettant au SDK d’envoyer un flag et contourner la barrière. Une réactivation éventuelle sera une action opérateur app-scopée et auditée après choix de politique ; elle n’est pas implémentée implicitement en P8.1. Les vieux IDs session supprimés restent toujours refusés, même si l’identité est autorisée à reprendre avec de nouveaux IDs.

### Algorithme obligatoire et ordre des verrous

- [ ] Extraire `writeRowsWithClient(client, rows, options)` sans begin/commit/release. Garder `writeRows(pool,rows)` comme wrapper compatible qui ouvre transaction, verrouille app, filtre par barrières et délègue.
- [ ] Même logique pour `writeLogs`, `writeReplayChunk`, writer custom éventuel P5/native P8 et jobs qui rematérialisent des sources/projections. Les wrappers ne réouvrent pas une transaction si un client transactionnel est fourni.
- [ ] Dépôt différé : verrou app → lecture des barrières → suppression des sous-collections rattachées → insertion file filtrée → commit. Ne pas déposer un lot interdit en espérant que le worker fera le ménage.
- [ ] Drain : pré-lire seulement un ID/app candidat sans verrou, begin → verrou app → reprendre CET ID avec `FOR UPDATE SKIP LOCKED` et revérifier éligibilité → vérifier barrières → écrire via **le même client** → retirer/actualiser le lot → commit. Si le candidat a disparu, passer au suivant. Ne pas verrouiller la file avant app : inversion avec DSAR = deadlock.
- [ ] En cas d’erreur SQL pendant le drain, utiliser SAVEPOINT/rollback-to-savepoint avant mise à jour du compteur d’échec, ou rollback complet puis transaction de diagnostic séparée. Une transaction PostgreSQL en échec ne peut pas recevoir un simple UPDATE d’erreur.
- [ ] DSAR : begin → verrou app → insérer barrière identité même s’il n’y a pas encore de session → trouver sessions à partir des sources ET lots aplatis de file → inscrire leurs barrières → retirer les sous-collections correspondantes des lots mixtes → supprimer sources/projections/replay → recalculer/invalider résumés/rollups/caches → audit minimal → commit.
- [ ] Ne pas supprimer intégralement le lot mixte de deux personnes si on peut filtrer correctement ses collections ; supprimer les enfants par relation session/identité/source IDs. Les erreurs P5 sans session mais portant un HMAC correspondent directement. Aucune suppression fondée sur ressemblance de message/stack.
- [ ] Replay reçu avant session OTLP : ne plus créer aveuglément une session minimale qui contourne la barrière. Si la session n’a pas de liaison autorisée connue, refuser temporairement avec un résultat retry borné et sans persister le body ; le SDK renvoie après l’ancre. Pour un client historique incapable de retry, annoncer cette limite et valider le compromis avant activation.
- [ ] Vérifier qu’un conflit de session/span déjà stocké sous A ne permet pas un update via B ; erreur de scope, pas `ON CONFLICT DO UPDATE` sur l’autre tenant.
- [ ] Effacement app entière : suspendre l’ingestion de l’app dans le registre sous la même barrière puis effacer. `erase_app_data` seule ne peut garantir le silence si une clé reste active. Réactivation app = opération explicite existante, pas effet du prochain événement.
- [ ] Export DSAR utilise snapshot et prédicats `(app_id,...)`, sans écrire de barrière ; ne pas bloquer l’ingestion pour une simple lecture si repeatable-read suffit.
- [ ] Mise à jour des fonctions SQL purge/erase et listes `DSAR_CHILD_TABLES` avec les tables P5/P6/P7. Attention aux activités/commentaires contenant des extraits de données : scrub et retrait des références d’exemplaires effacés.

### Tests qui ferment réellement la course

`tests/integration/dsar-concurrency-sql.test.ts`, avec deux ou trois connexions PostgreSQL, barrières de test explicites (promesses/signaux SQL), pas de sleeps probabilistes :

| Interleaving | Résultat attendu |
|---|---|
| Writer possède verrou, DSAR attend | Writer commit puis DSAR efface ; zéro résidu ciblé |
| DSAR possède verrou, writer attend | Writer voit barrière après commit, rejette le ciblé |
| Lot ciblé déposé après snapshot initial | Dépôt ou drain vérifie barrière, rien recréé |
| Session absente, user connu seulement dans lot | Barrière user suffit ; lot interdit sans session préalable |
| Replay/log arrive après effacement | Même barrière ; pas de session minimale recréée |
| Lot mixte A-personne1/personne2 | Personne1 supprimée, personne2 conservée |
| Double DSAR + worker + backfill | Pas de deadlock permanent, résultat idempotent |
| Crash après write avant delete queue | Transaction entière rollback ; retry sans doublon |
| Backfill/rematerialisation pendant DSAR | Même verrou ; pas de résurrection ni compteur périmé |
| Même hash dans autre app | Autre app conservée et invisible au rapport |

Activation : migrer les tables/fonctions, déployer **tous** writers, vérifier leur SHA/version protocole, puis activer. Un vieux writer qui contourne les barrières empêche de déclarer cette garantie. Benchmark 1/10/50 writers, latence et temps d’attente, timeout 5 s et stratégie de retry exposée. Rollback ne doit pas désactiver la barrière silencieusement : suspendre l’ingestion ciblée ou rester sur une version compatible.

## 3. P8.2 — outils de backfill et dry-run (M)

Les besoins sont distincts :

1. Rollups historiques d’occurrences sous-comptées avant v64.
2. Projection `rum_event_index` des sources conservées antérieures à v65.
3. Champs browser/OS/env dérivables avec certitude des données encore présentes, après P6.
4. Groupes/symbolication historiques vers P5 v2, sans nouvelle alerte ni perte de triage.

### Fichiers et interface à créer

`scripts/backfill-rum.mjs`, `apps/ingest/lib/backfills/{planner,runner,event-index,rollups,dimensions,error-groups}.mjs` et tests. Réutiliser les normalisateurs/source schemas actuels ; aucune copie d’un vieux parser collé dans un script de migration.

```sh
# Commandes futures, APRÈS création de l’outil ; --app et bornes obligatoires.
node scripts/backfill-rum.mjs plan --kind event-index --app <app> --from <UTC> --to <UTC>
node scripts/backfill-rum.mjs apply --plan-id <uuid> --plan-sha <sha256>
node scripts/backfill-rum.mjs status --run-id <uuid>
node scripts/backfill-rum.mjs pause --run-id <uuid>
node scripts/backfill-rum.mjs resume --run-id <uuid>
node scripts/backfill-rum.mjs verify --run-id <uuid>
```

- [ ] `plan` est read-only vis-à-vis des tables RUM. Il peut persister un manifeste technique de plan, jamais du payload. App unique explicite ; `all` refusé ; fenêtre dans la rétention réellement disponible, pas réinventée à 30 jours.
- [ ] Rapporter source tables, bornes, taille/count estimés ou exacts avec méthode, lignes éligibles/déjà présentes/null ID/hors rétention, indexes, charge attendue, espace disque nécessaire, checksum code/schema et collisions/ambiguïtés. Si coût du count est excessif, indiquer estimation avec échantillon et confiance, pas « exact ».
- [ ] `backfill_run(id,kind,app_id,from,to,source_cutoffs_json,plan_sha,code_sha,state,checkpoint_json,scanned,written,skipped,failed,started_at,updated_at,ended_at,error_code)` ; états planned/running/paused/completed/failed ; RLS/admin et une seule exécution active par app+kind+périmètre.
- [ ] Capturer une borne haute par table/ordre de clé et la version de code. Un sequence ID n’est pas un ordre de commit : fenêtre historique fermée + scan de reconciliation final après drain des écritures en vol obligatoire. Ne pas prétendre qu’un max(id) seul est un snapshot universel.
- [ ] Batch initial 1 000 lignes, configurable 100..5 000, transaction courte ≤2 s cible, un worker/app. Checkpoint atomique avec écritures. Pause/retry entre batches, SIGTERM propre. Reprendre exige même plan/code ou nouveau dry-run explicite.
- [ ] Anti-join source/projection par vraie clé unique ; `ON CONFLICT DO NOTHING` ou upsert déterministe pour résultats dérivés. Les erreurs restent des skip/error typés, pas un faux succès de migration.
- [ ] Utiliser le protocole d’effacement P8.1 et reconsulter les sources dans chaque transaction ; ne pas réinsérer depuis une copie en mémoire lue avant un DSAR.
- [ ] Aucun secret, stack ou nom de personne dans les logs ; compteurs et IDs de run suffisants. Prévoir inspection admin détaillée seulement sur données autorisées, hors logs.

### Règles de reconstruction par kind

| Kind | Reconstruction autorisée | Interdit / résultat incomplet |
|---|---|---|
| event-index | `span_id` natif valide de source, app, ts/started_at, route normalisée, taxonomie `buildEventIndex` ; métadonnées source si réellement conservées | span_id absent/invalide → skip reporté, pas d’ID inventé ; compteurs/comptage n’augmentent pas |
| rollups | Recalcul par app+heure sur sources conservées, `sum(occurrences)`, dédup CWV canonique, effacer/remplacer l’agrégat du bucket de façon atomique | Sources purgées → impossible de recalculer ; ne pas remplacer un agrégat historique restant par zéro |
| dimensions | UA session → browser/OS, champs événement réellement présents → env/release | Ne pas attribuer à toutes anciennes lignes la dernière release/env session ; unknown reste unknown |
| error-groups | Normalisation P5 sur données scrubbed/maps exactes ; mapping old→new et table de reconciliation | Aucune notification new/regression due au backfill ; collisions de statuts/assignés conservées en for_review, pas fusion silencieuse |

Pour regroupement P5 : proposer plan qui liste nombre de merges/splits, statuts concernés et cartes de correspondance sans messages. Conserver clés/fingerprints anciens et aliases. Transférer notes/liens une fois avec provenance ; si un ancien commentaire couvre un groupe scindé, le signaler comme hérité du groupe, pas comme diagnostic précis de chaque nouvelle issue.

Pour un percentile historique, moyenne des p75 interdite. Fusionner les histogrammes si mêmes frontières et même population ; sinon déclarer impossible. Les comptes déjà perdus dans un ancien SDK ne sont pas récupérables par SQL.

### Preuves pré-production

- [ ] `backfill-idempotency-sql.test.ts` : exécuter deux fois → même état, pas de quota/alertes ajoutés.
- [ ] Stop après un batch, kill entre write/checkpoint, reprise → pas de trou ni doublon.
- [ ] Id source null, date limite purge, source disparue après plan, même ID d’app différente, histogramme incompatible → rapport exact.
- [ ] Tests de concurrence P8.1 réutilisés avec chaque runner.
- [ ] `verify` indépendant du runner : anti-joins scoped, sommes/samples, contrôles sources vs shadow/buckets, erreurs/skip explicites.

## 4. P8.3 — exécuter en production (M + fenêtre opérateur)

### Décision concrète à obtenir après dry-run

Présenter : app, kind, from/to UTC, total éligible, fraction impossible, durée estimée avec méthode, espace attendu, limites et créneau proposé. Faire confirmer ce périmètre si aucun précédent message ne le couvre. L’autorisation générale « migre Neon » ne sélectionne pas une période de données à réécrire.

### Procédure à suivre

1. Relever DB/branche cible sans credential, checksum des migrations, schéma courant, PITR/restauration réellement disponible sur le plan Neon. Ne pas promettre une sauvegarde à partir de l’existence du service.
2. Vérifier vP8 privacy active sur chaque writer et absence de writer legacy. Tester la reprise et le rollback sur clone ou base jetable représentative ; sauvegarde payante/branche externe nouvelle seulement si accès et coût déjà autorisés.
3. Manifest de plan signé par checksum, code SHA fixé. Canary sur un jour/app ou 1 % du périmètre selon la plus petite charge représentative.
4. Seuils initiaux : pause si erreurs ingestion 5xx >1 % ou double de baseline pendant 2 min, DB CPU >70 % pendant 2 min si cette mesure existe, p95 ingestion >2×baseline, attente verrou >2 s répétée, espace restant insuffisant au volume estimé +20 %. Si une mesure est indisponible, le signaler et utiliser métriques accessibles avec seuil équivalent défini dans le plan ; ne pas prétendre l’avoir vérifiée.
5. Reconcile canary avant extension. Exécuter batches courts, monitorer, laisser scheduler/ingest prioritaires. L’opération s’arrête d’elle-même au seuil, avec checkpoint.
6. Vérification indépendante complète des lignes éligibles ; total source, projection, buckets et aliases ; comparer une série de vues/API avant/après. Décompter les lignes non reconstructibles.
7. Rapport `operations/backfill-<run-id>.md` : SHA, cible non secrète, bornes, counts, durée réelle, skips, verification, statut completed/partial/failed. Pas de dump de données de personnes.

Rollback : pour rollups/groupes, conserver une table shadow ou un snapshot **des seuls agrégats/mappings touchés** avant bascule, protégés et à durée bornée ; pour la projection index, préférer correction forward. Ne pas restaurer des données supprimées pendant l’opération. Une restauration PITR doit rejouer les barrières/effacements survenus après le point restauré avant de rouvrir les lectures/ingestions. Si cette preuve manque, le rollback par restauration n’est pas déclaré disponible.

## 5. P8.4 — CI source maps du client (S)

**Faisable seul :** CLI P5.4, workflow/template, fixture bundle minifié, mock d’upload, diagnostic release/file mismatch.

**Requis pour la recette réelle :** accès au repo et à son build CI, app_id MIP, convention release (SHA/build ID), destination d’ingestion et jeton upload dédié configuré dans les secrets CI. Les accès présents dans le repo MIP ne valent pas accès au repo client.

- [ ] Ajouter le step après build et avant déploiement/promote ; même release injectée au SDK, backend éventuel et upload maps.
- [ ] Produire manifeste bundle↔map et checksums ; échec upload fait échouer le step selon politique de release du client, ne pas supprimer la map silencieusement.
- [ ] Vérifier que les `.map` privées ne sont pas publiées dans le dossier public si la politique prévoit leur confidentialité ; ne pas supprimer les artifacts nécessaires au debug avant preuve d’upload.
- [ ] Déclencher une erreur contrôlée de l’app de recette, vérifier stack source et release dans MIP, pas seulement HTTP 200 de l’upload.
- [ ] Noter lien du build et SHA, sans token. Faute d’accès client, conserver le template prêt et statut `blocked: client_repo_and_ci_access`, tout le reste de P8 peut avancer.

## 6. P8.5 — crashes natifs, symboles et recette mobile (L+)

### Choix technique à instruire sans l’imposer

Trois chemins : moteur natif intégré directement avec stockage/transport MIP ; SDK d’un fournisseur relié par un adaptateur serveur ; pilote sur une seule plateforme puis seconde. Le premier peut éviter un SaaS mais exige tout de même expertise/toolchain native et maintenance. Aucun ne fonctionne avec un simple fetch JS dans un handler fatal.

La décision concrète doit préciser : moteur/fournisseur, plateforme iOS/Android, app et variantes de build, coût autorisé, résidence/destination de données, accès aux symboles et disponibilité réelle d’une API d’export/webhook. **Ne pas choisir un fournisseur seulement parce qu’il capte les crashes : s’il n’offre pas le chemin d’import nécessaire à MIP, le pilote doit le constater.**

### Contrat d’adaptation à préparer avant les accès

`NativeCrashAdapter` expose `capabilities`, `configure`, `setConsent`, `setContext`, `drainPendingReports`, `ack(reportId)` ; un callback JS de crash n’est pas requis ni supposé fiable lors de la mort du process. Côté serveur, un rapport normalisé contient :

```text
external_report_id, app_id, platform, runtime,
release, build_id, occurred_at, received_at,
exception_type, message_scrubbed, frames_scrubbed,
fatal, native_mechanism, session_id?, trace_id?,
symbolication_status, artifact_build_id, provider?
```

Unicité `(app_id,provider,external_report_id)` ; rapport non symboliquable reste visible avec raison. Secrets du fournisseur et symboles natifs ne vont pas dans l’app. Identités/contextes restent bornés et scrubbed ; si le fournisseur reçoit la donnée avant MIP, le scrub MIP ne protège pas cet envoi initial : config/privacy du SDK fournisseur doit être testée au point d’émission.

- [ ] Interface adapter + fixtures anonymes, ingestion vers le modèle P5, guards DSAR P8.1 et capacité `/mobile`. Ne pas brancher automatiquement un endpoint fournisseur tant que la destination n’est pas choisie.
- [ ] iOS : collecte crash au niveau natif, persistance sûre pendant crash, envoi au lancement suivant, dSYM de build UUID correspondant. Un dSYM d’une autre build doit produire unavailable, pas une stack fausse.
- [ ] Android : crash Java/Kotlin et NDK selon moteur retenu, mapping R8/ProGuard et symboles ABI correspondants. ANR seulement si source native qualifiée ; distinguer ANR reporté, hang détecté et erreur JS.
- [ ] Mesure native start séparée de JS start P7, horloge et bornes documentées ; cold/warm distincts, pas la même série sous deux noms.
- [ ] Intégration dépendances/Pods/Gradle et CI secrets dans l’app cible, versions figées, notes compatibilité RN/Expo/Hermes/new architecture selon ce qui est réellement exécuté.
- [ ] Recette : app release sans debugger, crash contrôlé, redémarrage, hors-ligne puis réseau, mauvais symboles, double envoi, consentement refusé, DSAR avant reprise, iOS et Android. Simulateur/emulateur et appareil physique indiqués séparément.
- [ ] Pour chaque plateforme, preuve de rapport visible avec bonne app/build/issue et symboles, puis capabilities verified à cette version. Tant qu’un système n’est pas testé, rester `not_verified` ; zéro crash ne prouve rien.

### Prérequis externes exacts

Repo app, versions RN/runtime, bundle ID/application ID, environnement de build macOS/Xcode pour iOS, Android SDK/Gradle pour Android, accès symboles et CI, appareils ou infrastructure de test. Certificats/signing si build cible l’exige, compte provider si retenu. Ne jamais demander les clés par copier-coller dans le plan ; les configurer via le système de secrets concerné.

Références de qualification, consultées le 16/09/2026 : [Datadog RN crash/setup](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/react_native/setup/), [Firebase Crashlytics Android](https://firebase.google.com/docs/crashlytics/android/get-started), [Firebase Crashlytics Apple](https://firebase.google.com/docs/crashlytics/ios/get-started). Ce sont des capacités documentées de candidats, **aucun achat ni choix de fournisseur n’est acté**. Vérifier le contrat d’export/API du candidat retenu avant de promettre une synchronisation vers MIP.

## 7. P8.6 — connecteurs Jira/GitHub/ITSM (M par fournisseur)

Le lien manuel P5 fonctionne sans connecteur. Ne pas modifier simultanément trois systèmes externes : choisir un premier espace/projet/repo concret, tester, puis réutiliser l’interface.

### Contrat et fichiers à préparer

`apps/ingest/lib/integrations/tickets/{adapter,dispatcher}.mjs` plus adapter du fournisseur retenu ; interface `createIssue`, `getIssue`, `validateWebhook`, `normalizeWebhook`. Config app-scopée, endpoint/origin allowlist, secrets stockés dans le gestionnaire de secrets disponible ou chiffrés par clé serveur séparée (jamais texte brut dans dashboard JSON).

Tables : `ticket_integration(id,app_id,provider,target,credential_ref,enabled,config_version)` ; `ticket_outbox(id,integration_id,issue_id,idempotency_key,state,attempts,next_attempt_at,external_id)` ; `ticket_webhook_event(integration_id,delivery_id,received_at,status)` unique ; liens P5 enrichis `provider/external_id` sans casser URL manuelle.

Routes proposées : `GET/POST /api/admin/ticket-integrations` (admin, corps `{app,provider,target,credentialRef}` pour créer, réponse sans secret), `PATCH /api/admin/ticket-integrations/:id` (enabled/configVersion), `POST /api/v1/issues/:id/tickets` (admin app-scopé, `{app,integrationId,expectedRevision}` →202 `{jobId,state}`), `GET /api/v1/issues/:id/tickets` (lecture scoped → liens/statut de livraison), `POST /api/webhooks/tickets/:integrationId` (auth fournisseur et body borné, sans cookie utilisateur). `401/403/404/409/413/429` suivent les règles P5 ; la réponse au webhook n’expose aucun détail RUM. L’interface de configuration reste cachée tant qu’aucun provider n’est branché et testé.

- [ ] Formulaire admin « Créer un ticket » sur issue ; affiche exactement titre/description/lien qui seront envoyés. Payload minimal : message scrubbed, app, release, compteur observé, URL console ; stack complète et identités exclues par défaut.
- [ ] Confirmer repo/projet cible et champs obligatoires à la configuration. Rien d’auto vers un repo inféré du git remote MIP.
- [ ] Outbox, retry backoff/429, clé idempotente. Si timeout après création distante et avant ack, rechercher via référence MIP avant retry ; si API ne le permet pas, statut `delivery_uncertain` et résolution opérateur plutôt que création répétée.
- [ ] Webhook signé/vérifié avec comparaison temps constant, timestamp/replay si protocole le fournit, ID unique et taille bornée. Ne pas inventer HMAC pour un fournisseur qui utilise un autre mécanisme officiel.
- [ ] Conflit de statut : MIP source de vérité pour `ignored`, fournisseur peut proposer resolved/reopened selon mapping explicitement configuré ; journal d’activité, pas boucle bidirectionnelle qui oscille. Événement provenant de MIP ne doit pas être renvoyé indéfiniment.
- [ ] Révocation token : intégration degraded, collecte RUM non bloquée. Viewer ne peut ni lire secret ni déclencher write externe.
- [ ] Tests de contrat locaux puis vrai ticket dans espace de test explicitement choisi ; vérifier existence, URL, contenu et statut retour. Nettoyage ticket selon autorisation ; ne pas fermer des tickets client réels pour tester.

Bloquants à demander uniquement pour cette activation : fournisseur et espace cible, droits OAuth/app installation, champs de création, URL publique webhook, politique de synchronisation et données autorisées à sortir. Le token GitHub présent dans des instructions antérieures est décrit read-only et expirant ; ne jamais le recopier ni le considérer capable de créer des tickets.

## 8. P8.7 — GeoIP optionnel (M)

P6 rend déjà le pays estimé par fuseau. GeoIP précise l’approximation sans promettre une localisation exacte. Aucun fournisseur n’est indispensable au fonctionnement de P6.

- [ ] Décision : base IP locale licenciée mise à jour ou appel fournisseur, pays seulement par défaut, résidence, coût et cadence. Liste/contrat précis à qualifier quand l’option est choisie.
- [ ] Extraire l’IP uniquement depuis la connexion/proxy de confiance de l’hébergement ; un client peut falsifier X-Forwarded-For si toute la chaîne est acceptée aveuglément.
- [ ] Géolocaliser en mémoire, persister country code et provenance `geoip`/version de base, pas IP brute ni coordonnées précises. Pas d’IP dans cache de logs ou clé d’erreur ; cache opérationnel éventuel en mémoire bornée et TTL documenté.
- [ ] Si appel externe, le fournisseur reçoit l’IP avant tout scrub MIP : décision explicite nécessaire. La variante base locale évite cet envoi, sans présumer de sa licence gratuite.
- [ ] Erreur/timeout/private IP → unknown ou timezone fallback clairement étiqueté ; ne jamais modifier une ancienne session par une IP actuelle. Aucun backfill GeoIP possible si l’IP historique n’a pas été stockée, et ce plan ne demande pas de la stocker.
- [ ] Fixtures de plages IP de test documentées, spoof proxy, IPv4/IPv6, unknown, licence/MAJ expirée ; validation dans l’hébergement cible. Les chiffres par pays conservent leur provenance.

## 9. P8.8 — recette finale et document de couverture (S)

Créer `docs/RUM_PARITY_STATUS.md` : une ligne par capacité de l’audit, verdict, preuve fichier/test/SHA/URL et limite. Les sujets transverses ne sont pas déclarés faits tant que leur dernier chemin d’écriture/lecture manque.

Checklist finale :

- [ ] P0–P4 toujours verts ; P5 issues/triage/source maps/alerts ; P6 filtres/Explorer/dashboard ; P7 payloads/consent/runtime.
- [ ] P8.1 scénarios concurrents, barrières réellement actives et politique consignée.
- [ ] Backfills : rapport par kind/app, éligibles traités, skips justifiés, pas de données inventées ni résurrection DSAR.
- [ ] Native : preuve par plateforme et build, pas globale « mobile fait ».
- [ ] Tiers : vrai flux de bout en bout seulement pour chaque connecteur activé ; simulateur/mock marqué test local.
- [ ] Documentation des limites : absence de données anciennes, sampling observé, pays approximatif, nombre de frameworks instrumentés, erreurs sans stack, éventuel export fatal perdu.
- [ ] Code source livré et vérifié vs accès externes manquants explicitement séparés. Pas de `status: done` global tant que des items obligatoires restent ouverts ; capacités optionnelles non retenues peuvent être `not_selected` avec décision datée.

## 10. Revue des fichiers et migrations

Points existants prioritaires : `apps/ingest/lib/{pg-ingest,ingest-differe,receiver,identity-hash}.mjs`, ports `apps/console/app/api/ingest/`, `apps/console/lib/{queries-dsar,dsar,dsar-identity-actions}.ts`, migrations purge/erase, jobs scheduler et collections DSAR. Les tables ajoutées en P5/P6/P7 doivent figurer dans l’inventaire avant de coder les suppressions.

Créer les modules/runbooks/tests indiqués ; index concurrents séparés et registre de migration existant conservé. Ne jamais appliquer un ancien `schema.sql` pour corriger un drift de checksum sans comprendre l’écart. Les clés/verrous/protocoles doivent être constants partagés et testés entre console et backend, pas dupliqués à la main.
