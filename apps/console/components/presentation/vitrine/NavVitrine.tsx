"use client";

// La barre de navigation des pages publiques (30/09/2026), à la façon de basedb : la
// marque à gauche, le menu en trois entrées CENTRÉ (lib/vitrine-navigation.ts), et à
// droite le dépôt GitHub, la connexion, puis la démo en orange — l'action qu'on veut
// voir prise. Connecté : « Ouvrir la console » remplace les deux dernières.
//
// Sur la vitrine, elle flotte au-dessus du film, transparente (`surFilm`), et ne
// prend son fond qu'une fois le film dépassé de quelques pixels : le premier écran
// reste une image pleine. Sur les autres pages, elle a son fond dès le départ.
//
// Le sous-menu d'Installation s'ouvre au survol ET au clic (un écran tactile n'a pas
// de survol), se ferme sur Échap ou un clic ailleurs. Sous `md`, un bouton ouvre un
// panneau qui déplie tout, sous-pages comprises. La grille à trois colonnes
// (1fr auto 1fr) centre le menu sur la page, quelle que soit la largeur des côtés.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/presentation/Cadre";
import { LIBELLE_PARCOURS, PARCOURS } from "@/lib/installer";
import { CHEMIN_A_FAIRE, CHEMIN_GRAPHE, CHEMIN_INSTALLATION, DEPOT_GITHUB, cheminParcours } from "@/lib/vitrine-navigation";

const SOUS_TITRE: Record<(typeof PARCOURS)[number], string> = {
  snippet: "Deux balises dans les pages : tous les visiteurs",
  extension: "Sur les postes équipés, sans toucher au site",
  serveur: "L'agent OpenTelemetry officiel, côté serveur",
};

/** Le logo GitHub (marque officielle, tracé unique). */
function LogoGithub({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const BOUTON =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f89101] focus-visible:ring-offset-2 focus-visible:ring-offset-[#040a1c]";
const BOUTON_CONTOUR = `${BOUTON} border border-white/20 text-white hover:border-white/45 hover:bg-white/[0.06]`;
const BOUTON_ORANGE = `${BOUTON} bg-gradient-to-br from-[#fca62b] to-[#f89101] text-[#040a1c] shadow-[0_8px_24px_-8px_rgba(248,145,1,0.8)] hover:brightness-110`;

const LIEN =
  "rounded-lg px-3 py-2 text-sm font-medium transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f89101]";

function actif(chemin: string, courant: string) {
  return courant === chemin || courant.startsWith(`${chemin}/`);
}

export function NavVitrine({
  connecte,
  demoOuverte,
  surFilm = false,
}: {
  connecte: boolean;
  demoOuverte: boolean;
  surFilm?: boolean;
}) {
  const courant = usePathname() ?? "";
  const [defile, setDefile] = useState(!surFilm);
  const [sousMenu, setSousMenu] = useState(false);
  const [panneau, setPanneau] = useState(false);
  const installation = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!surFilm) return;
    const suivre = () => setDefile(window.scrollY > 24);
    suivre();
    window.addEventListener("scroll", suivre, { passive: true });
    return () => window.removeEventListener("scroll", suivre);
  }, [surFilm]);

  useEffect(() => {
    if (!sousMenu && !panneau) return;
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSousMenu(false);
        setPanneau(false);
      }
    };
    const ailleurs = (e: PointerEvent) => {
      if (installation.current && !installation.current.contains(e.target as Node)) setSousMenu(false);
    };
    document.addEventListener("keydown", echap);
    document.addEventListener("pointerdown", ailleurs);
    return () => {
      document.removeEventListener("keydown", echap);
      document.removeEventListener("pointerdown", ailleurs);
    };
  }, [sousMenu, panneau]);

  const ton = (chemin: string) => (actif(chemin, courant) ? "text-white" : "text-white/70");
  // <a> vers la console et la démo : la vitrine est rendue sans la coquille de la
  // console, qu'une navigation client ne remonterait pas (voir Entrees.tsx).
  const actions = connecte
    ? [{ href: "/", libelle: "Ouvrir la console", testId: "nav-console", ton: BOUTON_ORANGE }]
    : [
        { href: "/login", libelle: "Se connecter", testId: "nav-connexion", ton: BOUTON_CONTOUR },
        ...(demoOuverte ? [{ href: "/login?demo=1", libelle: "Démo", testId: "nav-demo", ton: BOUTON_ORANGE }] : []),
      ];

  return (
    <header
      data-testid="nav-vitrine"
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        defile || panneau ? "border-b border-white/10 bg-[#040a1c]/85 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <nav
        aria-label="Menu principal"
        className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:grid lg:grid-cols-[1fr_auto_1fr]"
      >
        <Link href="/presentation" aria-label="MIP RUM — accueil" className="shrink-0 justify-self-start">
          <BrandMark />
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          <li
            ref={installation}
            className="relative"
            onMouseEnter={() => setSousMenu(true)}
            onMouseLeave={() => setSousMenu(false)}
          >
            <div className="flex items-center">
              <Link href={CHEMIN_INSTALLATION} className={`${LIEN} pr-1 ${ton(CHEMIN_INSTALLATION)}`}>
                Installation
              </Link>
              <button
                type="button"
                aria-expanded={sousMenu}
                aria-controls="nav-sous-installation"
                aria-label="Les trois parcours d'installation"
                onClick={() => setSousMenu((o) => !o)}
                className="grid h-8 w-6 place-items-center rounded-md text-white/70 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f89101]"
              >
                <svg aria-hidden viewBox="0 0 24 24" className={`h-4 w-4 transition ${sousMenu ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>
            {/* Le pont transparent (pt-2) garde le survol entre l'entrée et le panneau. */}
            <div
              id="nav-sous-installation"
              hidden={!sousMenu}
              className="absolute left-0 top-full w-80 pt-2"
            >
              <ul className="overflow-hidden rounded-2xl border border-white/10 bg-[#07122e]/95 p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-md">
                {PARCOURS.map((p) => (
                  <li key={p}>
                    <Link
                      href={cheminParcours(p)}
                      onClick={() => setSousMenu(false)}
                      data-testid={`nav-parcours-${p}`}
                      className={`block rounded-xl px-3 py-2.5 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f89101] ${
                        courant === cheminParcours(p) ? "bg-white/[0.06]" : ""
                      }`}
                    >
                      <span className="block text-sm font-semibold text-white">{LIBELLE_PARCOURS[p]}</span>
                      <span className="mt-0.5 block text-xs text-white/60">{SOUS_TITRE[p]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </li>
          <li>
            <Link href={CHEMIN_A_FAIRE} className={`${LIEN} ${ton(CHEMIN_A_FAIRE)}`}>
              À faire
            </Link>
          </li>
          <li>
            <Link href={CHEMIN_GRAPHE} className={`${LIEN} ${ton(CHEMIN_GRAPHE)}`}>
              Graphe technique
            </Link>
          </li>
        </ul>

        <div className="ml-auto flex items-center gap-2 justify-self-end">
          <a
            href={DEPOT_GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Le code sur GitHub"
            data-testid="nav-github"
            className={`${BOUTON_CONTOUR} hidden px-3 sm:inline-flex xl:px-4`}
          >
            <LogoGithub className="h-[18px] w-[18px]" />
            <span className="hidden xl:inline">GitHub</span>
          </a>
          {actions.map((a) => (
            <a key={a.testId} href={a.href} data-testid={a.testId} className={`${a.ton} hidden sm:inline-flex`}>
              {a.libelle}
            </a>
          ))}
          <button
            type="button"
            aria-expanded={panneau}
            aria-controls="nav-panneau"
            aria-label={panneau ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setPanneau((o) => !o)}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/20 text-white lg:hidden"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {panneau ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      <div id="nav-panneau" hidden={!panneau} className="border-t border-white/10 px-4 pb-5 pt-3 lg:hidden">
        <ul className="grid gap-1 text-white">
          <li>
            <Link href={CHEMIN_INSTALLATION} onClick={() => setPanneau(false)} className="block rounded-lg px-3 py-2 font-semibold">
              Installation
            </Link>
            <ul className="ml-3 grid gap-0.5 border-l border-white/10 pl-3">
              {PARCOURS.map((p) => (
                <li key={p}>
                  <Link href={cheminParcours(p)} onClick={() => setPanneau(false)} className="block rounded-lg px-3 py-1.5 text-sm text-white/75">
                    {LIBELLE_PARCOURS[p]}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
          <li>
            <Link href={CHEMIN_A_FAIRE} onClick={() => setPanneau(false)} className="block rounded-lg px-3 py-2 font-semibold">
              À faire
            </Link>
          </li>
          <li>
            <Link href={CHEMIN_GRAPHE} onClick={() => setPanneau(false)} className="block rounded-lg px-3 py-2 font-semibold">
              Graphe technique
            </Link>
          </li>
          <li className="mt-3 flex flex-wrap gap-2 sm:hidden">
            <a href={DEPOT_GITHUB} target="_blank" rel="noopener noreferrer" className={BOUTON_CONTOUR}>
              <LogoGithub className="h-[18px] w-[18px]" />
              GitHub
            </a>
            {actions.map((a) => (
              <a key={a.testId} href={a.href} className={a.ton}>
                {a.libelle}
              </a>
            ))}
          </li>
        </ul>
      </div>
    </header>
  );
}
