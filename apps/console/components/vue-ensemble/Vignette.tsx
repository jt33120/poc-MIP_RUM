// Les pièces communes des vignettes de la Vue d'ensemble (recette du 30/09/2026) :
// une vignette est une case (`FicheMesure`) qui montre un titre et un dessin réduit, et
// qui s'ouvre sur le grand format (axes, légende chiffrée, méthode, source,
// alternative). Rendu serveur.
//
// POURQUOI DES PIÈCES COMMUNES. Côte à côte sur la même rangée, les vignettes du
// graphique principal, de « Charge, erreurs et LCP », des heatmaps, de la release et
// de l'angle mort doivent avoir le même en-tête, la même hauteur de dessin et le même
// geste : sinon la rangée se lit comme un assemblage.
//
// MINI-SÉRIES SANS BIBLIOTHÈQUE. Un aperçu de 20 px de haut n'a ni axe ni légende
// (charte § 3.3 : « un indice de forme, la vraie série est dans la fenêtre ») : un
// SVG rendu serveur suffit, sans recharts, sans hydratation. Mêmes vérités que les
// grands formats : une tranche sans mesure est un TROU (la ligne s'interrompt), un
// compte absent vaut 0, une lecture en échec ne dessine rien (« non lue »).
import type { ReactNode } from "react";
import { sommetRobuste } from "@/components/charts/GrapheMesure";
import { RATING_JETON } from "@/lib/palette";

/** Hauteur du dessin d'une vignette de série (recharts, `apercu`). */
export const HAUTEUR_VIGNETTE = 118;

/** L'en-tête d'une vignette : son titre à gauche, son contexte (tranches, plage) à droite. */
export function EnteteVignette({ titre, meta, id }: { titre: string; meta?: ReactNode; id?: string }) {
  return (
    <span className="flex min-w-0 items-center justify-between gap-2 text-[11px] font-medium text-ink-soft">
      <span id={id} className="min-w-0 truncate">
        {titre}
      </span>
      {meta != null && meta !== "" && <span className="shrink-0 whitespace-nowrap text-ink-faint">{meta}</span>}
    </span>
  );
}

/**
 * Le dessin d'une vignette, inerte : c'est la case ENTIÈRE qui s'ouvre. Un graphique
 * recharts pose des éléments focalisables ; dans un bouton, ils seraient un contenu
 * interactif imbriqué (`inert` les retire du parcours clavier).
 */
export function DessinVignette({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none mt-1 block min-w-0" inert>
      {children}
    </span>
  );
}

/**
 * Une mini-série SVG (aperçu, sans axe) : des barres pour un compte, une ligne pour
 * une mesure. `seuils` pose les bandes Bon / À améliorer / Mauvais derrière la ligne
 * (bornes web.dev, `lib/rating.ts`), à 10 % d'opacité.
 */
export function MiniSerie({
  valeurs,
  forme,
  couleur,
  seuils,
  hauteur = 22,
}: {
  valeurs: readonly (number | null)[];
  forme: "barres" | "ligne";
  /** Couleur CSS (jeton de thème) de la série. */
  couleur: string;
  seuils?: readonly [number, number];
  hauteur?: number;
}) {
  const n = valeurs.length;
  const mesurees = valeurs.filter((v): v is number => v != null && Number.isFinite(v));
  if (n === 0 || mesurees.length === 0) return <svg aria-hidden="true" className="block w-full" height={hauteur} />;
  const H = 20;
  const sommet = forme === "ligne" ? sommetRobuste(mesurees, seuils?.[1]) || 1 : Math.max(...mesurees) || 1;
  const y = (v: number) => H - (Math.min(v, sommet) / sommet) * (H - 1);

  // La ligne s'interrompt sur une tranche sans mesure : jamais de trait qui la traverse.
  const segments: string[][] = [[]];
  if (forme === "ligne") {
    valeurs.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) segments.push([]);
      else segments[segments.length - 1].push(`${(i + 0.5).toFixed(2)},${y(v).toFixed(2)}`);
    });
  }
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" className="block w-full" height={hauteur}>
      {forme === "ligne" && seuils && (
        <>
          <rect x={0} width={n} y={y(seuils[0])} height={H - y(seuils[0])} fill={RATING_JETON.good} fillOpacity={0.1} />
          {seuils[0] < sommet && (
            <rect x={0} width={n} y={y(seuils[1])} height={y(seuils[0]) - y(seuils[1])} fill={RATING_JETON["needs-improvement"]} fillOpacity={0.1} />
          )}
          {seuils[1] < sommet && <rect x={0} width={n} y={0} height={y(seuils[1])} fill={RATING_JETON.poor} fillOpacity={0.1} />}
        </>
      )}
      {forme === "barres"
        ? valeurs.map((v, i) =>
            v == null || !Number.isFinite(v) || v <= 0 ? null : (
              <rect key={i} x={i + 0.15} width={0.7} y={y(v)} height={Math.max(H - y(v), 0.6)} fill={couleur} />
            ),
          )
        : segments
            .filter((s) => s.length > 0)
            .map((s, j) =>
              s.length === 1 ? (
                <circle key={j} cx={s[0].split(",")[0]} cy={s[0].split(",")[1]} r={0.9} fill={couleur} />
              ) : (
                <polyline key={j} points={s.join(" ")} fill="none" stroke={couleur} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              ),
            )}
    </svg>
  );
}

/**
 * Un élément de la LIGNE DES ÉTATS de l'écran (recette du 30/09/2026 : « heatmap vide
 * en grande boîte ») : un bloc qui n'a rien à dessiner — lecture vide, comparaison
 * impossible, capacité non collectée — ne prend pas de case ; il se dit en quelques
 * mots, à côté des autres, sur une seule ligne grise. Le texte est la VÉRITÉ du bloc
 * (« non collecté », « moins de deux releases ») : il se déplace, il ne disparaît pas.
 */
export function LigneSansCase({
  titre,
  texte,
  id,
  titreId,
  testId,
  texteTestId,
  etat,
  children,
}: {
  titre: string;
  texte: ReactNode;
  /** Ancre du bloc (cible de l'assistant et des e2e : `#heatmap-latence`, `#historique`). */
  id?: string;
  /** Ancre du titre (`#release-titre`, cible du bandeau « Dernier déploiement »). */
  titreId?: string;
  testId?: string;
  texteTestId?: string;
  etat?: string;
  /** Ce que le bloc garde pour les lecteurs d'écran et les e2e (fenêtre, règle…). */
  children?: ReactNode;
}) {
  return (
    <span id={id} role="note" className="flex min-w-0 scroll-mt-16 items-baseline gap-1.5" data-testid={testId} data-etat={etat}>
      <span aria-hidden className="shrink-0 text-sm leading-none text-ink-faint">
        ⊘
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <strong id={titreId} className="font-medium text-ink">
          {titre}
        </strong>{" "}
        <span data-testid={texteTestId}>{texte}</span>
        {children}
      </span>
    </span>
  );
}

/** Une bande de vignette : libellé et valeur à gauche, la mini-série à droite. */
export function BandeMini({ libelle, valeur, children }: { libelle: string; valeur: string; children: ReactNode }) {
  return (
    <span className="grid min-w-0 grid-cols-[6.25rem_minmax(0,1fr)] items-center gap-2">
      <span className="flex min-w-0 items-baseline justify-between gap-1 text-[10px] text-ink-soft">
        <span className="truncate">{libelle}</span>
        <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-ink">{valeur}</span>
      </span>
      <span className="block min-w-0">{children}</span>
    </span>
  );
}
