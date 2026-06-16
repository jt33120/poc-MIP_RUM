// Page d'accueil « Présentation » — explique ce qu'est l'outil (RUM), sa stack
// en quelques mots, son fonctionnement, et les statistiques restituées. Sert de
// porte d'entrée pour un visiteur (commercial, prospect, nouvel utilisateur)
// avant le poste de pilotage (Overview). Rendu 100 % serveur, sans accès base :
// la page s'affiche toujours, même sans données. La heatmap est ici alimentée
// par un échantillon illustratif — sa version « live » vit sur l'Overview.
import Link from "next/link";
import { HealthHeatmap, type HeatCell, lastNDayKeys } from "@/components/charts/HealthHeatmap";
import { GlossaryTip } from "@/components/GlossaryTip";
import { ICON_PATHS, Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { GRID_DAYS } from "@/lib/queries-grid";
import type { GlossaryId } from "@/lib/glossary";

export const dynamic = "force-dynamic";

/** Étapes du pipeline (navigateur → console), rendues en frise. */
const PIPELINE: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "activity",
    title: "1 · Mesure navigateur",
    body: "Un SDK léger (~5 ko) lit les Core Web Vitals, les erreurs JS et les interactions chez le vrai visiteur, via les API standard du navigateur (PerformanceObserver).",
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
    body: "PostgreSQL pour le POC ; chemin ClickHouse prouvé pour le grand compte (mêmes p75, ×15 plus compact). Rétention RGPD (TTL 30 j).",
  },
  {
    icon: "compass",
    title: "5 · Console",
    body: "Cette interface Next.js 15 / React 19 calcule les agrégats (p75, score de santé, anomalies) et les rend lisibles — du commercial à l'ingénieur.",
  },
];

/** Les indicateurs restitués, avec renvoi vers l'écran et bulle de glossaire. */
const STATS: { id: GlossaryId; href: string; icon: IconName; label: string; desc: string }[] = [
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
    label: "Sessions & replay",
    desc: "Le parcours réel d'un visiteur, rejouable visuellement (rrweb) — sans donnée identifiante.",
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
];

/** Échantillon illustratif (déterministe) pour montrer le style de plot. */
function sampleHeatmap(dayKeys: string[]): Map<string, HeatCell> {
  const m = new Map<string, HeatCell>();
  dayKeys.forEach((key, i) => {
    const recent = i >= dayKeys.length - 2; // 2 derniers jours : incident l'après-midi
    for (let h = 0; h < 24; h++) {
      // nuit creuse : peu/pas de trafic -> quelques cases « aucune donnée »
      if (h < 6 && (i + h) % 3 === 0) {
        m.set(`${key}|${h}`, { good_w: 0, total_w: 0 });
        continue;
      }
      let ratio = 0.96;
      if (h >= 8 && h <= 10 && i % 4 === 0) ratio = 0.65; // pic matinal récurrent
      if (recent && h >= 13 && h <= 19) ratio = 0.35; // incident après-midi
      const total = 12;
      m.set(`${key}|${h}`, { good_w: Math.round(total * ratio), total_w: total });
    }
  });
  return m;
}

function PipelineStep({ step, last }: { step: (typeof PIPELINE)[number]; last: boolean }) {
  return (
    <div className="relative flex-1">
      <div className="card h-full p-4">
        <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep text-white shadow-glow">
          <Icon paths={ICON_PATHS[step.icon]} className="h-5 w-5" strokeWidth={2.1} />
        </span>
        <div className="text-sm font-semibold text-ink">{step.title}</div>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">{step.body}</p>
      </div>
      {!last && (
        <Icon
          paths={ICON_PATHS.chevronRight}
          className="absolute -right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-ink-faint xl:block"
        />
      )}
    </div>
  );
}

export default function Presentation() {
  const dayKeys = lastNDayKeys(GRID_DAYS);
  const sample = sampleHeatmap(dayKeys);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="MIP RUM — Real User Monitoring"
        help="rum"
        sub={
          <>
            Monitoring de l'expérience réelle, OpenTelemetry-natif et souverain UE. Cette page présente
            l'outil ; le poste de pilotage est sur <Link href="/" className="font-medium text-accent-deep underline-offset-2 hover:underline dark:text-accent">l'Overview</Link>.
          </>
        }
      />

      {/* Qu'est-ce que le RUM ------------------------------------------------ */}
      <section className="card mb-6 p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          Qu'est-ce que le RUM ?
          <GlossaryTip id="rum" />
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
          Le <strong>Real User Monitoring</strong> mesure la performance et les erreurs <strong>réellement
          vécues par vos utilisateurs</strong> en production — pas une sonde de laboratoire. On capte ce que
          vivent les vrais visiteurs (vitesse d'affichage, réactivité, bugs JavaScript, parcours), parce que
          c'est cette expérience-là qui pèse sur la conversion et la satisfaction. Un site rapide convertit
          mieux : le RUM le prouve avec des chiffres terrain.
        </p>
      </section>

      {/* Stack technique ---------------------------------------------------- */}
      <section className="card mb-6 p-5">
        <h2 className="text-sm font-semibold text-ink">La stack technique en quelques mots</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {[
            "SDK navigateur (Web Vitals API, rrweb)",
            "OpenTelemetry · OTLP/HTTP",
            "Ingestion Deno / Node",
            "PostgreSQL → ClickHouse",
            "Console Next.js 15 / React 19",
            "Souverain UE",
          ].map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-line bg-panel2 px-3 py-1 font-medium text-ink-soft"
            >
              {chip}
            </span>
          ))}
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-faint">
          Tout repose sur des standards ouverts (OpenTelemetry) : pas de format propriétaire, pas
          d'enfermement fournisseur, et une compatibilité immédiate avec l'écosystème observabilité existant.
        </p>
      </section>

      {/* Comment ça fonctionne --------------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Comment ça fonctionne — du navigateur à la décision
        </h2>
        <div className="flex flex-col gap-3 xl:flex-row xl:gap-6">
          {PIPELINE.map((step, i) => (
            <PipelineStep key={step.title} step={step} last={i === PIPELINE.length - 1} />
          ))}
        </div>
      </section>

      {/* Les statistiques montrées ----------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Les statistiques montrées
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className="card group flex flex-col p-4 transition hover:shadow-pop"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent-deep dark:text-accent">
                  <Icon paths={ICON_PATHS[s.icon]} className="h-4 w-4" />
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold text-ink">
                  {s.label}
                  <GlossaryTip id={s.id} />
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">{s.desc}</p>
              <span className="mt-auto pt-2 text-[11px] font-semibold text-accent-deep opacity-0 transition group-hover:opacity-100 dark:text-accent">
                Ouvrir →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Lire la performance dans la durée (heatmap exemple) ---------------- */}
      <section className="card p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          Lire la performance dans la durée
          <GlossaryTip id="healthGrid" />
        </h2>
        <p className="mb-4 mt-1 max-w-3xl text-xs leading-relaxed text-ink-soft">
          Une case = une heure d'une journée, sa couleur = la santé du créneau. On repère d'un coup d'œil les
          dérapages récurrents (ici un pic matinal et un incident l'après-midi des deux derniers jours).
          Exemple illustratif — la version alimentée par vos données vit sur{" "}
          <Link href="/" className="font-medium text-accent-deep underline-offset-2 hover:underline dark:text-accent">
            l'Overview
          </Link>
          .
        </p>
        <HealthHeatmap dayKeys={dayKeys} byKey={sample} />
      </section>
    </div>
  );
}
