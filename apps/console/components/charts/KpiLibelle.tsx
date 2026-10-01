// KpiLibelle — une tuile dont la valeur est un TEXTE (F03, plan § 4.2) : « Page
// d'entrée n°1 : /partners · 28 sessions sur 28 », « Service le plus sollicité ».
// Même gabarit que `KpiTile`, sans delta ni verdict : un libellé ne se compare pas
// en pourcentage et n'a pas de seuil.
//
// Inconnu → « — » et sa raison (V3), jamais une chaîne vide qui se lirait
// « aucune page d'entrée ». Un texte long (une route) se coupe n'importe où plutôt
// que d'élargir la page à 390 px.
import { CadreTuile } from "./KpiTile";

export function KpiLibelle({
  label,
  texte,
  raisonNull,
  lecture,
  href,
}: {
  /** « Page d'entrée n°1 », « Service le plus sollicité ». */
  label: string;
  /** « /partners · 28 sessions sur 28 », « GET /api/panier · 1 240 appels ». */
  texte: string | null;
  /** Obligatoire si texte === null. */
  raisonNull?: string;
  lecture?: string;
  href?: string;
}) {
  const connu = texte != null && texte.trim() !== "";
  const ariaLabel = [`${label} ${connu ? texte : "—"}`, !connu ? raisonNull : null, lecture]
    .filter(Boolean)
    .join(", ");
  return (
    // Le gabarit des cases (30/09/2026) : libellé, texte, rien d'autre à l'écran ; la
    // raison d'un « — » et la lecture au survol et pour les lecteurs d'écran.
    <CadreTuile href={href} ariaLabel={ariaLabel} testId="kpi-libelle" compact titre={[!connu ? raisonNull : null, lecture].filter(Boolean).join(" · ") || undefined}>
      <span className="min-w-0 truncate text-[11px] font-medium text-ink-soft">{label}</span>
      <span
        className="line-clamp-2 min-w-0 text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]"
        data-testid="kpi-libelle-texte"
      >
        {connu ? texte : "—"}
      </span>
      <span className="sr-only">
        {!connu && raisonNull && <span data-testid="kpi-raison">{raisonNull}</span>}
        {lecture && <span> {lecture}</span>}
      </span>
    </CadreTuile>
  );
}
