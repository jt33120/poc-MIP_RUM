// Partie 3 de la vitrine — « Ce qui reste pour un vrai outil de RUM » (plan § 8.2, PS10).
//
// Une carte par point de lib/presentation-reste.ts (R1 à R10), dans l'ordre fixe du
// plan : titre, puis trois lignes étiquetées « Ce qui manque », « Ce qui le
// débloque », « Qui décide », puis les pastilles des lignes du document de
// couverture que le point cite. Aucun texte n'est écrit ici : tout vient des
// données, qui citent leurs sources (contrôle n° 4 de couverture-site.test.ts).
//
// Les capacités déployées mais inertes (D12, D14) y figurent, et nulle part dans
// la partie 2 (règle 3 du § 8.0) : leur pastille porte `data-id`, que la recette
// TP4 cherche dans #reste.
//
// Une pastille porte au survol le nom de la capacité et son verdict, lus dans
// lib/couverture.ts : jamais recopiés, ils suivent le prochain relevé. Le verdict
// est aussi en `data-verdict` pour les recettes. Rendu serveur, sans état.
import { Partie } from "@/components/presentation/Partie";
import { VERDICT_LABEL, type Capacite } from "@/lib/couverture";
import type { PointReste } from "@/lib/couverture-controle";
import { POINTS_RESTE, lignesCitees } from "@/lib/presentation-reste";

/** Les trois lignes d'une carte, dans l'ordre du plan, avec leur libellé exact. */
const LIGNES: readonly { cle: "manque" | "debloque" | "decide"; libelle: string }[] = [
  { cle: "manque", libelle: "Ce qui manque" },
  { cle: "debloque", libelle: "Ce qui le débloque" },
  { cle: "decide", libelle: "Qui décide" },
];

/** Identifiant du titre d'une carte, que l'`article` cite par `aria-labelledby`. */
function idTitrePoint(id: string): string {
  return `reste-${id}-titre`;
}

function Pastille({ capacite }: { capacite: Capacite }) {
  return (
    <span
      data-testid="reste-pastille"
      data-id={capacite.id}
      data-verdict={capacite.verdict}
      title={`${capacite.capacite} — ${VERDICT_LABEL[capacite.verdict]}`}
      className="chip-mono inline-block font-semibold"
    >
      {capacite.id}
    </span>
  );
}

function CartePoint({ point, rang }: { point: PointReste; rang: number }) {
  const lignes = lignesCitees(point);
  return (
    <article
      data-testid="reste-point"
      data-id={point.id}
      aria-labelledby={idTitrePoint(point.id)}
      className="card flex h-full min-w-0 flex-col p-5"
    >
      <header className="flex min-w-0 items-baseline gap-2.5">
        {/* Le rang est dit par la liste ordonnée ; ce repère n'est que visuel. */}
        <span aria-hidden className="shrink-0 font-mono text-xs font-bold text-accent-ink">
          {String(rang).padStart(2, "0")}
        </span>
        <h3 id={idTitrePoint(point.id)} className="min-w-0 text-base font-bold leading-snug tracking-tight text-ink">
          {point.titre}
        </h3>
      </header>

      <dl className="mt-4 space-y-3 text-sm leading-relaxed">
        {LIGNES.map(({ cle, libelle }) => (
          <div key={cle} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{libelle}</dt>
            <dd className="mt-0.5 text-ink">{point[cle]}</dd>
          </div>
        ))}
      </dl>

      {lignes.length > 0 && (
        <div className="mt-auto pt-4">
          <p id={`reste-${point.id}-lignes`} className="text-[11px] text-ink-soft">
            Lignes du document de couverture
          </p>
          <ul aria-labelledby={`reste-${point.id}-lignes`} className="mt-1.5 flex flex-wrap gap-1.5">
            {lignes.map((capacite) => (
              <li key={capacite.id}>
                <Pastille capacite={capacite} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function Reste() {
  return (
    <Partie
      id="reste"
      chapeau={
        <>
          Ce qui sépare ce POC d&apos;un outil qu&apos;on met en service chez un client. Pour chaque
          point : ce qui manque, ce qui le débloquerait, et qui décide.
        </>
      }
    >
      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {POINTS_RESTE.map((point, i) => (
          <li key={point.id} className="min-w-0">
            <CartePoint point={point} rang={i + 1} />
          </li>
        ))}
      </ol>
    </Partie>
  );
}
