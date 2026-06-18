# Signaux de frustration — rage / dead clicks + attribution INP (P1)

> Détecter là où l'utilisateur **galère** (pas seulement où le navigateur est lent).
> Standard du marché (FullStory, Dynatrace DEM, Datadog RUM). Console : **/ux**.

## Ce qu'on capte

| Signal | Définition | Émission SDK | Stockage |
|---|---|---|---|
| **Rage click** | ≥ 3 clics sur la **même cible** en < 1 s (l'UI ne réagit pas comme attendu). | span `frustration` (`kind=rage`, `count`) — **une fois par rafale**. | `rum_event` (`name='frustration.rage'`). |
| **Dead click** | Clic sur un élément **d'aspect actionnable** (`<button>/<a>/role=button/…` ou `cursor:pointer`) sans **aucune réaction** (mutation DOM, navigation, scroll) dans 1,5 s. | span `frustration` (`kind=dead`). | `rum_event` (`name='frustration.dead'`). |
| **Attribution INP** | Élément responsable de l'interaction lente (`interactionTarget` de web-vitals). | déjà capté dans `webvital.attribution` (P0). | `rum_metric.attribution` (jsonb). |

## SDK (`packages/rum-sdk/src/frustration.ts`)

- **Pur & testable** : `RageDetector` (rafale glissante, émet une fois par salve, réarme sur coupure/changement de cible) et `isDeadClick(clickT, {mutation, nav, scroll})` (mort si **aucune** réaction postérieure — conservateur).
- **Câblage** : un `MutationObserver` partagé + écouteurs `popstate`/`hashchange`/`scroll` marquent la dernière « réaction » ; un écouteur `click` en capture alimente les deux détecteurs. Cap **20 signaux/page** (remis à zéro à chaque navigation, comme les autres caps).
- **Cible** lisible (`formatClickLabel`, ≤ 80 c). **Opt-out** : `MIPRum.init({ frustration: false })`.
- **Conservateur par conception** : sur une page très dynamique (animations, polling DOM), les dead clicks sont **sous-reportés** plutôt que faussement signalés. Pas de coordonnées, pas de capture de saisie.

## Ingestion (`_shared/otlp.mjs`)

Le span `frustration` est mappé vers `rum_event` sous le **nom réservé** `frustration.<kind>`, `props = { target, count }`. Choix volontaire : `rum_event` **hérite** déjà de toute la plomberie (policy `console_ro`, purge par rétention, effacement RGPD `erase_app_data`/`erase_session`, métering, index `(app_id, name, ts)`) — pas de nouvelle table à recâbler (leçon des findings #1/#4). `target` est **scrubbé** (PII) comme tout texte libre (`scrubProps`). `kind` hors {`rage`,`dead`} ⇒ **rejeté**.

## Console (`/ux`, `lib/queries-frustration.ts`)

- **Signaux de frustration** : top rage/dead par route × cible (fenêtre = filtre global).
- **Interactions lentes** : éléments classés par **INP p75** (depuis l'attribution), avec pire valeur.
- Filtres app/device/période standards ; fail-soft (vide si la base bronche).

## Preuves

- `tests/unit/frustration.test.ts` : détecteurs (rafale, réarmement, dead-click).
- `tests/unit/otlp.test.ts` : mapping `frustration` → `rum_event` (rage/dead, défaut `count`, `kind` invalide rejeté, scrub de la cible).
- `tests/unit/otlp-snapshot.test.ts` : span `frustration` ajouté au contrat figé.
- `scripts/verify-frustration.mjs` : agrégats + attribution INP **sur Postgres réel**, et lecture sous `console_ro`.

## Suivi (non bloquant)

- Les signaux de frustration ne sont **pas** comptés dans le métering d'events (`meter_tenant_usage`) — volume marginal ; à inclure si la facturation doit les couvrir.
- Lien direct depuis `/ux` vers la session/replay correspondante (corrélation parcours).
