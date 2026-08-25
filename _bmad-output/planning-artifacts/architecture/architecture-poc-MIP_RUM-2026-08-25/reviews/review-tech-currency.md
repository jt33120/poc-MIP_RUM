---
name: 'Revue — actualité technologique (Tech Currency)'
type: review
lens: tech-currency
target: '_bmad-output/planning-artifacts/architecture/architecture-poc-MIP_RUM-2026-08-25/ARCHITECTURE-SPINE.md'
reviewer: 'Reviewer Gate — bmad-architecture'
date: '2026-08-25'
method: 'Vérification web (WebSearch/WebFetch, sources primaires priorisées) + confrontation au code réel du dépôt'
---

# Revue de lentille — Actualité technologique

> **Lentille appliquée, verbatim :** « Vérifie que chaque décision engagée a été recherchée sur le
> web ou confrontée à la réalité, plutôt qu'affirmée depuis les données d'entraînement : versions
> courantes des bibliothèques et frameworks, existence et adéquation actuelle de chaque technologie
> nommée, et — en greenfield — les défauts vivants de tout starter sur lequel elle s'appuie. Signale
> tout ce qui pourrait être périmé et n'a pas été confirmé contre le web, le projet existant, ou le
> starter courant. »

## Verdict global

**À corriger.** La table Stack du spine n'est pas fausse *par rapport au dépôt* — elle en est un
reflet fidèle — mais elle est **périmée par rapport au monde**, et surtout elle **présente comme un
choix ce qui est un état de fait non vérifié**. Trois versions engagées sont hors support ou hors
cible de déploiement (pnpm 9 en fin de vie depuis avril 2026 ; Node 26 indisponible sur le runtime
Vercel de production ; Next.js 15 en Maintenance LTS, EOL dans deux mois, avec un correctif de
sévérité **critique** publié demain). Deux contraintes de plan citées comme fondations d'invariants
(AD-13) sont l'une **confirmée**, l'autre **devenue fausse** (`pg_cron` est désormais disponible en
self-serve sur Neon). Un fait bien plus lourd que la cadence des crons n'est nulle part dans le
spine : **le plan Vercel Hobby interdit l'usage commercial**, ce qui est irréconciliable avec la
vente OEM que le spine organise. À l'inverse, les seuils Core Web Vitals et la région Neon sont
exacts et confirmés.

**Ce qui n'a manifestement pas été vérifié :** le spine ne comporte aucune trace de confrontation au
web pour ses versions. Aucune date de support, aucun horizon d'EOL, aucune mention de l'écart entre
la version épinglée et la version courante. Toutes les valeurs de la table Stack sont recopiées du
dépôt et présentées sans qualification temporelle, dans un document daté du 25/08/2026 destiné à
gouverner un build.

## Table de synthèse

| # | Élément | Verdict |
| --- | --- | --- |
| 1 | pnpm 9.15.9 | **À corriger** — fin de support depuis le 30/04/2026 |
| 2 | Node.js (CI) 26 | **À corriger** — indisponible sur Vercel Functions ; trois Node différents dans le dépôt |
| 3 | Next.js 15 | **À corriger** — Maintenance LTS, EOL 21/10/2026, correctif critique le 26/08/2026 |
| 4 | React 19 | **Confirmé** — ligne courante (19.2.8 amont, 19.2.7 épinglé) |
| 5 | PostgreSQL 15+ | **À corriger** — la production tourne sur PG 17, la CI sur PG 15 : « 15+ » masque l'écart |
| 6 | Vitest 4.1.8 | **Confirmé** — ligne courante (4.1.11 amont) |
| 7 | Playwright 1.60.0 | **Confirmé avec réserve** — deux versions de retard (1.62.1 amont) |
| 8 | OTLP/HTTP JSON | **Confirmé avec réserve** — encodage spécifié et stable, mais **pas le défaut du Collector** |
| 9 | Seuils Core Web Vitals `[2500, 4000]` | **Confirmé** — mais une copie périmée subsiste dans le dépôt |
| 10 | Vercel Hobby — cron quotidien uniquement | **Confirmé** |
| 11 | GitHub Actions — désactivation à 60 jours | **Confirmé** (dépôt public + pas minimal 5 min) |
| 12 | Neon — `pg_cron` / `pg_net` hors jeu | **À corriger** — `pg_cron` est désormais self-serve sur Neon |
| 13 | Vercel Hobby — usage commercial | **À corriger — absent du spine**, et bloquant pour l'OEM |
| 14 | Neon `aws-eu-central-1` (Francfort) | **Confirmé** |
| 15 | Dépendances engagées hors table Stack | **À corriger** — écarts majeurs non instruits (Tailwind, TypeScript, web-vitals, recharts) |
| 16 | Préfixe d'attribut `mip.` | **Confirmé avec réserve** — acceptable, mais pas la forme recommandée pour un produit tiers |

---

## Fiches détaillées

### 1. pnpm 9.15.9 — **À corriger**

**Ce que le spine affirme.** Table Stack : « pnpm (workspaces) | 9.15.9 ».

**Ce que la vérification établit.** Le dépôt épingle bien `"packageManager": "pnpm@9.15.9"`
(`/home/user/poc-MIP_RUM/package.json:13`), et `.github/workflows/ci.yml:26` le confirme comme
source de vérité pour `pnpm/action-setup@v6`. **Mais la ligne 9.x est en fin de support depuis le
30 avril 2026** — soit près de quatre mois avant la date du spine. 9.15.9 est d'ailleurs la
*dernière* version de cette ligne : elle ne recevra plus rien, correctif de sécurité inclus. La
version courante amont est **11.24.0** (publiée le 24/08/2026, veille du spine) ; la ligne 10 reste
supportée jusqu'au 30/04/2027. pnpm 11 (28/04/2026) a par ailleurs *durci les défauts de sécurité*
et remplacé l'index de store JSON par SQLite — c'est-à-dire que rester en 9 laisse sur la table
précisément le type de durcissement qu'un produit vendu sur son sérieux sécurité devrait prendre.

**Source.** [endoflife.date/pnpm](https://endoflife.date/pnpm) (ligne 9 : *Ended 30 Apr 2026*) ;
[registry.npmjs.org/pnpm/latest](https://registry.npmjs.org/pnpm/latest) → `11.24.0` ;
[pnpm 11.0 release notes](https://pnpm.io/blog/releases/11.0).

**Ce qu'il faut faire.** Soit la table Stack mentionne l'état de support et l'horizon de migration
(ligne 10 LTS ou ligne 11), soit elle cesse de présenter 9.15.9 comme un choix. Un gestionnaire de
paquets EOL est un point d'entrée chaîne d'approvisionnement pour un produit qui vend l'auditabilité.

---

### 2. Node.js (CI) 26 — **À corriger**

**Ce que le spine affirme.** Table Stack : « Node.js (CI) | 26 ». La parenthèse « (CI) » est honnête,
mais elle laisse muette la question qui compte : sur quoi tourne la **production** ?

**Ce que la vérification établit.** Deux faits se croisent.

*Côté amont :* Node 26 est sorti le **5 mai 2026** en ligne **Current**, et **n'entre en LTS que le
28 octobre 2026**. Au 25/08/2026, la ligne Active LTS est **Node 24** (supportée jusqu'en avril 2028).
Le spine engage donc la CI sur une ligne non-LTS.

*Côté aval — le point dur :* **Vercel Functions ne propose pas Node 26.** Les versions disponibles
pour les builds et fonctions sont **24.x (défaut), 22.x, 20.x** (20.x désactivé le 01/10/2026).
Node 26 n'existe chez Vercel que pour *Vercel Sandbox*, qui n'est pas le runtime des routes
`app/api/*` de la console.

*Côté dépôt :* aucun `package.json` du monorepo ne déclare de champ `engines` (vérifié sur les
7 manifestes). Rien n'épingle donc la version Node de déploiement : la production tourne sur ce que
dit le réglage projet Vercel, par défaut **24.x**. Et le self-host Docker tourne sur un troisième
Node encore : `node:22-alpine` (`/home/user/poc-MIP_RUM/infra/docker/README.md:28`).

**Il y a donc trois runtimes Node distincts en jeu — CI 26, Vercel ≤ 24, Docker self-host 22 — et la
table Stack n'en nomme qu'un, le seul qui ne serve jamais à exécuter le produit.**

**Source.** [Node.js Releases](https://nodejs.org/en/about/previous-releases) ;
[Vercel — Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
(page à jour au 27/02/2026 : « 24.x (default), 22.x, 20.x ») ;
[Node.js 26 sur Vercel Sandboxes](https://vercel.com/changelog/node-js-26-x-now-available-on-vercel-sandboxes) ;
`/home/user/poc-MIP_RUM/.github/workflows/ci.yml:31,79`.

**Ce qu'il faut faire.** Ce n'est pas une coquille de version : c'est un cas d'école d'**AD-11** —
« un test qui choisit lui-même sa configuration ne prouve rien sur la production ». La CI valide sur
un runtime que la production n'exécutera jamais. Le spine devrait soit aligner la CI sur 24.x, soit
nommer explicitement les trois runtimes et la matrice de test qui les couvre.

---

### 3. Next.js 15 — **À corriger (urgent)**

**Ce que le spine affirme.** Table Stack : « Next.js | 15 ».

**Ce que la vérification établit.** Le dépôt épingle `next: 15.5.19`
(`/home/user/poc-MIP_RUM/apps/console/package.json`). Trois faits amont, tous datés :

1. **La ligne courante est 16.3** (sortie le 03/08/2026). Next.js 15 est en **Maintenance LTS** —
   correctifs critiques et sécurité seulement — et atteint son **EOL le 21 octobre 2026**, soit
   **moins de deux mois** après la date du spine.
2. **Un correctif de sévérité CRITIQUE est publié demain, le 26 août 2026.** Vercel a annoncé à
   l'avance une release de sécurité programmée qui livrera **15.5.24** et **16.3.3** avec l'avis
   complet. Le pin actuel (15.5.19) sera donc vulnérable dès demain, publiquement.
3. **Le pin 15.5.19 porte déjà 8 advisories ouvertes**, dont **3 de sévérité HIGH** : SSRF dans les
   Server Actions sur serveur custom (`GHSA-89xv-2m56-2m9x`), SSRF via `rewrites` à hôte de
   destination contrôlé par l'attaquant (`GHSA-p9j2-gv94-2wf4`), et déni de service App Router via
   Server Actions (`GHSA-m99w-x7hq-7vfj`) — plus 5 MODERATE (cache confusion, divulgation
   d'endpoints Server Function, DoS via l'API d'optimisation d'images).

**Source.** [Upcoming Next.js August Security Release](https://nextjs.org/blog/upcoming-nextjs-security-release-august-2026) ;
[Next.js 16.3](https://nextjs.org/blog/next-16-3) ; [endoflife.date/nextjs](https://endoflife.date/nextjs) ;
[Next.js support policy — discussion #85289](https://github.com/vercel/next.js/discussions/85289) ;
requête OSV (`api.osv.dev/v1/query`, `next@15.5.19`).

**Ce qu'il faut faire.** Un spine daté du 25/08/2026 qui écrit « Next.js 15 » sans une ligne sur
l'EOL d'octobre ni sur le correctif du lendemain n'a pas été confronté au web. Deux corrections
distinctes : (a) épingler ≥ 15.5.24 dès demain, (b) inscrire dans le spine la fenêtre de migration
vers 16 comme contrainte datée — c'est exactement le type de fait que le spine est censé rendre
opposable au build.

---

### 4. React 19 — **Confirmé**

**Ce que le spine affirme.** Table Stack : « React | 19 ».

**Ce que la vérification établit.** Le dépôt épingle `react`/`react-dom` en **19.2.7** ; la version
courante amont est **19.2.8** (publiée le 21/07/2026). React 19 est la ligne stable et activement
maintenue. Un patch d'écart, aucun enjeu.

**Source.** [registry.npmjs.org/react/latest](https://registry.npmjs.org/react/latest) → `19.2.8` ;
[React Versions](https://react.dev/versions) ; [endoflife.date/react](https://endoflife.date/react).

---

### 5. PostgreSQL 15+ (Neon) — **À corriger**

**Ce que le spine affirme.** Table Stack : « PostgreSQL (Neon, `aws-eu-central-1`) | 15+ ». Le « + »
suggère un plancher assumé.

**Ce que la vérification établit.** Le plancher est correct au sens du support amont : **PostgreSQL 15
est supporté jusqu'au 11/11/2027**, et Neon supporte 14, 15, 16, 17 et 18 (versions au 21/08/2026 :
14.24, 15.19, 16.15, 17.11, 18.6 ; **PG 18 est désormais le défaut** des nouveaux projets Neon).
Mais la notation « 15+ » **dissimule une divergence réelle et documentée dans le dépôt** :

- **Production :** Neon, projet `mip-rum-poc-eu`, **Postgres 17**
  (`/home/user/poc-MIP_RUM/docs/NEON_MIGRATION.md`, §1).
- **CI :** service `image: postgres:15` (`/home/user/poc-MIP_RUM/.github/workflows/ci.yml:61`).
- **Self-host Docker :** `image: postgres:15` (`/home/user/poc-MIP_RUM/infra/docker/docker-compose.yml:19`).

La CI et le conteneur self-host valident donc les 49 migrations et les tests d'isolation RLS contre
un moteur **deux majeures en dessous** de celui qui sert la production.

**Source.** [PostgreSQL Versioning Policy](https://www.postgresql.org/support/versioning/) ;
[Neon — Postgres version support policy](https://neon.com/docs/postgresql/postgres-version-policy) ;
[Neon changelog 21/08/2026](https://neon.com/docs/changelog/2026-08-21) ; code du dépôt cité ci-dessus.

**Ce qu'il faut faire.** Même remarque qu'au point 2, et même invariant : **AD-11**. Écrire « 15+ »
dans la table Stack revient à déclarer que la version majeure n'est pas structurante — ce qui est une
décision, et devrait alors être énoncée comme telle (« le produit s'engage à fonctionner de PG 15 à
PG 18, et la matrice de CI le prouve »), pas laissée en creux.

---

### 6. Vitest 4.1.8 — **Confirmé**

**Ce que le spine affirme.** Table Stack : « Vitest | 4.1.8 ».

**Ce que la vérification établit.** Le dépôt épingle exactement `vitest: 4.1.8`
(`/home/user/poc-MIP_RUM/package.json`). La version courante amont est **4.1.11**. Trois patches
d'écart sur une ligne mineure vivante — aucun enjeu de support ni de sécurité relevé.

**Source.** [registry.npmjs.org/vitest/latest](https://registry.npmjs.org/vitest/latest) → `4.1.11` ;
[Vitest 4.1](https://vitest.dev/blog/vitest-4-1.html).

---

### 7. Playwright 1.60.0 — **Confirmé avec réserve**

**Ce que le spine affirme.** Table Stack : « Playwright | 1.60.0 ».

**Ce que la vérification établit.** Le dépôt épingle `@playwright/test: 1.60.0`. La version courante
amont est **1.62.1** ; 1.60 date de **mai 2026**, soit deux cycles de release (~12 semaines) de
retard. Playwright publie environ toutes les six semaines et les navigateurs embarqués suivent :
un retard de deux versions signifie tester contre un Chromium qui n'est plus celui du parc réel — ce
qui, pour un produit de **RUM**, touche la validité même des mesures E2E.

**Source.** [registry.npmjs.org/@playwright/test/latest](https://registry.npmjs.org/@playwright/test/latest) → `1.62.1` ;
[Playwright release notes](https://playwright.dev/docs/release-notes).

**Réserve.** Pas un défaut de spine, mais la table gagnerait à dire *pourquoi* 1.60 est figé (budget
CI ? navigateur ciblé ?) ou à cesser de figer un patch exact.

---

### 8. OTLP/HTTP JSON — **Confirmé avec réserve sérieuse**

**Ce que le spine affirme.** AD-1 : « aucune donnée n'entre dans le cœur autrement qu'en **OTLP/HTTP
JSON standard** » et « **un émetteur tiers (Collector OTel) doit pouvoir remplacer n'importe quel SDK
maison sans modification côté ingestion** ». Table Stack : « OpenTelemetry — format d'échange |
OTLP/HTTP JSON ».

**Ce que la vérification établit.** Trois constats, du plus rassurant au plus gênant.

*a) Le format existe et est spécifié.* La spec OTLP courante est la **1.11.0**, « Stable for the
trace, metric and log signals ». L'encodage JSON y est normatif, avec des règles précises que le
parseur doit respecter : `traceId`/`spanId` en **hex insensible à la casse** (et non base64) ; enums
**obligatoirement en entiers** ; clés en **lowerCamelCase** ; et les récepteurs **DOIVENT ignorer les
champs inconnus**. Rien de périmé dans le choix du format lui-même.

*b) Nuance historique à connaître.* Les versions antérieures de la spec (jusqu'à ~v1.8.0) portaient un
tableau de statut explicite : « **Binary Format Status: Stable** / **JSON Format Status:
Experimental** ». Ce tableau a disparu des versions récentes au profit d'un statut global stable.
Le choix JSON n'est donc **pas** périmé — mais si le discours OEM s'appuie sur « format standard
stable », il vaut mieux le savoir avant qu'un prospect technique ne ressorte l'ancienne page.

*c) Le point dur — la promesse de substituabilité n'est pas vraie telle qu'écrite.* L'exportateur
`otlphttp` du Collector OpenTelemetry expose une option `encoding` dont **le défaut est `proto`**,
`json` étant l'option non-défaut (comportement constant de v0.151.0 à v0.157.0). Or côté dépôt, la
route de production appelle `await req.json()` sans négociation de `content-type` et lève
`BadRequestError("invalid json body")` en cas d'échec
(`/home/user/poc-MIP_RUM/apps/console/app/api/ingest/v1/traces/route.ts`). **Un Collector OTel branché
avec sa configuration par défaut reçoit donc un 400.** La substitution promise par AD-1 exige une
modification — non pas côté ingestion, mais côté client, ce que la règle ne dit pas.

**Source.** [OTLP Specification 1.11.0](https://opentelemetry.io/docs/specs/otlp/) ;
[spec v1.8.0, tableau de statut](https://github.com/open-telemetry/opentelemetry-specification/blob/v1.8.0/specification/protocol/otlp.md) ;
[otlphttpexporter](https://github.com/open-telemetry/opentelemetry-collector/tree/main/exporter/otlphttpexporter) ;
code du dépôt cité.

**Ce qu'il faut faire.** AD-1 doit soit énoncer que l'ingestion accepte **aussi** `application/x-protobuf`
(ce qui rend la substitution littéralement vraie), soit reformuler sa règle en « sans modification
côté ingestion, moyennant `encoding: json` côté Collector » — et **AD-12 doit alors tester ce chemin
précis**, sans quoi son test « rejoue un export réel dans un Collector standard » validera une
configuration que personne n'utilise par défaut.

---

### 9. Seuils Core Web Vitals `[2500, 4000]` — **Confirmé (le seuil), à corriger (sa duplication)**

**Ce que le spine affirme.** Le spine ne cite pas les seuils directement, mais **AD-12** engage :
« les seuils et barèmes partagés entre SDK, ingestion et console sont **dérivés d'une source unique,
jamais recopiés aux trois endroits** ».

**Ce que la vérification établit.** *Le seuil est bon* : les bornes Core Web Vitals courantes sont
bien **LCP `[2500, 4000]` ms**, **INP `[200, 500]` ms**, **CLS `[0.1, 0.25]`**, évaluées au 75ᵉ
percentile du terrain. Les valeurs du dépôt sont donc exactes.

*Mais la règle d'AD-12 est violée aujourd'hui, littéralement et de façon vérifiable.* Le barème est
recopié **exactement aux trois endroits que la règle interdit**, et le code le dit lui-même :

- `/home/user/poc-MIP_RUM/packages/rum-sdk/src/vitals.ts:18` — commentaire en clair :
  « **Miroir strict de `_shared/otlp.mjs` (ingestion) et `lib/rating.ts` (console)** ».
- `/home/user/poc-MIP_RUM/apps/ingest/supabase/functions/_shared/otlp.mjs:16`
- `/home/user/poc-MIP_RUM/apps/console/lib/rating.ts:6`

**Et une quatrième copie est déjà périmée** : `/home/user/poc-MIP_RUM/scripts/validate-s4.mjs:25`
porte encore `LCP: [2000, 2500]` — l'ancien barème que le commentaire de `vitals.ts` dit précisément
avoir corrigé parce qu'il « classait "à améliorer" des pages que Google classe "bonnes" ». Le mode de
défaillance décrit par AD-12 (« des comparaisons statistiquement fausses », AD-10) n'est pas
hypothétique : il est présent dans le dépôt, dans un script nommé `validate-*`.

**Source.** [web.dev — Web Vitals](https://web.dev/articles/vitals) et références 2026 concordantes ;
fichiers du dépôt cités.

**Ce qu'il faut faire.** AD-12 est le bon invariant ; ce qui manque au spine, c'est de **nommer la
dérive existante** au lieu de la formuler au futur. Une règle qui décrit un état déjà enfreint sans
le dire se lit comme satisfaite.

---

### 10. Vercel Hobby — cron quotidien uniquement — **Confirmé**

**Ce que le spine affirme.** AD-13 : « des alertes annoncées à 15 minutes livrées à l'heure ». Le
dépôt explicite la cause (`/home/user/poc-MIP_RUM/.github/workflows/cron.yml`) : « le plan **Hobby
n'accepte QUE des crons quotidiens** : déclarer `*/5 * * * *` fait échouer le déploiement entier ».

**Ce que la vérification établit.** **Exact et toujours vrai en 2026.** Les comptes Hobby sont
limités à une fréquence **quotidienne** ; une expression `0 * * * *` ou `*/30 * * * *` **fait échouer
le déploiement**. Et même à cette fréquence, Vercel **ne garantit pas la ponctualité** : un cron
`0 1 * * *` se déclenche entre 1h00 et 1h59.

Une évolution mérite d'être notée car elle *n'invalide pas* la contrainte mais change le paysage :
depuis le **20 janvier 2026**, les limites de *nombre* de crons ont été relevées à **100 par projet
sur tous les plans** (l'ancienne limite Hobby de 2 crons/projet n'existe plus). La contrainte
résiduelle est donc purement **fréquentielle**, ce que le spine dit correctement.

Le dépôt est cohérent : `/home/user/poc-MIP_RUM/apps/console/vercel.json` ne déclare bien qu'un seul
cron, `/api/cron/daily` à `17 3 * * *`.

**Source.** [Vercel — Cron jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) ;
[Vercel changelog — 100 crons par projet](https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan).

---

### 11. GitHub Actions — désactivation après 60 jours d'inactivité — **Confirmé**

**Ce que le spine affirme.** AD-13 : « un déclencheur qui s'éteint après 60 jours d'inactivité du
dépôt ».

**Ce que la vérification établit.** **Exact.** La documentation GitHub énonce : « In a **public**
repository, scheduled workflows are automatically disabled when no repository activity has occurred
in **60 days**. » Deux précisions que le spine gagnerait à porter :

- **Le qualificatif « public » est porteur.** La règle telle que documentée vise les dépôts publics.
  Le dépôt concerné **est public** — `cron.yml` s'en prévaut explicitement (« gratuit et sans limite
  de minutes sur ce dépôt (public) ») et se garde sur `github.repository == 'jt33120/mip-rum'`. La
  contrainte s'applique donc bien ici, mais elle est **conditionnée à un choix de visibilité** qui
  pourrait changer (un passage en privé pour une vente OEM modifierait *aussi* l'économie des
  minutes Actions).
- **Seuls les nouveaux commits réarment le compteur** : créer une release, pousser un tag, ouvrir
  une issue ou fusionner une PR ne comptent pas comme activité qualifiante.

Le pas minimal de planification est par ailleurs bien de **5 minutes**, ce que `cron.yml` respecte
(`*/5 * * * *`), et les exécutions sont *best-effort* — décalables de plusieurs minutes aux heures
chargées, comme le commentaire du workflow le reconnaît honnêtement.

**Source.** [GitHub Docs — Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) ;
`/home/user/poc-MIP_RUM/.github/workflows/cron.yml`.

---

### 12. Neon — `pg_cron` et `pg_net` « hors jeu » — **À corriger (périmé)**

**Ce que le spine affirme.** Le spine ne l'écrit pas en propre, mais **AD-8 et AD-13 héritent
entièrement de cette contrainte**, et le spine cite `docs/NEON_MIGRATION.md` dans ses `sources`.
Ce document (§3.3, daté du 14/08/2026) conclut : « `pg_cron` existe sur Neon (v1.6) mais ne
s'installe QUE dans la base `postgres` du projet, jamais dans `neondb` […] **pg_cron est donc hors
jeu** », et (§3.4) « `create extension pg_net` est refusé sur Neon ». C'est cette conclusion qui a
poussé la planification vers Vercel Cron puis GitHub Actions — et donc qui produit le mode de
défaillance qu'AD-13 dénonce.

**Ce que la vérification établit.** **La conclusion sur `pg_cron` n'est plus exacte.** La
documentation Neon courante décrit une procédure **self-serve** : on définit le paramètre
`cron.database_name` sur la base voulue via un appel API *Update compute endpoint* (`pg_settings`
dans l'objet de réglages), puis on exécute `CREATE EXTENSION IF NOT EXISTS pg_cron`. Neon indique
explicitement que **`pg_cron` est désormais disponible pour tout le monde** — auparavant il fallait
un plan payant et un ticket au support. La restriction « uniquement dans la base `postgres` » a donc
été remplacée par « dans **la** base que vous désignez », `neondb` incluse.

**Deux réserves importantes, qui empêchent d'en faire une solution miracle :**

1. **`pg_cron` ne s'exécute que si le compute est actif.** Neon recommande de ne l'utiliser que sur
   des computes 24/7 ou avec le scale-to-zero désactivé — ce qui a un coût, et ce qui reproduirait
   *exactement* le mode de défaillance d'**AD-9** si la supervision en dépendait (un ordonnanceur
   qui tombe avec la base qu'il surveille).
2. **`cron.schedule_in_database()` n'est pas supporté** sur Neon, et l'extension reste limitée à une
   base par cluster.
3. **`pg_net` n'est pas confirmé** comme disponible : la page `pg_cron` de Neon n'en fait aucune
   mention, et aucune source primaire n'a été trouvée l'attestant. **Non vérifiable en l'état** — le
   constat du 14/08 reste donc plausible pour `pg_net`, contrairement à celui sur `pg_cron`.

**Source.** [Neon Docs — The pg_cron extension](https://neon.com/docs/extensions/pg_cron) ;
[Neon Docs — Postgres extensions](https://neon.com/docs/extensions/pg-extensions) ;
`/home/user/poc-MIP_RUM/docs/NEON_MIGRATION.md` §3.3–3.4.

**Ce qu'il faut faire.** AD-13 raisonne sur un espace de solutions amputé d'une option qui, onze
jours après le constat qui l'a écartée, est redevenue disponible. Ce n'est pas un détail
d'implémentation : c'est l'**hypothèse porteuse** de l'invariant. Il faut reprendre l'arbitrage à
trois branches (Vercel Pro / GitHub Actions / `pg_cron` sur compute non-scale-to-zero) plutôt qu'à
deux — en pesant explicitement la réserve n°1, qui interagit avec AD-9.

---

### 13. Vercel Hobby — usage commercial interdit — **À corriger : absent du spine, et bloquant**

**Ce que le spine affirme.** Rien. AD-13 traite le plan d'hébergement uniquement sous l'angle de la
**cadence** (« aucune latence annoncée commercialement ne peut dépendre d'un plan d'hébergement qui
ne la permet pas »). Le *Deferred* identifie bien la licence open-core comme « bloquante pour toute
vente OEM » — mais pas l'hébergement.

**Ce que la vérification établit.** La documentation Vercel (page mise à jour le **16/06/2026**)
énonce sans ambiguïté : « As stated in the **fair use guidelines**, the Hobby plan **restricts users
to non-commercial, personal use only**. » Cette restriction couvre tout déploiement lié à un gain
financier pour quiconque participe au projet — **y compris un consultant payé pour écrire le code**.
Le non-respect relève des motifs de **suspension de compte ou de déploiement**.

Or le spine organise explicitement la **vente OEM** d'un produit, `cron.yml` pointe une console de
production sur `https://mip-rum-console.vercel.app`, et le dépôt mentionne un client GIP français.

**Source.** [Vercel — Hobby Plan](https://vercel.com/docs/plans/hobby) (`/docs/plans/hobby.md`,
`last_updated: 2026-06-16`) et les [fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)
qu'elle cite ; [Why has my account or deployment been paused?](https://vercel.com/kb/guide/why-is-my-account-deployment-blocked).

**Ce qu'il faut faire.** C'est **plus lourd que la contrainte de cadence qu'AD-13 traite déjà**, et
de même nature que le point licence déjà consigné en *Deferred* : une clause contractuelle qui,
si elle est constatée, coupe la production du client. AD-13 devrait l'énoncer — « le plan
d'hébergement doit être compatible avec l'usage commercial du produit » — ou le *Deferred* devrait
l'accueillir à côté de la licence, avec la même mention « bloquant avant le premier contrat ».
Accessoirement, passer en Pro **résout simultanément** la cadence des crons (crons infra-journaliers
débloqués) et la conformité d'usage : les deux problèmes ont la même solution, ce qui devrait
apparaître dans le spine.

---

### 14. Neon — région `aws-eu-central-1` (Francfort) — **Confirmé**

**Ce que le spine affirme.** Table Stack et *Structural Seed* : « Neon — `aws-eu-central-1`
(Francfort) », et AD-7 fait de la région la source de la déclaration légale.

**Ce que la vérification établit.** **Région valide, active et bien maintenue.** Neon liste
`aws-eu-central-1` (Europe / Frankfurt) parmi ses régions supportées, et y a encore étendu sa
capacité en août 2026 (nouvelles adresses IP de passerelle NAT, nouveaux endpoints VPC pour le
Private Networking). Le dépôt confirme le projet `mip-rum-poc-eu` (`rough-firefly-49250892`) dans
cette région.

**Réserve mineure, utile pour AD-14 et le *Deferred* ClickHouse :** certains services Neon
(Object Storage, Functions, AI Gateway) ne sont **disponibles qu'en `aws-us-east-2` (Ohio)**. Toute
architecture d'export/restauration ou de fonctions managées qui s'appuierait sur eux entrerait en
conflit direct avec l'engagement de résidence européenne d'AD-7.

**Source.** [Neon Docs — Regions](https://neon.com/docs/introduction/regions) ;
[Neon changelog 07/08/2026](https://neon.com/docs/changelog/2026-08-07) ;
`/home/user/poc-MIP_RUM/docs/NEON_MIGRATION.md` §1.

---

### 15. Dépendances engagées mais absentes de la table Stack — **À corriger**

**Ce que le spine affirme.** La table Stack liste 8 lignes. Elle omet des dépendances que les
invariants engagent pourtant directement (AD-10 lie explicitement `packages/rum-sdk` au parc SDK
déployé ; AD-12 lie les barèmes au SDK).

**Ce que la vérification établit** (comparaison pin dépôt ↔ registre npm, 25/08/2026) :

| Paquet | Épinglé | Courant | Écart | Enjeu |
| --- | --- | --- | --- | --- |
| `web-vitals` | 5.3.0 | **6.2.0** | **1 majeure** | v6 (21/07/2026) apporte les **métriques de soft-navigation** — les changements de route SPA. Pour un produit de RUM, c'est une **capacité produit**, pas une mise à jour de routine. v6 change aussi le défaut de `includeProcessedEventEntries` à `false`, ce qui **modifie l'attribution INP** — soit précisément la « césure de sémantique » qu'**AD-10** exige de dater et de signaler. |
| `tailwindcss` | 3.4.19 | **4.3.3** | **1 majeure** | Tailwind 4 est une refonte du moteur ; migration non triviale, à instruire plutôt qu'à subir. |
| `typescript` | 5.9.3 | **7.0.2** | **2 majeures** | TypeScript 7 est disponible ; Next.js 16.3 sait déjà l'utiliser pour le typecheck de build. |
| `recharts` | 2.15.4 | **3.10.1** | **1 majeure** | Bibliothèque de la console. |
| `swagger-ui-dist` | 5.17.14 | **5.32.14** | 15 mineures | Sert la doc d'API publique. Aucune advisory OSV sur le pin — mais un composant exposé publiquement avec 15 mineures de retard mérite un arbitrage explicite. |
| `rrweb` / `rrweb-player` | 2.0.1 | **2.1.1** | 1 mineure | Session replay. |
| `esbuild` | 0.28.0 | 0.28.2 | 2 patches | 1 advisory **LOW** sur le pin (`GHSA-g7r4-m6w7-qqqr`, lecture de fichier arbitraire par le serveur de dev **sous Windows** uniquement) — sans portée ici. |
| `pg` | 8.21.0 | 8.23.0 | 2 mineures | Aucune advisory. |
| `jose` | 6.2.10 amont / **6.2.3** épinglé | 6.2.10 | 7 patches | Crypto de jetons — ligne à garder fraîche par principe. Aucune advisory sur le pin. |

Vérification de sécurité systématique (OSV) sur les pins : **aucune advisory** sur `swagger-ui-dist`,
`rrweb`, `tailwindcss`, `pg`, `jose`, `recharts` ; **LOW** sur `esbuild` ; **8 advisories dont 3 HIGH**
sur `next` (cf. fiche 3).

**Source.** `registry.npmjs.org/<pkg>/latest` ; [api.osv.dev](https://api.osv.dev) (requêtes par
version exacte) ; [web-vitals CHANGELOG](https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md).

**Ce qu'il faut faire.** Le cas `web-vitals` est le seul qui remonte au niveau du spine : la
soft-navigation est une **capacité de mesure** que les concurrents exposent déjà, et le changement
d'attribution INP en v6 est **exactement le déclencheur de césure décrit par AD-10**. Il devrait
apparaître soit dans la table Stack, soit dans les *Questions ouvertes*.

---

### 16. Préfixe d'attribut `mip.` — **Confirmé avec réserve**

**Ce que le spine affirme.** AD-1 : « Tout champ propre à MIP est porté par un attribut préfixé
`mip.`, jamais par une extension du format. » Repris dans les *Consistency Conventions*.

**Ce que la vérification établit.** Le principe est **le bon** et correspond à la doctrine OTel :
utiliser un espace de noms dédié plutôt qu'étendre le format ; ne **jamais** préfixer en `otel.`
(réservé à la spec) ; ne pas réutiliser un espace de noms semconv existant, au risque de collisions
futures. Sur ce point le spine est aligné.

**La réserve porte sur la forme du préfixe.** La recommandation OTel pour des attributs
*propres à une entreprise* est le **nom de domaine inversé** (`com.acme.shopname`), précisément pour
garantir l'unicité globale « dans un système distribué » ; un préfixe court type `myapp.` est
présenté comme un raccourci acceptable **pour des applications internes**. Or MIP RUM n'est pas une
application interne : c'est un produit destiné à émettre de l'OTLP qui **transitera par des
Collectors et des backends tiers chez le client**, où la collision avec un autre `mip.` n'est pas
théorique.

**Source.** [OpenTelemetry — Naming (semconv)](https://opentelemetry.io/docs/specs/semconv/general/naming/) ;
[semantic-conventions/docs/general/naming.md](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/general/naming.md).

**Ce qu'il faut faire.** Décision peu coûteuse **maintenant**, très coûteuse après le premier
déploiement client (elle deviendrait une césure au sens d'AD-10). À trancher explicitement :
conserver `mip.` en l'assumant, ou basculer sur une forme de domaine inversé.

---

## Ce qui n'a pas pu être vérifié

| Élément | Pourquoi |
| --- | --- |
| Disponibilité de `pg_net` sur Neon | Aucune source primaire trouvée, dans un sens ou dans l'autre. La page `pg_cron` de Neon n'en fait aucune mention. Le constat du dépôt (14/08/2026, « not in the allowed extensions ») reste la meilleure information disponible — mais il est de même génération que le constat `pg_cron` qui, lui, s'est révélé périmé : **à revérifier directement sur le projet Neon**, pas depuis la documentation. |
| Détail du CVE Next.js du 26/08/2026 | Divulgation programmée pour demain, avec les versions 15.5.24 / 16.3.3. Seule la sévérité (**critique**) et la date sont publiques au 25/08. |
| Plan Vercel réellement souscrit | Le dépôt n'en porte pas la trace ; le raisonnement de `cron.yml` (« le plan Hobby n'accepte QUE des crons quotidiens ») et le domaine `*.vercel.app` **suggèrent fortement** Hobby, mais ce n'est pas prouvé par le code. La fiche 13 est donc conditionnelle à cette confirmation — **à faire avant toute vente**. |
| Version Node réellement servie en production | Aucun champ `engines` dans les 7 manifestes du monorepo ; la valeur dépend du réglage projet Vercel, non versionné. **Non déterminable depuis le dépôt** — ce qui est en soi le défaut à corriger. |

## Recommandations, par ordre de coût de l'inaction

1. **Épingler Next.js ≥ 15.5.24 dès sa publication (26/08/2026)** et inscrire l'EOL du 21/10/2026 dans
   le spine comme contrainte datée. Trois advisories HIGH sont déjà ouvertes sur le pin actuel.
2. **Confirmer le plan Vercel et, s'il s'agit de Hobby, le traiter comme bloquant OEM** au même titre
   que la licence — l'usage commercial y est interdit. Le passage en Pro résout aussi la cadence des
   crons d'AD-13.
3. **Rouvrir l'arbitrage de planification d'AD-13** : `pg_cron` est redevenu disponible en self-serve
   sur Neon, avec la réserve du compute actif (qui interagit avec AD-9). Le constat qui l'avait
   écarté a onze jours et est périmé.
4. **Nommer les trois runtimes Node et les deux versions de Postgres réellement en jeu**, ou aligner
   la CI sur la configuration expédiée. En l'état, la table Stack déclare un Node que la production
   n'exécute jamais et un Postgres deux majeures sous celui qui sert les données — ce qu'**AD-11**
   interdit précisément.
5. **Sortir pnpm 9.15.9 de la ligne EOL** (ligne 10 supportée jusqu'en 04/2027, ou ligne 11).
6. **Corriger la copie périmée du barème CWV** (`scripts/validate-s4.mjs`, LCP `[2000, 2500]`) et
   reconnaître dans AD-12 que la triple duplication qu'il interdit **existe déjà** — le code la
   documente lui-même comme « miroir strict ».
7. **Rendre AD-1 littéralement vraie** sur la substituabilité du Collector : soit accepter
   `application/x-protobuf` à l'ingestion, soit énoncer le prérequis `encoding: json` — et faire
   porter le test d'AD-12 sur ce chemin exact.
8. **Instruire `web-vitals` v6** (soft-navigation, changement d'attribution INP) : capacité produit
   d'un côté, césure au sens d'AD-10 de l'autre.
9. **Trancher la forme du préfixe d'attribut** (`mip.` vs domaine inversé) avant le premier
   déploiement client.
