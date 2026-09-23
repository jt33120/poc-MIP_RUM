// Deux écrans réels sous les cartes de capacité (plan § 8.3, V-B et V-C ; lot P**.7,
// branchés au passage final, une fois les images prises par scripts/captures-portail.mjs).
//
//   V-B — la page d'une issue (illustre K1) : impact, statut, triage en lecture seule.
//   V-C — l'écran Mobile (illustre K10 et PS8) : ce qui n'est pas collecté est dit
//          « Non collecté », jamais 0.
//
// Chaque légende porte la date de SES images, lue dans le manifeste des captures
// (lib/portail-manifeste.ts) ; sans manifeste, la figure n'est pas rendue du tout :
// une image non datée par le manifeste n'est pas une image de ce passage. Aucune
// légende ne commence par « Capture réelle de la console » : la recette TP8 en veut
// exactement une, celle de l'en-tête.
import Image from "next/image";
import { dateAffichee, dateDesCaptures, lireManifestePortail } from "@/lib/portail-manifeste";

const IMAGE = "rounded-xl border border-line shadow-card";

export function DeuxEcrans() {
  const manifeste = lireManifestePortail();
  const dateIssue = dateDesCaptures(manifeste, ["issue-light.png", "issue-dark.png"]);
  const dateMobile = dateDesCaptures(manifeste, ["mobile-light.png"]);
  if (!dateIssue && !dateMobile) return null;

  return (
    <div data-testid="deux-ecrans" className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
      {dateIssue && (
        <figure className="min-w-0">
          <Image
            src="/portail/issue-light.png"
            alt="La page d'une issue dans la console : son état, son triage en lecture seule, ses occurrences et les sessions et visiteurs touchés."
            width={1440}
            height={900}
            sizes="(min-width: 1024px) 36rem, 100vw"
            className={`${IMAGE} h-auto w-full dark:hidden`}
          />
          <Image
            src="/portail/issue-dark.png"
            alt=""
            aria-hidden
            width={1440}
            height={900}
            sizes="(min-width: 1024px) 36rem, 100vw"
            className={`${IMAGE} hidden h-auto w-full dark:block`}
          />
          <figcaption className="mt-3 text-xs text-ink-soft">
            Détail d&apos;une issue (K1), capture du <time dateTime={dateIssue}>{dateAffichee(dateIssue)}</time> sur le
            jeu de démonstration.
          </figcaption>
        </figure>
      )}
      {dateMobile && (
        <figure className="min-w-0">
          <Image
            src="/portail/mobile-light.png"
            alt="L'écran Mobile : crashes natifs, ANR et démarrage natif affichés « Non collecté », jamais 0."
            width={1440}
            height={900}
            sizes="(min-width: 1024px) 36rem, 100vw"
            className={`${IMAGE} h-auto w-full`}
          />
          <figcaption className="mt-3 text-xs text-ink-soft">
            Écran Mobile (K10), capture du <time dateTime={dateMobile}>{dateAffichee(dateMobile)}</time> sur le jeu de
            démonstration, sans session React Native.
          </figcaption>
        </figure>
      )}
    </div>
  );
}
