# Le site de présentation face aux documents de couverture — lecture datée du 21/09/2026

Périmètre lu : `apps/console/app/presentation/page.tsx`, `apps/console/components/presentation/{Landing,Capteurs,Specs,PipelineStep}.tsx`,
`apps/console/components/AddClientCarousel.tsx`, `apps/console/lib/{presentation-content,specs,sdk-poids}.ts`,
`apps/console/public/portail/` (4 fichiers), `README.md`, capture `40-presentation.png`, confrontés à
`docs/RUM_PARITY_STATUS.md` (relevé 18/09/2026, 49 capacités), `docs/TOPOLOGIE_BACKEND.md` (19/09/2026),
`_bmad-output/implementation-artifacts/delivery-p5.md` (lu en entier) et `delivery-p8.md` (intro + tableau lus).
`delivery-p6.md`/`delivery-p7.md` : non lus en entier, seulement grep — leurs constats sont de toute façon
« vieillis » par construction (`delivery-p8.md` l. 12-13 le dit de lui-même) et remplacés par `RUM_PARITY_STATUS.md`.

Convention : chaque affirmation du site est citée `fichier:ligne`, chaque preuve ou infirmation porte sa source.

---

## 1. Structure actuelle, section par section, avec chaque affirmation chiffrée ou datée

### 1.0 `app/presentation/page.tsx` — routeur : visiteur → `Landing`, connecté → rappel console

Visiteur non connecté : rendu intégral de `Landing.tsx` (`page.tsx:23`). Connecté : page interne avec
6 sections. Rien de chiffré dans le routeur lui-même.

- **Stack technique** (`page.tsx:66-84`) — 6 puces : « SDK navigateur (Web Vitals API, rrweb) »,
  « OpenTelemetry · OTLP/HTTP », **« Backend Node autonome — Railway »**, « PostgreSQL »,
  « Console Next.js 15 / React 19 », « Base de données en UE — Francfort ».
- **Pipeline** (`page.tsx:97-101`, contenu dans `lib/presentation-content.ts:9-35`) — 5 étapes chiffrées :
  1. SDK « léger (${SDK_POIDS_TEXTE}) » — variable, valeur affichée dans la capture : **22 ko gzip**.
  2. Export OTLP — pas de chiffre.
  3. Ingestion — « Un service Node autonome — sans framework, déployable partout ».
  4. Stockage — « PostgreSQL par défaut ; chemin ClickHouse prouvé pour le grand compte (mêmes p75,
     **×15** plus compact). Rétention RGPD (TTL 30 j). »
  5. Console — pas de chiffre.
- **Ajouter un client en 6 étapes** — délègue à `AddClientCarousel.tsx`.
- **Statistiques montrées** (`lib/presentation-content.ts:38-116`) — 11 cartes : score de santé /100,
  Core Web Vitals p75, anomalies (z-score), heatmap de santé, erreurs regroupées (fingerprint), sessions
  & rejeu (rrweb, TTL 30 j), tracing front→back (W3C traceparent), robot vs réel, expérience (CSAT),
  carte d'expérience, prévisions AIOps (fenêtre **14 j**).

### 1.1 `Landing.tsx` — vitrine publique

- Bandeau « POC » apposé sur la marque (`Landing.tsx:37-47`), donc le statut POC est visible partout,
  y compris dans le pied de page (`Landing.tsx:166`) : « POC · OpenTelemetry-natif · données en UE,
  **souveraineté visée** » — le mot « visée » (pas « acquise ») est déjà correctement prudent.
- Capture réelle (`Landing.tsx:135-150`, fichiers `overview-light.png` / `overview-dark.png`), légendée
  « Les chiffres affichés viennent d'un jeu de démonstration, pas d'un client en production »
  (`Landing.tsx:152-155`) — bonne pratique déjà en place, à garder.
- Démo conditionnelle à `demoConfig()` (`Landing.tsx:59-84`) : verrouillée si `DEMO_USER_APPS` absent,
  avec un état visuel dédié (cadenas) plutôt qu'un lien mort.

### 1.2 `Capteurs.tsx` — deux capteurs, cartes symétriques

- Extension navigateur : « Chrome / Edge, Manifest V3 », « jamais `<all_urls>` » (`Capteurs.tsx:38`,
  confirmé par `docs/CADRAGE_EXTENSION.md` l. 13-16), limite assumée « Pas le grand public tant que
  l'extension n'est pas publiée au Chrome Web Store ; Firefox hors périmètre » (`Capteurs.tsx:47`).
- SDK embarqué : poids affiché via `koTexte(SDK_GZIP_KO)` (`Capteurs.tsx:54-56`), « Web et **React
  Native (paquet privé, v0.1)** ; pas de SDK iOS ou Android natif » (`Capteurs.tsx:68`).

### 1.3 `Specs.tsx` — 3 onglets, alimentés par `lib/specs.ts` (dynamique + statique)

- **En-tête** (`Specs.tsx:306-322`) : compteur live `{compte("atteint")} atteints / partiels / non
  atteints / non mesuré`, calculé à la requête — donc jamais périmé en soi, seul le **contenu** des
  lignes peut l'être (voir § 2).
- **Onglet Infrastructure** (`lib/specs.ts:85-209`) : hébergement (Neon/Vercel/Railway, « Non » à la
  souveraineté, `lib/specs.ts:97-100`), backend « trois services autonomes » — **ingest, scheduler,
  mcp** décrits comme également « atteint » (`lib/specs.ts:110-135`), capteurs (SDK, extension v0.4.3,
  compte développeur Chrome inexistant), console et livraison.
- **Onglet Mesures** (`lib/specs.ts:230-417`) : **15 familles de mesures**, chacune avec le nom du span
  OTLP, la table de destination et le module qui l'émet — donc auto-vérifiable, et 2 angles morts
  déclarés (conventions sémantiques OTel, supervision SVI) + les indisponibilités reprises de
  `lib/dashboard-blocs.ts`.
- **Onglet Écart au marché** (`Specs.tsx:472-558`) : tableau critère/cible/réel/statut, dont
  volumétrie « **10⁸** événements et au-delà (ClickHouse) » cible vs « **~10⁶–10⁷** sur PostgreSQL »
  réel = `manque`, débit « **~4 000** événements/seconde, sur un poste de développement uniquement »
  = `non-mesure`. Liste « Ce qui manque » (4 bloquants, 3 limites) dont « Clé d'ingestion à rendre
  obligatoire » et « Backend sur Railway, à migrer chez un hébergeur souverain ».

### 1.4 `AddClientCarousel.tsx` — tutoriel 6 étapes, décalque du wizard admin

Étape 1 : création client + génération de clé d'API « affichée une seule fois », prise en compte du
domaine « **en ≤ 60 s**, sans redéploiement » (`AddClientCarousel.tsx:44-47`). Étape 2 : snippet
d'exemple avec `endpoint: "https://<ingest>/v1/traces"` (`AddClientCarousel.tsx:17`). Étape 4
(facultative) : « sans elle, le RUM front fonctionne déjà à **100 %** » (`AddClientCarousel.tsx:104`).

### 1.5 `README.md` (racine du dépôt — pas la vitrine `/presentation`, mais lu comme demandé)

Contenu très daté : architecture « Ingestion /v1/traces → Postgres » via **Supabase eu-west-3, Paris**
(`README.md:12,18`), SDK « **22,0 KB gzip** » (`README.md:24`), statut qui s'arrête à **v0.3** / sprint
nuit 2 (`README.md:100-104`) — aucune mention de P4 à P8. Seule la ligne `apps/ingest` du tableau
Workspaces a été retouchée le 18/09/2026 (`README.md:76`, même commit que `TOPOLOGIE_BACKEND.md` —
`git log -1 -- README.md` = `f3c0c97`'s parent `322c9a7`… en réalité commit du 18/09 17:06:32,
message « docs: la topologie du backend »).

---

## 2. Ce qui est devenu faux ou périmé

1. **`Capteurs.tsx:68` — « React Native (paquet privé, **v0.1** )» est un chiffre faux.**
   `packages/rum-mobile/package.json:3` porte `"version": "0.4.0"` aujourd'hui. Le SDK web voisin cité
   dans la même phrase n'a pas ce problème : `packages/rum-sdk/package.json:3` = `0.4.3`, et
   `EXT_VERSION = "0.4.3"` (`lib/specs.ts:56`) correspond bien à `apps/extension/manifest.json:4`. Seul
   le chiffre React Native traîne une ancienne version.

2. **La description de `ingest` dans `lib/specs.ts:110-118` est en décalage avec `TOPOLOGIE_BACKEND.md`
   (19/09/2026).** La vitrine le présente sous « Backend — trois services autonomes », statut `atteint`,
   avec « Réception OTLP (traces, logs, rejeu)… **Porte la commande pre-deploy des migrations** ». Or
   `docs/TOPOLOGIE_BACKEND.md:69-95` (« Le service `ingest`, en cours de retrait ») établit que :
   - ce rôle de migration a été **repris par `scheduler`** (preuve datée du 18/09 15:29:18,
     `TOPOLOGIE_BACKEND.md:71-75`) ;
   - `ingest` **n'a aucun domaine public**, rien ne peut l'atteindre depuis l'internet
     (`docs/RUM_PARITY_STATUS.md:103-106`, confirmé § 3 du même document, daté du 18/09) ;
   - son drain de file différée est désactivé, `ingest_raw` est vide (`TOPOLOGIE_BACKEND.md:93`) ;
   - sa suppression est proposée mais **pas encore actée**, c'est une décision d'opérateur en attente
     (`TOPOLOGIE_BACKEND.md:77-82` — c'est le sujet du dernier commit `f3c0c97`).
   La ligne `lib/specs.ts:114-117` (`scheduler`, « Bail d'exclusion en base ») est, elle, exacte et à
   jour. `lib/specs.ts` a été modifié pour la dernière fois le 17/09/2026 (`git log`), soit **avant**
   que la preuve du 18-19/09 ne change la lecture du service `ingest` : le contenu n'a pas suivi.

3. **`README.md` contredit sa propre vitrine et les documents de référence sur trois points au moins :**
   hébergeur (Supabase/Paris au lieu de Neon/Francfort + Railway/Amsterdam), diagramme d'architecture
   (Deno edge function Supabase, alors que `TOPOLOGIE_BACKEND.md:11` dit « le collecteur d'ingestion
   réellement actif » est une route Vercel de la console), et statut produit qui s'arrête à v0.3 alors
   que 8 lots (P1 à P8) existent et que `docs/RUM_PARITY_STATUS.md` en compte 49 capacités. Un seul
   endroit du fichier (la ligne `apps/ingest` du tableau Workspaces, `README.md:76`) a été mis à jour
   le 18/09 — preuve que le reste n'a pas été relu à cette occasion. README.md n'est pas la vitrine
   `/presentation`, mais c'était dans le périmètre demandé ; à traiter séparément dans le plan (voir
   note § 5).

4. **Le statut ClickHouse est correct, à noter pour ne pas le retoucher inutilement.** `page.tsx`
   (via `lib/presentation-content.ts:28`) dit « chemin ClickHouse prouvé pour le grand compte (mêmes
   p75, ×15 plus compact) ». Le banc réel (`infra/clickhouse.notes.md`, 11/06/2026) donne exactement
   « **×15 plus compact à données identiques** » et « **Δ = 0 (exact)** » sur le p75 — le chiffre de la
   vitrine est fidèle à sa preuve. Seule nuance absente de la vitrine : le banc date de juin (avant
   P5-P8) et n'a pas été rejoué depuis le passage à Neon.

---

## 3. Ce que le site ne dit pas et devrait dire

1. **Zéro capacité P5-P8 éprouvée sur donnée réelle.** `docs/RUM_PARITY_STATUS.md:133` : « **Zéro
   capacité éprouvée sur donnée réelle.** Les 34 lignes `deploye_non_eprouve` sont le meilleur résultat
   de ce document ». La grille « Les statistiques montrées » (`page.tsx:117-144`) présente 11 capacités
   (erreurs regroupées, sessions & rejeu, tracing front→back, robot vs réel, expérience, carte
   d'expérience, prévisions) au présent, sans distinguer ce qui est prouvé sur trafic réel de ce qui
   est déployé mais jamais rencontré de vraie donnée. L'onglet Specs porte cette nuance ailleurs sur la
   page (`Specs.tsx`), mais pas la grille de statistiques, qui est ce qu'un visiteur pressé retient.

2. **Le chemin d'ingestion réellement emprunté par le trafic n'est jamais nommé.** Le pipeline
   (`lib/presentation-content.ts:20-24`, étape 3) et la puce « Backend Node autonome — Railway »
   (`page.tsx:70`) laissent penser que l'ingestion tourne sur le service Railway. En production, c'est
   la route de la console sur Vercel qui reçoit tout le trafic (`TOPOLOGIE_BACKEND.md:11`,
   `RUM_PARITY_STATUS.md:108-111` : « **Le trafic de production entre par Vercel** »), avec le même
   parseur que le backend. Ce n'est pas un mensonge (le code Node existe, il est « déployable partout »,
   c'est vrai pour l'auto-hébergement), mais l'endroit où ça tourne AUJOURD'HUI pour un client MIP n'est
   dit nulle part sur la vitrine.

3. **Le tutoriel « Ajouter un client » ne dit pas que la clé d'API n'est pas encore obligatoire par
   défaut.** `AddClientCarousel.tsx:44-47` présente la génération de clé comme l'étape de sécurisation.
   `lib/specs.ts` (section « Ce qui manque », reprise en `Specs.tsx:155-159`) précise : « le refus n'est
   pas encore le comportement par défaut ». Un client qui suit le tutoriel n'apprend pas que, tant que
   ce chantier n'est pas fait, une requête sans clé valide n'est pas nécessairement rejetée.

4. **Le snippet d'exemple (`AddClientCarousel.tsx:17`) pointe vers un domaine `<ingest>` distinct**, ce
   qui laisse croire à un hébergeur d'ingestion séparé de la console — alors que le chemin réellement
   actif est la route de la console elle-même (point 2 ci-dessus). Un intégrateur qui prend le snippet
   au pied de la lettre risque de chercher un domaine d'ingestion qui, pour `ingest` sur Railway,
   **n'existe pas** (`RUM_PARITY_STATUS.md:85` : « aucun » domaine public).

5. **L'isolation multi-tenant en base n'est pas mentionnée**, alors que c'est un point structurant pour
   un acheteur : `docs/RUM_PARITY_STATUS.md` D6 (l. 189) dit l'isolation « **prouvée en base** » par script
   dédié, mais avec la réserve du bloquant symétrique déjà listé dans `Specs.tsx` (« la connexion de
   production utilise un rôle propriétaire qui contourne les policies »). Les deux moitiés de ce
   sujet (prouvé en base ET contourné en production) mériteraient d'être dites ensemble quelque part
   sur la vitrine — aujourd'hui seule la moitié « à activer » y figure (`Specs.tsx` A_FAIRE), la moitié
   « déjà prouvée » (le script `verify-tenant-isolation.mjs`) n'est nulle part.

6. **Aucune mention du volet ML/anomalies au-delà du z-score** déjà affiché (`presentation-content.ts:57`,
   « Anomalies (z-score) ») et des prévisions (`presentation-content.ts:113-115`, « Prévisions (AIOps) »)
   — l'ampleur réelle de ces deux capacités (couverture, fraîcheur, ce qu'elles couvrent) n'est
   vérifiable dans aucun des documents de couverture lus (P5-P8 ne les mentionnent pas, ils sont
   probablement antérieurs à P5) : **non établi**, à vérifier avant d'écrire quoi que ce soit de
   quantifié à leur sujet dans le plan à venir.

---

## 4. Ce qu'il promet de trop (comparé aux verdicts de `RUM_PARITY_STATUS.md`)

Dans l'ensemble, la vitrine est **plus prudente que le document de couverture ne l'exigerait** — c'est
la caractéristique la plus notable de cette page : `Specs.tsx` compte déjà les capacités « atteint /
partiel / non atteint / non mesuré » et documente les 7 points bloquants et 3 limites connues
(`lib/specs.ts:155-191`). Aucune formulation trouvée dans `page.tsx`, `Landing.tsx`, `Capteurs.tsx` ou
`Specs.tsx` n'affirme un statut « éprouvé sur donnée réelle », « certifié » ou « prêt pour la
production » qui dépasserait un verdict du document de couverture. Deux nuances, plus fines que des
« trop-promis » :

1. **La grille « Statistiques montrées » (§3.1) est le seul endroit qui parle au présent simple sans
   aucune réserve** — « Chaque appel API relié à son exécution serveur », « L'écart entre le monitoring
   synthétique et les vrais utilisateurs » — alors qu'aucune de ces capacités n'a de preuve
   « éprouvée sur donnée réelle » dans `RUM_PARITY_STATUS.md`. Ce n'est pas une affirmation fausse
   (le code existe, `deploye_non_eprouve` reste le meilleur verdict du document), mais l'absence de
   nuance ici tranche avec la rigueur du reste de la page.
2. **`AddClientCarousel.tsx:104` — « le RUM front fonctionne déjà à 100 % »** est la seule formulation
   absolue relevée dans tout le périmètre lu. Elle porte sur une portée volontairement restreinte (le
   RUM front sans le tracing back), donc n'est pas fausse en soi, mais le « 100 % » est le seul
   superlatif chiffré de la vitrine — à mettre en regard du ton du reste du dépôt, qui évite ce
   registre (cf. `Specs.tsx:1-9`, qui revendique explicitement l'absence de maquillage).

**Rien dans le périmètre lu ne dépasse un verdict `RUM_PARITY_STATUS.md`.**

---

## 5. Visuels disponibles ou à produire

### Disponibles (`apps/console/public/portail/`)
- `overview-light.png` / `overview-dark.png` (120-122 Ko) — capture réelle de la Vue d'ensemble,
  déjà utilisée dans `Landing.tsx:136-150`.
- `console-tour.mp4` (1,7 Mo) + `console-tour-poster.jpg` (92 Ko) — présents sur disque, **non
  référencés** dans `Landing.tsx`, `Capteurs.tsx` ni `Specs.tsx` (aucune occurrence de
  `console-tour` dans ces trois fichiers) : une visite vidéo existe mais n'est utilisée nulle part
  sur la vitrine publique actuelle.
- Capture d'écran de la page connectée (`40-presentation.png`, fournie pour cette lecture) : confirme
  que le rendu correspond au code lu (chips stack, 5 étapes pipeline, carrousel étape 1/6, grille de
  11 cartes).

### À produire, si le futur plan veut suivre l'esprit Datadog/Grafana/IP-Label
- Une capture (ou GIF court) de l'onglet **Écart au marché** de `Specs.tsx` — c'est la pièce la plus
  différenciante de ce dépôt (auto-vérifiable, avec preuve par fichier) et elle n'apparaît dans aucun
  visuel existant.
- Une capture du **carrousel Ajouter un client** à une étape avancée (checklist live qui se remplit),
  pour montrer le temps-to-first-graph annoncé.
- Un visuel du **banc ClickHouse** (`infra/clickhouse.notes.md`) — le seul chiffre de performance
  du pipeline qui soit mesuré et non estimé (×15 compact, Δ=0 sur le p75), actuellement enterré dans
  un fichier `infra/`.
- **`console-tour.mp4` est un asset mort** à intégrer ou à retirer — à trancher explicitement dans le
  plan plutôt que le laisser inutilisé.

---

## Note pour la suite (hors périmètre de cette lecture)

`README.md` n'est pas le site `/presentation`, mais son écart est le plus large mesuré ici (§2.3). Le
plan d'ensemble (demandé par l'utilisateur) prévoit une épique séparée de mise à jour du « frontend de
présentation » — si cette épique inclut le README (porte d'entrée GitHub), le signaler explicitement,
sinon le README continuera d'afficher Supabase/Paris et un statut « v0.3 » à quiconque ouvre le dépôt.
