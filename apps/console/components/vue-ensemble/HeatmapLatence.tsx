// HEATMAP DE LATENCE (A2 § 6.2, vague 3b) — rendu serveur, SVG sans bibliothèque.
//
// Une colonne par heure, 24 tranches logarithmiques ; la couleur est la PART de la
// colonne (rampe séquentielle du thème, jamais arc-en-ciel) ; une case sans mesure
// reste vide ; une colonne sous 13 mesures est hachurée ; la p75 de l'heure en
// surimpression (trait orange) ; les seuils web.dev en traits fins aux couleurs
// d'état. L'infobulle native (`<title>`) donne l'heure, la tranche, la part et
// l'effectif. L'alternative textuelle porte les mêmes chiffres.
//
// Le tracé s'étire à la largeur (`preserveAspectRatio="none"`) : les traits gardent
// leur épaisseur (`vector-effect`), et les textes sont en HTML, hors du SVG.
//
// LE CHOIX DU VITAL (suite du 30/09/2026). Quand la lecture porte les quatre vitaux
// à durée (`heatmap.choix` : LCP, INP, FCP, TTFB — le CLS, sans unité de durée, n'a
// pas d'échelle de latence), la carte les propose par un groupe de boutons radio
// natifs (clavier : flèches ; lecteur d'écran : « 1 sur 4 »). Les quatre dessins
// sont rendus par le serveur ; le choix n'affiche que le sien, en CSS (`:has`), sans
// JavaScript ni relecture. Chaque dessin garde les seuils web.dev de SON vital
// (`lib/rating.ts`). Sans `:has`, le vital par défaut reste affiché.
//
// SUR LA PAGE, UNE VIGNETTE (recette du 30/09/2026 : « heatmap vide en grande
// boîte », « trop de légendes »). La Vue d'ensemble montre le dessin réduit, sans
// légende ; un clic ouvre la carte entière — sélecteur, légende chiffrée, méthode,
// alternative. Sans aucune mesure, pas de vignette : l'écran le dit sur une ligne.
import { FicheMesure } from "@/components/charts/FicheMesure";
import { Figure, TableAlternative, type AlternativeTexte } from "@/components/charts/Figure";
import { EtatSurface } from "@/components/states/EtatSurface";
import { formater } from "@/lib/fmt-ids";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { positionLog, TRANCHES, MESURES_MIN_COLONNE, type Heatmap } from "@/lib/heatmap-latence";
import { PALIERS_SEQUENTIELLE_JETONS, RATING_JETON, SERIE, sequentielleJeton } from "@/lib/palette";
import { THRESHOLDS } from "@/lib/rating";
import { libelleSeau, libelleSeauComplet } from "@/lib/series";
import { DessinVignette, EnteteVignette } from "./Vignette";

const HAUTEUR = 180;
/** Hauteur du dessin réduit d'une vignette. */
const HAUTEUR_APERCU = 84;
const pct = (p: number) => `${Math.round(p * 100)} %`;
const totalDe = (h: Heatmap) => h.colonnes.reduce((s, c) => s + c.n, 0);

/**
 * Les règles d'affichage du choix, une par vital proposé, écrites EN ENTIER : le
 * compilateur Tailwind ne voit que les classes littérales. Le vital coché montre
 * son dessin et masque les autres.
 */
const REGLES_CHOIX = [
  "[&:has([data-vital-choix=LCP]:checked)_[data-vital-panneau=LCP]]:block",
  "[&:has([data-vital-choix=LCP]:checked)_[data-vital-panneau]:not([data-vital-panneau=LCP])]:hidden",
  "[&:has([data-vital-choix=INP]:checked)_[data-vital-panneau=INP]]:block",
  "[&:has([data-vital-choix=INP]:checked)_[data-vital-panneau]:not([data-vital-panneau=INP])]:hidden",
  "[&:has([data-vital-choix=FCP]:checked)_[data-vital-panneau=FCP]]:block",
  "[&:has([data-vital-choix=FCP]:checked)_[data-vital-panneau]:not([data-vital-panneau=FCP])]:hidden",
  "[&:has([data-vital-choix=TTFB]:checked)_[data-vital-panneau=TTFB]]:block",
  "[&:has([data-vital-choix=TTFB]:checked)_[data-vital-panneau]:not([data-vital-panneau=TTFB])]:hidden",
].join(" ");

const LECTURE_COMMUNE = (
  <>
    Chaque colonne est une heure ; la couleur dit la part des mesures de l&apos;heure dans chaque tranche de latence
    (échelle logarithmique). Le trait orange est la p75 de l&apos;heure. Une colonne hachurée compte moins de{" "}
    {MESURES_MIN_COLONNE} mesures ; l&apos;heure en cours n&apos;est pas encore agrégée.
  </>
);

/** La source des mesures, écrite dans la carte (charte : chaque figure cite sa source). */
const SOURCE =
  "Source : SDK MIP RUM dans la page (bibliothèque web-vitals, API Performance du navigateur), histogrammes horaires agrégés par le serveur ; seuils web.dev (Google).";

export function HeatmapLatence({ heatmap, plage }: { heatmap: Heatmap; plage: string }) {
  const choix = heatmap.choix && heatmap.choix.length > 1 ? heatmap.choix : null;
  if (!choix) return <HeatmapUnVital heatmap={heatmap} plage={plage} />;

  const nCol = heatmap.colonnes.length;
  return (
    <div className={`min-w-0 ${REGLES_CHOIX}`} data-testid="heatmap-latence-choix">
      <Figure
        titre="Heatmap de latence"
        id="heatmap-latence"
        meta={
          <>
            <SelecteurVital vitaux={choix.map((h) => h.vital)} parDefaut={heatmap.vital} />
            <span>{nCol} heures</span>
            <span>{plage}</span>
          </>
        }
        lecture={
          <>
            {LECTURE_COMMUNE} Le CLS n&apos;est pas proposé : c&apos;est un score sans unité, pas une durée. {SOURCE}
          </>
        }
      >
        {choix.map((h) => {
          const total = totalDe(h);
          return (
            <div
              key={h.vital}
              data-vital-panneau={h.vital}
              className={h.vital === heatmap.vital ? "block min-w-0" : "hidden min-w-0"}
            >
              <p className="mb-2 text-xs text-ink-soft" data-testid={`heatmap-latence-mesures-${h.vital}`}>
                {h.vital} · {formater("count", total)} mesures
              </p>
              {total === 0 ? (
                <EtatSurface etat={{ kind: "vide", population: `mesure ${h.vital} agrégée par heure`, plage }} />
              ) : (
                <>
                  <DessinHeatmap heatmap={h} testId={`heatmap-latence-${h.vital}`} />
                  <TableAlternative alternative={alternativeDe(h)} titre={`Alternative textuelle — ${h.vital}`} />
                </>
              )}
            </div>
          );
        })}
      </Figure>
    </div>
  );
}

/**
 * Le groupe de boutons radio du vital : natif, donc tenu au clavier (flèches) et
 * annoncé par sa légende ; l'entrée est masquée à la vue, pas aux technologies
 * d'assistance, et son libellé porte l'état coché et le focus.
 */
function SelecteurVital({ vitaux, parDefaut }: { vitaux: string[]; parDefaut: string }) {
  return (
    <fieldset className="relative flex min-w-0 flex-wrap items-center gap-1" data-testid="heatmap-choix-vital">
      <legend className="sr-only">Vital affiché dans la heatmap</legend>
      {vitaux.map((v) => (
        <label key={v} className="relative inline-flex cursor-pointer">
          <input
            type="radio"
            name="heatmap-vital"
            value={v}
            data-vital-choix={v}
            defaultChecked={v === parDefaut}
            className="peer sr-only"
          />
          <span className="rounded-md border border-line px-2 py-0.5 font-medium text-ink-soft transition hover:bg-panel2 peer-checked:border-perf peer-checked:bg-perf/10 peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-perf">
            {v}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Une carte, un vital : la forme d'origine, quand la lecture n'en portait qu'un. */
function HeatmapUnVital({ heatmap, plage }: { heatmap: Heatmap; plage: string }) {
  const { colonnes, vital } = heatmap;
  const total = totalDe(heatmap);
  return (
    <Figure
      titre={`Heatmap de latence ${vital}`}
      id="heatmap-latence"
      etat={total === 0 ? { kind: "vide", population: `mesure ${vital} agrégée par heure`, plage } : undefined}
      meta={
        <>
          <span>{colonnes.length} heures</span>
          <span>{formater("count", total)} mesures</span>
          <span>{plage}</span>
        </>
      }
      lecture={
        <>
          {LECTURE_COMMUNE} {SOURCE}
        </>
      }
      alternative={alternativeDe(heatmap)}
    >
      <DessinHeatmap heatmap={heatmap} testId="heatmap-latence" />
    </Figure>
  );
}

/**
 * La heatmap à montrer en vignette : celle du vital demandé s'il a des mesures, sinon
 * la première du choix qui en a ; `null` si aucune n'en a (l'écran le dit sur une
 * ligne). Son vital devient celui que la carte ouvre coché.
 */
export function heatmapAffichee(heatmap: Heatmap): Heatmap | null {
  const candidates = heatmap.choix && heatmap.choix.length > 1 ? [heatmap, ...heatmap.choix] : [heatmap];
  const h = candidates.find((c) => totalDe(c) > 0);
  return h ? { ...h, choix: heatmap.choix } : null;
}

/**
 * La vignette de la Vue d'ensemble : le dessin réduit du vital affiché, sans légende ;
 * la carte entière (sélecteur, légende, méthode, alternative) dans sa fenêtre.
 */
export function VignetteHeatmapLatence({ heatmap, plage }: { heatmap: Heatmap; plage: string }) {
  const total = totalDe(heatmap);
  return (
    <FicheMesure
      titre={`Heatmap de latence ${heatmap.vital}, ${plage}`}
      ariaLabel={`Heatmap de latence ${heatmap.vital} : ${heatmap.colonnes.length} heures, ${formater("count", total)} mesures — ouvrir la carte`}
      testId="vignette-heatmap-latence"
      case={
        <>
          <EnteteVignette
            titre={`Heatmap de latence · ${heatmap.vital}`}
            meta={`${heatmap.colonnes.length} h · ${formater("count", total)} mes.`}
          />
          <DessinVignette>
            <DessinHeatmap heatmap={heatmap} testId="heatmap-latence-apercu" apercu />
          </DessinVignette>
        </>
      }
    >
      <div className="mt-3">
        <HeatmapLatence heatmap={heatmap} plage={plage} />
      </div>
    </FicheMesure>
  );
}

function trancheDeK(bornes: readonly number[], k: number): string {
  return `${formater("ms", bornes[k])}–${formater("ms", bornes[k + 1])}`;
}

function alternativeDe(heatmap: Heatmap): AlternativeTexte {
  const { bornes, colonnes, vital } = heatmap;
  return {
    legende: `Répartition des mesures ${vital} par heure et par tranche de latence`,
    colonnes: ["Heure", "Mesures", "p75", "Tranche la plus fréquente", "Part"],
    lignes: colonnes.map((c) => {
      const max = c.parts.reduce<number>((m, p, k) => (p != null && (m < 0 || p > (c.parts[m] ?? 0)) ? k : m), -1);
      return [
        libelleSeauComplet(c.t, 3600, FUSEAU_AFFICHAGE),
        c.n,
        formater("ms", c.p75),
        max >= 0 ? trancheDeK(bornes, max) : null,
        max >= 0 ? pct(c.parts[max] ?? 0) : null,
      ];
    }),
  };
}

/**
 * Le dessin d'un vital : la grille colorée, la p75, les seuils web.dev DE CE VITAL, la
 * légende. `apercu` : le dessin réduit d'une vignette — deux graduations par axe, ni
 * légende ni infobulle (elles sont dans la carte ouverte).
 */
function DessinHeatmap({ heatmap, testId, apercu = false }: { heatmap: Heatmap; testId: string; apercu?: boolean }) {
  const { bornes, colonnes, partMax, vital } = heatmap;
  const nCol = colonnes.length;
  const seuils = THRESHOLDS[vital] ?? null;
  const hauteur = apercu ? HAUTEUR_APERCU : HAUTEUR;
  const yDe = (v: number) => TRANCHES * (1 - positionLog(v, bornes));
  const p75 = colonnes.map((c, i) => (c.p75 == null ? null : `${i + 0.5},${yDe(c.p75)}`));
  // La polyligne s'interrompt sur une heure sans mesure : jamais de trait qui la traverse.
  const segments: string[][] = [[]];
  for (const pt of p75) {
    if (pt == null) segments.push([]);
    else segments[segments.length - 1].push(pt);
  }
  const etiquettesY = (apercu ? [0, 24] : [0, 6, 12, 18, 24]).map((k) => ({ k, texte: formater("ms", bornes[k]) }));
  const etiquettesX = nCol > 0 ? [...new Set(apercu ? [0, nCol - 1] : [0, Math.floor((nCol - 1) / 2), nCol - 1])] : [];
  // Un motif par dessin : les dessins de la page (vignette, carte, quatre vitaux) ne
  // partagent pas un identifiant.
  const motif = `heatmap-hachures-${vital}${apercu ? "-apercu" : ""}`;

  return (
    <>
      <div className="flex min-w-0 gap-1" data-testid={testId}>
        <div
          className={`relative shrink-0 text-[10px] tabular-nums text-ink-soft ${apercu ? "w-10" : "w-12"}`}
          style={{ height: hauteur }}
          aria-hidden="true"
        >
          {etiquettesY.map(({ k, texte }) => (
            <span
              key={k}
              className={`absolute right-1 whitespace-nowrap ${k === 0 && apercu ? "" : "translate-y-1/2"}`}
              style={{ bottom: `${(k / TRANCHES) * 100}%` }}
            >
              {texte}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${Math.max(nCol, 1)} ${TRANCHES}`}
            preserveAspectRatio="none"
            width="100%"
            height={hauteur}
            role={apercu ? undefined : "img"}
            aria-hidden={apercu ? true : undefined}
            aria-label={
              apercu
                ? undefined
                : `Heatmap de latence ${vital} : ${nCol} heures, ${TRANCHES} tranches logarithmiques de ${formater("ms", bornes[0])} à ${formater("ms", bornes[TRANCHES])}, part des mesures de chaque heure`
            }
            className="block rounded-sm bg-panel"
          >
            <defs>
              <pattern id={motif} width="0.5" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="1" stroke="rgb(var(--c-ink-faint))" strokeWidth="0.15" />
              </pattern>
            </defs>
            {colonnes.map((c, i) =>
              c.parts.map((p, k) =>
                p == null ? null : (
                  <rect key={`${i}-${k}`} x={i} y={TRANCHES - 1 - k} width={1} height={1} fill={sequentielleJeton(partMax > 0 ? p / partMax : 0)}>
                    {!apercu && (
                      <title>{`${libelleSeauComplet(c.t, 3600, FUSEAU_AFFICHAGE)} · ${trancheDeK(bornes, k)} · ${pct(p)} des mesures (${formater("count", c.n)})`}</title>
                    )}
                  </rect>
                ),
              ),
            )}
            {colonnes.map((c, i) =>
              c.faible ? <rect key={`f-${i}`} x={i} y={0} width={1} height={TRANCHES} fill={`url(#${motif})`} data-faible="" /> : null,
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
                data-seuil={s}
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
      {!apercu && (
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
              seuils web.dev du {vital} : {formater("ms", seuils[0])} et {formater("ms", seuils[1])} (tirets)
            </li>
          )}
        </ul>
      )}
    </>
  );
}
