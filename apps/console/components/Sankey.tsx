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
//
// SOUS 640 PX, UNE LISTE (recette du 26/09/2026). Le dessin garde 560 px de large
// pour que ses libellés restent lisibles : dans une carte de 324 px, la colonne des
// destinations sortait de l'écran sans signe de défilement, et les libellés
// tombaient à 8 px. Sur mobile, les transitions les plus fréquentes sont listées à
// sa place (« départ → arrivée », nombre, barre proportionnelle), avec le même
// lien qu'un ruban ; le dessin reste au-delà de `sm`.
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
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
/** Bande d'en-tête « Depuis » / « Vers », au-dessus des nœuds. */
const ENTETE = 18;
/** Caractères d'un libellé de nœud (police mono 11) qui tiennent dans la marge de 150 unités. */
const CARACTERES_LIBELLE = 21;
/** Transitions listées sous 640 px : autant qu'un côté du dessin a de nœuds au plus. */
const TRANSITIONS_MOBILE = 8;

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

/**
 * Coupe AU MILIEU : le début et la fin d'une route l'identifient (« /partners/…/documents »).
 * Coupée à la fin, « /partners/:id » et « /partners/:id/documents » se confondaient ;
 * coupée par le bord du dessin, la route perdait son début (« ners/:id/documen… »).
 */
export function tronquerMilieu(s: string, n: number): string {
  if (s.length <= n) return s;
  const tete = Math.ceil((n - 1) / 2);
  return `${s.slice(0, tete)}…${s.slice(s.length - (n - 1 - tete))}`;
}

/**
 * Une route avec une occasion de coupure (`<wbr>`) avant chaque « / » : passée à la
 * ligne dans une colonne étroite, elle se coupe entre deux segments
 * (« /partners/:id/ | documents ») plutôt qu'au milieu d'un mot (« documen | ts »).
 * Le texte, lui, ne change pas (ni espace ni caractère ajouté).
 */
export function routeCoupable(route: string): ReactNode {
  return route.split("/").map((segment, i) =>
    i === 0 ? (
      segment
    ) : (
      <Fragment key={i}>
        <wbr />/{segment}
      </Fragment>
    ),
  );
}

const compte = (n: number) => n.toLocaleString("fr-FR");

/** « 128 passages » / « 1 passage » : le total d'un nœud, accordé. */
const passages = (n: number) => `${compte(n)} ${n > 1 ? "passages" : "passage"}`;

/**
 * Le libellé d'un nœud : sa route et son total, jamais l'un sans l'autre. La route
 * est coupée pour que le TOTAL tienne dans la marge (il sortait du dessin à droite).
 */
export function libelleNoeud(route: string, total: number): string {
  const suffixe = ` · ${compte(total)}`;
  return `${tronquerMilieu(route, Math.max(8, CARACTERES_LIBELLE - suffixe.length))}${suffixe}`;
}

/**
 * Les transitions les plus fréquentes, pour la liste mobile : celles du dessin, par
 * nombre de passages décroissant (à égalité, dans l'ordre des routes : un rendu
 * serveur stable). Logique pure, exportée pour les tests.
 */
export function transitionsPrincipales(model: SankeyModel, n = TRANSITIONS_MOBILE): SankeyModel["links"] {
  return [...model.links]
    .sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
    .slice(0, n);
}

/** Un texte, ou ce même texte cliquable — sans forcer un lien là où il n'y en a pas. */
function PeutEtreLien({ href, title, children }: { href?: string; title: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href} title={title} className="font-medium text-ink hover:text-accent hover:underline">
      {children}
    </Link>
  );
}

/**
 * Sous 640 px : les transitions les plus fréquentes, en liste. Une ligne mène où
 * mène son ruban (les sessions passées par la route d'arrivée) ; la barre, relative
 * à la première transition, garde la lecture « épaisseur = volume » du dessin.
 */
function ListeTransitions({ model, liens }: { model: SankeyModel; liens: LiensSankey }) {
  const principales = transitionsPrincipales(model);
  const max = principales[0]?.count ?? 0;
  return (
    <div className="sm:hidden" data-testid="sankey-liste">
      <p className="mb-2 text-xs text-ink-soft">
        {/* « 8 principales transitions sur 17 » contredisait la tuile « Transitions
            distinctes : 44 » (contre-recette du 26/09/2026) : 17 ne compte que les
            rubans DESSINÉS, entre les routes principales de chaque côté. Le dire. */}
        {principales.length < model.links.length
          ? `Les ${compte(principales.length)} plus fréquentes des ${compte(model.links.length)} transitions dessinées (entre les routes principales de chaque côté)`
          : "Les transitions dessinées (entre les routes principales de chaque côté)"}
        , de la plus fréquente à la moins fréquente
      </p>
      <ol className="space-y-1">
        {principales.map((l) => {
          const href = liens.sessions?.(l.to);
          const libelle = `${l.from} vers ${l.to} : ${passages(l.count)}`;
          const contenu = (
            <>
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                {/* Les routes passent à la ligne plutôt que d'être coupées : sur mobile,
                    aucune infobulle ne rendrait la fin d'une route tronquée. */}
                <span className="min-w-0 font-mono text-xs text-ink [overflow-wrap:anywhere]">
                  {routeCoupable(l.from)} <span aria-hidden="true">→</span>
                  <span className="sr-only">vers</span> {routeCoupable(l.to)}
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-ink">{compte(l.count)}</span>
              </span>
              <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-panel2">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${max > 0 ? Math.max(2, (l.count / max) * 100) : 0}%`, backgroundColor: SERIE.principale, opacity: 0.6 }}
                />
              </span>
            </>
          );
          return (
            <li key={`${l.from}→${l.to}`} data-testid="sankey-transition">
              {href ? (
                <Link
                  href={href}
                  aria-label={`${libelle} — ouvrir les sessions passées par ${l.to}`}
                  title={`Sessions passées par ${l.to}`}
                  className="block rounded-md px-2 py-1.5 transition hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  {contenu}
                </Link>
              ) : (
                <div className="px-2 py-1.5">{contenu}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
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
  const legende = `Flux de navigation entre routes (départ vers arrivée)${depuis}`;
  const cliquable = Boolean(liens.sessions || liens.pages || liens.ancrer);

  const lignes: ReactNode[][] = model.links.map((l) => [
    <PeutEtreLien key={`de-${l.from}`} href={liens.pages?.(l.from)} title={`Ouvrir ${l.from} dans Pages`}>
      {l.from}
    </PeutEtreLien>,
    <PeutEtreLien key={`vers-${l.to}`} href={liens.pages?.(l.to)} title={`Ouvrir ${l.to} dans Pages`}>
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
      <ListeTransitions model={model} liens={liens} />
      <div className="hidden overflow-x-auto sm:block" data-testid="sankey-dessin">
        {/* La hauteur passe par le viewBox, pas par une hauteur CSS : le dessin garde
            son rapport largeur/hauteur à toutes les tailles d'écran (une hauteur fixe
            avec un viewBox large laisserait des bandes vides autour du dessin).
            Sans lien, le dessin est une image ; avec des liens, c'est un groupe —
            un `role="img"` masquerait les rubans et les nœuds cliquables (RankBar). */}
        <svg
          viewBox={`0 0 ${W} ${H + ENTETE}`}
          className="w-full min-w-[560px]"
          role={cliquable ? "group" : "img"}
          aria-label={legende}
        >
          {/* En-têtes de colonnes : le sens du flux se lit sans légende. */}
          <text x={X0 + NODE_W} y={11} textAnchor="end" fontSize={11} fontWeight={600} className="fill-ink-soft">
            Depuis
          </text>
          <text x={X1} y={11} textAnchor="start" fontSize={11} fontWeight={600} className="fill-ink-soft">
            Vers
          </text>
          <g transform={`translate(0 ${ENTETE})`}>
          {/* rubans (dessinés avant les nœuds pour passer dessous) */}
          {model.links.map((l) => {
            const sy0 = y(l.sy0);
            const sy1 = y(l.sy1);
            const ty0 = y(l.ty0);
            const ty1 = y(l.ty1);
            const d = `M ${RX0},${sy0} C ${XM},${sy0} ${XM},${ty0} ${X1},${ty0} L ${X1},${ty1} C ${XM},${ty1} ${XM},${sy1} ${RX0},${sy1} Z`;
            const href = liens.sessions?.(l.to);
            const titre = `${l.from} → ${l.to} : ${passages(l.count)}${href ? ` — ouvrir les sessions passées par ${l.to}` : ""}`;
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
                ? `Ne suivre que les passages qui partent de ${n.route} (${passages(n.total)})`
                : `Ouvrir ${n.route} dans Pages (${passages(n.total)})`;
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
          </g>
        </svg>
      </div>
      {alternative && (
        <TableAlternative
          // « Passages », pas « Sessions » : une session qui repasse deux fois par la même
          // transition y compte deux fois (c'est l'épaisseur du ruban).
          alternative={{ legende: `${legende} — De, Vers, Passages`, colonnes: ["De", "Vers", "Passages"], lignes }}
        />
      )}
    </div>
  );
}
