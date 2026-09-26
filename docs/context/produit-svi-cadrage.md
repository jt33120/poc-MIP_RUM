# Cadrage produit — Supervision SVI complète

> **Décision prise** (29 juillet 2026) : ouvrir le chantier sur le **périmètre
> complet** — disponibilité, qualité de la voix, parcours et satisfaction.
> Ce document en pose les fondations : standards, marché, architecture cible,
> écart de compétence, épics et portes de validation.

*Complète l'analyse d'adjacence de [svi-supervision-vocale.md](./svi-supervision-vocale.md),
qui reste valable sur le fond — les couches techniques 1 et 2 exigent une
compétence télécom absente du dépôt. Le périmètre complet ayant été retenu, la
question n'est plus « faut-il y aller » mais **« comment y aller sans se mentir
sur ce qu'on sait faire »**.*

> **État au 26/09/2026.** Ce cadrage n'est pas révisé ; ce qui en est livré, vérifié
> dans le code (`master`) : le modèle d'appel (tables `svi_*`,
> `packages/db/sql/migration-v51.sql`, numérotée v48 dans le plan), la lecture du
> vocabulaire `svi.*` par l'ingestion (`packages/backend/shared/otlp.mjs`) et les écrans
> `/svi`, `/svi/appels`, livrés le 30/07/2026 (incréments I0 et I2 du
> [plan d'implémentation](./produit-svi-plan-implementation.md)). Écart assumé à la
> porte d'E-SVI-1 : pas de miroir dans `rum_span`, donc pas d'affichage dans la
> cascade existante. Ces écrans sont **fermés** dans la console depuis le
> 08/09/2026 (`apps/console/lib/capacites.ts:6`). Aucun adaptateur (E-SVI-2, E-SVI-5),
> ni collecteur RTCP-XR, ni seuil MOS dans `THRESHOLDS` n'existe. Le préalable n° 4
> (boucle d'alerte fermée par un canal réel) n'est pas établi en production.

---

## 1. La trouvaille qui change l'estimation

Un appel téléphonique **est une trace distribuée**. La correspondance n'est pas
une métaphore : elle est structurelle.

| Concept OpenTelemetry | Équivalent SVI |
|---|---|
| Trace | L'appel, de la sonnerie au raccroché |
| Span racine | La session SVI |
| Spans enfants | Chaque étape : accueil, menu niveau 1, saisie, file d'attente, transfert, segment agent |
| Attributs de span | Touche pressée, branche empruntée, motif de sortie |
| Métrique attachée | MOS, gigue, perte de paquets — exactement comme un Web Vital |
| Session | Le client appelant (identifiant haché) |
| Événement | Abandon, transfert, résolution |

**Conséquence :** l'essentiel de la plateforme se réutilise tel quel. Le stockage,
la cascade de traces, la détection d'anomalie par score z, les SLO, le moteur
d'alerte, la rétention, le DSAR, le multi-locataire, l'interface — rien de tout
cela n'est à réécrire. Même la notation `good / needs-improvement / poor` des Web
Vitals s'applique au MOS sans modification, puisqu'il porte lui aussi des seuils
normalisés.

Ce qu'il reste à construire est donc beaucoup plus étroit qu'il n'y paraît :
**des adaptateurs, un vocabulaire, des seuils, et une compétence télécom pour la
seule couche qualité de la voix.**

---

## 2. Les standards du domaine

C'est un domaine **normalisé**, plus stable que l'observabilité web — les
recommandations ITU-T font autorité depuis vingt ans. Il n'y a donc aucune
latitude à inventer notre propre échelle de qualité vocale.

### 2.1 Mesurer la qualité perçue

| Norme | Rôle | Statut 2026 |
|---|---|---|
| **ITU-T P.800** | MOS — note d'opinion moyenne, 1 à 5. L'unité de référence du domaine. | Fondation |
| **ITU-T P.862 (PESQ)** | Mesure objective intrusive, génération précédente. | **Dépassée** — sous-note les flux large bande |
| **ITU-T P.863 (POLQA)** | Successeur de PESQ, référence actuelle. **v3 est le standard 2026**, requis pour les codecs modernes (Opus, G.722, EVS). | Référence |
| **ITU-T P.863.2** | Étend POLQA à **quatre dimensions** de qualité (diagnostic, pas seulement une note globale). | Récent |
| **ITU-T G.107 (E-model)** | Calcule un facteur R à partir des paramètres réseau et du codec, converti en MOS estimé. | **La méthode passive** |

### 2.2 Les deux méthodes, et pourquoi la distinction décide de tout

**Mesure active (intrusive).** On passe de vrais appels de test, on injecte un
échantillon audio de référence, on compare le signal reçu à l'original avec
POLQA. C'est la mesure la plus fidèle — et la seule qui teste réellement le
parcours de bout en bout, opérateur compris.

**Mesure passive (non intrusive).** On observe les appels réels : les rapports
**RTCP-XR** transportent les métriques VoIP (gigue, perte, délai) dont le modèle
E de G.107 dérive un MOS estimé. Pas d'appel de test, pas de coût par appel,
couverture de 100 % du trafic — mais une **estimation**, pas une mesure perçue.

> **C'est la ligne de partage du marché**, et donc de notre stratégie (§4).

---

## 3. Le marché et les acteurs

Le marché SVI pèse environ **6,7 milliards de dollars en 2026**, en croissance
d'environ 7,9 % par an. La catégorie de la supervision s'appelle **« CX
Assurance »**, et elle est structurée.

| Acteur | Positionnement | À retenir |
|---|---|---|
| **Cyara** | Créateur et leader revendiqué de la catégorie CX Assurance. A **racheté Spearline en 2023**, ajoutant la numérotation *in-country* mondiale et le test WebRTC. | Le concurrent frontal |
| **Spearline** (Cyara) | Test, supervision et étalonnage des réseaux de communication depuis 2003. | Absorbé |
| **Hammer** (ex-Empirix) | Test de bout en bout et validation de performance, réputé sur la tenue en charge. | Fort sur le test de charge |
| **Klearcom** | Test SVI et numérotation internationale. | Challenger |

### Le fossé que nous ne franchirons pas

Le véritable actif de Cyara/Spearline n'est pas logiciel : c'est un **parc de
numéros de téléphone réels dans des dizaines de pays**, permettant d'appeler le
SVI d'un client *depuis* le réseau de l'opérateur local. C'est ce qui rend le
test crédible, parce que la plupart des dégradations vocales naissent chez
l'opérateur, pas chez le client.

Répliquer cela suppose des contrats opérateurs, des cartes SIM, des passerelles
physiques et une exploitation 24/7 dans chaque pays couvert. **Ce n'est pas un
projet logiciel** et cela n'a aucun rapport avec nos compétences.

**Conséquence stratégique, à assumer dès maintenant :** nous n'entrerons pas par
le test actif. Nous entrons par la **supervision passive du trafic réel**, où
notre pipeline nous donne une avance, et nous **partenons** pour l'actif si un
client l'exige.

---

## 4. Architecture cible

### 4.1 Les trois sources d'ingestion

```
┌──────────────────────────┐
│  CCaaS (Genesys, Connect)│──► flux d'événements ──┐
└──────────────────────────┘                        │
┌──────────────────────────┐                        │   ┌───────────┐   ┌──────────┐
│  IPBX (Asterisk, FS)     │──► CDR / CEL / ARI ────┼──►│ adaptateur│──►│ /v1/traces│
└──────────────────────────┘                        │   │   OTLP    │   │ /v1/logs  │
┌──────────────────────────┐                        │   └───────────┘   └──────────┘
│  SBC / sonde SIP         │──► RTCP-XR ────────────┘         │
└──────────────────────────┘                                   ▼
                                                   pipeline MIP existant, inchangé
```

**Source A — plateformes CCaaS.** C'est la voie la plus courte, et elle est
déjà ouverte : Genesys Cloud publie ses événements de conversation vers **AWS
EventBridge** (topic *Analytics Detail Events* : conversation, participant,
session, et depuis peu **segment** — mises en attente, alertes, transferts,
travail après appel), en plus de ses API REST et *streaming*. Amazon Connect
expose ses *contact records* et *contact events*. **Le modèle de données de
Genesys est bâti sur des segments** — chaque segment portant ses dimensions
(numéro, campagne, motif de déconnexion, direction). Un segment est un span. La
conversion est directe.

**Source B — IPBX auto-hébergés.** Asterisk et FreeSWITCH dominent le secteur
public français et les intégrateurs. CDR pour l'appel, CEL pour les événements
de canal, ARI/AMI pour le temps réel. Plus artisanal, mais c'est là que se
trouve le marché souverain que le scan concurrentiel désigne comme notre terrain.

**Source C — qualité de la voix.** Les rapports RTCP-XR, collectés au SBC ou par
une sonde SIP passive, alimentent le modèle E (G.107) → facteur R → MOS estimé.
**C'est la seule des trois qui exige la compétence télécom.**

### 4.2 Ce qui se réutilise, ce qui est à écrire

| Brique | État |
|---|---|
| Ingestion OTLP, registre d'apps, clés, limitation de débit | ✅ existant |
| Stockage, index, rétention, purge, DSAR | ✅ existant |
| Cascade de traces (`/tracing/[traceId]`) | ✅ existant — affiche un appel sans modification |
| Détection d'anomalie par score z | ✅ existant — s'applique au volume d'abandons |
| SLO, moteur d'alerte, canaux, cadence dégressive | ✅ existant |
| Notation par seuils (`good/needs-improvement/poor`) | ✅ existant — s'applique au MOS |
| **Adaptateur Genesys / Connect → OTLP** | ❌ à écrire |
| **Adaptateur Asterisk / FreeSWITCH → OTLP** | ❌ à écrire |
| **Collecteur RTCP-XR + modèle E (G.107)** | ❌ à écrire, **compétence télécom requise** |
| **Vocabulaire et seuils SVI** (`svi.*`, seuils MOS) | ❌ à écrire |
| **Pages parcours vocal** (entonnoir de menu, containment) | ❌ à écrire |

### 4.3 Vocabulaire proposé

Attributs `svi.*`, alignés sur l'esprit des conventions OTel (préfixe de domaine,
noms en clair, pas d'abréviation) :

```
svi.call_id · svi.direction · svi.entry_point · svi.menu_path
svi.dtmf · svi.branch · svi.queue · svi.wait_ms
svi.outcome        = contained | transferred | abandoned | failed
svi.transfer_target · svi.agent_group
svi.mos · svi.r_factor · svi.jitter_ms · svi.packet_loss_pct · svi.codec
```

`svi.outcome` est le champ central : le taux d'automatisation, le taux d'abandon
et le taux de transfert s'en déduisent tous les trois, donc un seul champ bien
posé fait vivre trois indicateurs.

### 4.4 Seuils MOS

Le MOS se note comme un Web Vital, avec des bornes admises par le secteur :

| MOS | Lecture |
|---|---|
| ≥ 4,0 | Bon — qualité conversationnelle normale |
| 3,6 – 4,0 | À améliorer — perceptible, encore acceptable |
| < 3,6 | Mauvais — gêne réelle, plaintes attendues |

Le mécanisme de notation existant s'applique tel quel : les seuils s'ajoutent à
la table `THRESHOLDS` déjà miroitée entre SDK, ingestion et console.

---

## 5. Écart de compétence

| Couche | Compétence requise | Dans le dépôt |
|---|---|---|
| Parcours, automatisation, satisfaction | Ingestion d'événements, analytique | ✅ oui |
| Disponibilité plateforme | Sondes, SLO | ✅ oui |
| **Qualité de la voix** | SIP, RTP/RTCP-XR, codecs, modèle E | ❌ **non** |
| **Test actif** | Contrats opérateurs, numérotation *in-country* | ❌ **non, et non réplicable** |

Trois options pour la couche qualité de la voix :

1. **Recruter ou faire appel à un expert télécom** pour le collecteur RTCP-XR et
   le modèle E. Périmètre borné (un collecteur, une formule normalisée), donc une
   mission courte suffit — la norme G.107 est publique et précisément spécifiée.
   **Recommandé.**
2. **Partenariat** avec un acteur du test actif pour la partie intrusive, en
   restant maître de la couche passive et du parcours.
3. **Renoncer à la couche 2** — mais alors le produit ne peut plus s'appeler
   « supervision SVI » sans abus de langage.

---

## 6. Épics

Chaque épic se termine par une **porte de validation** : une preuve vérifiable,
pas une déclaration d'achèvement. Le séquencement suit la valeur démontrable, pas
la difficulté technique.

### E-SVI-1 — Modèle et vocabulaire
Définir les attributs `svi.*`, le mapping appel → trace, les seuils MOS, la table
`svi_call` (ou l'extension de `rum_span`, à trancher à l'écriture). Documenter le
contrat d'ingestion comme l'est déjà l'OTLP web.
**Porte :** un appel fictif complet ingéré et affiché dans la cascade existante,
sans code d'interface nouveau.

### E-SVI-2 — Adaptateur CCaaS
Genesys Cloud d'abord (le modèle par segments s'y prête le mieux et le flux
EventBridge est documenté), Amazon Connect ensuite.
**Porte :** un appel réel d'une plateforme de démonstration, de bout en bout,
avec son parcours de menu lisible.

### E-SVI-3 — Parcours vocal
Entonnoir de menu, taux d'automatisation, taux d'abandon par nœud, taux de
transfert, temps avant mise en relation. Réutilise l'entonnoir et l'anomalie
existants.
**Porte :** identifier un nœud de menu réellement abandonnogène sur des données
réelles — la première valeur métier démontrable.

### E-SVI-4 — Qualité de la voix *(dépend de §5)*
Collecteur RTCP-XR, modèle E (G.107), MOS estimé attaché à l'appel, seuils,
alerte.
**Porte :** corréler une dégradation MOS mesurée à un incident réseau connu.

### E-SVI-5 — Adaptateur IPBX
Asterisk et FreeSWITCH — la porte d'entrée du marché souverain.
**Porte :** une installation Asterisk réelle supervisée sans modification de son
plan de numérotation.

### E-SVI-6 — Disponibilité et SLA
Sondes de plateforme, SLO de taux de réussite d'appel, engagement de service.
**Porte :** un SLO SVI qui brûle et alerte, en passant par la cadence dégressive
posée en v45.

---

## 7. Préalables — ce qui doit être vrai avant de démarrer

Ces conditions ne sont pas des formalités : chacune, si elle manque, transforme
le chantier en développement spéculatif.

1. **Un client pilote identifié, avec sa plateforme.** Le choix de l'adaptateur
   à écrire en premier en dépend entièrement — et écrire le mauvais adaptateur
   coûte un épic entier.
2. **Un accès à une plateforme de test.** Genesys propose des organisations de
   développement ; Asterisk s'installe en conteneur. Sans quoi E-SVI-2 est aveugle.
3. **La décision sur la couche qualité de la voix** (§5), parce qu'elle
   conditionne le calendrier et le budget, pas seulement l'architecture.
4. **La boucle d'alerte fermée sur le RUM.** Un produit SVI qui déclencherait des
   alertes non livrées reproduirait exactement le défaut que nous venons de
   corriger. Le correctif de cadence est en place ; il reste à configurer un canal
   réel — c'est une action d'exploitation, pas de développement.

---

## 8. Risques

| Risque | Gravité | Réponse |
|---|---|---|
| Vendre « supervision SVI » sans la couche voix | **Élevée** | Le périmètre complet est retenu ; ne pas communiquer avant E-SVI-4 |
| Écrire l'adaptateur d'une plateforme que le pilote n'utilise pas | **Élevée** | Préalable n° 1 — ne pas démarrer E-SVI-2 sans client identifié |
| Sous-estimer la compétence télécom | **Élevée** | Trancher §5 avant E-SVI-4, pas pendant |
| Se comparer frontalement à Cyara sur le test actif | Moyenne | Positionnement passif assumé, partenariat pour l'actif |
| Disperser l'effort au détriment des trois produits existants | Moyenne | Les quatre chantiers d'amélioration sont livrés ; SVI démarre après |
| Données personnelles vocales (RGPD) | **Élevée** | Aucun enregistrement audio dans le périmètre — métadonnées d'appel uniquement, numéros hachés comme les identifiants utilisateur du RUM |

---

## 9. Ce que ce cadrage ne tranche pas

- **Le nom du produit.** « Supervision SVI » est exact mais étroit ; le marché dit
  « CX Assurance ». À décider avec le positionnement commercial.
- **Le modèle de prix.** Par appel, par SVI supervisé, ou inclus dans la
  plateforme ? Le prix de la concurrence est majoritairement à l'appel de test,
  ce qui ne transpose pas à une supervision passive.
- **La cible d'abord.** Secteur public souverain (via IPBX) ou entreprise
  (via CCaaS) ? Les deux marchés n'ont ni le même cycle de vente ni le même
  adaptateur.

---

## Sources

- [ITU-T P.863 / POLQA — standardisation](http://www.pesq.org/standardization.html)
- [Rohde & Schwarz — de la qualité vocale aux dimensions de qualité (P.863.2)](https://www.rohde-schwarz.com/us/solutions/critical-infrastructure/mobile-network-testing/stories-insights/article-from-speech-quality-to-speech-quality-dimensions_256932.html)
- [POLQA et PESQ pour la supervision vocale en 2026](https://callsphere.ai/blog/vw6d-polqa-pesq-voice-quality-monitoring-2026)
- [TelcoBridges — MOS et qualité vocale au SBC](https://telcobridges.com/learning/session-border-controller/mos-and-voice-quality/)
- [GL Communications — évaluation intrusive de la qualité vocale (PESQ/POLQA)](https://www.gl.com/intrusive-speech-quality-assessment-pesq-polqa.html)
- [Cyara — acquisition de Spearline (2023)](https://www.businesswire.com/news/home/20230327005178/en/Cyara-Acquires-Spearline-to-Deliver-Worlds-Most-Comprehensive-Customer-Experience-Assurance-Platform)
- [Cyara — test de contact center](https://cyara.com/solutions/contact-center-testing/)
- [Hammer — test de SVI](https://www.hammer.com/solutions/ivr-testing)
- [Panorama des outils de test SVI 2026](https://www.calilio.com/blogs/ivr-testing-tools)
- [Genesys Cloud — modèle de données Conversation](https://developer.genesys.cloud/analyticsdatamanagement/analytics/detail/conversation-data-model)
- [Genesys — capacités d'analytique et de restitution](https://www.genesys.com/capabilities/reporting-analytics)
- [Amazon Connect — contact records et événements](https://aws.amazon.com/about-aws/whats-new/2023/05/amazon-connect-contact-records-events-third-party-calls)
</content>
