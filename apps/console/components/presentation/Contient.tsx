// Partie 1 de la vitrine — « Ce qu'il contient » (plan § 8.2, PS2 à PS6 ; lot P**.3).
//
// Ce que le dépôt contient et ce qui tourne, pièce par pièce, en blocs `h3` sous le
// `h2` de la partie. Premier bloc : les capteurs (Capteurs.tsx, PS2).
//
// `user` est là pour la suite du lot : c'est la seule partie qui diffère pour un
// connecté (écrans cliquables, carrousel « Brancher une application » sous PS5).
// Landing le transmet ; la partie n'a donc pas à relire la session.
import { Capteurs } from "@/components/presentation/Capteurs";
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
    >
      <div className="mt-12 space-y-16">
        <Capteurs />
      </div>
    </Partie>
  );
}
