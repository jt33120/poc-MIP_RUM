// Partie 1 de la vitrine — « Ce qu'il contient » (plan § 8.2, PS2 à PS6 ; lot P**.3).
//
// Ce que le dépôt contient et ce qui tourne, pièce par pièce, en blocs `h3` sous le
// `h2` de la partie : les capteurs (Capteurs.tsx, PS2), le chemin de la mesure
// (Topologie.tsx, PS3), l'hébergement et son droit (PS4, ici).
//
// `user` est là pour la suite du lot : c'est la seule partie qui diffère pour un
// connecté (écrans cliquables, carrousel « Brancher une application » sous PS5).
// Landing le transmet ; la partie n'a donc pas à relire la session.
import { Capteurs } from "@/components/presentation/Capteurs";
import { Partie } from "@/components/presentation/Partie";
import { SousPartie } from "@/components/presentation/SousPartie";
import { Topologie } from "@/components/presentation/Topologie";
import type { SessionUser } from "@/lib/auth";
import { HEBERGEMENT } from "@/lib/presentation-topologie";

const CELLULE = "px-2 py-2.5 align-top sm:px-4";

/**
 * PS4 — Où sont les données, et sous quel droit. Société, région et lieu sont LUS
 * dans lib/legal.ts (lib/presentation-topologie.ts), comme les Specs : jamais
 * retapés. La phrase sous la table est le texte exact du plan : la seule phrase sur
 * la souveraineté que le test de lexique admet (couverture-site, n° 5).
 * Sources : lib/specs.ts (ligne « Souveraineté ») ; RUM_PARITY_STATUS.md:326-328.
 */
function Hebergement() {
  return (
    <SousPartie id="contient-hebergement" titre="Où sont les données, et sous quel droit">
      {/* `relative` : un conteneur défilant ne laisse rien de positionné s'échapper
          vers la page (§ 3.9, table à 390 px). */}
      <div className="card relative mt-6 overflow-x-auto">
        <table aria-labelledby="contient-hebergement-titre" className="w-full text-left text-[13px] sm:text-sm" data-testid="hebergement">
          <thead className="border-b border-line bg-panel2/60">
            <tr>
              {["Pièce", "Hébergeur", "Région", "Droit de l'hébergeur"].map((c) => (
                <th key={c} scope="col" className={`${CELLULE} text-[11px] font-semibold uppercase tracking-wider text-ink-soft`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEBERGEMENT.map((l) => (
              <tr key={l.piece} className="border-b border-line/60 last:border-0">
                <th scope="row" className={`${CELLULE} font-medium text-ink`}>
                  {l.piece}
                </th>
                <td className={`${CELLULE} text-ink-soft`}>{l.hebergeur}</td>
                <td className={`${CELLULE} text-ink-soft`}>{l.lieu}</td>
                <td className={`${CELLULE} text-ink-soft`}>{l.droit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-soft" data-testid="hebergement-droit">
        La donnée et le calcul sont en Union européenne ; les trois hébergeurs relèvent d&apos;un droit
        tiers. Ce POC n&apos;est pas une offre souveraine. Aucune adresse IP n&apos;est stockée, sous
        aucune forme.
      </p>
    </SousPartie>
  );
}

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
        <Topologie />
        <Hebergement />
      </div>
    </Partie>
  );
}
