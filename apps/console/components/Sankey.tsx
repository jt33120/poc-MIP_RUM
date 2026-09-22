// Flux Sankey (Lot 6b) — rendu SVG déterministe, sans lib graphique. Consomme le
// modèle normalisé de lib/sankey (nœuds gauche/droite + rubans). Sources à gauche,
// cibles à droite ; épaisseur des rubans ∝ volume. Rendu serveur (pas d'interaction).
import type { SankeyModel } from "@/lib/sankey";
import { CATEGORIELLE } from "@/lib/palette";

const W = 720;
const H = 380;
const MARGIN = 150; // marge latérale réservée aux libellés de routes
const NODE_W = 12;
const X0 = MARGIN; // bord droit des nœuds source = X0 + NODE_W
const X1 = W - MARGIN - NODE_W; // bord gauche des nœuds cible
const RX0 = X0 + NODE_W;
const XM = (RX0 + X1) / 2;

// Palette catégorielle déterministe (par route source).
// Des routes sans ordre ni verdict : jamais de vert, d'ambre ni de rouge (P15).
const PALETTE = CATEGORIELLE;
function colorFor(route: string): string {
  let h = 0;
  for (let i = 0; i < route.length; i++) h = (h * 31 + route.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function trunc(s: string, n = 22): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function Sankey({ model }: { model: SankeyModel }) {
  if (!model.links.length) {
    return <p className="py-8 text-center text-ink-faint">Pas assez de transitions pour un flux</p>;
  }
  const y = (v: number) => v * H;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[560px]"
        role="img"
        aria-label="Flux de navigation entre routes (source vers cible)"
      >
        {/* rubans (dessinés avant les nœuds pour passer dessous) */}
        {model.links.map((l) => {
          const sy0 = y(l.sy0);
          const sy1 = y(l.sy1);
          const ty0 = y(l.ty0);
          const ty1 = y(l.ty1);
          const d = `M ${RX0},${sy0} C ${XM},${sy0} ${XM},${ty0} ${X1},${ty0} L ${X1},${ty1} C ${XM},${ty1} ${XM},${sy1} ${RX0},${sy1} Z`;
          return (
            <path
              key={`${l.from}→${l.to}`}
              d={d}
              fill={colorFor(l.from)}
              fillOpacity={0.32}
              stroke="none"
            >
              <title>{`${l.from} → ${l.to} : ${l.count}`}</title>
            </path>
          );
        })}

        {/* nœuds + libellés */}
        {model.left.map((n) => (
          <g key={`l-${n.route}`}>
            <rect x={X0} y={y(n.y)} width={NODE_W} height={y(n.h)} rx={2} fill={colorFor(n.route)} />
            <text
              x={X0 - 6}
              y={y(n.y) + y(n.h) / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-soft"
              fontSize={11}
              fontFamily="ui-monospace, monospace"
            >
              {trunc(n.route)}
            </text>
          </g>
        ))}
        {model.right.map((n) => (
          <g key={`r-${n.route}`}>
            <rect x={X1} y={y(n.y)} width={NODE_W} height={y(n.h)} rx={2} className="fill-accent" />
            <text
              x={X1 + NODE_W + 6}
              y={y(n.y) + y(n.h) / 2}
              textAnchor="start"
              dominantBaseline="middle"
              className="fill-ink-soft"
              fontSize={11}
              fontFamily="ui-monospace, monospace"
            >
              {trunc(n.route)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
