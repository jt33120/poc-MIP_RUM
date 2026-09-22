"use client";
// Sélecteur de comparaison (F06, plan § 3.2) — à droite des presets de période.
//
// Trois modes, portés par l'URL (`cmp`, `rel_a`, `rel_b`, lib/view-state.ts) et
// reportés d'un écran à l'autre par la navigation : période précédente, release
// contre release (même fenêtre), aucune. Le défaut dépend de l'écran (précédente
// sur Performance, aucune ailleurs) et ne s'écrit pas dans l'URL.
//
// Le mode « Release » n'est proposé qu'avec au moins deux releases sur la fenêtre :
// sinon il est désactivé et dit pourquoi — jamais une comparaison d'une release à
// elle-même, ni à un libellé « (non renseignée) » qui n'en est pas une.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { INPUT_CLASS } from "@/components/forms/Field";
import { Segmented } from "@/components/GlobalFilters";
import { ecrireEtatDeVue, type ModeComparaison } from "@/lib/view-state";

const LIBELLES: Record<ModeComparaison, string> = {
  prev: "Période précédente",
  release: "Releases",
  none: "Aucune",
};

export function CompareToggle({
  mode,
  releases,
  relA,
  relB,
  raison,
}: {
  mode: ModeComparaison;
  /** `null` = liste indisponible ; moins de deux → mode release désactivé avec sa raison. */
  releases: string[] | null;
  relA: string | null;
  relB: string | null;
  /** Pourquoi la liste est indisponible (lecture en cours, filtre non porté…). */
  raison?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const indisponible =
    releases === null
      ? `Comparaison de releases indisponible : ${raison ?? "liste des releases non lue"}.`
      : releases.length < 2
        ? "Comparaison de releases indisponible : moins de deux releases sur la fenêtre."
        : null;

  function naviguer(prochain: { mode: ModeComparaison; relA: string | null; relB: string | null }) {
    const next = new URLSearchParams(sp.toString());
    const params = ecrireEtatDeVue(pathname, { cmp: prochain.mode, relA: prochain.relA, relB: prochain.relB });
    for (const [cle, valeur] of Object.entries(params)) {
      if (valeur === null) next.delete(cle);
      else next.set(cle, valeur);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // Une release de l'URL absente de la fenêtre reste sélectionnable (lien ancien,
  // plage déplacée) : l'effacer en silence changerait la comparaison affichée.
  const options = (courante: string | null) =>
    courante !== null && !(releases ?? []).includes(courante) ? [...(releases ?? []), courante] : (releases ?? []);

  const choix = (cle: "relA" | "relB", libelle: string, valeur: string | null, autre: string | null) => (
    <label className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-soft">
      {libelle}
      <select
        value={valeur ?? ""}
        onChange={(event) => {
          const choisie = event.target.value || null;
          naviguer({ mode: "release", relA: cle === "relA" ? choisie : relA, relB: cle === "relB" ? choisie : relB });
        }}
        data-testid={`compare-${cle === "relA" ? "rel-a" : "rel-b"}`}
        className={`${INPUT_CLASS} max-w-[10rem] text-xs`}
      >
        {/* Sans choix, l'écran applique la règle du § 3.2 (dernier déploiement déclaré). */}
        <option value="">Par défaut</option>
        {options(valeur).map((release) => (
          // Une release ne se compare pas à elle-même : celle de l'autre sélecteur est grisée.
          <option key={release} value={release} disabled={release === autre}>
            {releases?.includes(release) ? release : `${release} (absente de la fenêtre)`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="compare-toggle">
      {/* Libellé visible ; le groupe porte le sien (« Comparaison ») pour les lecteurs d'écran. */}
      <span aria-hidden className="text-xs font-medium text-ink-faint">
        Comparer à
      </span>
      <Segmented
        label="Comparaison"
        testid="filter-compare"
        availability={{ available: true }}
        items={(["prev", "release", "none"] as const).map((key) => ({
          key,
          label: LIBELLES[key],
          ...(key === "release" && indisponible ? { availability: { available: false, reason: indisponible } } : {}),
        }))}
        value={mode}
        onChange={(key) =>
          naviguer({ mode: key as ModeComparaison, relA: key === "release" ? relA : null, relB: key === "release" ? relB : null })
        }
      />
      {mode === "release" &&
        (indisponible ? (
          <span role="note" className="text-[11px] text-ink-soft" data-testid="compare-indisponible">
            {indisponible}
          </span>
        ) : (
          <>
            {choix("relB", "Release comparée (B)", relB, relA)}
            {choix("relA", "Référence (A)", relA, relB)}
          </>
        ))}
    </div>
  );
}
