# Fiche produit — Supervision IA (xSOM AI Guard)

> **Niveau de maturité, côté MIP : N2 « Exploitable » pour l'utilisateur,
> N3 « Actionnable » pour l'intégration.**
> La scission est propre, gouvernée et dégrade en douceur. Mais le contrat
> expose une moitié « qualité » qui **ne peut pas être calculée par xSOM** parce
> que sa donnée source vit du côté MIP — et qui n'est de toute façon jamais émise.

*Établie le 29 juillet 2026. Grille : [README.md](./README.md#2-grille-de-maturité-employée).*

> **État au 26/09/2026.** Cette fiche est une photographie du 29/07/2026 ; le
> sondage de l'API xSOM et le recensement de `rum_event` n'ont pas été refaits.
> Vérifié ce jour dans le code (`master`) :
>
> - **L'espace partenaire `/ai` est fermé** depuis le 08/09/2026 (commit
>   `78549a7c`, « Supervision IA, capacité fermée ») : la page affiche un accès
>   fermé et n'appelle plus la façade xSOM (`apps/console/app/ai/page.tsx:20-30`,
>   `apps/console/lib/capacites.ts:6`). La section IA de `GET /api/rum/summary`
>   reste servie par la façade.
> - Les commentaires obsolètes relevés au § 4 (A3) sont corrigés depuis le
>   29/07/2026 (commit `9bff30b8`).
> - `packages/db/sql/pending/migration-v44-drop-deprecated-ai.sql` est toujours en
>   attente : `rum_ai` n'est pas supprimée.
> - Aucune alerte IA ni sonde de la dépendance xSOM n'a été ajoutée côté MIP.

---

## 0. Périmètre d'évaluation et angle mort assumé

Ce document évalue **ce que MIP RUM possède et expose** en matière de supervision IA.
Il **n'audite pas** xSOM AI Guard : l'accès GitHub de cette session est restreint à
`jt33120/mip-rum` (dépôt renommé depuis en `jt33120/poc-MIP_RUM`), et le dépôt
`xsom-ai-guard` est hors périmètre.

Les affirmations sur le service externe reposent donc uniquement sur :
- le **contrat de lecture** consommé par notre façade (code du dépôt) ;
- un **sondage réseau** de son API publique, effectué le 29 juillet 2026 ;
- la spécification d'extraction [`../EXTRACTION_XSOM_AI_GUARD.md`](../EXTRACTION_XSOM_AI_GUARD.md).

Ce qui reste **non vérifiable depuis ici** est listé au §7. Ces points doivent être
demandés à l'équipe xSOM plutôt que supposés.

---

## 1. Identité et frontière

**Décision d'architecture (ADR-0001) :** `mip-rum` fait du RUM. La supervision IA
sort du produit et devient un service externe dont **xSOM AI Guard est l'unique
source de vérité**. Aucun recalcul local, en aucune circonstance.

| | Écriture | Lecture |
|---|---|---|
| **Chemin** | Les applications envoient leurs traces IA **directement** à xSOM | La console MIP interroge xSOM en serveur-à-serveur |
| **Endpoint** | `POST /v1/ai-traces` | `GET /v1/ai/summary?app=&window=` |
| **Authentification** | En-tête de passerelle (jeton `xsg_`) | Porteur (jeton `xsr_`) |

MIP ne stocke plus aucune donnée IA. La migration v43 a **déprécié sans détruire**
la table `rum_ai` — 1 067 lignes conservées, cron d'anomalie retiré, objets
commentés `DÉPRÉCIÉ (v43)`. La suppression définitive attend dans
`packages/db/sql/pending/migration-v44-drop-deprecated-ai.sql`, volontairement hors
du glob de la CI, activable par un simple `git mv` après période de recuit.

---

## 2. Ce que MIP possède réellement

C'est peu, et c'est voulu.

| Élément | Fichier | Taille |
|---|---|---|
| Façade de lecture | `apps/console/lib/xsom-ai.ts` | 70 l. |
| Contrat de types | `apps/console/lib/queries-summary.ts` — `AiSummarySection` | — |
| Résolution + dégradation | `queries-summary.ts` — `resolveAi()` | ~12 l. |
| Espace partenaire | `apps/console/app/ai/page.tsx` + `components/xsom/XsomAiPanel.tsx` | — |

**La façade est bien construite.** Délai de garde de 4 s par `AbortController`,
garde de forme sur la réponse, **aucune exception propagée** en aucun cas
(réseau, JSON invalide, non-configuré, 4xx/5xx → `null`). Le consommateur reçoit
alors `ai_status: "unavailable"` avec des scalaires à `null` et des listes vides —
jamais des zéros, pour que l'affichage dise « indisponible » et non « 0 ». Ce
détail de conception est juste et rare.

**Le sondage réseau confirme que le service tourne** (29 juillet 2026) :

| Requête | Réponse |
|---|---|
| `GET /health` | `200` — `{"status":"ok"}` |
| `GET /v1/ai/summary` sans jeton | `401` — `{"detail":"Missing bearer token"}` |
| `GET /openapi.json`, `GET /docs` | `404` — documentation interactive désactivée |

Service vivant, authentification appliquée, surface de documentation fermée en
production. Bonne hygiène.

---

## 3. Le contrat — ce qu'il couvre, et ce qu'il ne couvre pas

Neuf champs, dont trois listes ventilées.

| Champ | Nature |
|---|---|
| `ai_calls`, `ai_tokens`, `ai_cost_usd` | Volumétrie et coût |
| `ai_p75_latency_ms`, `ai_error_rate` | Performance |
| `ai_by_model[]` | Ventilation par fournisseur × modèle |
| `ai_top_users[]` | Coût par utilisateur (haché) |
| `ai_series[]` | Série journalière |
| `ai_by_operation[]` | **Le champ riche** — voir ci-dessous |

`ai_by_operation` va nettement plus loin qu'une simple ventilation. Par fonction
métier × route, il porte : coût, jetons, `p75_latency_ms`, `ttft_p75_ms` (temps
jusqu'au premier jeton — la bonne métrique pour du streaming), `error_rate`, une
détection d'anomalie de coût par score z (`anomaly`, `anomaly_score`), **et quatre
signaux de qualité** : `refusal_rate`, `regen_rate`, `thumbs_down_rate`, `csat`.

L'intention derrière ces quatre derniers est excellente : répondre à la question
« cette fonction coûte cher **et** déçoit ». C'est exactement la corrélation que le
marché cherche à établir en 2026.

### 3.1 Le problème : la moitié « qualité » est du mauvais côté de la frontière

| Champ | Source de calcul | Où vit cette donnée |
|---|---|---|
| `refusal_rate` | statut + type d'erreur de l'appel LLM | **xSOM** ✅ |
| `regen_rate` | événement RUM `ai_regenerate` | **MIP** (`rum_event`) ❌ |
| `thumbs_down_rate` | événement RUM `ai_feedback` | **MIP** (`rum_event`) ❌ |
| `csat` | événement RUM `feedback`, au grain session | **MIP** (`rum_event`) ❌ |

Trois des quatre signaux de qualité se calculent à partir d'événements **du produit
RUM**, que xSOM n'a aucun moyen d'observer. Le contrat demande donc au service
externe de fournir des champs qu'il ne peut pas produire.

**Et ces événements ne sont de toute façon jamais émis.** Recensement de `rum_event`
en production (29 juillet 2026, 318 lignes) :

```
form.submit 170 · frustration.dead 74 · form.abandon 54 · frustration.rage 19 · feedback 1
```

Aucun `ai_regenerate`, aucun `ai_feedback`. Les trois champs sont structurellement
à `0` ou `null` depuis leur création, et le resteront quelle que soit l'implémentation
côté xSOM.

**Ce n'est pas un défaut d'exécution, c'est une couture d'architecture** laissée
ouverte par la scission : elle n'a été révélée qu'en croisant le contrat avec les
données réelles des deux côtés. Trois issues possibles, à trancher avec xSOM :

1. **MIP calcule et fusionne** — la façade complète la réponse de xSOM avec les
   trois champs calculés localement depuis `rum_event`. Simple, mais réintroduit du
   calcul IA côté MIP, ce que l'ADR-0001 proscrit explicitement.
2. **MIP pousse les événements vers xSOM** — un webhook de retour d'expérience
   utilisateur vers `/v1/ai-feedback`. Respecte la frontière, demande un endpoint
   côté xSOM.
3. **Retirer les trois champs du contrat** et assumer que la qualité perçue reste
   du ressort du RUM, hors du résumé IA. Le plus honnête à court terme.

L'option 2 est la bonne cible ; l'option 3 est la bonne décision immédiate, car
laisser dans un contrat public trois champs qui ne se rempliront jamais est un
mensonge par omission envers l'intégrateur.

### 3.2 Ce que le contrat ne couvre pas du tout

Le marché 2026 s'est structuré en trois camps : les plateformes APM classiques qui
ajoutent un onglet LLM (jetons, latence) ; les outils de traçage natifs IA
(Langfuse, LangSmith, Arize Phoenix) ; et les **passerelles IA** (Helicone, Portkey)
placées entre l'application et le fournisseur, qui ajoutent routage, cache et suivi
de coût.

**xSOM AI Guard appartient sans ambiguïté au troisième camp** — c'est une
passerelle, son ingestion se fait par jeton de passerelle. C'est un positionnement
cohérent et défendable.

Mais ce que les deux premiers camps considèrent comme acquis reste absent du
contrat :

| Attendu 2026 | Dans le contrat |
|---|---|
| Traces unitaires d'appel (prompt, réponse, arbre d'agents) | ❌ agrégats uniquement |
| Évaluations : LLM-juge, détection d'hallucination, annotation humaine | ❌ |
| Gestion et versionnement des prompts | ❌ |
| Garde-fous / modération en ligne | partiel (`refusal_rate` observe *a posteriori*) |
| Conventions sémantiques OTel GenAI | ❌ contrat propriétaire |
| Coût par utilisateur / par modèle / par session | ✅ (par utilisateur et par modèle) |

Sur le dernier point de conformité, une nuance importante : **les conventions
sémantiques GenAI d'OpenTelemetry sont toujours expérimentales en juillet 2026** —
pas de version 1.0, noms d'attributs susceptibles de changer entre versions, et les
conventions ont même déménagé dans leur propre dépôt. Être propriétaire ici n'est
donc **pas** une faute ; c'est un choix raisonnable tant que le standard bouge. Mais
il crée un couplage qu'il faudra payer le jour où les conventions se stabilisent, et
il vaut la peine d'être documenté comme dette assumée plutôt que subi.

---

## 4. Évaluation par axe

### A1 — Collecte & couverture : **non applicable côté MIP**
Externalisée par décision d'architecture. À évaluer par xSOM.

### A2 — Conformité aux standards : **2 / 4**
Contrat propriétaire, dans un domaine où le standard n'est pas encore stable —
donc pénalité modérée et justifiée. Ce qui empêche un 3 : aucune trajectoire
documentée vers les conventions GenAI le jour où elles se figeront.

### A3 — Qualité de la donnée : **2 / 4**
La dégradation en douceur est exemplaire (`ai_status`, champs nullables, jamais de
zéro trompeur, jamais d'exception). Mais trois champs du contrat sont
structurellement invérifiables et vides (§3.1), et deux commentaires du code
décrivent encore un repli local qui n'existe plus depuis la scission —
`lib/xsom-ai.ts:30` et `:52` mentionnent « retomber sur le local », de même que
`queries-summary.ts:44-58` référence `rum_ai.operation` et la vue `v_ai_op_anomaly`,
toutes deux dépréciées en v43. *(Corrigé le 29/07/2026, commit `9bff30b8` : plus
aucune de ces mentions dans `apps/console/lib/`.)*

### A4 — Exploitation : **2 / 4**
Une page partenaire (`/ai`), correctement identifiée « propulsé par xSOM », avec
bandeau, badge, KPI, courbe et table par opération, et un état « indisponible »
propre. C'est suffisant pour restituer, pas pour investiguer : on ne peut pas
descendre dans un appel, ni comparer deux périodes, ni filtrer.

### A5 — Action : **0 / 4** ← *plafond*
**Aucune alerte IA n'existe plus côté MIP.** La métrique `ai_cost` a été retirée des
`ALERT_METRICS` (chantier C4) et le cron `mip-ai-op-anomaly` a été désactivé par la
migration v43. C'est cohérent avec la scission — l'alerte doit venir de xSOM — mais
**il n'y a aujourd'hui aucun mécanisme, ni chez nous ni contractualisé chez eux,
pour qu'un dépassement de coût atteigne qui que ce soit.** Le champ `anomaly` du
contrat est *affiché*, jamais *notifié*.

### A6 — Industrialisation *(de l'intégration)* : **3 / 4**
C'est le point fort. Décision tracée (ADR-0001), spécification de transfert écrite,
deux portes de validation dures franchies avant bascule (données réelles ingérées
côté xSOM ; tolérance du consommateur UTI à `ai_status` et aux champs nullables),
migration réversible, suppression définitive préparée mais non armée, dégradation
testée. C'est une scission conduite proprement — nettement au-dessus de la pratique
courante. Ce qui manque pour un 4 : pas de SLA sur l'API xSOM, pas de version de
contrat, pas de surveillance de la disponibilité de la dépendance.

---

## 5. Verdict

**L'intégration est mûre (N3). Le produit rendu à l'utilisateur ne l'est pas (N2).**

Ce sont deux choses distinctes, et les confondre conduirait à une mauvaise décision.
Le travail de scission est réussi : la frontière est nette, la dépendance est
sûre, la réversibilité est préservée. Mais un utilisateur de la console MIP dispose
aujourd'hui d'un **tableau de bord de coût IA en lecture seule, sans alerte, sans
investigation possible, et dont trois indicateurs de qualité afficheront toujours
« aucune donnée »**.

### Critères de sortie vers N3 *(pour l'utilisateur)*

1. **Trancher le sort des trois champs de qualité** (§3.1) — les retirer, ou
   spécifier avec xSOM le chemin de retour des événements. Ne pas les laisser en
   l'état.
2. **Rétablir une alerte sur le coût IA**, côté xSOM, avec un canal qui atteint un
   humain. Le champ `anomaly` existe déjà dans le contrat : il suffit de le router.
3. **Surveiller la dépendance elle-même.** Aujourd'hui, si xSOM tombe, la console
   affiche « indisponible » et personne n'est prévenu. Une sonde `uptime` sur
   `/health` coûte quelques minutes — le module existe déjà dans le produit.

### Critères de sortie vers N4

4. Version explicite du contrat et SLA avec xSOM.
5. Trajectoire documentée vers les conventions OTel GenAI.
6. Accès à la trace unitaire depuis la console (au minimum un lien profond vers
   l'interface xSOM, à défaut d'une intégration complète).

---

## 6. Ce qu'il faut demander à xSOM

Ces questions ne peuvent pas être résolues depuis ce dépôt :

1. Quelle est la **profondeur de rétention** des traces IA, et la politique PII sur
   les prompts et réponses ?
2. Le service produit-il des **alertes** ? Sur quels canaux, avec quel contrat ?
3. `refusal_rate` est-il réellement calculé, et sur quelle taxonomie d'erreurs ?
4. Existe-t-il un **endpoint de retour d'expérience** permettant à MIP de pousser
   `ai_regenerate` / `ai_feedback` (option 2 du §3.1) ?
5. Quelle **isolation multi-locataire** — le jeton `xsr_` est-il scopé à une app,
   comme l'est notre jeton de lecture RUM ?
6. Quelle **trajectoire** vis-à-vis des conventions sémantiques GenAI d'OTel ?
7. Y a-t-il un **SLA**, et un versionnement du contrat `/v1` ?

---

## 7. Risques

| Risque | Gravité | Commentaire |
|---|---|---|
| Un coût IA dérive sans que personne ne le sache | **Élevée** | Plus aucune alerte IA nulle part |
| Un intégrateur consomme `regen_rate` / `thumbs_down_rate` / `csat` | **Élevée** | Toujours vides — le contrat promet ce qu'il ne peut tenir |
| xSOM devient indisponible | Moyenne | Dégradation propre, mais silencieuse : aucune sonde |
| Les conventions GenAI se stabilisent | Moyenne | Dette de conformité à payer, non provisionnée |
| Le contrat évolue sans version | Moyenne | La garde de forme protège, mais en dégradant silencieusement |

---

## Sources

- [État des conventions sémantiques GenAI d'OpenTelemetry (juillet 2026)](https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/)
- [Greptime — How OpenTelemetry Traces LLM Calls, Agent Reasoning, and MCP Tools](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions)
- [Braintrust — AI observability tools: a buyer's guide (2026)](https://www.braintrust.dev/articles/best-ai-observability-tools-2026)
- [SigNoz — LLM Observability Tools: The Top Choices (2026)](https://signoz.io/comparisons/llm-observability-tools/)
- [Braintrust — Best tools for tracking LLM costs in production (2026)](https://www.braintrust.dev/articles/best-tools-tracking-llm-costs-2026)
</content>
