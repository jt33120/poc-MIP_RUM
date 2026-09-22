// Mini-histogramme SVG inline des occurrences d'un groupe, un seau par barre —
// rendu serveur, zéro lib. Couleurs via currentColor/var() pour suivre le thème.
//
// Le libellé vient de l'appelant : la version précédente (components/features/
// Sparkline) annonçait « sur 24 h » en dur, quelle que soit la période choisie —
// un lecteur d'écran entendait une autre fenêtre que celle dessinée.
//
// REMPLACÉ par `components/charts/Sparkline` (F03, plan § 4.1) : les listes
// d'erreurs y passent avec une échelle commune (`max`) dans leur propre lot (F19,
// `IssueList` et `/errors`) ; ce fichier est supprimé quand plus rien ne l'importe.
const WIDTH = 96;
const HEIGHT = 24;

/** @deprecated Employer `Sparkline` (components/charts/Sparkline.tsx), avec `max` pour une liste. */
export function GroupSparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 1);
  const barW = WIDTH / Math.max(values.length, 1);
  return (
    <svg width={WIDTH} height={HEIGHT} role="img" aria-label={label} className="text-bad-ink">
      <title>{label}</title>
      {values.map((v, i) =>
        v > 0 ? (
          <rect
            key={i}
            x={(i * barW + 0.5).toFixed(1)}
            y={(HEIGHT - (v / max) * (HEIGHT - 2)).toFixed(1)}
            width={Math.max(barW - 1, 1).toFixed(1)}
            height={((v / max) * (HEIGHT - 2)).toFixed(1)}
            fill="currentColor"
            rx="1"
          />
        ) : (
          <rect
            key={i}
            x={(i * barW + 0.5).toFixed(1)}
            y={HEIGHT - 1.5}
            width={Math.max(barW - 1, 1).toFixed(1)}
            height="1.5"
            fill="rgb(var(--c-line))"
          />
        ),
      )}
    </svg>
  );
}
