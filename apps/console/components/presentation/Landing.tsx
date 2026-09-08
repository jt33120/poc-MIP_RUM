// Site de présentation PUBLIC (visiteur non connecté) — volontairement MINIMAL :
// une seule vue, sans sections qui scrollent. La marque MIP RUM avec son label
// POC apposé, ce que fait l'outil en mots clés, la stack technique en mots clés,
// et une vraie capture du portail (pas une maquette). Fond bleu texturé « papier
// millimétré » : la texture vit dans le CSS ci-dessous, déclinée clair/sombre.
// Rendu serveur ; seule la bascule de thème est un îlot client.
import Image from "next/image";
import Link from "next/link";
import { Capteurs } from "@/components/presentation/Capteurs";
import { Demo } from "@/components/presentation/Demo";
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

// Fond « papier millimétré » : deux halos doux + une grille 32 px. Sobre —
// alphas faibles, aucune couleur saturée. Déclinée par thème parce que la même
// grille doit rester visible sur fond pâle comme sur navy profond.
const TEXTURE = `
.mip-sci {
  background-color: rgb(var(--c-app));
  background-image:
    radial-gradient(900px 420px at 12% -15%, rgba(37, 99, 235, 0.10), transparent 70%),
    radial-gradient(760px 380px at 92% 115%, rgba(0, 51, 153, 0.08), transparent 70%),
    linear-gradient(rgba(37, 99, 235, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(37, 99, 235, 0.055) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px;
}
.dark .mip-sci {
  background-color: #060d24;
  background-image:
    radial-gradient(900px 420px at 12% -15%, rgba(59, 110, 235, 0.22), transparent 70%),
    radial-gradient(760px 380px at 92% 115%, rgba(248, 145, 1, 0.07), transparent 70%),
    linear-gradient(rgba(137, 173, 255, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(137, 173, 255, 0.07) 1px, transparent 1px);
}

/* Bande claire : la section garde la palette du thème CLAIR même quand le
   reste de la page est en sombre, pour alterner les fonds le long de la page.
   Redéfinir les variables suffit — chaque classe Tailwind à l'intérieur
   (bg-panel, text-ink, border-line…) les relit, aucune classe à toucher. */
.mip-bande-claire {
  --c-app: 249 250 251;
  --c-panel: 255 255 255;
  --c-panel2: 246 248 250;
  --c-line: 228 232 238;
  --c-ink: 17 24 39;
  --c-ink-soft: 82 95 117;
  --c-ink-faint: 143 154 172;
  --c-brand: 37 99 235;
  --c-brand-strong: 29 78 216;
  color-scheme: light;
  background-color: #ffffff;
}

/* Flèches du chemin de la mesure : une dérive lente qui donne le sens de
   lecture sans attirer l'œil. Décalée par étape (animationDelay en ligne). */
@keyframes mip-derive {
  0%, 100% { transform: translateX(0); opacity: 0.55; }
  50%      { transform: translateX(2px); opacity: 1; }
}
.mip-fleche { animation: mip-derive 2.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .mip-fleche { animation: none; opacity: 0.8; }
}
`;

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
      <style>{TEXTURE}</style>

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
              Capture réelle de la console — vue d&apos;ensemble.
            </p>
          </div>
        </div>

        <Capteurs />
        <Demo />
      </main>

      {/* Pied de page ------------------------------------------------------- */}
      <footer className="border-t border-line bg-panel/60 backdrop-blur-md">
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
