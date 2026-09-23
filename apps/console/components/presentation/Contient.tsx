// Partie 1 de la vitrine — « Ce qu'il contient » (plan § 8.2, PS2 à PS6).
//
// OSSATURE (P**.2) : le titre et le chapeau, textes exacts du plan. Le contenu
// arrive avec P**.3, dans ce fichier : les capteurs (Capteurs.tsx, PS2), le chemin
// de la mesure (Topologie.tsx, PS3), l'hébergement et son droit (PS4), les écrans
// de la console (EcransConsole.tsx, PS5) et l'état de la chaîne (PS6).
//
// `user` est déjà là pour P**.3 : c'est la seule partie qui diffère pour un
// connecté (écrans cliquables, carrousel « Brancher une application » sous PS5).
// Landing le transmet ; la partie n'a donc pas à relire la session.
import { Partie } from "@/components/presentation/Partie";
import type { SessionUser } from "@/lib/auth";

export function Contient({ user: _user }: { user: SessionUser | null }) {
  return (
    <Partie
      id="contient"
      chapeau={
        <>
          Ce que le dépôt contient et ce qui tourne aujourd&apos;hui, pièce par pièce. Contenir
          n&apos;est pas savoir faire : les capacités et leurs limites sont dans la partie suivante.
        </>
      }
    />
  );
}
