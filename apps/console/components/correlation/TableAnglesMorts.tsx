// Table « Angles morts » de /correlation (F58, plan § 5.7 CR9). Rendu serveur.
//
// UNE LISTE À OUVRIR LIGNE PAR LIGNE, PAS UN COMPTE. `blindSpots` est plafonnée à
// 50 lignes : le nombre d'angles morts vient de la concordance (CR8), et la table
// dit combien elle en montre sur combien.
//
// DEUX MESURES DIFFÉRENTES, AUCUN RATIO. Le robot mesure le premier chargement d'un
// scénario, le réel un LCP p75 : leur écart brut est donné « à titre indicatif »,
// jamais en pourcentage (l'ancien « écart −90 % » divisait l'un par l'autre).
//
// LE VERDICT RÉEL EST ÉCRIT. « À améliorer » ou « Mauvais », lu par `rating2026` :
// plus le mot unique « poor » pour tout LCP au-dessus de 2,5 s.
import Link from "next/link";
import { LIBELLE_ETAT_ROBOT } from "@/lib/correlation";
import { fmtLatency } from "@/lib/format";
import { RATING_CLASS, RATING_LABEL, rating2026 } from "@/lib/rating";
import { libelleSeauComplet } from "@/lib/series";

export interface LigneAngleMort {
  cle: string;
  app_id: string;
  route: string | null;
  /** Début de l'heure, ISO UTC. */
  heure: string;
  etatRobot: string;
  latenceRobot: number | null;
  scenarios: string | null;
  lcpReel: number;
  mesures: number;
  ecartMs: number;
  liens: { heure: string; sessions: string; pages: string };
}

const TH = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft";
const TD = "px-3 py-2 align-top";

export function TableAnglesMorts({ lignes, avecApp }: { lignes: LigneAngleMort[]; avecApp: boolean }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-max text-sm" data-testid="table-angles-morts">
        <caption className="sr-only">Angles morts : une ligne par heure et par route, écart décroissant</caption>
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
              Heure (UTC)
            </th>
            <th scope="col" className={TH}>
              État robot
            </th>
            <th scope="col" className={TH}>
              Premier chargement robot
            </th>
            <th scope="col" className={TH}>
              Scénarios robot
            </th>
            <th scope="col" className={TH}>
              LCP p75 réel
            </th>
            <th scope="col" className={TH}>
              Mesures LCP
            </th>
            <th scope="col" className={TH}>
              Réel − robot (ms, indicatif)
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">Liens</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => {
            const verdict = rating2026("LCP", l.lcpReel);
            return (
              <tr key={l.cle} className="border-t border-line/60" data-testid="angle-mort">
                <th scope="row" className={`${TD} sticky left-0 bg-panel text-left font-normal`}>
                  <span className="chip-mono">{l.route ?? "(sans route)"}</span>
                </th>
                {avecApp && <td className={`${TD} text-xs text-ink-soft`}>{l.app_id}</td>}
                <td className={`${TD} whitespace-nowrap text-xs tabular-nums text-ink-soft`}>
                  {libelleSeauComplet(l.heure, 3600, "UTC")}
                </td>
                <td className={TD}>{LIBELLE_ETAT_ROBOT[l.etatRobot] ?? l.etatRobot}</td>
                <td className={`${TD} tabular-nums`}>{fmtLatency(l.latenceRobot)}</td>
                <td className={`${TD} max-w-[16rem] text-xs text-ink-soft`} data-testid="scenarios-robot">
                  {l.scenarios ?? "—"}
                </td>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>
                  <span className="font-semibold">{fmtLatency(l.lcpReel)}</span>
                  {verdict && (
                    <span className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] font-medium ${RATING_CLASS[verdict]}`}>
                      {RATING_LABEL[verdict]}
                    </span>
                  )}
                </td>
                <td className={`${TD} tabular-nums`}>{l.mesures.toLocaleString("fr-FR")}</td>
                <td className={`${TD} tabular-nums text-ink-soft`}>
                  {l.ecartMs > 0 ? "+" : ""}
                  {l.ecartMs.toLocaleString("fr-FR")}
                </td>
                <td className={`${TD} whitespace-nowrap text-xs`}>
                  <span className="flex gap-3">
                    <Link href={l.liens.heure} className="font-medium text-brand hover:underline">
                      Voir l&apos;heure
                    </Link>
                    <Link href={l.liens.sessions} className="font-medium text-brand hover:underline">
                      Sessions de cette heure
                    </Link>
                    <Link href={l.liens.pages} className="font-medium text-brand hover:underline">
                      Pages
                    </Link>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
