// Flux Sankey (Lot 6b ; refondu par F50, plan § 4.1 et § 5.13.4) — rendu SVG
// déterministe, sans lib graphique. Consomme le modèle normalisé de `lib/sankey`
// (nœuds gauche/droite + rubans). Sources à gauche, cibles à droite ; épaisseur
// des rubans ∝ volume. Rendu serveur : les liens sont calculés par l'appelant.
//
// CE QUE F50 CHANGE, ET POURQUOI.
//   - Le TOTAL est écrit sur chaque nœud. Une épaisseur ne se lit pas : deux
//     rubans voisins de 40 et 44 sessions paraissent identiques, et l'image ne
//     disait nulle part combien de sessions passaient par une route.
//   - La HAUTEUR suit le nombre de nœuds (`hauteurSankey`) : à 380 px fixes,
//     trois routes donnaient trois rubans obèses et huit routes des filets.
//   - Les COULEURS sont neutres. La teinte venait d'un hachage du nom de la route
//     (`colorFor`) : elle variait d'un écran à l'autre pour la même route et se
//     lisait comme une catégorie, alors qu'elle n'encodait rien (P15). Les nœuds
//     prennent le gris du texte secondaire, les rubans la série principale à 30 %.
//   - Les rubans et les nœuds sont des LIENS (quand l'appelant en fournit) :
//     un ruban ouvre les sessions passées par la route d'arrivée, un nœud ouvre
//     la route dans `/pages`. Mêmes liens dans l'alternative textuelle : qui ne
//     voit pas les rubans doit pouvoir faire le même geste.
import Link from "next/link";
import type { ReactNode } from "react";
import { TableAlternative } from "./charts/Figure";
import { SERIE } from "@/lib/palette";
import { hauteurSankey, type SankeyModel } from "@/lib/sankey";

const W = 720;
const MARGIN = 150; // marge latérale réservée aux libellés de routes
const NODE_W = 12;
const X0 = MARGIN; // bord droit des nœuds source = X0 + NODE_W
const X1 = W - MARGIN - NODE_W; // bord gauche des nœuds cible
const RX0 = X0 + NODE_W;
const XM = (RX0 + X1) / 2;

/**
 * Où mènent les nœuds et les rubans. Calculé par l'appelant (§ 0.3 : un lien
 * porte la query courante, que le composant ne connaît pas). `ancrer` n'est fourni
 * que par un appelant dont la lecture sait filtrer sur une route de départ
 * (`routeTransitions(f, n, { depuis })`, B31) : un lien d'ancrage qui ne filtrerait
 * rien mentirait sur ce que fait le clic.
 */
export interface LiensSankey {
  /** Sessions passées par cette route (cible d'un ruban). */
  sessions?: (route: string) => string;
  /** Détail de la route dans `/pages` (nœud). */
  pages?: (route: string) => string;
  /** Ancrer le flux « à partir de » cette route (nœud gauche). */
  ancrer?: (route: string) => string;
}

function trunc(s: string, n = 22): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const compte = (n: number) => n.toLocaleString("fr-FR");

/** « 128 passages » / « 1 passage » : le total d'un nœud, accordé. */
const passages = (n: number) => `${compte(n)} ${n > 1 ? "passages" : "passage"}`;

/** Le libellé d'un nœud : sa route et son total, jamais l'un sans l'autre. */
const libelleNoeud = (route: string, total: number) => `${trunc(route)} · ${compte(total)}`;

/** Un texte, ou ce même texte cliquable — sans forcer un lien là où il n'y en a pas. */
function PeutEtreLien({ href, title, children }: { href?: string; title: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href} title={title} className="font-medium text-ink hover:text-accent hover:underline">
      {children}
    </Link>
  );
}

export function Sankey({
  model,
  ancre = null,
  hauteur,
  liens = {},
  alternative = true,
}: {
  model: SankeyModel;
  /** Route d'ancrage « à partir de », quand le flux est restreint à ses départs. */
  ancre?: string | null;
  /** Hauteur en px ; défaut : `hauteurSankey(model)` (120 + 36 par nœud, plafond 380). */
  hauteur?: number;
  liens?: LiensSankey;
  /** false : l'alternative est portée par la `Figure` englobante (pas de doublon). */
  alternative?: boolean;
}) {
  if (!model.links.length) {
    return <p className="py-8 text-center text-ink-faint">Pas assez de transitions pour un flux</p>;
  }
  const H = hauteur ?? hauteurSankey(model);
  const y = (v: number) => v * H;
  const depuis = ancre ? ` à partir de ${ancre}` : "";
  const legende = `Flux de navigation entre routes (source vers cible)${depuis}`;
  const cliquable = Boolean(liens.sessions || liens.pages || liens.ancrer);

  const lignes: ReactNode[][] = model.links.map((l) => [
    <PeutEtreLien key={`de-${l.from}`} href={liens.pages?.(l.from)} title={`Ouvrir /pages : ${l.from}`}>
      {l.from}
    </PeutEtreLien>,
    <PeutEtreLien key={`vers-${l.to}`} href={liens.pages?.(l.to)} title={`Ouvrir /pages : ${l.to}`}>
      {l.to}
    </PeutEtreLien>,
    <PeutEtreLien
      key={`n-${l.from}-${l.to}`}
      href={liens.sessions?.(l.to)}
      title={`Sessions passées par ${l.to}`}
    >
      {compte(l.count)}
    </PeutEtreLien>,
  ]);

  return (
    <div className="min-w-0">
      {ancre && (
        // L'ancrage change la POPULATION dessinée : il est écrit, pas seulement
        // dans l'URL — sinon le même dessin raconte deux choses différentes.
        <p className="mb-2 text-xs text-ink-soft" data-testid="sankey-ancre">
          Flux à partir de <span className="font-mono text-ink">{ancre}</span>
        </p>
      )}
      <div className="overflow-x-auto">
        {/* La hauteur passe par le viewBox, pas par une hauteur CSS : le dessin garde
            son rapport largeur/hauteur à toutes les tailles d'écran (une hauteur fixe
            avec un viewBox large laisserait des bandes vides autour du dessin).
            Sans lien, le dessin est une image ; avec des liens, c'est un groupe —
            un `role="img"` masquerait les rubans et les nœuds cliquables (RankBar). */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[560px]"
          role={cliquable ? "group" : "img"}
          aria-label={legende}
        >
          {/* rubans (dessinés avant les nœuds pour passer dessous) */}
          {model.links.map((l) => {
            const sy0 = y(l.sy0);
            const sy1 = y(l.sy1);
            const ty0 = y(l.ty0);
            const ty1 = y(l.ty1);
            const d = `M ${RX0},${sy0} C ${XM},${sy0} ${XM},${ty0} ${X1},${ty0} L ${X1},${ty1} C ${XM},${ty1} ${XM},${sy1} ${RX0},${sy1} Z`;
            const href = liens.sessions?.(l.to);
            const titre = `${l.from} → ${l.to} : ${compte(l.count)}${href ? ` — ouvrir les sessions passées par ${l.to}` : ""}`;
            // Une couleur unique : la direction et le volume sont déjà portés par la
            // forme ; une teinte par route se lirait comme une catégorie (P15).
            const ruban = (
              <path d={d} fill={SERIE.principale} fillOpacity={0.3} stroke="none">
                <title>{titre}</title>
              </path>
            );
            return href ? (
              <a key={`${l.from}→${l.to}`} href={href} aria-label={titre} data-testid="sankey-ruban" data-vers={l.to}>
                {ruban}
              </a>
            ) : (
              <g key={`${l.from}→${l.to}`}>{ruban}</g>
            );
          })}

          {/* nœuds + libellés (route · total) */}
          {[
            { cote: "l" as const, noeuds: model.left },
            { cote: "r" as const, noeuds: model.right },
          ].map(({ cote, noeuds }) =>
            noeuds.map((n) => {
              const gauche = cote === "l";
              const x = gauche ? X0 : X1;
              // Un nœud GAUCHE ancre le flux à partir de sa route quand l'appelant
              // le propose (`liens.ancrer`) ; sinon il ouvre la route dans /pages. Le titre
              // dit toujours où mène le clic — jamais deux gestes sous un seul lien.
              const ancrage = gauche ? liens.ancrer?.(n.route) : undefined;
              const href = ancrage ?? liens.pages?.(n.route);
              const titre = ancrage
                ? `Ancrer le flux à partir de ${n.route} (${passages(n.total)}) — ouvrir /pages depuis l'alternative`
                : `Ouvrir /pages : ${n.route} (${passages(n.total)})`;
              const contenu = (
                <>
                  <title>{titre}</title>
                  <rect x={x} y={y(n.y)} width={NODE_W} height={y(n.h)} rx={2} className="fill-ink-soft" />
                  <text
                    x={gauche ? x - 6 : x + NODE_W + 6}
                    y={y(n.y) + y(n.h) / 2}
                    textAnchor={gauche ? "end" : "start"}
                    dominantBaseline="middle"
                    className="fill-ink-soft"
                    fontSize={11}
                    fontFamily="ui-monospace, monospace"
                  >
                    {libelleNoeud(n.route, n.total)}
                  </text>
                </>
              );
              return href ? (
                <a key={`${cote}-${n.route}`} href={href} aria-label={titre} data-testid="sankey-noeud">
                  {contenu}
                </a>
              ) : (
                <g key={`${cote}-${n.route}`}>{contenu}</g>
              );
            }),
          )}
        </svg>
      </div>
      {alternative && (
        <TableAlternative
          alternative={{ legende: `${legende} — De, Vers, Sessions`, colonnes: ["De", "Vers", "Sessions"], lignes }}
        />
      )}
    </div>
  );
}
