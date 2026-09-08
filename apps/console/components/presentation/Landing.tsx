// Site de présentation PUBLIC (visiteur non connecté) — volontairement MINIMAL :
// une seule vue, sans sections qui scrollent. La marque avec sa pastille POC, ce
// que fait l'outil en mots clés, la stack technique en mots clés, et une vraie
// capture du portail (pas une maquette). Rendu serveur ; seule la bascule de
// thème est un îlot client.
import Image from "next/image";
import Link from "next/link";
import { ICON_PATHS, Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";

// --- contenu : des mots clés, pas des paragraphes -----------------------------

/** Ce que l'outil mesure et restitue, du navigateur à la décision. */
const FONCTIONNEMENT = [
  "Snippet ~12 ko gzip",
  "Core Web Vitals p75 — LCP · INP · CLS",
  "Erreurs JS groupées par cause",
  "Sessions & parcours réels",
  "Tracing front → back",
  "Score de santé /100",
  "Anomalies sans seuil à régler",
  "Anonyme — aucune donnée identifiante",
];

/** La chaîne technique derrière, de la collecte au stockage. */
const STACK = [
  "SDK navigateur (Web Vitals · rrweb)",
  "OpenTelemetry · OTLP/HTTP",
  "Ingestion Deno / Node",
  "PostgreSQL → ClickHouse",
  "Next.js 15 · React 19",
  "Hébergé en UE · TTL 30 j",
];

/** Marque MIP RUM — pouls sur carré orange + wordmark. */
function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
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

/** Pastille « POC » — l'outil est une preuve de concept, pas un produit fini. */
function PocPill({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent-deep dark:text-accent ${className}`}
    >
      POC
    </span>
  );
}

/** Rangée de mots clés sous un intitulé court. */
function Keywords({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((k) => (
          <li
            key={k}
            className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-ink-soft"
          >
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-app">
      {/* Barre ------------------------------------------------------------- */}
      <header className="border-b border-line bg-panel/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/presentation" aria-label="MIP RUM — accueil">
            <BrandMark />
          </Link>
          {/* Doublon de la pastille du titre : masqué sous sm, où la barre
              déborderait — le H1 juste dessous la porte déjà. */}
          <PocPill className="hidden sm:inline-flex" />
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <Link href="/login" className="btn-accent shrink-0 px-4 py-2 text-sm">
              Se connecter →
            </Link>
          </div>
        </div>
      </header>

      {/* Une seule vue : mots clés à gauche, vraie capture à droite --------- */}
      <main className="flex-1 overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-14 lg:grid-cols-2 lg:gap-10 lg:py-20">
          <div className="animate-fade-up">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              MIP <span className="text-accent">RUM</span>
              <PocPill className="translate-y-1" />
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-soft">
              Le monitoring de l&apos;expérience réelle : la performance et les erreurs vécues par vos
              visiteurs en production, pas une sonde de laboratoire.
            </p>

            <div className="mt-10 flex flex-col gap-8">
              <Keywords label="Comment ça marche" items={FONCTIONNEMENT} />
              <Keywords label="Stack technique" items={STACK} />
            </div>

            <div className="mt-10">
              <Link
                href="/login"
                data-testid="presentation-login"
                className="btn-accent inline-block px-6 py-3 text-base"
              >
                Se connecter →
              </Link>
            </div>
          </div>

          {/* Capture réelle du portail (vue d'ensemble), une par thème.
              Le cadre déborde volontairement à droite sur grand écran — la
              section le rogne : l'écran donne l'échelle sans être réduit à une
              vignette illisible. */}
          <div className="animate-fade-up">
            <div className="overflow-hidden rounded-xl border border-line shadow-pop lg:min-w-[52rem]">
              <Image
                src="/portail/overview-light.png"
                alt="Le portail MIP RUM : score de santé, Core Web Vitals au p75, sessions et taux d'erreur."
                width={1600}
                height={660}
                priority
                className="block w-full dark:hidden"
              />
              <Image
                src="/portail/overview-dark.png"
                alt=""
                aria-hidden
                width={1600}
                height={660}
                className="hidden w-full dark:block"
              />
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              Capture réelle de la console — vue d&apos;ensemble.
            </p>
          </div>
        </div>
      </main>

      {/* Pied de page ------------------------------------------------------- */}
      <footer className="border-t border-line bg-panel/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 py-5 text-xs text-ink-faint">
          <span>MIP RUM — POC · OpenTelemetry-natif · souverain UE</span>
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
