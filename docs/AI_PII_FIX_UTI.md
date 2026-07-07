# Prompt à coller — corriger l'envoi de CV bruts aux LLM (`uti-platform`)

> **But** : supprimer une fuite RGPD concrète révélée par la cartographie IA. Deux
> usages envoient le **texte brut du CV** (nom, coordonnées) à un fournisseur LLM
> externe **sans pseudonymisation**, alors que le chemin matching « officiel »
> applique déjà `strip_pii()`. On aligne les deux sur le même traitement.
>
> **Portée réduite, risque faible** : on insère un appel à une fonction déjà
> existante avant l'appel LLM. Aucune logique métier ni signature publique modifiée.
>
> Copie le bloc **PROMPT** dans ta session Claude sur `uti-platform`.

---

## PROMPT

Tu travailles sur **uti-platform** (backend FastAPI/Python). Deux usages LLM
envoient le **CV brut, non pseudonymisé**, à un fournisseur externe, alors que le
pipeline matching « officiel » (`matching_runner`) applique `strip_pii()` avant
l'appel. Corrige cette **incohérence de traitement des données personnelles**, sans
changer la logique métier :

### Sites à corriger

1. **`services/consultant_skills.py::auto_extract_skills`** (BackgroundTask à la
   soumission d'un CV) — appelle `extract_features(cv_text)` **sur le texte brut**.
2. **`services/cv_harmonizer.py::harmonize_cv`** — lit `cv_text` depuis
   `submissions` et l'envoie tel quel au LLM ; seule la *sortie* est anonymisée par
   le prompt, **l'entrée contient encore le nom/contact**.

### Ce qu'il faut faire

- Réutilise **exactement** la fonction de pseudonymisation déjà employée par le
  chemin matching (`strip_pii` ou équivalent — même import, même comportement).
  **Ne réécris pas** ta propre variante.
- Applique-la au texte **avant** de le passer au LLM, dans les deux sites :

  ```python
  # consultant_skills.py::auto_extract_skills
  clean = strip_pii(cv_text)
  features = extract_features(clean)      # au lieu de extract_features(cv_text)

  # cv_harmonizer.py::harmonize_cv
  clean = strip_pii(cv_text)
  # ... construire le prompt à partir de `clean`, pas de `cv_text`
  ```

- Vérifie que `strip_pii` couvre bien **nom, email, téléphone, adresse** (les
  identifiants directs). Si la fonction existante ne masque pas l'un d'eux, complète-la
  **au même endroit** (un seul point de vérité, réutilisé par les 3 usages).
- N'altère pas le reste : mêmes providers/modèles, même fallback, même sortie.

### Contraintes

- Aucune nouvelle dépendance. Diff minimal, limité à l'insertion de `strip_pii`.
- Ne casse pas si `cv_text` est vide/null (garde le comportement actuel).
- Ajoute un test si le repo en a l'usage : `extract_features`/`harmonize_cv`
  reçoivent un texte **sans** PII directe (le nom d'entrée n'apparaît pas dans
  l'argument passé au client LLM).

Rends un diff minimal, limité à la pseudonymisation de l'entrée.

---

## Après déploiement — côté MIP RUM

Dans **Performance IA → Gouvernance des données**, les deux usages doivent passer de
« Brut envoyé » / « Mixte » à **« Pseudonymisé »**. Le catalogue console
(`lib/ai-catalog.ts`) est une classification manuelle : une fois le correctif en
prod, on met à jour `cv/harmonize` et `matching/extract` sur `pii: "scrubbed"` pour
refléter la réalité (petite PR de suivi).
