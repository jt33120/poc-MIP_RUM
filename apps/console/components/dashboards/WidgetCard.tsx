// Carte d'un widget de tableau de bord : titre, fenêtre et filtres propres,
// contrôles d'ordre et de suppression (server actions), puis le corps.
//
// ORDRE AU CLAVIER. Monter et descendre sont des boutons de soumission : ils sont
// donc atteignables à la tabulation et actionnables à l'entrée ou à l'espace, sans
// glisser-déposer. Leur libellé annonce la POSITION (« Monter — 2 sur 5 ») : sans
// elle, un lecteur d'écran entend cinq fois le même bouton.
//
// CE QUI EST PROPRE À LA CARTE EST ÉCRIT SUR LA CARTE. Une fenêtre différente de
// celle de l'écran, ou un filtre supplémentaire, changent le nombre affiché : les
// taire ferait croire que toutes les cartes parlent de la même population.
//
// « OUVRIR DANS L'EXPLORER » (F36, W-B2). Une carte v2 est une requête enregistrée :
// son en-tête porte le lien qui la rouvre dans l'Explorer, sur la population de
// l'écran. Un AST que cette version ne sait plus lire ne devient pas un lien mort :
// la raison du registre est écrite à la place.
import Link from "next/link";
import {
  configureWidgetAction,
  moveWidgetAction,
  removeWidgetAction,
} from "@/app/dashboards/actions";
import { INPUT_CLASS } from "@/components/forms/Field";
import { RANGE_PRESETS, serializeSegments, type AnalyticsQuery } from "@/lib/query-contract";
import { widgetQueryJson, type Widget } from "@/lib/dashboards";
import { explorerHref, explorerHrefFromAst } from "@/lib/explorer-page-params";
import { formater } from "@/lib/fmt-ids";
import { widgetQuery, type WidgetData } from "@/lib/widget-data";
import { WidgetBody } from "./WidgetBody";

/**
 * Lien « Ouvrir dans l'Explorer » d'une carte v2 (W-B2).
 *
 * DEUX ÉTAPES, ET LA PREMIÈRE EST UNE PORTE. Le JSON enregistré est d'abord relu
 * par le registre (`explorerHrefFromAst(widgetQueryJson(w))`) : un AST que cette
 * version ne sait plus lire ne devient pas un lien mort, sa raison est écrite à la
 * place. L'adresse, elle, est bâtie sur la requête EFFECTIVE de la carte — celle de
 * l'écran intersectée avec les conditions de la carte, exactement ce que la lecture
 * a exécuté. L'AST ne porte ni app ni fenêtre : elles appartiennent au tableau de
 * bord qui l'affiche, et le lien doit ouvrir la population qu'on vient de lire.
 * Il ne porte pas non plus la REPRÉSENTATION (`serializeLayout` la range à côté de
 * lui) : relu seul, il retomberait sur « Valeur ». L'adresse la prend donc de
 * `widget.plan`, où elle est enregistrée.
 *
 * Une carte à fenêtre propre (`rangeOverride`) ouvre l'Explorer sur la fenêtre de
 * l'ÉCRAN : la sienne est écrite juste au-dessus du lien, elle n'est pas perdue.
 */
export function hrefExplorerDeCarte(widget: Widget, query: AnalyticsQuery): { href: string } | { raison: string } {
  if (widget.kind !== "v2") return { raison: "cette carte n’est pas une analyse : elle n’a pas de requête à rouvrir" };
  const lu = explorerHrefFromAst(widgetQueryJson(widget));
  if (!lu.ok) return { raison: lu.reason };
  return { href: explorerHref(widgetQuery(widget, query, query.range), widget.plan) };
}

export function WidgetCard({
  id,
  index,
  count,
  widget,
  data,
  revision,
  ctx,
  query,
  editable,
}: {
  id: number;
  index: number;
  count: number;
  widget: Widget;
  data: WidgetData;
  revision: string;
  /** Filtres de l'écran, reportés par chaque formulaire pour ne pas les perdre. */
  ctx: string;
  /** Requête de l'écran : population des liens sortants de la carte. */
  query: AnalyticsQuery;
  editable: boolean;
}) {
  const position = `${index + 1} sur ${count}`;
  const explorer = widget.kind === "v2" ? hrefExplorerDeCarte(widget, query) : null;
  // Le total reste un NOMBRE jusqu'ici : il se formate au rendu, avec son unité
  // quand le format n'en porte pas (« 6 occurrences », « 2,7 s »).
  const resume =
    widget.kind === "v2" && data.total !== undefined && data.format
      ? `${formater(data.format, data.total)}${data.unit && (data.format === "count" || data.format === "ratio") ? ` ${data.unit}` : ""}`
      : null;
  const champsCommuns = (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="index" value={index} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="ctx" value={ctx} />
    </>
  );

  return (
    <div className="card flex min-w-0 flex-col gap-3 p-4" data-testid={`widget-${index}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold tracking-tight">{widget.title}</h3>
          {resume && (
            <p className="mt-0.5 text-sm font-medium text-ink-soft" data-testid={`widget-${index}-total`}>
              {resume}
            </p>
          )}
          {(data.rangeLabel || data.filtersLabel) && (
            <p className="mt-0.5 break-words text-[11px] text-ink-faint" data-testid={`widget-${index}-portee`}>
              {data.rangeLabel ?? "Fenêtre de l’écran"}
              {data.filtersLabel ? ` · ${data.filtersLabel}` : ""}
            </p>
          )}
          {explorer && (
            <p className="mt-0.5 text-[11px]">
              {"href" in explorer ? (
                <Link
                  href={explorer.href}
                  data-testid={`widget-${index}-explorer`}
                  className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  Ouvrir dans l’Explorer
                </Link>
              ) : (
                <span className="text-ink-faint">Non rouvrable dans l’Explorer : {explorer.raison}</span>
              )}
            </p>
          )}
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            <form action={moveWidgetAction}>
              {champsCommuns}
              <input type="hidden" name="dir" value="up" />
              <button
                type="submit"
                disabled={index === 0}
                aria-label={`Monter — ${position}`}
                className="btn-ghost px-2 py-1 disabled:opacity-30"
              >
                ↑
              </button>
            </form>
            <form action={moveWidgetAction}>
              {champsCommuns}
              <input type="hidden" name="dir" value="down" />
              <button
                type="submit"
                disabled={index === count - 1}
                aria-label={`Descendre — ${position}`}
                className="btn-ghost px-2 py-1 disabled:opacity-30"
              >
                ↓
              </button>
            </form>
            <form action={removeWidgetAction}>
              {champsCommuns}
              <button
                type="submit"
                aria-label={`Retirer — ${position}`}
                className="btn-ghost px-2 py-1 text-bad-ink"
              >
                ✕
              </button>
            </form>
          </div>
        )}
      </div>

      <WidgetBody data={data} query={query} />

      {/* Configuration par carte : réservée aux analyses, qui seules savent
          appliquer un filtre supplémentaire à leur requête. */}
      {editable && widget.kind === "v2" && (
        <details className="border-t border-line pt-2 text-xs">
          <summary className="cursor-pointer rounded text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
            Filtres et fenêtre de cette carte
          </summary>
          <form action={configureWidgetAction} className="mt-2 flex flex-col gap-2">
            {champsCommuns}
            <label className="flex flex-col gap-1 text-ink-soft">
              <span>
                Filtres supplémentaires — même syntaxe que le paramètre <code className="text-ink">seg</code> des
                URL, par exemple <code className="text-ink">v2:browser:eq:Firefox;os:is_null</code>. Ils
                s’ajoutent aux filtres de l’écran, ils ne les remplacent pas.
              </span>
              <input
                name="filters"
                defaultValue={serializeSegments(widget.filters)}
                placeholder="v2:os:eq:iOS;release:is_null"
                className={`${INPUT_CLASS} w-full`}
              />
            </label>
            <label className="flex flex-col gap-1 text-ink-soft">
              Fenêtre de la carte
              <select
                name="range_preset"
                defaultValue={
                  widget.rangeOverride === null
                    ? ""
                    : "preset" in widget.rangeOverride
                      ? widget.rangeOverride.preset
                      : "keep"
                }
                className={`${INPUT_CLASS} w-full`}
              >
                <option value="">Suivre la fenêtre de l’écran</option>
                {RANGE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
                {/* Une fenêtre FIGÉE ne se retape pas dans une liste de presets :
                    elle se garde, ou elle se remplace par un preset. */}
                {widget.rangeOverride && !("preset" in widget.rangeOverride) && (
                  <option value="keep">
                    Garder la fenêtre figée (du {widget.rangeOverride.from} au {widget.rangeOverride.to})
                  </option>
                )}
              </select>
            </label>
            <button type="submit" className="btn-ghost self-start">
              Appliquer à cette carte
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
