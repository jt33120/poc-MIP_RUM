# Cadrage — 2ᵉ mode RUM : extension navigateur (MV3)

> **Objectif produit** : offrir au catalogue MIP RUM un **second capteur** de collecte,
> complémentaire du SDK embarqué. Le SDK actuel exige que le client pose un `<script>`
> dans son code ; l'extension observe les pages **sans intégration dev** — soit pour
> monitorer un site qu'on ne contrôle pas (audit, avant-vente), soit comme mode de
> déploiement alternatif pour un client (poussée par politique d'entreprise, sans toucher
> son front). **Un seul catalogue, deux capteurs.**

> **Statut au 26/09/2026.** Cadrage du 09/07/2026 ; les quatre lots (Ext-A à Ext-D, §8) sont
> livrés, et l'extension est en version 0.4.3 (`apps/extension/manifest.json`), toujours non
> publiée sur le Chrome Web Store. Le code s'écarte du cadrage sur quelques points, signalés
> en place : pas de `content_scripts` (le service worker injecte par `chrome.scripting`), cache
> de résolution en mémoire, préséance vérifiée avant l'injection, popup à autorisation par
> domaine plutôt qu'à interrupteur. L'ingestion n'est plus une edge function Supabase : c'est
> la route de la console sur Vercel (`/api/ingest/v1/traces`). S'y ajoute un inventaire de parc
> (battement `POST /api/extension/heartbeat`, écran `/admin/extension-installs`,
> migration-v52) que ce cadrage ne prévoyait pas. État de référence : `apps/extension/README.md`.

---

## 0. Décisions de cadrage (verrouillées avec le PO le 2026-07-09)

| Sujet | Décision | Conséquence |
|---|---|---|
| **Cas d'usage** | (1) monitorer des sites sans intégration dev **+** (3) alternative d'intégration plus simple pour le client | L'extension doit gérer des domaines **qu'elle ne maîtrise pas** → registre `domaine → app_id` obligatoire. |
| **Cible utilisateur** | (2) employés du client (poste géré) **+** (3) grand public | Voir ⚠️ ci-dessous : le POC ne couvre QUE la cible « poste géré ». |
| **Intégration données** | Recommandation retenue → **même pipeline, même `app_id`, tag `collection_source`** | Zéro nouvelle page console ; le catalogue existant (`/sessions`, `/pages`, `/errors`, alertes, DSAR) fonctionne tel quel, avec un filtre SDK vs extension en plus. |
| **Périmètre POC** | Chrome/Edge **Manifest V3 uniquement**, **non publié** (sideload / policy self-hébergée) | Pas de review Chrome Web Store dans ce POC ; Firefox = hors périmètre. |

### ⚠️ Tension « non publié » × « grand public » — hypothèse de cadrage

Une extension **non publiée** ne peut être installée que de deux façons : (a) sideload manuel
en mode développeur, (b) **force-install par politique d'entreprise** (`ExtensionInstallForcelist`
Chrome/Edge, sur postes gérés). Aucune des deux n'atteint le **grand public** — ça exigerait
une fiche Chrome Web Store publique (donc review, politique de confidentialité, permissions
resserrées).

**Décision de cadrage** : le POC couvre **uniquement la cible « employés du client / poste
géré »**. La cible grand public devient une **Phase 2** (publication store), explicitement
hors de ce lot. Ce document chiffre le POC ; la Phase 2 est esquissée au §7.

---

## 1. Principe & topologie

```
┌─ Poste employé (Chrome/Edge géré) ────────────────┐
│                                                    │
│  Extension MV3                                      │
│   ├─ service worker (background)                    │
│   │    └─ résout : domaine visité → app_id ?        │   ← registre extension_scope
│   │        (sinon : ne rien injecter)               │
│   └─ content script (MAIN world)                    │
│        └─ CHARGE le SDK existant (mip-rum.js)       │   ← packages/rum-sdk, tel quel
│             puis MIPRum.init({appId, endpoint,…})   │
│                        │                            │
└────────────────────────┼───────────────────────────┘
                          ▼
        OTLP/HTTP  →  ingestion (au cadrage : edge function v1-traces ;
                      aujourd'hui : /api/ingest/v1/traces de la console)  →  Postgres
                                                    (rum_session.collection_source = 'extension')
```

**Idée-force** : le moteur de collecte **ne change pas**. Le SDK (`packages/rum-sdk`) est du
JS navigateur pur (PerformanceObserver, interception fetch/XHR, `window.onerror`, vitals…) —
rien dans `index.ts` ne suppose un `<script>` posé par un dev. L'extension n'est qu'un **nouveau
point d'entrée** qui décide *où* et *avec quel `appId`* injecter ce même SDK.

---

## 2. Architecture données — le tag `collection_source`

### 2.1 Ce qu'on ajoute

Une colonne **`collection_source text not null default 'sdk'`** sur `rum_session`
(valeurs : `'sdk' | 'extension'`). Les tables filles (`rum_metric`, `rum_error`,
`rum_pageview`, `rum_event`, …) héritent de la source **par jointure** sur `session_id` —
on ne duplique pas la colonne partout (une seule source de vérité, cohérent avec la façon dont
`is_bot` est déjà porté par `rum_session`).

### 2.2 Comment la source arrive jusqu'à la base

Le SDK émet déjà des attributs `mip.*` sur chaque span (au cadrage, `realEmit` dans
`index.ts:68` ; aujourd'hui, les attributs communs de `packages/rum-sdk/src/index.ts`, où
`mip.collection_source` est posé).
On ajoute **un attribut `mip.collection_source`**, posé une seule fois à l'init :

- SDK classique (script posé par le dev) → l'attribut vaut `'sdk'` (défaut).
- SDK chargé par l'extension → le point d'entrée extension passe une **nouvelle option de
  config** `collectionSource: 'extension'` (cf. §3.3), qui alimente cet attribut.

L'ingestion (aplatissement OTLP → colonnes : au cadrage l'edge function `v1-traces`,
aujourd'hui `flattenOtlp` de `packages/backend/shared/otlp.mjs`) écrit la valeur dans
`rum_session.collection_source` à la création de session. **Aucune migration de données
existante** : tout ce qui existe déjà reste `'sdk'` (le défaut).

### 2.3 Ce que ça débloque côté console — SANS écrire de nouvelle page

- **Segment engine** (`lib/segments.ts`) : on ajoute `collection_source` à la **liste blanche
  de colonnes** (SQL paramétré, anti-injection) → l'utilisateur peut segmenter/comparer
  « SDK vs extension » dans **n'importe quelle** page existante.
- **Project switcher** : inchangé (même `app_id`).
- **DSAR / RGPD** : inchangé — la source est un attribut technique, pas une PII ; l'effacement
  par `session_id` couvre déjà les deux capteurs.

### 2.4 Pièges data à traiter (design Ext-A)

- **Double comptage** : un employé du client qui visite le **propre site du client** (déjà
  instrumenté par le SDK) verrait DEUX capteurs actifs → sessions/vitals comptés deux fois.
  → **Règle de préséance** (§4.2) : l'extension **recule** si `window.MIPRum` existe déjà.
- **Comparabilité des métriques** : l'extension et le SDK ne captent pas *exactement* la même
  chose (l'extension s'injecte parfois après le premier paint → certains vitals « early »
  peuvent manquer). → On **segmente** toujours par `collection_source` dans les moyennes ; on
  ne les fond jamais silencieusement. Documenté sur les pages concernées.

---

## 3. Architecture extension — le registre `extension_scope`

### 3.1 Pourquoi un registre

Le SDK classique : **le développeur** choisit son `appId` en dur dans son `MIPRum.init(...)`.
L'extension observe des domaines qu'elle ne maîtrise pas — elle doit **résoudre** le domaine
visité vers un `app_id` connu, et surtout **ne rien faire** sur un domaine non enregistré.
Sans ça, l'extension aspirerait des données sur *tout* site visité par l'employé — hors
périmètre contractuel et hors RGPD.

### 3.2 Table `extension_scope`

Même schéma/esprit que `read_tokens` (v26) et `goal` (v25) — table admin, gérée depuis la
console :

```sql
create table if not exists extension_scope (
  id          bigserial primary key,
  domain      text not null,             -- ex. "app.client.fr" (hostname exact, sans port)
  app_id      text not null,             -- app_id MIP cible pour ce domaine
  endpoint    text,                      -- override d'endpoint d'ingestion (null = défaut prod)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (domain)
);
```

- Résolution : **hostname exact** (pas de wildcard dans le POC — plus simple, plus sûr ;
  wildcard = évolution possible en Phase 2 si besoin).
- `active=false` → l'extension n'injecte pas (kill-switch par domaine, sans supprimer la ligne).

### 3.3 Nouveau point d'entrée SDK

Deux petites additions à `packages/rum-sdk/src/types.ts` (`MIPRumConfig`) :

```ts
collectionSource?: 'sdk' | 'extension';  // défaut 'sdk' — porté dans mip.collection_source
// (endpoint/appId déjà existants, résolus par l'extension via le registre)
```

Le cœur de `init()` **ne bouge pas**, on ajoute juste l'attribut dans `realEmit`. Le bundle
`mip-rum.js` reste **strictement identique** pour l'usage script classique (nouvelle option
optionnelle, défaut rétro-compatible). Règle du repo respectée : rebuild SDK + `cmp` byte-for-byte
du `public/mip-rum.js` copié.

---

## 4. Composants de l'extension (MV3)

### 4.1 `manifest.json` (MV3)

- `manifest_version: 3`
- **PAS de `<all_urls>`** dans `host_permissions`. Le service worker demande l'accès à un
  domaine **seulement** s'il est dans `extension_scope` (permissions dynamiques via
  `chrome.permissions`, ou pré-accordées par la policy entreprise — cf. §6).
- `content_scripts` injecté en **MAIN world** (`"world": "MAIN"`, Chrome/Edge ≥ 111) : la page
  voit le SDK exactement comme un `<script>` classique, avec accès à `window`/`performance`.
  *Livré autrement* : aucun `content_scripts` dans le manifest ; le service worker injecte
  `vendor/mip-rum.js` par `chrome.scripting.executeScript({ world: "MAIN" })` (permission
  `scripting`), et l'accès aux hôtes est demandé par origine (`optional_host_permissions`).
- Service worker `background` pour la résolution domaine → app_id.

### 4.2 Service worker (résolution + préséance)

1. À chaque navigation (`chrome.webNavigation` / `tabs.onUpdated`), lit le hostname.
2. Interroge le registre (via l'API console — endpoint lecture cache-friendly, cf. §5), ou un
   snapshot mis en cache (`chrome.storage.local`, TTL court). *Livré* : cache en mémoire du
   service worker, 60 s ; en cas de panne réseau, repli sur le dernier verdict connu.
3. Si domaine **absent ou inactif** → **ne rien injecter** (aucun content script, aucune requête).
4. Si présent → injecte le content script avec `{appId, endpoint, collectionSource:'extension'}`.
5. **Préséance** : le content script vérifie `if (window.MIPRum) return;` **avant** de charger
   le SDK — si le site est déjà instrumenté (script dev présent), l'extension s'efface (anti
   double-comptage, §2.4). *Livré* : c'est le service worker qui sonde `window.MIPRum` en MAIN
   world avant d'injecter (`probeSdkPresent`, `decideInjection` dans `apps/extension/lib/scope.ts`).

### 4.3 Popup (transparence — exigence RGPD)

Un popup minimal, au ton/design de la console MIP :
- État courant : **« MIP RUM observe : `app.client.fr` »** (ou « domaine non suivi »).
- Toggle actif/inactif **local** (l'employé peut suspendre — traçabilité honnête).
- Lien vers la politique de confidentialité MIP.

*Livré* : l'état courant, un bouton « Activer sur ce domaine » (demande de permission) ou
« Retirer l'autorisation pour ce domaine », et une note de transparence. Le lien du pied de
popup mène à `/presentation`, pas à la politique de confidentialité de l'extension
(`/extension-privacy`).

> La transparence n'est pas cosmétique : une extension qui collecte sans l'indiquer est un
> problème RGPD **et** un motif de rejet store (pour la Phase 2). On la construit dès le POC.

### 4.4 Admin console (gérer le registre)

Nouvelle page `/admin/extension-scope` — **clone du pattern `/admin/read-tokens`** déjà en
place (Server Actions + `requireAdmin()` + `audit_log`) : lister / ajouter / activer-désactiver
un couple `(domain, app_id)`. Zéro invention d'architecture — on réutilise le moule.

---

## 5. Contrat d'API pour l'extension

Le service worker a besoin de **lire le registre** (quel `app_id` pour ce domaine ?). Deux
options, à trancher en Ext-B :

- **Option simple (recommandée POC)** : endpoint public **en lecture seule**, cache-friendly
  `GET /api/extension/resolve?domain=<host>` → `{app_id, endpoint, active}` ou `404`. Pas de
  secret dans l'extension (une extension distribuée = pas de secret sûr de toute façon). Le
  registre ne contient pas de PII ; l'exposer en lecture est acceptable. Rate-limité + caché.
- Option scellée : signer un snapshot du registre poussé par policy. Plus lourd, Phase 2.

> ⚠️ **Ne jamais mettre de token secret dans l'extension** — le bundle est lisible par
> l'utilisateur. Le modèle de sécurité repose sur : (a) `<all_urls>` interdit, (b) registre
> côté serveur qui décide, (c) endpoint d'ingestion qui accepte déjà l'app_id sans secret
> (comme le SDK aujourd'hui).

---

## 6. Déploiement du POC (non publié)

- **Dev/interne** : sideload (`chrome://extensions` → mode développeur → charger le dossier).
- **Client (poste géré)** : extension packagée `.crx` self-hébergée + policy
  `ExtensionInstallForcelist` + `ExtensionSettings` (pré-accord des `host_permissions` pour les
  domaines du client) poussée par l'IT du client (GPO / Intune / Google Admin).
- Doc de déploiement livrée (Ext-D) : manifeste de policy exemple + procédure IT.

---

## 7. Phase 2 (hors POC — pour mémoire)

- **Publication Chrome Web Store** (cible grand public) : fiche, politique de confidentialité,
  permissions minimales, review. Firefox (WebExtensions) en parallèle si besoin marché.
- **Wildcard de domaine** dans le registre (`*.client.fr`).
- **Snapshot signé** du registre (au lieu de l'endpoint public).
- **Capture enrichie** propre à l'extension (réseau détaillé, console) que le SDK ne voit pas —
  si un cas d'usage « debug support » se confirme.

---

## 8. Découpage en lots (1 lot = 1 PR draft, rythme habituel)

| Lot | Contenu | Cœur pur + testé | Ordre de grandeur | Statut |
|---|---|---|---|---|
| **Ext-A** | Migration `extension_scope` (v27) + colonne `collection_source` sur `rum_session` + câblage edge function `v1-traces` + `collection_source` dans le segment engine (allowlist) + `collectionSource` dans le SDK (`types.ts` + `realEmit`, rebuild + `cmp`) | `lib/segments.ts` (test), résolution registre pure | **2–3 j·h** | ✅ livré |
| **Ext-B** | Squelette extension MV3 : `manifest.json`, service worker (résolution domaine→app_id, préséance), content script MAIN world qui charge le SDK + endpoint `GET /api/extension/resolve` | logique de résolution pure + testée | **3–4 j·h** | ✅ livré |
| **Ext-C** | Popup transparence (domaine suivi / toggle local) + page admin `/admin/extension-scope` (clone `read-tokens`) | Server Actions + audit_log | **2–3 j·h** | ✅ livré |
| **Ext-D** | Packaging POC (clé de signature stable, ID d'extension figé, doc de déploiement `docs/DEPLOY_EXTENSION.md` : sideload + policy d'entreprise self-hébergée) | — | **1–2 j·h** | ✅ livré |

**Total POC ≈ 8–12 j·h — POC complet.** (Phase 2 — publication store, grand public — non chiffrée ici, cf. §7.)

### Dépendances / séquencement
- Ext-A **d'abord** (le schéma et le tag conditionnent tout le reste).
- Ext-B dépend de Ext-A (le registre doit exister).
- Ext-C et Ext-D dépendent de Ext-B.
- Chaque lot : `tsc` + `next build` + `vitest` verts, PR draft, merge par le PO, puis lot suivant
  (on ne stacke jamais sur de l'historique déjà mergé — on repart de `master`).

---

## 9. Risques & points de vigilance

| Risque | Mitigation |
|---|---|
| **Double comptage** (SDK + extension sur le même site) | Règle de préséance `if (window.MIPRum) return;` (Ext-B), testée. |
| **Injection MAIN world** requiert Chrome/Edge ≥ 111 | Vérifier la version minimale du parc client (Ext-D) ; repli `world:ISOLATED` + pont `postMessage` si parc ancien. |
| **Sur-collecte / RGPD** | `<all_urls>` interdit ; registre serveur ; popup de transparence ; DNT/GPC déjà honorés par le SDK (`privacy.ts`, Lot 5) et donc **hérités gratuitement** par l'extension. |
| **Secret dans le bundle** | Aucun secret embarqué ; modèle de confiance = registre serveur + endpoint sans secret. |
| **Comparabilité métriques SDK vs extension** | Toujours segmenter par `collection_source` ; ne jamais fondre les moyennes en silence. |
| **« Grand public » attendu trop tôt** | Cadré explicitement en Phase 2 (§0, §7) ; le POC = poste géré uniquement. |

---

## 10. Ce qui est réutilisé (zéro réinvention)

- **Moteur de collecte** : `packages/rum-sdk` entier, inchangé (nouveau point d'entrée seul).
- **Pipeline d'ingestion** : edge function `v1-traces` + Postgres, +1 colonne (depuis, la
  route d'ingestion de la console remplace l'edge function).
- **Pattern migration** : `read_tokens` (v26), `goal` (v25).
- **Pattern admin** : `/admin/read-tokens` (Server Actions + `requireAdmin` + `audit_log`).
- **Segment engine** : `lib/segments.ts` (juste +1 colonne allowlistée).
- **RGPD** : DNT/GPC (`privacy.ts`), DSAR (`lib/dsar.ts`) — hérités tels quels.
