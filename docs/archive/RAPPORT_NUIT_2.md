# RAPPORT DE NUIT 2 — Sprint v0.3 (11/06/2026, GO « zéro limite »)

Verdict : **les 5 chantiers sont verts, déployés en prod, recette complète passée.** La liste « pas fait » de la nuit 1 est purgée, et 6 des limites « Phase 1+ » sont tombées.

## Livré cette nuit (et prouvé)

| Chantier | Preuve mesurée |
|---|---|
| **Session replay** (rrweb, masquage par défaut, opt-in, consent-aware) | Recette 10/10 : session enregistrée sur la démo → chunks gzip en base → **rejouée dans la console** (E2E player vert) ; saisie « secret… » **absente du flux** (masquage prouvé). Bundle cœur 24,7 KB gzip (+0,9), replay séparé lazy-loadé 56,7 KB |
| **Alerting sortant** (webhooks) | 9/9 : `check_alerts()` → `alert_delivery` → **POST réellement reçu** par un récepteur de test, payload Slack-compatible, statut `sent` tracé. Cloud : pg_net en place (premier tir réel à faire depuis /alerts) |
| **RBAC / multi-utilisateurs** | 11/11 : login bcrypt+JWT, viewer scopé ne voit pas les autres apps (testé), gestion utilisateurs, audit_log, anti-énumération, anti-lockout. **Login actif sur la console prod** (6/6 en recette cloud) |
| **Geo RGPD-friendly** | timezone→pays (zéro IP stockée) : session réelle de `plateforme.groupement-it.com` → **geo_country = 'FR' en prod** |
| **Rate limit durable** | compteur SQL partagé : 600 acceptées / 601e refusée, prouvé sur 2 connexions simulant 2 isolats |
| **ClickHouse** (chemin prod) | Bench réel 100 k events : **p75 identiques à 0 ms près** PG vs CH ; CH ×2,2 sur les séries horaires, ×12 sur les sessions distinctes, **disque ×15 plus petit** (1,2 vs 17,8 MB). La console peut migrer sans renuméroter un seul graphe |
| **Anomalies + health score** | z-score 7 j (anomalie test détectée à z=352), score composite 0-100 vérifié à la main (72 « Dégradé » / 35 « Critique » conformes au calcul SQL) |
| **Kit de vente** | `docs/OFFRE.md` (comparatif honnête vs Datadog/Dynatrace/Ekara, pricing indicatif 3 paliers) + `docs/DEMO_SCRIPT.md` (déroulé 10 min DSI, 5 objections avec réponses) |

Qualité : **91 tests unitaires + 6 E2E verts, CI GitHub verte**, 7 commits poussés.

## En prod maintenant

- Edge functions : `v1-traces` **v3** (geo, rate limit durable, clés) + `v1-replay` **v1** (4/4 smoke tests).
- Console : **page de login** (ton compte : `julian@mip-rum.local`, mot de passe dans `.secrets-v02.local.md` ligne « Console CLOUD admin ») ; le basic auth est retiré.
- Le vrai site G-IT charge le **SDK v0.3** (toujours sans toucher au snippet) : tz/geo actifs immédiatement. **Replay volontairement OFF sur G-IT** — à activer seulement après décision RGPD (bandeau/consentement sur le site) ; il est ON sur la démo.

## Honnêteté — ce qui reste

1. **Webhook cloud non tiré en réel** : le chemin pg_net est déployé et la mécanique prouvée en local de bout en bout ; le classifieur de permissions a (sainement) refusé que je déclenche moi-même une alerte de test en prod. 1er tir réel : créer une règle avec ton URL Slack dans `/alerts` → « Évaluer maintenant ».
2. **Replay sur G-IT** : décision produit+RGPD à prendre (consentement), pas un manque technique.
3. Les barrières enterprise de fond demeurent (cf. LIMITES.md §v0.3) : mobile natif, certifications SOC2/CSPN, support 24/7, multi-région, mapping auto route↔mesure DEM — c'est du temps et de l'organisation MIP, pas une nuit de code.
4. Le pitch reste « **RUM souverain corrélé au synthétique** », pas « équivalent Dynatrace » — `docs/OFFRE.md` et le script de démo assument la comparaison honnêtement (créneau, souveraineté, prix, lock-in).

## Tes actions au réveil

1. Connecte-toi : https://mip-rum-console.vercel.app (credentials « Console CLOUD admin » du fichier secrets). Regarde une session → onglet **Replay** sur la démo locale, `/alerts`, `/admin/users`.
2. Branche ton Slack : `/alerts` → nouvelle règle avec ton webhook → « Évaluer maintenant ».
3. Lis `docs/DEMO_SCRIPT.md` avant ton premier rendez-vous — tout le déroulé y est, chiffres réels inclus.
4. Le point de midi (`point-rum-uti-j1`) tournera comme prévu sur le trafic réel.
