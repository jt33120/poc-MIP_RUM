// Barres horizontales classées — rendu serveur (divs + largeur %, zéro JS
// client), même idiome que Funnel / BoundaryCard. Brique dataviz générique du
// chantier supervision : « quelles catégories dominent » (routes lentes,
// objectifs, friction par champ, canaux d'acquisition, décomposition de latence…).
// Le composant est bête : il reçoit des lignes déjà triées et déjà colorées.
import type { ReactNode } from "react";
import Link from "next/link";

export interface RankSegment {
  value: number;
  /** Couleur CSS de la portion (barre empilée). */
  color: string;
  label?: string; // pour l'infobulle
}

export interface RankDatum {
  label: string;
  /**
   * Valeur pilotant la largeur ET affichée à droite (sauf `display`). `null` :
   * non calculable — AUCUNE barre (une barre de longueur nulle se lirait « le
   * meilleur »), « — » à droite.
   */
  value: number | null;
  /** Texte de valeur formaté (défaut : `value` brut). */
  display?: ReactNode;
  /** Couleur CSS de la barre (défaut : accent). Ignoré si `segments`. */
  color?: string;
  /** Sous-texte discret sous le libellé (ex. volume, contexte). */
  sub?: ReactNode;
  /** Rend le libellé cliquable. */
  href?: string;
  /** Barre empilée : portions colorées (leur somme pilote la largeur). */
  segments?: RankSegment[];
  /** Infobulle de la ligne. */
  title?: string;
}

export function RankBar({
  data,
  max,
  labelWidth = "11rem",
  barClassName = "",
  emptyLabel = "Aucune donnée sur la fenêtre.",
}: {
  data: RankDatum[];
  /** Base 100 % de la largeur (défaut : max des valeurs). Passe 1 ou 100 pour des taux. */
  max?: number;
  /** Largeur de la colonne des libellés. */
  labelWidth?: string;
  /** Classe additionnelle sur chaque barre (ex. mono). */
  barClassName?: string;
  emptyLabel?: string;
}) {
  if (!data.length) {
    return <p className="py-10 text-center text-sm text-ink-faint">{emptyLabel}</p>;
  }
  const base = max ?? Math.max(...data.map((d) => d.value ?? 0), 1);
  const ACCENT = "#f89101";

  return (
    <div className="flex flex-col gap-2">
      {data.map((d, i) => {
        const w = d.value === null ? 0 : base > 0 ? Math.max(2, (d.value / base) * 100) : 0;
        const label = (
          <span className="truncate" title={d.label}>
            {d.label}
          </span>
        );
        return (
          <div key={`${d.label}-${i}`} className="flex items-center gap-3" title={d.title}>
            <div
              className="shrink-0 text-xs text-ink"
              style={{ width: labelWidth }}
            >
              {d.href ? (
                <Link href={d.href} className="block truncate font-medium hover:text-accent hover:underline">
                  {d.label}
                </Link>
              ) : (
                <div className="block font-medium">{label}</div>
              )}
              {d.sub && <div className="truncate text-[10px] text-ink-faint">{d.sub}</div>}
            </div>
            <div className={`relative h-6 flex-1 overflow-hidden rounded bg-panel2 ${barClassName}`}>
              {d.segments ? (
                <div className="flex h-full">
                  {d.segments.map((s, j) => (
                    <div
                      key={j}
                      className="h-full first:rounded-l last:rounded-r"
                      style={{
                        width: `${base > 0 ? (s.value / base) * 100 : 0}%`,
                        backgroundColor: s.color,
                      }}
                      title={s.label}
                    />
                  ))}
                </div>
              ) : d.value === null ? null : (
                <div
                  className="h-full rounded"
                  style={{ width: `${w}%`, backgroundColor: d.color ?? ACCENT }}
                />
              )}
              <span className="absolute inset-y-0 right-2 flex items-center text-xs font-semibold tabular-nums text-ink">
                {d.display ?? (d.value === null ? "—" : d.value.toLocaleString("fr-FR"))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
