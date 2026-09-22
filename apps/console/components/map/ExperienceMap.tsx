"use client";
// Rendu SVG du graphe de service front→back. Reçoit une mise en page déjà
// calculée (lib/map.layoutGraph, pure) et se contente de dessiner : arêtes
// pondérées par le volume, nœuds colorés par santé, tendance chiffrée, marqueur
// « à risque ». Survol d'un nœud -> ses arêtes ressortent. Zéro dépendance graphe.
//
// CE QUE F52 Y CHANGE, ET POURQUOI.
//   - LA SANTÉ EST ÉCRITE dans le nœud (« 2,4 % err · p75 1,2 s »), pas seulement
//     teintée : une couleur seule n'est pas une information (§ 3.9), et un nœud
//     « inconnu » se distingue aussi par le texte, pas par une nuance de gris.
//   - LA TENDANCE EST CHIFFRÉE (« ▲ +32 % ») : une flèche dit le sens, pas
//     l'ampleur ; sous le seuil anti-bruit, rien n'est écrit plutôt qu'un « +0 % »
//     qui se lirait comme une mesure (`tendancePct`, lib/map.ts).
//   - UN NŒUD EST UN LIEN vers son panneau (`panel=noeud:<tier>:<route>`, § 3.5).
//     L'`href` arrive DANS le nœud, en chaîne : une fonction passée d'un composant
//     serveur à un composant client fait planter la page (§ 0.3).
//   - LE NŒUD « Autres routes (N) » n'a ni pastille ni tendance : il agrège
//     plusieurs routes, qui n'ont ni santé commune ni p75 moyennable (V5).
//
// Accessibilité : le SVG n'est pas `role="img"` — il contient des liens, qu'un
// rôle d'image rendrait inatteignables. L'équivalent textuel est la table des
// liens rendue à côté par l'écran (visible à 390 px, repliée au-dessus) et
// l'alternative de la `Figure` englobante.
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import type { Health, Placed, Layout, TrendDir } from "@/lib/map";
import { NODE_HEIGHT, NODE_WIDTH } from "@/lib/map";
import { SERIE } from "@/lib/palette";

/** Jetons de F01 (`good` / `warn` / `bad`) : ils suivent le mode sombre. */
const HEALTH_FILL: Record<Exclude<Health, "unknown">, string> = {
  good: "rgb(var(--c-good))",
  warn: "rgb(var(--c-warn))",
  bad: "rgb(var(--c-bad))",
};

/**
 * Pastille de santé. Santé inconnue (latence non mesurée) : cercle CREUX et
 * neutre — pas une couleur de verdict de plus, une absence de verdict qui se
 * distingue aussi par la forme (aucune information portée par la seule couleur).
 */
function Pastille({ health }: { health: Health }) {
  if (health === "unknown") {
    return <circle cx={14} cy={16} r={3.5} style={{ fill: "none", stroke: "rgb(var(--c-ink-faint))" }} strokeWidth={1.5} />;
  }
  return <circle cx={14} cy={16} r={4} fill={HEALTH_FILL[health]} />;
}

const TREND: Record<TrendDir, string> = { up: "▲", down: "▼", flat: "" };

const LIBELLE_SANTE: Record<Health, string> = {
  good: "sain",
  warn: "à surveiller",
  bad: "dégradé",
  unknown: "inconnu",
};

function label(route: string): string {
  return route.length > 24 ? "…" + route.slice(-23) : route;
}

/** « 1 240 appels · ▲ +32 % » — la tendance n'est écrite que si elle est chiffrable. */
function ligneVolume(n: Placed): string {
  const appels = `${n.calls.toLocaleString("fr-FR")} appels`;
  const fleche = TREND[n.dir];
  if (n.agrege) return `${appels} au total`;
  if (!n.tendance) return appels;
  return `${appels} · ${fleche ? `${fleche} ` : ""}${n.tendance}`;
}

/** Ce qu'annonce le lien du nœud : tout ce que le dessin montre, en toutes lettres. */
function annonce(n: Placed): string {
  if (n.agrege) return `${n.route}, ${n.calls.toLocaleString("fr-FR")} appels au total — routes moins actives, non détaillées`;
  return [
    `${n.tier === "front" ? "Page" : "Service"} ${n.route}`,
    `santé ${LIBELLE_SANTE[n.health]}`,
    n.sante,
    ligneVolume(n),
    n.risk ? "en hausse, à surveiller" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function ExperienceMap({ layout }: { layout: Layout }) {
  const [hover, setHover] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height + 8}`}
        width={layout.width}
        className="min-w-full"
        data-testid="carte-svg"
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
              style={{ stroke: on ? SERIE.principale : "rgb(var(--c-ink-faint))" }}
              strokeWidth={e.width}
              strokeOpacity={hover && !on ? 0.15 : on ? 0.9 : 0.35}
            />
          );
        })}

        {/* nœuds */}
        {layout.nodes.map((n) => {
          const dim =
            hover &&
            hover !== n.id &&
            !layout.edges.some((e) => (e.from === hover && e.to === n.id) || (e.to === hover && e.from === n.id));
          const contenu = (
            <g
              transform={`translate(${n.x} ${n.y})`}
              opacity={dim ? 0.35 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              data-testid="carte-noeud"
              data-sante={n.health}
              data-agrege={n.agrege ? "1" : undefined}
            >
              <title>{annonce(n)}</title>
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                style={{
                  fill: "rgb(var(--c-panel))",
                  stroke: n.risk ? "rgb(var(--c-bad))" : "rgb(var(--c-line))",
                }}
                strokeWidth={n.risk ? 1.5 : 1}
              />
              {!n.agrege && <Pastille health={n.health} />}
              <text
                x={n.agrege ? 12 : 26}
                y={20}
                style={{ fill: "rgb(var(--c-ink))" }}
                fontSize={11}
                fontFamily={n.agrege ? undefined : "ui-monospace, monospace"}
              >
                {label(n.route)}
              </text>
              <text x={n.agrege ? 12 : 26} y={34} style={{ fill: "rgb(var(--c-ink-faint))" }} fontSize={9}>
                {ligneVolume(n)}
              </text>
              <text x={n.agrege ? 12 : 26} y={46} style={{ fill: "rgb(var(--c-ink-faint))" }} fontSize={9}>
                {n.agrege ? "santé non agrégée : plusieurs routes" : (n.sante ?? `santé ${LIBELLE_SANTE[n.health]}`)}
              </text>
            </g>
          );
          return n.href ? (
            <Lien key={n.id} href={n.href} annonce={annonce(n)}>
              {contenu}
            </Lien>
          ) : (
            <g key={n.id} style={{ cursor: "default" }}>
              {contenu}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Un nœud cliquable : le lien EST le nœud (un seul arrêt de tabulation). */
function Lien({ href, annonce, children }: { href: string; annonce: string; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} aria-label={`${annonce} — ouvrir le panneau du nœud`} style={{ cursor: "pointer" }}>
      {children}
    </Link>
  );
}
