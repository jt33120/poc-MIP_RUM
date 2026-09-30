"use client";

// L'aperçu défilant de la vitrine : la console, écran après écran, pilotée par le
// défilement (DefilementEpingle). La scène est une console dessinée (SceneConsole),
// dont les éléments passent d'un écran à l'autre.
import { DefilementEpingle } from "@/components/presentation/vitrine/DefilementEpingle";
import { HAUTEUR_SCENE, LARGEUR_SCENE, SceneConsole } from "@/components/presentation/vitrine/SceneConsole";
import type { EtapeApercu } from "@/lib/vitrine";

export function ApercuDefilant({ etapes }: { etapes: readonly EtapeApercu[] }) {
  return (
    <DefilementEpingle
      etapes={etapes}
      id="apercu"
      testId="vitrine-apercu"
      surtitre="Aperçu"
      titre="La console, en mouvement."
      adresse="MIP RUM · boutique démo ·"
      legende="Illustration animée d'une boutique fictive, fidèle aux écrans de la console. La démo montre de vraies mesures."
      ratio={LARGEUR_SCENE / HAUTEUR_SCENE}
      scene={(e) => <SceneConsole vue={e.nom} />}
    />
  );
}
