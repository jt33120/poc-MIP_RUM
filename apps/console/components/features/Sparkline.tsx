// Mini-histogramme SVG inline (occurrences/h sur 24 h) — rendu serveur, zéro lib.
// Couleurs via currentColor/var() pour suivre le thème clair/sombre.
export function Sparkline({
  values,
  width = 96,
  height = 24,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);
  const barW = width / values.length;
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`${total} occurrence(s) sur 24 h`}
      className="text-red-500 dark:text-red-400"
    >
      <title>{`${total} occurrence(s) sur 24 h`}</title>
      {values.map((v, i) =>
        v > 0 ? (
          <rect
            key={i}
            x={(i * barW + 0.5).toFixed(1)}
            y={(height - (v / max) * (height - 2)).toFixed(1)}
            width={Math.max(barW - 1, 1).toFixed(1)}
            height={((v / max) * (height - 2)).toFixed(1)}
            fill="currentColor"
            rx="1"
          />
        ) : (
          <rect
            key={i}
            x={(i * barW + 0.5).toFixed(1)}
            y={height - 1.5}
            width={Math.max(barW - 1, 1).toFixed(1)}
            height="1.5"
            fill="rgb(var(--c-line))"
          />
        ),
      )}
    </svg>
  );
}
