# ADR-0002 — La console devient une interface sans base, appuyée sur `console-api`

- **Statut** : acceptée ; code livré (C0 → C13), mise en service après P6b
- **Date** : 2026-09-25
- **Portée** : la console Vercel (`apps/console`), `console-api`, la piste C du plan backend

## Contexte

La console Next.js, sur Vercel, faisait tout : elle rendait les écrans, lisait et écrivait la base en propriétaire, tenait les sessions (HS256, `AUTH_SECRET`), hachait les identités, collectait les beacons, servait l'API de lecture. Une DSI qui ouvre le dépôt voit un monolithe hébergé sur une plateforme d'interface ; et chaque fonction Vercel détenait `DATABASE_URL` en propriétaire, avec `BYPASSRLS`.

Relevé du 23/09 (ré-inventaire C-R, `docs/architecture/console-api/inventaire.md`) : **51 écrans sur 57** atteignaient la base par leur graphe d'import, 53 server actions écrivaient, 54 routes. La lecture ne se fait pas par `<Suspense>` mais par section (`lire()`) : un écran ne tombe jamais en bloc, et le contrat devait le garder.

## Décision

1. **La console n'est plus qu'une interface.** Elle rend, et appelle un backend par HTTP, côté serveur. Plus de base, plus de secret d'identité (M4). Vercel ne garde que le secret client de `console-api`, la clé PUBLIQUE des sessions, et des valeurs non secrètes.
2. **Un backend dédié, `console-api`**, distinct de l'API de lecture des machines (`api`) : `api` est la surface qu'un modèle de langage pilote par MCP ; elle reste en lecture seule, sans secret d'identité (ADR-0006). `console-api` porte l'identité, les écrans, les écritures, l'administration et le RGPD ([ADR-0010](0010-console-api.md)).
3. **Le même code des deux côtés, par injection.** Un écran = un CHARGEUR (`apps/console/lib/chargeurs/`) ; une écriture = une COMMANDE (`lib/commandes/`), avec sa règle d'accès et son audit. La console les exécute aujourd'hui (`chargerEcran`, `executerCommande`) ; `console-api` embarque les mêmes (bundle esbuild, `services/console-api/{ecrans,commandes}.mjs`) et les sert sous les opérations du contrat (`@mip/console-contract`). Leur sortie traverse JSON des deux côtés (`Fil<T>`) : la page lit dès aujourd'hui la forme qu'elle recevra.
4. **La bascule à la fin, en un point.** Décision du 24/09 : `console-api` est mis en service après P6b. D'ici là, rien ne change en production ; ensuite, une PR fait appeler le service par `chargerEcran` et `executerCommande` — et les écrans, les server actions, les composants quittent le cliquet sans changer d'une ligne.
5. **Ce qui prouve M4** : le cliquet d'import (`tests/unit/inventaire-console.test.ts`), les trois gardes de C12 (`scripts/ci/console-sans-base.mjs` : imports, traçage du build, environnement — en relevé, puis `--strict`), la matrice d'autorisations qui joue chaque opération pour huit profils, sous les rôles de moindre privilège ([ADR-0012](0012-roles-de-la-console.md)).

## Conséquences

- Une latence en plus par écran (Vercel fra1 → Railway Amsterdam → Neon Francfort) : un appel par écran, pas un par section — les chargeurs lisent en parallèle côté service. Porte de latence à mesurer à la bascule (p75 TTFB par écran, `AutoRefresh` actif).
- Deux ports du même code pendant la transition : la console et le service exécutent les mêmes chargeurs et commandes. Aucune divergence possible sur ce qu'ils font ; seule la politique d'accès est appliquée deux fois (`refusDAcces` côté console, le pipeline côté service), et un test la confronte pour chaque commande, huit profils et cinq applications.
- La console reste déployable seule tant que le service n'est pas en service : c'est ce qui permet de livrer toute la piste sans toucher à la production.

## Écarté

- **Un seul backend pour la console et les machines** : la surface pilotée par un modèle de langage aurait eu les droits d'écriture et d'identité.
- **Des Server Components lisant la base « en attendant »** : c'est l'état de départ ; le cliquet ne peut que baisser.
- **Le découpage par `<Suspense>`** : refusé par la refonte (F02, il bloquait `router.replace`). L'unité est la section.
- **Basculer écran par écran en production** pendant la piste : chaque bascule aurait demandé le service en ligne, donc la base payante et les secrets partagés, des semaines plus tôt.
