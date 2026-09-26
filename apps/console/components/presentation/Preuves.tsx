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
// DEUX RECADRAGES PAR PREUVE (contre-recette du 26/09/2026). À 390 px, la zone large
// (700 à 1 140 px de capture) tombait à l'échelle 0,4 : un texte de 5 px, illisible.
// Sous 640 px, chaque preuve montre donc sa ou ses tuiles les plus parlantes, une par
// cadre, près de leur taille réelle ; au-delà, la zone large. Un cadre n'agrandit
// jamais sa zone (`maxWidth` : sa largeur en pixels de capture) : une capture
// agrandie est floue. La zone large du mobile, un bandeau et quatre tuiles sur toute
// la largeur de l'écran, prend toute la largeur de la section, texte au-dessus.
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

/** Un recadrage et ce qu'il montre (l'alt de son image). */
interface Recadrage {
  zone: Zone;
  alt: string;
}

interface Preuve {
  id: string;
  titre: string;
  texte: string;
  /** Chemin publié de la capture claire (public/portail/). */
  clair: string;
  /** Variante sombre, quand la capture existe ; sinon la claire sert aux deux thèmes. */
  sombre: string | null;
  /** À partir de 640 px. */
  large: Recadrage;
  /** Sous 640 px : un cadre par zone, empilés. */
  etroits: readonly Recadrage[];
  /** La zone large occupe toute la largeur de la section, texte au-dessus. */
  pleineLargeur?: boolean;
}

const PREUVES: readonly Preuve[] = [
  {
    id: "marge",
    titre: "Chaque chiffre dit sa marge",
    texte:
      "Les Web Vitals sont donnés au 75e centile, avec leur intervalle de confiance et le nombre de mesures. Quand l'échantillon ne permet pas de trancher, l'écran l'écrit au lieu d'inventer une note.",
    clair: "/portail/overview-light.png",
    sombre: "/portail/overview-dark.png",
    large: {
      zone: { x: 280, y: 111, w: 684, h: 211 },
      alt: "Trois tuiles de la vue d'ensemble : LCP, INP et CLS au 75e centile, chacune avec son intervalle à 95 % et son nombre de mesures ; l'INP porte « verdict incertain : entre Bon et À améliorer ».",
    },
    etroits: [
      {
        zone: { x: 506, y: 111, w: 230, h: 211 },
        alt: "La tuile INP au 75e centile : « verdict incertain : entre Bon et À améliorer », son intervalle à 95 % et son nombre de mesures.",
      },
    ],
  },
  {
    id: "impact",
    titre: "Chaque erreur dit qui elle touche",
    texte:
      "Occurrences, sessions et visiteurs touchés sont comptés à part, jamais additionnés. Depuis l'erreur, on ouvre la session, l'action, la trace et le rejeu où elle s'est produite.",
    clair: "/portail/issue-light.png",
    sombre: "/portail/issue-dark.png",
    large: {
      zone: { x: 280, y: 111, w: 853, h: 174 },
      alt: "La page d'un groupe d'erreurs : 75 occurrences sur 24 heures, touchant 65 sessions et 63 visiteurs, dites dans une phrase puis en tuiles séparées.",
    },
    etroits: [
      { zone: { x: 280, y: 146, w: 287, h: 139 }, alt: "Tuile « Occurrences · 24 h » : 75, une erreur répétée comptant chaque fois." },
      { zone: { x: 563, y: 146, w: 287, h: 139 }, alt: "Tuile « Sessions touchées » : 65." },
      { zone: { x: 846, y: 146, w: 287, h: 139 }, alt: "Tuile « Visiteurs touchés » : 63." },
    ],
  },
  {
    id: "non-collecte",
    titre: "Ce qui n'est pas mesuré est dit",
    texte:
      "Sans capteur natif, l'écran mobile écrit « Non collecté » pour les crashes et le démarrage natifs, plutôt qu'un zéro ou un taux sans crash qui ne reposerait sur rien.",
    clair: "/portail/mobile-light.png",
    sombre: "/portail/mobile-dark.png",
    large: {
      zone: { x: 280, y: 342, w: 1136, h: 324 },
      alt: "L'écran Mobile : un bandeau « Non collecté » pour les crashes natifs, l'ANR et le démarrage natif, puis quatre tuiles ; celle des sessions sans erreur précise qu'elle ne compte que les erreurs JavaScript.",
    },
    etroits: [
      {
        zone: { x: 1132, y: 455, w: 284, h: 211 },
        alt: "Tuile « Sessions sans erreur JS » : son intervalle à 95 %, et « Erreurs JavaScript seulement : les crashes natifs ne sont pas collectés, ce taux n'en dit rien ».",
      },
    ],
    pleineLargeur: true,
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

/**
 * Un cadre : la zone d'une capture, jamais agrandie. `largeurRem` : la largeur que le
 * cadre peut prendre, pour que le navigateur demande une image assez grande.
 */
function Cadre({ p, r, largeurRem, cache }: { p: Preuve; r: Recadrage; largeurRem: number; cache?: boolean }) {
  const z = r.zone;
  const sizes = `${Math.round((LARGEUR / z.w) * Math.min(largeurRem, z.w / 16))}rem`;
  return (
    <div
      className="relative mx-auto w-full overflow-hidden rounded-xl border border-line bg-panel shadow-card"
      style={{ aspectRatio: `${z.w} / ${z.h}`, maxWidth: `${z.w}px` }}
      data-testid="preuve-cadre"
    >
      <Image
        src={p.clair}
        alt={cache ? "" : r.alt}
        aria-hidden={cache || undefined}
        width={LARGEUR}
        height={HAUTEUR}
        sizes={sizes}
        style={recadrage(z)}
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
          style={recadrage(z)}
          className="hidden dark:block"
        />
      )}
    </div>
  );
}

function Figure({ p }: { p: Preuve }) {
  return (
    <>
      {/* Sous 640 px : les tuiles les plus parlantes, une par cadre. */}
      <div className="flex flex-col gap-3 sm:hidden" data-testid="preuve-etroite">
        {p.etroits.map((r) => (
          <Cadre key={`${r.zone.x}-${r.zone.y}`} p={p} r={r} largeurRem={24} />
        ))}
      </div>
      <div className="hidden sm:block" data-testid="preuve-large">
        <Cadre p={p} r={p.large} largeurRem={p.pleineLargeur ? 70 : 50} />
      </div>
    </>
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
              className={`grid gap-5 ${p.pleineLargeur ? "" : "lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:items-center lg:gap-10"}`}
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
