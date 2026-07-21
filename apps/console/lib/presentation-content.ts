// Contenu statique de la page « Présentation » : la frise du pipeline (du
// navigateur à la console) et la liste des indicateurs restitués. Extrait de
// app/presentation/page.tsx pour garder la page mince. Données pures, sans JSX.
import type { IconName } from "@/components/icons";
import type { GlossaryId } from "@/lib/glossary";

/** Étapes du pipeline (navigateur → console), rendues en frise. */
export const PIPELINE: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "activity",
    title: "1 · Mesure navigateur",
    body: "Un SDK léger (~12 ko gzip) lit les Core Web Vitals, les erreurs JS et les interactions chez le vrai visiteur, via les API standard du navigateur (PerformanceObserver).",
  },
  {
    icon: "trace",
    title: "2 · Export OTLP",
    body: "Les mesures partent en OpenTelemetry (OTLP/HTTP JSON) — un standard ouvert, pas un format maison : aucun enfermement fournisseur.",
  },
  {
    icon: "gauge",
    title: "3 · Ingestion",
    body: "Une fonction serverless (Deno) ou un service Node aplatit le flux OTLP et l'écrit en base, avec garde-fous de charge et idempotence.",
  },
  {
    icon: "list",
    title: "4 · Stockage",
    body: "PostgreSQL par défaut ; chemin ClickHouse prouvé pour le grand compte (mêmes p75, ×15 plus compact). Rétention RGPD (TTL 30 j).",
  },
  {
    icon: "compass",
    title: "5 · Console",
    body: "Cette interface Next.js 15 / React 19 calcule les agrégats (p75, score de santé, anomalies) et les rend lisibles — du commercial à l'ingénieur.",
  },
];

/** Les indicateurs restitués, avec renvoi vers l'écran et bulle de glossaire. */
export const STATS: { id: GlossaryId; href: string; icon: IconName; label: string; desc: string }[] = [
  {
    id: "health",
    href: "/",
    icon: "gauge",
    label: "Score de santé /100",
    desc: "Une note unique (vitals, erreurs, stabilité, anomalies) pour piloter en un coup d'œil.",
  },
  {
    id: "LCP",
    href: "/",
    icon: "activity",
    label: "Core Web Vitals (p75)",
    desc: "LCP, INP, CLS, FCP, TTFB au 75ᵉ percentile — la qualité vécue par 3 visiteurs sur 4.",
  },
  {
    id: "anomaly",
    href: "/",
    icon: "alert",
    label: "Anomalies (z-score)",
    desc: "Détection automatique des dérapages vs comportement habituel, sans seuil à régler.",
  },
  {
    id: "healthGrid",
    href: "/",
    icon: "grid",
    label: "Heatmap de santé",
    desc: "La tenue jour par jour, heure par heure — pour lire la performance dans la durée.",
  },
  {
    id: "errorFingerprint",
    href: "/errors",
    icon: "alert",
    label: "Erreurs regroupées",
    desc: "Les erreurs JS dédupliquées par cause (fingerprint), triées par impact réel.",
  },
  {
    id: "session",
    href: "/sessions",
    icon: "users",
    label: "Sessions & rejeu visuel",
    desc: "Le parcours réel d'un visiteur (pages, vitals, erreurs), sans donnée identifiante — avec rejeu visuel (rrweb) des sessions, saisies masquées et TTL 30 j.",
  },
  {
    id: "tracing",
    href: "/tracing",
    icon: "trace",
    label: "Tracing front → back",
    desc: "Chaque appel API relié à son exécution serveur (W3C traceparent) : réseau, serveur ou code ?",
  },
  {
    id: "robotVsReal",
    href: "/correlation",
    icon: "compare",
    label: "Robot vs Réel",
    desc: "L'écart entre le monitoring synthétique et les vrais utilisateurs — le terrain prime sur le labo.",
  },
  {
    id: "experience",
    href: "/experience",
    icon: "users",
    label: "Expérience utilisateur",
    desc: "Le ressenti (feedbacks + CSAT) marié à la perf mesurée : un score d'expérience, le pont chiffres ↔ satisfaction.",
  },
  {
    id: "experienceMap",
    href: "/map",
    icon: "trace",
    label: "Carte d'expérience",
    desc: "Le graphe pages → API → backend, coloré par santé et pondéré par le volume : cartographie, flux et anticipation.",
  },
  {
    id: "forecast",
    href: "/forecast",
    icon: "target",
    label: "Prévisions (AIOps)",
    desc: "Projette la dérive des indicateurs sur 14 j et l'ETA au franchissement de seuil : du réactif au prédictif.",
  },
];
