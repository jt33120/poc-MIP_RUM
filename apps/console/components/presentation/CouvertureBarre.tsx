// Barre de couverture de la vitrine (plan § 8.2, partie 2 ; visuel V-E du § 8.3).
//
// UNE CASE PAR CAPACITÉ du document de couverture, groupées par verdict, du verdict
// le plus nombreux au moins nombreux — l'ordre de la phrase de répartition du
// document. Le nombre de cases, les décomptes, la date et le commit viennent de
// lib/couverture.ts (via repartitionCouverture) : aucun n'est écrit ici, et un
// nouveau relevé redessine la barre au build suivant.
//
// LA COULEUR NE PORTE RIEN SEULE (§ 3.9). Chaque verdict a une teinte catégorielle
// (lib/palette.ts) : ni vert, ni ambre, ni rouge — un verdict de couverture n'est
// pas un seuil de mesure (P15), et le meilleur d'entre eux dit encore « non
// éprouvé ». La légende écrit chaque nombre et son verdict en toutes lettres ; le
// dessin porte `role="img"` et un `aria-label` qui dit la même chose ; l'alternative
// textuelle, repliée dessous, en donne le tableau, une ligne par groupe dessiné.
//
// SVG rendu serveur, sans animation : le dessin s'étire sur la largeur disponible
// (`preserveAspectRatio="none"`), des cases de quelques pixels à 390 px.
import { TableAlternative } from "@/components/charts/Figure";
import { CAPACITES, RELEVE, SHA, VERDICTS, VERDICT_LABEL, type Verdict } from "@/lib/couverture";
import { categorie } from "@/lib/palette";
import { repartitionCouverture } from "@/lib/presentation-sait-faire";

/** La teinte d'un verdict : son rang dans le vocabulaire du document, stable d'un relevé à l'autre. */
export function couleurVerdict(verdict: Verdict): string {
  return categorie(VERDICTS.indexOf(verdict));
}

// Géométrie, en unités du viewBox.
const CASE = 10;
const JOINT = 2;
const ENTRE_GROUPES = 8;
const HAUTEUR = 20;

/** Abscisse et verdict de chaque case, groupe après groupe. */
function placerCases(parts: { verdict: Verdict; nombre: number }[]): { cases: { x: number; verdict: Verdict }[]; largeur: number } {
  const cases: { x: number; verdict: Verdict }[] = [];
  let x = 0;
  parts.forEach((p, groupe) => {
    if (groupe > 0) x += ENTRE_GROUPES - JOINT;
    for (let i = 0; i < p.nombre; i++) {
      cases.push({ x, verdict: p.verdict });
      x += CASE + JOINT;
    }
  });
  return { cases, largeur: Math.max(x - JOINT, CASE) };
}

export function CouvertureBarre() {
  const parts = repartitionCouverture();
  const total = CAPACITES.length;
  const { cases, largeur } = placerCases(parts);
  const resume = parts.map((p) => `${p.nombre} ${p.libelle}`).join(" ; ");

  return (
    <figure data-testid="couverture-barre" className="card mt-8 min-w-0 p-4 sm:p-5">
      <figcaption className="text-sm leading-relaxed text-ink-soft">
        <span className="font-semibold text-ink">Les {total} capacités du document de couverture</span>,
        relevé du {RELEVE} sur <code className="font-mono text-[13px] text-ink">{SHA}</code> : une case par
        capacité, groupées par verdict.
      </figcaption>
      <svg
        role="img"
        aria-label={`Barre de couverture du ${RELEVE} : ${total} capacités, une case chacune — ${resume}.`}
        viewBox={`0 0 ${largeur} ${HAUTEUR}`}
        preserveAspectRatio="none"
        className="mt-4 block h-6 w-full"
      >
        {cases.map((c, i) => (
          <rect key={i} x={c.x} y={0} width={CASE} height={HAUTEUR} rx={1.5} fill={couleurVerdict(c.verdict)} />
        ))}
      </svg>
      <ul data-testid="couverture-legende" className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-soft">
        {parts.map((p) => (
          <li key={p.verdict} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: couleurVerdict(p.verdict) }}
            />
            <span>
              <strong className="font-semibold tabular-nums text-ink">{p.nombre}</strong> {p.libelle}
            </span>
          </li>
        ))}
      </ul>
      <TableAlternative
        alternative={{
          legende: `Capacités du document de couverture par verdict, relevé du ${RELEVE} sur ${SHA}`,
          colonnes: ["Verdict", "Capacités"],
          lignes: parts.map((p) => [VERDICT_LABEL[p.verdict], p.nombre]),
        }}
      />
    </figure>
  );
}
