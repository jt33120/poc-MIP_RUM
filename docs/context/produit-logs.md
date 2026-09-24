# Fiche produit — Supervision Logs

> **Niveau de maturité : N1 « Instrumenté ».**
> Le pipeline est complet et conforme à une spécification **stable** ;
> il n'est alimenté par **aucun produit**. 597 lignes en base, toutes issues du
> dogfooding de la console, **0 erreur**, **0 corrélation**, flux tari depuis le
> 23 juillet 2026.

*Établie le 29 juillet 2026. Grille : [README.md](./README.md#2-grille-de-maturité-employée).*

---

## 1. Identité

**Ce que c'est.** Le troisième signal OpenTelemetry, après les traces et les
métriques : les journaux applicatifs, ingérés en OTLP, stockés avec leur sévérité
et leurs attributs, et **corrélables à la trace et à la session** qui les ont
produits. C'est ce qui permet de passer d'un symptôme utilisateur à la ligne de log
qui l'explique.

**Propriétaire :** `mip-rum`.

---

## 2. Ce qui existe réellement

L'implémentation est sérieuse, et c'est ce qui rend le diagnostic frustrant.

| Brique | Fichier | État |
|---|---|---|
| Endpoint d'ingestion | `supabase/functions/v1-logs/index.ts` (fonction Deno retirée en P1, lisible au tag `pre-reorg`) (188 l.) | Écrit, miroir exact de `v1-traces` |
| Jumeau auto-hébergé | `services/collector/dev-server.mjs:271-299` | Écrit |
| Parseur OTLP | `shared/otlp.mjs:543+` — `flattenOtlpLogs()` | Écrit, teste les `resourceLogs` sans app |
| Schéma | `migration-v29.sql` — table `rum_log` + 3 index | Appliqué |
| Rétention & DSAR | `migration-v30.sql` | Appliqué — purge, effacement app, effacement personne |
| Détection d'anomalie | `migration-v37.sql` — vue `v_log_anomaly` (score z) | Appliqué |
| Métrique d'alerte | `migration-v38.sql` + `queries-v2.ts:268` — `log_errors` | Appliqué |
| Couche de requêtes | `apps/console/lib/queries-logs.ts` (154 l.) | Écrite |
| Interface | `apps/console/app/logs/page.tsx` (264 l.) | Écrite |

Le schéma est bien conçu : `severity_num` en `severityNumber` OTLP (INFO ≥ 9,
WARN ≥ 13, ERROR ≥ 17), `body` nettoyé des PII et tronqué à 4000 caractères,
`attributes` en JSONB, et surtout `trace_id` / `span_id` / `session_id` / `route`
prévus pour la corrélation. Les index couvrent les trois accès réels (listing par
app et date, filtre de sévérité, jointure par trace).

La vue `v_log_anomaly` est également bien pensée : score z sur le **nombre de logs
ERROR par heure**, à la maille app (le volume par route est trop épars pour un z
stable), et filtre `z > 3` **positif uniquement** — parce qu'une baisse du nombre
d'erreurs n'est pas une anomalie à remonter. Ce raisonnement est juste.

---

## 3. Preuves d'usage — et c'est là que tout se joue

### 3.1 La totalité du contenu de la table

```
source    app_id            n     errors  with_trace  with_session  dernier log
backend   mip-rum-console   597   0       0           0             2026-07-23 08:03
```

Une seule ligne de résultat. Détail du contenu :

| Sévérité | Message | Nombre |
|---|---|---:|
| INFO | `connexion console (admin)` | 595 |
| INFO | `connexion console (viewer)` | 2 |

**La table de logs contient exclusivement 597 événements de connexion à la console
MIP elle-même.**

### 3.2 Ce que cela signifie, point par point

| Constat | Conséquence |
|---|---|
| **1 seule app émettrice**, et c'est la console (`mip-rum-console`) | Aucun client, aucune application supervisée n'émet de log |
| **1 seule source** (`backend`) sur les 4 prévues (`sdk`, `extension`, `backend`, `syslog`) | Aucun SDK n'émet de logs — vérifié : ni `rum-sdk`, ni `agent-node`, ni `rum-mobile`, ni l'intégration FastAPI |
| **0 log de sévérité ERROR** | La vue `v_log_anomaly` et la métrique `log_errors` n'ont **jamais eu la moindre donnée à traiter** |
| **0 `trace_id`, 0 `session_id`** | La corrélation log → trace, qui est la raison d'être du signal, n'a **jamais fonctionné une seule fois en production** |
| **Dernier log : 23 juillet, 08:03** | Le flux est tari depuis six jours |

### 3.3 D'où viennent ces 597 lignes

`apps/console/lib/log-forward.ts` (80 l.) forwarde les logs serveur notables de la
console vers `/v1/logs`. Il n'est appelé que de deux endroits :

- `app/login/actions.ts:105` — une connexion réussie → les 597 lignes ;
- `lib/api/handle.ts:100` — une erreur d'un endpoint `/api/v1` → **jamais déclenché**.

C'est du dogfooding honnête, et il a servi : il prouve que le pipeline fonctionne
de bout en bout. Mais il ne constitue pas un produit.

---

## 4. Standards du secteur

**Le signal Logs d'OpenTelemetry est stable depuis 2023** — spécification en 1.0,
configuration figée. Contrairement au RUM navigateur, il n'y a donc ici **aucune
excuse liée à l'immaturité du standard** : la cible est connue et arrêtée.

Ce que le marché considère comme acquis en 2026 :

| Attendu | Chez nous |
|---|---|
| Journalisation structurée (JSON, schéma de champs cohérent) | ✅ `attributes` JSONB + champs normalisés |
| Corrélation automatique log ↔ trace par injection de contexte | ⚠️ colonnes prévues, **0 % renseignées** |
| *Log Bridge API* / *appender* branché sur le logger existant de l'app | ❌ absent — aucun SDK n'expose de quoi émettre un log |
| Collecteur OTel comme point de collecte neutre | ❌ absent — ingestion directe uniquement |
| Recherche plein texte et facettes sur les attributs | ❌ filtre de sévérité seulement |
| Détection de motifs / regroupement de logs similaires | ❌ |
| Rétention différenciée par type de log, archivage à froid | ⚠️ rétention unique, héritée du RUM |

Le point le plus coûteux est le troisième. Le chemin d'adoption reconnu pour les
logs, c'est le **pont** : on ne demande pas à une application de changer sa façon
de journaliser, on branche un *appender* sur son logger existant (`winston`, `pino`,
`logging` Python) qui exporte en OTLP **et injecte le contexte de trace au passage**.
Sans ce pont, il faut demander au client d'écrire lui-même des appels HTTP OTLP —
ce que personne ne fait.

---

## 5. Évaluation par axe

### A1 — Collecte & couverture : **1 / 4** ← *plafond*
Un émetteur, qui est nous-mêmes, pour un seul type d'événement. Aucun SDK du
monorepo n'émet de logs. C'est la définition exacte de N1 : la donnée arrive, elle
ne sert à rien.

### A2 — Conformité aux standards : **3 / 4**
C'est le meilleur axe du produit. Le parseur suit fidèlement l'enveloppe OTLP
(`resourceLogs` → `scopeLogs` → `logRecords`), la sévérité est encodée en
`severityNumber` normalisé, les attributs résiduels sont conservés. Ce qui manque
pour un 4 : le pont côté SDK et le support d'un collecteur.

### A3 — Qualité de la donnée : **1 / 4**
Le nettoyage PII et la troncature sont en place, la purge et le DSAR aussi. Mais la
**corrélation est à 0 %** — et pour un produit de logs, la corrélation *est* la
qualité. Un log qu'on ne peut rattacher ni à une trace ni à une session est une
ligne de texte, pas de l'observabilité.

### A4 — Exploitation : **2 / 4**
La page existe et est correcte : volume horaire empilé error/warn/autres, comptes
par sévérité, filtres de niveau, table des derniers logs avec liens de corrélation.
Mais on ne peut ni chercher un texte, ni filtrer sur un attribut, ni regrouper des
logs similaires — soit les trois gestes qu'un exploitant fait en premier.

### A5 — Action : **1 / 4**
La mécanique est là (`v_log_anomaly`, métrique `log_errors`) et elle est bien
conçue. Elle n'a jamais rien produit, faute de log ERROR — et même si elle en
produisait, elle se heurterait au même mur que le RUM : `alert_delivery` est vide,
aucune notification n'est livrée (cf. [README §4](./README.md#4-le-constat-transversal-et-il-est-unique)).

### A6 — Industrialisation : **2 / 4**
Le produit hérite gratuitement de l'infrastructure du RUM : rétention, DSAR, RLS,
registre d'apps, limitation de débit. C'est un vrai acquis. Il lui manque en propre
la gestion du volume (quotas, échantillonnage, tarification à l'ingestion) — or le
volume est *le* problème économique des logs, bien plus que celui des traces.

---

## 6. Verdict

**N1. Ce n'est pas un produit inachevé, c'est un produit non branché.**

La distinction est importante pour la priorisation : il ne reste pas six mois de
développement, il reste **un chaînon**. Le pipeline, le schéma, les index, la
rétention, le DSAR, l'anomalie et l'interface sont écrits et déployés. Ce qui manque,
c'est l'émission — et l'émission est, de loin, la partie la moins coûteuse.

### Critères de sortie vers N2

1. **Un pont de journalisation dans au moins un SDK.** Le plus rentable est
   `agent-node` : il possède déjà un `AsyncLocalStorage` avec le contexte de requête
   (`packages/agent-node/src/register.ts`), donc il peut injecter `trace_id` et
   `span_id` dans chaque log **sans effort supplémentaire**. C'est le seul endroit du
   dépôt où la corrélation est presque gratuite.
2. **Un premier log ERROR réel en production**, corrélé à une trace, vérifié en base.
   C'est le test d'acceptation qui prouve la valeur du signal.
3. **La recherche plein texte** sur `body` (un index GIN suffit à ce volume).

### Critères de sortie vers N3

4. Détection d'anomalie déclenchée sur des données réelles, puis **livrée** —
   ce qui suppose de résoudre d'abord le problème transversal d'`alert_delivery`.
5. Filtrage par attribut et regroupement de logs similaires.

---

## 7. Décision à prendre — et elle est stratégique

Il faut trancher entre deux options, parce qu'elles ne demandent pas le même
investissement :

**Option A — Faire des logs un produit.** Pont de journalisation, recherche,
facettes, quotas de volume, rétention différenciée. C'est un chantier substantiel,
sur un marché où la concurrence (Loki, OpenSearch, ClickHouse) est mûre, gratuite et
très performante. Le scan concurrentiel ne désigne pas ce terrain comme
différenciant.

**Option B — Faire des logs une fonctionnalité du RUM.** Ne pas chercher à concurrencer
les plateformes de logs ; ne garder que ce qu'aucune d'elles ne fait bien : **le
saut depuis une session utilisateur réelle vers les logs de la requête exacte qui
l'a cassée**. Périmètre restreint, valeur immédiatement lisible, et cela renforce
le produit principal au lieu d'en ouvrir un second.

**Recommandation : option B.** Elle est cohérente avec le positionnement établi par
le scan concurrentiel, elle exploite le seul avantage structurel dont nous disposons
(nous tenons déjà la session et la trace), et son critère de sortie N2 se réduit au
point ① ci-dessus. L'option A serait à reconsidérer seulement si un client la
finançait explicitement.

---

## 8. Risques

| Risque | Gravité | Commentaire |
|---|---|---|
| La page Logs est montrée en démonstration | **Élevée** | Elle affichera 597 connexions à notre propre console — le pire message possible |
| L'anomalie de logs est présentée comme fonctionnalité | **Élevée** | Elle n'a jamais tourné sur des données réelles |
| La corrélation log→trace est promise | **Élevée** | 0 % des lignes portent un `trace_id` |
| Le flux tari (23 juillet) n'est pas expliqué | Moyenne | À investiguer : arrêt du forward, ou simple absence de connexions |

---

## Sources

- [OpenTelemetry — Logs (spécification)](https://opentelemetry.io/docs/specs/otel/logs/)
- [OpenTelemetry — Logs (concepts)](https://opentelemetry.io/docs/concepts/signals/logs/)
- [InfoQ — OpenTelemetry Logging declared stable](https://www.infoq.com/news/2023/11/otel-logging-stable/)
- [Structured JSON logging with the OpenTelemetry Log Bridge API](https://oneuptime.com/blog/post/2026-02-06-structured-json-logging-opentelemetry-log-bridge-api/view)
- [CubeAPM — Log Management in 2026: Retention, Observability & What's Changed](https://cubeapm.com/blog/what-is-log-management-best-practices-tools-2/)
</content>
