# Envoyer ses source maps depuis sa CI

> Pour l'équipe qui intègre MIP RUM à son site. Sans source map, une erreur de production se lit `at e (main-DVBHRQO7.js:1:40)` ; avec, `at e (src/panier.ts:3:11)`. Le fonctionnement complet (symbolication, contrat, refus) est dans [docs/SOURCEMAPS.md](../SOURCEMAPS.md) ; ce guide ne dit que ce qu'il faut poser dans **votre** CI.

## 1. Trois valeurs à fixer

| Valeur | D'où elle vient | Règle |
|---|---|---|
| **La release** | votre CI (tag, ou SHA du commit) | **exactement** la valeur passée au SDK : `MIPRum.init({ …, release })`. 1 à 120 caractères, comparée à l'octet près. Une map envoyée pour une autre release ne sert jamais. |
| **Le jeton** `msu_…` | console MIP → Administration → Source maps → *Jetons de CI* (un administrateur) | un seul droit (`sourcemaps:write`), une seule application, 1 à 90 jours. Affiché une fois : le poser en **secret** de la CI. Rotation : nouveau jeton, bascule, révocation de l'ancien. |
| **L'URL d'envoi** | ci-dessous | la destination exacte, jamais devinée. |

| Où envoyer | URL | Plafond |
|---|---|---|
| **Aujourd'hui** : la console | `https://mip-rum-console.vercel.app/api/sourcemaps` | 4 Mio par requête (limite Vercel) : envoyer map par map |
| Quand le collector sera en ligne (P2) | `https://<domaine du collector>/v1/sourcemaps` | 20 Mio par requête, 15 Mio par map |

## 2. Le contrat, en une ligne

`POST` JSON `{ "appId": "<votre app>", "release": "<release>", "maps": [{ "filename": "<bundle minifié>", "content": <la map> }] }`, en-tête `Authorization: Bearer msu_…`. `filename` est le nom du **bundle** tel qu'il apparaît dans les stacks (`main-DVBHRQO7.js`), pas celui de la map. Réponse `200` avec l'empreinte de chaque map reçue ; une map déjà présente à l'identique répond `unchanged` : **rejouer un envoi ne duplique rien**. Un contenu différent sous le même nom répond `409` et n'écrit rien.

## 3. GitHub Actions

```yaml
- name: Source maps MIP RUM
  env:
    MIP_SOURCEMAP_TOKEN: ${{ secrets.MIP_SOURCEMAP_TOKEN }}
    MIP_APP_ID: mon-app
    MIP_SOURCEMAP_URL: https://mip-rum-console.vercel.app/api/sourcemaps
    RELEASE: ${{ github.sha }}          # la MÊME valeur que la release du SDK
  run: |
    # Le jeton passe par un fichier d'en-têtes, jamais par la ligne de commande
    # (visible dans la liste des processus du runner).
    entetes="$RUNNER_TEMP/mip-entetes"
    printf 'authorization: Bearer %s\ncontent-type: application/json\n' "$MIP_SOURCEMAP_TOKEN" > "$entetes"
    for map in dist/**/*.js.map; do
      bundle=$(basename "$map" .map)
      jq -n --arg app "$MIP_APP_ID" --arg rel "$RELEASE" --arg f "$bundle" --slurpfile m "$map" \
        '{appId: $app, release: $rel, maps: [{filename: $f, content: $m[0]}]}' \
      | curl --fail-with-body -sS --retry 3 --retry-all-errors -X POST "$MIP_SOURCEMAP_URL" \
          -H @"$entetes" --data-binary @- | jq -c '.maps[] | {filename, status, checksum}'
    done
    rm -f "$entetes"
```

(`shopt -s globstar` si le build range ses bundles dans des sous-dossiers.)

## 4. GitLab CI

```yaml
sourcemaps-mip:
  stage: deploy
  image: alpine:3.20
  needs: [build]
  variables:
    MIP_APP_ID: mon-app
    MIP_SOURCEMAP_URL: https://mip-rum-console.vercel.app/api/sourcemaps
    RELEASE: $CI_COMMIT_SHA              # la MÊME valeur que la release du SDK
  script:
    - apk add --no-cache curl jq
    - printf 'authorization: Bearer %s\ncontent-type: application/json\n' "$MIP_SOURCEMAP_TOKEN" > /tmp/mip-entetes
    - |
      for map in $(find dist -name '*.js.map'); do
        bundle=$(basename "$map" .map)
        jq -n --arg app "$MIP_APP_ID" --arg rel "$RELEASE" --arg f "$bundle" --slurpfile m "$map" \
          '{appId: $app, release: $rel, maps: [{filename: $f, content: $m[0]}]}' \
        | curl --fail-with-body -sS --retry 3 --retry-all-errors -X POST "$MIP_SOURCEMAP_URL" \
            -H @/tmp/mip-entetes --data-binary @-
      done
```

`MIP_SOURCEMAP_TOKEN` : variable CI/CD **masquée et protégée** du projet.

## 5. À ne pas faire

- **Publier les `.map` avec le site** : elles donnent votre code source à tous les visiteurs. Supprimez-les de l'artefact déployé après l'envoi.
- **Envoyer avant d'avoir figé la release** : la release du SDK et celle de l'envoi doivent venir de la même variable du même pipeline.
- **Réutiliser un jeton de lecture** (`CONSOLE_API_TOKENS`, jetons de l'API v1) : il n'a aucun droit d'envoi, et c'est voulu.

## 6. Vérifier

Dans la console, **Administration → Source maps** liste les releases reçues avec leur empreinte. Sur une erreur postérieure au déploiement, le détail affiche la stack « dé-minifiée · release ». Si la map arrive après l'erreur, la stack est symbolisée à l'affichage, et le dit.

> Le CLI de MIP (`scripts/upload-sourcemaps.mjs`) fait la même chose avec plus de contrôles — liaison bundle ↔ map par `sourceMappingURL`, validation de toutes les maps avant le premier envoi, découpage en lots, vérification de chaque empreinte. Il vit dans le dépôt de MIP RUM et n'est pas encore publié en paquet : il suppose un clone du dépôt.
