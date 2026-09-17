# DEMO_SCRIPT — Démo MIP RUM en 10 minutes (DSI / responsable digital grand compte)

Objectif : faire vivre l'angle mort synthétique↔réel en moins de 3 minutes, puis dérouler.
Une seule promesse, prouvée en live. Pas de slide avant la minute 8.

## À préparer la veille (checklist)

- [ ] Console cloud accessible : **https://mip-rum-console.vercel.app** — se connecter une fois
      (login v0.3 : compte admin seedé, mot de passe dans `.secrets-v02.local.md` — jamais dans ce doc).
      Préparer aussi un compte **viewer** scopé à une seule app pour montrer le RBAC si on le demande.
- [ ] Vérifier que `plateforme.groupement-it.com` remonte des données du jour (Overview, app
      `gip-plateforme`, fenêtre 24 h) — sinon générer du trafic réel le matin.
- [ ] Une session **avec replay** enregistrée le jour J sur l'app de démo (naviguer 1-2 min sur la
      démo locale ou la plateforme avec replay activé), repérer son `session_id` dans Sessions.
- [ ] Une règle d'alerte active avec webhook vers un canal Slack/receveur visible en séance.
- [ ] Onglets ouverts dans l'ordre : [1] plateforme G-IT, [2] console Overview, [3] session replay,
      [4] /alerts, [5] /correlation. Réseau du client = imprévisible : **plan B prêt** (ci-dessous).
- [ ] Chiffres en tête : **robot 1,14 s « ok » vs LCP p75 réel 4,04 s « poor » = +254 %** sur
      `/login` (constaté en prod le 10/06/2026) ; SDK cœur **22,0 KB gzip** ; OTLP standard.

## Plan B hors-ligne (démo 100 % locale, 5 commandes)

```bash
docker compose -f apps/ingest/docker-compose.yml up -d        # Postgres :5433
docker exec -i mip-rum-db psql -U postgres -d mip_rum < apps/ingest/sql/migration-v03.sql
node apps/ingest/dev-server.mjs &                             # ingestion :4318
node demo/serve.mjs &                                         # site de démo :8080
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum pnpm --filter console dev &  # console :3000
node apps/sync-synthetic/src/sync.mjs seed                    # runs robot pour /correlation
```

Naviguer 1 min sur http://localhost:8080 (avec quelques clics et une erreur volontaire) pour
peupler la console. Même déroulé qu'en ligne, en remplaçant les URLs cloud par localhost.

## Déroulé (10 min)

### 1' — Contexte : le robot ne voit pas tout
« Vous avez déjà du monitoring synthétique : des robots qui testent vos parcours toutes les
N minutes. Indispensable — mais un robot, c'est UN scénario, UNE machine, UN réseau. Vos
utilisateurs, c'est mille combinaisons de device, réseau, cache, heure de pointe. La question
qu'on va régler : *que vivent réellement vos utilisateurs quand le robot dit que tout va bien ?* »

### 2' — Preuve live (plateforme G-IT)
Onglet [1] puis [2]. Montrer la page `/login` réelle, puis la console : « Sur cette plateforme en
production, le robot mesure **1,14 s** — état "ok", score 96. Le LCP p75 réel des utilisateurs :
**4,04 s** — "poor". **+254 % d'écart.** Personne ne le voyait. » Laisser le chiffre s'installer.
C'est LE moment de la démo ; tout le reste est de la confirmation.

### 2' — La console au quotidien
Onglet [2]. Overview : **bandeau santé** (score 0-100 : 40 % vitals, 30 % erreurs, 20 % stabilité,
10 % anomalies — formule affichée, pas une boîte noire), Core Web Vitals p75 seuils 2026, filtres
app/période/device. Puis Sessions → ouvrir une session : timeline complète (pages, vitals,
erreurs, clics). Puis Erreurs : groupées par fingerprint, occurrences, sessions touchées, stack.

### 2' — Session replay
Onglet [3], session repérée la veille, onglet « Replay » : rejouer la visite. « Le support voit ce
que l'utilisateur a vu. RGPD : opt-in par application, saisies masquées par défaut, respect du
consentement, et tout reste hébergeable chez vous. » Ne pas s'attarder — c'est attendu, pas différenciant.

### 1' — Alerting
Onglet [4]. Règles par app/route/métrique, fenêtre glissante, anti-spam. Déclencher (ou montrer)
une alerte → webhook reçu dans le canal préparé. « Format JSON générique compatible Slack ; le
moteur tourne dans la base, pas dans un SaaS tiers. »

### 1' — Angles morts & anomalies
Onglet [5]. Section « angles morts » : routes où le robot est vert et les utilisateurs en
souffrance — l'écart `/login` y apparaît. Retour Overview : badge anomalies (z-score du LCP p75
horaire vs 7 jours glissants). « Détection statistique, assumée — on vous dit comment elle marche. »

### 1' — Souveraineté & on-prem
« Tout ce que vous avez vu parle un standard : le SDK émet de l'OTLP/HTTP JSON — ouvrez les
DevTools, c'est vérifiable. Conséquence : le backend se remplace par un Collector OTel + ClickHouse
**chez vous**, sans toucher au SDK. Données en UE dès aujourd'hui, on-prem demain, réversible par
contrat. C'est l'inverse du lock-in des suites US. » Conclure : POC gratuit 30 jours sur UNE de
leurs applications, restitution des écarts robot↔réel.

## Les 5 objections probables (et les réponses honnêtes)

1. **« Et par rapport à Dynatrace ? »** — « Dynatrace est une excellente plateforme
   d'observabilité complète, avec une IA causale qu'on n'a pas et qu'on ne promet pas. On ne joue
   pas ce match. On joue : RUM **souverain et on-prem**, **standard OTel** donc réversible,
   **corrélé nativement à votre synthétique existant**, à une fraction du budget. Si votre besoin
   est la suite tout-en-un, prenez Dynatrace ; si c'est voir l'écart robot↔réel sans exporter vos
   données chez un éditeur US, c'est nous. »
2. **« Encore un agent JS qui va ralentir mon site »** — « 22,0 KB gzip pour le cœur, mesuré ;
   le replay est un module séparé chargé uniquement si activé. Envoi en arrière-plan, aucun
   traitement bloquant. Et le POC le prouve chez vous en 30 jours, snippet une ligne. »
3. **« RGPD ? Mon DPO va hurler. »** — « Pas d'IP stockée — la géolocalisation se fait par
   timezone, granularité pays. Sessions anonymisées par hash, PII nettoyée à l'ingestion, consent
   mode natif, replay opt-in avec masquage des saisies par défaut. Le pipeline est auditable ligne
   par ligne, et déployable dans votre infra. »
4. **« Ça tiendra notre volumétrie ? »** — « Le POC tourne sur Postgres ; le chemin de production
   c'est ClickHouse derrière un Collector OTel — chemin bench-é en local sur 100 000 événements
   avec les mêmes p75 que Postgres (chiffres dans `infra/clickhouse.notes.md`). On dimensionne
   ensemble pendant le POC ; on ne signe pas la volumétrie avant de l'avoir mesurée. »
5. **« Vous êtes petits / produit jeune. »** — « Exact, et c'est documenté : nos limites sont
   écrites noir sur blanc (pas de SDK mobile natif, pas de certif SOC2 aujourd'hui — cf.
   LIMITES.md). En face : MIP opère déjà votre monitoring synthétique, le produit est sur du
   standard OTel donc vos données restent à vous, et vous le validez gratuitement en 30 jours.
   Le risque d'essai est nul. »

## Après la démo

Laisser : [OFFRE.md](OFFRE.md) (positionnement + paliers indicatifs), [INTEGRATION.md](INTEGRATION.md)
(snippet + RGPD), proposition de POC datée. Ne JAMAIS improviser un prix ferme en séance.
