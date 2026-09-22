// Étendue de percentiles p50 → p75 → p95 (F38, plan § 4.2) — rendu serveur, SVG
// déterministe.
//
// POURQUOI UNE ÉTENDUE. Trois percentiles écrits en ligne (« p75 · médiane 620 ms ·
// p95 1,2 s ») se lisent comme trois chiffres sans rapport ; posés sur un axe
// commun, ils disent la forme : une étendue courte est un démarrage régulier, une
// longue moustache droite une traîne. Deux lignes (à froid, à chaud) se comparent
// d'un coup d'œil parce qu'elles partagent l'axe.
//
// CE QU'ELLE REFUSE.
//   - Une couleur de verdict : aucun seuil de démarrage n'est publié (Datadog
//     l'écrit lui-même). L'étendue est de la couleur de la mesure, pas d'un état.
//   - Une extrémité inventée : un percentile `null` n'a pas de moustache, et le
//     texte le dit (« p95 non calculable ») — une barre prolongée jusqu'au bord se
//     lirait comme une valeur.
//   - Une moyenne : les percentiles viennent de la base, jamais recalculés ici (V5).
import { TableAlternative } from "./Figure";
import { formater, type FormatId } from "@/lib/fmt-ids";

export interface LigneEtendue {
  libelle: string;
  n: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
}

const W = 320;
const H = 22;
const MARGE = 4;
const MILIEU = H / 2;

const connu = (v: number | null): v is number => v != null && Number.isFinite(v);

/** « p50 620 ms » ou « p50 non calculable ». */
function texteRepere(nom: string, v: number | null, format: FormatId): string {
  return connu(v) ? `${nom} ${formater(format, v)}` : `${nom} non calculable`;
}

/** Échelle commune : `axeMax` s'il est donné, sinon le plus grand percentile connu (+10 %). */
function echelle(lignes: readonly LigneEtendue[], axeMax?: number): number {
  if (axeMax != null && axeMax > 0) return axeMax;
  const max = Math.max(0, ...lignes.flatMap((l) => [l.p50, l.p75, l.p95].filter(connu)));
  return max > 0 ? max * 1.1 : 1;
}

export function EtenduePercentiles({
  lignes,
  format,
  axeMax,
  faibleSous = 30,
}: {
  lignes: { libelle: string; n: number; p50: number | null; p75: number | null; p95: number | null }[];
  format: FormatId;
  axeMax?: number;
  /** Défaut 30 : « échantillon faible ». */
  faibleSous?: number;
}) {
  const max = echelle(lignes, axeMax);
  const x = (v: number) => MARGE + (Math.min(Math.max(v, 0), max) / max) * (W - 2 * MARGE);
  const auDela = (v: number | null) => connu(v) && v > max;

  return (
    <div className="min-w-0" data-testid="etendue-percentiles">
      <ul className="flex flex-col gap-3">
        {lignes.map((l) => {
          const mesuree = l.n > 0 && [l.p50, l.p75, l.p95].some(connu);
          const faible = l.n > 0 && l.n < faibleSous;
          const reperes = [texteRepere("p50", l.p50, format), texteRepere("p75", l.p75, format), texteRepere("p95", l.p95, format)];
          const debordes = (["p50", "p75", "p95"] as const).filter((k) => auDela(l[k]));
          const aria = mesuree
            ? `${l.libelle} : ${reperes.join(", ")}, ${l.n.toLocaleString("fr-FR")} mesure(s)${faible ? ", échantillon faible" : ""}`
            : `${l.libelle} : non mesuré`;
          // L'étendue court entre les extrémités CONNUES ; une extrémité inconnue n'a
          // ni moustache ni prolongement.
          const bornes = [l.p50, l.p75, l.p95].filter(connu);
          const gauche = bornes.length ? Math.min(...bornes) : null;
          const droite = bornes.length ? Math.max(...bornes) : null;
          return (
            <li key={l.libelle} className="min-w-0" data-testid="etendue-ligne">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <span className="min-w-0 break-words font-semibold text-ink">{l.libelle}</span>
                {mesuree ? (
                  <>
                    <span className="min-w-0 break-words tabular-nums text-ink-soft" data-testid="etendue-reperes">
                      {reperes.join(" · ")}
                    </span>
                    <span className="tabular-nums text-ink-soft">
                      {l.n.toLocaleString("fr-FR")} mesure{l.n > 1 ? "s" : ""}
                    </span>
                    {faible && (
                      <span className="rounded border border-line bg-panel2 px-1 py-px text-[10px] font-medium text-ink-soft">
                        échantillon faible
                      </span>
                    )}
                    {debordes.length > 0 && (
                      <span className="text-ink-soft">({debordes.join(", ")} au-delà de l&apos;échelle)</span>
                    )}
                  </>
                ) : (
                  <span className="text-ink-soft" data-testid="etendue-non-mesure">
                    Non mesuré
                  </span>
                )}
              </div>
              {mesuree && gauche !== null && droite !== null && (
                <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={aria}>
                  <line x1={MARGE} x2={W - MARGE} y1={MILIEU} y2={MILIEU} stroke="currentColor" strokeWidth={0.5} className="text-line" />
                  <g className="text-accent">
                    <rect
                      x={x(gauche)}
                      y={MILIEU - 4}
                      width={Math.max(x(droite) - x(gauche), 1)}
                      height={8}
                      rx={2}
                      fill="currentColor"
                      opacity={0.3}
                    />
                    {connu(l.p50) && (
                      <line
                        data-testid="etendue-p50"
                        x1={x(l.p50)}
                        x2={x(l.p50)}
                        y1={MILIEU - 6}
                        y2={MILIEU + 6}
                        stroke="currentColor"
                        strokeWidth={1.5}
                      />
                    )}
                    {connu(l.p95) && (
                      <line
                        data-testid="etendue-p95"
                        x1={x(l.p95)}
                        x2={x(l.p95)}
                        y1={MILIEU - 6}
                        y2={MILIEU + 6}
                        stroke="currentColor"
                        strokeWidth={1.5}
                      />
                    )}
                  </g>
                  {connu(l.p75) && (
                    <rect
                      data-testid="etendue-p75"
                      x={x(l.p75) - 2}
                      y={MILIEU - 8}
                      width={4}
                      height={16}
                      rx={1}
                      fill="currentColor"
                      className="text-ink"
                    />
                  )}
                </svg>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-soft" aria-hidden="true">
        <span>{formater(format, 0)}</span>
        <span>{formater(format, max / 2)}</span>
        <span>{formater(format, max)}</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">
        Barre : de p50 à p95 ; repère sombre : p75. Axe commun à toutes les lignes, sans seuil ni couleur de verdict.
      </p>
      <TableAlternative
        alternative={{
          legende: "Percentiles par ligne, sur un axe commun",
          colonnes: ["Ligne", "Mesures", "p50", "p75", "p95"],
          lignes: lignes.map((l) => [
            l.libelle,
            l.n.toLocaleString("fr-FR"),
            connu(l.p50) ? formater(format, l.p50) : "non calculable",
            connu(l.p75) ? formater(format, l.p75) : "non calculable",
            connu(l.p95) ? formater(format, l.p95) : "non calculable",
          ]),
        }}
      />
    </div>
  );
}
