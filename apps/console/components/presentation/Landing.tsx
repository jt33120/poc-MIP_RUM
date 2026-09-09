// Site de présentation PUBLIC (visiteur non connecté) — volontairement MINIMAL :
// une seule vue, sans sections qui scrollent. La marque MIP RUM avec son label
// POC apposé, ce que fait l'outil en mots clés, la stack technique en mots clés,
// et une vraie capture du portail (pas une maquette). Fond bleu texturé « papier
// millimétré » : la texture vit dans le CSS ci-dessous, déclinée clair/sombre.
// Rendu serveur ; seule la bascule de thème est un îlot client.
// Le fond texturé vit dans globals.css (.mip-sci), pas ici : /select et
// /select/new le réutilisent, et importer ce module pour une chaîne CSS y
// tirerait toute la vitrine dans leur bundle.
import Image from "next/image";
import Link from "next/link";
import { Capteurs } from "@/components/presentation/Capteurs";
import { Demo } from "@/components/presentation/Demo";
import { Specs } from "@/components/presentation/Specs";
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
  // « Deno » décrivait les edge functions Supabase, mortes avec leur projet en
  // août 2026 : plus rien ne tourne sur Deno. Et l'ingestion n'est plus une route
  // de la console : c'est un service Node autonome (services/ingest), déployé sur
  // Railway. Les routes Next subsistent le temps de la bascule et appellent le
  // MÊME code — dire « routes Next.js » décrirait le montage, pas le produit.
  "Backend Node autonome — Railway",
  // Ce qui TOURNE, pas la cible : ClickHouse a son schéma et son bench, mais
  // n'est branché nulle part, et la purge à 30 jours n'est jamais déclenchée
  // faute de planificateur authentifié. Les deux sont dits dans « Specs /
  // Capacité technique », onglet « Écart au marché » ; les annoncer ici comme
  // acquis contredirait ce tableau.
  "PostgreSQL",
  "Next.js 15 · React 19",
  // « Hébergé en UE » tout court était trop large : c'est la BASE qui est à
  // Francfort. Le détail par fournisseur — base, console, backend — est dans
  // « Specs / Capacité technique », onglet « Infrastructure ».
  "Base de données en UE — Francfort",
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

/** Label « POC » — une étiquette apposée sur le produit, pas un badge de marque :
 *  légèrement de travers, bord pointillé, comme collée là en attendant. */
function PocLabel({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex -rotate-[5deg] items-center rounded-md border border-dashed border-accent/70 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-accent-deep shadow-sm dark:bg-accent/15 dark:text-accent ${className}`}
    >
      POC
    </span>
  );
}

/** Bouton principal — dégradé orange, la seule surface pleine de la page. */
function LoginButton({ size = "md" }: { size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-4 py-2 text-sm" : "px-6 py-3 text-base";
  return (
    <Link
      href="/login"
      data-testid={size === "sm" ? "presentation-login-top" : "presentation-login"}
      className={`inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-accent via-[#fca62b] to-accent-deep font-semibold text-navy-950 shadow-[0_8px_22px_-10px_rgba(248,145,1,0.9)] transition hover:brightness-110 hover:shadow-[0_10px_26px_-8px_rgba(248,145,1,0.95)] ${pad}`}
    >
      Se connecter <span aria-hidden>→</span>
    </Link>
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
            className="rounded-full border border-line bg-panel/70 px-3 py-1 text-xs font-medium text-ink-soft backdrop-blur-sm"
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
    <div className="mip-sci flex min-h-screen flex-col">
      {/* Barre ------------------------------------------------------------- */}
      <header className="border-b border-line bg-panel/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/presentation" aria-label="MIP RUM — accueil">
            <BrandMark />
          </Link>
          {/* Doublon du label du titre : masqué sous sm, où la barre déborderait
              — le H1 juste dessous le porte déjà. */}
          <PocLabel className="hidden sm:inline-flex" />
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <LoginButton size="sm" />
          </div>
        </div>
      </header>

      {/* Une seule vue : mots clés à gauche, vraie capture à droite --------- */}
      <main className="flex-1">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-14 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:py-20">
          <div className="animate-fade-up">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              MIP <span className="text-accent">RUM</span>
              <PocLabel className="translate-y-1" />
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-soft">
              Le monitoring de l&apos;expérience réelle : la performance et les erreurs vécues par vos
              visiteurs en production, pas une sonde de laboratoire.
            </p>

            <div className="mt-10 flex flex-col gap-8">
              <Keywords label="Comment ça marche" items={FONCTIONNEMENT} />
              <Keywords label="Stack technique" items={STACK} />
            </div>

            <div className="mt-10">
              <LoginButton />
            </div>
          </div>

          {/* Capture réelle du portail (vue d'ensemble), une par thème.
              Le cadre reste DANS sa colonne — le ratio 8/5 fait que le cadrage
              s'arrête toujours à 1056 px de la capture, pile dans la gouttière
              après la carte CLS, quelle que soit la largeur rendue. */}
          <div className="animate-fade-up">
            <div className="relative aspect-[8/5] overflow-hidden rounded-xl border border-line shadow-pop">
              <Image
                src="/portail/overview-light.png"
                alt="Le portail MIP RUM : score de santé, Core Web Vitals au p75, sessions et taux d'erreur."
                fill
                sizes="(min-width: 1024px) 40rem, 100vw"
                priority
                className="object-cover object-left-top dark:hidden"
              />
              <Image
                src="/portail/overview-dark.png"
                alt=""
                aria-hidden
                fill
                sizes="(min-width: 1024px) 40rem, 100vw"
                className="hidden object-cover object-left-top dark:block"
              />
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              Capture réelle de la console. Les chiffres affichés viennent d&apos;un jeu de
              démonstration, pas d&apos;un client en production.
            </p>
          </div>
        </div>

        <Capteurs />
        <Demo />
        <Specs />
      </main>

      {/* Pied de page ------------------------------------------------------- */}
      <footer className="border-t border-line bg-panel/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 py-5 text-xs text-ink-faint">
          <span>MIP RUM — POC · OpenTelemetry-natif · données en UE, souveraineté visée</span>
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
