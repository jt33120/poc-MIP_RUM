// Partie 2 de la vitrine — « Ce qu'il sait faire » (plan § 8.2, PS7 à PS9 ; lot P**.4).
//
// Dans l'ordre : la barre de couverture (CouvertureBarre.tsx), les cartes de
// capacité (PS7, données dans lib/presentation-sait-faire.ts), une façon de compter
// (PS8, bloc « Méthode ») et la place de ce POC face à un outil du marché
// (Positionnement.tsx, PS9).
//
// RÈGLE DE LA PARTIE (§ 8.0) : n'y figurent que des lignes du document de
// couverture au verdict « déployé, non éprouvé », chacune avec sa limite ; les
// lignes déployées mais inertes vont dans « Ce qui reste ». Le chapeau le dit au
// lecteur, et tests/unit/couverture-site.test.ts le vérifie sur les cartes.
//
// UNE CARTE : son verdict, écrit une fois en tête et LU dans le document
// (verdictCarte), son titre, ce qu'elle fait, puis « Limites : » et une puce par
// identifiant, sa pastille en tête. Rien n'est replié derrière un « voir plus » :
// une réserve cachée derrière un clic est une réserve cachée. Grille d'une colonne
// à 390 px, deux à 768, trois à 1440.
import { Fragment, type ReactNode } from "react";
import { CouvertureBarre, couleurVerdict } from "@/components/presentation/CouvertureBarre";
import { Partie } from "@/components/presentation/Partie";
import { Positionnement } from "@/components/presentation/Positionnement";
import { VERDICT_LABEL } from "@/lib/couverture";
import { POINTS_RESTE } from "@/lib/presentation-reste";
import { CARTES, METHODE, verdictCarte, type CarteCapacite } from "@/lib/presentation-sait-faire";

/** Identifiant du titre d'une carte : le nom accessible de son `<article>`. */
const idCarte = (id: string) => `capacite-${id}`;

/**
 * L'ancre du titre d'un point de « Ce qui reste » (Reste.tsx). La partie 3 n'écrit
 * pas l'identifiant « R3 » (son rang affiché est « 03 ») : un renvoi « (voir R3) »
 * d'une limite est donc un lien vers ce titre, qui porte au survol le titre du
 * point. tests/unit/SaitFaire.test.tsx vérifie que chaque ancre visée existe dans
 * le rendu de Reste.
 */
export const ancreDuPoint = (id: string) => `reste-${id}-titre`;

/** Le texte d'une limite, ses renvois « (voir R…) » rendus en liens ; un point inconnu reste du texte. */
function avecRenvois(texte: string): ReactNode {
  const morceaux = texte.split(/\(voir (R\d+)\)/);
  if (morceaux.length === 1) return texte;
  return morceaux.map((m, i) => {
    if (i % 2 === 0) return m;
    const point = POINTS_RESTE.find((p) => p.id === m);
    return (
      <Fragment key={i}>
        (voir{" "}
        {point ? (
          <a
            href={`#${ancreDuPoint(m)}`}
            title={`Ce qui reste : ${point.titre}`}
            className="rounded-sm font-semibold text-ink underline decoration-line underline-offset-2 transition hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
          >
            {m}
          </a>
        ) : (
          m
        )}
        )
      </Fragment>
    );
  });
}

function Carte({ carte }: { carte: CarteCapacite }) {
  const verdict = verdictCarte(carte);
  return (
    <article
      data-testid="capacite"
      data-carte={carte.id}
      data-verdict={verdict ?? "inconnu"}
      aria-labelledby={idCarte(carte.id)}
      className="flex min-w-0 flex-col rounded-2xl border border-line bg-panel/80 p-5 shadow-card"
    >
      <p data-testid="capacite-verdict" className="flex items-center gap-2 text-xs font-medium text-ink-soft">
        {verdict && (
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: couleurVerdict(verdict) }}
          />
        )}
        {verdict ? VERDICT_LABEL[verdict] : "Verdict inconnu"}
      </p>
      <h4 id={idCarte(carte.id)} className="mt-2 text-base font-bold leading-snug tracking-tight text-ink">
        {carte.titre}
      </h4>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{carte.faitQuoi}</p>
      <p className="mt-4 text-sm font-semibold text-ink">Limites :</p>
      <ul className="mt-2 space-y-2.5">
        {carte.limites.map((l) => (
          <li
            key={l.id}
            data-testid="capacite-limite"
            data-id={l.id}
            className="flex min-w-0 gap-2.5 text-sm leading-relaxed text-ink-soft"
          >
            <span className="mt-0.5 h-fit shrink-0 rounded-md bg-app px-1.5 py-px font-mono text-xs font-semibold text-ink ring-1 ring-line">
              {l.id}
            </span>
            <span className="min-w-0">{avecRenvois(l.texte)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** PS8 — quatre règles de comptage, textes exacts du plan. */
function Methode() {
  return (
    <div data-testid="methode" className="mt-14">
      <h3 className="text-xl font-bold tracking-tight text-ink">Une façon de compter</h3>
      <ul className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {METHODE.map((e) => (
          <li
            key={e.titre}
            className="min-w-0 rounded-xl border border-line bg-panel/70 p-4 text-sm leading-relaxed text-ink-soft"
          >
            <strong className="font-semibold text-ink">{e.titre}</strong> {e.texte}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SaitFaire() {
  return (
    <Partie
      id="sait-faire"
      chapeau={
        <>
          Ne figurent ici que les capacités que le document de couverture classe « déployé, non
          éprouvé » : le code est en service et ses tests passent, mais il n&apos;a jamais rencontré de
          données réellement ingérées. Aucune capacité n&apos;a encore de meilleur verdict. Chacune est
          donnée avec sa limite.
        </>
      }
    >
      <CouvertureBarre />

      <div className="mt-12">
        <h3 className="text-xl font-bold tracking-tight text-ink">Les capacités</h3>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CARTES.map((c) => (
            <Carte key={c.id} carte={c} />
          ))}
        </div>
      </div>

      <Methode />
      <Positionnement />
    </Partie>
  );
}
