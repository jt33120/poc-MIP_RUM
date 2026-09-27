"use client";
// Vues préréglées (F08, plan § 3.6, § 4.2, P13) — une rangée de liens sous la barre
// de segments : une vue = une question déjà posée, en un clic.
//
//   - VUES PRODUIT (`p:`) : calculées par le serveur (`vuesProduit`, lib/presets.ts)
//     et passées en props ; une vue incalculable est affichée DÉSACTIVÉE, avec sa
//     raison (jamais retirée en silence).
//   - VUES PERSONNELLES (`u:`) : les segments enregistrés du navigateur, lus ici au
//     montage ; « Enregistrer la vue actuelle » ouvre un champ en ligne (plus de
//     `window.prompt`), nom par défaut composé des facettes jointes par « • ».
//
// Une vue est un LIEN (fonctionne sans JavaScript, s'ouvre dans un onglet) qui ne
// change que des paramètres du contrat (+ `cmp`) : la plage, l'app et les réglages
// d'affichage restent. La vue active est celle dont l'URL porte exactement les
// paramètres ; elle est marquée `aria-current`.
//
// Les vues PASSENT À LA LIGNE, à toute largeur (recette du 26/09/2026) : à 390 px,
// la rangée défilante coupait sa dernière vue visible (« Dernie… ») contre
// « Enregistrer la vue », et le chevron de défilement ne suffisait pas à dire qu'il
// en restait. Chaque vue garde son libellé entier, sur une ou plusieurs lignes.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  EVENEMENT_SEGMENTS,
  ajouterSegment,
  ecrireSegmentsEnregistres,
  lireSegmentsEnregistres,
} from "@/components/segments-enregistres";
import { hrefDeVue, vueActuelle, vueCorrespond, vuesPersonnelles, type VuePrereglee } from "@/lib/presets";
import type { SavedSegment } from "@/lib/query-contract";

export type { VuePrereglee };

// `max-w-full` + coupure au caractère : une vue personnelle au nom long passe à la
// ligne dans sa pastille au lieu de dépasser la page à 390 px.
const PASTILLE =
  "inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-medium [overflow-wrap:anywhere] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

export function PresetBar({ vues, actif }: { vues: VuePrereglee[]; actif: string | null }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [enregistrees, setEnregistrees] = useState<SavedSegment[]>([]);
  const [saisie, setSaisie] = useState<string | null>(null);

  // localStorage n'est lu qu'au montage client ; l'autre barre prévient quand elle écrit.
  useEffect(() => {
    const relire = () => setEnregistrees(lireSegmentsEnregistres().items);
    relire();
    window.addEventListener(EVENEMENT_SEGMENTS, relire);
    window.addEventListener("storage", relire);
    return () => {
      window.removeEventListener(EVENEMENT_SEGMENTS, relire);
      window.removeEventListener("storage", relire);
    };
  }, []);

  const courants = useMemo(() => new URLSearchParams(sp.toString()), [sp]);
  const toutes = useMemo(() => [...vues, ...vuesPersonnelles(enregistrees)], [vues, enregistrees]);
  const actuelle = vueActuelle(courants);

  const estActive = (vue: VuePrereglee) =>
    !vue.indisponible && vueCorrespond(courants, vue) && (actif === null || actif === vue.id);

  function enregistrer() {
    if (!actuelle || saisie === null || !saisie.trim()) return;
    const liste = ajouterSegment(enregistrees, saisie, actuelle.seg);
    setEnregistrees(liste);
    ecrireSegmentsEnregistres(liste);
    setSaisie(null);
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="preset-bar">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Vues</span>
      <div className="relative min-w-0 flex-1">
        {/* `relative` : les textes sr-only (position absolue) des vues indisponibles se
            rangent dans la rangée ; positionnés par rapport au bloc parent, ils
            portaient la page à 695 px sur 390. */}
        <div className="relative flex min-w-0 flex-wrap items-center gap-1.5 py-0.5" role="list" aria-label="Vues préréglées">
          {toutes.map((vue) => {
            if (vue.indisponible) {
              return (
                <span
                  key={vue.id}
                  role="listitem"
                  aria-disabled="true"
                  title={vue.indisponible}
                  data-testid="preset-vue"
                  data-vue={vue.id}
                  data-indisponible="true"
                  className={`${PASTILLE} cursor-not-allowed border-dashed border-line text-ink-soft opacity-70`}
                >
                  {vue.libelle}
                  <span className="sr-only"> — indisponible : {vue.indisponible}</span>
                </span>
              );
            }
            const active = estActive(vue);
            return (
              <span key={vue.id} role="listitem" className="max-w-full">
                <Link
                  href={hrefDeVue(pathname, courants, vue)}
                  aria-current={active ? "true" : undefined}
                  data-testid="preset-vue"
                  data-vue={vue.id}
                  data-origine={vue.origine}
                  scroll={false}
                  className={`${PASTILLE} ${
                    active
                      ? // Même règle que les badges de santé (F01) : le TEXTE sur la teinte
                        // `bg-perf/10` passe en `perf-ink` en clair (4,5:1), `perf` en sombre.
                        "border-perf/50 bg-perf/10 text-perf-ink dark:text-perf"
                      : "border-line text-ink-soft hover:border-perf/40 hover:text-perf-ink dark:hover:text-perf"
                  } ${vue.origine === "personnelle" ? "italic" : ""}`}
                >
                  {vue.libelle}
                </Link>
              </span>
            );
          })}
        </div>
      </div>

      {saisie === null ? (
        <button
          type="button"
          onClick={() => actuelle && setSaisie(actuelle.nom)}
          disabled={!actuelle}
          title={actuelle ? "Enregistrer la population actuelle comme vue personnelle" : "Aucun filtre de population à enregistrer"}
          className="shrink-0 rounded-lg border border-dashed border-line px-2 py-0.5 text-xs font-medium text-ink-soft transition hover:border-perf/40 hover:text-perf disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="preset-enregistrer"
        >
          Enregistrer la vue
          <span className="sr-only"> actuelle</span>
        </button>
      ) : (
        <form
          className="flex shrink-0 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            enregistrer();
          }}
        >
          <label className="sr-only" htmlFor="preset-nom">
            Nom de la vue
          </label>
          <input
            id="preset-nom"
            autoFocus
            value={saisie}
            maxLength={100}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSaisie(null);
            }}
            className="w-32 rounded bg-app px-1.5 py-0.5 text-xs text-ink outline-none ring-1 ring-line focus:ring-perf/40 sm:w-48"
            data-testid="preset-nom"
          />
          <button type="submit" className="rounded bg-perf-ink px-2 py-0.5 text-xs font-semibold text-white hover:opacity-90">
            OK
          </button>
          <button type="button" onClick={() => setSaisie(null)} className="px-1 text-xs text-ink-soft hover:text-ink" aria-label="Annuler">
            ×
          </button>
        </form>
      )}
    </div>
  );
}
