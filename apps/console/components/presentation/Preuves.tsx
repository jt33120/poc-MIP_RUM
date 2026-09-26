// Trois preuves visuelles de la présentation : trois détails de vraies captures de la
// console, lisibles, chacun avec ce qu'il montre en une phrase.
//
// POURQUOI DES RECADRAGES (recette du 26/09/2026). L'ancienne vitrine montrait une
// console entière réduite dans une colonne : un texte d'environ 5 px, qu'aucun
// lecteur ne pouvait lire. Ici, chaque figure ne garde qu'une zone de la capture
// 1440 × 900, affichée près de sa taille réelle sur un écran large. Le recadrage est
// fait en CSS sur l'image publiée (public/portail/), pas sur une copie retouchée :
// ce qu'on voit est la capture, et le manifeste qui la date reste vrai.
//
// Les zones sont en pixels de la capture ; si les captures sont reprises
// (scripts/captures-portail.mjs), il faut revoir les zones avec elles.
//
// La légende commune (LegendeCapture) date les captures par le manifeste, et seulement
// par lui ; elle dit que les chiffres viennent d'un jeu de démonstration.
import type { CSSProperties } from "react";
import Image from "next/image";
import { LegendeCapture } from "@/components/presentation/LegendeCapture";
import { dateDesCaptures, lireManifestePortail } from "@/lib/portail-manifeste";

/** Dimensions des captures publiées (manifeste : 1440 × 900). */
const LARGEUR = 1440;
const HAUTEUR = 900;

interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Preuve {
  id: string;
  titre: string;
  texte: string;
  /** Chemin publié de la capture claire (public/portail/). */
  clair: string;
  /** Variante sombre, quand la capture existe ; sinon la claire sert aux deux thèmes. */
  sombre: string | null;
  alt: string;
  zone: Zone;
}

const PREUVES: readonly Preuve[] = [
  {
    id: "marge",
    titre: "Chaque chiffre dit sa marge",
    texte:
      "Les Web Vitals sont donnés au 75e centile, avec leur intervalle de confiance et le nombre de mesures. Quand l'échantillon ne suffit pas, l'écran écrit « verdict non établi » au lieu d'inventer une note.",
    clair: "/portail/overview-light.png",
    sombre: "/portail/overview-dark.png",
    alt: "Trois tuiles de la vue d'ensemble : LCP, INP et CLS au 75e centile, chacune avec son intervalle à 95 %, sa médiane et son nombre de mesures.",
    zone: { x: 280, y: 664, w: 700, h: 236 },
  },
  {
    id: "impact",
    titre: "Chaque erreur dit qui elle touche",
    texte:
      "Occurrences, sessions et visiteurs touchés sont comptés à part, jamais additionnés. Depuis l'erreur, on ouvre la session, l'action, la trace et le rejeu où elle s'est produite.",
    clair: "/portail/issue-light.png",
    sombre: "/portail/issue-dark.png",
    alt: "La page d'une erreur : sept occurrences sur 24 heures, touchant sept sessions et sept visiteurs, en tuiles séparées.",
    zone: { x: 280, y: 740, w: 860, h: 160 },
  },
  {
    id: "non-collecte",
    titre: "Ce qui n'est pas mesuré est dit",
    texte:
      "Sans capteur natif, l'écran mobile écrit « Non collecté » pour les crashes et le démarrage natifs, plutôt qu'un zéro ou un taux sans crash qui ne reposerait sur rien.",
    clair: "/portail/mobile-light.png",
    sombre: null,
    alt: "L'écran Mobile : un bandeau « Non collecté » pour les crashes natifs, l'ANR et le démarrage natif, et des tuiles qui affichent un tiret plutôt qu'un zéro.",
    zone: { x: 280, y: 300, w: 860, h: 270 },
  },
];

/** Style de l'image dans son cadre : agrandie puis décalée pour ne montrer que la zone. */
function recadrage(z: Zone): CSSProperties {
  return {
    position: "absolute",
    maxWidth: "none",
    width: `${(LARGEUR / z.w) * 100}%`,
    height: "auto",
    left: `${(-z.x / z.w) * 100}%`,
    top: `${(-z.y / z.h) * 100}%`,
  };
}

function Figure({ p }: { p: Preuve }) {
  // L'image est plus large que son cadre (la zone n'en est qu'une partie) : on la
  // demande assez grande pour que le détail reste net.
  const sizes = `(min-width: 1024px) ${Math.round((LARGEUR / p.zone.w) * 46)}rem, ${Math.round((LARGEUR / p.zone.w) * 100)}vw`;
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card"
      style={{ aspectRatio: `${p.zone.w} / ${p.zone.h}` }}
    >
      <Image
        src={p.clair}
        alt={p.alt}
        width={LARGEUR}
        height={HAUTEUR}
        sizes={sizes}
        style={recadrage(p.zone)}
        className={p.sombre ? "dark:hidden" : ""}
      />
      {p.sombre && (
        <Image
          src={p.sombre}
          alt=""
          aria-hidden
          width={LARGEUR}
          height={HAUTEUR}
          sizes={sizes}
          style={recadrage(p.zone)}
          className="hidden dark:block"
        />
      )}
    </div>
  );
}

export function Preuves() {
  const manifeste = lireManifestePortail();
  // Le manifeste nomme les fichiers sans leur dossier.
  const fichiers = PREUVES.flatMap((p) => (p.sombre ? [p.clair, p.sombre] : [p.clair])).map((f) => f.replace("/portail/", ""));
  return (
    <section id="preuves" aria-labelledby="preuves-titre" className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <h2 id="preuves-titre" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Ce que la console montre
        </h2>
        <ul className="mt-8 space-y-10">
          {PREUVES.map((p) => (
            <li
              key={p.id}
              data-testid="preuve"
              className="grid gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:items-center lg:gap-10"
            >
              <div className="min-w-0">
                <h3 className="text-lg font-bold tracking-tight text-ink">{p.titre}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{p.texte}</p>
              </div>
              <div className="min-w-0">
                <Figure p={p} />
              </div>
            </li>
          ))}
        </ul>
        <LegendeCapture date={dateDesCaptures(manifeste, fichiers)} />
      </div>
    </section>
  );
}
