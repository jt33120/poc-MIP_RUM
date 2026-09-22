// Barres horizontales classées — rendu serveur (divs + largeur %, zéro JS
// client), même idiome que Funnel / BoundaryCard. Brique dataviz générique du
// chantier supervision : « quelles catégories dominent » (routes lentes,
// objectifs, friction par champ, canaux d'acquisition, décomposition de latence…).
// Le composant est bête : il reçoit des lignes déjà triées et déjà colorées.
//
// F03 (plan § 4.1) — props de ligne inchangées ; trois ajouts :
//   - l'alternative textuelle INTÉGRÉE : un tableau replié, mêmes lignes que les
//     barres (libellé, valeur affichée, sous-texte), pour qui ne voit pas les
//     longueurs ;
//   - à 390 px, la colonne des libellés passe à 7rem au plus : 11rem de libellé
//     laissaient 120 px à la barre, et une valeur longue la recouvrait ;
//   - la couleur par défaut vient de `lib/palette.ts` (la série principale).
// Sans lien dans ses lignes, le bloc des barres est une image (`role="img"`) ;
// avec des liens, c'est une liste — un `role="img"` masquerait les liens.
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { TableAlternative } from "./Figure";
import { SERIE } from "@/lib/palette";

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
  /** Couleur CSS de la barre (défaut : série principale). Ignoré si `segments`. */
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

/** Le texte de valeur d'une ligne, tel qu'affiché à droite de la barre. */
function valeurAffichee(d: RankDatum): ReactNode {
  return d.display ?? (d.value === null ? "—" : d.value.toLocaleString("fr-FR"));
}

export function RankBar({
  data,
  max,
  labelWidth = "11rem",
  barClassName = "",
  emptyLabel = "Aucune donnée sur la fenêtre.",
  legende = "Valeurs du classement",
  alternative = true,
}: {
  data: RankDatum[];
  /** Base 100 % de la largeur (défaut : max des valeurs). Passe 1 ou 100 pour des taux. */
  max?: number;
  /** Largeur de la colonne des libellés (7rem au plus sous 640 px). */
  labelWidth?: string;
  /** Classe additionnelle sur chaque barre (ex. mono). */
  barClassName?: string;
  emptyLabel?: string;
  /** Légende du tableau d'alternative, et nom de l'image quand aucune ligne n'est un lien. */
  legende?: string;
  /** false : l'alternative est portée par la `Figure` englobante (pas de doublon). */
  alternative?: boolean;
}) {
  if (!data.length) {
    return <p className="py-10 text-center text-sm text-ink-faint">{emptyLabel}</p>;
  }
  const base = max ?? Math.max(...data.map((d) => d.value ?? 0), 1);
  const avecLiens = data.some((d) => d.href);
  const avecSous = data.some((d) => d.sub != null);
  // La largeur voulue passe par une variable CSS : sous 640 px, min(7rem, voulue).
  const largeurLibelle = { "--rank-label": labelWidth } as CSSProperties;

  return (
    <div className="min-w-0">
      <div
        className="flex flex-col gap-2"
        role={avecLiens ? "list" : "img"}
        aria-label={avecLiens ? undefined : legende}
        style={largeurLibelle}
      >
        {data.map((d, i) => {
          const w = d.value === null ? 0 : base > 0 ? Math.max(2, (d.value / base) * 100) : 0;
          const label = (
            // `block` : `truncate` ne coupe pas un élément en ligne — une route longue
            // sans espace sortait de sa colonne de 7rem et portait la page à 725 px à 390.
            <span className="block truncate" title={d.label}>
              {d.label}
            </span>
          );
          return (
            <div
              key={`${d.label}-${i}`}
              className="flex items-center gap-3"
              title={d.title}
              role={avecLiens ? "listitem" : undefined}
            >
              <div className="w-[min(7rem,var(--rank-label))] shrink-0 text-xs text-ink sm:w-[var(--rank-label)]">
                {d.href ? (
                  <Link href={d.href} className="block truncate font-medium hover:text-accent hover:underline">
                    {d.label}
                  </Link>
                ) : (
                  <div className="block font-medium">{label}</div>
                )}
                {d.sub && <div className="truncate text-[10px] text-ink-faint">{d.sub}</div>}
              </div>
              <div className={`relative h-6 min-w-0 flex-1 overflow-hidden rounded bg-panel2 ${barClassName}`}>
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
                    style={{ width: `${w}%`, backgroundColor: d.color ?? SERIE.principale }}
                  />
                )}
                {/* Pastille sous la valeur : quand la barre remplit la piste, le texte se
                    posait sur la couleur de la barre (3,7:1 sur le rouge d'un verdict). */}
                <span className="absolute inset-y-0 right-2 flex items-center">
                  <span className="rounded bg-panel/90 px-1 text-xs font-semibold tabular-nums text-ink">
                    {valeurAffichee(d)}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {alternative && (
        <TableAlternative
          alternative={{
            legende,
            colonnes: avecSous ? ["Libellé", "Valeur", "Détail"] : ["Libellé", "Valeur"],
            lignes: data.map((d) =>
              avecSous ? [d.label, valeurAffichee(d), d.sub ?? null] : [d.label, valeurAffichee(d)],
            ),
          }}
        />
      )}
    </div>
  );
}
