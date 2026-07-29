# Supervision SVI — plan d'implémentation

> Produit par une conception multi-agents (10 agents) : compréhension partagée du
> cadrage, du socle réutilisable et de l'état de l'art ; **trois architectures conçues
> indépendamment** sous des angles opposés ; une critique adverse par architecture ;
> puis arbitrage. Notes attribuées par les critiques :
>
> - **Réutilisation-maximale** — 6/10 (amendable)
> - **MVP-démontrable** — 5.5/10 (amendable)
> - **Standards-et-marché** — 4.5/10 (amendable)
>
> Aucune des trois n'a été retenue telle quelle : ce document est le fruit de
> l'arbitrage, la base la mieux notée étant amendée des idées à garder des autres
> et des corrections exigées par les critiques.

---

# Plan d'implémentation — Supervision SVI (mip-rum)

**Base retenue** : architecture « Réutilisation-maximale » (note 6), amendée. Les points « à garder » des deux autres angles sont greffés et signalés. Les 40+ failles relevées sont traitées une à une en §7 (table de traitement), les traitements structurants étant intégrés au corps du plan.

**Fait vérifié avant rédaction** (lectures effectives du dépôt, pas de citation de seconde main) :

| Vérification | Résultat |
|---|---|
| `otlp.mjs` ordre de routage | la branche « span interne » (`if (span.traceId && span.spanId && a["mip.session_id"] == null && !isServerKind(...))`) attrape **tout** span sans session, puis `if (!sessionId) { rejected++; continue; }`. Une branche `svi.*` posée « comme `track.` » serait **du code mort**. Confirmé. |
| `packages/rum-sdk/src/otlp-encode.ts` | `EmitSpan` = name/traceId/spanId/startTime/endTime/attributes. **Ni `parentSpanId` ni `kind`**, non sérialisés par `buildResourceSpans`. Confirmé. |
| `migration-v47.sql` | pose des policies dans un `do $$ … loop` **exécuté une fois**. Ce n'est pas un event trigger. Une table créée en v48 n'a **aucune** policy. L'en-tête dit lui-même : « Tant que l'application se connecte avec un rôle BYPASSRLS, ces policies restent inertes ». Confirmé. |
| `withTenant()` | 3 occurrences, toutes dans `apps/console/lib/db.ts` (définition). **Zéro appelant.** Confirmé. |
| `v1-traces/index.ts` | suite d'appels PostgREST indépendants, `ins()` impose `onConflict: "span_id", ignoreDuplicates: true`. **Aucune transaction.** Confirmé. |
| `check_alerts()` (v17:193) | `error_rate` codé en dur, sinon `percentile_cont(0.75)` sur `rum_metric`. Confirmé. |
| `slo_status()` (v17:107) | branche générique = `count(*) filter (where m.rating='good') / count(*)` sur `rum_metric where name = s.metric`. **Un SLO sur une métrique `svi.*` notée fonctionne sans une ligne de SQL neuve.** Confirmé — c'est le seul « alerting = configuration » qui tienne. |
| `scrub.mjs` | `scrubProps` finit par `return value; // number/boolean … conservé tel quel` ; `RE_LONG_NUM = /\b\d(?:[ -]?\d){8,}\b/` (≥9 chiffres) appliqué à tout texte. Confirmé. |
| `dsar.ts` | `DSAR_ANCHOR = "rum_session"`, enfants rattachés par `session_id`, invariant testé `DSAR_TABLES === [...children, anchor]`. Confirmé. |
| Lecteurs `rum_metric` sans filtre de nom | `queries-grid.ts:49-57` (good_w/total_w pondéré, **contamination réelle**), `queries-health.ts:18`, `queries-customers.ts:34,57`, `briefing.ts`. Confirmé. |
| `rum_metric.session_id` | `text references rum_session(session_id)`, **nullable**. Une ligne sans session est légale. Confirmé. |
| Prochain numéro de migration | v43 puis v45/v46/v47 ; v44 en `sql/pending/`. **v48 libre.** Confirmé. |

---

## 1. Décision d'architecture

### D1 — Tables `svi_*` dédiées. Réutilisation du **patron**, jamais de la table.

`rum_session` modélise une visite web (user_agent, device_type, is_bot, `page_count` incrémental, fusion de vues successives) ; un appel est atomique et borné. `rum_pageview` est structuré par `route`/`referrer`/`nav_type` ; un nœud de SVI est un chemin d'arbre. Aucun champ d'issue n'existe nulle part. On crée donc `svi_call` (agrégat mutable, patron `upsert_rum_session`), `svi_step`, `svi_leg`, `svi_quality_sample`, `svi_queue_sample`, `svi_call_link`.

*Écarté* : extension de `rum_session`/`rum_pageview` (coût de nommage permanent, gain nul). *Écarté* : `rum_event` comme support des étapes (contaminerait `availableEvents`, `funnelReport`, `sessionTimeline` et l'entonnoir web de tout client RUM).

### D2 — **Pas de miroir dans `rum_span`. La porte E-SVI-1 du cadrage est modifiée, et c'est une décision assumée.**

Le cadrage promettait « un appel fictif affiché dans la cascade existante, sans code d'interface nouveau ». Je refuse cette porte, pour quatre raisons vérifiées :

1. `rum_span.duration_ms` est `not null` et `ins()` fait `ignoreDuplicates: true` : un span ne peut être ni ouvert ni mis à jour. Un miroir en deux temps (début puis fin) resterait **figé sur la première version** — divergence garantie entre la cascade et le tableau de bord, pas accidentelle.
2. Il n'y a **aucune transaction** dans `v1-traces` (PostgREST). La double écriture « dans la même transaction » n'est réalisable qu'en local (`dev-server.mjs`, pool `pg`) : ce serait précisément la divergence prod/local que `_shared/*.mjs` existe pour éliminer.
3. `app/tracing/[traceId]/page.tsx` code en dur `TIER_DEPTH = {front:0, back:1, detail:2}`, `barColor`/`tierLabel` ne connaissent que navigateur/serveur/base/interne, `rootMs = front?.duration_ms ?? total`, et le sous-titre dit « du navigateur à la cause backend ». Un appel s'y afficherait en gris, étiqueté « interne », sous un texte parlant de navigateur : la porte passe à la lettre et échoue en esprit.
4. Le miroir double le volume d'écriture et contamine 9 lecteurs de `rum_span` (dont `queries-map.ts:26-37`, `group by tier, route` **sans filtre de tier** : chaque nœud de menu apparaîtrait comme service dans la Carte d'expérience web).

**Substitut** : `/svi/appels/[callId]` avec une chronologie propre construite sur `svi_step`, réutilisant le patron visuel de `components/sessions/Timeline.tsx` (≈150 lignes de TSX, budgétées en I0). `svi_call.trace_id` est conservé : une projection ultérieure vers `rum_span` reste possible si un client l'exige, avec un `tier='voice'` et un traitement explicite dans la page tracing — hors périmètre ici.

### D3 — Une seule greffe sur le socle partagé : **une ligne `rum_metric` par appier clos**, et rien d'autre.

C'est le seul levier de réutilisation dont j'ai vérifié qu'il tient :
- `slo_status()` branche générique = part de `rating='good'` sur `rum_metric where name = s.metric`. Un SLO « part d'appels établis dans les temps » ou « part d'appels à voix bonne » est **de la configuration, zéro SQL neuf**.
- `check_alerts()` mode threshold et `metric_baseline()` (dow+heure, MAD) lisent la même table.

Contrainte de direction : `rating2026()` est `value <= t[0] ? "good"` (lower-better) et `THRESHOLDS` est **tripliqué** (`_shared/otlp.mjs`, `packages/rum-sdk/src/vitals.ts`, `apps/console/lib/rating.ts`). Plutôt que d'inverser la fonction dans trois fichiers — modification silencieusement fausse si un miroir diverge — **on stocke une métrique déjà orientée** :

```
svi.mos_inv = 5 − MOS_p05      seuils [1.0, 1.4]  ⇔  MOS 4,0 / 3,6 (seuils du cadrage)
svi.wait_ms                     seuils [20000, 60000]  (référence 80/20)
svi.setup_ms                    seuils [3000, 8000]
svi.jitter_ms / svi.loss_pct    seuils Twilio publics (30 ms / 5 %)
```

`rating2026` n'est **pas touchée**, sa signature non plus, aucun site d'appel n'est modifié. La conversion inverse (`MOS = 5 − value`) se fait au rendu, dans `lib/svi-format.ts`. Effet de bord accepté et documenté : le message d'alerte affichera `svi.mos_inv`, pas « MOS ». Un test de parité vérifie que les trois copies de `THRESHOLDS` restent identiques (utile **indépendamment du SVI**, à livrer seul si le SVI glisse).

Ce que ce levier **ne fait pas**, et je refuse de le maquiller : `check_alerts` ne sait pas calculer un **taux**. Containment, abandon, transfert exigent une branche neuve (I5, ~50 lignes en `create or replace`, sur le modèle exact de la branche `error_rate`). Écrire 0/1 dans `rum_metric` produirait un p75 binaire faux **sans jamais échouer**.

**Contamination à payer immédiatement** (faille confirmée, sous-comptée dans les trois designs) : `queries-grid.ts:49-57` agrège `rum_metric` sans aucun filtre de nom. On introduit `WEB_VITAL_NAMES` dans `lib/rating.ts`, on l'applique à `queries-grid`, `queries-health`, `briefing`, `queries-customers`, et on ajoute un **test de garde source** (regex sur `apps/console/lib/*.ts` : tout `from rum_metric` sans prédicat sur `name` ou sans `call_id is null` fait échouer la CI). C'est le seul moyen de ne pas rejouer l'oubli dans six mois.

### D4 — Routage `svi.*` **en tête** du parcours de spans, pas « comme `track.` ».

La branche est insérée immédiatement après `attrsToObj(span.attributes)`, **avant** `http.server` et **avant** la branche « span interne ». Un test de non-régression vérifie qu'un span OTel standard (auto-instrumentation, DB, serveur) continue d'être routé exactement comme avant.

### D5 — L'encodeur OTLP est **étendu**, de façon additive.

`EmitSpan` gagne `parentSpanId?: string` et `kind?: number`, sérialisés seulement s'ils sont présents. `buildResourceSpans` inchangé pour les émetteurs existants (le test round-trip actuel passe sans modification). C'est un ajout au paquet npm publié : version mineure, pas de rupture. ~15 lignes de SDK + 2 cas de test. Budgété en I0 — les trois designs le supposaient gratuit, il ne l'est pas.

### D6 — Identifiants **déterministes**, dérivés de la clé source.

`ins()` repose entièrement sur un `span_id` stable pour l'idempotence, et le patron `agent-node` génère des identifiants aléatoires. Toute preuve de rejeu des trois designs reposait sur un fait faux. Règle dure de l'adaptateur :

```
call_id   = sha256(app_id + ':' + platform + ':' + <clé source native>)[0..31]   → 32 hex, sert aussi de trace_id
step_id   = sha256(call_id + ':' + seq + ':' + kind)[0..15]                       → 16 hex
metric span_id = sha256(call_id + ':' + metric_name)[0..15]
```
Clé source native : `conversationId+segment index` (Genesys), `ContactId+segment` (Connect), `linkedid+eventseq` (Asterisk CEL), `Channel-Call-UUID` (FreeSWITCH). Le rejeu d'un export complet est alors idempotent par construction, et c'est ce que la preuve d'I1 mesure.

### D7 — RLS écrite **explicitement** dans v48, et `where app_id` maintenu.

v48 pose ses propres policies `tenant_scope` (la boucle de v47 est un one-shot), y compris pour `svi_quality_sample` qui porte **`app_id` dénormalisé** plutôt que d'être scopée par son parent. Et on écrit noir sur blanc dans l'en-tête de migration : **tant que la console se connecte en propriétaire/BYPASSRLS, ces policies sont inertes** ; l'isolation effective des lectures SVI repose sur `where app_id = $n` dans `queries-svi*.ts`. Le test d'isolation en `console_ro` prouve la ceinture, pas la bretelle — et il le dit.

### D8 — Le conflit avec ADR-0001 est tranché : **rien de `gen_ai.*` n'entre dans mip-rum.**

`docs/ADR-0001-supervision-ia-xsom.md` a retiré l'ingestion `gen_ai` (tâches C6/C7/C8, `rum_ai` déprécié). Un adaptateur LiveKit/Pipecat émettant du `gen_ai.*` vers `/v1/traces` verrait ses spans **rejetés**, pas conservés. La latence conversationnelle d'un voicebot (TTFT, TTFB TTS, barge-in) relève de xSOM AI Guard. Hors périmètre de ce plan (§6).

---

## 2. Provenance des données — traitée en premier, sans arrangement

C'est l'angle mort commun aux trois designs. **Aucune source ne produit spontanément le chemin de menu.** Ce qui suit est la carte réelle.

### 2.1 Trois niveaux de provenance, pas un seul tuyau

| Niveau | Ce qu'on obtient | D'où | Travail requis chez le client |
|---|---|---|---|
| **P0 — CDR / segments** | issue, durée, file, ASA, transfert, point d'entrée, rappel 7 j, abandon **global** | Genesys EventBridge (Analytics Detail Events, segments) ; Connect CTR/Kinesis + Contact Lens ; Asterisk CEL+AMI ; FreeSWITCH ESL | **Aucun** (hors accès API / droits) |
| **P1 — Parcours par nœud** | entonnoir de menu, abandon **par nœud**, press-path, no-match / no-input / reprompt, confiance ASR | jalons déclarés dans le flow | **Instrumentation du SVI, flow par flow** |
| **P2 — Qualité voix** | MOS, facteur R, gigue, perte, RTT, codec, par tronçon | RTCP-XR / SIP PUBLISH au SBC, ou `CHANNEL(rtpqos)` Asterisk | **Accès au média** — impossible sur CCaaS cloud pur |

### 2.2 P1 : ce qu'il faut construire, et qui le paie

- **Genesys Cloud.** Les segments donnent `ivr / alert / interact / hold / wrapup` — pas les nœuds Architect. Le détail de parcours n'existe que si le client a déclaré des **Flow Milestones** et des **Flow Outcomes** dans *chacun* de ses flows. Livrable MIP : `packages/svi-pack-genesys` = convention de nommage des jalons (`mip.<flow>.<node>`), procédure Architect, et un **script d'audit de couverture** qui interroge l'API Architect et liste les flows sans jalons.
- **Amazon Connect.** Les CTR sont *contact-level*. Le module par module vit dans les **Contact Flow logs CloudWatch** (autre flux, jamais mentionné par les trois designs) ou dans des `Set contact attributes` posés dans le flow. Livrable : bloc de flow normalisé + lecteur CloudWatch Logs dans l'adaptateur.
- **Asterisk / FreeSWITCH.** AMI donne des canaux, des ponts et des raccrochés. La touche pressée vit dans le dialplan (`Read`, `Background`, `WaitExten`). Livrable : `packages/svi-pack-asterisk` = macro `MIP_NODE(node,kind)` émettant `UserEvent(MIPNode,...)`, plus un `Gosub` à insérer aux points de menu. Équivalent FreeSWITCH en événement ESL custom.

**Conséquence commerciale, à dire au client avant la migration v48, pas après la capture d'écran** : le niveau P1 n'est pas branchable. C'est une **prestation d'intégration récurrente** (à refaire à chaque modification de flow), donc une ligne de service et un cycle de vente différents du SaaS. Un produit vendu comme « supervision passive » couvre P0 + P2 ; l'écran qui vend (`/svi/parcours`) est P1.

**Traitement produit du fossé, plutôt que dissimulation** : `svi_call.provenance text[]` (valeurs `cdr` / `journey` / `voice`) est alimenté par l'adaptateur. Chaque page SVI déclare le niveau qu'elle exige et affiche un bandeau de **couverture de provenance** (« parcours instrumenté sur 34 % des appels — 6 flows sur 11 sans jalons »). Un entonnoir calculé sur 34 % des appels ne s'affiche jamais comme s'il portait sur 100 %. C'est testé (I3).

### 2.3 P2 : la contrainte qui doit décider du pilote

**Genesys Cloud et Amazon Connect ne donnent pas accès au flux RTCP.** La couche 2 n'est réalisable que chez un client qui exploite son propre SBC ou son IPBX. Or le cadrage interdit de communiquer avant E-SVI-4 (produit-svi-cadrage.md:280). Donc : **un pilote CCaaS pur verrouille le produit indéfiniment.** Ce lien entre préalable n°1 (pilote) et préalable n°3 (couche voix) n'est pas dans le cadrage ; il doit être tranché par le dirigeant avant le choix du pilote (§6, décision n°1).

### 2.4 L'adaptateur est un logiciel **on-premise, avec état** — nature de produit nouvelle

mip-rum n'a jamais livré ça : le SDK web est un script sans état, `agent-node` une lib npm sans secret. L'adaptateur IPBX est autre chose :

- il tourne **dans le SI téléphonique du client**, souvent souverain, souvent sans internet sortant direct (émission sortante seule, aucun port entrant — argument de vente) ;
- il est **stateful** : bufférisation des étapes jusqu'à fermeture de l'appel, fenêtre de jointure leg A/leg B, file de rejeu sur coupure ;
- il détient un **secret** (clé HMAC de hachage des numéros).

Livrables associés, budgétés en I1 et non « gratuits » : image OCI + unité systemd, fichier de configuration par variables d'environnement, journal local avec file de rejeu persistée (reprise après redémarrage sans perte), procédure de mise à jour, `--selftest` qui vérifie la connectivité `/v1/traces` et la clé d'app.

### 2.5 Pseudonymisation : clé chez le client, pas de sel dans le dépôt

Aucun mécanisme de sel n'existe dans mip-rum (`grep salt/sel` sur `sql/` et `_shared/` : zéro). Un SHA-256 salé sur ~10⁹ numéros E.164 s'inverse par force brute en secondes si le sel fuit — et la console **devrait** détenir le sel pour instruire un DSAR par numéro. Arbitrage retenu :

- `caller_hash = HMAC-SHA256(clé_client, e164_normalisé)`, calculé **dans l'adaptateur**, la clé n'est **jamais** transmise à MIP ;
- `svi_call.caller_key_id` (identifiant de clé, pas la clé) permet la rotation sans casser le rappel 7 j (fenêtre de rotation ≥ 8 jours, une requête de rappel accepte `key_id` courant et précédent) ;
- **DSAR par personne** : MIP ne peut pas ré-identifier — c'est ce qui rend la pseudonymisation défendable. Le client, responsable de traitement, dispose d'un `svi-adapter hash <numéro>` qui produit le hash à fournir à la console. `erase_svi_caller(app_id, caller_hash)` fait le reste. C'est un flux DSAR **délégué**, à documenter dans le contrat de sous-traitance, pas un tour de passe-passe.

### 2.6 DTMF : on ne stocke jamais la valeur, et on ne la reconstitue pas non plus

La contrainte « une seule touche par ligne » est du théâtre : `string_agg(dtmf, '' order by seq)` reconstitue un PAN distribué sur 16 lignes, et `dtmf_len = 16` puis `3` est un oracle PAN+CVV. Règle retenue :

- l'adaptateur marque les nœuds de saisie sensible (`input_sensitive = true`, déclaré dans le pack d'instrumentation) et n'émet alors **qu'une étape agrégée** : `kind='input'`, `input_class='masked'`, **pas de longueur** ;
- pour les nœuds non sensibles : `input_class` (`menu_choice` | `digits` | `speech`) et `input_len` bornée à 6, aucune valeur ;
- le masquage se fait **dans l'adaptateur**, avant émission. Le serveur ne propose **aucun** mécanisme d'acceptation-puis-rejet : un 400 sur DTMF brut ferait traverser le PAN jusqu'à l'edge function (qui devient alors un point d'enregistrement au sens PCI DSS 4.0.1) et ferait perdre définitivement tout le lot (400 = non rejouable). **On ne fait pas ça.**
- seconde barrière serveur, non destructive du contrat existant : on **ne touche pas** à `RE_LONG_NUM` (≥9 chiffres ; le descendre à 6 masquerait en production les timestamps ms, références de commande et identifiants clients de tous les clients RUM actuels). On ajoute une règle **ciblée** : dans la branche `svi.*` uniquement, tout attribut `svi.*` de type *number* ou *string* contenant ≥6 chiffres consécutifs est remplacé par `[redacted]` et incrémente un compteur `svi_pii_dropped`. Le trou « `scrubProps` renvoie les *number* tels quels » est ainsi fermé là où il compte, sans régression ailleurs.
- **preuve** : le test PCI n'est pas une regex par ligne mais une **agrégation par appel** (`string_agg` sur toutes les colonnes texte de `svi_step` groupées par `call_id`, passée à un validateur de Luhn).

### 2.7 Divulgation IA : un événement, pas une case à cocher

`ai_disclosed_at` renseigné déclarativement ne prouve rien. On distingue deux sources : `ai_disclosure_source in ('flow_event','declared')`. Seul `flow_event` — une étape `kind='disclosure'` réellement émise par le dialplan/flow instrumenté, donc P1 — compte dans l'indicateur de conformité AI Act art. 50. `declared` est affiché séparément et libellé « auto-déclaré ». On ne vend pas une assurance de conformité sur une auto-déclaration.

---

## 3. Modèle de données

`apps/ingest/sql/migration-v48.sql` — idempotente, rejouable par tout `scripts/verify-*.mjs`.

```sql
-- migration-v48 — Supervision SVI : le modèle d'appel.
--
-- CONSTAT (29 juil. 2026). Le cadrage SVI laisse ouvert « svi_call ou extension de
-- rum_span » (produit-svi-cadrage.md:222). L'inventaire du dépôt tranche de fait :
-- rum_session modélise une VISITE (user_agent, device_type, is_bot, page_count
-- incrémental, fusion de vues) ; rum_pageview est structuré par route/referrer/
-- nav_type ; rum_span.duration_ms est NOT NULL et le writer d'ingestion fait
-- upsert(..., ignoreDuplicates: true) — donc aucun span ne peut être ouvert puis
-- fermé. Un appel est atomique, borné, arrive au fil de l'eau et parfois en
-- désordre, avec DEUX identifiants quand il est transféré (leg A / leg B). Et
-- aucune table du schéma ne porte de champ d'ISSUE, qui est le pivot du domaine.
--
-- DÉFAUT que cette migration corrige : il n'existe aucun objet capable de porter
-- un appel. Le modélisr avec les tables RUM produirait un abus de nommage
-- permanent pour un gain nul.
--
-- CORRECTIF : six tables svi_*, plus UNE seule greffe sur le socle partagé
-- (rum_metric.call_id), qui suffit à rendre slo_status() et check_alerts()
-- utilisables sur des appels sans réécrire une ligne de PL/pgSQL.
--
-- CE QUE LA v47 NE FAIT PAS POUR NOUS. La boucle qui pose les policies
-- tenant_scope est un `do $$ … loop` exécuté UNE FOIS, au moment de v47 : ce
-- n'est pas un event trigger. Les tables créées ici n'en héritent PAS. On les
-- pose donc explicitement ci-dessous. Et, comme l'écrit l'en-tête de v47 : tant
-- que la console se connecte avec un rôle propriétaire/BYPASSRLS, ces policies
-- restent INERTES. L'isolation effective des lectures SVI repose sur le
-- `where app_id = $n` de apps/console/lib/queries-svi*.ts — obligatoire, testé
-- par une garde source en CI.
--
-- PAS DE MIROIR DANS rum_span (écart assumé à la porte E-SVI-1 du cadrage) :
-- duration_ms NOT NULL + ignoreDuplicates rendent le miroir divergent par
-- construction, et app/tracing/[traceId]/page.tsx code en dur front/back/detail.
-- svi_call.trace_id est conservé pour rendre une projection future possible.

-- ── 1. L'appel : agrégat MUTABLE (patron upsert_rum_session, pas alias) ──────
create table if not exists svi_call (
  id              bigint generated always as identity primary key,
  app_id          text not null,            -- dénormalisé : condition de tout scoping
  call_id         text not null,            -- DÉTERMINISTE : sha256(app|platform|clé source)
  trace_id        text not null,            -- = call_id (32 hex) ; projection future
  merged_into     text,                     -- fusion leg A/B : on ne supprime JAMAIS
  platform        text not null,            -- genesys|connect|asterisk|freeswitch|replay
  adapter_version text not null,            -- flux tiers instables : versionné explicitement
  source_schema   text,                     -- version du schéma source détectée
  provenance      text[] not null default '{}',  -- 'cdr' | 'journey' | 'voice'
  direction       text not null default 'inbound'
                    check (direction in ('inbound','outbound','internal')),
  entry_point     text,                     -- service appelé (libellé, jamais un numéro brut)
  flow_id         text, flow_version text,
  caller_hash     text,                     -- HMAC-SHA256 posé DANS L'ADAPTATEUR
  caller_key_id   text,                     -- identifiant de clé (rotation), jamais la clé
  caller_country  text,                     -- dérivé de l'indicatif E.164, jamais d'IP
  started_at      timestamptz not null,
  answered_at     timestamptz, ended_at timestamptz,
  status          text not null default 'open' check (status in ('open','closed')),
  close_reason    text,                     -- source_complete | assembler_timeout
  duration_ms     int, ivr_ms int, queue_ms int, talk_ms int, setup_ms int,
  -- CHAMP PIVOT : containment, abandon et transfert s'en déduisent tous les trois.
  -- NULLABLE tant que status='open' : un appel en cours n'a pas d'issue, et
  -- inventer 'failed' à la création empoisonnerait les trois taux.
  outcome         text check (outcome in ('contained','transferred','abandoned','failed')),
  outcome_detail  text,                     -- caller_hangup|no_agent|timeout|sip_error|…
  hangup_party    text check (hangup_party in ('caller','callee','platform','unknown')),
  sip_final_code  int,
  queue_name      text, wait_ms int, transfer_target text, agent_group text,
  menu_path_final text, menu_depth int, exit_node text,
  task_name       text, task_success boolean,   -- self-service success ≠ containment
  ai_agent        boolean not null default false,
  ai_disclosed_at timestamptz,
  ai_disclosure_source text
                    check (ai_disclosure_source in ('flow_event','declared')),
  mos_p05 double precision, mos_avg double precision,
  jitter_p95_ms double precision, loss_max_pct double precision, rtt_avg_ms double precision,
  quality_tags    text[] not null default '{}',  -- low_mos|high_jitter|high_packet_loss
  is_test         boolean not null default false, -- sonde/replay ≠ trafic réel (≠ is_bot)
  source_ref      jsonb,                     -- identifiants d'origine : audit de réconciliation
  ingested_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- un appel clos porte forcément une issue ; un appel ouvert n'en porte jamais
  constraint svi_call_outcome_ck check (
    (status = 'open'   and outcome is null) or
    (status = 'closed' and outcome is not null))
);
create unique index if not exists svi_call_key on svi_call (app_id, call_id);
create index if not exists svi_call_app_ts_idx on svi_call (app_id, started_at desc);
create index if not exists svi_call_outcome_idx on svi_call (app_id, outcome, started_at desc);
create index if not exists svi_call_recall_idx on svi_call (app_id, caller_hash, started_at)
  where caller_hash is not null;                       -- containment net à 7 jours
create index if not exists svi_call_open_idx on svi_call (app_id, started_at)
  where status = 'open';                               -- svi_close_stale_calls()

-- ── 2. L'étape : niveau P1 (exige une instrumentation côté client) ───────────
create table if not exists svi_step (
  id            bigint generated always as identity primary key,
  step_id       text not null unique,        -- DÉTERMINISTE : sha256(call_id|seq|kind)
  parent_step_id text,
  app_id        text not null,               -- PAS seulement call_id : sinon hors scoping
  call_id       text not null,               -- pas de FK : l'étape peut précéder l'entête
  seq           int not null,
  kind          text not null check (kind in
                  ('disclosure','greeting','prompt','menu','input','lookup',
                   'queue','transfer','agent','bot_turn','disconnect','error')),
  node_id       text,                        -- identifiant STABLE du nœud dans le flow
  node_label    text, menu_path text, depth int, branch text,
  -- SAISIE : jamais la valeur. Un nœud sensible n'émet qu'une étape agrégée,
  -- sans longueur (sinon len=16 puis len=3 est un oracle PAN+CVV — PCI DSS 4.0.1).
  input_class   text check (input_class in ('menu_choice','digits','speech','masked')),
  input_len     int check (input_len is null or input_len between 1 and 6),
  input_sensitive boolean not null default false,
  no_match      boolean not null default false,
  no_input      boolean not null default false,
  reprompt_index int not null default 0,
  asr_confidence double precision, rejected boolean,
  milestone     text, flow_outcome text,     -- parité Genesys Flow Milestones/Outcomes
  started_at    timestamptz not null,
  duration_ms   int,                          -- NULLABLE (≠ rum_span) : étape ouverte
  exit_reason   text
);
create index if not exists svi_step_call_idx on svi_step (app_id, call_id, seq);
create index if not exists svi_step_node_idx on svi_step (app_id, node_id, started_at desc);

-- ── 3. Le tronçon et la série de qualité : ce que rum_metric ne sait pas ─────
create table if not exists svi_leg (
  id         bigint generated always as identity primary key,
  app_id     text not null, call_id text not null, leg_ref text not null,
  role       text not null check (role in ('carrier_edge','sbc_edge','ivr_edge','agent_edge')),
  dir        text not null check (dir in ('rx','tx')),   -- la voix se qualifie par SENS
  codec      text, ptime_ms int, sample_rate int, carrier text,
  -- non nullable : aucun MOS ne s'affiche sans sa provenance. G.107 est une
  -- ESTIMATION passive, P.863/POLQA une mesure perçue intrusive et sous licence.
  mos_method text not null check (mos_method in ('g107_e_model','g107_1_wb','vendor_reported')),
  mos_avg double precision, mos_min double precision,
  r_factor_avg double precision, r_factor_min double precision,
  jitter_avg_ms double precision, jitter_max_ms double precision,
  loss_avg_pct double precision, loss_max_pct double precision,
  rtt_avg_ms double precision, rtt_max_ms double precision,
  packets_sent bigint, packets_lost bigint,
  e_model_params jsonb,                       -- Ie_eff, Bpl, Ta, R0 : calcul auditable
  started_at timestamptz, ended_at timestamptz
);
create unique index if not exists svi_leg_key on svi_leg (app_id, call_id, leg_ref, dir);

create table if not exists svi_quality_sample (
  id       bigint generated always as identity primary key,
  app_id   text not null,                     -- dénormalisé : pas de scoping par parent
  leg_pk   bigint not null references svi_leg(id) on delete cascade,
  ts       timestamptz not null, window_ms int,
  jitter_ms double precision, loss_pct double precision, rtt_ms double precision,
  r_factor double precision, mos double precision
);
create index if not exists svi_quality_sample_idx on svi_quality_sample (app_id, leg_pk, ts);

-- ── 4. L'état PARTAGÉ : la file. Cousin d'uptime_result, hors de la trace. ───
create table if not exists svi_queue_sample (
  id bigint generated always as identity primary key,
  app_id text not null, queue_name text not null, ts timestamptz not null,
  depth int, agents_available int, agents_staffed int,
  longest_wait_ms int, ewt_ms int,
  offered int, answered int, answered_within_sla int, abandoned int, sla_seconds int
);
create index if not exists svi_queue_sample_idx on svi_queue_sample (app_id, queue_name, ts desc);

-- ── 5. Réconciliation leg A / leg B ─────────────────────────────────────────
create table if not exists svi_call_link (
  app_id text not null,
  id_kind text not null,       -- sip_call_id|linkedid|conversation_id|contact_id|ucid
  external_id text not null,
  call_id text not null,
  ts timestamptz not null default now(),
  primary key (app_id, id_kind, external_id)
);

-- ── 6. Greffe unique sur le socle partagé ───────────────────────────────────
-- UNE ligne rum_metric par appel clos (session_id null, app_id renseigné) rend
-- slo_status() utilisable tel quel : sa branche générique compte la part de
-- rating='good' sur `rum_metric where name = s.metric`. Métriques stockées en
-- sens « plus bas = meilleur » (svi.mos_inv = 5 − MOS_p05) pour n'avoir à
-- toucher NI rating2026() NI ses trois miroirs de THRESHOLDS.
-- La colonne call_id est indispensable à erase_svi_caller() : sans elle, ces
-- lignes survivraient à un effacement DSAR (elles n'ont pas de session_id).
alter table rum_metric add column if not exists call_id text;
create index if not exists rum_metric_call_idx on rum_metric (call_id)
  where call_id is not null;

-- ── 7. RLS + accès console (la boucle de v47 ne couvre PAS ces tables) ───────
do $$
declare t text;
begin
  foreach t in array array['svi_call','svi_step','svi_leg','svi_quality_sample',
                           'svi_queue_sample','svi_call_link'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_scope on public.%I', t);
    execute format('create policy tenant_scope on public.%I for all '
                   'using (app_id = any(current_app_ids()))', t);
    if exists (select 1 from pg_roles where rolname = 'console_ro') then
      execute format('grant select on public.%I to console_ro', t);
    end if;
  end loop;
end $$;

-- ── 8. Fonctions : assemblage, fermeture différée, conformité ────────────────
-- Résout (ou crée) le call_id canonique pour un ensemble d'identifiants externes.
-- VERROU CONSULTATIF obligatoire : deux legs peuvent arriver dans deux requêtes
-- HTTP simultanées, donc deux isolats, deux transactions — sans lock on crée deux
-- call_id avant que le lien n'existe. Le verrou est pris sur hash(app_id||ids
-- triés), donc les deux writers concurrents se sérialisent sur la MÊME clé.
create or replace function svi_resolve_call(p_app_id text, p_ids jsonb)
returns text language plpgsql security definer
set search_path = public, pg_temp as $$ /* corps en I1 */ begin return null; end $$;

-- Fusionne deux call_id reliés a posteriori (transfert découvert tardivement).
-- merged_into pointe vers le survivant ; aucune ligne n'est supprimée.
create or replace function svi_merge_calls(p_app_id text, p_keep text, p_merge text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$ /* corps en I1 */ begin end $$;

-- Sans fermeture des appels orphelins, le containment gonfle SILENCIEUSEMENT.
create or replace function svi_close_stale_calls(p_hours int default 4)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare n int;
begin
  update svi_call set status = 'closed', outcome = 'failed',
         close_reason = 'assembler_timeout', updated_at = now()
   where status = 'open' and started_at < now() - make_interval(hours => p_hours);
  get diagnostics n = row_count; return n;
end $$;

-- DSAR par personne : le client fournit le caller_hash (il détient la clé HMAC,
-- MIP ne peut pas ré-identifier — c'est ce qui rend la pseudonymisation tenable).
create or replace function erase_svi_caller(p_app_id text, p_caller_hash text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$ /* corps en I6 */ begin return '{}'::jsonb; end $$;

-- Rétention par table : svi_quality_sample 30 j · svi_step 90 j · svi_call 13 mois
-- (comparaison annuelle, justifiée par finalité) · svi_call_link 30 j.
create or replace function purge_svi(p_app_id text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$ /* corps en I6 */ begin return '{}'::jsonb; end $$;
```

**Ce que le schéma n'a volontairement pas** : contrainte XOR `session_id`/`call_id` sur `rum_metric` (elle échouerait — des lignes légitimes ont les deux à null — et le motif `exception when others then null` du dépôt **avale** un `ADD CONSTRAINT` en échec, produisant une migration verte et une contrainte absente) ; `svi_rollup_hourly` (v49, I5) ; `svi_menu_node` (le libellé vit sur `svi_step.node_label`, pas besoin d'un référentiel avant d'avoir un client).

---

## 4. Incréments

Échelle d'effort : S ≈ 1-2 j, M ≈ 3-5 j, L ≈ 8-12 j, pour un développeur qui connaît le dépôt. Aucun budget calendaire n'existe au cadrage (LAISSÉ DE CÔTÉ #7) : ces valeurs sont des ordres de grandeur, pas un engagement.

### I0 — Le modèle, l'ingestion, et une fiche d'appel qui s'affiche — **L**

**Périmètre.** `migration-v48.sql` (§3, avec RLS explicite). Branche `svi.*` dans `_shared/otlp.mjs`, insérée **en tête** du parcours de spans (D4) : `svi.call` → `svi_call` via RPC `upsert_svi_call`, `svi.step.*` → `svi_step`, `svi.leg` → `svi_leg`. Extension additive d'`otlp-encode.ts` (`parentSpanId`, `kind`) + cas de test round-trip. Écriture des tables `svi_*` dans `v1-traces/index.ts` **et** `dev-server.mjs` (le helper `ins()` impose `onConflict: "span_id"` : `svi_call` passe par `supabase.rpc()`, `svi_step` par un upsert sur `step_id` — c'est une modification réelle du writer, pas une ligne de bullet). Règle de masquage SVI dans `scrub.mjs` (§2.6, sans toucher `RE_LONG_NUM`). `WEB_VITAL_NAMES` + patch des 4 lecteurs `rum_metric` contaminables + garde source en CI. `scripts/gen-svi-traffic.mjs` (générateur OTLP neuf — `gen-traffic.mjs` fait 26 lignes et pilote Chromium, il n'y a **aucun** patron à copier). Pages `/svi/appels` (liste filtrable) et `/svi/appels/[callId]` (chronologie sur `svi_step`, patron visuel de `components/sessions/Timeline.tsx`). Entrées `nav-items.tsx` + `glossary.ts`. **`svi_call.platform` est affiché sur la fiche et dans la liste** : `replay` est visible à l'écran, jamais caché.

**Preuve** — `pg_virtualenv node scripts/verify-svi-modele.mjs` :
1. un appel complet (accueil → menu → saisie → file → transfert) encodé par `otlp-encode`, passé dans `flattenOtlp`, inséré → 1 `svi_call` clos, 7 `svi_step` ordonnés ;
2. **le rejeu du même payload ne crée aucune ligne** (identifiants déterministes, D6) ;
3. payload en **désordre** (fin avant début, étape avant entête) → un seul `svi_call`, `outcome` renseigné, `status='closed'` ;
4. `insert svi_call(status='closed', outcome=null)` **rejeté** par `svi_call_outcome_ck` ; `insert svi_call(outcome='blah')` rejeté ;
5. **non-régression otlp.mjs** : un lot contenant un span `http.server`, un span SERVER OTel et un span interne DB produit exactement les mêmes lignes `rum_span` qu'avant la branche `svi.*` (comparaison de sortie sur fixture) ;
6. **non-contamination** : après injection SVI, `overviewGrid()` (queries-grid) rend un score identique à celui calculé sans les lignes SVI ; la garde source échoue si un `from rum_metric` sans filtre de nom est réintroduit ;
7. **PCI par agrégation** : `string_agg` de toutes les colonnes texte de `svi_step` par `call_id` ne contient aucune suite passant le test de Luhn ; un nœud `input_sensitive` n'a produit **aucune** longueur ;
8. isolation `console_ro` : deux tenants symétriques, comptage **sans `where app_id`** → 0 ligne du tenant B (la preuve porte sur la ceinture ; l'en-tête de migration dit qu'elle est inerte tant que la console est propriétaire).

**Démonstration** : `pnpm dev` + `node scripts/gen-svi-traffic.mjs` → `/svi/appels`, ouvrir un appel, voir son déroulé. Bandeau `platform: replay`.

### I1 — Adaptateur IPBX P0 et assembleur — **L**

**Périmètre.** `packages/svi-adapter-ipbx` sur le patron `packages/agent-node/src/core.ts` : Asterisk CEL + AMI (`Newchannel`, `DialBegin`, `BridgeEnter`, `Hangup`, `CHANNEL(rtpqos)` au raccroché) ; FreeSWITCH ESL en second mapper si le pilote l'exige. Module **pur** `reconcile.ts` (fenêtre de jointure, `linkedid` quand la plateforme le donne, sinon appariement `caller_hash + horodatage ± 2 s`, `source_ref` pour l'audit). Corps réel de `svi_resolve_call` (**verrou consultatif**, §3) et `svi_merge_calls`. `svi_close_stale_calls` en cron (bloc `pg_cron` échouant proprement en local). HMAC dans l'adaptateur + CLI `svi-adapter hash`. File de rejeu **persistée sur disque** (reprise après redémarrage). Empaquetage : image OCI, unité systemd, `--selftest`. Compteur d'attributs inconnus par `source_schema`, émis comme métrique — parade à la dérive de schéma des flux tiers.

**Écart au cadrage assumé** : le cadrage ordonne E-SVI-2 (CCaaS) avant E-SVI-5 (IPBX). On inverse, parce que l'IPBX lève le préalable n°2 (plateforme de test) pour le prix d'un conteneur, qu'il donne l'accès média nécessaire à P2, et qu'il n'exige pas le préalable n°1 (non levé). **Ce n'est pas une décision de cible** : le choix secteur public/entreprise appartient au dirigeant (§6). Le garde-fou est que le vocabulaire des nœuds et les écrans restent neutres, et que I7 existe.

**Preuve** — `scripts/verify-svi-adaptateur.mjs`, Asterisk conteneurisé + scénarios SIPp :
1. rejeu d'un export de ≥500 appels : `count(svi_call) == count(export)`, 0 doublon, 0 étape orpheline, **rejeu intégral une seconde fois → 0 ligne créée** ;
2. `reconcile.ts` en test unitaire, 6 scénarios : transfert simple, double transfert, arrivée désordonnée, leg B sans leg A, appel jamais raccroché, **deux appels simultanés du même appelant** ;
3. **concurrence** (le mode de panne réel, absent des trois designs) : 8 writers HTTP simultanés poussant les deux legs du même appel → **un seul** `call_id`, vérifié 50 fois ;
4. appel ouvert depuis 5 h → `svi_close_stale_calls()` le ferme en `failed/assembler_timeout`, et le containment recalculé **baisse** ;
5. coupure réseau de 30 s puis redémarrage du processus adaptateur → aucun appel perdu après reprise ;
6. écart de containment < 1 % vs le rapport CDR natif d'Asterisk sur la même fenêtre. **Critère d'échec décidé à l'avance** : au-delà de 2 %, l'incrément n'est pas livré tant que la différence de définition n'est pas documentée ligne à ligne.

### I2 — Vue d'ensemble, containment **net**, couverture de provenance — **M**

**Périmètre.** `lib/svi-outcome.ts` **pur** (containment/abandon/transfert dérivés du seul `outcome`, ASA, DMT) ; `lib/recall.ts` **pur** (rappel 7 j sur `caller_hash`, tolérant `caller_key_id` courant + précédent) ; `lib/queries-svi.ts` (intervalles **exclusivement** depuis `PERIODS`, valeurs en `$n`, `where app_id = $n` systématique). Page `/svi` : `SupervisionHero` layout `split`, HeroStat = **containment net**, `DeltaBadge` vs période précédente, `StackedBars` des issues par heure, `Donut`, `RankBar`. Bandeau de **couverture de provenance** (§2.2). Clés de glossaire : containment, containment net, abandon, transfert, ASA, rappel 7 j.

**Le containment net arrive ICI, pas plus tard** (greffe des critiques : « sans lui le containment affiché est un chiffre de complaisance, et l'acheteur du domaine le sait »). Garde produit **testée** : la page n'affiche jamais le brut sans le net à côté, et le brut est libellé « apparent ».

**Preuve.** Test unitaire : les quatre taux somment à 100 % sur tout jeu d'issues (y compris `failed` seul, jeu vide, appels ouverts exclus). Script : 100 appels contenus dont 30 rappels < 7 j → brut 100 %, net 70 %. E2E Playwright : la page ne rend pas le brut sans le net (assertion sur le DOM, pas sur le calcul) ; aucune requête JS client.

### I3 — Parcours : pack d'instrumentation P1 + entonnoir et press-path — **L**

**Périmètre.** `packages/svi-pack-asterisk` (macro `MIP_NODE`, dialplan de référence, guide de pose) et l'audit de couverture. `lib/queries-svi-funnel.ts` et `lib/queries-svi-paths.ts` (~160 lignes de SQL **neuf** : `queries-funnel.ts:29-33` et `queries-paths.ts:30` joignent `rum_session` pour `device_type`/`is_bot`, inapplicable ; **seule la logique pure est réutilisée**). `lib/funnel.ts`, `lib/paths.ts`, `lib/sankey.ts`, `components/Funnel.tsx`, `components/Sankey.tsx` : **zéro ligne modifiée**. Page `/svi/parcours` layout `wide`. Détection de reprompt sur le patron de `RageDetector` (`packages/rum-sdk/src/frustration.ts`) : « l'appelant retape la même touche ».

**Preuve.** Le test « `computeFunnel` donne le même résultat sur un jeu web et un jeu ré-étiqueté » est **rejeté** : `computeFunnel` prend `(number|null)[][]`, il est vrai par construction et ne teste rien. À la place :
1. jeu de 1 000 appels instrumentés avec un nœud à 34 % d'abandon **injecté** → la page l'identifie, valeur exacte ;
2. **couverture partielle** : 40 % des appels sans `journey` dans `provenance` → l'entonnoir affiche « calculé sur 400 appels sur 1 000 » et le taux n'est **pas** extrapolé (assertion e2e sur le libellé) ;
3. comparaison au rapport natif du pilote (Flows Destinations Genesys / IVR Press Path NICE) quand il existe : écart < 2 points sur les 5 nœuds les plus fréquentés.

### I4 — Qualité de la voix — **L** · **GATE : préalable n°3 tranché avant, pas pendant**

**Périmètre.** `lib/emodel.ts` **pur** : G.107 (narrowband) et **G.107.1** (wideband) — les deux, parce que le MOS-CQE wideband est sur une autre échelle et que les codecs dominants en 2026 ne sont pas tabulés en G.107. `Ie_eff` / `Bpl` viennent de **G.113 annexe I**, jamais de G.107 : c'est la source qu'il faut se procurer, et c'est le trou de compétence reconnu au cadrage §5. Collecteur : `CHANNEL(rtpqos,audio,all)` (Asterisk, une seule mesure au raccroché) **et** RTCP-XR / SIP PUBLISH `vq-rtcpxr` (RFC 3611/6035) au SBC pour la série intra-appel. Agrégats dénormalisés sur `svi_call`. Rollup horaire des séries (patron `migration-v12.sql:20`) — **budgété ici, pas repoussé** : 10 000 appels/j × 2 legs × 1 rapport/5 s ≈ 1,2 M lignes/j. Page `/svi/voix`, bandeau permanent de provenance.

**Ce qui est dit à l'écran, pas seulement en réunion** : (a) « estimation par modèle E (G.107/G.107.1) sur RTCP-XR — pas une mesure perçue POLQA (P.863) » ; (b) sur les appels dont la seule source est `rtpqos`, « mesure agrégée au raccroché : une micro-coupure de 3 s dans un appel de 10 min n'y est pas visible » ; (c) le tronçon appelant↔SBC n'est pas vu si le client ne possède pas le SBC.

**Preuve.** (1) `lib/emodel.ts` reproduit les valeurs de référence **discriminantes** — pas `R0 = 93,2` par défaut, qui ne teste que les constantes, mais les couples (codec, taux de perte) de G.113 App. I, à ±0,1 sur R. Si ces vecteurs ne sont pas obtenables, **la preuve tombe et il faut acheter une référence** : c'est une décision de dirigeant (§6). (2) Dégradation fabriquée : `tc netem` 3 % de perte + 40 ms de gigue sur le conteneur Asterisk → `svi.mos_inv` de l'appel noté `poor`, une `alert_rule(metric='svi.mos_inv', comparator='>', threshold=1.4)` déclenche et `dispatch-alerts.mjs` passe la livraison à `delivered`. **Aucune promesse de détection intra-appel en temps réel** avec la seule source `rtpqos` : l'alerte survient au raccroché. (3) Test de parité des trois copies de `THRESHOLDS`.

### I5 — Files, SLO, alertes de taux — **M**

**Périmètre.** Alimentation de `svi_queue_sample` ; `lib/svi-service-level.ts` pur (ASA, 80/20, abandon en file, occupation) calculés **sur la file**, pas sur la trace. `migration-v49.sql` : `svi_rollup_hourly` + `refresh_svi_rollups()` ; **branche neuve dans `check_alerts()` et `metric_baseline()`** pour la famille de métriques de **taux** (`svi_rate:contained`, `svi_rate:abandoned`), lues sur le rollup, sur le modèle exact de la branche `error_rate` (~50 lignes, `create or replace`, idempotent). SLO **sans une ligne de SQL neuve** : `slo(metric='svi.setup_ms')` → la branche générique de `slo_status()` compte la part de `rating='good'`, c'est-à-dire le taux d'appels établis dans les temps. Pages `/svi/files` et `/svi/disponibilite`. Sonde `sip-options` greffée sur `uptime_check`/`record_uptime_result` (la structure se réutilise, la sonde HTTP de `functions/uptime/index.ts` non).

**Preuve.** (1) SLO 99,9 % sur 30 j, injection d'échecs → budget consommé conforme au calcul manuel, `check_slo_burn()` déclenche, `alert_event` rattaché au SLO — **et zéro modification de `slo_status`** (diff vide sur v17, vérifié par le script). (2) **Saisonnalité** : 8 semaines avec pic récurrent lundi 9 h → la règle baseline ne déclenche **pas** sur le pic normal et déclenche sur un effondrement de volume un lundi 9 h. `v_anomaly` n'est branchée nulle part (assertion : aucune occurrence dans `lib/queries-svi*.ts`). (3) Branche de taux : déclenche à 8 % d'abandon, pas à 4 %. (4) `docker stop` sur l'Asterisk → `uptime_result.ok=false`, livraison `delivered` en < 2 min sur un canal **réel** (préalable n°4).

### I6 — La conformité comme fonctionnalité — **M**

**Périmètre.** `lib/svi-dsar.ts` : **module parallèle**, pas une extension de `lib/dsar.ts` (dont l'ancre est `rum_session.user_hash` et dont l'invariant `DSAR_TABLES === [...children, anchor]` est testé — l'étendre le casserait ; les tables SVI sont ancrées sur `svi_call.caller_hash` et rattachées par `call_id`). Corps réels d'`erase_svi_caller` (y compris `rum_metric where call_id in (…)`) et de `purge_svi`. Page `/svi/conformite` : part d'appels IA avec divulgation **prouvée par événement de flow** (`flow_event`) affichée séparément de l'auto-déclarée ; couverture du masquage de saisie ; rétention effective par table vs politique déclarée. Export DSAR par appel via l'API v1 existante.

**Preuve** — `scripts/verify-conformite-svi.mjs` (patron `verify-conformite.mjs`) : export DSAR → les 6 tables SVI **plus** `rum_metric` apparaissent (assertion sur la **liste complète**, pas un échantillon) ; `erase_svi_caller` → 0 ligne résiduelle portant le hash, y compris dans `rum_metric` ; `purge_svi` → `svi_quality_sample` vidé au-delà de 30 j, `svi_call` conservé ; l'attestation « aucun audio » n'est **pas** un test sur `information_schema` (qui ne voit que des noms de colonnes et laisserait passer une transcription dans `source_ref jsonb` ou `node_label`) mais une **contrainte de longueur** sur les colonnes texte libres (`node_label ≤ 120`, `outcome_detail ≤ 80`) plus une revue d'adaptateur documentée.

### I7 — Adaptateur CCaaS du pilote — **L** · **GATE : préalable n°1 non levé**

Une seule plateforme, celle du pilote. Genesys EventBridge (segments) **ou** Connect Kinesis CTR + Contact Lens + Contact Flow logs CloudWatch. Détection de version de schéma source, refus explicite d'un schéma inconnu (rejet tracé, pas une ligne silencieusement fausse). Réutilise `reconcile.ts`, le vocabulaire et les écrans éprouvés en I1-I6.

**Preuve.** 24 h de trafic réel du pilote, écart < 2 % entre le containment de `/svi` et le rapport natif de la plateforme sur la même fenêtre. **Critère d'échec décidé avant de commencer** : au-delà de 5 %, l'incrément n'est pas livré ; entre 2 et 5 %, il est livré avec une note de différence de définition (bornes de segment, transferts consultatifs, appels multi-conversations) rédigée et signée.

---

## 5. Hors périmètre — explicitement

1. **Test actif / appels de test in-country.** L'actif de Cyara/Spearline est un parc de numéros et des contrats opérateurs dans 145+ pays. Partenariat si un client l'exige, jamais un développement.
2. **Ingestion de spans `gen_ai.*` et latence conversationnelle de voicebot.** ADR-0001 : xSOM AI Guard est la seule source de vérité de l'observabilité IA/LLM ; l'ingestion `gen_ai` a été **retirée** de mip-rum (C6/C7/C8). Un hook LiveKit/Pipecat émet vers xSOM, pas ici. Une corrélation appel↔session IA se ferait par `call_id` partagé entre les deux produits — spécification à écrire côté xSOM, pas ici.
3. **Audio, transcription, empreinte vocale.** Aucun signal, aucun texte de conversation. Posture la plus défendable face au risque CIPA de « tiers écoutant » (Ambriz v. Google, Galanter v. Cresta, Taylor v. ConverseNow) et exclusion nette du BIPA.
4. **WER.** Non mesurable en production sans transcription de référence. On livre no-match, no-input, reprompt, distribution de confiance, taux de rejet.
5. **POLQA (P.863).** Norme sous licence, mesure intrusive. On livre G.107/G.107.1 et on le dit à l'écran.
6. **Couche 4 (FCR, DMT, CSAT).** Le cadrage l'annonce et ne la séquence nulle part (LAISSÉ DE CÔTÉ #6). `task_name`/`task_success` en sont l'amorce, l'événement `feedback` existant fournit le CSAT. Aucun épic ici : l'assumer à l'oral plutôt que de laisser croire qu'elle arrive avec le reste.
7. **Miroir dans `rum_span` et affichage d'un appel dans `/tracing/[traceId]`** (D2).
8. **Bascule de la console en `console_ro` + `withTenant()`.** Décision d'exploitation touchant tout le produit existant (v47 le dit), pas un sous-chantier SVI.
9. **Temps réel intra-appel.** Les spans sont émis à la fermeture ; les CDR arrivent en différé ; les Call Summary Twilio mettent jusqu'à 30 min. Aucune promesse de temps réel, sauf pour `svi_queue_sample` (état de file, échantillonné).
10. **Nom du produit, modèle de prix, cible.** LAISSÉ DE CÔTÉ #2, #3, #4 (§6).

---

## 6. Risques ouverts et décisions qui appartiennent au dirigeant

### Décisions de dirigeant

1. **Le pilote doit-il posséder son média ?** Un pilote CCaaS pur (Genesys Cloud, Connect) rend la couche 2 **inatteignable**, et le cadrage interdit de communiquer avant E-SVI-4 : le produit serait verrouillé indéfiniment. Un pilote IPBX/SBC lève P2. Ce lien entre préalable n°1 et préalable n°3 n'est pas dans le cadrage. **À trancher avant la première ligne de v48.**
2. **Vend-on l'instrumentation P1 comme une prestation ?** L'entonnoir de menu et l'abandon par nœud exigent un chantier chez le client, flow par flow, refait à chaque modification de flow. Soit c'est une ligne de service facturée (et le cycle de vente change), soit `/svi/parcours` reste une démonstration et le produit vendu est P0+P2. Il n'y a pas de troisième option.
3. **Achat des vecteurs de référence du modèle E.** G.107 est publique ; les `Ie_eff`/`Bpl` par codec vivent en G.113 annexe I, et les codecs wideband dominants n'y sont pas tous tabulés. Sans référence, la preuve d'I4 est un test des constantes par défaut — donc rien. Budget d'acquisition ou mission courte d'expert télécom (recommandation du cadrage §5) : c'est le préalable n°3.
4. **Rétention 13 mois sur `svi_call`.** Choisie pour la comparaison annuelle, au-delà des 6 mois de référence CNIL (qui visent les enregistrements, pas les métadonnées). Toute fenêtre longue doit être justifiée par finalité dans l'en-tête de migration et dans le registre. Arbitrage à valider par le DPO du pilote, avec la clause de sous-traitance sur le DSAR délégué (§2.5).
5. **Cible IPBX souverain ou entreprise CCaaS** (LAISSÉ DE CÔTÉ #4). Le plan ordonne l'IPBX en premier pour des raisons techniques (levée du préalable n°2, accès média) et pose I7 pour ne pas préempter. Mais le dialplan de démonstration, le vocabulaire des nœuds et les captures d'écran orienteront le discours : si la cible est CCaaS, il faut le dire avant I1.
6. **Nom, prix, communication** (#2, #3, cadrage :280). Avant I4, le seul nom honnête est « analyse de parcours vocal », y compris en interne — le vocabulaire de démonstration devient le vocabulaire de vente sans qu'on s'en aperçoive.

### Risques ouverts, acceptés en connaissance de cause

| Risque | Traitement / acceptation |
|---|---|
| Réconciliation leg A/B sans identifiant de liaison | Appariement heuristique `caller_hash + ±2 s`. Rate les transferts en cascade et les appels simultanés du même appelant. Un appel coupé en deux = containment **flatteur** et faux. Traité par 6 scénarios + test de concurrence (I1) ; **accepté** que le cas « SBC réécrivant le Call-ID sans identifiant propagé » reste non résolu — il doit être détecté sur données réelles avant I2. |
| `check_alerts` p75 sur `svi.mos_inv` | p75 de `5 − MOS_p05` ⇔ **p25 du MOS** : l'alerte se déclenche quand un quart des appels sont mauvais, pas quand 75 % le sont. Défendable et documenté dans le glossaire. Le p75 brut sur le MOS aurait été l'erreur. |
| `metric_baseline` exige ≥4 échantillons au même créneau dow+heure | ~4 semaines d'historique. Sur un pilote de 2 semaines l'alerting baseline est **muet, pas faux** — à dire au client. Mode threshold en attendant. |
| Volumétrie `svi_quality_sample` | Rollup horaire livré **dans** I4, pas après. Pleine résolution conservée uniquement pour les appels tagués — en assumant la circularité (le tag est calculé sur les agrégats de leg, pas sur la série, donc le raisonnement n'est pas circulaire, mais un défaut invisible aux agrégats sera perdu). |
| Dérive de schéma des flux tiers | Compteur d'attributs inconnus par `source_schema` + règle d'alerte. Ne l'empêche pas ; le rend visible. Borne la promesse « temps réel ». |
| Adaptateur jetable si le pilote change de plateforme | I0, I2, I3, I5, I6 sont indépendants de la plateforme ; I1 et I7 ne le sont pas. Le rayon du risque est limité, pas supprimé. |
| Convention OTel SIP (issue semconv #1114, ouverte depuis 2022) | `svi.*` est propriétaire par construction. `docs/semconv/svi.yaml` (registre versionné) + `docs/semconv/svi-to-sip.md` (table de correspondance) rendent une migration d'attributs mécanique. Les tableaux de bord et les contrats d'ingestion signés, non. |
| Dispersion au détriment des trois produits existants | Le cadrage impose que le SVI démarre après les quatre chantiers livrés. 8 incréments dont 4 lourds : le risque « Moyenne » du cadrage est optimiste. |
| `THRESHOLDS` tripliqué | Le test de parité des trois copies est **obligatoire**, et il est utile indépendamment du SVI. À livrer seul si le SVI glisse. |

---

## 7. Traitement des failles relevées par les critiques

| Faille | Traitement |
|---|---|
| Branche `svi.*` posée « comme `track.` » = code mort | **Corrigé** : branche en tête du parcours de spans (D4), + test de non-régression sur le routage OTel existant. |
| `otlp-encode` ne sait pas émettre de hiérarchie | **Corrigé** : extension additive `parentSpanId`/`kind` + cas de test round-trip, budgétée en I0 (D5). |
| RLS « héritée » de v47 : contresens | **Corrigé** : policies écrites explicitement dans v48, `app_id` sur toutes les tables y compris `svi_quality_sample` (D7). |
| Policies inertes en prod, `withTenant()` jamais appelé | **Accepté et dit** : `where app_id = $n` obligatoire dans `queries-svi*.ts`, garde source en CI. La bascule `console_ro` est hors périmètre. |
| Lecteurs `rum_metric`/`rum_span` sous-comptés | **Corrigé** : pas de projection dans `rum_span`/`rum_event` (D2) ; `rum_metric` seul, avec `WEB_VITAL_NAMES`, patch de 4 lecteurs, garde source, test de non-régression sur `queries-grid`. |
| « Même transaction » impossible (PostgREST) | **Éliminé** : plus de double écriture (D2). |
| Idempotence non dérivée (span_id aléatoire) | **Corrigé** : identifiants déterministes dérivés des clés source (D6), preuve de rejeu réelle. |
| `upsert_svi_call` non écrite / concurrence | **Corrigé** : verrou consultatif dans `svi_resolve_call`, corps réel en I1, test à 8 writers concurrents. |
| `outcome not null` sur un appel ouvert | **Corrigé** : `outcome` nullable + `svi_call_outcome_ck` (open ⇒ null, closed ⇒ non null). |
| Contrainte XOR session/call en commentaire, avalée par `exception when others` | **Retirée** : elle serait fausse (des lignes légitimes ont les deux à null) et silencieusement absente. |
| `slo_status`/`check_slo_burn` ne connaissent pas les taux | **Corrigé** : SLO via la branche générique `rating='good'` (vérifiée), branche de **taux** écrite explicitement en I5 (~50 l), pas annoncée comme configuration. |
| p75 sur le MOS = alerte quand 75 % sont mauvais | **Corrigé** : `svi.mos_inv`, p75 de l'inverse = p25 du MOS (D3). |
| `rating2026` inversé, 3 miroirs | **Contourné** : métrique orientée, `rating2026` non touchée, test de parité des 3 copies. |
| `scrubProps` ignore les nombres ; règle « ≥6 chiffres » cassante | **Corrigé** : règle ciblée aux attributs `svi.*` seulement, `RE_LONG_NUM` intact. |
| DTMF reconstituable par `string_agg` ; `dtmf_len` = oracle | **Corrigé** : nœuds sensibles → étape agrégée sans longueur ; test PCI par agrégation + Luhn. |
| 400 sur DTMF brut met MIP dans le périmètre PCI et perd le lot | **Rejeté** : aucun mécanisme d'acceptation-puis-rejet côté serveur. |
| Sel inexistant, hash réversible, DSAR impossible | **Corrigé** : HMAC à clé détenue par le client, `caller_key_id`, DSAR délégué documenté (§2.5). |
| `dsar.ts` non extensible (ancre `rum_session`) | **Corrigé** : `lib/svi-dsar.ts` parallèle, invariant existant préservé. |
| `ai_disclosed` = case à cocher | **Corrigé** : `ai_disclosure_source`, seul `flow_event` compte comme preuve. |
| Attestation « aucun audio » par `information_schema` | **Rejetée** : contraintes de longueur + revue d'adaptateur. |
| `sessionTimeline` « une branche `union all` » | **Faux, corrigé** : `sessionTimeline(id)` fait `where session_id = $1` sur 7 branches. `/svi/appels/[callId]` a sa propre requête. |
| Entonnoir « 90 % déjà écrit » | **Corrigé** : logique pure réutilisée verbatim, ~160 l de SQL neuf budgétées (I3). |
| Preuves infalsifiables (`computeFunnel` identique, waterfall, ±2 % sur n=200) | **Remplacées** par des preuves à oracle externe ou à valeur injectée (I1 #6, I3 #1-2, I7). |
| Réutilisations inventées (`gen-traffic.mjs` comme patron, `tz-country.mjs` pour E.164, `gen_ai` conservé) | **Retirées** : générateur neuf, mapping indicatif→pays à écrire, `gen_ai` hors périmètre (D8). |
| Adaptateur on-premise stateful non budgété | **Corrigé** : §2.4, empaquetage et reprise dans le périmètre d'I1, avec preuve de reprise après coupure. |
| Instrumentation par nœud supposée gratuite | **Corrigé** : c'est §2, le premier chapitre du plan, avec livrables, mode dégradé et indicateur de couverture. |
| Chiffrage « ~3 000 lignes contre 50 000 » | **Retiré.** Aucun chiffrage de lignes n'est donné : il servait d'argument commercial et c'était le chiffre le moins solide. Le plan chiffre en effort par incrément, avec les gates. |
