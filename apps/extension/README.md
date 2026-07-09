# MIP RUM — extension navigateur (Ext-B + Ext-C)

2ᵉ capteur RUM du catalogue MIP. Cf. `docs/CADRAGE_EXTENSION.md` pour le cadrage complet.

## Ce que fait l'extension

Sur chaque navigation top-level, le service worker (`src/background.ts`) résout le
domaine visité via `GET /api/extension/resolve` (registre `extension_scope`, géré
côté console à `/admin/extension-scope`). Si le domaine est enregistré, la permission
déjà accordée, et que le site n'a pas déjà son propre SDK (`window.MIPRum`), le SDK RUM
(`vendor/mip-rum.js` — **le même bundle** que le script classique, copié depuis
`packages/rum-sdk/dist`) est injecté en `world: "MAIN"`, avec
`collectionSource: "extension"`.

**Le popup (`popup.html` / `src/popup.ts`, Ext-C)** est le SEUL endroit où l'extension
passe d'un domaine "reconnu" à "observé" : `chrome.permissions.request()` exige un
geste utilisateur, satisfait par le clic sur l'icône qui ouvre le popup. Le popup
affiche toujours l'état courant (transparence) :
- domaine non enregistré → message neutre, rien d'autre ;
- domaine reconnu mais permission pas encore accordée → bouton "Activer sur ce
  domaine" ;
- site déjà instrumenté par son propre SDK, ou déjà observé → bouton "Retirer
  l'autorisation pour ce domaine" (effective à la prochaine navigation — on ne
  prétend pas arrêter à chaud un SDK déjà initialisé sur la page courante).

## Build

```bash
pnpm --filter extension build
```

Régénère `vendor/background.js`, `vendor/popup.js` et `vendor/mip-rum.js` (copie du
SDK — à relancer après tout changement dans `packages/rum-sdk`).

## Charger en local (sideload, mode développeur)

1. `pnpm --filter extension build`
2. `chrome://extensions` (ou `edge://extensions`) → activer le "mode développeur"
3. "Charger l'extension non empaquetée" → sélectionner ce dossier (`apps/extension/`)
4. Épingler l'icône de l'extension pour accéder au popup

## Enregistrer un domaine à observer

Via `/admin/extension-scope` dans la console (admin only), ou en SQL direct :

```sql
insert into extension_scope (domain, app_id) values ('app.client.fr', 'gip-plateforme');
```

## ⚠️ À vérifier manuellement (pas testable dans cet environnement)

- Le comportement réel de `chrome.scripting.executeScript({world:"MAIN", files:[...]})`
  n'a pas été validé dans un vrai navigateur ici (pas d'accès Chrome/Edge dans cet
  environnement d'exécution). À valider en premier lors du chargement unpacked.
- Version Chrome/Edge minimale pour l'injection `world:"MAIN"` (≥111) — à confirmer
  sur le parc cible avant tout déploiement au-delà du poste de dev.
