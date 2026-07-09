# MIP RUM — extension navigateur (Ext-B, squelette)

2ᵉ capteur RUM du catalogue MIP. Cf. `docs/CADRAGE_EXTENSION.md` pour le cadrage complet.

## Ce que fait ce squelette (Ext-B)

Sur chaque navigation top-level, le service worker (`src/background.ts`) résout le
domaine visité via `GET /api/extension/resolve` (registre `extension_scope`, géré
côté console). Si le domaine est enregistré, la permission déjà accordée, et que le
site n'a pas déjà son propre SDK (`window.MIPRum`), le SDK RUM (`vendor/mip-rum.js` —
**le même bundle** que le script classique, copié depuis `packages/rum-sdk/dist`)
est injecté en `world: "MAIN"`, avec `collectionSource: "extension"`.

**Ce squelette n'a pas d'UI.** L'octroi de permission (`chrome.permissions.request`,
qui exige un geste utilisateur) et la transparence ("MIP RUM observe : `<domaine>`")
sont le périmètre d'**Ext-C** (popup). Pour tester ce squelette avant Ext-C, accorder
manuellement l'accès au site depuis `chrome://extensions` → détails de l'extension →
"Accès aux sites" (ou tester via une policy d'entreprise `ExtensionSettings` qui
pré-accorde `host_permissions`).

## Build

```bash
pnpm --filter extension build
```

Régénère `vendor/background.js` (bundle du service worker) et `vendor/mip-rum.js`
(copie du SDK — à relancer après tout changement dans `packages/rum-sdk`).

## Charger en local (sideload, mode développeur)

1. `pnpm --filter extension build`
2. `chrome://extensions` (ou `edge://extensions`) → activer le "mode développeur"
3. "Charger l'extension non empaquetée" → sélectionner ce dossier (`apps/extension/`)

## Enregistrer un domaine à observer

Actuellement via SQL direct sur `extension_scope` (l'admin console dédiée est Ext-C) :

```sql
insert into extension_scope (domain, app_id) values ('app.client.fr', 'gip-plateforme');
```

## ⚠️ À vérifier manuellement (pas testable dans cet environnement)

- Le comportement réel de `chrome.scripting.executeScript({world:"MAIN", files:[...]})`
  n'a pas été validé dans un vrai navigateur ici (pas d'accès Chrome/Edge dans cet
  environnement d'exécution). À valider en premier lors du chargement unpacked.
- Version Chrome/Edge minimale pour l'injection `world:"MAIN"` (≥111) — à confirmer
  sur le parc cible avant tout déploiement au-delà du poste de dev.
