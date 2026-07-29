# Domaine adjacent — Supervision SVI (serveur vocal interactif)

> **Niveau de maturité : N0 « Absent ».** Aucune brique du produit ne touche à la
> téléphonie. Cette fiche existe pour répondre à la question posée, cadrer ce que
> recouvre réellement la supervision SVI, et évaluer si c'est une extension
> crédible — ou une dispersion.

*Établie le 29 juillet 2026.*

> **Note de lecture.** « SVI » désigne ici le *serveur vocal interactif* (IVR en
> anglais). Si l'intention était « supervision du SI » au sens large, la réponse
> est ailleurs : c'est exactement l'objet des trois fiches produit de ce dossier.

---

## 1. Ce que recouvre la supervision d'un SVI

C'est un domaine bien constitué, avec ses propres métriques, et il se décompose en
quatre couches qui ne s'opèrent pas de la même façon.

### Couche 1 — Disponibilité technique
La plus classique. Le SVI est une plateforme critique : un standard indisponible,
c'est une entreprise injoignable. Les fournisseurs professionnels s'engagent
typiquement sur **99,9 % de disponibilité**, soit moins de neuf heures d'indisponibilité
par an, ce qui suppose une infrastructure redondante (serveurs, réseau, alimentation)
et une supervision continue. On y surveille le taux de réussite d'établissement
d'appel et les temps de réponse de la plateforme.

### Couche 2 — Qualité de la voix
Spécifique à la téléphonie, et c'est ce qui rend le domaine techniquement étranger
au reste. On y mesure le **MOS** (*Mean Opinion Score*, note de qualité perçue de 1
à 5, normalisée par l'UIT-T), ainsi que ses déterminants réseau : gigue, perte de
paquets, latence bout-en-bout, écho. La donnée provient des rapports RTCP et de la
signalisation SIP — un plan technique qui n'a **aucun recouvrement** avec le web.

### Couche 3 — Parcours et automatisation
C'est la couche métier, et de loin la plus intéressante. Les indicateurs de
référence :

| Indicateur | Ce qu'il révèle |
|---|---|
| **Taux d'abandon dans le SVI** | Ergonomie du menu : arborescence trop profonde, libellés obscurs, attente excessive |
| **Taux d'automatisation** (*containment*) | Part des demandes résolues sans agent — c'est le ROI du SVI |
| **Taux de transfert vers agent** | Complément du précédent |
| **Taux de routage correct** | Qualité de la qualification en amont |
| **Temps moyen avant mise en relation** | Perception d'attente |

### Couche 4 — Satisfaction et résolution
**FCR** (résolution au premier contact) sur les appels traités après passage par le
SVI, durée moyenne de traitement, **CSAT**. Ces indicateurs mesurent l'effet du SVI
sur l'issue réelle de l'appel, pas seulement sur son déroulé.

---

## 2. Ce que nous en faisons aujourd'hui : rien

Recensement du dépôt : aucune brique SIP, RTP, RTCP, WebRTC ou téléphonie. Le module
`uptime` (`apps/ingest/supabase/functions/uptime/`, 1 sonde configurée, 2 657
résultats) fait de la sonde HTTP — pas de l'appel de test.

**Niveau : N0.** Sans nuance.

---

## 3. Est-ce une extension crédible ?

Le rapprochement intellectuel est réel et vaut la peine d'être formulé, parce qu'il
éclaire le positionnement du produit principal :

> Le RUM mesure l'expérience réelle d'un utilisateur sur un canal **web**.
> La supervision SVI mesure l'expérience réelle d'un utilisateur sur un canal **voix**.
> Ce sont **deux instances de la même idée** : instrumenter le vécu, pas le serveur.

Les couches 3 et 4 du §1 sont d'ailleurs conceptuellement identiques à ce que nous
faisons déjà : le taux d'abandon dans un menu vocal, c'est notre `form.abandon` ; le
taux de transfert, c'est un entonnoir ; le CSAT, c'est notre événement `feedback` ;
et la détection d'anomalie de volume par score z fonctionne exactement pareil sur
des appels que sur des logs.

**Mais les couches 1 et 2 sont un autre métier.** Elles exigent une compétence
télécom (SIP, RTP, codecs, MOS, opérateurs) que le dépôt ne contient pas, que
l'équipe n'a pas revendiquée, et qui ne s'improvise pas. Une supervision SVI qui ne
sait pas dire pourquoi la voix est hachée n'est pas une supervision SVI.

### La conclusion, en une ligne

**Un chemin étroit est crédible ; le domaine complet ne l'est pas.**

| Périmètre | Faisabilité | Verdict |
|---|---|---|
| Couches 1–2 (disponibilité, qualité voix) | Nécessite une compétence télécom absente | **Hors de portée** |
| Couches 3–4 (parcours, automatisation, satisfaction) | Ingestion d'événements — c'est exactement notre pipeline OTLP | **Faisable, à conditions** |

Le chemin étroit consiste à **ne pas superviser le SVI, mais à en analyser les
parcours** : si la plateforme vocale du client expose ses CDR ou ses événements de
navigation dans le menu (ce que font la plupart des solutions modernes), les
convertir en événements OTLP est un travail d'adaptateur, pas de plateforme. On
réutilise alors intégralement l'ingestion, le stockage, les entonnoirs, la détection
d'anomalie et l'interface existants.

### Les trois conditions

1. **Un client réel le demande et le finance.** Sans cela, c'est de la dispersion :
   le portefeuille actuel compte déjà un produit à N1 et une boucle d'alerte ouverte,
   qui valent bien davantage à traiter.
2. **La plateforme SVI du client expose ses événements.** À défaut, il faut lire du
   SIP — et l'on retombe dans le métier télécom.
3. **Le discours reste honnête.** Vendre « supervision SVI » en ne couvrant que les
   parcours serait un abus de langage. Le bon terme est **analyse de parcours vocal**.

---

## 4. Décision prise — et ce qu'elle change

> **29 juillet 2026 : le périmètre COMPLET est retenu**, couches 1 et 2 comprises.
> Le cadrage produit correspondant est dans
> [produit-svi-cadrage.md](./produit-svi-cadrage.md).

L'analyse ci-dessus reste valable et n'est pas révisée : la couche qualité de la
voix exige bien une compétence télécom absente du dépôt. La décision ne l'annule
pas — **elle la transforme en préalable explicite** (recrutement, mission courte
ou partenariat), tranché dans le cadrage avant l'épic concerné.

Un fait établi depuis a par ailleurs réduit l'effort estimé : **un appel est
structurellement une trace distribuée**, donc l'essentiel de la plateforme
(stockage, cascade, anomalies, SLO, alertes, rétention, DSAR, multi-locataire)
se réutilise sans réécriture. Voir le §1 du cadrage.

### La recommandation initiale, conservée pour mémoire

*Elle était : ne pas ouvrir le chantier maintenant, le classer comme adjacence
identifiée, et le garder en réserve pour deux usages :*

- **Argument de positionnement** — il renforce la thèse « nous mesurons l'expérience
  vécue, quel que soit le canal », qui est un meilleur récit que « nous faisons du
  RUM ». À utiliser en réunion, pas en feuille de route.
- **Option d'extension financée** — si un client de type service public ou centre de
  relation client le demande, le chemin étroit du §3 est un adaptateur, et il
  s'appuie sur une plateforme déjà construite.

*Cette mise en file d'attente était conditionnée aux chantiers d'amélioration des
produits existants, désormais livrés — dont la fermeture de la boucle d'alerte
([README §4](./README.md#4-le-constat-transversal-et-il-est-unique)). Le premier
argument reste d'actualité et se renforce : la thèse « nous mesurons l'expérience
vécue, quel que soit le canal » devient un récit tenable plutôt qu'un slogan.*

---

## Sources

- [Comment monitorer votre serveur vocal interactif ? — 2Be-FFICIENT](https://www.2befficient.fr/webinaires/comment-monitorer-votre-serveur-vocal-interactif/)
- [SVI : concevoir un serveur vocal interactif efficace en 2026 — Napsis](https://www.napsis.fr/telephonie-ip/serveur-vocal-interactif-svi/)
- [Guide complet SVI : définitions, technologies et applications](https://www.serveur-vocal-audiotel.fr/guide-complet-svi)
- [IVR / SVI : serveur vocal interactif multi-niveaux — Ringover](https://www.ringover.com/multi-level-ivr)
</content>
