# ADR-0014 — La base reste sur l'offre gratuite, en mode dégradé affiché

- **Statut** : remplacée le 27/09/2026 — acceptée le 24/09/2026 (décision du responsable du produit) ; la base est passée ce jour-là sur l'offre payante Launch. Ce qui vaut depuis : [la section finale](#remplacée-le-27092026--une-offre-payante-en-attendant-le-choix-de-la-dsi). Le texte ci-dessous est celui de la décision, laissé tel quel.
- **Date** : 2026-09-24
- **Portée** : Neon, cadences du `scheduler` et du `notifier`, vitrine

## Contexte

Le 24/09/2026 à 03:30 UTC, Neon a suspendu le calcul de la base : l'offre gratuite donne **100 heures de calcul (CU-h) par mois**, et 110 avaient été consommées depuis le 1er (relevé API : 397 439 CU-secondes, 440 heures d'activité à 0,25 CU). Passé le quota, le calcul reste suspendu jusqu'au mois suivant : collecte en 500, travaux planifiés en échec, écrans en échec, jusqu'au 1er octobre.

La cause est structurelle : Neon n'endort le calcul qu'après **5 minutes sans requête**, et le tick du scheduler passait toutes les 5 minutes. La base ne dormait presque jamais. Le notifier (15 s), le collector et `console-api` l'auraient gardée éveillée en permanence.

L'offre payante (Launch, ~0,11 $ par CU-h, sans minimum) coûterait ~15 à 20 $ par mois au rythme actuel, 20 à 40 $ avec tous les services.

## Décision

1. **La base reste sur l'offre gratuite**, en mode dégradé : les cadences ralentissent pour que le calcul dorme entre deux passages.
   - `SCHEDULER_TICK_MIN=15`, et c'est aussi le **défaut du service** depuis #304 (25/09 ; un déploiement sans le réglage ne revient plus à 5 — le scheduler en service, déployé le 23/09, le prendra à son prochain déploiement) : la base est éveillée ~5,5 min par passage, ~37 % du temps, **~65 CU-h par mois** ; le reste du quota pour la collecte et la console. La grille n'admet que des diviseurs de l'heure : le passage horaire (HH:05) et le quotidien (03:17) tombent dans la fenêtre d'éveil d'un tick.
   - `NOTIFIER_INTERVAL_MS=900000`, passes **alignées 45 s après le tick** : un seul réveil pour deux services. La réconciliation horaire à HH:00:50.
   - Jamais `INGEST_DEFERRED` sur le collector (son drain interroge la base toutes les 250 ms), et les supervisions externes visent `/live`, jamais `/health`.
2. **La limite est affichée, pas cachée** :
   - le scheduler **publie** sa cadence (`platform_flag.scheduler_tick_min`, table de v87, pas encore en production) et la ligne « Latence d'alerte » de la vitrine la lit : « 15 minutes — base en offre gratuite… », statut partiel ;
   - le point **R10** de « Ce qui reste pour un vrai outil de RUM » dit le quota, la coupure, la conséquence pour une alerte, et que le déblocage est une ligne de budget.
3. **Pour un vrai produit RUM** : offre payante, puis `SCHEDULER_TICK_MIN=5` et `NOTIFIER_INTERVAL_MS=15000`. Deux variables, aucun code.

## Conséquences

- Une alerte part jusqu'à 15 minutes après sa cause ; une nouvelle erreur aussi. Une règle dont la fenêtre est plus courte que le tick n'évalue qu'une partie du temps ; les sondes uptime passent toutes les 15 minutes.
- **La collecte d'un vrai site suffirait à épuiser le quota** : chaque visiteur réveille la base. Le mode gratuit tient pour un POC peu sollicité, pas pour une recette à fort trafic (R1).
- **Le stockage est plafonné à 0,5 Go** (307 Mio occupés sur 512 le 24/09/2026, 60 %). La purge de rétention borne la télémétrie ; le rejeu est ce qui le remplirait ([ADR-0009](0009-blobs-en-postgres.md)).
- **Restauration à 6 heures** : c'est la fenêtre de l'historique de l'offre gratuite (`history_retention_seconds` = 21 600). La procédure du [runbook](../../operations/runbook.md) en tient compte.
- La consommation se lit par l'API Neon (`compute_time_seconds` du projet) : c'est le premier réflexe quand la base refuse les connexions.

## Écarté

- **Passer tout de suite en offre payante** : décision de budget, reportée par le responsable du produit.
- **Garder 5 minutes et attendre chaque 1er du mois** : une production coupée une semaine par mois.
- **Réveiller le notifier par `LISTEN/NOTIFY`** plutôt que par une cadence : il faudrait une connexion permanente, qui empêcherait la veille ou serait coupée par elle, et `LISTEN` ne traverse pas le pooler Neon en mode transaction.

## Remplacée le 27/09/2026 : une offre payante, en attendant le choix de la DSI

Le 27/09/2026 au soir, la base est passée de l'offre gratuite à l'offre payante **Launch** de Neon : facturation à l'usage, calcul plafonné à **0,25 CU**, mise en veille toujours active. Le quota mensuel qui avait coupé la base du 24/09 au 27/09 ne s'applique plus ; les migrations v87 → v96 ont été appliquées le même jour, au redéploiement du `scheduler`.

Ce n'est **pas** le choix de la base d'un vrai produit. Pour le responsable du produit, Neon n'est pas une cible digne d'un vrai produit : la base se choisira selon ce qu'utilise la DSI de MIP, question à lui poser. L'offre Launch n'est qu'un palier.

Ce qui ne change pas :

- les cadences restent à 15 minutes (`SCHEDULER_TICK_MIN: "15"` et `NOTIFIER_INTERVAL_MS: "900000"` dans `.railway/railway.ts`) : sur une offre à l'usage, une base qui dort entre deux passages coûte moins, et la veille reste active ;
- la ligne « Latence d'alerte » de la vitrine dit toujours la cadence publiée par le `scheduler` (15 minutes, statut partiel), avec une raison réécrite : une base provisoire, laissée en veille entre deux passages ;
- le point R10 de « Ce qui reste » dit désormais ce qui manque : une base choisie selon le standard de la DSI de MIP ; qui décide : la DSI de MIP et le responsable du produit.

Ce qui devient caduc : la coupure en fin de quota et les conséquences qui en découlaient (la collecte d'un vrai site n'épuise plus un quota, elle se paie à l'usage). Le plafond de stockage et la fenêtre de restauration de l'offre Launch n'ont pas été relevés : ils ne sont pas écrits ici.

Pour un vrai produit, le point 3 de la décision tient : une base dimensionnée, puis `SCHEDULER_TICK_MIN=5` et `NOTIFIER_INTERVAL_MS=15000`. Deux variables, aucun code.
