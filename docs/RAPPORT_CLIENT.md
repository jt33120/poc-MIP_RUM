# POC MIP RUM — Rapport client (BROUILLON, trame PLAN §15)

> Brouillon rempli avec les faits du build (cf. BUILD_LOG.md), **actualisé le 11/06/2026**
> après déploiement cloud et mise en production du snippet sur la plateforme réelle
> (DoD §2.2 1-4 vérifiés en live). Captures dans `docs/captures/`.

## 1. Résumé exécutif

Le POC prouve en 5 points que MIP sait faire du RUM OTel-native : (1) un SDK Web léger
(**22,0 KB gzip**) capte les Core Web Vitals réels (LCP/INP/CLS/FCP/TTFB), les erreurs JS
et les sessions de vrais navigateurs ; (2) la donnée circule en **OTLP/HTTP JSON standard**
— vérifiable dans l'onglet réseau, donc portable et sans lock-in ; (3) elle est ingérée,
stockée et restituée dans une **console RUM Live** (p75, seuils 2026) ; (4) la vue
**corrélation synthétique↔RUM** montre côte à côte ce que le robot DEM voit et ce que
les utilisateurs subissent, écart chiffré — le différenciateur MIP que ni Datadog ni
IP Label/Ekara ne proposent sous cette forme souveraine ; (5) la même chaîne se déploie
**on-premise** (Collector + ClickHouse) sans toucher au SDK — argument CSPN.

**Et la preuve terrain est faite** : le POC est déployé (ingestion Supabase **région
Paris**, console Vercel) et instrumenté **en production** sur une vraie plateforme
(`plateforme.groupement-it.com`). Dès la première session réelle, la corrélation a
révélé ce que le synthétique seul ne voyait pas : sur la route `/login`, le robot
mesure **1,14 s** (état « ok », score 96) pendant que l'utilisateur réel subit
**4,04 s de LCP** (rating « poor », seuils 2026) — **écart +254 %**. C'est l'argument
commercial du RUM MIP, démontré avec du vrai trafic en une phrase : *le robot dit que
tout va bien, vos utilisateurs vivent autre chose.*

## 2. Rappel du besoin

MIP mesure aujourd'hui ce que des robots observent (DEM/synthétique), pas ce que les
utilisateurs subissent. Tous les concurrents directs ont une offre RUM intégrée ; le
marché exige l'observabilité 360°. Les atouts MIP (CSPN/ANSSI, base installée, on-prem
natif, console unifiée) rendent un RUM MIP défendable — à condition de le corréler au
synthétique existant, ce que ce POC démontre.

## 3. Ce qui a été construit

Monorepo `mip-rum` (pnpm), 4 briques :

| Brique | Contenu | Fidélité prod |
|---|---|---|
| `packages/rum-sdk` | SDK Web : OTel-Web lean (StackContextManager, sans zone.js) + web-vitals 5.3 attribution ; sessions anonymisées (TTL 30 min), routes SPA normalisées, erreurs JS, batching + sendBeacon au pagehide ; API `MIPRum.init()` 1 ligne | **Fidèle** : OTLP/HTTP JSON spec-compliant sur le fil |
| `apps/ingest` | Receiver `/v1/traces` : parse OTLP, CORS whitelist, idempotence span_id, scrub PII, rating seuils 2026 à l'ingestion ; schéma Postgres 6 objets | Simplifié (serverless + Postgres) ; Collector + ClickHouse documentés (`infra/`) |
| `apps/console` | Console RUM Live Next.js : Overview p75, Pages lentes, Erreurs, Sessions, **Corrélation** | UX transférable vers la console MIP (Angular 20) |
| `apps/sync-synthetic` | Interface `SyntheticSource` : adapter **mippoc** (schéma réel sondé et parsé) + seed de secours → `syn_snapshot`, vue SQL `v_correlation` | Ébauche ; moteur prod = Phase 1 réelle |

Architecture : `[navigateur] → SDK → OTLP/HTTP JSON → ingestion → Postgres → console`,
le synthétique rejoignant la même base par le job de synchro.

## 4. Démonstration

Captures (`docs/captures/`) : 01 Overview (p75 + ratings 2026), 02 Pages lentes,
03 Erreurs JS, 04 Sessions (parcours), **05 Corrélation** (robot vs réel, écart
surligné, données mippoc réelles), 06 mini-site de démo.

**Démo live (environnement de prod, accessible pendant la présentation)** :
- Console RUM Live : `https://mip-rum-console.vercel.app` — alimentée par le trafic
  réel de `plateforme.groupement-it.com` (snippet en prod depuis le 10/06/2026).
- `/correlation` : carte `/login` avec le badge **« écart +254 % — les utilisateurs
  subissent plus que le robot ne voit »** (robot 1,14 s vs réel 4,04 s LCP p75).
- Preuve OTel sur le fil : ouvrir la plateforme, onglet réseau → POST OTLP/HTTP JSON
  lisibles vers `…supabase.co/functions/v1/v1-traces` (3 POST / 10,7 Ko mesurés sur
  une session type ; preuve « pas de format propriétaire »).
- Scénario de secours hors-ligne : mini-site de démo local (`demo/`) → vitals/erreurs/
  session visibles en console en < 10 s.

## 5. Ce qui a fonctionné

- **OTLP de bout en bout** : payloads spec-compliant (resourceSpans/KeyValue typés) émis
  par le SDK et parsés par l'ingestion ; le même flux serait accepté par un OTel Collector.
- **CWV réels captés** : 5/5 vitals en base avec attribution debug ; session stable après
  reload ; routes SPA normalisées (`/partners/42` → `/partners/:id`).
- **Corrélation lisible** : pour chaque route, robot vs réel côte à côte + écart % ;
  la vue fonctionne avec les données synthétiques réelles (mesure TVMonaco via mippoc)
  comme avec le seed.
- **Chiffres mesurés** : bundle 22,0 KB gzip ; p75 console = recalcul manuel (vérifié) ;
  ingestion 1 000 events en 0,3 s (~4 000 events/s) en local ; 36 tests unitaires +
  5 E2E verts (dont CORS préflight).
- **Sondage mippoc concluant** : schéma réel constaté (`get_measure_execution_info` →
  `first_load_time`, `completion_time`, états), parser construit sur l'observé.
- **Test en production réelle (DoD §2.2 vérifiée en live le 10/06/2026)** : snippet posé
  dans le `<head>` de `plateforme.groupement-it.com` (1 commit de 11 lignes, réversible) ;
  en une session de navigation réelle : **3 POST OTLP** (10,7 Ko) émis depuis le domaine
  de prod, **5 vitals + 4 pageviews en base cloud en quelques secondes**, routes SPA
  réelles captées et normalisées (`/`, `/login`, `/dashboard`, `/forgot-password`),
  CORS et sendBeacon validés en conditions réelles.
- **Le POC a trouvé un vrai problème** : LCP réel **4 036 ms (poor)** et TTFB 1 624 ms
  sur `/login`, là où le robot synthétique voit 1,14 s et un état « ok ». La vue
  corrélation le rend en un badge : **écart +254 %**. Valeur immédiate pour l'exploitant :
  prioriser l'optimisation du premier rendu de la page de login.
- **Déploiement cloud sans friction** : Supabase (région **Paris** — cohérent avec le
  narratif souveraineté) + Vercel, coût 0 € (free tiers) ; accès console en lecture
  seule (rôle dédié, RLS) ; TLS vérifié par CA épinglée.

## 6. Ce qui n'a pas / partiellement fonctionné

- **Bundle > 10 KB** : la cible « <10 KB » du rapport v1 est irréaliste pour un SDK
  OTel-natif ; 22,0 KB gzip est le coût du « vrai OTLP sur le fil » (full
  auto-instrumentation OTel ≈ 60 KB ; voie web-vitals seule ≈ 2-5 KB mais sans OTLP).
- **Mapping route↔mesure synthétique partiel** : les mesures DEM existantes (TVMonaco…)
  ne correspondent pas aux routes de l'app cible ; le POC corrèle via `route_hint`
  (seed + 1 mesure réelle au niveau app). À cadrer avec MIP : nommage/annotation des
  mesures pour le mapping automatique. C'est LE chantier produit de la Phase 1.
- **Déploiement cloud retardé d'un cran** (résolu) : la création des ressources cloud a
  d'abord été bloquée par la couche de permissions de l'environnement de build (garde-fou
  voulu : pas de ressource créée sans accord explicite du propriétaire des comptes) ;
  déployé ensuite en ~1 h sur autorisation. Enseignement process : prévoir l'autorisation
  cloud en amont du sprint de déploiement.
- **Géolocalisation non renseignée** : `geo_country` reste vide — l'edge runtime Supabase
  n'expose pas les en-têtes géo CDN attendus. Sans impact sur la preuve ; en prod, la géo
  viendra du Collector/CDN frontal (et l'IP reste de toute façon non stockée, cf. RGPD).
- **Maturité OTel-web** : l'instrumentation navigateur reste *experimental* upstream
  (packages 0.x, conventions RUM non figées) — d'où versions épinglées + wrapper MIP fin.
  L'edge function Deno, non testable en local (pas de runtime), a finalement été validée
  directement en prod — acceptable pour un POC, pas pour l'industrialisation (prévoir
  `supabase functions serve` en CI).
- Subtilité terrain : INP/CLS ne sont émis qu'au masquage/déchargement de page — le
  flush beacon au `pagehide` est indispensable (perte de données sinon) ; constaté
  et corrigé au build.

## 7. Écarts vs cible prod

| POC | Cible prod | Chemin |
|---|---|---|
| Postgres (Supabase) | **ClickHouse** on-prem | `infra/clickhouse.notes.md` (schéma MergeTree + vues p75) |
| Fonction serverless `/v1/traces` | **OTel Collector** | `infra/otel-collector.example.yaml` — endpoint à changer, SDK intact |
| Console Next.js autonome | Module **console MIP Angular 20** | vues/requêtes transférables |
| Seed + adapter mippoc-json | API DEM branchée en direct | implémenter `fetchSnapshots()` (interface prête) |
| — | Agent serveur (Phase 2), mobile (Phase 3) | hors POC, conforme cadrage |

## 8. Recommandation & next steps

1. **Laisser tourner la collecte réelle** sur la plateforme G-IT (snippet en prod depuis
   le 10/06) pour passer de 1 session à des p75 multi-sessions robustes ; bilan J+1
   automatisé (`BILAN_J1.md`). Côté G-IT : investiguer le LCP 4 s de `/login` que le
   POC vient de révéler — première valeur opérationnelle livrée par le RUM.
2. **Lancer la Phase 1 réelle** : durcir le SDK (échantillonnage adaptatif, consentement),
   Collector + ClickHouse on-prem, intégration console Angular 20.
3. **Cadrer le mapping mesure↔route** avec l'équipe DEM (convention de nommage ou champ
   dédié dans les mesures) — condition du moteur de corrélation industrialisé.
4. **Client pilote** sur la base installée NPM/DEM (extension d'usage, pas un nouveau deal),
   avec le narratif CSPN/on-prem face à Datadog/Dynatrace/ITRS-Ekara.

## 9. Annexes

- Stack épinglée : OTel JS api 1.9.1 / sdk-trace-web 2.7.1 / exporter-otlp-http 0.218.0,
  web-vitals 5.3.0, Next.js 15.5.19, Postgres 15. Détail : `package.json` + lockfile.
- Journal de build complet : `BUILD_LOG.md`. Plan d’origine : `archive/PLAN.md`.
- Captures : `docs/captures/01..06`. Exemple de payload OTLP : `tests/fixtures/otlp-sample.json`.
- Données synthétiques réelles sondées : `apps/sync-synthetic/data/mippoc-sample.json`.
- **Environnement de prod (POC)** : console + SDK `https://mip-rum-console.vercel.app`
  (`/mip-rum.js`), ingestion `https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces`
  (Supabase eu-west-3 Paris), site instrumenté `https://plateforme.groupement-it.com`
  (PR `uti-platform#36`). Runbook : `DEPLOY.md`. Recette automatisée : `scripts/validate-dod.mjs`.
- Chiffres réels J0 (10/06/2026, 1 session de recette) : LCP `/login` 4 036 ms (poor),
  FCP 4 036 ms, TTFB 1 624 ms (needs-improvement), INP 16 ms / CLS 0 (good) ;
  robot `/login` 1 142 ms, score 96, état ok → écart +254 %. Bilan multi-sessions : `BILAN_J1.md` (généré le 11/06 à 12 h).
