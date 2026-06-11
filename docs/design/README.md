# Design system console MIP RUM

Refonte front de la console (`apps/console`) — design uniquement, zéro changement backend.

## Direction artistique

Un croisement de deux langages :

1. **Data-dense dashboard** (ops / monitoring temps réel) : tableaux denses à micro-en-têtes
   uppercase, chiffres tabulaires (`tabular-nums`), jauges de seuils 2026 sur chaque vital,
   anneau de health score, badge **LIVE** pulsant (l'AutoRefresh 5 s existait déjà — il est
   maintenant visible), stack d'erreur en « terminal » navy permanent.
2. **User behavior analytics** (UX research / product analytics) : cartes douces à coins
   arrondis, segmented controls, parcours utilisateur en chips `route → route`, timeline de
   session, hiérarchie typographique calme.

## Charte MIP (insight-performance.com)

Couleurs relevées sur le site MIP :

| Usage | Couleur |
|---|---|
| Navy MIP (primaire) | `#003399` |
| Orange MIP (signature / CTA) | `#f89101` |
| Orange clair | `#fbbc64` |
| Bleus acier (robot, secondaire) | `#6a85a6` · `#9db5d4` |
| Fonds clairs | `#ecf0f1` · `#ecf5fe` |

Applications : sidebar **navy permanent** (ancre de marque, identique dans les deux thèmes),
rail orange sur l'item de nav actif, CTA orange à texte navy (contraste AA), série « réel »
des graphiques en orange vs robot en bleu acier pointillé.

## Clair / sombre

- Tokens sémantiques en variables CSS (`globals.css`) : `--c-app`, `--c-panel`, `--c-panel2`,
  `--c-line`, `--c-ink[-soft|-faint]`, `--c-brand` — mappés dans Tailwind (`tailwind.config.ts`)
  avec support alpha (`rgb(var(--x) / <alpha>)`).
- `darkMode: "class"` + script anti-FOUC inline dans `<head>` (localStorage `mip-theme`,
  fallback `prefers-color-scheme`). Bascule via `ThemeToggle` (icônes commutées en pur CSS,
  zéro état React, zéro mismatch d'hydratation).
- Recharts thémé par CSS (les règles CSS priment sur les attributs de présentation SVG) :
  grille, axes, tooltip, légende suivent le thème sans toucher aux composants.

## Captures

| Écran | Clair | Sombre |
|---|---|---|
| Login | ![](login-light.png) | ![](login-dark.png) |
| Overview | ![](overview-light.png) | ![](overview-dark.png) |
| Pages lentes | ![](pages-light.png) | ![](pages-dark.png) |
| Erreurs JS | ![](errors-light.png) | ![](errors-dark.png) |
| Sessions | ![](sessions-light.png) | ![](sessions-dark.png) |
| Détail session | ![](session-detail-light.png) | ![](session-detail-dark.png) |
| Tracing | ![](tracing-light.png) | ![](tracing-dark.png) |
| Alertes | ![](alerts-light.png) | ![](alerts-dark.png) |
| Corrélation | ![](correlation-light.png) | ![](correlation-dark.png) |

Captures générées sur données seedées (Postgres local + `gen-traffic` + `sync-synthetic seed`).
