// Site de présentation PUBLIC (visiteur non connecté) — page d'accueil produit
// qui scrolle : barre sticky (connexion en haut à droite), hero avec aperçu
// console + CTA, puis sections d'explication (valeur, fonctionnement, indicateurs,
// mise en route) et CTA final. Rendu serveur ; seule la bascule de thème est un
// îlot client. Le contenu du pipeline est réutilisé depuis presentation-content.
import Link from "next/link";
import { ICON_PATHS, Icon, type IconName } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PIPELINE } from "@/lib/presentation-content";

// --- contenu marketing (concis — la page privée porte le détail) --------------

const VALUES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "activity",
    title: "L'expérience réelle, pas le labo",
    body: "On mesure ce que vivent vos vrais visiteurs en production — vitesse d'affichage, réactivité, stabilité — via les API standard du navigateur.",
  },
  {
    icon: "alert",
    title: "Des erreurs triées par impact",
    body: "Les bugs JavaScript sont regroupés par cause et classés par nombre d'utilisateurs touchés. Vous corrigez ce qui compte, d'abord.",
  },
  {
    icon: "shield",
    title: "Souverain, sans enfermement",
    body: "100 % OpenTelemetry, hébergé en UE. Pas de format propriétaire, pas de lock-in fournisseur : vos données restent les vôtres.",
  },
];

const INDICATORS: { icon: IconName; label: string; desc: string }[] = [
  { icon: "gauge", label: "Score de santé /100", desc: "Une note unique (vitals, erreurs, stabilité) pour piloter en un coup d'œil." },
  { icon: "activity", label: "Core Web Vitals (p75)", desc: "LCP, INP, CLS au 75ᵉ percentile — la qualité vécue par 3 visiteurs sur 4." },
  { icon: "alert", label: "Anomalies détectées", desc: "Les dérapages vs le comportement habituel, repérés sans seuil à régler." },
  { icon: "trace", label: "Tracing front → back", desc: "Chaque appel API relié à son exécution serveur : réseau, serveur ou code ?" },
  { icon: "users", label: "Parcours & sessions", desc: "Le cheminement réel d'un visiteur, pages, vitals et erreurs, sans donnée identifiante." },
  { icon: "ai", label: "Performance IA", desc: "Appels LLM (tokens, coût, latence) et gouvernance des données exposées." },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Créez votre application", body: "En un clic, obtenez un identifiant d'app et sa clé d'ingestion." },
  { title: "Collez le snippet", body: "Une balise script légère (~12 ko gzip), et le SDK démarre tout seul." },
  { title: "Regardez les données affluer", body: "Vitals, erreurs et parcours remontent en temps réel, rafraîchis toutes les 5 s." },
];

const STACK = [
  "SDK navigateur (Web Vitals · rrweb)",
  "OpenTelemetry · OTLP/HTTP",
  "Ingestion Deno / Node",
  "PostgreSQL → ClickHouse",
  "Next.js 15 · React 19",
  "Hébergé en UE",
];

/** Marque MIP RUM — pouls sur carré orange + wordmark. */
function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
        <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-bold tracking-tight text-ink">
          MIP <span className="text-accent">RUM</span>
        </span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          Real User Monitoring
        </span>
      </span>
    </span>
  );
}

/** Aperçu stylisé de la console (décoratif) — vend le produit dans le hero. */
function ConsolePreview() {
  const vitals = [
    { k: "LCP", v: "1.8 s", tone: "good" },
    { k: "INP", v: "118 ms", tone: "good" },
    { k: "CLS", v: "0.04", tone: "good" },
  ] as const;
  const toneClass = {
    good: "text-good",
    warn: "text-warn",
    bad: "text-bad",
  };
  // anneau du score : 92 % d'un cercle r=26 (circonférence ≈ 163,4)
  const R = 26;
  const C = 2 * Math.PI * R;
  const pct = 0.92;
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-tr from-accent/25 via-perf/10 to-transparent blur-2xl"
      />
      <div className="relative overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
        {/* chrome navigateur factice */}
        <div className="flex items-center gap-2 border-b border-line bg-panel2 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-bad/50" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-good/60" />
          <span className="ml-2 flex-1 truncate rounded-md bg-panel px-2.5 py-1 text-[11px] text-ink-faint">
            app.exemple.fr — Vue d'ensemble
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-500" />
            LIVE
          </span>
        </div>
        {/* corps */}
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-4">
            <div className="relative h-[68px] w-[68px] shrink-0">
              <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
                <circle cx="32" cy="32" r={R} fill="none" stroke="rgb(var(--c-line))" strokeWidth="6" />
                <circle
                  cx="32"
                  cy="32"
                  r={R}
                  fill="none"
                  stroke="#059669"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${pct * C} ${C}`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums text-ink">
                92
              </span>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Score de santé
              </div>
              <div className="mt-0.5 text-sm font-medium text-good">Bon · en amélioration</div>
              <div className="mt-1 text-xs text-ink-faint">12 480 sessions · 24 h</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {vitals.map((t) => (
              <div key={t.k} className="rounded-lg border border-line bg-panel2 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{t.k}</div>
                <div className={`mt-1 text-base font-bold tabular-nums ${toneClass[t.tone]}`}>{t.v}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-line bg-panel2 p-3">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              <span>Trafic · dernières 24 h</span>
              <span className="text-good">p75 stable</span>
            </div>
            <svg viewBox="0 0 320 64" className="h-14 w-full" preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f89101" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#f89101" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 46 L32 40 L64 44 L96 30 L128 34 L160 22 L192 28 L224 16 L256 24 L288 12 L320 18 L320 64 L0 64 Z"
                fill="url(#spark)"
              />
              <path
                d="M0 46 L32 40 L64 44 L96 30 L128 34 L160 22 L192 28 L224 16 L256 24 L288 12 L320 18"
                fill="none"
                stroke="#f89101"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Bouton de connexion réutilisé (nav + hero + CTA final). */
function LoginButton({ size = "md", testid }: { size?: "sm" | "md" | "lg"; testid?: string }) {
  const pad = size === "lg" ? "px-6 py-3 text-base" : size === "sm" ? "px-4 py-2 text-sm" : "px-5 py-2.5 text-sm";
  return (
    <Link href="/login" data-testid={testid} className={`btn-accent shrink-0 ${pad}`}>
      Se connecter →
    </Link>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen bg-app">
      {/* défilement doux vers les ancres, sans toucher au layout global */}
      <style>{"html{scroll-behavior:smooth}"}</style>

      {/* Barre de navigation sticky ------------------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-line bg-panel/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <Link href="/presentation" aria-label="MIP RUM — accueil">
            <BrandMark />
          </Link>
          <nav className="ml-6 hidden items-center gap-6 text-sm font-medium text-ink-soft md:flex">
            <a href="#valeur" className="transition hover:text-ink">Pourquoi</a>
            <a href="#fonctionnement" className="transition hover:text-ink">Fonctionnement</a>
            <a href="#indicateurs" className="transition hover:text-ink">Indicateurs</a>
            <a href="#mise-en-route" className="transition hover:text-ink">Mise en route</a>
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <LoginButton size="sm" testid="presentation-login-top" />
          </div>
        </div>
      </header>

      {/* Hero ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-8rem] h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-perf" />
              OpenTelemetry-natif · Souverain UE
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]">
              Voyez ce que vos utilisateurs{" "}
              <span className="text-accent">vivent vraiment</span>.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              MIP RUM mesure la performance et les erreurs réelles de vos visiteurs en production — pas une
              sonde de laboratoire. Un site rapide convertit mieux&nbsp;; le RUM le prouve, chiffres à l'appui.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LoginButton size="lg" testid="presentation-login" />
              <a
                href="#fonctionnement"
                className="rounded-lg border border-line bg-panel px-6 py-3 text-base font-semibold text-ink-soft transition hover:border-accent/40 hover:text-ink"
              >
                Voir comment ça marche
              </a>
            </div>
            <p className="mt-5 text-xs text-ink-faint">
              SDK ~12 ko gzip · aucune donnée identifiante · rétention RGPD (TTL 30 j)
            </p>
          </div>
          <div className="animate-fade-up lg:pl-6">
            <ConsolePreview />
          </div>
        </div>
      </section>

      {/* Bandeau stack ------------------------------------------------------- */}
      <section className="border-y border-line bg-panel/50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-5">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Bâti sur des standards ouverts
          </span>
          {STACK.map((s) => (
            <span
              key={s}
              className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-ink-soft"
            >
              {s}
            </span>
          ))}
        </div>
      </section>

      {/* Valeur -------------------------------------------------------------- */}
      <section id="valeur" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Le monitoring qui parle vrai
            </h2>
            <p className="mt-3 text-ink-soft">
              Trois partis pris qui changent la façon de piloter l'expérience.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {VALUES.map((v) => (
              <div key={v.title} className="card p-6 transition hover:shadow-pop">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-deep dark:text-accent">
                  <Icon paths={ICON_PATHS[v.icon]} className="h-5 w-5" strokeWidth={2} />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-ink">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fonctionnement (pipeline) ------------------------------------------ */}
      <section id="fonctionnement" className="scroll-mt-24 border-y border-line bg-panel/40">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-perf">
              Du navigateur à la décision
            </span>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Comment ça fonctionne
            </h2>
            <p className="mt-3 text-ink-soft">
              Cinq étapes, un flux continu : de la mesure chez le visiteur jusqu'aux agrégats lisibles.
            </p>
          </div>
          <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
            {PIPELINE.map((step, i) => (
              <li key={step.title} className="relative">
                <div className="flex h-full flex-col rounded-xl border border-line bg-panel p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-perf/10 text-perf">
                      <Icon paths={ICON_PATHS[step.icon]} className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <span className="text-2xl font-bold tabular-nums text-line">{i + 1}</span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-ink">
                    {step.title.replace(/^\d+\s·\s/, "")}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Indicateurs --------------------------------------------------------- */}
      <section id="indicateurs" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Ce que vous pilotez
            </h2>
            <p className="mt-3 text-ink-soft">
              Des mesures brutes aux décisions — du commercial à l'ingénieur, chacun sa lecture.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {INDICATORS.map((s) => (
              <div key={s.label} className="card flex gap-4 p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-deep dark:text-accent">
                  <Icon paths={ICON_PATHS[s.icon]} className="h-5 w-5" strokeWidth={2} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{s.label}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mise en route ------------------------------------------------------- */}
      <section id="mise-en-route" className="scroll-mt-24 border-y border-line bg-panel/40">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              En ligne en trois étapes
            </h2>
            <p className="mt-3 text-ink-soft">
              De la création de l'app au premier graphe — quelques minutes suffisent.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative rounded-xl border border-line bg-panel p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-base font-bold text-navy-950">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-base font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final ----------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Prêt à mesurer l'expérience réelle&nbsp;?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">
            Connectez-vous à la console et voyez, en direct, ce que vivent vos utilisateurs.
          </p>
          <div className="mt-8 flex justify-center">
            <LoginButton size="lg" />
          </div>
        </div>
      </section>

      {/* Pied de page -------------------------------------------------------- */}
      <footer className="border-t border-line bg-panel/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <BrandMark />
          <p className="text-xs text-ink-faint">
v0.3 — OpenTelemetry-natif · souverain UE
          </p>
          <Link
            href="/login"
            className="text-sm font-medium text-accent-deep underline-offset-2 hover:underline dark:text-accent"
          >
            Accéder à la console →
          </Link>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line px-6 py-4 text-xs text-ink-faint">
          <Link href="/legal/mentions" className="hover:text-ink">Mentions légales</Link>
          <Link href="/legal/cgu" className="hover:text-ink">CGU</Link>
          <Link href="/legal/cgv" className="hover:text-ink">CGV</Link>
          <Link href="/legal/confidentialite" className="hover:text-ink">Confidentialité</Link>
          <Link href="/legal/dpa" className="hover:text-ink">DPA</Link>
        </div>
      </footer>
    </div>
  );
}
