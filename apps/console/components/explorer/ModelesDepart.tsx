// ModelesDepart — les analyses de départ de l'Explorer (F31, W-E1, plan § 4.3).
// Rendu serveur, sans graphique.
//
// UNE CARTE NE LIT RIEN. Ce sont des liens vers l'Explorer exécuté (`run=1`) : la
// lecture part au clic, jamais à l'affichage. Le préchargement est coupé
// (`prefetch={false}`) pour que cela reste vrai quel que soit le routeur : un
// lien préchargé qui porte `run=1` exécuterait l'analyse sans que personne ne
// l'ait demandée.
//
// UNE CARTE INAPPLICABLE EST MONTRÉE, avec sa raison écrite (pas dans un `title`),
// et sans lien : cliquer mènerait à un refus.
//
// `compact` : une liste d'une ligne par modèle, pour les écrans où les modèles
// accompagnent autre chose (« Modèles fournis » des vues enregistrées, F34).
import Link from "next/link";
import type { ModeleDepart } from "@/lib/explorer-modeles";
import { PictoRepresentation } from "./PictoRepresentation";

export function ModelesDepart({ modeles, compact = false }: { modeles: ModeleDepart[]; compact?: boolean }) {
  if (compact) {
    return (
      <ul data-testid="modeles-depart" className="divide-y divide-line/60">
        {modeles.map((m) => (
          <li key={m.cle} data-modele={m.cle} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
            {m.href ? (
              <Link
                href={m.href}
                prefetch={false}
                className="min-w-0 rounded font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              >
                {m.titre}
              </Link>
            ) : (
              <span aria-disabled="true" className="min-w-0 font-medium text-ink-soft">
                {m.titre}
              </span>
            )}
            <span className="min-w-0 text-xs text-ink-soft">{m.href ? m.question : `Indisponible : ${m.raison ?? "raison inconnue"}`}</span>
          </li>
        ))}
      </ul>
    );
  }

  // Des cases de même gabarit (recette du 30/09/2026) : le pictogramme de la forme du
  // résultat, le titre, la question en petit ; trois par rangée, gouttière de 8 px.
  return (
    <ul data-testid="modeles-depart" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {modeles.map((m) => (
        <li key={m.cle} data-modele={m.cle} className="flex min-w-0">
          {m.href ? (
            <Link
              href={m.href}
              prefetch={false}
              className="card group flex w-full min-w-0 items-start gap-3 px-3 py-2.5 transition hover:border-perf/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            >
              {m.representation && (
                <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-perf/10 text-perf">
                  <PictoRepresentation representation={m.representation} className="h-4 w-4" />
                </span>
              )}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-ink group-hover:text-brand">{m.titre}</span>
                <span className="text-[11px] leading-snug text-ink-soft">{m.question}</span>
              </span>
            </Link>
          ) : (
            <div aria-disabled="true" className="card flex w-full min-w-0 items-start gap-3 border-dashed px-3 py-2.5">
              {m.representation && (
                <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel2 text-ink-faint">
                  <PictoRepresentation representation={m.representation} className="h-4 w-4" />
                </span>
              )}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-ink-soft">{m.titre}</span>
                <span className="text-[11px] leading-snug text-ink-soft">{m.question}</span>
                <span className="text-[11px] text-ink">Indisponible : {m.raison ?? "raison inconnue"}</span>
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
