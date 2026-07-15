# Publication au Chrome Web Store — MIP RUM (capteur navigateur)

Kit de soumission **prêt à uploader**. Tout ce qui suit est fourni ; il ne reste
que les étapes manuelles dans le dashboard Google (connexion + paiement + copier-coller).

> Ce que je ne peux PAS faire à ta place : créer le compte développeur, payer les
> **5 $ (une seule fois, pas un abonnement)**, et cliquer « Publier ». Tout le reste
> (paquet, visuels, textes, justifications, politique de confidentialité) est prêt.

---

## 0. Prérequis (une fois)

1. Va sur https://chrome.google.com/webstore/devconsole avec un compte Google.
2. Paie les **5 $ de frais d'inscription développeur** (unique, à vie).
3. (Recommandé) Renseigne un **éditeur vérifié** (nom + e-mail de contact) — accélère le review.

## 1. Paquet à uploader

```bash
pnpm --filter @mip/rum-sdk build
pnpm --filter extension pack:store    # -> apps/console/public/downloads/mip-rum-extension-store.zip
```

Uploade **`mip-rum-extension-store.zip`** (variante **store** : le champ `key` est retiré,
le store gère la signature et l'ID). N'uploade PAS `mip-rum-extension.zip` (celui-ci garde
`key` et sert au sideload / policy entreprise avec ID stable).

## 2. Fiche du magasin (onglet « Store listing »)

| Champ | Valeur |
|---|---|
| **Nom** | MIP RUM — capteur navigateur |
| **Résumé** (132 car. max) | Mesure la performance réelle (Core Web Vitals) et les erreurs des sites, de façon anonyme. Souverain, hébergé en UE. |
| **Catégorie** | Developer Tools |
| **Langue** | Français (ajoute Anglais si besoin — la fiche accepte plusieurs langues) |
| **Icône** | fournie dans le paquet (128×128) |

**Description détaillée** (copier-coller) :

> MIP RUM est un capteur de Real User Monitoring (RUM) souverain. Il mesure la
> performance réellement vécue par les visiteurs — Core Web Vitals (LCP, INP, CLS,
> FCP, TTFB) — et les erreurs techniques des pages, puis les remonte à la console MIP.
>
> • Standard ouvert : émission OpenTelemetry (OTLP), aucun format propriétaire.
> • Respect de la vie privée : données anonymes, aucune donnée personnelle, aucune
>   frappe clavier ni contenu de formulaire, aucune adresse IP stockée. Hébergement
>   en Union européenne, conservation 30 jours.
> • Sous votre contrôle : le capteur ne s'active QUE sur les domaines explicitement
>   enregistrés par MIP, et seulement après votre autorisation, domaine par domaine.
>
> Idéal pour instrumenter un site sans modifier son code, en pilote ou sur parc géré.

## 3. Visuels

- **Capture d'écran** (obligatoire, ≥1, format 1280×800 ou 640×400) :
  `apps/extension/store-assets/screenshot-1280x800.png`
- **Petite tuile promo** (recommandée, 440×280) :
  `apps/extension/store-assets/promo-440x280.png`

Régénérables : `PW_CHROME=/chemin/chrome xvfb-run -a node apps/extension/store-assets/screenshot.mjs`

## 4. Confidentialité (onglet « Privacy practices ») — le point le plus scruté

- **URL de politique de confidentialité** (obligatoire, publique) :
  `https://mip-rum-console.vercel.app/extension-privacy`
  (page servie sans login — cf. `apps/console/app/extension-privacy/page.tsx`)

- **Objectif unique (single purpose)** :
  > Mesurer la performance web (Core Web Vitals) et les erreurs techniques des pages,
  > sur les domaines autorisés, pour le Real User Monitoring.

- **Justification de chaque permission** (à coller dans les champs dédiés) :

  | Permission | Justification |
  |---|---|
  | `scripting` | Injecter le script de mesure de performance sur les pages des domaines autorisés. |
  | `webNavigation` | Détecter les changements de page pour déclencher la mesure au bon moment. |
  | `storage` | Mémoriser les domaines autorisés et mettre en cache la configuration de résolution. |
  | `activeTab` | Lire le domaine de l'onglet courant à l'ouverture du popup (transparence + activation). |
  | Accès aux hôtes (`optional_host_permissions`) | Accordé par l'utilisateur **domaine par domaine** ; nécessaire pour injecter le capteur sur le site autorisé. Jamais `<all_urls>` de façon implicite. |

- **Divulgations « data usage »** (cases à cocher) :
  - Collecte : « Website content » (performance/erreurs) + « User activity » (mesures de perf). PAS de PII, PAS d'authentification, PAS de données financières/santé/localisation précise.
  - Cocher les 3 attestations : données **non** vendues à des tiers ; utilisées **uniquement** pour l'objectif déclaré ; **non** utilisées pour la solvabilité/le prêt.

## 5. Distribution

- **Visibilité** : « Public » (référencé) ou « Non listé » (accessible seulement via le lien).
  Pour un pilote, **Non listé** est souvent préférable (pas de review « grand public »,
  installation par lien).
- **Régions** : toutes, ou restreindre à la France/UE.

## 6. Soumettre

1. « Save draft » sur chaque onglet.
2. « Submit for review ». Délai typique : quelques heures à quelques jours.
3. En cas de rejet, la raison la plus fréquente est une **justification de permission**
   ou une **politique de confidentialité** jugée incomplète — les deux sont fournies ci-dessus.

## 7. Après publication — mises à jour

- Bumpe la version : `manifest.json`, `package.json` (garde-les alignées sur le SDK — la
  CI `check:sync` échoue sinon), re-`pack:store`, re-uploade.
- L'ID store reste stable ; les utilisateurs sont mis à jour automatiquement.

---

## Rappel honnête

Tant que la publication n'est pas faite, l'extension **n'est pas** sur le Chrome Web Store.
En attendant, la voie **sideload** (dossier `apps/extension/` en mode développeur) ou
**policy entreprise** (`docs/DEPLOY_EXTENSION.md`) fonctionne dès aujourd'hui, sans compte
ni paiement — c'est le chemin recommandé pour démarrer le pilote sur `insight-performance.com`.
