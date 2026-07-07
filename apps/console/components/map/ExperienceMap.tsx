"use client";
// Rendu SVG du graphe de service front→back. Reçoit une mise en page déjà
// calculée (lib/map.layoutGraph, pure) et se contente de dessiner : arêtes
// pondérées par le volume, nœuds colorés par santé, flèche de tendance, marqueur
// « à risque ». Survol d'un nœud -> ses arêtes ressortent. Zéro dépendance graphe.
import { useState } from "react";
import type { Health, Layout, TrendDir } from "@/lib/map";
import { NODE_HEIGHT, NODE_WIDTH } from "@/lib/map";

const HEALTH_FILL: Record<Health, string> = {
  good: "#059669",
  warn: "#d97706",
  bad: "#dc2626",
};
const TREND: Record<TrendDir, string> = { up: "▲", down: "▼", flat: "" };

function label(route: string): string {
  return route.length > 24 ? "…" + route.slice(-23) : route;
}

export function ExperienceMap({ layout }: { layout: Layout }) {
  const [hover, setHover] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height + 8}`}
        width={layout.width}
        className="min-w-full"
        role="img"
        aria-label="Graphe des dépendances front vers back"
      >
        {/* arêtes */}
        {layout.edges.map((e, i) => {
          const on = hover === e.from || hover === e.to;
          const mid = (e.x1 + e.x2) / 2;
          return (
            <path
              key={i}
              d={`M ${e.x1} ${e.y1} C ${mid} ${e.y1}, ${mid} ${e.y2}, ${e.x2} ${e.y2}`}
              fill="none"
              style={{ stroke: on ? "#f89101" : "rgb(var(--c-ink-faint))" }}
              strokeWidth={e.width}
              strokeOpacity={hover && !on ? 0.15 : on ? 0.9 : 0.35}
            />
          );
        })}

        {/* nœuds */}
        {layout.nodes.map((n) => {
          const dim = hover && hover !== n.id && !layout.edges.some((e) => (e.from === hover && e.to === n.id) || (e.to === hover && e.from === n.id));
          return (
            <g
              key={n.id}
              transform={`translate(${n.x} ${n.y})`}
              opacity={dim ? 0.35 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "default" }}
            >
              <title>
                {n.route} · {n.calls} appels{n.risk ? " · en hausse, à surveiller" : ""}
              </title>
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                style={{ fill: "rgb(var(--c-panel))", stroke: n.risk ? "#dc2626" : "rgb(var(--c-line))" }}
                strokeWidth={n.risk ? 1.5 : 1}
              />
              <circle cx={14} cy={NODE_HEIGHT / 2} r={4} fill={HEALTH_FILL[n.health]} />
              <text x={26} y={NODE_HEIGHT / 2 - 2} style={{ fill: "rgb(var(--c-ink))" }} fontSize={11} fontFamily="ui-monospace, monospace">
                {label(n.route)}
              </text>
              <text x={26} y={NODE_HEIGHT / 2 + 11} style={{ fill: "rgb(var(--c-ink-faint))" }} fontSize={9}>
                {n.calls} appels {TREND[n.dir]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
