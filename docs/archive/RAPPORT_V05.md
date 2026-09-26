# RAPPORT v0.5 — Onboarding clients self-service (11/06/2026, sprint jour 2)

> **Archivé** (dans `docs/archive/` depuis le 01/07/2026) : compte rendu de sprint du 11/06/2026, qui décrit la production d'alors (Supabase, fonctions Deno). Remplacé par [CHANGELOG.md](../../CHANGELOG.md) (§ v0.5) et [BUILD_LOG.md](../../BUILD_LOG.md) pour l'historique, par [docs/RUM_PARITY_STATUS.md](../RUM_PARITY_STATUS.md) et [docs/TOPOLOGIE_BACKEND.md](../TOPOLOGIE_BACKEND.md) pour l'état actuel.

Verdict : **la console sait maintenant ajouter un client toute seule** — zéro SQL, zéro redéploiement, guide pas-à-pas intégré, vérification live. C'était le dernier maillon « produit » manquant côté code (hors accès tiers type API Ekara).

## Ce que ça change concrètement

Avant (v0.4) : ajouter un client = insert SQL à la main dans `app_registry` + **redéployer les edge functions** (origines CORS codées en dur) + envoyer un guide d'intégration générique par mail.

Maintenant (v0.5) : **Console → Clients → Ajouter un client** (2 minutes) :

1. **Formulaire** : nom, identifiant, domaines du site → clé d'API générée, affichée une seule fois (stockée hashée), tout audité.
2. **CORS dynamique** : les domaines autorisés vivent en base et sont pris en compte en ≤ 60 s par l'ingestion (edge v1-traces v5, v1-replay v2, dev-server). Modifiables à chaud depuis le wizard.
3. **Wizard 5 étapes** : snippet prérempli copiable (+ variante consentement RGPD, notes CSP, placement par framework) ; middleware backend téléchargeable — FastAPI (celui qui tourne en prod chez G-IT, piège pydantic-settings documenté) et **Express/Connect (nouveau, zéro dépendance, testé)** ; protocole générique pour toute autre stack.
4. **Checklist live** : « premières Web Vitals ✅ 12:03 », sessions 24 h, spans front, spans back — la page se rafraîchit toute seule, l'agent MIP voit l'intégration réussir en direct.
5. **Accès client** : création d'un compte viewer scopé prérempli (le client ne voit que son app).

## Assistant IA (la partie « assisté par l'IA »)

Encart dans le wizard : « backend Django 4 derrière nginx » ou « le snippet est posé mais rien n'arrive » → l'assistant génère le middleware adapté ou le diagnostic. Il connaît le protocole exact et les pièges **vécus** (pydantic-settings qui n'exporte pas os.environ, proxys qui avalent les headers, CSP, snippet hors `<head>`).

- Admin only, rate-limité, activé par `MISTRAL_API_KEY` (souverain 🇫🇷, prioritaire — défaut `mistral-large-latest`) ou `ANTHROPIC_API_KEY` (`claude-sonnet-4-6`) ; modèle surchargeable via `ASSIST_MODEL`.
- **Sans clé : l'encart s'affiche désactivé et tout le reste fonctionne** — le wizard déterministe est le chemin nominal, l'IA est le bonus pour le delta contextuel.

C'est la réponse à « peut-on automatiser l'intégration ? » : le déterministe (création, clé, CORS, snippet, templates) est fait par la console ; le contextuel (stack exotique, debug) par l'IA ; il ne reste à l'humain que coller deux blocs de code chez le client.

## Preuves (tout est vert)

| Vérification | Résultat |
|---|---|
| Unitaires | **115/115** (+12 : validations slug/origines/clé, dérivation de statut, snippet, middleware Express réel testé contre le parser de l'ingestion) |
| E2E Playwright | **10/10** (+2 : création → clé one-shot non réaffichable → snippet généré → ingestion réelle au nom du client → checklist verte + badge live ; lien viewer prérempli) |
| Typecheck console | propre |
| Course seed-admin (2 specs parallèles) | constatée puis corrigée : compte admin dédié par spec |

## Honnêteté — limites

1. **Pas encore déployé en prod** (migration v05 + edge v5/v2 + console) — à faire sur ton GO, ~10 min, réversible.
2. L'assistant IA n'est actif qu'avec une clé Anthropic dans les env Vercel (sinon encart désactivé, assumé).
3. Templates backend : FastAPI prouvé en prod, Express testé unitairement ; les autres stacks passent par le protocole + l'IA (pas de template Django/Spring/PHP « officiel » à ce stade).
4. La création de compte viewer reste sur /admin/users (préremplie) — pas de « envoyer les identifiants par mail » (il n'y a pas d'emailing dans le produit).

## Architecture (pour mémoire)

- `apps/ingest/sql/migration-v05.sql` — `app_registry.allowed_origins text[]`, `created_by`, `notes`
- `apps/console/lib/onboarding.ts` — logique pure (validations, statut, snippet) ; `lib/queries-customers.ts` — liste + sonde
- `apps/console/app/admin/customers/` — liste + actions ; `[appId]/page.tsx` — wizard
- `apps/console/app/api/assist/route.ts` — assistant (fetch direct API Anthropic, zéro dépendance npm)
- `apps/console/public/integrations/` — `mip_rum_middleware.py` (prod-proven), `mip-rum-express.js` (nouveau)
- Edge : `v1-traces` v5, `v1-replay` v2 (origines base ∪ socle statique, cache 60 s)
