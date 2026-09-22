// Entonnoir (Lot 6c ; refondu par F50, plan § 5.13.4) — sélecteur d'étapes
// (form GET, sans JS client) + rendu des barres de conversion. Le sélecteur
// préserve les filtres courants via des champs cachés.
//
// CE QUE F50 CHANGE, ET POURQUOI.
//   - Deux taux NOMMÉS par étape. Une seule valeur « 67 % » posée à droite d'une
//     barre ne dit pas de quoi elle est la part : la vidéo Datadog met les deux
//     conventions sur la même barre sans les nommer, et on ne sait plus si la
//     marche perd un tiers de ses entrants ou deux tiers du départ. Ici les deux
//     sont écrits, chacun avec son dénominateur : « 67 % de l'étape précédente »
//     et « 22 % du départ ».
//   - La PLUS FORTE PERTE est encadrée et dite : c'est la réponse à « où
//     décroche-t-on ? », qui se lisait jusqu'ici en comparant quatre nombres.
//   - L'abandon passe au jeton `bad` (il était en `red-600` écrit en dur, hors
//     palette) ; il reste un COMPTE, jamais un pourcentage.
//   - Les options du sélecteur sont annotées « nom (N sessions) » : la lecture
//     renvoie déjà ce compte, et choisir une étape à l'aveugle donnait des
//     entonnoirs qui partent de zéro.
//   - Alternative textuelle intégrée (P10) : les mêmes lignes que les barres.
import Link from "next/link";
import type { ReactNode } from "react";
import { TableAlternative } from "./charts/Figure";
import { etapeLaPlusPerdante, type FunnelStep } from "@/lib/funnel";
import { formater } from "@/lib/fmt-ids";
import type { EventOption } from "@/lib/queries-funnel";

const MAX_STEPS = 4;

/** Taux sans dénominateur (personne à l'étape de référence) : « — », jamais « 0 % » (V3). */
const taux = (v: number | null) => formater("pct", v);
const compte = (n: number) => formater("count", n);

/** Les deux dénominateurs, nommés une fois pour toutes (rendu ET alternative). */
export const LIBELLE_DEPART = "du départ";
export const LIBELLE_PRECEDENTE = "de l'étape précédente";

/** Champs cachés reprenant les filtres courants (tout sauf les étapes s1..sN). */
function preservedParams(sp: Record<string, string | string[] | undefined>) {
  const skip = new Set(Array.from({ length: MAX_STEPS }, (_, i) => `s${i + 1}`));
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(sp)) {
    if (skip.has(k)) continue;
    if (typeof v === "string") out.push([k, v]);
  }
  return out;
}

/** « checkout (128 sessions) » : le volume de l'étape, avant de la choisir. */
export function optionEvenement(e: EventOption): string {
  return `${e.name} (${compte(e.sessions)} ${e.sessions > 1 ? "sessions" : "session"})`;
}

export function StepPicker({
  events,
  selected,
  sp,
}: {
  events: EventOption[];
  selected: string[];
  sp: Record<string, string | string[] | undefined>;
}) {
  return (
    <form method="GET" className="flex flex-wrap items-end gap-3" data-testid="funnel-picker">
      {preservedParams(sp).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {Array.from({ length: MAX_STEPS }, (_, i) => (
        // Sous 640 px, une étape prend toute la largeur (`basis-full`) : quatre
        // sélecteurs côte à côte y devenaient illisibles, et un `select` à 12 rem
        // débordait de la carte.
        <label key={i} className="min-w-0 basis-full text-xs font-medium text-ink-soft sm:basis-auto">
          Étape {i + 1}
          <select name={`s${i + 1}`} defaultValue={selected[i] ?? ""} className="field mt-1 block w-full sm:w-48">
            <option value="">—</option>
            {events.map((e) => (
              <option key={e.name} value={e.name}>
                {optionEvenement(e)}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit" className="btn-accent">
        Construire l&apos;entonnoir
      </button>
    </form>
  );
}

/** Une étape : sa barre, ses deux taux nommés, son abandon — et son encadré s'il perd le plus. */
export function FunnelChart({
  steps,
  lienJournal,
  alternative = true,
}: {
  steps: FunnelStep[];
  /** « Voir au Journal » d'une étape (`/events?name=…`), calculé côté serveur. */
  lienJournal?: (nom: string) => string;
  /** false : l'alternative est portée par la `Figure` englobante (pas de doublon). */
  alternative?: boolean;
}) {
  if (!steps.length) return null;
  const start = steps[0]?.reached ?? 0;
  const pire = etapeLaPlusPerdante(steps);

  const lignes: ReactNode[][] = steps.map((s) => [
    `${s.ord}. ${s.name}`,
    compte(s.reached),
    s.ord === 1 ? "—" : taux(s.convFromPrev),
    taux(s.convFromStart),
    s.ord === 1 ? "—" : compte(s.dropoff),
    s.ord === pire ? "plus forte perte" : "—",
  ]);

  return (
    <div className="min-w-0">
      <ol className="mt-4 flex flex-col gap-2">
        {steps.map((s) => {
          const w = start > 0 ? Math.max(2, (s.reached / start) * 100) : 0;
          const laPire = s.ord === pire;
          return (
            <li
              key={s.ord}
              data-testid="funnel-etape"
              data-pire={laPire ? "1" : undefined}
              className={`min-w-0 rounded-lg p-2 ${laPire ? "border border-bad/40 bg-bad/5" : "border border-transparent"}`}
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={s.name}>
                  <span className="text-ink-faint">{s.ord}.</span> {s.name}
                </span>
                {laPire && (
                  <span className="shrink-0 rounded bg-bad/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bad-ink">
                    plus forte perte
                  </span>
                )}
                {lienJournal && (
                  <Link
                    href={lienJournal(s.name)}
                    className="shrink-0 text-[11px] font-medium text-brand hover:underline"
                    title={`Voir « ${s.name} » au Journal`}
                  >
                    Voir au Journal
                  </Link>
                )}
              </div>
              <div className="relative mt-1 h-6 min-w-0 overflow-hidden rounded bg-panel2">
                <div className="h-full rounded bg-accent/70" style={{ width: `${w}%` }} />
                {/* Un chiffre posé sur une barre colorée va sur une pastille : sinon il
                    perd son contraste dès que la barre passe dessous (mode sombre). */}
                <span className="absolute inset-y-0 left-1.5 flex items-center">
                  <span className="rounded bg-panel/90 px-1 text-xs font-semibold tabular-nums text-ink">
                    {compte(s.reached)}
                  </span>
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-ink-soft">
                {s.ord > 1 && (
                  <span data-testid="taux-precedente">
                    <strong className="font-semibold text-ink">{taux(s.convFromPrev)}</strong> {LIBELLE_PRECEDENTE}
                  </span>
                )}
                <span data-testid="taux-depart">
                  <strong className="font-semibold text-ink">{taux(s.convFromStart)}</strong> {LIBELLE_DEPART}
                </span>
                {s.ord > 1 && (
                  <span className="text-bad-ink" title="sessions perdues depuis l'étape précédente">
                    −{compte(s.dropoff)} {s.dropoff > 1 ? "sessions" : "session"}
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ol>
      {alternative && (
        <TableAlternative
          alternative={{
            legende: "Entonnoir : sessions atteintes par étape, conversion et abandon",
            colonnes: ["Étape", "Sessions", `Taux ${LIBELLE_PRECEDENTE}`, `Taux ${LIBELLE_DEPART}`, "Abandon", "Marche"],
            lignes,
          }}
        />
      )}
    </div>
  );
}
