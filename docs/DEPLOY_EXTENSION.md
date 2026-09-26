# Déploiement de l'extension navigateur (Ext-D)

> **Le chemin principal est désormais dans la console** : à la création d'une app en
> mode extension (`/select/new`), l'écran propose les deux voies directement —
> **(A)** « Ajouter à Chrome » (le bouton n'apparaît que si la variable `CHROME_STORE_URL`
> est posée, donc après la publication au Store) ou téléchargement du `.zip`
> + chargement « non empaqueté », et **(B)** une policy `ExtensionSettings` **pré-remplie**
> (ID + domaines réels ; `update_url` vient de `EXTENSION_UPDATE_URL`, sinon un gabarit à
> remplacer) à copier-coller dans GPO/Intune/Google Admin, plus la policy séparée de
> nommage des postes (`3rdparty` → clé `poste`). Ce document reste la **référence packaging
> avancé** (empaquetage `.crx` signé, `update.xml` Omaha) pour la voie B.
>
> POC interne, **non publié** sur le Chrome Web Store au 26/09/2026 (cf.
> `docs/CADRAGE_EXTENSION.md` §0 — le grand public est hors périmètre de ce POC, réservé à la
> Phase 2 ; le kit de soumission est prêt : `docs/CHROME_WEB_STORE.md`). Deux modes
> de déploiement : sideload manuel (dev/QA) et policy d'entreprise (poste géré du client).
>
> **Régénérer le `.zip`** servi par la console (après un changement d'extension) :
> `pnpm --filter extension pack` (build + empaquetage → `apps/console/public/downloads/`).

## Identité de l'extension

L'ID d'une extension Chrome/Edge dérive de sa **clé publique**, embarquée dans
`manifest.json` (`"key"`). Elle est donc **stable** entre deux builds, y compris en
sideload — condition nécessaire pour qu'une policy d'entreprise (qui référence l'ID)
continue de fonctionner après une mise à jour.

- **ID de cette extension** : `gglpcalhlkfhgipfmemfiedjomifefba`
- La **clé privée** correspondante (nécessaire pour empaqueter un `.crx` signé) **n'est
  pas dans le repo** (jamais committée — cf. `.gitignore`). Elle a été générée pour ce
  POC et remise séparément à l'équipe MIP ; si elle est perdue, un nouveau build change
  l'ID et **casse** toute policy d'entreprise déjà déployée (il faudrait re-régénérer
  et republier partout). À conserver dans un coffre secrets (pas un fichier local).

## 1. Sideload (développement / QA interne)

Cf. `apps/extension/README.md` — mode développeur, "charger l'extension non
empaquetée". Suffisant pour tester en interne ; l'ID reste stable car il dérive de
`manifest.json`, chargé unpacked ou empaqueté.

## 2. Déploiement policy d'entreprise (poste géré du client)

C'est le chemin visé pour la cible retenue au cadrage (« employés du client, poste
géré » — cf. `CADRAGE_EXTENSION.md` §0). Trois pièces :

### a. Empaqueter en `.crx` signé

```bash
# Depuis un poste avec Chrome/Chromium installé (nécessite la clé privée du POC) :
chrome --pack-extension=apps/extension --pack-extension-key=<chemin-vers-la-clé-privée>.pem
# -> produit apps/extension.crx (l'ID du .crx correspond à la clé, donc à
#    gglpcalhlkfhgipfmemfiedjomifefba)
```

> ✅ Chargement + injection validés dans un vrai Chromium via
> `pnpm --filter extension smoke` (service worker MV3 exécuté, manifest + icônes
> parsés, bundle injecté en MAIN world → `window.MIPRum` initialisé et OTLP émis).
> Reste à exécuter par l'équipe **avec la clé privée** : l'empaquetage `.crx` lui-même
> (signature) et le déploiement par policy entreprise.

### b. Héberger le `.crx` + un manifeste de mise à jour (protocole Omaha)

Fichier `update.xml`, hébergé sur une URL accessible du parc client :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="gglpcalhlkfhgipfmemfiedjomifefba">
    <updatecheck codebase="https://<votre-hébergement>/mip-rum-extension.crx" version="0.4.3" />
  </app>
</gupdate>
```

`version` est celle de `manifest.json` au moment de l'empaquetage (0.4.3 au 26/09/2026).
Elle suit la version du SDK (`packages/rum-sdk/package.json`) : `check:sync`, rejoué en CI,
échoue si le manifest ou `apps/extension/package.json` en diverge. À chaque nouvelle version
de l'extension : ré-empaqueter, mettre à jour `version` dans `update.xml` — Chrome/Edge
managés re-vérifient périodiquement et mettent à jour automatiquement (pas besoin de
réinstaller).

### c. Policy `ExtensionSettings` (GPO / Google Admin / Intune)

```jsonc
{
  "gglpcalhlkfhgipfmemfiedjomifefba": {
    "installation_mode": "force_installed",
    "update_url": "https://<votre-hébergement>/update.xml",
    // Pré-accorde l'accès aux domaines du client SANS geste utilisateur — sur poste
    // géré uniquement. Sans cette ligne, chaque employé devrait cliquer "Activer sur
    // ce domaine" dans le popup (Ext-C) pour CHAQUE domaine, ce qui reste possible
    // mais moins transparent à grande échelle.
    "runtime_allowed_hosts": ["*://app.client.fr"]
  }
}
```

> `runtime_allowed_hosts` est une clé standard de la policy Chrome/Edge
> `ExtensionSettings` (documentation officielle Google/Microsoft) — cohérente avec
> l'invariant du cadrage : la portée reste **explicite, par origine**, jamais
> `<all_urls>` implicite. Lister ici exactement les domaines déjà enregistrés côté
> MIP dans `extension_scope` (`/admin/extension-scope`) — un domaine présent dans la
> policy mais absent du registre MIP n'aura de toute façon aucun effet (le service
> worker vérifie le registre en premier, cf. Ext-B).

### d. Registre MIP

Chaque domaine cible doit être enregistré via `/admin/extension-scope` (Ext-C) —
la policy d'entreprise pré-accorde la **permission navigateur**, le registre MIP
autorise la **collecte**. Les deux sont nécessaires (défense en profondeur).

## 3. Checklist de mise en service

- [ ] Domaine(s) client enregistrés dans `/admin/extension-scope` (actif)
- [ ] `.crx` empaqueté avec la clé privée du POC (ID stable vérifié)
- [ ] `update.xml` hébergé et accessible depuis le parc client
- [ ] Policy `ExtensionSettings` poussée (test sur un poste pilote avant déploiement large)
- [ ] Popup vérifié sur le poste pilote : le domaine, puis « MIP RUM observe ce domaine. »
- [ ] Vérification console : nouvelles sessions avec `collection_source = 'extension'`
      pour l'app concernée (segment `source==extension`, cf. Ext-A)
- [ ] Inventaire : le poste pilote apparaît dans `/admin/extension-installs` (sous son
      libellé si la policy de nommage est poussée, sinon sous son identifiant d'installation)

## 4. Rollback

- Retirer l'entrée `ExtensionSettings` (ou passer `installation_mode` à `removed`) —
  Chrome/Edge managés désinstallent au prochain cycle de policy.
- Désactiver le domaine dans `/admin/extension-scope` (`active=false`) — coupe la
  collecte sous ~60 s (durée du cache de résolution du service worker,
  `apps/extension/src/background.ts`), sans attendre la désinstallation (défense en
  profondeur, cf. §2.d).
