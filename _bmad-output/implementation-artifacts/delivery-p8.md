# Livraison P8 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-operations-integrations-p8.md](spec-rum-operations-integrations-p8.md).
Base : `origin/master` au 18/09/2026 (P5, P6 et P7.1/P7.2/P7.4 fusionnés).

Une case n'est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | PR | Migration | Implémenté | Testé localement | CI | Déployé | Vérifié sur vraie app |
|---|---|---|---|---|---|---|---|
| P8.1 — effacement sérialisé avec l'ingestion | #205 | v81, appliquée sur Neon le 18/09 10:16 | oui | oui | verte | oui (`b06a5ce`) | non — aucun effacement réel joué depuis l'activation |
| P8.2 à P8.8 | — | — | non | — | — | — | — |

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

## Écarts assumés

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

## Suivis consolidés

- **Commentaires de triage** : un scrub assisté (l'opérateur voit les commentaires d'issues touchées par
  un effacement et décide) serait le prolongement naturel ; il n'est pas livré.
- **Rejeu et clients historiques** : un rejeu différé côté serveur (tampon borné en attente de l'ancre)
  éviterait la perte de chunk sous `enforce` ; il conserverait le corps, ce que le contrat refuse
  aujourd'hui. À instruire avec la politique.
- **Version de protocole des writers** : un en-tête ou une colonne de registre annonçant la version
  minimale acceptée fermerait le dernier « vieux writer » possible. Non livré.
- **Backfills (P8.2)** : l'outillage doit utiliser cette primitive et reconsulter les sources dans
  chaque transaction ; la couture est en place (`writeRowsWithClient`, `withAppIngestTransaction`).
