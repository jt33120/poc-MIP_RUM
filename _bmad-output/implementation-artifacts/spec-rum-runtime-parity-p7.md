---
title: 'P7 — Parité React Native, Node et FastAPI'
status: 'planned'
created: '2026-09-16'
baseline_commit: '11e9f346474db10abef111c8a120a1cecfd41997'
depends_on: ['P2', 'P3', 'P5', 'P6']
---

# P7 — Parité des runtimes

Lire [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md). Livrer les API et le chemin JS testables dans ce dépôt. La certification d’une application native, les crashes natifs et les builds signés appartiennent à P8.5 et ne sont pas remplacés par des tests mockés.

## 1. Point de départ observé

- `packages/rum-mobile/src/index.ts` expose init/screen/track/flushNow ; `core.ts` construit les spans OTLP. Le buffer est retiré avant l’envoi et un échec est absorbé ; pas d’acquittement durable ni de retry fiable.
- ErrorUtils chaîne le handler précédent et tente `void flush()` ; cela ne prouve pas la livraison d’un crash fatal. La session tourne à chaque retour active ; ni visitor_id persistant, ni consentement, ni contexte P2 complet.
- `platform` est actuellement utilisé comme `device_type`, pouvant contenir ios/android ; P6 aura normalisé appareil et plateforme.
- `installFetchPatch` propage par défaut vers toutes origines sauf ingest lorsque `traceOrigins=[]`. Réduire ce défaut à une liste explicite de propagation et documenter la migration.
- `packages/agent-node/src/register.ts` possède déjà instrumentation et contexte de requête ; `core.ts` possède builders spans/logs. FastAPI dispose du middleware et d’une suite unittest. P5.3 aura renforcé les exceptions ; ne pas doubler ce mécanisme.

## 2. Matrice des capacités contractuelles

| Capacité | Web acquis | RN cible P7 | Node/FastAPI cible P7 |
|---|---|---|---|
| Contexte global/local | P2 | Même validation/précédence | Global + contexte de requête isolé ; aucun user global par défaut |
| User/account pseudonymes | P2 HMAC serveur | APIs set/clear + rotation | Option explicite dans le scope de requête, HMAC serveur |
| Consentement | P2 | pending/granted/denied, révocation purgeant le buffer | Politique de collecte serveur configurée ; pas de faux écran de consentement navigateur |
| View/screen | startView | screen conservé + alias startView | Non applicable, ne pas inventer de page vue pour chaque requête |
| Actions | P3 causales navigateur | addAction et adaptateurs RN explicites | Événement/action métier manuel ; aucune causalité DOM |
| Timings/flags/errors | P2 | addTiming/flag/addError même enveloppe | track/captureException/contexte ; timings via spans |
| Tracing réseau | P3 | fetch compatible et allowlist | ALS/ContextVar, span parent et propagation contrôlés |
| Erreurs fatales natives | Non applicable | Préparation adapter ; validation P8.5 | Process fatal best-effort, pas de garantie d’export avant kill |
| Offline | SDK web existant | Retry borné ; persistance conditionnée P8.1 | Queue mémoire bornée, flush shutdown borné |

Le terme « parité » couvre cette matrice. Les wrappers Pressable/navigation ne sont pas une interception universelle de tous widgets natifs. Les signaux rage/dead/error clicks RN ne seront activés que lorsqu’un adaptateur peut observer les gestes ET leur réponse ; `addAction` seul ne les prouve pas.

## 3. Architecture et API publiques

Extraire seulement les primitives pures communes réellement partagées dans `packages/rum-core/` : validation/limites du contexte, métadonnées, snapshots, encodeur OTLP et types. Aucun import DOM, React Native, Node natif ou réseau dans ce package. Les gates et horloges propres aux runtimes restent des adaptateurs. Tests de compatibilité prouvent que le SDK web ne change pas de bundle ni de comportement ; budget web ≤35 Kio gzip conservé.

### RN

Conserver tous les exports existants. Contrat additif :

```ts
init({
  endpoint, appId, apiKey?, clientId?, env?, appVersion?,
  platform?, osVersion?, traceOrigins?, flushIntervalMs?,
  requireConsent?: boolean, // défaut false pour compatibilité ; installation neuve documentée true
  initialConsent?: 'pending' | 'granted' | 'denied',
  beforeSend?: (attributes, meta) => attributes | null,
  adapters?: { storage?, lifecycle?, navigation?, random?, monotonicClock? },
  offline?: { persistent?: boolean, maxEvents?: number, maxBytes?: number, ttlMs?: number }
});
consent(granted: boolean): void;
setGlobalContextProperty(key, value): boolean;
removeGlobalContextProperty(key): void;
setUser(id, context?): boolean; clearUser(): void;
setAccount(id, context?): boolean; clearAccount(): void;
startView(name, context?): boolean; // screen(name) reste compatible
addAction(name, context?): boolean;
addTiming(name, durationMs?): boolean;
addFeatureFlagEvaluation(name, value): boolean;
addError(error, context?, options?): boolean;
track(name, props?): void; // retour historique conservé
flushNow(): Promise<void>; // résolu même si échec best-effort historique, diagnostic séparé
shutdown(): Promise<void>; // flush borné puis nettoyage des hooks/timers
getDiagnostics(): { queued, dropped, retries, storageAvailable, consent, nativeCapabilities };
```

Recopier les signatures exactes user/account/types de P2 au moment de l’implémentation plutôt que créer des variantes incompatibles. Une nouvelle API renvoie false si consentement refusé ou entrée invalide ; elle ne lève pas une exception dans l’app hôte. `beforeSend` est synchrone ; une Promise est une entrée invalide, pas une attente dans le thread UI.

Adapters : storage async `{getItem,setItem,removeItem}` ; lifecycle `{subscribe(callback):unsubscribe}` ; navigation `{subscribeScreen(callback):unsubscribe}` ; random `{bytes(length):Uint8Array}` ; clock `{nowMs():number}` monotone. Le package RN n’utilise pas un `global.require` supposé fonctionnel sous Metro pour découvrir ses capacités : exports d’adaptateurs explicites, peer dependencies optionnelles et versions testées consignées.

### Identité et stockage offline

- Visiteur = ID aléatoire d’installation, app-scopé et créé seulement après consentement lorsqu’il est requis. Aucun advertising ID, device ID, email ou fingerprint matériel. Stockage indisponible → identifiant mémoire et `identity_persistence=memory`.
- Session = visite, distincte du visiteur. Nouveau lancement ou reprise après 30 min d’inactivité (défaut configurable borné) → nouvelle session ; une bascule background→active de 2 s ne tourne pas automatiquement la session.
- Changement user/account : drainer ou séparer l’ancienne enveloppe, tourner session et vue comme P2 ; les fetch encore en vol gardent le snapshot d’origine. Jamais de réattribution au nouvel utilisateur lors du flush.
- Identifiants métier bruts : mémoire et transport autorisé vers endpoint MIP pour HMAC serveur ; **pas dans le stockage offline durable**. Un événement persisté sans hash serveur ne conserve que son contexte scrubbed et ses IDs techniques ; il est lié à l’identité seulement si le serveur connaît déjà la session d’origine. Sinon identité inconnue, sans reconstruire depuis le user courant au prochain lancement.
- Avant stockage durable, appliquer le scrub portable sur props/context/messages/stacks/URLs et retirer credentials/identités métier de l’enveloppe. Réutiliser le corpus de tests du scrub serveur pour cette variante pure ; le scrub serveur reste obligatoire et autoritaire à réception. Le `beforeSend` seul n’est pas une garantie de confidentialité du disque.
- Ne pas embarquer `IDENTITY_HASH_SECRET`. Ne pas remplacer HMAC app-scopé par un simple SHA calculé sur le téléphone.
- Pending avec consent requis : pas de réseau ni écriture disque ; tampon mémoire borné autorisé selon contrat P2. Denied : vider mémoire/disque, révoquer l’époque, annuler requêtes encore annulables ; aucun rejeu des événements de l’époque refusée. Une requête déjà reçue n’est pas effaçable depuis le client : DSAR reste la voie serveur.
- Durable offline désactivé par défaut ; activation prod exige P8.1 pour que la reprise ne recrée pas des données effacées.

## 4. Étapes et critères d’acceptation

### P7.1 — primitives pures et enveloppe RN (M)

- [x] Extraire les helpers utilisés par au moins deux runtimes, avec tests de snapshot commun. Déclarations de dépendances workspace/exports/build cohérentes ; pas d’import de TS source non compilé depuis un artefact publié.
- [x] Étendre `MobileConfig`, `Ctx` et builders vers les champs P2/P5/P6 : visitor/session/view/action, context, user/account transport, platform/device/env/release, erreurs et timings.
- [x] Conserver le round-trip OTLP → parser → PostgreSQL actuel. Ne pas envoyer `mip.user_hash` legacy comme identité personnelle.
- [x] Métadonnées structurelles restaurées après `beforeSend`; exceptions hook isolées avec drop/diagnostic borné. Tous payloads passent à nouveau par scrub serveur.
- [x] Vérifier web sans RN dans le bundle, RN sans globals DOM, Node sans React. Installer le package construit dans un mini-consommateur isolé de test pour valider les exports.

Recette : même événement dans web/RN conserve mêmes types/limites et précédence ; bool/null/number exacts ; cycles/profondeur excessive traités ; anciens `screen/track/flushNow` fonctionnent.

Livré le 18/09/2026 sur `feat/rum-runtime-p7-1`, sans migration. Preuves et écarts assumés : [delivery-p7.md](delivery-p7.md).

### P7.2 — consentement, visiteur et transport (L)

- [x] Implémenter gate et snapshots d’époque. Une transition granted→denied purge avant tout nouvel enqueue ; rejected hooks ne modifient pas l’état global.
- [x] Implémenter session/visitor via adaptateurs, horloges monotones pour durées et UTC pour timestamps ; horloge murale qui recule ne donne pas de timing négatif.
- [x] Queue par app/époque : défaut mémoire 500 événements/1 Mio, maximum 1 000/2 Mio, TTL 24 h, batch ≤64 événements et plafond HTTP réel. Supprimer les plus anciens au dépassement avec compte drop ; ne pas dépasser le plafond à cause d’un seul événement énorme.
- [x] Retirer un batch uniquement après acquittement HTTP attendu. 408/429/5xx et réseau retry avec backoff+jitter, `Retry-After` borné ; 400/401/403 non retry infini, diagnostics sans corps sensible. Un événement rejoué garde son ID, pas de nouveau span créé à chaque tentative.
- [x] Persistance optionnelle versionnée avec adaptateur natif ; sérialiser des écritures atomiques/manifestes selon capacité, reprise après corruption sans crasher l’app ; aucune API key ou identité brute dans la queue.
- [x] Sauvegarde sur background et flush best-effort ; restaurer au démarrage après consentement, TTL et époque. Queue de l’app A impossible à envoyer dans B.
- [x] `shutdown` enlève uniquement les hooks/timers posés par MIP ; respecte un patch installé après lui. Re-init/test mount ne duplique pas listeners.

Recette : réseau offline→online, perte d’ACK après commit, 429, 401, disque plein/corrompu, révocation pendant flush, fermeture/réouverture, changement user avec retry, 2 apps, horloge reculée. Test SDK+ingest prouve une seule occurrence pour un même événement acquitté deux fois.

Livré le 18/09/2026 sur `feat/rum-runtime-p7-2`, sans migration. Le stockage durable
(`offline.persistent`) est **désactivé par défaut** : son activation en production reste
conditionnée à P8.1. Preuves et écarts assumés : [delivery-p7.md](delivery-p7.md).

### P7.3 — navigation, actions et erreurs JS (M)

- [x] Adaptateur navigation basé sur les callbacks publics du routeur pris en charge ; exposition `screen` manuelle pour les autres. Même écran/route key ne double pas une vue à cause de callbacks répétés.
- [x] Adaptateur Pressable/Button opt-in : nom explicite `mipActionName`, pas extraction de texte privé ; appels original et accessibilité conservés. Action racine conservée seulement si gate/hook l’accepte.
- [x] Fenêtre causale définie comme P3 mais adaptée aux promesses et interactions RN testables. Un travail asynchrone plus tardif hors fenêtre demeure non attribué ; ne pas deviner le dernier clic.
- [x] ErrorUtils + mécanisme public de rejections disponible dans le runtime réel ; mode capacité absent explicite pour moteur non supporté. Garder le handler précédent et la redbox/terminaison ; JS fatal distinct du crash natif.
- [x] Fetch : recopier correctement Request/headers/méthode, préserver un traceparent existant valide ; propagation seulement sur `traceOrigins` explicites, aucune donnée de session vers origines tierces par défaut. Endpoint de collecte toujours exclu pour éviter boucle.
- [x] App start : mesure JS depuis initialisation SDK jusqu’au premier écran rendu via callback explicite, nom `js_start_to_first_screen_ms`. Ne pas la vendre comme démarrage natif complet. Warm start distinct. Pas d’ANR à partir d’un simple timer JS.

Recette : changement d’écran rapide, routes imbriquées, retour sur même écran, double callback, deux actions proches, erreur sans action, hook qui rejette, requête en vol lors de rotation identité, réseau tiers sans headers MIP.

Livré le 18/09/2026 sur `feat/rum-runtime-p7-3`, sans migration. **Rupture de comportement
assumée** : `traceOrigins` est désormais une liste FERMÉE — une liste vide ne propage plus
rien. Migration documentée dans le README du paquet. Preuves et écarts assumés :
[delivery-p7.md](delivery-p7.md).

### P7.4 — API Node et FastAPI (M)

- [ ] Exporter côté Node `track(name, props?)`, `captureException(error, context?)`, `withContext(context, fn)` (async inclus), `flush({timeoutMs})` et une configuration initiale. Réutiliser l’instrumentation de `register.ts` ; aucun second patch de console/http/pg.
- [ ] `AsyncLocalStorage` pour contexte de requête, extraction validée traceparent, restauration dans finally. Global context seulement pour attributs de service stables, pas pour user/client variables par requête.
- [ ] `captureException` émet le contrat P5.3, avec stack et identifiant stable lorsque le même incident est aussi loggé ; logs conservent leurs attributes scrubbed et correlation.
- [ ] FastAPI : API minimale `capture_exception`/contexte utilisant ContextVar, avec exemples de scope et tests d’isolation. Préserver la dépendance stdlib sauf besoin démontré ; ne pas convertir le middleware en agent externe.
- [ ] Buffer/shutdown bornés, aucun timer gardant le process vivant sans nécessité, pas d’attente indéfinie sur SIGTERM. Ne pas masquer uncaught exception ou empêcher le comportement du framework.
- [ ] Exposer les attributs de logs par la surface existante réellement ouverte, sinon garder ce livrable comme enrichissement API/documentation et noter la route fermée ; ne pas rouvrir `/logs` implicitement hors de sa politique produit.

Recette : 100 requêtes concurrentes A/B avec contexte distinct, imbriquées et rejetées ; pas de fuite après fin de requête ; DB span bon parent ; capture manuelle+auto dédupliquée uniquement avec ID commun ; process termine sous timeout d’export.

### P7.5 — `/mobile`, API/MCP et distribution (M)

- [x] `/mobile` réutilise contrat P6, filtre `platform ios/android`, release/appareil et app. Cartes sessions/visiteurs observés, erreurs JS, temps JS vers premier écran, écrans fréquents, requêtes lentes ; liens issues P5 et sessions.
- [x] Modèle de capacité `mobile_capabilities` par app/runtime/release, transmis explicitement par SDK et validé serveur ; valeurs `js_errors`, `native_crashes`, `anr`, `native_start`, `offline_persistence`, `screen_tracking`. Capacité activée n’implique pas test natif passé ; `verified_at` provient seulement de recette opérateur, jamais d’un bool client.
- [x] Crashes natifs/ANR non connectés : badge « Non collecté », ni zéro ni « 100 % sans crash ». Calcul JS : `js_error_free_session_rate = 1 - sessions ayant au moins une erreur JS / sessions RN observées` avec même cohorte/fenêtre et sampling annoncé. Label ne dit pas « crash-free ».
- [x] Endpoint `GET /api/v1/mobile/summary` reprend filtre/range P6, retourne `{meta,data:{capabilities,sessions,visitors,js_errors,js_error_free_session_rate,startup,screens,resources}}`. Null pour métriques non disponibles. MCP `mip_rum_mobile_summary`, read-only.
- [x] Documenter exemples RN bare et adaptateur navigation retenu, Expo seulement si réellement testé. Produire build/package typé et fixture d’installation. Publication npm/store non supposée autorisée : repo/build prêts ; compte/registry cible requis si distribution externe souhaitée.
- [x] Fichier de matrice runtime réellement testé : versions RN, React, Hermes/JSC, OS, router et architecture native. Ne pas déclarer une plage de compatibilité à partir d’un seul test sous mocks.

Livré le 18/09/2026 sur `feat/rum-runtime-p7-5`, **migration v82** (v81 étant prise par P8.1,
fusionné pendant ce lot ; v82 reprend ses définitions d’effacement au lieu de celles de v80).
La sixième case est cochée sur le fichier, pas sur une plage : **aucune version réelle de React
Native, React, Hermes, JSC, iOS ou Android n’a été exercée**, et
[MATRICE-RUNTIME.md](../../packages/rum-mobile/MATRICE-RUNTIME.md) le dit cellule par cellule.
Expo n’est pas documenté, faute d’avoir été testé. Aucune publication npm ni store : le dépôt et
le build sont prêts, registre cible et compte restent à décider. Preuves, écarts assumés et
**clôture de P7** : [delivery-p7.md](delivery-p7.md).

## 5. Fichiers à modifier/créer

Modifier `packages/rum-mobile/src/{index,core}.ts` et build/package, `packages/agent-node/src/{core,register}.ts` et exports/package, `integrations/fastapi/{mip_rum_middleware.py,test_mip_rum_middleware.py,README.md}`, P2 helpers via extraction limitée, `otlp.mjs`/`pg-ingest.mjs` pour champs runtime, registre P6, OpenAPI/MCP/docs.

Créer `packages/rum-core/` ; `packages/rum-mobile/src/{consent,session,queue,transport,diagnostics}.ts`, `src/adapters/{lifecycle,navigation,storage,interactions}.ts` selon intégrations retenues ; module public API Node et contexte FastAPI ; `apps/console/app/mobile/{page,loading,error}.tsx`, `lib/queries-mobile.ts` et route summary. Nouvelles colonnes runtime/capacités et index app/range via migration après P6 ; pas de table native crash parallèle avant P8.5.

## 6. Recette et fin de lot

- [x] Étendre `tests/unit/rum-mobile.test.ts`, `agent-node.test.ts`, tests runtime contexte/gate/queue/headers avec horloges déterministes.
- [x] `tests/integration/rum-runtime-parity-sql.test.ts` : payload construit avec vrai package → parser → writer → API/queries, A/B, vieux SDK, erreur backend sans session et zéro double comptage.
- [x] `tests/e2e/mobile-console.spec.ts` : fixtures explicitement RN synthétiques, filtres/platform, données manquantes, drill-down issue, clavier/mobile.
- [~] Consommateur de build minimal TypeScript puis bundle Metro si toolchain disponible ; tests d’installation des exports. Ajouter à CI ce qui est reproductible sans compte externe.
      → le consommateur TypeScript, CJS et ESM est en CI (`verify-sdk-packaging.mjs`, 36 contrôles). **Aucun bundle Metro** : la toolchain n’est pas disponible dans ce dépôt, et l’y installer ne prouverait toujours rien du moteur ni de l’appareil.
- [ ] Recette RN réelle dans P8.5 : app, appareil/simulateur, crash/relance/offline, symboles et release exacte. Si app indisponible, P7 JS peut être livré mais couverture native reste « non vérifiée ».
      → **non faite, et assumée comme telle.** P7 JS est livré ; la couverture native reste « non vérifiée », et l’écran `/mobile` l’affiche « Non collecté » au lieu de 0.
- [x] Migration additive, SDK release documentée, compatibilité ancienne version, activation opt-in de la propagation et du stockage durable. Preuve prod sur app de recette si fournie, sinon preuve contrat API et local distinctes.

Références consultées le 16/09/2026 : [Datadog RN Monitoring](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/react_native/), [Setup](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/react_native/setup/), [Advanced Configuration](https://docs.datadoghq.com/real_user_monitoring/application_monitoring/react_native/advanced_configuration/). La comparaison inclut collecte offline, consentement et intégration native ; aucune dépendance au SDK Datadog n’est introduite par ce plan.
