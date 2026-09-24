# Banc du collector du 24/09/2026 — porte go/no-go de P2, en approximation locale

Ce document est un **constat daté et provisoire**. La vraie porte de P2 se joue sur
staging : collector Railway (Amsterdam) vers Neon (Francfort). Elle est impossible tant
que la base Neon est suspendue (quota gratuit épuisé le 24/09 à 03:30 UTC). Ce banc
reproduit en local la seule grandeur qui décide du verrou d'application : **la latence par
aller-retour SQL**. Il ne dit rien de ce qu'il ne reproduit pas (voir « Limites »).

Le critère du plan : **utilisation du verrou d'application inférieure à 30 % à 3 fois le
pic** (P2, « Porte go / no-go »). Le pic de production n'est pas mesurable aujourd'hui (base
suspendue, P0.T pas faite). Ce document donne donc la **courbe utilisation = f(débit)**, pour
que le critère se lise dès que le pic sera connu.

## Verdict provisoire

- **Le critère tient au trafic d'aujourd'hui, avec une large marge.** À ~10 ms par
  aller-retour, l'utilisation vaut environ **17 % par lot/s** (tenue moyenne ≈ 0,17 s par
  lot). Le seuil de 30 % est atteint vers **1,75 lot/s** sur une app. Le pic admissible vaut
  donc **≈ 0,58 lot/s par app (≈ 35 lots/min)**. Le trafic connu en est loin :
  - le relevé P0 compte 378 événements cumulés sur `gip-plateforme` ;
  - l'objectif de P0.T (500 `rum_event` en 24 h) correspond à ≈ 0,001 lot/s en moyenne.
- **Mais la latence rend le critère intenable à faible débit, et il faut le dire
  franchement.**
  - 0,58 lot/s, c'est une poignée de visiteurs actifs simultanés sur une app : entre 2 et
    une vingtaine selon leur activité. Le SDK envoie au plus un lot toutes les 3 s par
    visiteur actif (`flushIntervalMs`, `packages/rum-sdk/src/otel.ts`). Ce chiffre en
    visiteurs est une hypothèse, pas une mesure.
  - Sans latence, le même code tient ≈ 24 lots/s à 30 %. **La latence divise la capacité
    par app par ≈ 14.** Sur les ≈ 150–170 ms de tenue d'un lot, plus de 90 % sont de
    l'attente réseau : 15 allers-retours sous le verrou.
- **Le critère, tel qu'il est écrit, passera trivialement avec le trafic synthétique de
  P0.T, et ne protège pas d'un vrai client.** Mieux vaut le lire comme une capacité : « le
  collector tient-il le pic attendu de `gip-plateforme` × 3 ? ». La réponse aujourd'hui :
  oui jusqu'à ≈ 0,58 lot/s de pic, non au-delà.
- **Recommandation.**
  - GO pour P3 au trafic actuel, sous réserve de rejouer la porte sur staging.
  - Faire la fonction SQL en un aller-retour (chiffrée plus bas : capacité × 17 à × 57)
    **avant** qu'un client dépasse quelques visiteurs simultanés sur une app, ou dès que le
    pic mesuré × 3 approche 1,5 lot/s.
  - Le plafond est **par app** : 5 apps en parallèle écrivent 33 à 62 lots/s au total sous
    la même latence.

## En cinq chiffres

| | sans latence (A/R 0,5 ms) | avec latence (A/R ≈ 9–10 ms) |
|---|---|---|
| tenue du verrou par lot (p50) | 9,5–19 ms | 146–170 ms |
| débit d'une app à 30 % d'utilisation | ≈ 24 lots/s | **≈ 1,75 lot/s** |
| pic admissible (30 % à 3 × le pic) | ≈ 8 lots/s | **≈ 0,58 lot/s** |
| saturation d'une app (utilisation ≈ 99 %) | 84–90 lots/s | 6,5–6,8 lots/s |
| allers-retours SQL par lot | 18 dans la transaction, dont 15 sous le verrou, + 1 hors transaction | idem |

Aucune réponse autre que 200 dans aucune phase, saturation comprise.

## Méthode

### Montage (`scripts/bench/banc-collecteur-local.mjs`)

```
load-bench.mjs ──HTTP──▶ collector (node, 127.0.0.1:45452) ──TCP──▶ toxiproxy ──▶ Postgres 17.11
  (lots imposés)          services/collector/server.mjs        127.0.0.1:55452   (conteneur, sans port
                          + sonde préchargée                   latence 3+3 ms    publié, pg_stat_statements)
```

- **Postgres 17.11** en conteneur, migré par **le migrateur de production**
  (`node services/scheduler/migrate.mjs`, 81 fichiers). Le seul port publié est celui du
  banc (55452), tenu par **toxiproxy** (`ghcr.io/shopify/toxiproxy` 2.12.0). « Sans latence »
  passe aussi par le proxy, toxique retiré : les deux conditions ne diffèrent que par la
  latence.
- **Calibration de la latence.** Les toxiques n'acceptent que des millisecondes entières.
  Sous Docker Desktop (macOS), chacun ajoute ≈ 1,5 à 2,5 ms à sa valeur nominale :
  - 4 + 5 ms nominaux donnaient **13 ms** mesurés au `select 1` ;
  - **3 + 3 ms** en donnent 8,9 à 10,3 ms à vide, et ≈ 9,5–10 ms sous charge (déduit de la
    tenue : 15 A/R ≈ 146 ms).

  Le banc vise donc l'aller-retour **mesuré**. Il se situe dans la fourchette du plan
  (8–10 ms Amsterdam ↔ Francfort), plutôt en haut.
- **Le vrai collector** (`services/collector/server.mjs`), réglé comme `railway.ts` le
  prévoit :
  - `PGPOOL_MAX=8` et `REQUIRE_API_KEY=true` ; l'app de banc a une clé, portée par
    `mip.api_key` ;
  - `LOG_LEVEL=info` ;
  - `RATE_LIMIT_PER_MIN` levé pour ne pas couper le banc. `rate_check` reste interrogé :
    c'est l'aller-retour « hors transaction ».

  Une seule réplique : le verrou vit dans la base, deux répliques ne changent pas
  l'utilisation.
- **Charge** : `scripts/load-bench.mjs`, désormais à cible et paramètres configurables, sur
  **un seul `app_id`**.
  - Boucle **ouverte** : débit imposé, arrivées poissonniennes à graine rejouable,
    30 s par marche ou au moins 40 lots.
  - Boucle **fermée** : concurrence 1, 4 et 16, 15 s, pour la saturation.
  - Chauffe de 3 s à concurrence 8 avant les mesures, pour ouvrir le pool et remplir les
    caches.
- **Le lot mesuré** : une session du générateur, soit 1 page vue, 5 Web Vitals portant
  `webvital.id` comme le SDK, 1 ressource et 1 tâche longue. Environ 9 % des lots portent
  aussi une erreur (voir « Points relevés »).
- **Verrou isolé** : `scripts/bench-verrou-p81.mjs`, en processus, sans HTTP.
  - Budget du collector : `lock_timeout` 1,5 s × 2.
  - Sonde d'attente espacée de 100 ms : à 0, elle retenait elle-même le verrou un A/R sur
    quatre derrière la latence.
  - Base déjà migrée, donc non re-migrée.
  - Son lot (page vue + LCP) est plus léger : 12 A/R, dont 9 sous le verrou.

### Ce que mesure chaque chiffre

La sonde client (`scripts/bench/sonde-pg.mjs`) est préchargée dans le collector par
`--import scripts/bench/sonde-pg-preload.mjs`. Elle horodate chaque `client.query` sur une
horloge murale commune au pilote. Aucune ligne du code de production n'a été modifiée pour
mesurer.

- **débit (lots/s)** : lots écrits dans la fenêtre de la marche, réponses comprises. C'est
  le débit **obtenu** (l'axe des courbes), pas le débit visé.
- **transaction** : de l'envoi de `BEGIN` à la réponse du `COMMIT`.
- **attente du verrou** : durée de `pg_advisory_xact_lock` vue du client, soit l'attente
  réelle plus un aller-retour. La colonne « nette » retranche l'A/R à vide.
- **tenue** : de la réponse du verrou à la réponse du `COMMIT`. C'est **exactement** la
  tenue côté serveur : le serveur accorde le verrou un aller simple avant que le client ne
  le sache, et le relâche un aller simple avant la réponse du `COMMIT`. Les deux décalages
  s'annulent.
- **utilisation** : somme des tenues, rognées à la fenêtre, divisée par la durée de la
  fenêtre. Pour une seule app, le verrou sérialise : c'est un temps d'occupation réel.
- **allers-retours** : appels `client.query` de `BEGIN` à `COMMIT` sur le client de la
  transaction. `pg` ne pipeline pas : chaque appel est un A/R. Les appels hors transaction
  sont comptés à part.
- **travail serveur par lot** : `pg_stat_statements`, somme des temps d'exécution des
  requêtes du lot, moins l'attente du verrou, moins `rate_check` et le registre. C'est la
  borne basse de la tenue si tout partait en un aller-retour. Le `COMMIT` n'y est pas.

### Contre-épreuves

- **Comptage des allers-retours** : à chaque marche des deux passages, le total vu par la
  sonde est **égal** au nombre d'appels de `pg_stat_statements` sur la même fenêtre (par
  exemple 33 543 = 33 543 à 60 lots/s, 3 413 = 3 413 à 6 lots/s avec latence).
- **Utilisation** : un échantillonneur **côté serveur**
  (`scripts/bench/echantillonner-verrou.mjs`) lit `pg_locks` toutes les 5 ms. Le verrou
  d'une app y apparaît en `advisory`, clé 1 dans `classid`, clé 2 dans `objid`,
  `objsubid = 2`. Il concorde avec la sonde client à ≈ 1 point près (tableau du deuxième
  passage). **C'est la méthode qui servira sur staging**, où l'image du collector
  n'embarque pas la sonde.
- **Reproductibilité** : un deuxième passage complet (montage neuf) retrouve les mêmes
  courbes, à 1–2 points près.

### Reproduire

```bash
node scripts/bench/banc-collecteur-local.mjs            # ≈ 13 min, Docker requis, port 55452
# relevé JSON complet : $BANC_SORTIE (défaut : <tmp>/banc-collecteur-<t>.json)
# deuxième passage de ce document :
BANC_DEBITS_SANS=5,20,40 BANC_DEBITS_AVEC=1,2,3,5 BANC_CONCURRENCES=4 \
  BANC_VERROU_WRITERS=1,4 BANC_VERROU_LOTS=60 node scripts/bench/banc-collecteur-local.mjs
```

Le pilote ne transmet à aucun processus enfant les variables `DATABASE_URL` et `PG*` du
poste. Il construit sa base sur 127.0.0.1 et démonte ses conteneurs à la fin.

## Chiffres bruts

Premier passage, 07:36 UTC. Durées en ms, débits en lots/s. Pour les allers-retours, la
colonne donne min-p50-max dans la transaction, puis les A/R hors transaction par lot.

### Sans latence (A/R à vide : p50 0,52 ms, p95 0,74 ms)

| marche | débit obtenu | util. | tx p50 | tx p95 | attente p50 | attente p95 | nette p95 | tenue p50 | tenue p95 | POST p50 | POST p95 | serveur/lot | A/R | statuts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 lot/s | 1,03 | 2,4 % | 22,1 | 124,2 | 0,8 | 9,8 | 9,3 | 18,1 | 64,9 | 33,2 | 134 | 3,25 | 18-18-20 +1 | 39 × 200 |
| 2 lots/s | 2,07 | 4,3 % | 23,8 | 46,3 | 1,0 | 19,2 | 18,7 | 19,3 | 33,4 | 34,1 | 65,5 | 3,03 | 18-18-29 +1,03 | 61 × 200 |
| 5 lots/s | 4,26 | 6,6 % | 17,0 | 32,4 | 0,8 | 9,2 | 8,6 | 13,8 | 25,6 | 22,2 | 41,5 | 2,26 | 18-18-20 +1 | 128 × 200 |
| 10 lots/s | 10,69 | 16,8 % | 17,9 | 34,6 | 0,8 | 16,0 | 15,5 | 14,4 | 25,8 | 23,1 | 42,8 | 2,13 | 18-18-29 +1,01 | 320 × 200 |
| 20 lots/s | 18,86 | 24,9 % | 15,5 | 38,4 | 0,7 | 17,8 | 17,3 | 11,9 | 20,3 | 19,2 | 45,4 | 1,86 | 18-18-20 +1 | 565 × 200 |
| 40 lots/s | 38,92 | 45,7 % | 15,9 | 49,4 | 1,0 | 34,9 | 34,3 | 10,8 | 17,2 | 19,7 | 54,3 | 1,58 | 18-18-28 +1 | 1 169 × 200 |
| 60 lots/s | 58,26 | 68,0 % | 22,8 | 90,7 | 10,6 | 74,7 | 74,1 | 10,5 | 18,2 | 25,4 | 104,1 | 1,63 | 18-18-20 +1 | 1 749 × 200 |
| fermé × 1 | 75,00 | 77,4 % | 10,8 | 14,9 | 0,4 | 0,7 | 0,2 | 9,5 | 13,2 | 12,4 | 16,9 | 1,43 | 18-18-20 +1 | 1 126 × 200 |
| fermé × 4 | 89,82 | 98,3 % | 39,9 | 58,3 | 28,6 | 43,2 | 42,7 | 10,2 | 15,5 | 41,7 | 61,1 | 1,49 | 18-18-28 +1 | 1 351 × 200 |
| fermé × 16 | 87,58 | 97,9 % | 85,6 | 123,3 | 73,8 | 106,2 | 105,7 | 10,4 | 15,4 | 173,0 | 244,1 | 1,56 | 18-18-20 +1 | 1 332 × 200 |

### Avec latence (toxiques 3 + 3 ms ; A/R à vide : p50 10,27 ms, p95 12,67 ms)

| marche | débit obtenu | util. | tx p50 | tx p95 | attente p50 | attente p95 | nette p95 | tenue p50 | tenue p95 | POST p50 | POST p95 | serveur/lot | A/R | statuts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0,5 lot/s | 0,70 | 11,8 % | 199,8 | 385,5 | 10,5 | 191,1 | 180,8 | 165,5 | 215,6 | 220,8 | 403,2 | 6,67 | 18-18-29 +1,04 | 56 × 200 |
| 1 lot/s | 1,14 | 19,6 % | 206,1 | 349,7 | 10,5 | 154,0 | 143,8 | 170,0 | 212,8 | 227,0 | 391,2 | 6,58 | 18-18-29 +1,02 | 46 × 200 |
| 2 lots/s | 2,21 | 37,4 % | 205,8 | 587,6 | 12,2 | 395,4 | 385,1 | 158,3 | 199,9 | 234,7 | 810,3 | 10,37 | 18-18-20 +1,02 | 66 × 200 |
| 3 lots/s | 3,02 | 46,3 % | 189,0 | 379,8 | 10,8 | 211,3 | 201,0 | 152,8 | 176,9 | 205,0 | 396,4 | 5,05 | 18-18-29 +1,01 | 91 × 200 |
| 4 lots/s | 4,74 | 71,0 % | 241,2 | 642,4 | 73,0 | 465,8 | 455,6 | 148,3 | 172,9 | 257,9 | 657,6 | 4,30 | 18-18-21 +1 | 144 × 200 |
| 5 lots/s | 4,86 | 75,5 % | 323,2 | 866,6 | 147,0 | 699,8 | 689,5 | 153,0 | 177,6 | 338,9 | 886,3 | 4,93 | 18-18-29 +1,01 | 145 × 200 |
| 6 lots/s | 5,88 | 89,4 % | 541,5 | 1 191 | 368,7 | 1 019,6 | 1 009,3 | 150,0 | 183,7 | 553,1 | 1 247,1 | 4,58 | 18-18-20 +1,01 | 178 × 200 |
| fermé × 1 | 5,21 | 78,4 % | 177,9 | 201,4 | 9,4 | 11,4 | 1,1 | 149,8 | 171,5 | 188,7 | 218,1 | 3,86 | 18-18-20 +1 | 79 × 200 |
| fermé × 4 | 6,59 | 99,3 % | 588,4 | 654,4 | 423,2 | 473,2 | 463,0 | 148,3 | 173,8 | 600,6 | 670,7 | 4,31 | 18-18-29 +1,01 | 102 × 200 |
| fermé × 16 | 6,45 | 99,1 % | 1 223,4 | 1 299 | 1 047,5 | 1 135,6 | 1 125,3 | 153,7 | 178,7 | 2 450,7 | 2 557,8 | 5,13 | 18-18-20 +1 | 113 × 200 |

À 0,5 lot/s visé, la graine a tiré 56 arrivées en 80 s au lieu de 40 (≈ + 2,5 σ). C'est le
débit **obtenu** qui fait foi.

### Deuxième passage — reproductibilité et échantillonneur `pg_locks` (07:48 UTC)

| condition | débit obtenu | util. (sonde) | util. (`pg_locks`) | échantillons | file moyenne | tenue p50 | tx p95 |
|---|---|---|---|---|---|---|---|
| sans latence (A/R 0,48 ms) | 4,67 | 10,9 % | 9,0 % | 4 232 | 0,07 | 13,8 | 448,8 |
| | 20,39 | 25,1 % | 25,3 % | 4 670 | 0,05 | 11,3 | 28,7 |
| | 37,83 | 43,0 % | 43,3 % | 4 724 | 0,22 | 10,4 | 44,2 |
| | fermé × 4 : 84,43 | 98,5 % | 99,7 % | 2 380 | 2,68 | 10,6 | 69,2 |
| avec latence (A/R 8,89 ms) | 1,10 | 19,2 % | 18,8 % | 2 330 | 0,03 | 160,2 | 386,0 |
| | 2,09 | 36,0 % | 36,0 % | 1 685 | 0,10 | 159,7 | 536,4 |
| | 2,68 | 41,3 % | 42,0 % | 1 887 | 0,07 | 150,5 | 325,5 |
| | 5,18 | 76,0 % | 77,1 % | 2 023 | 1,08 | 146,0 | 1 005,7 |
| | fermé × 4 : 6,78 | 99,4 % | 99,5 % | 1 028 | 2,68 | 146,7 | 632,5 |

### Banc du verrou en processus (`bench-verrou-p81.mjs`, budget du collector, premier passage)

```
sans latence — lots par passe : 200 · lock_timeout : 1500 ms · tentatives : 2 · pause de la sonde : 100 ms
scénario                    wr  apps    lat.p50    lat.p95    att.p50    att.p95    att.max   tenu.p50  util.  A/R     débit  refus
une seule application        1     1     7.8 ms    11.4 ms     5.2 ms    13.5 ms    13.5 ms     6.2 ms   80 %   12     118/s      0
une seule application        4     1    28.1 ms    38.9 ms    24.5 ms    29.2 ms    29.2 ms     6.6 ms   98 %   12     135/s      0
une seule application       16     1   119.8 ms   471.7 ms   120.7 ms   496.3 ms   496.3 ms     7.0 ms   98 %   12      98/s      0
réparti sur 5 apps           4     5     9.9 ms    15.4 ms     3.4 ms    11.1 ms    11.1 ms     7.9 ms  325 %   12     346/s      0
réparti sur 5 apps          16     5    32.2 ms    61.7 ms    47.1 ms    74.9 ms    74.9 ms    10.0 ms  477 %   12     418/s      0

avec latence (3 + 3 ms)
une seule application        1     1   119.6 ms   133.4 ms    42.0 ms   136.3 ms   219.6 ms    91.1 ms   76 %   12       8/s      0
une seule application        4     1   377.1 ms   407.5 ms   362.5 ms   400.6 ms   406.2 ms    91.6 ms   98 %   12      11/s      0
une seule application       16     1  1461.6 ms  1530.3 ms  1446.1 ms  3091.3 ms  3091.3 ms    91.2 ms   99 %   12      11/s      0
réparti sur 5 apps           4     5   110.5 ms   129.1 ms    95.5 ms   123.0 ms   124.0 ms    82.2 ms  300 %   12      36/s      0
réparti sur 5 apps          16     5   235.8 ms   324.9 ms   294.6 ms   313.6 ms   313.6 ms    77.6 ms  485 %   12      62/s      0
```

Pour les scénarios répartis, `util.` additionne cinq verrous distincts ; au-delà de 100 %,
c'est le parallélisme entre apps. Avec 16 écrivains sur une seule app et de la latence, la
sonde d'attente atteint 3,09 s au p95 : elle a obtenu le verrou à sa seconde tentative, au
bord du budget (2 × 1,5 s + 120 ms de recul). Aucun refus, mais aucune marge.

### Les allers-retours d'un lot

Séquence type : 60 lots sur 66 à 2 lots/s avec latence, 1 593 sur 1 749 à 60 lots/s.
Elle compte **18 A/R dans la transaction, plus 1 avant** :

| étape | A/R | sous le verrou ? |
|---|---|---|
| `select rate_check()` (débit, hors transaction) | 1 | non |
| `begin`, `set local lock_timeout`, `pg_advisory_xact_lock` | 3 | non (le verrou est accordé à la réponse du 3ᵉ) |
| barrières d'effacement (`privacy_erasure_barrier`), portée des sessions (`rum_session`) | 2 | oui |
| `insert` `rum_session`, `rum_pageview`, `rum_metric`, `rum_resource`, `rum_longtask` | 5 | oui |
| relecture de la ligne canonique **par vital** (`indexAvecVitalsConsolides`) | 5 | oui |
| `insert rum_event_index`, `update rum_session` (page_count), `commit` | 3 | oui |

**15 allers-retours sous le verrou** : c'est la tenue, soit ≈ 15 × A/R + le travail serveur.
Les variantes observées :

- **lot porteur d'une erreur, 20 A/R** : + `select error_grouping_config` + `insert
  rum_error`.
- **lot « froid », 29 A/R**, vérifié à part sur une base migrée : les caches de colonnes
  et de présence (60 s, par processus) se rechargent **dans** la transaction, soit
  `to_regclass` et 10 lectures d'`information_schema` sous le verrou. Cela arrive une fois
  par minute et par réplique.

La formule générale : 4 A/R fixes sous le verrou (barrières, portée, `update`, `commit`),
plus 1 par collection non vide, plus 1 par vital porteur de `webvital.id`. Un lot réel du
SDK qui porte aussi actions, fils d'Ariane, événements et spans d'appel en ajoute 4 à 5 : on
retrouve la « trentaine » annoncée par le plan.

## La courbe utilisation = f(débit)

Sous la saturation, l'utilisation suit **débit × tenue moyenne** : les deux passages s'y
alignent à quelques points près. Pour une app :

- **avec latence (~10 ms)** : ≈ 17 % par lot/s à bas débit (tenue moyenne 0,17 s), ≈ 15 %
  par lot/s vers 3–6 lots/s (0,15 s). Mesuré : 0,70 → 11,8 % · 1,10–1,14 → 19–20 % ·
  2,09–2,21 → 36–37 % · 2,68–3,02 → 41–46 % · 4,74–5,18 → 71–76 % · 5,88 → 89 % ·
  saturation à 6,5–6,8 lots/s.
- **sans latence** : ≈ 2 % par lot/s sous 2 lots/s (effet repos, voir « Limites »), ≈ 1,2–1,6 % au-delà. Mesuré : 4,3 → 6,6 % · 10,7 → 16,8 % ·
  18,9–20,4 → 25 % · 37,8–38,9 → 43–46 % · 58 → 68 % · saturation à 84–90 lots/s.
- Point de passage à 30 % (interpolé) : **1,74–1,77 lot/s** avec latence, **24–25 lots/s**
  sans.

**Lecture du critère dès que le pic `p` d'une app sera connu** (en lots/s, c'est-à-dire en
POST d'ingestion par seconde, pas en événements) :

| pic `p` | 3 × `p` | util. avec latence (~10 ms) | util. sans latence | util. estimée, fonction SQL (tenue 3–10 ms) |
|---|---|---|---|---|
| 0,01 | 0,03 | ≈ 0,5 % ✓ | < 0,1 % ✓ | < 0,1 % ✓ |
| 0,1 | 0,3 | ≈ 5 % ✓ | ≈ 0,7 % ✓ | 0,1–0,3 % ✓ |
| 0,3 | 0,9 | ≈ 15 % ✓ | ≈ 2 % ✓ | 0,3–0,9 % ✓ |
| **0,58** | **1,75** | **≈ 30 % (limite)** | ≈ 3,7 % ✓ | 0,5–1,8 % ✓ |
| 1 | 3 | ≈ 46 % ✗ (mesuré 46,3 % à 3,02) | ≈ 5 % ✓ | 0,9–3 % ✓ |
| 2 | 6 | ≈ 89 % ✗ (mesuré 89,4 % à 5,88) | ≈ 9 % ✓ | 2–6 % ✓ |
| 5 | 15 | saturé ✗ (plafond ≈ 6,5) | ≈ 21 % ✓ | 5–15 % ✓ |
| 8 | 24 | saturé ✗ | ≈ 30 % (limite) | 7–24 % ✓ |
| 20 | 60 | saturé ✗ | ≈ 68 % ✗ (mesuré) | 18–60 % ✗ au-delà de 5 ms |

Ce que l'attente coûte au client, avec latence : tant que l'utilisation reste sous ≈ 40 %,
la plupart des lots n'attendent pas (attente nette p50 ≈ 0–2 ms). Les rafales
poissonniennes coûtent en revanche 150–400 ms au p95. Vers 90 %, le p95 approche le
`lock_timeout` de 1,5 s. **Au-delà de ≈ 6,5 lots/s soutenus sur une app**, le budget de
requête du collector répondra 503 + `retry-after`. C'est voulu, mais non mesuré ici :
aucune marche n'a dépassé la saturation assez longtemps.

## Si le critère échoue : le repli du plan, chiffré (non écrit)

Le plan prévoit de « réduire les allers-retours de `writeRowsWithClient` (une fonction SQL
prenant un `jsonb`) ». Voici ce que les mesures en disent.

| | aujourd'hui (~10 ms/A/R) | fonction SQL en un aller-retour (estimation) |
|---|---|---|
| A/R par lot | 18 + 1 | 1 (+ 1 pour `rate_check`, ou 0 s'il entre dans la fonction) |
| A/R sous le verrou | 15 | 0 : le verrou est pris et rendu dans l'exécution serveur |
| tenue du verrou | 146–170 ms | **3–10 ms**, indépendante de la latence : travail serveur mesuré 1,4–3,4 ms par lot à chaud (`pg_stat_statements`, requêtes enchaînées sans trou réseau), 4–10 ms quand chaque requête attend le réseau, plus le `COMMIT` (non mesuré ; sur Neon, l'acquittement du WAL par les safekeepers : quelques ms, à mesurer sur staging) |
| débit d'une app à 30 % | ≈ 1,75 lot/s | **30–100 lots/s** (× 17 à × 57) |
| pic admissible | ≈ 0,58 lot/s | 10–33 lots/s |
| saturation d'une app | 6,5–6,8 lots/s | 100–330 lots/s |
| latence d'un POST (p50, bas débit) | 205–235 ms | ≈ 25–30 ms (2 A/R + travail) |

- **Ce que coûterait l'écriture**, en estimation et non en engagement : 3 à 5 j-dev, plus
  la parité. Il faut porter en PL/pgSQL, sous un nom versionné et créé par migration
  (expand/contract : le code n'appelle la fonction que si elle existe) :
  - l'écriture des traces : upserts conditionnels de session, déduplication des vitals,
    projection `rum_event_index`, `page_count` ;
  - les deux passes du filtrage par barrières (`filtrerLot`) et la garde de portée ;
  - le regroupement d'erreurs v2 (`regrouperErreurs` et `finaliserIssues`) ;
  - les logs et le replay.

  La symbolication reste avant, en JS, hors verrou, comme aujourd'hui. La danse des
  colonnes optionnelles (`colonnesDe`, 10 lectures d'`information_schema` par minute sous
  le verrou) disparaît : la fonction naît avec son schéma.
- **Le risque** : une seconde implémentation de l'ingestion, le défaut exact que le dépôt
  combat (« deux copies qui divergent »). Parade : les routes Vercel et le collector
  appellent **la même** fonction dans la même PR, et les `tests/integration/*-sql.test.ts`
  existants la jouent.
- **Un palier intermédiaire, moins cher, ne suffit pas.** Regrouper les 5 relectures de
  vitals en une (`unnest`) et fusionner barrières et portée ramène 15 A/R sous le verrou à
  10. La tenue passerait à ≈ 100–110 ms, et 30 % serait atteint vers ≈ 2,8 lots/s : × 1,6,
  même ordre de grandeur.
- **L'autre repli du plan, garder les écritures sur Vercel fra1**, n'a pas été mesuré.
  Modèle : 15 × ~1,5 ms + ~5 ms ≈ 27 ms de tenue, soit 30 % vers ≈ 11 lots/s. La courbe
  « sans latence » (A/R 0,5 ms, 30 % vers 24 lots/s) en est la borne optimiste.

## Limites de l'approximation locale

- **Seule la latence est reproduite.** Elle est constante, sans gigue ni queue lourde,
  alors que le réseau réel en a. Ne sont pas reproduits :
  - le CPU de Neon (0,25 CU au relevé, plus lent qu'un Mac : le travail serveur de 1,5 à
    3 ms par lot pourrait doubler, ce qui reste petit devant 15 × 10 ms) ;
  - le **pooler PgBouncer** en mode transaction : un saut de plus, et une file de plus
    quand le pool serveur est plein ;
  - le coût du `COMMIT` sur Neon ;
  - le réseau Railway.
- **L'A/R réel sous charge vaut ≈ 9,5–10 ms**, en haut de la fourchette du plan (8–10 ms).
  À 9 ms exacts, la tenue baisserait d'environ 15 ms et le passage à 30 % monterait vers
  ≈ 2,0 lots/s ; à 8 ms, vers ≈ 2,2. L'ordre de grandeur ne change pas.
- **L'« effet repos »** : à très bas débit, la tenue est plus longue (sans latence 18–19 ms
  à 1–2 lots/s contre 10–12 ms au-delà de 20 ; avec latence 165–170 ms contre 146–153 ms).
  Réveils de la VM Docker et de la boucle d'événements, caches froids. Les points à bas
  débit sont donc **pessimistes**.
- **Une seule réplique, une seule app chargée.** Le poste était partagé avec d'autres
  agents : bruit CPU possible. Le deuxième passage retrouve pourtant les mêmes courbes.
- **Le lot du banc est un profil**, pas un lot réel du SDK. Les lots réels portent plus de
  collections, donc plus d'A/R (formule plus haut), donc une tenue plus longue. Sur ce
  point, le chiffre de ce banc est **optimiste**.
- **Identité, GeoIP et ingestion différée étaient éteints**, comme le prévoit la
  configuration de production de P2 hors identité. Le hachage d'identité se fait en
  mémoire, hors verrou.

## Rejouer la vraie porte sur staging

Dès que Neon est rétabli et que le staging Railway existe (collector à 2 réplicas, pool
de 8, branche Neon de staging), **jamais sur la production** :

1. Préparer une app de banc dotée d'une clé, sur la base de staging :
   `scripts/ops/provisionner-cles.mjs --appliquer --app <app-banc>`.
2. Pour chaque débit `r` de {0,5 ; 1 ; 2 ; 3 ; 5}, lancer en même temps :
   ```bash
   BENCH_DATABASE_URL=<staging> APP=<app-banc> DUREE_S=60 node scripts/bench/echantillonner-verrou.mjs
   ENDPOINT=https://<collector-staging>/v1/traces APP=<app-banc> API_KEY=<clé> \
     RATE=<r> DURATION_S=60 DB_PHASE=0 node scripts/load-bench.mjs
   ```
   L'échantillonneur lit l'état du serveur. Sa propre latence (poste → Neon) ne biaise pas
   l'utilisation, elle n'en limite que la cadence.
3. Placer les points (`batchesPerSec`, `utilisation`) sur la courbe ci-dessus. Lire le
   débit à 30 %, puis le comparer à 3 × le pic.
4. **Le pic se mesure en POST d'ingestion par app et par seconde** : journaux Vercel
   aujourd'hui, `http_requests_total` du collector après P3. Ni en événements, ni en
   sessions.

## Points relevés en passant (non corrigés ici)

- **`load-bench.mjs` tire ses erreurs avec un pseudo-aléa en sinus.** Sa loi est en
  arcsinus, pas uniforme : `ERROR_RATE=0.02` donne **≈ 9 %** de lots avec erreur (156 sur
  1 749 mesurés). Ce n'est pas corrigé, pour garder le profil des chiffres publiés ici.
  Effet : + 2 A/R sur ces lots.
- **`indexAvecVitalsConsolides` lance ses relectures par `Promise.all` sur le client de la
  transaction.** `pg` 8.21 avertit : « Calling client.query() when the client is already
  executing a query is deprecated and will be removed in pg@9.0 ». Ce sont de toute façon
  5 A/R en série, et cela cassera à la montée en `pg@9`.
- **Les caches de schéma se rafraîchissent sous le verrou.** Cela coûte + 11 A/R, une fois
  par minute et par réplique (≈ + 110 ms de tenue à 10 ms/A/R). C'est négligeable en
  utilisation, mais visible au p99.
- **Une app chaude peut occuper le pool d'une réplique.** Les transactions qui attendent le
  verrou **gardent leur connexion**. En fermé × 16 avec latence, le POST p50 (2,45 s) vaut
  le double de la transaction p50 (1,22 s) : la moitié du temps passe à attendre une des
  8 connexions. Sur une réplique partagée par toutes les apps, une app saturée peut ainsi
  faire attendre les autres jusqu'au délai de connexion du pool (2 s), puis provoquer un
  503. Ce mécanisme est visible ici, mais n'a pas été mesuré sur plusieurs apps à travers
  le collector.

## Sortie brute

```
[banc] montage : Postgres 17 derrière toxiproxy sur 127.0.0.1:55452
[banc] migration par le migrateur de production
[banc] — sans latence : latence 0 + 0 ms, A/R à vide p50 0.52 ms
[banc] ouvert 1 lots/s          lots/s=  1.03 util=  2.4 % tx p50/p95=22.1/124.2 ms attente p95=9.8 ms tenu p50=18.1 ms A/R=18+1 serveur/lot=3.25 ms statuts={"200":39} (pgss 747 = sonde 747 ?)
[banc] ouvert 2 lots/s          lots/s=  2.07 util=  4.3 % tx p50/p95=23.8/46.3 ms attente p95=19.2 ms tenu p50=19.3 ms A/R=18+1.03 serveur/lot=3.03 ms statuts={"200":61} (pgss 1182 = sonde 1182 ?)
[banc] ouvert 5 lots/s          lots/s=  4.26 util=  6.6 % tx p50/p95=17/32.4 ms attente p95=9.2 ms tenu p50=13.8 ms A/R=18+1 serveur/lot=2.26 ms statuts={"200":128} (pgss 2452 = sonde 2452 ?)
[banc] ouvert 10 lots/s         lots/s= 10.69 util= 16.8 % tx p50/p95=17.9/34.6 ms attente p95=16 ms tenu p50=14.4 ms A/R=18+1.01 serveur/lot=2.13 ms statuts={"200":320} (pgss 6149 = sonde 6149 ?)
[banc] ouvert 20 lots/s         lots/s= 18.86 util= 24.9 % tx p50/p95=15.5/38.4 ms attente p95=17.8 ms tenu p50=11.9 ms A/R=18+1 serveur/lot=1.86 ms statuts={"200":565} (pgss 10835 = sonde 10835 ?)
[banc] ouvert 40 lots/s         lots/s= 38.92 util= 45.7 % tx p50/p95=15.9/49.4 ms attente p95=34.9 ms tenu p50=10.8 ms A/R=18+1 serveur/lot=1.58 ms statuts={"200":1169} (pgss 22436 = sonde 22436 ?)
[banc] ouvert 60 lots/s         lots/s= 58.26 util= 68.0 % tx p50/p95=22.8/90.7 ms attente p95=74.7 ms tenu p50=10.5 ms A/R=18+1 serveur/lot=1.63 ms statuts={"200":1749} (pgss 33543 = sonde 33543 ?)
[banc] fermé ×1                 lots/s=    75 util= 77.4 % tx p50/p95=10.8/14.9 ms attente p95=0.7 ms tenu p50=9.5 ms A/R=18+1 serveur/lot=1.43 ms statuts={"200":1126} (pgss 21596 = sonde 21596 ?)
[banc] fermé ×4                 lots/s= 89.82 util= 98.3 % tx p50/p95=39.9/58.3 ms attente p95=43.2 ms tenu p50=10.2 ms A/R=18+1 serveur/lot=1.49 ms statuts={"200":1351} (pgss 25924 = sonde 25924 ?)
[banc] fermé ×16                lots/s= 87.58 util= 97.9 % tx p50/p95=85.6/123.3 ms attente p95=106.2 ms tenu p50=10.4 ms A/R=18+1 serveur/lot=1.56 ms statuts={"200":1332} (pgss 25550 = sonde 25550 ?)
[banc] collector arrêté (code 0) ; banc du verrou en processus
[banc] — avec latence : latence 3 + 3 ms, A/R à vide p50 10.27 ms
[banc] ouvert 0.5 lots/s        lots/s=   0.7 util= 11.8 % tx p50/p95=199.8/385.5 ms attente p95=191.1 ms tenu p50=165.5 ms A/R=18+1.04 serveur/lot=6.67 ms statuts={"200":56} (pgss 1085 = sonde 1085 ?)
[banc] ouvert 1 lots/s          lots/s=  1.14 util= 19.6 % tx p50/p95=206.1/349.7 ms attente p95=154 ms tenu p50=170 ms A/R=18+1.02 serveur/lot=6.58 ms statuts={"200":46} (pgss 892 = sonde 892 ?)
[banc] ouvert 2 lots/s          lots/s=  2.21 util= 37.4 % tx p50/p95=205.8/587.6 ms attente p95=395.4 ms tenu p50=158.3 ms A/R=18+1.02 serveur/lot=10.37 ms statuts={"200":66} (pgss 1267 = sonde 1267 ?)
[banc] ouvert 3 lots/s          lots/s=  3.02 util= 46.3 % tx p50/p95=189/379.8 ms attente p95=211.3 ms tenu p50=152.8 ms A/R=18+1.01 serveur/lot=5.05 ms statuts={"200":91} (pgss 1755 = sonde 1755 ?)
[banc] ouvert 4 lots/s          lots/s=  4.74 util= 71.0 % tx p50/p95=241.2/642.4 ms attente p95=465.8 ms tenu p50=148.3 ms A/R=18+1 serveur/lot=4.3 ms statuts={"200":144} (pgss 2763 = sonde 2763 ?)
[banc] ouvert 5 lots/s          lots/s=  4.86 util= 75.5 % tx p50/p95=323.2/866.6 ms attente p95=699.8 ms tenu p50=153 ms A/R=18+1.01 serveur/lot=4.93 ms statuts={"200":145} (pgss 2793 = sonde 2793 ?)
[banc] ouvert 6 lots/s          lots/s=  5.88 util= 89.4 % tx p50/p95=541.5/1191 ms attente p95=1019.6 ms tenu p50=150 ms A/R=18+1.01 serveur/lot=4.58 ms statuts={"200":178} (pgss 3413 = sonde 3413 ?)
[banc] fermé ×1                 lots/s=  5.21 util= 78.4 % tx p50/p95=177.9/201.4 ms attente p95=11.4 ms tenu p50=149.8 ms A/R=18+1 serveur/lot=3.86 ms statuts={"200":79} (pgss 1515 = sonde 1515 ?)
[banc] fermé ×4                 lots/s=  6.59 util= 99.3 % tx p50/p95=588.4/654.4 ms attente p95=473.2 ms tenu p50=148.3 ms A/R=18+1.01 serveur/lot=4.31 ms statuts={"200":102} (pgss 1968 = sonde 1968 ?)
[banc] fermé ×16                lots/s=  6.45 util= 99.1 % tx p50/p95=1223.4/1299 ms attente p95=1135.6 ms tenu p50=153.7 ms A/R=18+1 serveur/lot=5.13 ms statuts={"200":113} (pgss 2167 = sonde 2167 ?)
[banc] collector arrêté (code 0) ; banc du verrou en processus
```

Le tableau du banc du verrou est reproduit plus haut. Le JSON complet de chaque passage
(fenêtres, séquences, douze requêtes les plus coûteuses de `pg_stat_statements` par marche)
se régénère avec le pilote : il n'est pas versionné.
