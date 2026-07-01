// Carte d'un widget de tableau de bord : titre + contrôles (monter / descendre /
// retirer via server actions) + corps. Rendu serveur. Extrait de
// app/dashboards/[id]/page.tsx.
import { moveWidgetAction, removeWidgetAction } from "@/app/dashboards/actions";
import type { WidgetData } from "@/lib/widget-data";
import { WidgetBody } from "./WidgetBody";

export function WidgetCard({
  id,
  index,
  count,
  title,
  data,
}: {
  id: number;
  index: number;
  count: number;
  title: string;
  data: WidgetData;
}) {
  return (
    <div className="card flex flex-col gap-3 p-4" data-testid={`widget-${index}`}>
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">{title}</h3>
        <div className="flex shrink-0 items-center gap-1">
          <form action={moveWidgetAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="index" value={index} />
            <input type="hidden" name="dir" value="up" />
            <button
              type="submit"
              disabled={index === 0}
              aria-label="Monter"
              className="btn-ghost px-2 py-1 disabled:opacity-30"
            >
              ↑
            </button>
          </form>
          <form action={moveWidgetAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="index" value={index} />
            <input type="hidden" name="dir" value="down" />
            <button
              type="submit"
              disabled={index === count - 1}
              aria-label="Descendre"
              className="btn-ghost px-2 py-1 disabled:opacity-30"
            >
              ↓
            </button>
          </form>
          <form action={removeWidgetAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="index" value={index} />
            <button
              type="submit"
              aria-label="Retirer"
              className="btn-ghost px-2 py-1 text-red-600"
            >
              ✕
            </button>
          </form>
        </div>
      </div>
      <WidgetBody data={data} />
    </div>
  );
}
