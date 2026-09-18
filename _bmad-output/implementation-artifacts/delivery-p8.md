# Livraison P8 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-operations-integrations-p8.md](spec-rum-operations-integrations-p8.md).
Base : `origin/master` au 18/09/2026 (P5, P6 et P7.1/P7.2/P7.4 fusionnés).

Une case n'est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | PR | Migration | Implémenté | Testé localement | CI | Déployé | Vérifié sur vraie app |
|---|---|---|---|---|---|---|---|
| P8.1 — effacement sérialisé avec l'ingestion | #205 | v81, appliquée sur Neon le 18/09 10:16 | oui | oui | verte | oui (`b06a5ce`) | non — aucun effacement réel joué depuis l'activation |
| P8.2 — outillage de backfill et dry-run | #208 | v83 (non appliquée en production) | oui | oui | verte | non | non — **aucun backfill exécuté**, aucun périmètre choisi |
| P8.6 — connecteur de tickets (GitHub Issues) | #211 | v84 (non appliquée en production) | oui | oui | verte | non | **partiellement** — un vrai ticket créé dans un dépôt bac à sable ; webhook jamais reçu d'un vrai fournisseur |
| P8.7 — GeoIP optionnel | #210 | v85, appliquée sur Neon le 18/09 13:27 | oui | oui | verte | oui (`6485f45`) | non — le service `ingest` n'a pas de domaine public ; le GeoIP ne tourne sur aucun chemin de production |
| P8.3 à P8.5, P8.8 | — | — | non | — | — | — | — |

## P8.1 — effacement sérialisé avec l'ingestion

Branche `feat/rum-effacement-p8-1`. Migration **v81** (le maximum présent était v80).

### La faille, telle qu'elle était

`queries-dsar.ts` relevait les sessions **existantes** puis supprimait leurs lignes. Tout ce qui
arrivait après ce relevé recréait ce qu'on venait de supprimer : un lot déjà déposé dans `ingest_raw`,
un beacon en vol, un chunk de rejeu, un log OTel portant la même identité. Le drain aggravait le cas —
il tenait un verrou de ligne de file sur **sa** connexion puis appelait `writeRows(pool, …)`, qui
ouvrait **sa propre transaction sur une autre connexion** : les tables finales étaient écrites hors de
la transaction censée les protéger. Ajouter un verrou au seul formulaire DSAR n'aurait fermé aucun de
ces chemins.

### Décisions d'implémentation, et leur raison

- **Une seule primitive**, `apps/ingest/lib/privacy-barriere.mjs` :
  `withAppIngestTransaction(pool, appId, travail)` ouvre la transaction, pose `lock_timeout` et prend
  `pg_advisory_xact_lock(811801, hashtext(app))`. **Verrou de transaction, jamais de session** : la
  production passe par le pooler transactionnel de Neon, où un verrou de session est pris sur une
  connexion et perdu sur la suivante — la leçon déjà payée par `migrate.mjs`. La constante `811801`
  existe en **deux** exemplaires seulement, et un test compare celui de JavaScript à celui du SQL
  (`mip_verrou_ingestion_ns()`) : deux copies qui dérivent seraient deux verrous, et chacun se croirait
  seul.
- **L'ordre multi-app se calcule sur la CLÉ de verrou, pas sur `app_id`.** Trier par identifiant
  d'application ferait dépendre l'ordre de la collation — JavaScript trie en UTF-16, PostgreSQL selon
  sa locale —, et deux lots multi-app s'interbloqueraient. Le serveur rend les clés, le client
  verrouille par clé croissante. Le dépôt différé, lui, **scinde** le lot par application : une ligne
  de file portant l'app A ne peut plus contenir des collections de B.
- **Barrière durable `privacy_erasure_barrier`**, consultée par tous les writers. Sans elle, le verrou
  ne protégerait que l'instant de la transaction : le lot suivant recréerait tout, une seconde plus
  tard. Elle est **écrite seulement quand l'application a activé la protection** (voir la décision de
  politique ci-dessous) : une barrière est elle-même un identifiant pseudonyme, et en conserver un qui
  ne servira jamais à refuser serait exactement le reproche fait par ailleurs à l'ingestion.
- **`lock_timeout` asymétrique, et c'est délibéré** : 5 s côté writer (au-delà, un refus `503`
  rejouable vaut mieux qu'une connexion de pooler immobilisée), 30 s côté effacement (une action
  d'exploitation peut attendre, et c'est elle qui doit gagner).
- **SAVEPOINT dans le drain.** Une transaction PostgreSQL en échec refuse tout ordre suivant (25P02),
  y compris un simple `update` de compteur : l'ancien code écrivait le compteur d'échec dans la
  transaction que l'erreur venait d'avorter. Le compteur ne montait donc jamais et le lot empoisonné
  revenait sans fin. Le verrou d'application est pris **avant** le point de reprise, donc il survit au
  retour arrière partiel.
- **Un lot mixte ne se supprime pas en entier.** `privacy_filtrer_file()` retire les éléments rattachés
  à la personne effacée, collection par collection, et ne supprime la ligne de file que s'il n'y reste
  plus rien. Le rattachement se fait par identifiant — session, visiteur, HMAC app-scopé — jamais par
  ressemblance de message ou de stack.
- **Conflit de portée** : une session déjà enregistrée sous A et revendiquée par B lève une
  `ErreurPorteeApp` (409, non rejouable) ; en défense de deuxième ligne, la clause
  `on conflict (session_id) do update` porte désormais `where rum_session.app_id = excluded.app_id`,
  pour la fenêtre où deux applications écrivent sous **deux verrous différents** et ne s'attendent donc
  pas.
- **Effacement d'app entière** : `erase_app_data` **suspend l'ingestion dans le registre** sous la
  même transaction (`ingestion_suspended_at`), et `createPgAuth.checkApiKey` refuse une application
  suspendue **même sans `REQUIRE_API_KEY`**. Sans cela, le prochain beacon recréait des lignes dans
  l'application que l'on venait de vider. La reprise est une opération d'exploitation explicite.
- **L'export DSAR est une lecture** : `repeatable read, read only`, prédicats `(app_id, …)`, aucune
  barrière écrite, aucun verrou d'ingestion pris. Faire attendre l'ingestion pour une lecture serait
  payer un prix sans rien acheter.
- **Les rematérialisations passent par le même verrou.** `refresh_rum_rollups` et
  `refresh_metric_histogram` prennent les verrous des applications concernées avant toute lecture :
  sans cela, une marque d'invalidation posée entre leur agrégation et leur levée disparaissait sans que
  l'heure ait été recalculée, et la cellule fausse redevenait « digne de foi ».
- **Reprise des vieilles marques d'invalidation** (trou nommé dans `delivery-p6.md`) : la fenêtre de
  rafraîchissement est **élargie jusqu'à la plus vieille marque en attente**, bornée à 90 jours. Le coût
  est payé une fois après un effacement, puis la fenêtre redescend à 26 h. `rum_rollup_hourly` est
  désormais **vidée puis réécrite** sur sa fenêtre, comme l'histogramme : `on conflict do update` seul
  laissait survivre une cellule dont plus aucune ligne ne relevait.

### Bogue de master trouvé en chemin, et corrigé

**`erase_app_data` avait perdu `analytics_saved_view` et `dashboard`.** v79 (P6.5) et v80 (P6.6) ont
été écrites en parallèle et fusionnées sans conflit déclaré : v80 a repris la définition d'avant v79.
Sur une base où les deux fichiers s'appliquent dans l'ordre, **effacer un client laissait ses vues
enregistrées et ses tableaux de bord en place**. Le test de v79 ne le voyait pas parce que le test
*précédent* rejoue `migration-v79.sql`, ce qui restaure la définition juste avant l'assertion. Vérifié
en base :

```
-- toutes migrations appliquées dans l'ordre, AVANT v81
select prosrc like '%analytics_saved_view%' from pg_proc where proname='erase_app_data';  -- f
```

v81 rétablit les deux suppressions, et un test compare désormais la liste au **catalogue** plutôt qu'à
une liste recopiée.

### Autres trous refermés, non demandés mais trouvés par le catalogue

| Table | Ce qui manquait |
|---|---|
| `rum_log` | Porte `session_id` (P5.3) et ne figurait pas dans `DSAR_CHILD_TABLES` : un export art. 15 ne le rendait pas, un effacement art. 17 le laissait |
| `rum_ai` | Absente de `erase_session`, `purge_rum_app` et `erase_app_data` alors qu'elle porte `session_id` |
| `svi_call`/`svi_step`/`svi_leg`/… | Télémétrie d'appels app-scopée, jamais supprimée par `erase_app_data` |
| `error_status` | Triage historique par empreinte, app-scopé, jamais supprimé par `erase_app_data` |
| `page_count` | Recollé sur `session_id` seul : deux applications émettant la même valeur échangeaient leur nombre de pages |

### Preuves chiffrées

Locales, 18/09/2026, PostgreSQL 15.18 en conteneur (aarch64, port 5433), bases jetables créées et
supprimées pour l'occasion :

- `pnpm exec vitest run tests/unit --exclude '**/.claude/**'` : **162 fichiers, 2 248 tests verts**
  après fusion de `origin/master` (qui a apporté P7.3). Avant la fusion : 161 / 2 183, pour une
  référence master de 160 / 2 158 — soit +1 fichier (`privacy-barriere.test.ts`) et +25 tests de ce
  lot, aucun test existant perdu.
- `pnpm test:sql` : **23 fichiers, 276 tests verts, 12 ignorés** (référence : 22 / 256), dont le
  nouveau `tests/integration/dsar-concurrency-sql.test.ts` — **17 tests**.
- `pnpm test:isolation`, `pnpm test:alerting` : verts sur bases dédiées.
- CI de la PR #205 : les six contrôles au vert (`Build SDK + tests unitaires`, `E2E Playwright
  (Postgres service)` — qui joue aussi `test:sql`, `test:isolation`, `test:alerting` et `test:svi` —,
  `docker-smoke`, `mcp-smoke`, Vercel).
- `pnpm --filter console exec tsc --noEmit` : vert. `pnpm -r build` : vert.
- Migration v81 appliquée **deux fois de suite** sur une base neuve (idempotente) et sur un schéma
  **v80** (fenêtre de déploiement, suite dédiée `SQL_TEST_PRE_V81_DATABASE_URL`).

#### Les dix interleavings, et ce que chacun prouve

Deux à quatre connexions PostgreSQL réelles, **aucun `sleep` probabiliste** : l'attente porte sur une
condition lue dans `pg_locks` (« quelqu'un attend-il un verrou de notre espace de noms ? »), et le
commit de la transaction retenue est déclenché par le test.

| # | Interleaving | Prouvé | Preuve |
|---:|---|---|---|
| 1 | Writer tient le verrou, l'effacement attend | oui | le writer commit, l'effacement supprime 1 session, zéro résidu, barrières `session` + `user` posées |
| 2 | L'effacement tient le verrou, le writer attend | oui | au commit, le writer relit les barrières : le lot mixte perd la personne effacée et écrit l'autre |
| 3 | Lot ciblé déposé APRÈS le relevé | oui | le dépôt refuse (0 ligne en file), le drain ne trouve rien, l'écriture synchrone du même lot est refusée |
| 4 | Session absente, personne connue seulement d'un lot en file | oui | la barrière d'identité est posée sans session préalable, et la session est trouvée **dans le lot** |
| 5 | Rejeu / log après l'effacement | oui | rejeu `refus_barriere` sans session minimale recréée ; session jamais vue → `attente_session` borné, corps non persisté ; log filtré |
| 6 | Lot mixte, deux personnes | oui | la ligne de file survit amputée (1 session sur 2), le drain n'écrit que l'autre personne |
| 7 | Double DSAR + travailleur + rematérialisation | oui | quatre acteurs concurrents, aucun rejet, aucun interblocage, effacement rejouable sans effet |
| 8 | Panne après l'écriture, avant le retrait de file | oui | rollback complet, lot intact, la reprise écrit **une** fois |
| 9 | Rematérialisation pendant l'effacement | oui | le rafraîchissement attend le même verrou ; la cellule est recalculée sans les mesures effacées et la marque est levée |
| 10 | Même empreinte dans une autre application | oui | l'autre app est conservée, absente du rapport, son ingestion n'est pas bloquée, et le HMAC diffère entre apps |

Deux tests s'y ajoutent : l'attente de verrou épuisée rend une `ErreurVerrouIngestion` **identifiée et
rejouable** (jamais un succès), et une session stockée sous A n'est **pas** mise à jour par B.

#### Benchmark sous contention

`scripts/bench-verrou-p81.mjs`, base jetable, 200 lots par passe, lots produits par le **vrai** parser
et écrits par le **vrai** `writeRows`. `att.*` est le temps d'attente du verrou **seul**, mesuré par une
sonde qui tourne pendant la charge.

| Scénario | writers | apps | lat. p50 | lat. p95 | att. p50 | att. p95 | att. max | débit | refus |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| une seule application | 1 | 1 | 4,3 ms | 6,0 ms | 4,3 ms | 5,8 ms | 34,2 ms | 209/s | 0 |
| une seule application | 10 | 1 | 39,1 ms | 60,9 ms | 38,7 ms | 51,7 ms | 61,0 ms | 242/s | 0 |
| une seule application | 50 | 1 | 249,5 ms | 505,3 ms | 237,4 ms | 507,3 ms | 507,3 ms | 165/s | 0 |
| réparti sur 5 apps | 10 | 5 | 10,4 ms | 15,1 ms | 9,8 ms | 14,5 ms | 15,3 ms | 890/s | 0 |
| réparti sur 5 apps | 50 | 5 | 52,5 ms | 61,9 ms | 0,9 ms | 64,1 ms | 64,1 ms | 893/s | 0 |

**Ce que ces chiffres disent.** Le verrou par application **plafonne le débit d'UNE application** à
~200 lots/s sur cette machine, et la latence y croît linéairement avec le nombre d'écrivains
simultanés : 4 ms à 1 écrivain, 39 ms à 10, 250 ms à 50. Réparti sur cinq applications, le débit monte
à ~890 lots/s et la latence retombe : la sérialisation est bien **locale à une application**, pas
globale. À 50 écrivains simultanés sur une seule app, l'attente maximale observée est de **507 ms**,
soit un dixième du budget de 5 s ; **zéro refus** dans toutes les passes. Par extrapolation linéaire, le
budget serait atteint vers ~500 écrivains simultanés sur une même application.

**Ces chiffres ne condamnent pas le verrou par app** pour la charge de ce produit (5 erreurs ingérées
au total en production au 17/09/2026, cf. `delivery-p5.md`). Ils fixent en revanche le seuil à
surveiller : une application dépassant ~200 lots/s en régime soutenu verra sa latence d'ingestion
croître, et c'est à ce moment-là — pas avant — qu'un verrou par identité ou par session devra être
instruit, **avec une preuve équivalente**, pas un protocole improvisé par writer.

**Stratégie de retry exposée** (`STRATEGIE_VERROU`) : `lock_timeout` 5 s, 3 tentatives, reculs de
120 ms puis 480 ms. Au-delà : `ErreurVerrouIngestion` → `503` + `Retry-After: 2` côté HTTP, rien n'a
été écrit, le SDK rejoue. Un refus de portée est un `409`, non rejouable — les confondre en `500`
ferait tourner la file de rejeu du SDK sur une demande qui ne peut pas aboutir.

## Écarts assumés — P8.1

- **Les commentaires de triage d'une issue qui SURVIT ne sont pas scrubés.** Quand un effacement retire
  **toutes** les occurrences d'une issue, l'issue part avec son activité, ses liens de ticket et ses
  notifications (cascade) : l'exemplaire et le commentaire écrit à son sujet disparaissent. Quand il en
  reste, les bornes (`first_seen`, `last_seen`, releases) sont recalculées sur ce qui subsiste, mais le
  texte libre d'un opérateur n'est pas touché : MIP ne peut pas savoir s'il cite une donnée
  personnelle, et décider par ressemblance est explicitement interdit. **Une revue humaine reste
  nécessaire** si un opérateur a recopié une donnée dans un commentaire.
- **Sous `enforce`, un chunk de rejeu arrivé avant son ancre OTLP est PERDU, pas différé.** Le
  transport de rejeu du SDK web ne rejoue pas (`packages/rum-sdk/src/replay.ts`, « best effort : chunk
  perdu »). Le serveur répond `425` + `Retry-After` et **ne persiste pas le corps** ; un client capable
  de rejouer récupérerait le chunk, le SDK web actuel non. C'est le prix de ne plus créer aveuglément
  une session minimale qui contournait la barrière. Sous `off` — le défaut —, le comportement
  historique est conservé.
- **`purge_rum_app` ne prend pas le verrou d'application**, à dessein : c'est une suppression de
  données antérieures à une coupure de temps, elle ne peut pas recréer une ligne effacée, et un writer
  concurrent n'écrit que des lignes postérieures. Le lui faire prendre ferait tenir **tous** les verrous
  d'app pendant la purge nocturne (`purge_rum_tenants` boucle dans une seule transaction).
- **La rétention ne couvre toujours pas les tables SVI** : `erase_app_data` les vide désormais, mais
  `purge_rum_app` ne les purge pas. Écart préexistant, hors périmètre P8.1, consigné ici.
- **La configuration d'exploitation d'une app (`slo`, `goal`, `notify_channel`, `uptime_check`,
  `read_tokens`, `deploy_marker`, `ai_briefing`, `extension_scope`, `extension_install_app`) n'est pas
  supprimée par `erase_app_data`** : ce sont des objets d'exploitation, pas de la donnée de personnes.
  Un test compare la liste au catalogue, donc cet écart ne peut plus s'élargir en silence.
- **`tenant_usage_daily` et `app_registry` survivent volontairement** : facturation d'un côté, marque
  de suspension de l'autre. Supprimer la ligne de registre rouvrirait l'application au prochain
  événement reçu.
- **Deux travailleurs ne drainent plus la même application en parallèle.** Le débit par application ne
  croît plus avec le nombre de travailleurs ; c'est le prix de la sérialisation, il est mesuré
  ci-dessus, et un test le dit explicitement au lieu de le laisser découvrir.
- **Aucune vérification de version de protocole entre writers.** La spec demande de « vérifier leur
  SHA/version protocole » avant d'activer : la procédure est écrite dans `docs/CONFORMITE.md` §3.1,
  mais aucun mécanisme automatique ne refuse un writer antérieur à v81. Un writer d'une version
  antérieure **ignore** la table de barrières : c'est à l'exploitant de vérifier qu'il n'en tourne plus
  avant de poser `enforce`.
- **Déployé et activé le 18/09/2026.** `migration-v81.sql` est appliquée sur Neon (10:16), la console
  et les trois services Railway tournent sur `b06a5ce`, et `privacy_barrier_mode` vaut `enforce` pour
  les **sept** applications du registre. Aucune barrière n'est encore posée : l'activation ne change
  donc rien au trafic, elle rend la protection réelle au prochain effacement demandé.

## La décision de politique, prise le 18/09/2026

**« Conserver les barrières sans expiration. »** C'est la première des trois formulations proposées :
la garantie la plus forte, au prix de conserver indéfiniment un identifiant pseudonyme par personne
effacée. Elle a été retenue parce qu'une expiration ne garantirait rien contre une restauration plus
ancienne qu'elle — et qu'une garantie qu'on ne peut pas tenir vaut moins que pas de garantie.

Le code n'a rien demandé de plus : `expires_at` est nullable et reste `NULL`. L'activation a consisté
en une seule instruction, après avoir vérifié qu'aucun writer antérieur à v81 ne tourne (les trois
services Railway sont sur `b06a5ce`, qui contient v81) :

```sql
update app_registry set privacy_barrier_mode = 'enforce' where privacy_barrier_mode = 'off';
-- app-a, app-b, demo-app, gip-plateforme, insight-performance, mip-rum-console, test
```

Les sept applications sont activées ensemble, délibérément : une application laissée à `off` n'aurait
silencieusement aucune protection, et c'est le pire des états — on croirait le produit protégé.

### Ce qui est tranché, et n'attend plus rien

- la barrière **est** une donnée pseudonyme — elle retient l'identifiant effacé pour pouvoir le
  refuser. On ne prétend pas le contraire ;
- `expires_at` vaut `NULL` : aucune expiration, conformément à la décision ;
- **aucune voie de réactivation n'existe** : ni fonction SQL de levée, ni drapeau du SDK, et un test le
  vérifie. Les identifiants de session effacés restent refusés pour toujours, même si la politique
  autorise un jour l'identité à reprendre avec de **nouveaux** identifiants.

### Ce qui reste ouvert, et que l'activation ne referme pas

1. **Reprise de collecte autorisée après un effacement** : par quelle opération, par qui, avec quelle
   trace ? Rien n'est implémenté, et l'activation ne crée aucun besoin urgent — mais la question se
   posera à la première personne qui demande son effacement puis revient.
2. **Restaurations de sauvegarde** : une restauration PITR antérieure à un effacement doit rejouer les
   barrières **avant** de rouvrir lectures et ingestion. Cette procédure n'est ni écrite ni éprouvée.
   **Tant qu'elle ne l'est pas, la garantie ne porte pas sur les sauvegardes** — l'activation ne change
   rien à cette limite, et il serait malhonnête de laisser croire le contraire.
3. **Preuve sous trafic réel** : aucun événement n'est arrivé depuis le 17/09 17:23, et aucun
   effacement n'a été demandé depuis l'activation. Le protocole est prouvé par 17 tests de concurrence
   sur PostgreSQL, pas par la production.

## Suivis consolidés — P8.1

- **Commentaires de triage** : un scrub assisté (l'opérateur voit les commentaires d'issues touchées par
  un effacement et décide) serait le prolongement naturel ; il n'est pas livré.
- **Rejeu et clients historiques** : un rejeu différé côté serveur (tampon borné en attente de l'ancre)
  éviterait la perte de chunk sous `enforce` ; il conserverait le corps, ce que le contrat refuse
  aujourd'hui. À instruire avec la politique.
- **Version de protocole des writers** : un en-tête ou une colonne de registre annonçant la version
  minimale acceptée fermerait le dernier « vieux writer » possible. Non livré.
- **Backfills (P8.2)** : livré. L'outillage utilise `withAppIngestTransaction` et reconsulte les
  sources dans chaque transaction ; voir la section ci-dessous.

## P8.2 — outillage de backfill et dry-run

Branche `feat/rum-backfill-p8-2`, PR #208. Migration **v83** (v81 est prise par P8.1, v82 par P7.5).

**Aucun backfill n'a été exécuté.** Ce lot livre l'outil, ses tests et son dry-run. L'exécution
historique est P8.3, et elle exige un périmètre app / fenêtre / charge que personne n'a choisi.

### Ce que l'outil est, en une phrase

`scripts/backfill-rum.mjs` — six sous-commandes, quatre reconstructions, une application explicite,
deux bornes UTC obligatoires, un plan signé, un journal en base, et un `verify` qui ne croit pas le
runner sur parole.

```sh
node scripts/backfill-rum.mjs plan   --kind event-index --app <app> --from <UTC> --to <UTC> [--batch 100..5000] [--out plan.json]
node scripts/backfill-rum.mjs apply  --plan-id <uuid> --plan-sha <sha256> [--max-lots N]
node scripts/backfill-rum.mjs status --run-id <uuid>
node scripts/backfill-rum.mjs pause  --run-id <uuid>
node scripts/backfill-rum.mjs resume --run-id <uuid> --plan-sha <sha256>
node scripts/backfill-rum.mjs verify --run-id <uuid>
```

La connexion se lit dans **`BACKFILL_DATABASE_URL`**, jamais dans `DATABASE_URL`. La seconde désigne
la production partout ailleurs dans le dépôt : un outil qui la prendrait par défaut finirait un jour
par réécrire la production parce que quelqu'un avait la variable dans son terminal. L'opérateur nomme
la base qu'il vise, une fois, exprès. Sa valeur n'est jamais affichée.

### Décisions d'implémentation, et leur raison

- **Aucun parseur n'est recopié.** `event-index` rappelle `buildEventIndex` sur des lignes relues en
  base ; `dimensions` rappelle `clientDimensions` ; `error-groups` rappelle `errorGrouping`,
  `creerIssues`, `groupesHistoriques`, `finaliserIssues` et `importerNotesHistoriques`. La preuve
  n'est pas le commentaire, c'est le test : on laisse `writeRows` écrire la projection, **on la
  relève, on l'efface, on lance la reprise, et on compare ligne à ligne**. Une copie de vieux parser
  échouerait là.
- **Le plan est une lecture.** Un test compare l'empreinte `md5` des quinze tables RUM avant et après
  les quatre `plan` : identiques. Le seul objet écrit est une ligne de `backfill_run`.
- **La fenêtre tient dans la rétention RÉELLE.** `app_registry.retention_days` d'abord, le défaut de
  `purge_rum_tenants` ensuite, et la provenance est dite. Une fenêtre qui déborde est **refusée**, en
  nommant la borne basse admissible — reconstruire ce que la purge de la nuit va effacer serait au
  mieux inutile, au pire une résurrection. Séparément, le plan rapporte la plus ancienne et la plus
  récente ligne **réellement présente** par table : après une purge, une fenêtre peut être dans la
  rétention et pourtant vide, et confondre les deux fait promettre une reconstruction sur des données
  qui n'existent plus.
- **`exact` est un mot qui s'achète.** Chaque compte passe par `EXPLAIN` : sous un coût de 2 000 000,
  comptage exact ; au-delà, **échantillon de 24 heures tirées au sort**, extrapolé, avec un intervalle
  à 95 % (approximation normale, correction de population finie) — et la méthode est portée par le
  compte lui-même, pas par une note de bas de page. La méthode globale d'un `kind` est la **pire** de
  ses méthodes par table : dire « exact » parce que sept tables sur huit l'étaient serait un mensonge
  par moyenne.
- **Un identifiant de séquence n'est pas un ordre de commit.** Le plan relève une borne haute par
  table et par ordre de clé ; le runner parcourt la fenêtre sous cette borne (phase `fenetre`), **puis
  recommence sans borne** (phase `reconciliation`). Le drain n'est pas espéré : la réconciliation
  tourne **sous le verrou d'application de P8.1**, et tenir ce verrou signifie qu'aucun writer n'écrit
  sur cette application — donc que les écritures en vol au moment du plan sont toutes validées et
  visibles. C'est la seule preuve de drain qu'on ait, et elle est écrite là.
- **Le point de reprise est dans la transaction du lot.** Écrit après le commit des lignes, une panne
  entre les deux rejouerait un lot ; écrit avant, elle en sauterait un. Un test **fait échouer l'ordre
  de checkpoint lui-même** : l'exécution passe en `failed`, le curseur ne bouge pas, la table cible est
  vide, et la reprise écrit chaque ligne **une** fois.
- **Une reprise exige le même plan ET le même code.** Le plan n'est pas relu d'un fichier : il est
  **recalculé** depuis ce que le journal a retenu (périmètre, bornes, taille de lot, rétention) plus
  les empreintes de code et de schéma relevées maintenant. `code_sha` couvre les six modules de reprise
  **et** les normalisateurs qu'ils réutilisent (`otlp.mjs`, `dimensions.mjs`, `error-normalize.mjs`,
  `scrub.mjs`, `error-grouping.mjs`, `error-issue-workflow.mjs`) : si la règle de reconstruction
  change, la seconde moitié d'une fenêtre ne peut plus être traitée autrement que la première. Trois
  refus distincts : `plan_sha_discordant`, `code_modifie`, `plan_modifie`.
- **L'empreinte de plan est canonique.** `jsonb` range les clés par longueur puis par octets, pas par
  ordre d'insertion : sans un JSON à ordre stable, l'empreinte recalculée à la reprise aurait
  **toujours** différé, et aucune reprise n'aurait jamais été possible. Un test unitaire joue
  l'aller-retour.
- **Une seule exécution vivante par périmètre, un seul travailleur par application** — posé par deux
  index uniques partiels en base, pas par une convention de code que deux processus lancés à une
  seconde d'intervalle ne verraient pas.
- **`failed` se reprend, `completed` non.** Une panne — verrou indisponible, connexion coupée — n'a pas
  invalidé le travail déjà fait : le curseur d'une exécution en échec désigne un état cohérent,
  puisqu'il est atomique. Ce qui ne se reprend pas, c'est une exécution terminée (rien à reprendre) ou
  une exécution qui tourne (deux curseurs sur la même fenêtre).
- **La symbolication reste hors transaction.** `error-groups` lit les source maps dans une étape
  `preparer`, sans verrou — charger plusieurs mégaoctets sous le verrou d'application ferait attendre
  toute l'ingestion de cette application. Son résultat voyage **par identifiant de ligne**, jamais par
  position dans un tableau : la relecture sous verrou peut avoir perdu des lignes (effacement DSAR
  entre-temps), et un tableau indexé se serait décalé en silence — la pile d'une personne sur l'erreur
  d'une autre. C'est exactement la correction déjà payée par `appliquerSymbolication` en P8.1.
- **Les sources sont relues dans CHAQUE transaction.** C'est la couture avec P8.1 : réinsérer depuis
  une copie en mémoire lue avant un effacement ressusciterait ce que P8.1 vient de supprimer, et
  annulerait le lot précédent.

### Bogue trouvé en chemin, dans le code de ce lot

**Un prédicat non parenthésé s'échappait de l'application.** Le compte des lignes « sans identifiant de
source » s'écrivait `… where app_id = $1 and ts >= $2 and ts < $3 and not (valide) or span_id is null`.
`and` lie plus fort que `or` : PostgreSQL lisait `(app_id and ts and not valide) or (span_id is null)`,
et le compte ramassait les lignes sans span **de tous les autres locataires et de toute la base**. Le
test l'a pris en flagrant délit — il comptait 3 là où la fenêtre en contenait 2. Corrigé, et un test
insère désormais une ligne sans identifiant **chez le voisin** pour que la régression ne puisse pas
revenir. Les autres `or` du lot ont été audités un par un.

### Ce que chaque `kind` reconstruit, et ce qu'il refuse de reconstruire

| Kind | Reconstruit | Refuse, et le dit |
|---|---|---|
| `event-index` | `buildEventIndex` sur les huit tables sources ; taxonomie, route bornée, dimensions et identités de la LIGNE source | `span_id` absent ou invalide → **skip compté**, jamais d'identifiant inventé ; source purgée → rien à projeter ; métadonnée jamais conservée (env/release d'un fil d'Ariane, par exemple) → reste `NULL` |
| `rollups` | `rum_rollup_hourly` et `metric_histogram_hourly` recalculés par heure, **`sum(occurrences)`** et non `count(*)`, bucket vidé puis réécrit atomiquement, marques d'invalidation levées sous le verrou | sources purgées → **agrégat restant CONSERVÉ**, jamais remplacé par zéro ; occurrences jamais envoyées par un vieux SDK → irrécupérables ; **moyenne de p75 interdite** |
| `dimensions` | `browser`/`os` des sessions depuis l'user-agent **stocké** ; `env`/`release`/`service` de la projection depuis la **ligne source qu'elle projette** (vraie clé unique, pas une inférence) | release ou env d'anciennes lignes de signal → **inconnu reste inconnu** ; robots et sessions sans user-agent → inconnus ; **`device_type` n'est pas touché** — c'est une CLÉ d'agrégat, la réécrire déplacerait des heatmaps historiques sans les recalculer |
| `error-groups` | clé v2 en ombre sur tout l'historique ; issues `migration` si l'app a activé le regroupement ; alias des anciennes empreintes avec leur statut ; notes transférées une fois, avec provenance | **aucune notification** `new` ni `regression` ; statuts divergents → `for_review`, jamais une fusion silencieuse ; statut posé par un humain jamais écrasé ; pas d'assignation ni de lien historiques à transférer (le triage v40 n'en portait pas) |

**Les deux verrous qui ferment les notifications**, et pourquoi ils sont explicites plutôt
qu'incidents : `creerIssues` reçoit `origineForcee: 'migration'` — le déclencheur
`error_issue_notify_new_v73` ne se déclenche que sur `origin = 'new'` — et `finaliserIssues` est appelé
avec `regression: false`. S'en remettre au fait qu'un groupe historique existe toujours serait un
invariant qu'on ne contrôle pas. Un test compte les notifications avant et après : **zéro ajoutée**.

**Percentiles.** `fusionHistogrammesPossible` / `fusionnerHistogrammes` sont purs et testés seuls :
deux histogrammes ne se fusionnent que si le pas géométrique, le plancher **et** la population sont
identiques ; alors on additionne les **effectifs par seau**, et le percentile de la somme est exact.
Sinon, l'opération est **déclarée impossible** — pas approchée, pas pondérée, pas moyennée.

### Ce que P8.2 a changé dans le code de P5, et pourquoi

- `error-grouping.mjs` : `groupesHistoriques`, `issuesExistantes` et `creerIssues` deviennent exportés,
  et `creerIssues` prend `{ origineForcee }`. **Réutiliser** la création d'issues de P5.5 vaut mieux
  qu'en écrire une seconde qui dériverait.
- `error-issue-workflow.mjs` : `importerNotesHistoriques` préfixe désormais la note d'un groupe
  historique **scindé** par `ENTETE_HERITEE`. Une note écrite en 2024 sur un groupe réparti en trois
  issues n'est le diagnostic d'aucune des trois ; recopiée telle quelle, elle se lit comme tel, et un
  opérateur refermerait deux issues sur la foi d'une analyse qui ne les concernait pas. Le changement
  vit dans la fonction PARTAGÉE, pas dans une variante du backfill : le travail planifié
  (`jobs/planifie.mjs`) transfère les mêmes notes, et deux comportements auraient divergé.
- `tests/unit/{sourcemap-migration-v71,error-grouping-v2}.test.ts` : le garde-fou « toute redéfinition
  emporte cette table » est désormais **ancré en début de ligne**, et une assertion nouvelle exige
  qu'une redéfinition non recopiée parte de `prosrc`. Voir ci-dessous.

### Migration v83, et pourquoi elle ne recopie pas `erase_app_data`

`backfill_run(id, kind, app_id, from, to, source_cutoffs_json, plan_sha, code_sha, state,
checkpoint_json, scanned, written, skipped, failed, started_at, updated_at, ended_at, error_code)`,
états `planned|running|paused|completed|failed`, RLS `tenant_scope` app-scopée, `console_ro` en lecture
seule, `anon`/`authenticated` révoqués. Deux index uniques partiels : un par (app, kind, fenêtre) sur
les états vivants, un par application sur `running`.

Le journal ne contient **aucun extrait de télémétrie** : ni message, ni pile, ni identifiant de
personne, ni route. `error_code` est contraint à `^[a-z][a-z0-9_]{0,59}$` — un message PostgreSQL peut
citer la valeur d'une ligne. Un test relit la ligne de journal entière et vérifie qu'elle ne contient ni
l'adresse de la personne, ni le message d'erreur, ni l'identifiant de session de la fixture.

**`erase_app_data` vide `backfill_run`** — et la ligne est **insérée dans la définition courante**,
pas recopiée :

```sql
select p.prosrc into src from pg_proc p … where p.proname = 'erase_app_data';
if position('from backfill_run ' in src) > 0 then return; end if;   -- rejouable
if (occurrences de l'ancre) <> 1 then raise exception …; end if;    -- échec bruyant
execute 'create or replace function erase_app_data(p_app_id text) …'
     || quote_literal(replace(src, ancre, ajout));
```

Recopier une fonction de cent lignes pour y ajouter un `delete` est **exactement** le geste qui a fait
perdre `analytics_saved_view` et `dashboard` entre v79 et v80 : deux fichiers écrits en parallèle,
fusionnés sans conflit déclaré, et le second reprend la définition d'avant le premier. Or v82 (P7.5)
s'écrit en parallèle de ce fichier. La forme choisie part du corps **en place, quel qu'il soit**, et
échoue bruyamment si le point d'insertion n'est pas trouvé exactement une fois — elle ne peut donc rien
perdre. Les deux garde-fous de v71 et v72 ont été adaptés pour reconnaître cette forme **sans
s'affaiblir** : ils visent les recopies, et exigent désormais qu'une redéfinition non recopiée parte de
`prosrc`.

### Preuves chiffrées

Locales, 18/09/2026, PostgreSQL 15.18 en conteneur (aarch64, port 5433), bases jetables créées et
supprimées pour l'occasion. **Rien n'a touché la production ; `DATABASE_URL` n'a été ni lu ni employé
par le code livré.**

- `pnpm exec vitest run tests/unit --exclude '**/.claude/**'` : **163 fichiers, 2 281 tests verts**
  (référence master : 162 / 2 248) — soit +1 fichier (`backfill-p82.test.ts`, 31 tests) et +2 tests de
  garde dans les fichiers de v71 et v72. Aucun test existant perdu.
- `pnpm test:sql` : **22 fichiers, 314 tests verts, 26 ignorés** (24 fichiers au total, 2 ignorés faute
  de leurs bases dédiées : le banc P6.6 et la fenêtre v65). Le nouveau
  `tests/integration/backfill-idempotency-sql.test.ts` en apporte **52**.
- `pnpm test:isolation`, `pnpm test:alerting` : verts sur bases dédiées.
- `pnpm --filter console exec tsc --noEmit` : vert. `pnpm -r build` : vert.
- Migration v83 appliquée **deux fois de suite** sur une base neuve (idempotente, et la ligne ajoutée à
  `erase_app_data` ne se double pas) et sur un schéma **v82** (fenêtre de déploiement, suite dédiée
  `SQL_TEST_PRE_V83_DATABASE_URL`).

#### Les preuves pré-production de §3, une par une

| Preuve exigée | Où | Ce qui est prouvé |
|---|---|---|
| Deux exécutions → même état, ni quota ni alerte ajoutés | `backfill-idempotency-sql.test.ts` | Empreinte `md5` de la table cible identique après la seconde passe, pour les quatre `kind`. `meter_tenant_usage` rejoué : `events`/`sessions`/`errors` inchangés ; `alert_event` et `error_issue_notification` inchangés |
| Arrêt après un lot, puis reprise | idem | `--max-lots 1` → `paused`, écriture partielle ; la reprise produit **exactement** la projection du chemin vivant |
| Interruption ENTRE l'écriture et le point de reprise | idem | L'ordre de checkpoint est **fait échouer** : `failed`, `error_code = sqlstate_xx000`, curseur `{}`, table cible **vide** ; la reprise écrit chaque ligne une fois |
| Identifiant de source nul | idem | 2 lignes sans span → `id_source_nul = 2` au plan, `span_id_invalide = 2` par phase, et **aucune** ligne de projection dont l'identité ne soit un span 16 hex |
| Date limite de purge | idem | Plan **refusé** (`fenetre_hors_retention`) en nommant la rétention lue (« 7 j », `app_registry.retention_days`) et la borne admissible ; côté runner, une ligne qui a franchi la limite pendant la reprise est un skip `hors_retention` |
| Source disparue après le plan | idem | `erase_session` entre le plan et l'exécution : moins de lignes écrites qu'annoncé, zéro ligne pour la session effacée, `verify` rend `restant = 0` |
| Même identifiant dans une autre app | idem | Le voisin n'est ni lu ni écrit (empreinte `md5` inchangée) ; et une ligne sans span **chez le voisin** ne compte pas dans le plan |
| Histogramme incompatible | `backfill-p82.test.ts` + SQL | Pas géométrique, plancher ou population différents → `{possible: false, raison}` ; identiques → addition des effectifs par seau |
| Tests de concurrence P8.1 réutilisés | `backfill-idempotency-sql.test.ts` §8 | **Pour les quatre `kind`** : l'effacement tient le verrou, la reprise **attend** (condition lue dans `pg_locks`, aucun `sleep`), aucun interblocage, aucune résurrection, barrières posées |
| `verify` indépendant du runner | idem §7 | Rend côte à côte les compteurs du runner **et** une vérification faite depuis les tables ; voit un trou creusé après coup que les compteurs ignorent ; compte les projections orphelines sans les imputer à la reprise |

#### Recette manuelle de la CLI

Base jetable `p82_cli`, 40 sessions synthétiques (40 vues, 40 mesures, 40 erreurs à 4 occurrences,
40 ressources), projection effacée pour simuler un historique antérieur à v65 :

| Commande | Résultat observé |
|---|---|
| `plan --app all` | `échec [app_globale_refusee]` |
| `plan` sans `--app` | `échec [option_obligatoire] : --app est obligatoire` |
| `plan --kind event-index` | 160 éligibles (méthode `exact`), 0 déjà présentes, 0 sans identifiant, rétention 30 j depuis `app_registry.retention_days`, 60 index relevés, 2 lots estimés, espace `null` + `table_vide_ou_jamais_analysee` (la table cible est vide : **aucune largeur observable, donc aucun chiffre inventé**) |
| `apply --max-lots 1` | 40 lues, 40 écrites, état `paused` |
| `status` | périmètre, bornes hautes par table, curseur, compteurs |
| `pause` sur une exécution déjà en pause | `échec [transition_refusee]` |
| `resume` | 15 lots, 280 lues, 120 écrites, 160 `deja_presente` (la réconciliation repasse), `completed` |
| `verify` | `restant = 0` sur les huit tables, 160 projetées, 0 projection sans source |
| `resume` sur une exécution terminée | `échec [transition_refusee]` |

Les trois autres `kind` ont été planifiés sur la même base : `rollups` (1 heure éligible, unité
« cellule horaire », écart occurrences/lignes rendu), `dimensions` (0 éligible — le chemin vivant avait
déjà rempli les colonnes — et 200 déjà renseignées), `error-groups` (0 éligible, 40 déjà regroupées,
`regroupement_v2_actif` dit, carte de correspondance rendue).

### Écarts assumés, propres à P8.2

- **Aucun backfill n'a été exécuté, nulle part.** Ni en production, ni sur une branche Neon. Le lot
  livre l'outil et sa preuve sur données synthétiques.
- **`rum_rollup_hourly` sera recalculé avec une jointure de session APP-SCOPÉE**, alors que
  `refresh_rum_rollups` joint par `using (session_id)` seul. Sur des données où aucun identifiant de
  session n'est partagé entre deux applications — le cas normal — les deux calculs coïncident
  exactement. Là où ils divergent, c'est le rafraîchissement en place qui a tort ; le plan **signale la
  collision** (`session_partagee_entre_apps`) au lieu de la corriger en silence. Corriger
  `refresh_rum_rollups` lui-même est un autre lot.
- **La base `symbolicated_frame` d'une clé v2 n'est pas reconstituable sans la source map d'alors.**
  Le backfill rappelle le vrai symbolicateur ; sans map exacte, la clé retombe sur le chemin normalisé
  — une clé légitime, mais pas forcément celle qu'aurait produite l'ingestion du jour même.
- **Le plancher de durée annoncé par `plan` ne mesure que la LECTURE.** Un plan est en lecture seule :
  il chronomètre un lot de lecture et le dit (`calibrage_lecture_seule`). Le coût d'écriture, la
  contention du verrou d'application et le trafic concurrent ne seront mesurés que par le canari de
  P8.3.
- **Les compteurs du journal sont des totaux sur les DEUX phases.** Une ligne au span invalide est
  revue par la réconciliation et compte deux fois dans `skipped`. Le bilan rendu par le runner sépare
  les phases (`par_phase`) ; la colonne, elle, dit « lignes examinées », ce qui est exact.
- **Aucun écran de console.** Le journal se lit par la CLI (`status`, `verify`) et par SQL. Une surface
  d'exploitation dans `/admin` serait utile ; elle n'est pas livrée.

### Ce qu'un dry-run révélerait, pour préparer P8.3

**Aucun chiffre de production n'a été relevé** — l'outil n'a jamais été pointé vers la production, et
c'est délibéré. Voici ce qu'un `plan` rendrait, application par application, pour que le périmètre
puisse être choisi :

1. **Quelles applications sont candidates** — `select app_id from app_registry` donne la liste ; le
   plan doit être relancé pour chacune, `all` étant refusé. Le seul ordre de grandeur documenté dans ce
   dépôt reste « 5 erreurs ingérées au total en production au 17/09/2026 » (`delivery-p5.md`) : si
   l'ordre de grandeur est toujours celui-là, les quatre reprises sont des opérations de quelques
   secondes et la question du créneau ne se pose pas.
2. **Quelle fenêtre est admissible** — la borne basse est `now() - retention_days` de CETTE
   application, et le plan la refuse en dessous. La fenêtre utile est bornée par le haut par la date de
   la migration qui a comblé le trou : v65 pour `event-index`, v64 pour `rollups`, v75 pour
   `dimensions`, v72 pour `error-groups`. Une reprise au-delà de ces dates ne trouverait rien à faire.
3. **Quels volumes** — `comptes.eligibles` par `kind`, avec sa méthode, plus
   `retention.donnees_reellement_presentes` qui dit la plus ancienne ligne restante par table. Les deux
   ensemble répondent à « y a-t-il encore quelque chose à reconstruire ». Il est parfaitement possible
   que la réponse soit non : si la rétention de 30 jours a déjà emporté tout ce qui précède v75, il
   **n'y a rien à reprendre**, et le dry-run le dira en une ligne.
4. **Ce qui ne sera pas reconstruit** — `comptes.id_source_nul`, `comptes.sources_purgees` et
   `impossible` chiffrent la fraction impossible avant l'opération, pas après.
5. **Quelle charge** — `charge.lots_estimes`, le plancher de lecture, l'espace attendu (ou `null` quand
   la table cible est vide et qu'aucune largeur n'est observable).

La décision qui manque à P8.3 est donc : **quelle application, quel `kind`, quelle fenêtre UTC, et
quand**. Elle ne peut pas être prise ici, et un `plan` sur la production est le préalable — c'est une
lecture, mais elle vise une base que personne ne m'a demandé d'atteindre.

## P8.6 — connecteur de tickets, GitHub Issues d'abord

Branche `feat/rum-tickets-p8-6`, PR #211. Migration **v84** (v81 = P8.1, v82 = P7.5, v83 = P8.2).

### La décision, et sa réserve écrite noir sur blanc

**GitHub Issues**, pour une raison d'opportunité et pas de conviction : le dépôt y est déjà,
l'authentification existe, aucun compte ni coût nouveau, et c'est le seul fournisseur qu'on puisse
éprouver de bout en bout aujourd'hui. Ce n'est pas la destination.

La phrase suivante est une constante unique du code (`MENTION_ETAPE`, `adapter.mjs`), affichée à
l'écran d'administration, sur l'écran d'une issue, **et recopiée dans le corps de chaque ticket
créé** :

> GitHub Issues est l'implémentation actuelle du connecteur de tickets. La cible reste l'outil ITSM
> de MIP — ServiceNow, sous réserve de confirmation.

La réserve est écrite telle quelle, à dessein : **personne n'a confirmé ServiceNow**. L'information
vient du dialogue produit (« je crois c'est ServiceNow »), et une documentation qui affirme plus que
ce qu'on sait est un piège pour celui qui la lira dans six mois. Un test unitaire vérifie que les
trois mots — « GitHub Issues », « ServiceNow », « sous réserve de confirmation » — sont bien là.

### Ce que le connecteur garantit

- **Le lien manuel de P5.6 continue de fonctionner sans connecteur.** `error_issue_ticket` gagne
  `provider`, `external_id`, `integration_id`, `origin` et `provider_state`, toutes nullables ou à
  défaut `manual` : une ligne existante reste valide, et un test le prouve sur une app qui n'a
  **aucune** intégration configurée. Les tickets du connecteur arrivent dans la **même** liste, pas
  dans une seconde table de liens « automatiques ».
- **L'aperçu n'est pas un aperçu.** Le titre, la description et le lien affichés avant le clic sont
  le résultat du **même appel** à `construireCharge` que celui qui fige la charge dans la file de
  sortie, sur la **même lecture** de l'issue. `expectedRevision` ferme la fenêtre restante : si
  l'issue change entre l'affichage et la demande, c'est un `409`, pas un envoi différent de ce qui a
  été montré.
- **Charge minimale.** Message scrubbé, application, release de première et de dernière vue,
  compteur **observé** (annoncé comme « somme des répétitions réellement reçues »), lien console. La
  pile d'appels et les identités restent dans MIP — et le ticket **dit** qu'elles n'y sont pas, pour
  qu'un lecteur ne croie pas leur absence fortuite. Une donnée manquante s'écrit « Inconnue », jamais
  `0`.
- **Aucun dépôt déduit.** `target` est saisi et confirmé à la configuration (`owner/repo`). Rien ne
  lit le remote git de MIP ; six formes approchantes (`bac`, `moi/`, une URL complète…) sont refusées
  avec un message qui dit « rien n'est déduit ».
- **Le secret n'est jamais en base.** `credential_ref` ne peut contenir que `env:NOM_DE_VARIABLE` ou
  `enc:v1:<chiffré AES-256-GCM par TICKET_SECRET_KEY>`, et c'est une **contrainte de schéma** qui
  l'impose, pas une convention : un `ghp_…` collé dans ce champ fait échouer l'écriture. L'API ne rend
  jamais la référence — elle rend sa **forme**, et pour une variable son **nom**. `console_ro` n'a
  même pas le droit de lire la colonne (`grant select (…)` explicite, vérifié par
  `has_column_privilege`).
- **Un seul ticket, quoi qu'il arrive.** La clé d'idempotence est déterministe
  (`ticket:<intégration>:<issue>`) et unique en base : deux clics, deux onglets, un rejeu du `202`
  retombent sur la même ligne.
- **Le timeout après création est traité comme il doit l'être.** La ligne est marquée « incertaine »
  **avant** l'appel ; après une coupure, le connecteur **cherche le ticket par la référence MIP**
  portée dans son corps avant tout nouvel envoi. Trouvé → il est adopté. Absence **prouvée** (la
  fenêtre relue couvre la demande) → nouvelle tentative sûre. Recherche non concluante →
  `delivery_uncertain`, terminal, **un opérateur tranche**. Aucun chemin ne recrée un ticket après une
  incertitude, et trois tests le vérifient en comptant les `POST` réellement partis.
- **Webhook signé par le mécanisme OFFICIEL de GitHub** : HMAC-SHA256 du corps **brut** annoncé dans
  `X-Hub-Signature-256`, comparé à **temps constant**, taille bornée (1 Mio), identifiant de livraison
  obligatoire et **unique en base** — c'est là qu'est la protection contre le rejeu, GitHub ne
  fournissant ni horodatage signé ni nonce, et on n'en invente pas. La route n'accepte **aucun
  cookie** de session (elle refuse en `400` une requête qui en porte), ne renvoie **aucun détail RUM**
  (`{ ok: true }`), et rend le même `404` pour une intégration inconnue et pour une intégration hors
  service : elle n'est pas un oracle.
- **MIP reste source de vérité pour `ignored`.** Une issue ignorée n'est jamais modifiée par le
  fournisseur. Les autres statuts ne bougent que selon un mapping **explicitement configuré** ; sans
  mapping, un ticket fermé ne change rien — seul l'état distant est noté sur le lien.
- **Pas d'oscillation possible.** MIP n'écrit chez le fournisseur qu'à la **création** ; aucun
  changement de statut MIP n'est poussé. Et un événement qui propose l'état **courant** ne déclenche
  rien, tandis qu'une livraison rejouée n'écrit rien (clé d'événement = identifiant de livraison).
- **Révocation de jeton = `degraded`, jamais un blocage.** Un `401`, un `403` sans quota, un `404` de
  cible ou un secret absent du runtime font passer l'intégration en `degraded` et rien d'autre : un
  test écrit un lot par le **vrai** `writeRows` juste après, et la collecte passe.
- **Viewer, démo et jetons `CONSOLE_API_TOKENS` : lecture seule.** `handleMutation` refuse le jeton en
  `403` avant toute chose — c'est la règle qui compte le plus ici, puisque l'écriture **sort du
  produit**. Le périmètre est revérifié **après** résolution de la ressource, pour l'intégration comme
  pour l'issue : deviner un entier ne doit pas permettre d'activer le connecteur d'un autre client.
- **La surface de configuration reste cachée** tant qu'aucun fournisseur n'est branché et testé :
  `TICKET_INTEGRATIONS=1` ouvre la porte, ou la présence d'une intégration déjà **vérifiée** en base.
  L'entrée de la barre latérale et la page appliquent la même décision, et la page rend un `404` — un
  lien caché n'est pas une autorisation. Sur une issue, le formulaire n'apparaît que s'il existe une
  intégration **activée, non dégradée et éprouvée** pour cette app : proposer un bouton qui ne marche
  pas est pire que ne rien proposer.

### Décisions d'implémentation, et leur raison

- **Une outbox, et c'est le MÊME mécanisme que celui de P5.6** : état, tentatives, `next_attempt_at`,
  réservation par `for update skip locked`, étape du tick planifié (`jobs/planifie.mjs`, donc
  scheduler Railway **et** route cron). Pas un second planificateur : deux boucles de livraison
  divergeraient, et la seconde n'aurait pas les cicatrices de la première (pooler, verrous de session,
  passes concurrentes, échéance).
- **La tentative est comptée et le recul armé AVANT l'appel réseau, et validés.** Si le processus
  meurt pendant l'appel, la ligne revient d'elle-même après le recul, avec `uncertain` déjà posé.
  Armer après coup laisserait une ligne rejouée en boucle par la passe suivante.
- **Un délai d'attente par APPEL, pas un par ligne.** Un signal unique partagé aurait déjà expiré au
  moment de chercher le ticket après un envoi trop long — et la recherche qui empêche le doublon
  n'aurait jamais eu lieu. Défaut introduit puis corrigé pendant ce lot, et un test l'épingle.
- **`/search/issues` n'est JAMAIS utilisé.** Son index est à cohérence différée : un ticket créé il y
  a dix secondes peut n'y être pas encore, et lire cette absence comme une preuve recréerait le
  ticket. On relit la **liste** du dépôt — la donnée primaire — bornée à trois pages, et on ne conclut
  à l'absence que si la fenêtre relue couvre la demande. Un test vérifie qu'aucune URL appelée ne
  contient `/search/`.
- **`Retry-After` gagne sur le recul calculé**, même s'il est plus long : le fournisseur sait mieux
  que nous quand il acceptera d'être rappelé. Un recul plus long que l'attente demandée, lui, est
  conservé — on ne martèle pas.
- **La référence de résolution est PARTAGÉE.** `referenceResolution` descend de la console vers
  `ingest/lib/error-issue-workflow.mjs` : un fournisseur peut désormais résoudre une issue par
  webhook, et deux copies auraient donné deux verdicts de régression pour la même issue selon qui
  l'a fermée.
- **`last_error` est un CODE** (`^[a-z][a-z0-9_]{0,59}$`), jamais un message : un message de
  fournisseur peut citer la valeur d'une ligne. Même discipline que `backfill_run` en v83.
- **Une trame de pile collée dans le `message` est coupée.** On n'envoie jamais la colonne `stack`,
  mais un émetteur qui concatène message et pile dans le seul champ `message` la ferait sortir malgré
  tout. Les deux formes courantes (`    at X (f:12:3)` et `X@f:12:3`) coupent le message.
- **Aucune dépendance npm ajoutée.** L'API REST v3 suffit avec `fetch` ; Octokit aurait apporté
  quarante paquets transitifs pour trois requêtes.

### Deux défauts trouvés en chemin, dans le code de ce lot

1. **`Number(null)` vaut `0`.** `attenteDe` lisait `Retry-After` sans vérifier sa présence : sur une
   réponse **sans** en-tête, elle concluait « attends 0 seconde », donc « limite de débit » — là où il
   n'y avait qu'un **droit manquant**. Un `403` par jeton insuffisant serait resté rejouable pour
   toujours au lieu de dégrader l'intégration. L'en-tête est désormais lu en deux temps, présence puis
   valeur, et deux tests séparent les deux cas.
2. **PostgreSQL refuse `{16,4096}` dans une expression régulière** (plafond de répétition à 255) — et
   il le refuse **à l'évaluation** : la contrainte `ticket_integration_credential_v84` se serait créée
   sans bruit pour n'échouer qu'à la première écriture, en production. La borne haute est devenue un
   `char_length`. C'est le test de schéma qui l'a pris, pas la relecture.

### Migration v84, et pourquoi elle ne recopie rien

Trois tables — `ticket_integration`, `ticket_outbox`, `ticket_webhook_event` — plus six colonnes
nullables sur `error_issue_ticket`. RLS `tenant_scope` app-scopée sur les trois, `console_ro` en
lecture **colonne par colonne** sur la configuration (sans les deux références de secret),
`anon`/`authenticated` révoqués, aucune policy `using (true)`.

**Deux insertions dans des définitions courantes, jamais une recopie**, selon le geste de v83 :

- `erase_app_data` reçoit `delete from ticket_integration where app_id = p_app_id` — la file de sortie
  et le journal des livraisons partent **en cascade**, les liens de ticket partent avec leur issue.
  Ancre `return result;`, échec bruyant si elle n'apparaît pas exactement une fois, sortie anticipée
  si la ligne est déjà là.
- La contrainte `error_issue_activity_v73` est **relaxée sur place** pour accepter une ligne `status`
  posée par le système **à condition qu'elle porte une `event_key`** — cette clé est l'identifiant de
  livraison du fournisseur, et l'index unique de v73 fait donc qu'un webhook rejoué n'écrit rien une
  seconde fois. La relaxation part de `pg_get_constraintdef`, pas d'une copie du texte de v73.

v85 (P8.7) s'écrit en parallèle de ce fichier : c'est précisément le cas que cette forme protège, et
c'est ce qui avait fait perdre `analytics_saved_view` et `dashboard` entre v79 et v80.

**`DSAR_CHILD_TABLES` n'est PAS le bon endroit pour ces tables**, et c'est prouvé plutôt qu'affirmé :
un test interroge le catalogue et vérifie qu'aucune des trois ne porte de `session_id` — la règle
posée par P7.5. Le garde-fou catalogue de P8.1 passe, avec deux entrées ajoutées à sa liste de tables
conservées (`ticket_outbox`, `ticket_webhook_event`), justifiées par la cascade.

### Preuves chiffrées

Locales, 18/09/2026, PostgreSQL 15.18 en conteneur (aarch64, port 5433), bases jetables créées et
supprimées pour l'occasion. **`DATABASE_URL` n'a été ni lu ni employé.**

- `pnpm exec vitest run tests/unit --exclude '**/.claude/**'` : **165 fichiers, 2 367 tests verts**
  (référence master : 164 / 2 312) — soit +1 fichier (`ticket-connector-p86.test.ts`, **55 tests**) et
  aucun test perdu. Trois tests existants ont été **étendus**, pas contournés : la liste des étapes du
  tick, la liste des écritures documentées et le descripteur OpenAPI.
- `pnpm test:sql` : **24 fichiers, 366 tests verts, 32 ignorés** (3 fichiers ignorés faute de leurs
  bases dédiées). Le nouveau `tests/integration/ticket-connector-p86-sql.test.ts` en apporte **33**.
- `pnpm test:isolation` : vert sur base dédiée, avec **neuf assertions nouvelles** — les trois tables
  du lot vues par portée A, par portée B, par portée vide, et invisibles à `anon`/`authenticated`.
- `pnpm --filter console exec tsc --noEmit` : vert. `pnpm -r build` : vert.
- Migration v84 appliquée **deux fois de suite** sur une base neuve (idempotente : la ligne ajoutée à
  `erase_app_data` ne se double pas) et sur un schéma **v83** (fenêtre de déploiement), en vérifiant
  qu'`erase_app_data` conserve `backfill_run`, `analytics_saved_view` et `dashboard`.

### La recette RÉELLE, et où elle a eu lieu

**Un vrai ticket a été créé** : <https://github.com/jt33120/mip-rum-tickets-sandbox/issues/1>.

Le dépôt `jt33120/mip-rum-tickets-sandbox` est **privé, jetable, créé pour cette recette**, et
n'appartient à aucun client. Aucun ticket client n'a été créé, modifié ni fermé. Le jeton employé est
celui de la session `gh` de l'opérateur, **fourni à l'exécution** par une variable d'environnement et
jamais écrit dans le dépôt. Le jeton qui traîne dans des instructions globales n'a été ni recopié, ni
employé, ni considéré capable de créer un ticket.

| Vérification | Résultat observé |
|---|---|
| Existence et statut de retour | `201`, ligne d'outbox `state: sent`, `attempts: 1`, `last_error: null` |
| URL | `https://github.com/jt33120/mip-rum-tickets-sandbox/issues/1`, rendue par le fournisseur |
| Relecture (`getIssue`) | `200`, numéro 1, état `open` |
| Contenu | identique caractère pour caractère à l'aperçu affiché avant l'envoi |
| Non-fuite | l'adresse e-mail, le jeton factice et les deux trames de pile injectés dans le message sont **absents** du titre comme du corps (`[email]`, `[redacted]`, pile coupée) |
| Lien d'issue | `origin: connector`, `provider: github`, `external_id: 1`, `provider_state: open` |
| Journal d'activité | une ligne `link`, clé `ticket_cree:1:1` |
| Idempotence | seconde demande identique → **0 ligne insérée**, passe suivante → **0 envoi** |
| Recherche par référence MIP, contre la **vraie** API | trouve le ticket (`concluante: true`) ; référence inconnue → `concluante: true, trouve: null` |

### Écarts assumés — P8.6

- **Le webhook n'a jamais reçu de livraison d'un vrai fournisseur.** Il n'existe pas d'URL publique
  pour cette branche, et en fabriquer une n'était pas dans le périmètre. La signature est donc prouvée
  contre un **double fidèle** : le HMAC-SHA256 est calculé exactement comme GitHub le documente, sur
  le corps brut, et les tests couvrent le corps modifié d'un octet, la signature d'un autre secret,
  tronquée, non hexadécimale, absente, l'identifiant de livraison manquant et le dépassement de
  taille. **La recette réelle du webhook n'est pas jouée** ; c'est le premier écart à combler.
- **Aucune synchronisation de statut n'a donc été observée en vrai.** Le mapping, l'autorité de MIP
  sur `ignored`, le rejeu et l'absence d'oscillation sont prouvés en base, sur un vrai PostgreSQL,
  mais avec des charges fabriquées.
- **Migration v84 non appliquée en production**, connecteur non déployé, `TICKET_INTEGRATIONS` non
  posé : la surface reste donc invisible partout.
- **Un seul fournisseur.** Ni Jira, ni Linear, ni ServiceNow. L'interface les accueille, le lot n'en
  implémente qu'un — c'est la règle du plan, et un second fournisseur demande un choix explicite.
- **Aucune écriture MIP → fournisseur après la création.** Résoudre une issue dans la console ne
  ferme pas le ticket. C'est ce qui rend l'oscillation impossible dans ce lot ; c'est aussi une
  fonction en moins, et elle demandera d'instruire la boucle avant d'être ajoutée.
- **`delivery_uncertain` n'a pas d'écran de résolution.** Un opérateur voit l'état et sa raison sur
  l'issue, mais doit trancher en base (ou relancer la demande après avoir vérifié chez le
  fournisseur). Une action « j'ai vérifié, le ticket est / n'est pas là » serait le prolongement
  naturel ; elle n'est pas livrée.
- **La recette E2E Playwright n'a pas été jouée localement** (la base de développement est partagée
  avec un autre lot en cours) : la carte de tickets ne se rend qu'en présence d'une intégration
  vérifiée, donc l'écran d'issue est inchangé sans connecteur. La CI de la PR joue la suite complète.
- **Le dépôt bac à sable n'a pas été supprimé** : le jeton de la session `gh` ne porte pas le droit
  `delete_repo`. Il reste privé, et son unique ticket sert de preuve consultable.

### Brancher un second adaptateur — ce qu'il faudrait exactement

1. Écrire `apps/ingest/lib/integrations/tickets/<fournisseur>.mjs` avec les cinq fonctions du contrat
   (`createIssue`, `getIssue`, `chercherParReference`, `validateWebhook`, `normalizeWebhook`) et
   l'objet `adaptateur` qui les expose. `adapter.mjs` documente ce que chacune doit rendre, et
   surtout ce qu'elle doit **refuser** de rendre : `chercherParReference` doit répondre
   `concluante: false` dès qu'elle ne peut pas être **certaine**.
2. L'ajouter au registre `ADAPTATEURS` de `dispatcher.mjs` et à `PROVIDERS` dans `adapter.mjs`.
3. Ouvrir la contrainte `provider in ('github')` de `ticket_integration` et celle de
   `error_issue_ticket` (migration additive), et ajouter l'option au `<select>` de l'écran
   d'administration.
4. Adapter `MENTION_ETAPE` : quand l'ITSM de MIP sera branché, c'est cette constante — et elle seule —
   qui doit changer, et la phrase suivra partout, écrans et nouveaux tickets compris.
5. Rien d'autre. La file de sortie, l'idempotence, le backoff, la recherche après incertitude, le
   journal des livraisons, les écrans, les routes, l'effacement et les tests d'isolation sont
   indépendants du fournisseur. C'est tout l'intérêt d'avoir écrit l'interface maintenant.

**Ce qui manquera, en revanche, et qu'aucun code ne peut fournir** : l'espace cible et ses droits,
les champs obligatoires du formulaire de création de l'outil, l'URL publique du webhook, la politique
de synchronisation (quel statut distant vaut quoi dans MIP) et la liste des données autorisées à
sortir. Ce sont cinq décisions, pas cinq tickets.

## P8.7 — GeoIP optionnel

Branche `feat/rum-geoip-p8-7`. Migration **v85** (v81 = P8.1, v82 = P7.5, v83 = P8.2, v84 réservée
à P8.6, développé en parallèle).

### La décision, et ce qu'elle a exclu

**DB-IP Lite, base pays, embarquée** — licence CC BY 4.0, aucun compte, aucune clef, **aucun appel
réseau et aucun tiers destinataire**. La variante « appel à un fournisseur de géolocalisation »
aurait envoyé l'adresse IP **avant tout scrub MIP**, ce qui demandait une décision distincte. Elle
n'a pas été retenue, et rien dans ce lot n'ouvre ce chemin : il n'existe aucun `fetch` vers un
service de géolocalisation, à aucun moment de l'exécution.

Le seul accès réseau du lot est le **téléchargement du fichier de données**, une fois, à la
construction de l'image (`Dockerfile.backend`, vérifié par empreinte sha256). Ce n'est pas un appel
de géolocalisation : c'est un approvisionnement, et aucune adresse de visiteur n'y circule.

**La base « City Lite » est refusée par le chargeur**, et pas par accident : elle porte des
coordonnées et une subdivision administrative, exactement ce que ce produit a décidé de ne jamais
collecter. Le nom de fichier attendu commence par `dbip-country-lite-`.

### Décisions d'implémentation, et leur raison

- **Deux modules purs, une seule couche d'entrées/sorties.**
  `_shared/geoip.mjs` (analyse d'adresse, plages réservées, chargement du CSV, dichotomie),
  `_shared/client-ip.mjs` (d'où vient l'adresse) et `lib/geoip-db.mjs` (lecture du fichier). Les
  deux premiers n'importent rien de Node : ils restent testables, et portables là où le reste du
  `_shared` l'est déjà. **Aucune dépendance npm** n'a été ajoutée — une lecture de fichier et une
  recherche dichotomique suffisaient, comme le demandait le cadrage.

- **L'adresse ne vient QUE d'une façade déclarée, et le défaut ne lit rien.**
  `GEOIP_IP_SOURCE` vaut `none` tant qu'on ne l'a pas posée : un déploiement dont personne n'a
  décrit la façade ne doit pas deviner. Les modes : `socket` (la connexion), `railway`
  (`X-Real-IP`, **exigée avec un marqueur d'arête Railway** — sans lui, rien n'est lu), `xff:<n>`
  (`X-Forwarded-For` avec `n` relais de confiance, lu **n-ième en partant de la DROITE**). Le
  préfixe qu'un client écrit lui-même est donc ignoré par construction, jamais « nettoyé » après
  coup. Un `X-Real-IP` arrivé dupliqué est lu à sa **dernière** valeur : un relais ajoute après ce
  qu'il a reçu, donc la dernière est la seule qu'un autre que le client ait pu écrire.

- **Aucun cache de résolution, et c'est un choix.** La spec l'autorisait, borné et à TTL
  documenté. On n'en pose aucun : une dichotomie sur un tableau typé coûte **500 ns** (mesuré,
  200 000 résolutions en 100 ms), sans entrée/sortie. Un cache serait le SEUL endroit où une
  adresse survivrait à la requête qui l'a apportée — il faudrait alors le borner, l'expirer et
  prouver qu'il n'entre dans aucun journal. On préfère ne pas créer l'objet à protéger.
  Corollaire assumé : **il n'y a pas de « timeout de résolution »**, parce qu'il n'y a aucune
  attente. Ce cas de la spec appartenait à la variante fournisseur.

- **Les plages réservées sont écartées AVANT la base, et c'est indispensable.** Vérifié sur la
  livraison réelle de septembre 2026 : DB-IP range bien `10.0.0.0/8` en `ZZ`, mais il attribue
  **`fec0::/10` à « CH »**. Interroger la base en premier aurait donc donné un pays à une adresse
  de réseau interne. En IPv6 le raisonnement est inversé : seul `2000::/3` est de l'unicast global,
  et tout le reste est écarté — énumérer les exclusions aurait laissé passer les trous.

- **`ZZ` n'est pas un pays.** C'est le marqueur DB-IP des plages non attribuées ; il est chargé
  comme « inconnu » et ne peut jamais être persisté. Donnée inconnue = `null`, jamais un pays par
  défaut.

- **Une base absente, mal nommée, périmée, datée du futur, illisible ou non triée est REFUSÉE**,
  chaque fois avec une raison nommée (`geoip_db_absente`, `geoip_db_perimee`, `geoip_db_non_triee`…)
  et jamais une exception qui remonte. Un fichier non trié n'est pas réparé en silence : DB-IP en
  livre un trié, donc un fichier qui ne l'est pas a été tronqué, concaténé ou édité à la main.
  **Périmée = refusée, pas dégradée** (`GEOIP_MAX_AGE_DAYS`, 180 jours par défaut, soit six
  livraisons manquées) : les plages se réattribuent d'un pays à l'autre, et un pays périmé n'est
  pas une information — un pays inconnu en est une.
  **L'âge se lit dans le NOM du fichier**, jamais dans sa date de modification : une image Docker
  remet les dates à la construction, et `mtime` dirait qu'une base de mars est neuve.

- **Le chargement ne bloque rien.** Il est lancé au démarrage et dure ~1,1 s ; le serveur écoute
  pendant ce temps et `resoudre()` rend `null` jusqu'à la fin. Un lot reçu trop tôt garde son pays
  de fuseau — jamais une attente, jamais un rejet. `GET /health` annonce `etat`
  (`chargement`/`actif`/`eteint`), `version` et `raison`.

- **Chargement en deux passes, parce que la version naïve coûtait 240 Mio.** `split("\n")` puis des
  tableaux JavaScript convertis à la fin faisaient culminer le processus à 240 Mio résidents pour un
  index qui n'en pèse que 15 — 717 000 chaînes et autant de `BigInt` boîtés que V8 ne rend pas au
  système. On compte d'abord, on alloue exactement, on remplit ensuite : **pic 105 Mio, index
  15 Mio**. Une première version utilisait `lastIndexOf(":", borne)` pour deviner la famille d'une
  ligne : coût quadratique, et un chargement qui ne se terminait plus sur la vraie base — remplacé
  par un balayage du premier champ.

- **GeoIP prime sur le fuseau ; l'en-tête CDN reste en dernier.** C'est le seul changement de
  classement du lot, et il est demandé par la spec (« GeoIP précise l'approximation ») : sans lui,
  la base ne servirait presque jamais, le SDK web émettant toujours `mip.tz`. L'ordre
  `timezone` > `cdn` est en revanche **conservé tel quel**, pour ne pas déplacer des chiffres déjà
  publiés — rien dans P8.7 ne justifiait d'inverser un classement existant.

- **La provenance est posée DANS LE MÊME GESTE que le pays**, à l'ingestion comme à l'écriture. En
  base, `geo_source` ne change que si c'est le lot courant qui a posé `geo_country` :
  `case when rum_session.geo_country is null and excluded.geo_country is not null then … end`.
  Sans cette condition, une session dont le pays vient du fuseau se verrait étiquetée `geoip` au lot
  suivant, et le chiffre affirmerait une mesure qui n'a jamais eu lieu. **C'est aussi ce qui
  interdit de réécrire une ancienne session avec une adresse d'aujourd'hui** — prouvé en base ET en
  conteneur.

- **La provenance va jusqu'aux lectures.** `country_source` est une dimension à part entière du
  contrat P6.2 : filtrable et groupable partout où `country` l'est (segments `seg=v2:…`, Explorer,
  outil MCP), rendue « pas encore collectée » tant que v85 n'est pas appliquée. Elle n'est PAS un
  paramètre d'URL — le contrat en compte assez —, et son identifiant public ne nomme pas la colonne
  qui l'alimente (`geo_source`), comme `country` ne nomme pas `geo_country`. À l'écran : le détail
  de session affiche la provenance et la livraison sous le pays, la liste la porte en infobulle
  **et** en alternative textuelle, et la note du découpage par pays nomme les trois provenances.

### Migration v85 — deux colonnes, aucune table

Additive, rejouable, `set local lock_timeout = '5s'`, aucun backfill, aucun index (trois valeurs et
NULL n'en méritent aucun ; la justification est dans l'en-tête du fichier). Contrainte `NOT VALID`
aux bornes exactes de l'ingestion : les trois provenances et rien d'autre, une version de base
**seulement** avec `geoip`, une version au format `dbip-country-lite-AAAA-MM`, et **aucune
provenance sans pays**.

**Ni `erase_app_data` ni `purge_rum_app` ne sont recopiées — elles ne sont pas même touchées.**
Deux colonnes sur `rum_session`, qui est l'ANCRE du périmètre DSAR : un `select *` l'exporte, un
`delete` l'emporte, la purge et les deux effacements aussi. Le piège payé entre v79 et v80 ne se
pose pas ici parce qu'il n'y a rien à insérer dans une définition existante.

**Aucune entrée à ajouter à `DSAR_CHILD_TABLES`**, et c'est prouvé plutôt que supposé : le test
compare la liste au catalogue des tables portant un `session_id`. Une table `rum_session_geo` aurait
dû y figurer sous peine d'un export art. 15 incomplet et d'un effacement art. 17 partiel — c'est
exactement ce qui est arrivé à `rum_log` en P5.3. La plus petite migration qui dit la vérité est
celle qui n'ajoute pas ce qu'il faudrait ensuite rattraper.

### Où vit la base, et pourquoi elle n'est pas dans le dépôt

La livraison réelle pèse **4,5 Mio compressés** (31,7 Mio en clair, **717 170 plages** : 357 325 en
IPv4, 359 845 en IPv6) et DB-IP en publie **une par mois**. Le dépôt entier pèse 9,9 Mio : une
livraison mensuelle versionnée le ferait grossir de ~54 Mio par an, **définitivement** — git
n'oublie pas —, pour une donnée qui se périme.

Ce qui est versionné : `apps/ingest/data/dbip-country-lite.manifest.json` (version, empreinte
sha256, taille, comptes de plages, tous **relevés sur le fichier réel**),
`apps/ingest/data/LICENCE-DB-IP.txt`, `apps/ingest/data/README.md` et le `.gitignore` qui explique
la décision. Le fichier se dépose par `node scripts/fetch-geoip-db.mjs` (ou `--verify`, sans
réseau, ou `--update AAAA-MM` pour changer de livraison **et** réécrire le manifeste).
L'exploitation qui préfère un dépôt auto-suffisant à un dépôt léger n'a qu'à retirer deux lignes du
`.gitignore` : le manifeste reste valable.

**La base réelle A ÉTÉ téléchargée et validée** depuis l'environnement de développement — ce n'est
pas un fichier fabriqué : `dbip-country-lite-2026-09`, sha256 `a32bb3c3…c681d0b`, 4 522 052 octets,
publiée le 01/09/2026. Le parseur la lit **intégralement, zéro ligne rejetée**. Elle **reste à
déposer** sur l'hébergement cible ; `Dockerfile.backend` le fait à la construction et **la
construction ne peut pas échouer à cause de ça** (empreinte vérifiée, échec ⇒ image sans base ⇒
ingestion inchangée).

### Comment l'adresse IP arrive réellement — constaté, et non constaté

**Constaté.** La documentation Railway (« Specs & Limits », lue le 18/09/2026) liste les en-têtes que
la façade pose : `X-Real-IP` **« for identifying client's remote IP »**, `X-Forwarded-Proto`,
`X-Forwarded-Host`, `X-Railway-Edge`, `X-Request-Start`, `X-Railway-Request-Id`.
**`X-Forwarded-For` n'y figure pas** : rien ne garantit qu'il soit posé ni assaini, d'où le refus de
le lire en mode `railway`. Les journaux HTTP de l'arête exposent un attribut `srcIp` décrit comme
« the client's IP address that made the request », donc calculé côté façade.

**Constaté, et plus important que le reste : le service `ingest` n'a AUCUN domaine public.** Relevé
par l'API Railway le 18/09/2026 — seul le service `mcp` en a un
(`mcp-production-201c.up.railway.app`). Le trafic de production entre par
`https://mip-rum-console.vercel.app/api/ingest/v1/traces`, c'est-à-dire la console sur Vercel. **Le
GeoIP local n'y tourne pas, délibérément** : une fonction serverless n'emporte pas 31 Mio d'index et
son processus est recréé trop souvent pour payer 1,1 s de chargement plus d'une fois. Sur ce chemin,
le pays vient du fuseau, et à défaut de `x-vercel-ip-country` — désormais **étiqueté `cdn`**, ce qui
est le vrai gain de ce lot sur la production actuelle. Le GeoIP local sert l'ingestion
**auto-hébergée** (conteneur, VM, hébergeur souverain), là où aucun CDN ne fournit d'en-tête pays.

**NON constaté.** Que la façade Railway **écrase** un `X-Real-IP` envoyé par le client. Le service
déployé ne renvoie pas ses en-têtes, ce lot ne déploie pas de sonde, et la lecture des journaux HTTP
de l'arête n'a rien rendu par l'outillage disponible. Conséquence assumée et bornée : un client
pourrait, dans le pire cas, se choisir un pays. **Ce n'est pas une aggravation** — il choisit déjà
son fuseau horaire, d'où vient le pays estimé d'aujourd'hui. C'est une donnée déclarée, jamais une
preuve, et la colonne de provenance le dit.

### Preuves chiffrées

- `pnpm exec vitest run tests/unit` : **167 fichiers, 2 379 tests verts** (référence master :
  164 / 2 312 — +3 fichiers, +67 tests). Nouveaux : `geoip.test.ts` (31 tests — adresses ambiguës
  refusées, IPv4/IPv6, IPv4 déguisée, plages réservées, base non triée/illisible/CRLF, `ZZ`,
  `fec0::` que la base dit « CH » et que le code dit inconnu, précédence des provenances),
  `client-ip.test.ts` (21 tests — les quatre modes, **tentative de falsification par proxy**,
  en-tête dupliqué, `Headers` web, robustesse), `geoip-db.test.ts` (15 tests — base absente, mal
  nommée, **périmée**, datée du futur, `.gz` qui n'en est pas un, illisible, choix du fichier,
  résolution avant la fin du chargement, et la **livraison réelle** si elle est déposée).
- `pnpm test:sql` sur bases jetables : **24 fichiers, 359 tests verts**, dont
  `geoip-v85-sql.test.ts` (15 tests : rejeu double de v85, contrainte aux bornes, aucune colonne du
  schéma ne porte une adresse IP ni de coordonnées, les trois provenances écrites par un lot réel,
  lot différé drainé, **session jamais réécrite par une adresse d'aujourd'hui**, purge / effacement
  de session / effacement d'app / export DSAR, `DSAR_CHILD_TABLES` inchangée, et la fenêtre de
  déploiement v83 → v85 sur une seconde base).
- `pnpm test:isolation` vert. `pnpm --filter console exec tsc --noEmit` vert. `pnpm -r build` vert.
- **Banc GeoIP** (livraison réelle, Node 26, macOS) : chargement **1,1 s**, index résident
  **15,0 Mio**, pic **105 Mio**, **500 ns par résolution** (200 000 résolutions en 100 ms),
  **0 ligne rejetée** sur 717 170.
- **Recette en conteneur** (image `Dockerfile.backend` construite, **259 Mo**, PostgreSQL jetable) :
  1. démarrage → `{"msg":"geoip chargé","version":"dbip-country-lite-2026-09","lignes":717170,"ignorees":0,"age_jours":17}` ;
  2. `GET /health` → `"geoip":{"source_ip":"railway","etat":"actif","version":"dbip-country-lite-2026-09"}` ;
  3. `POST /v1/traces` avec `x-real-ip: 212.27.38.253` **et un `x-forwarded-for: 1.2.3.4` forgé** →
     `geo_country=FR, geo_source=geoip, geo_db_version=dbip-country-lite-2026-09`. L'adresse forgée
     (1.2.3.4 = AU dans la base) n'a pas été lue ;
  4. second lot, MÊME session, `x-real-ip: 8.8.8.8` (US) → la session reste `FR / geoip` ;
  5. même lot **sans marqueur d'arête Railway** → pays inconnu, provenance inconnue ;
  6. `GEOIP_DB_PATH` vers un fichier absent → `"etat":"eteint","raison":"geoip_db_illisible"`,
     `POST /v1/traces` répond `200`, la ligne est écrite **sans** pays. **L'ingestion n'est jamais
     bloquée.**

### Ce que la mesure vaut, et ce qu'elle ne vaut pas

Une base **pays** ne localise pas une personne. Elle situe une **adresse**, le plus souvent celle
d'un opérateur, d'un relais d'entreprise ou d'un VPN : un télétravailleur derrière le VPN de son
employeur est classé au pays de sortie du VPN, pas au sien. Le fuseau horaire, lui, est un
**réglage** du terminal, que la personne choisit, et une zone couvre souvent plusieurs pays. C'est
pourquoi le libellé reste « Pays estimé », partout, et jamais « Pays » — à l'écran, dans l'API,
dans le catalogue MCP, dans les commentaires de colonne en base et dans `docs/CONFORMITE.md`.

### Licence CC BY 4.0 — ce qu'elle exige, et où c'est satisfait

CC BY 4.0 autorise l'usage, y compris commercial, **à condition** de créditer la source, d'indiquer
la licence et de signaler les modifications. La mention retenue est celle que DB-IP demande :
**« IP Geolocation by DB-IP (https://db-ip.com) »**. Elle figure :

1. dans les **mentions légales publiques** (`/legal/mentions`, servies sans authentification), via
   `DATA_SOURCES` dans `apps/console/lib/legal.ts` — c'est l'attribution *visible* qu'exige la
   licence ; un fichier au fond du dépôt n'y suffit pas ;
2. dans `apps/ingest/data/LICENCE-DB-IP.txt` et le manifeste, versionnés **avec** la base ;
3. dans `docs/CONFORMITE.md` §3.2, qui décrit le traitement.

`tests/unit/conformite.test.ts` refuse que ces mentions divergent. Le fichier est utilisé **tel
quel**, sans modification ni redistribution : aucune œuvre dérivée, donc la clause « indiquer les
modifications » reste sans objet. **DB-IP n'est pas un sous-traitant** et n'est pas inscrit au
registre : nous téléchargeons un fichier, il ne reçoit aucune donnée.

### Ce que ce lot rend DÉFINITIVEMENT impossible

**Aucun enrichissement rétrospectif du pays ne sera jamais possible sur l'historique.** L'adresse IP
des visites passées n'a jamais été stockée — ni en clair, ni hachée, ni tronquée, ni temporairement.
L'information de départ n'existe pas : on ne peut ni la retrouver, ni la deviner. Ce n'est pas un
manque à combler plus tard, c'est une **limite définitive**, et le résultat voulu de la
minimisation. **Ce lot ne commence pas non plus à stocker l'adresse** : il n'ouvre donc pas la porte
à un backfill futur. Les sessions antérieures à v85 gardent `geo_source` à NULL, affiché
« Inconnue » — et non « fuseau », qui serait vraisemblable et faux pour les lignes écrites derrière
un CDN qui posait déjà son en-tête pays.

### Les six cases de §8, et celles qui ne sont pas cochées

| Case | État | Preuve ou raison |
|---|---|---|
| Décision : base locale ou fournisseur, pays seulement, résidence, coût, cadence | **cochée** | DB-IP Lite pays, embarquée, CC BY 4.0, 0 €, mensuelle. Aucun appel fournisseur. |
| IP depuis la connexion / le proxy de confiance seulement | **cochée en code**, non validée en production | `GEOIP_IP_SOURCE` (4 modes, défaut inerte), falsification par proxy prouvée en test **et** en conteneur. Non validée sur Railway : le service n'a pas de domaine public. |
| Résolution en mémoire, pays + provenance persistés, jamais l'IP | **cochée** | v85 (2 colonnes), aucun cache, test SQL « aucune colonne du schéma ne porte une adresse ni de coordonnées ». |
| Décision explicite si envoi de l'IP à un tiers | **sans objet, par décision** | La variante fournisseur n'a pas été retenue ; aucun appel réseau de géolocalisation n'existe. |
| Erreur / IP privée → `unknown` ou repli fuseau étiqueté ; jamais de réécriture ; pas de backfill | **cochée** | 6 raisons de refus nommées, `null` partout ailleurs, immutabilité prouvée en base et en conteneur, limite définitive écrite ici et dans `CONFORMITE.md`. |
| Fixtures documentées + **validation dans l'hébergement cible** | **partiellement cochée** | Fixtures : oui (plages de test, falsification proxy, IPv4 **et** IPv6, `unknown`, base absente **et** périmée). Hébergement cible : **NON validé** — voir ci-dessous. |

### Écarts assumés, propres à P8.7

- **Aucune validation sur Railway.** Le service `ingest` n'a pas de domaine public : rien n'y entre
  depuis l'internet, et y poser `GEOIP_IP_SOURCE` ne changerait rien. La recette a donc été faite
  dans l'**image réelle** (`Dockerfile.backend`, six scénarios ci-dessus), ce qui prouve le code et
  l'empaquetage, mais **pas** le comportement de la façade Railway. La question qui reste ouverte
  est précise : *la façade écrase-t-elle un `X-Real-IP` envoyé par le client ?* Elle se tranchera
  par une sonde qui renvoie l'en-tête reçu, sur un déploiement exposé.
- **Le GeoIP ne tourne pas sur le chemin de production actuel** (console Vercel), et c'est un choix
  motivé plus haut. Ce lot y apporte tout de même la provenance `cdn`, qui manquait.
- **Pas de région, pas de ville.** La décision initiale parlait d'une base « pays et région » ; seul
  le **pays** est résolu et persisté. La spec §8 dit « pays seulement par défaut », le cadrage
  n'autorise à persister que le code pays et la provenance, et une colonne de région serait une
  dimension personnelle de plus sans lecteur. La base « City Lite », qui la porterait, est refusée
  par le chargeur.
- **Pas d'écran dédié.** La provenance est rendue là où le pays l'est déjà (détail de session, liste,
  note du découpage) et devient filtrable/groupable par le contrat. Une page « qualité de la géo »
  n'est pas livrée : la spec n'en demande pas, et elle n'aurait rien à montrer tant que le GeoIP ne
  tourne nulle part.
- **Pic mémoire de 105 Mio au chargement**, pour un index de 15 Mio. C'est le coût d'un CSV de
  31,7 Mio lu en une fois. Un format binaire préconstruit le supprimerait ; il ajouterait un format
  maison à maintenir et une étape de construction, pour un gain qui ne se paie qu'une fois par
  démarrage de processus. Non fait, sciemment.
- **Le récepteur Supabase historique** (`supabase/functions/v1-traces/index.ts`) n'écrit pas les
  colonnes de v85 : il passe par une RPC dont la signature est figée. Même constat qu'en P6.1 pour
  `write-causal.mjs` ; ce chemin n'est plus déployé.
