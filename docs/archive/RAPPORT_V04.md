# RAPPORT v0.4 — Tracing distribué front→back (11/06/2026)

> **Archivé** (dans `docs/archive/` depuis le 01/07/2026) : compte rendu de sprint du 11/06/2026, qui décrit la production d'alors (Supabase, fonctions Deno). Remplacé par [CHANGELOG.md](../../CHANGELOG.md) (§ v0.4) et [BUILD_LOG.md](../../BUILD_LOG.md) pour l'historique, par [docs/RUM_PARITY_STATUS.md](../RUM_PARITY_STATUS.md) et [docs/TOPOLOGIE_BACKEND.md](../TOPOLOGIE_BACKEND.md) pour l'état actuel.

Verdict : **la chaîne complète est codée, testée et aux ¾ en prod.** Le navigateur trace chaque appel API (traceparent W3C), le backend FastAPI répond avec son temps serveur, la console les corrèle par trace_id. Il ne manque que le redémarrage du backend G-IT sur le VPS (clé SSH en cours).

## Livré (et prouvé)

| Maillon | Preuve mesurée |
|---|---|
| **SDK 0.4.0** (fetch + XHR instrumentés) | Cœur 25,5 KB gzip (+0,8). XHR couvert car G-IT utilise axios — fetch seul = zéro span. Span front réel EN PROD : `POST /api/auth/login → 422, 272 ms` depuis plateforme.groupement-it.com, trace propagée à travers le proxy Vercel, **sans toucher au snippet** |
| **Middleware FastAPI** (1 fichier, stdlib pur) | 232 lignes, zéro dépendance ajoutée au backend client, passthrough total sans env vars. Posé sur uti-platform via PR #37 (mergée). Précision : sleep simulé 150 ms → span mesuré 152,8 ms |
| **Corrélation** | Table `rum_span` + vue `v_trace` (network_ms = total − serveur). E2E : fetch ET XHR → traceparent → FastAPI → spans front+back même trace_id → console |
| **Console /tracing** | Couverture de corrélation, p75 navigateur vs p75 serveur, part serveur par appel (barre), routes backend p75/p95/5xx, traces les plus lentes → session. Timeline session : `GET /api/... 200 · serveur 211 ms` |
| **Qualité** | 103 tests unitaires (+12) + 8 E2E (+2) + 6 unittest python, CI mise à jour |

## En prod maintenant

- Edge function `v1-traces` **v4** + migration `rum_span` + purge 30 j étendue + grants console.
- Console **v0.4** déployée (recette 6/6) : page Tracing visible après login.
- **G-IT charge déjà le SDK v0.4** : les spans front arrivent au fil des visites réelles.

## Incident assumé (et réparé)

Mon premier déploiement de l'edge function contenait un placeholder au lieu d'un fichier → **ingestion down ~3 min** (BOOT_ERROR), réparée immédiatement via le CLI Supabase, validée 200 + préflight 204. La file de retry du SDK (localStorage) a limité la perte côté clients. Leçon notée au BUILD_LOG : déployer depuis les fichiers du repo, jamais de contenu recopié.

## Ce qui reste

1. **VPS OVH** : `ssh-copy-id julian.talou@164.132.44.212` de ton côté → je déploie (env vars + deploy.sh) et je valide la corrélation front↔back sur trafic réel. C'est le seul maillon manquant.
2. **PR [mip-rum#1](https://github.com/jt33120/mip-rum/pull/1)** à merger (le classifieur m'interdit le push direct sur master — sain).
3. Toujours en attente (inchangé) : 1er tir webhook Slack depuis /alerts, clé Resend pour l'alerting email, accès API Ekara.

## Limites assumées du tracing v0.4

Un seul framework backend (FastAPI/Starlette — d'autres = ~200 lignes chacun), un seul saut (pas de propagation backend→backend, pas de spans DB). C'est le bon périmètre MVP : il répond à la question vendeuse « **la lenteur vient-elle du front, du réseau ou du serveur ?** » en un coup d'œil.
