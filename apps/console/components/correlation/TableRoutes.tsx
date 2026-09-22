// Table « Routes : robot et réel côte à côte » de /correlation (F58, plan § 5.7
// CR12). Rendu serveur. Remplace les cartes `RouteCard` : une carte par route
// prenait ~200 px de haut et ne se comparait pas à la suivante ; une table aligne
// les colonnes.
//
// AUCUN ÉCART EN %. Le premier chargement d'un scénario robot et le LCP p75 des
// visiteurs ne mesurent pas la même chose : ils sont posés côte à côte, jamais
// divisés l'un par l'autre (l'ancien badge « écart −90 % »).
//
// LA COLONNE « CONCORDANCE ROBOT ↔ RÉEL » (P*.8) N'EST PAS UN ÉCART NON PLUS : un
// coefficient de RANG (Spearman) sur les jours communs dit si les deux montent et
// descendent ensemble, sans jamais comparer leurs valeurs. Sous 10 jours communs,
// la cellule refuse en chiffrant ce qui manque.
//
// UN CÔTÉ ABSENT EST DIT. « pas de scénario robot sur cette route », « pas de
// trafic réel sur la plage » ; une route robot sans aucun trafic réel appelle une
// vérification de la correspondance `route_hint` ↔ route (cas `/partners/:id`).
import Link from "next/link";
import { LIBELLE_ETAT_ROBOT } from "@/lib/correlation";
import { fmtLatency } from "@/lib/format";
import { RATING_CLASS, RATING_LABEL, rating2026 } from "@/lib/rating";

export interface LigneRoute {
  cle: string;
  app_id: string;
  route: string | null;
  latenceRobot: number | null;
  etatRobot: string | null;
  scoreRobot: number | null;
  scenarios: string | null;
  robot: boolean;
  lcpReel: number | null;
  inpReel: number | null;
  mesuresLcp: number | null;
  sessions: number | null;
  reel: boolean;
  /** Sélectionne ce couple dans le hero ; absent si le couple n'y est pas affichable. */
  hrefHero: string | null;
  hrefPages: string | null;
  /** Concordance robot ↔ réel (P*.8) : ρ et son intervalle, ou le refus chiffré. */
  concordance: CelluleConcordanceRang;
}

/**
 * Ce qu'une cellule de concordance a le droit de dire (P*.8) : un coefficient de
 * rang avec son intervalle et son issue, ou un refus qui compte ce qui manque —
 * jamais une case vide, qui se lirait « aucun lien ».
 */
export interface CelluleConcordanceRang {
  /** « ρ 0,71 (0,21 à 0,92) » ou « Concordance non calculée : 4 jours communs, 10 requis ». */
  texte: string;
  /** « suit », « ne suit pas », « non établi » ; `null` quand rien n'est calculé. */
  issue: string | null;
  /** Jours communs retenus ; `null` quand rien n'est calculé. */
  jours: number | null;
}

const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft";
const TD = "px-3 py-2 align-top";

function Verdict({ vital, valeur }: { vital: "LCP" | "INP"; valeur: number | null }) {
  if (valeur == null) return <span className="text-ink-soft">—</span>;
  const r = rating2026(vital, valeur);
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold tabular-nums">{fmtLatency(valeur)}</span>
      {r && <span className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_CLASS[r]}`}>{RATING_LABEL[r]}</span>}
    </span>
  );
}

export function TableRoutes({ lignes, avecApp }: { lignes: LigneRoute[]; avecApp: boolean }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-max text-sm" data-testid="table-routes">
        <caption className="sr-only">Routes : robot et réel côte à côte, une ligne par couple app et route</caption>
        <thead className="bg-panel2">
          <tr>
            <th scope="col" className={`${TH} sticky left-0 bg-panel2`}>
              Route
            </th>
            {avecApp && (
              <th scope="col" className={TH}>
                App
              </th>
            )}
            <th scope="col" className={TH}>
              Premier chargement robot (moyenne)
            </th>
            <th scope="col" className={TH}>
              Pire état robot
            </th>
            <th scope="col" className={TH}>
              Score robot (moyenne)
            </th>
            <th scope="col" className={TH}>
              Scénarios
            </th>
            <th scope="col" className={TH}>
              LCP p75 réel
            </th>
            <th scope="col" className={TH}>
              INP p75 réel
            </th>
            <th scope="col" className={TH}>
              Mesures LCP
            </th>
            <th scope="col" className={TH}>
              Sessions mesurées
            </th>
            <th scope="col" className={TH}>
              Concordance robot ↔ réel
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">Liens</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle} className="border-t border-line/60" data-testid="ligne-route" data-robot={l.robot} data-reel={l.reel}>
              <th scope="row" className={`${TD} sticky left-0 bg-panel text-left font-normal`}>
                {l.hrefHero ? (
                  <Link href={l.hrefHero} className="chip-mono hover:underline" title="Afficher ce couple dans le hero">
                    {l.route ?? "(sans route)"}
                  </Link>
                ) : (
                  <span className="chip-mono">{l.route ?? "(sans route)"}</span>
                )}
              </th>
              {avecApp && <td className={`${TD} text-xs text-ink-soft`}>{l.app_id}</td>}
              {l.robot ? (
                <>
                  <td className={`${TD} tabular-nums`}>{fmtLatency(l.latenceRobot)}</td>
                  <td className={TD}>{l.etatRobot ? (LIBELLE_ETAT_ROBOT[l.etatRobot] ?? l.etatRobot) : "état inconnu"}</td>
                  <td className={`${TD} tabular-nums`}>{l.scoreRobot == null ? "—" : Math.round(l.scoreRobot)}</td>
                  <td className={`${TD} max-w-[16rem] text-xs text-ink-soft`}>{l.scenarios ?? "—"}</td>
                </>
              ) : (
                <td colSpan={4} className={`${TD} text-xs text-ink-soft`}>
                  pas de scénario robot sur cette route
                </td>
              )}
              {l.reel ? (
                <>
                  <td className={TD}>
                    <Verdict vital="LCP" valeur={l.lcpReel} />
                  </td>
                  <td className={TD}>
                    <Verdict vital="INP" valeur={l.inpReel} />
                  </td>
                  <td className={`${TD} tabular-nums`}>{l.mesuresLcp == null ? "—" : l.mesuresLcp.toLocaleString("fr-FR")}</td>
                  <td className={`${TD} tabular-nums`}>{l.sessions == null ? "—" : l.sessions.toLocaleString("fr-FR")}</td>
                </>
              ) : (
                <td colSpan={4} className={`${TD} text-xs text-ink-soft`}>
                  pas de trafic réel sur la plage
                  {l.robot && (
                    <span className="mt-0.5 block text-warn-ink" data-testid="verifier-correspondance">
                      vérifier la correspondance route_hint ↔ route
                    </span>
                  )}
                </td>
              )}
              <td className={`${TD} min-w-0`} data-testid="concordance-route" data-issue={l.concordance.issue ?? "non-calculee"}>
                <span className="block tabular-nums">{l.concordance.texte}</span>
                {l.concordance.issue && (
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    {l.concordance.issue} · {l.concordance.jours} jours communs
                  </span>
                )}
              </td>
              <td className={`${TD} whitespace-nowrap text-xs`}>
                {l.hrefPages && (
                  <Link href={l.hrefPages} className="font-medium text-brand hover:underline">
                    Pages
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
