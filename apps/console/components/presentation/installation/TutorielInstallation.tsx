"use client";

// Le tutoriel animé d'un parcours d'installation : la dynamique de l'aperçu de la
// vitrine (DefilementEpingle), sur la scène de la page Installer (SceneInstallation).
// Cinq étapes : ouvrir Installer, copier le prompt, laisser l'IA installer, vérifier,
// voir le résultat.
import {
  HAUTEUR_SCENE_INSTALLATION,
  LARGEUR_SCENE_INSTALLATION,
  SceneInstallation,
} from "@/components/presentation/installation/SceneInstallation";
import { DefilementEpingle } from "@/components/presentation/vitrine/DefilementEpingle";
import type { EtapeTutoriel } from "@/lib/installation-faits";
import type { Parcours } from "@/lib/installer";

export function TutorielInstallation({ parcours, etapes }: { parcours: Parcours; etapes: readonly EtapeTutoriel[] }) {
  return (
    <DefilementEpingle
      etapes={etapes}
      id="tutoriel"
      testId="tutoriel-installation"
      surtitre="Tutoriel"
      titre="Installé par votre IA, en cinq étapes."
      adresse="MIP RUM ·"
      legende="Illustration animée, fidèle aux écrans de la page Installer de la console."
      ratio={LARGEUR_SCENE_INSTALLATION / HAUTEUR_SCENE_INSTALLATION}
      scene={(e) => <SceneInstallation parcours={parcours} vue={e.nom} />}
    />
  );
}
