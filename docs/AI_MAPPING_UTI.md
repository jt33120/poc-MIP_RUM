# Prompt à coller — cartographie des usages IA de `uti-platform`

> **But** : avant d'étendre le monitoring IA, **inventorier TOUS les usages d'IA** de la plateforme
> (pas seulement les appels LLM « chat ») — OCR, vision, embeddings, classification, extraction,
> transcription… — pour décider **quoi mesurer** et **où la traçabilité des données est critique**
> (ex. OCR de documents sensibles : contrats, pièces d'identité).
>
> **Ce document ne modifie rien.** Il produit un **inventaire structuré**. On fait évoluer le schéma
> `rum_ai` et la page « Performance IA » **ensuite**, à partir de ce que l'inventaire révèle.
>
> Copie le bloc **PROMPT** dans ta session Claude ouverte sur `uti-platform`. Read-only : aucune
> modification de code demandée.

---

## PROMPT

Tu travailles sur **uti-platform**. Ne modifie AUCUN fichier : produis seulement un **inventaire des
usages d'intelligence artificielle** du backend et des jobs. Par « usage IA » on entend tout appel à
un modèle ou service d'IA/ML : LLM (chat, complétion), **OCR** (Tesseract, Textract, Vision…),
**vision** (analyse d'image), **embeddings**, **classification / extraction** de champs,
**transcription** audio, reconnaissance, etc. — qu'il soit synchrone (déclenché par une requête) ou
batch (cron / worker / file).

### Méthode

Cherche exhaustivement : imports de SDK (openai, anthropic, mistralai, google-generativeai,
`boto3` textract/rekognition, `pytesseract`, `easyocr`, `paddleocr`, azure vision, `whisper`…),
appels HTTP vers des API d'IA, et toute fonction interne de « scoring/extraction/reconnaissance ».
Remonte jusqu'à la **route ou le job déclencheur**.

### Pour CHAQUE usage trouvé, renseigne

| Champ | Détail attendu |
|---|---|
| `id` | identifiant court (ex. `ocr-cni`, `chat-assistant`, `embed-search`) |
| `fichier` | chemin + fonction |
| `déclencheur` | route API (`POST /api/...`) **ou** job/cron/worker |
| `type` | `chat` \| `ocr` \| `vision` \| `embeddings` \| `classification` \| `extraction` \| `transcription` \| `autre` |
| `provider_ou_lib` | `anthropic` / `openai` / `aws-textract` / `pytesseract` / `local`… |
| `modèle` | nom du modèle si applicable (sinon `n/a`) |
| `mode` | `sync` (bloque une requête utilisateur) ou `batch` |
| `entrée` | nature + **unité de volume** : texte (tokens) / image / **PDF (nb de pages)** / audio (sec) |
| `volume_estimé` | ordre de grandeur par jour (appels, pages, docs) si connu |
| `sortie_et_usage` | ce qui est produit ET **ce que ça déclenche en aval** (stocké où ? alimente quelle décision/affichage ?) |
| `données_sensibles` | le contenu traité contient-il de la **PII / des documents contractuels / des identifiants** ? (`oui/non` + type) |
| `traçabilité_actuelle` | est-ce **loggé** ? sait-on aujourd'hui le **coût**, la **latence**, le **taux d'échec** ? |
| `échecs` | comment un échec est-il géré (retry, fallback, silencieux) ? conséquence pour l'utilisateur |

### Questions transverses (réponds en fin d'inventaire)

1. **OCR & documents** : l'OCR est-il facturé/mesuré **à la page** ou **au document** ? Combien de
   pages par document en moyenne ? Les documents OCRisés sont-ils **conservés** (et combien de temps) ?
2. **Traçabilité RGPD** : pour quels usages traite-t-on de la **donnée personnelle ou contractuelle** ?
   Existe-t-il aujourd'hui un **journal** reliant « tel document / tel utilisateur → tel traitement IA » ?
3. **Corrélation parcours** : quels usages **sync** peuvent-ils être reliés à une **session utilisateur**
   (a-t-on l'id de session RUM au moment de l'appel) ?
4. **Priorités** : selon toi, quels 3 usages méritent le monitoring le plus urgent, et pourquoi
   (coût, volume, sensibilité des données, fréquence d'échec) ?

### Format de sortie

1. Un **tableau Markdown** (une ligne par usage, colonnes ci-dessus).
2. Puis le **même contenu en JSON** (liste d'objets, mêmes clés) — pour ré-ingestion automatique.
3. Puis les **réponses aux 4 questions transverses**.

Ne propose pas d'implémentation : produis l'inventaire, rien d'autre.

---

## Ce qu'on en fera côté MIP RUM (après réception de l'inventaire)

L'inventaire nous dit **quoi** instrumenter et **où** la traçabilité prime. Direction pressentie —
à confirmer/ajuster selon les résultats :

### 1. Élargir le modèle au-delà du « chat »

`rum_ai.operation` devient un **vocabulaire contrôlé** : `chat`, `embeddings`, `ocr`, `vision`,
`classification`, `extraction`, `transcription`. Les usages **non tokenisés** (OCR, vision) se mesurent
en **unités métier**, pas en tokens.

### 2. Colonnes additives `rum_ai` (migration dédiée, quand l'inventaire est là)

- `units` (int) + `unit_kind` (`pages` / `documents` / `images` / `seconds`) — volume d'un usage non-LLM.
- `input_kind` (`text` / `image` / `pdf` / `audio`).
- `data_class` (`public` / `personal` / `contractual` / `id_document`) — **étiquette de sensibilité**,
  jamais le contenu. Sert la traçabilité RGPD (savoir qu'un traitement a porté sur de la donnée
  sensible, sans stocker la donnée).
- `doc_ref` (text, **haché**) — référence opaque du document traité, pour relier plusieurs opérations
  au même document en audit **sans** exposer d'identifiant réel.

Tout reste **additif** (comme v20/v21) : aucune rupture pour l'ingestion existante.

### 3. Ingestion inchangée

L'OCR/vision réutilise **le même span `gen_ai`** et le même endpoint `v1-traces` : on ajoute juste
`gen_ai.operation.name: "ocr"` + des attributs `mip.ai.units` / `mip.ai.unit_kind` / `mip.ai.data_class`.
**Pas de nouvel endpoint, pas de secret côté front.** Le backend émet, RUM estime le coût si besoin.

### 4. UI « Performance IA » — nouveau sous-onglet « Documents & OCR »

Sous la catégorie **Performance IA** (couleur violet) : volume de pages/documents traités, latence p75,
**taux d'échec OCR**, coût, répartition par type de document, et — pour l'audit — le fil des traitements
sur données `contractual` / `id_document` (référence hachée + horodatage + issue), relié à la session
quand elle est connue.

### 5. Traçabilité = valeur clé de l'OCR

Comme tu le pressens : sur l'OCR de documents, l'enjeu n'est pas que le coût, c'est **la piste d'audit**
— « quel document a été traité, quand, avec quel résultat, sur de la donnée de quelle sensibilité ».
C'est exactement ce que `data_class` + `doc_ref` + le lien session/trace permettent de restituer, sans
jamais stocker le contenu personnel.
