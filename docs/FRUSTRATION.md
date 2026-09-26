# Signaux de frustration — rage / dead / error clicks + attribution INP

> Détecter là où l'utilisateur **galère** (pas seulement où le navigateur est lent).
> Standard du marché (FullStory, Dynatrace DEM, Datadog RUM). Console : **/ux**.

## Ce qu'on capte

| Signal | Définition | Émission SDK | Stockage |
|---|---|---|---|
| **Rage click** | ≥ 3 clics sur la **même cible** en < 1 s (l'UI ne réagit pas comme attendu). | span `frustration` (`kind=rage`, `count`) — **une fois par rafale**. | `rum_event` (`name='frustration.rage'`). |
| **Dead click** | Clic sur un élément **d'aspect actionnable** (`<button>/<a>/role=button/…` ou `cursor:pointer`) sans **aucune réaction** (mutation DOM, navigation, scroll) dans 1,5 s. | span `frustration` (`kind=dead`). | `rum_event` (`name='frustration.dead'`). |
| **Error click** | Première exception rattachée à une action causale dans sa fenêtre de 5 s. | span `frustration` (`kind=error`) — une seule fois par action. | `rum_event` (`name='frustration.error'`, `action_id`). |
| **Attribution INP** | Élément responsable de l'interaction lente (`interactionTarget` de web-vitals). | déjà capté dans `webvital.attribution` (P0). | `rum_metric.attribution` (jsonb). |

## SDK (`packages/rum-sdk/src/frustration.ts`)

- **Pur & testable** : `RageDetector` (rafale glissante, émet une fois par salve, réarme sur coupure/changement de cible) et `isDeadClick(clickT, {mutation, nav, scroll})` (mort si **aucune** réaction postérieure — conservateur).
- **Câblage** : un `MutationObserver` partagé + écouteurs `popstate`/`hashchange`/`scroll` marquent la dernière « réaction » ; un écouteur `click` en capture alimente les deux détecteurs. Cap **20 signaux/page** (remis à zéro à chaque navigation, comme les autres caps).
- **Cible** lisible (`formatClickLabel`, ≤ 80 c). **Opt-out** : `MIPRum.init({ frustration: false })`.
- **Conservateur par conception** : sur une page très dynamique (animations, polling DOM), les dead clicks sont **sous-reportés** plutôt que faussement signalés. Pas de coordonnées, pas de capture de saisie.

## Ingestion (`packages/backend/shared/otlp.mjs`)

Le span `frustration` est mappé vers `rum_event` sous le **nom réservé** `frustration.<kind>`, `props = { target, count }`. `target` est **scrubbé** comme tout texte libre (`boundedEventProps`, qui applique `scrubText` à chaque chaîne). `kind` hors {`rage`,`dead`,`error`} est rejeté ; `error` sans `action_id` valide l'est aussi.

## Console (`/ux`, `lib/queries-frustration.ts`)

- **Signaux de frustration** : top rage/dead/error par route × cible (fenêtre = filtre global).
- **Interactions lentes** : éléments classés par **INP p75** (depuis l'attribution), avec pire valeur.
- Filtres app/device/période standards ; fail-soft (vide si la base bronche).

## Preuves

- `tests/unit/frustration.test.ts` : détecteurs (rafale, réarmement, dead-click).
- `tests/unit/otlp.test.ts` : mapping `frustration` → `rum_event` (rage/dead/error, défaut `count`, `kind` invalide rejeté, scrub de la cible).
- `tests/unit/otlp-snapshot.test.ts` : span `frustration` ajouté au contrat figé.
- `scripts/verify-frustration.mjs` : agrégats + attribution INP **sur Postgres réel**, et lecture sous `console_ro`.

## Suivi (non bloquant)

- Le signal source `rum_event` reste compté une seule fois par le métering existant. La projection `rum_action`, dérivée pour la lecture causale, n'est jamais ajoutée au quota afin d'éviter un double comptage.
- Lien direct depuis `/ux` vers la session/replay correspondante (corrélation parcours).
