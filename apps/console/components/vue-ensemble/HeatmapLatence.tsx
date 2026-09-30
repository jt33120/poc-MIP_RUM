// HEATMAP DE LATENCE (A2 § 6.2, vague 3b) — rendu serveur, SVG sans bibliothèque.
//
// Une colonne par heure, 24 tranches logarithmiques ; la couleur est la PART de la
// colonne (rampe séquentielle du thème, jamais arc-en-ciel) ; une case sans mesure
// reste vide ; une colonne sous 13 mesures est hachurée ; la p75 de l'heure en
// surimpression (trait orange) ; les seuils web.dev en traits fins aux couleurs
// d'état. L'infobulle native (`<title>`) donne l'heure, la tranche, la part et
// l'effectif. L'alternative textuelle (`Figure`) porte les mêmes chiffres.
//
// Le tracé s'étire à la largeur (`preserveAspectRatio="none"`) : les traits gardent
// leur épaisseur (`vector-effect`), et les textes sont en HTML, hors du SVG.
import { Figure } from "@/components/charts/Figure";
import { formater } from "@/lib/fmt-ids";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { positionLog, TRANCHES, MESURES_MIN_COLONNE, type Heatmap } from "@/lib/heatmap-latence";
import { PALIERS_SEQUENTIELLE_JETONS, RATING_JETON, SERIE, sequentielleJeton } from "@/lib/palette";
import { THRESHOLDS } from "@/lib/rating";
import { libelleSeau, libelleSeauComplet } from "@/lib/series";

const HAUTEUR = 180;
const pct = (p: number) => `${Math.round(p * 100)} %`;

export function HeatmapLatence({ heatmap, plage }: { heatmap: Heatmap; plage: string }) {
  const { bornes, colonnes, partMax, vital } = heatmap;
  const nCol = colonnes.length;
  const total = colonnes.reduce((s, c) => s + c.n, 0);
  const seuils = THRESHOLDS[vital] ?? null;
  const yDe = (v: number) => TRANCHES * (1 - positionLog(v, bornes));
  const tranche = (k: number) => `${formater("ms", bornes[k])}–${formater("ms", bornes[k + 1])}`;
  const p75 = colonnes.map((c, i) => (c.p75 == null ? null : `${i + 0.5},${yDe(c.p75)}`));
  // La polyligne s'interrompt sur une heure sans mesure : jamais de trait qui la traverse.
  const segments: string[][] = [[]];
  for (const pt of p75) {
    if (pt == null) segments.push([]);
    else segments[segments.length - 1].push(pt);
  }
  const etiquettesY = [0, 6, 12, 18, 24].map((k) => ({ k, texte: formater("ms", bornes[k]) }));
  const etiquettesX = nCol > 0 ? [...new Set([0, Math.floor((nCol - 1) / 2), nCol - 1])] : [];

  return (
    <Figure
      titre={`Heatmap de latence ${vital}`}
      id="heatmap-latence"
      etat={total === 0 ? { kind: "vide", population: `mesure ${vital} agrégée par heure`, plage } : undefined}
      meta={
        <>
          <span>{nCol} heures</span>
          <span>{formater("count", total)} mesures</span>
          <span>{plage}</span>
        </>
      }
      lecture={
        <>
          Chaque colonne est une heure ; la couleur dit la part des mesures de l&apos;heure dans chaque tranche de latence
          (échelle logarithmique). Le trait orange est la p75 de l&apos;heure. Une colonne hachurée compte moins de{" "}
          {MESURES_MIN_COLONNE} mesures ; l&apos;heure en cours n&apos;est pas encore agrégée.
        </>
      }
      alternative={{
        legende: `Répartition des mesures ${vital} par heure et par tranche de latence`,
        colonnes: ["Heure", "Mesures", "p75", "Tranche la plus fréquente", "Part"],
        lignes: colonnes.map((c) => {
          const max = c.parts.reduce<number>((m, p, k) => (p != null && (m < 0 || p > (c.parts[m] ?? 0)) ? k : m), -1);
          return [
            libelleSeauComplet(c.t, 3600, FUSEAU_AFFICHAGE),
            c.n,
            formater("ms", c.p75),
            max >= 0 ? tranche(max) : null,
            max >= 0 ? pct(c.parts[max] ?? 0) : null,
          ];
        }),
      }}
    >
      <div className="flex min-w-0 gap-1" data-testid="heatmap-latence">
        <div className="relative w-12 shrink-0 text-[10px] tabular-nums text-ink-soft" style={{ height: HAUTEUR }} aria-hidden="true">
          {etiquettesY.map(({ k, texte }) => (
            <span key={k} className="absolute right-1 translate-y-1/2 whitespace-nowrap" style={{ bottom: `${(k / TRANCHES) * 100}%` }}>
              {texte}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${Math.max(nCol, 1)} ${TRANCHES}`}
            preserveAspectRatio="none"
            width="100%"
            height={HAUTEUR}
            role="img"
            aria-label={`Heatmap de latence ${vital} : ${nCol} heures, ${TRANCHES} tranches logarithmiques de ${formater("ms", bornes[0])} à ${formater("ms", bornes[TRANCHES])}, part des mesures de chaque heure`}
            className="block rounded-sm bg-panel"
          >
            <defs>
              <pattern id="heatmap-hachures" width="0.5" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="1" stroke="rgb(var(--c-ink-faint))" strokeWidth="0.15" />
              </pattern>
            </defs>
            {colonnes.map((c, i) =>
              c.parts.map((p, k) =>
                p == null ? null : (
                  <rect key={`${i}-${k}`} x={i} y={TRANCHES - 1 - k} width={1} height={1} fill={sequentielleJeton(partMax > 0 ? p / partMax : 0)}>
                    <title>{`${libelleSeauComplet(c.t, 3600, FUSEAU_AFFICHAGE)} · ${tranche(k)} · ${pct(p)} des mesures (${formater("count", c.n)})`}</title>
                  </rect>
                ),
              ),
            )}
            {colonnes.map((c, i) =>
              c.faible ? <rect key={`f-${i}`} x={i} y={0} width={1} height={TRANCHES} fill="url(#heatmap-hachures)" data-faible="" /> : null,
            )}
            {seuils?.map((s, j) => (
              <line
                key={s}
                x1={0}
                x2={Math.max(nCol, 1)}
                y1={yDe(s)}
                y2={yDe(s)}
                stroke={j === 0 ? RATING_JETON["needs-improvement"] : RATING_JETON.poor}
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {segments
              .filter((s) => s.length > 0)
              .map((s, j) => (
                <polyline key={j} points={s.join(" ")} fill="none" stroke={SERIE.principale} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              ))}
          </svg>
          <div className="mt-1 flex min-w-0 justify-between gap-2 text-[10px] text-ink-soft" aria-hidden="true">
            {etiquettesX.map((i) => (
              <span key={i} className="min-w-0 truncate">
                {libelleSeau(colonnes[i].t, 3600, FUSEAU_AFFICHAGE)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <ul className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft" data-testid="legende-heatmap">
        <li className="flex items-center gap-1.5">
          <span>0 %</span>
          <span className="flex" aria-hidden="true">
            {PALIERS_SEQUENTIELLE_JETONS.map((c) => (
              <span key={c} className="inline-block h-2.5 w-4" style={{ background: c }} />
            ))}
          </span>
          <span>{pct(partMax)} des mesures de l&apos;heure</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: SERIE.principale }} aria-hidden="true" />
          p75 de l&apos;heure
        </li>
        {seuils && (
          <li className="flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
            seuils web.dev : {formater("ms", seuils[0])} et {formater("ms", seuils[1])} (tirets)
          </li>
        )}
      </ul>
    </Figure>
  );
}
