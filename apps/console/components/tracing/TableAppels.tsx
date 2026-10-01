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
import { TableDefilante } from "@/components/TableDefilante";
import { ShareBar } from "./ShareBar";
import { formater } from "@/lib/fmt-ids";
import type { ApiCallDecomposition } from "@/lib/queries-tracing";
import { ancreAppel, type Appel } from "@/lib/tracing-ancres";
import { partServeur } from "@/lib/tracing-hero";

const TH = "th whitespace-nowrap";
// Sous 640 px, chaque appel est une CARTE (recette du 26/09/2026 : à 390 px, seuls
// « Méthode et chemin » et « Appels » tenaient dans l'écran, les p75 hors champ) :
// les chiffres s'écrivent à la suite, chacun précédé de son libellé.
// Lignes denses (recette du 30/09/2026) : nombres alignés à droite, 32 px environ.
const TD =
  "mr-4 mt-1 inline-flex items-baseline gap-1 text-xs tabular-nums sm:mr-0 sm:mt-0 sm:table-cell sm:px-3 sm:py-1.5 sm:text-right sm:text-[13px]";

/** Libellé d'une cellule, écrit seulement dans la carte (sous 640 px). */
function Libelle({ children }: { children: ReactNode }) {
  return <span className="font-normal text-ink-soft sm:hidden">{children}</span>;
}

function Entete() {
  return (
    <thead className="hidden bg-panel2 sm:table-header-group">
      <tr>
        <th scope="col" className={`${TH} sticky left-0 z-10 bg-panel2`}>
          Méthode et chemin
        </th>
        <th scope="col" className={`${TH} text-right`}>Appels</th>
        <th scope="col" className={`${TH} text-right`}>Suivis</th>
        <th scope="col" className={`${TH} text-right`}>p75 navigateur</th>
        <th scope="col" className={`${TH} text-right`}>p75 serveur (appels suivis)</th>
        <th scope="col" className={`${TH} text-right`}>p75 trajet (par trace)</th>
        <th scope="col" className={TH}>Part serveur (médiane)</th>
        <th scope="col" className={`${TH} text-right`}>Échecs</th>
        {/* En-tête ÉCRIT, pas `sr-only` : un élément en position absolue (ce qu'est
            `sr-only`) sans ancêtre positionné se place par rapport à la page — dans
            une table plus large que l'écran, il la POUSSE (débordement constaté à
            390, 768 et 1440 px). Le conteneur défilant porte aussi `relative`. */}
        <th scope="col" className={TH}>
          Traces
        </th>
      </tr>
    </thead>
  );
}

function Ligne({ a, hrefTraces }: { a: ApiCallDecomposition; hrefTraces: string }) {
  const part = partServeur(a);
  return (
    <tr
      id={ancreAppel(a.method, a.url)}
      className="block scroll-mt-20 border-t border-line/60 px-3 py-2 target:bg-perf/10 sm:table-row sm:p-0"
      data-testid="ligne-appel"
    >
      <th
        scope="row"
        className="block min-w-0 text-left font-mono text-xs font-normal sm:sticky sm:left-0 sm:z-10 sm:table-cell sm:max-w-[16rem] sm:bg-panel sm:px-3 sm:py-1.5"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded bg-panel2 px-1.5 py-0.5 font-semibold text-ink-soft">{a.method}</span>
          <span className="block min-w-0 truncate text-ink" title={a.url}>
            {a.url || "(sans URL)"}
          </span>
        </span>
      </th>
      <td className={TD}>
        <Libelle>Appels</Libelle>
        {formater("count", a.n)}
      </td>
      <td className={TD}>
        <Libelle>Suivis</Libelle>
        {formater("count", a.n_suivis)}
      </td>
      <td className={`${TD} font-semibold`}>
        <Libelle>p75 navigateur</Libelle>
        {formater("ms", a.front_p75)}
      </td>
      <td className={TD}>
        <Libelle>p75 serveur</Libelle>
        {formater("ms", a.back_p75)}
      </td>
      <td className={TD}>
        <Libelle>p75 trajet</Libelle>
        {formater("ms", a.reseau_p75)}
      </td>
      <td className="mt-1 flex items-center gap-2 text-xs sm:mt-0 sm:table-cell sm:px-3 sm:py-1.5">
        <Libelle>Part serveur</Libelle>
        {part === null ? <span className="text-ink-soft">—</span> : <ShareBar share={part} />}
      </td>
      <td className={TD}>
        <Libelle>Échecs</Libelle>
        {formater("count", a.err)}
        <span className="text-ink-soft"> ({formater("pct", a.n > 0 ? a.err / a.n : null)})</span>
      </td>
      <td className="mt-1 block whitespace-nowrap text-xs sm:mt-0 sm:table-cell sm:px-3 sm:py-1.5">
        <Link href={hrefTraces} className="text-perf underline-offset-2 hover:underline">
          Voir les traces
        </Link>
      </td>
    </tr>
  );
}

function Table({
  lignes,
  hrefTraces,
  testId,
  label,
}: {
  lignes: ApiCallDecomposition[];
  hrefTraces: (a: Appel) => string;
  testId?: string;
  /** Nom de la zone défilante : distinct pour chacune des deux tables de l'écran. */
  label: string;
}) {
  return (
    // Neuf colonnes : le défilement est signalé (ombre, consigne) et la zone reste
    // `relative` pour les `sr-only` (voir l'en-tête « Traces »).
    <TableDefilante label={label}>
      <table className="block w-full text-sm sm:table" data-testid={testId}>
        <Entete />
        <tbody className="block sm:table-row-group">
          {lignes.map((a) => (
            <Ligne key={`${a.method} ${a.url}`} a={a} hrefTraces={hrefTraces({ method: a.method, url: a.url })} />
          ))}
        </tbody>
      </table>
    </TableDefilante>
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
      <Table lignes={tete} hrefTraces={hrefTraces} testId="api-calls" label="Tous les appels API" />
      {reste.length > 0 && (
        <details className="group" data-testid="appels-suivants">
          <summary className="cursor-pointer select-none px-1 py-2 text-xs font-medium text-ink-soft hover:text-ink">
            Voir les {formater("count", appels.length)} appels ({formater("count", reste.length)} de plus)
          </summary>
          <Table lignes={reste} hrefTraces={hrefTraces} label="Appels suivants" />
        </details>
      )}
    </div>
  );
}
