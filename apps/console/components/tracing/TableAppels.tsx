// « Tous les appels API » (§ 5.8, T8) — table SSR, même lecture et même ordre que
// le hero (`apiCallsDecomposition`) : les dix lignes du classement sont les dix
// premières ici, TOUJOURS hors du `<details>` — un clic sur une barre du hero mène à
// une ligne visible (`id="appel-<hash>"`, `lib/tracing-ancres.ts`).
//
// SERVEUR ET TRAJET EN DEUX COLONNES, CHACUNE UN VRAI p75. Le trajet est calculé
// trace par trace, puis agrégé : il ne vaut jamais « p75 navigateur − p75 serveur »,
// qui n'est la durée d'aucun appel (DF2). La part serveur est une médiane de
// rapports, sur sa propre échelle (`ShareBar`), jamais des millisecondes.
import Link from "next/link";
import type { ReactNode } from "react";
import { ShareBar } from "./ShareBar";
import { formater } from "@/lib/fmt-ids";
import type { ApiCallDecomposition } from "@/lib/queries-tracing";
import { ancreAppel, type Appel } from "@/lib/tracing-ancres";
import { partServeur } from "@/lib/tracing-hero";

const TH = "th whitespace-nowrap";
const TD = "px-4 py-3 tabular-nums";

function Entete() {
  return (
    <thead className="bg-panel2">
      <tr>
        <th scope="col" className={`${TH} sticky left-0 z-10 bg-panel2`}>
          Méthode et chemin
        </th>
        <th scope="col" className={TH}>Appels</th>
        <th scope="col" className={TH}>Suivis</th>
        <th scope="col" className={TH}>p75 navigateur</th>
        <th scope="col" className={TH}>p75 serveur (appels suivis)</th>
        <th scope="col" className={TH}>p75 trajet (par trace)</th>
        <th scope="col" className={TH}>Part serveur (médiane)</th>
        <th scope="col" className={TH}>Échecs</th>
        <th scope="col" className={TH}>
          <span className="sr-only">Traces</span>
        </th>
      </tr>
    </thead>
  );
}

function Ligne({ a, hrefTraces }: { a: ApiCallDecomposition; hrefTraces: string }) {
  const part = partServeur(a);
  return (
    <tr id={ancreAppel(a.method, a.url)} className="scroll-mt-20 border-t border-line/60 target:bg-perf/10" data-testid="ligne-appel">
      <th scope="row" className="sticky left-0 z-10 max-w-[16rem] bg-panel px-4 py-3 text-left font-mono text-xs font-normal">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded bg-panel2 px-1.5 py-0.5 font-semibold text-ink-soft">{a.method}</span>
          <span className="block min-w-0 truncate text-ink" title={a.url}>
            {a.url || "(sans URL)"}
          </span>
        </span>
      </th>
      <td className={TD}>{formater("count", a.n)}</td>
      <td className={TD}>{formater("count", a.n_suivis)}</td>
      <td className={`${TD} font-semibold`}>{formater("ms", a.front_p75)}</td>
      <td className={TD}>{formater("ms", a.back_p75)}</td>
      <td className={TD}>{formater("ms", a.reseau_p75)}</td>
      <td className="px-4 py-3">{part === null ? <span className="text-ink-soft">—</span> : <ShareBar share={part} />}</td>
      <td className={TD}>
        {formater("count", a.err)}
        <span className="text-ink-soft"> ({formater("pct", a.n > 0 ? a.err / a.n : null)})</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs">
        <Link href={hrefTraces} className="text-perf underline-offset-2 hover:underline">
          Voir les traces
        </Link>
      </td>
    </tr>
  );
}

function Table({ lignes, hrefTraces, testId }: { lignes: ApiCallDecomposition[]; hrefTraces: (a: Appel) => string; testId?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={testId}>
        <Entete />
        <tbody>
          {lignes.map((a) => (
            <Ligne key={`${a.method} ${a.url}`} a={a} hrefTraces={hrefTraces({ method: a.method, url: a.url })} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableAppels({
  appels,
  visibles = 10,
  hrefTraces,
  vide,
}: {
  /** Lignes d'`apiCallsDecomposition`, dans son ordre (celui du hero). */
  appels: ApiCallDecomposition[];
  /** Lignes hors du `<details>` : au moins celles du hero. */
  visibles?: number;
  /** « Voir les traces » : « Traces les plus lentes » filtrées sur l'appel (`appel=`). */
  hrefTraces: (appel: Appel) => string;
  /** Rendu quand aucune ligne n'est lue. */
  vide: ReactNode;
}) {
  if (appels.length === 0) return <>{vide}</>;
  const tete = appels.slice(0, visibles);
  const reste = appels.slice(visibles);
  return (
    <div className="flex flex-col gap-2">
      <Table lignes={tete} hrefTraces={hrefTraces} testId="api-calls" />
      {reste.length > 0 && (
        <details className="group" data-testid="appels-suivants">
          <summary className="cursor-pointer select-none px-1 py-2 text-xs font-medium text-ink-soft hover:text-ink">
            Voir les {formater("count", appels.length)} appels ({formater("count", reste.length)} de plus)
          </summary>
          <Table lignes={reste} hrefTraces={hrefTraces} />
        </details>
      )}
    </div>
  );
}
