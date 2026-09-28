// PS3 — Le chemin de la mesure (plan § 8.2) : du navigateur à la console, qui en
// relaie une part au collecteur Railway et écrit le reste, puis à la base ; autour,
// les travaux planifiés, l'API de lecture et le serveur MCP.
// SVG rendu serveur, sans animation (§ 3.9) : aucun JavaScript envoyé.
//
// Le dessin et son alternative lisent la MÊME liste (lib/presentation-topologie.ts) :
// une boîte = une ligne du tableau, et les hébergeurs y sont lus dans lib/legal.ts,
// pas retapés. La légende dit le chemin en français courant et date la topologie ;
// le journal d'exploitation (service supprimé tel jour, identifiant de déploiement)
// n'est plus sur une page publique (recette du 26/09/2026) : il est dans
// docs/TOPOLOGIE_BACKEND.md. L'hébergement et son droit renvoient au tableau de la
// présentation, leur seule place.
//
// UNE COLONNE, À TOUTES LES LARGEURS. Un texte SVG rétrécit avec son dessin : sept
// boîtes côte à côte, ramenées aux 358 px d'un téléphone, s'écriraient en 7 px. Les
// boîtes s'empilent donc dans l'ordre du chemin. Depuis le relevé du 28/09/2026, la
// mesure a deux trajets : la part relayée descend par le collecteur, le reste va de
// la console à la base par un rail à droite. L'API de lecture rejoint la base par un
// second rail, plus à l'extérieur ; les points d'attache des deux rails sont décalés
// pour qu'ils ne se croisent pas. Le serveur MCP ne touche pas la base : aucune
// flèche vers elle.
import { TableAlternative } from "@/components/charts/Figure";
import { SousPartie } from "@/components/presentation/SousPartie";
import Link from "next/link";
import {
  ARIA_TOPOLOGIE,
  LIAISONS,
  PIECES,
  TOPOLOGIE_RELEVEE,
  type Piece,
  type PieceId,
} from "@/lib/presentation-topologie";

const LARGEUR_BOITE = 262;
const RAIL = 284; // abscisse d'un rail sans réglage propre
const LARGEUR = 300;
const BORD = 1; // demi-trait : une boîte collée au bord garde son trait entier
const MARGE_X = 12;
const TITRE_Y = 20; // ligne de base du titre sous le haut de la boîte
const INTERLIGNE = 15;
const MARGE_BAS = 12;
const ECART_RELIE = 40; // entre deux boîtes reliées : la flèche et son libellé
const ECART_SERRE = 16; // entre deux boîtes que rien ne relie

/** Écart AVANT chaque boîte, dans l'ordre du chemin. */
const ORDRE: { id: PieceId; ecart: number }[] = [
  { id: "navigateur", ecart: 0 },
  { id: "console", ecart: ECART_RELIE },
  { id: "collecteur", ecart: ECART_RELIE },
  { id: "base", ecart: ECART_RELIE },
  { id: "travaux", ecart: ECART_RELIE },
  { id: "api", ecart: ECART_SERRE },
  { id: "mcp", ecart: ECART_RELIE },
];

/**
 * Rails des liaisons entre boîtes non voisines : abscisse, et hauteur d'attache au
 * départ et à l'arrivée (fraction de la boîte). Le rail console → base, intérieur,
 * arrive dans le haut de la base ; celui de l'API, extérieur, dans le bas : ainsi le
 * second ne coupe jamais le premier.
 */
const RAILS: Partial<Record<string, { x: number; depart: number; arrivee: number }>> = {
  "console-base": { x: 274, depart: 0.7, arrivee: 0.3 },
  "api-base": { x: 290, depart: 0.5, arrivee: 0.7 },
};

interface Place {
  piece: Piece;
  y: number;
  h: number;
}

function placer(): { places: Map<PieceId, Place>; hauteur: number } {
  const places = new Map<PieceId, Place>();
  let y = BORD;
  for (const { id, ecart } of ORDRE) {
    const piece = PIECES.find((p) => p.id === id);
    if (!piece) continue;
    y += ecart;
    const h = TITRE_Y + piece.lignes.length * INTERLIGNE + MARGE_BAS;
    places.set(id, { piece, y, h });
    y += h;
  }
  return { places, hauteur: y + BORD };
}

const rang = (id: PieceId) => ORDRE.findIndex((o) => o.id === id);

/** Tracé d'une liaison : verticale entre deux boîtes voisines, rail à droite sinon. */
function trace(de: Place, vers: Place, voisines: boolean, cle: string): { d: string; milieu: number } {
  if (voisines) {
    const x = LARGEUR_BOITE / 2;
    const [y1, y2] = de.y < vers.y ? [de.y + de.h, vers.y] : [de.y, vers.y + vers.h];
    return { d: `M ${x} ${y1} V ${y2}`, milieu: (y1 + y2) / 2 };
  }
  const { x, depart, arrivee } = RAILS[cle] ?? { x: RAIL, depart: 0.5, arrivee: 0.5 };
  const bord = LARGEUR_BOITE - BORD;
  const ya = de.y + de.h * depart;
  const yb = vers.y + vers.h * arrivee;
  return { d: `M ${bord} ${ya} H ${x} V ${yb} H ${bord}`, milieu: (ya + yb) / 2 };
}

/** Les trajets de la mesure elle-même, en couleur : du navigateur jusqu'à la base. */
const MESURE = new Set(["navigateur-console", "console-collecteur", "collecteur-base", "console-base"]);

function Dessin() {
  const { places, hauteur } = placer();
  return (
    <svg
      viewBox={`0 0 ${LARGEUR} ${hauteur}`}
      className="mx-auto block h-auto w-full max-w-[20rem]"
      role="img"
      aria-label={ARIA_TOPOLOGIE}
      data-testid="topologie-dessin"
    >
      <defs>
        <marker id="topologie-fleche" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-ink-soft" />
        </marker>
        <marker id="topologie-fleche-mesure" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-perf" />
        </marker>
      </defs>

      {LIAISONS.map((l) => {
        const de = places.get(l.de);
        const vers = places.get(l.vers);
        if (!de || !vers) return null;
        const cle = `${l.de}-${l.vers}`;
        const { d, milieu } = trace(de, vers, Math.abs(rang(l.de) - rang(l.vers)) === 1, cle);
        const mesure = MESURE.has(cle);
        return (
          <g key={cle}>
            <path
              d={d}
              fill="none"
              strokeWidth={mesure ? 1.75 : 1.25}
              className={mesure ? "stroke-perf" : "stroke-ink-soft"}
              markerEnd={`url(#${mesure ? "topologie-fleche-mesure" : "topologie-fleche"})`}
            />
            {l.libelle && (
              <text x={LARGEUR_BOITE / 2 + 8} y={milieu + 4} fontSize={12} className="fill-ink-soft">
                {l.libelle}
              </text>
            )}
          </g>
        );
      })}

      {[...places.values()].map(({ piece, y, h }) => (
        <g key={piece.id}>
          <rect
            x={BORD}
            y={y}
            width={LARGEUR_BOITE - 2 * BORD}
            height={h}
            rx={10}
            strokeWidth={piece.id === "console" ? 1.5 : 1}
            className={`fill-panel ${piece.id === "console" ? "stroke-perf" : "stroke-line"}`}
          />
          <text x={MARGE_X} y={y + TITRE_Y} fontSize={13} fontWeight={600} className="fill-ink">
            {piece.titre}
          </text>
          {piece.lignes.map((ligne, i) => (
            <text key={ligne} x={MARGE_X} y={y + TITRE_Y + (i + 1) * INTERLIGNE} fontSize={12} className="fill-ink-soft">
              {ligne}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

export function Topologie() {
  return (
    <SousPartie id="contient-topologie" titre="Le chemin de la mesure">
      <div data-testid="topologie" className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <div className="card min-w-0 p-4 sm:p-5">
          <Dessin />
        </div>
        <div className="min-w-0 space-y-3 text-sm leading-relaxed text-ink-soft">
          {/* Relevé du 28/09/2026 : le relais de la collecte est allumé depuis le 27/09
              (`ingest_relay_pct`). La console reçoit tout, en relaie une part au collecteur
              et écrit elle-même le reste ; ses écrans lisent encore la base. */}
          <p>
            Les capteurs visent la console. Elle relaie une part des mesures au collecteur, qui les
            pseudonymise et les écrit dans la base, et écrit elle-même le reste ; ses écrans et son API
            relisent ensuite la base.
          </p>
          {/* Les autres services (backend de la console, notifier) ne sont racontés qu'une
              fois, dans les spécifications (contre-recette du 26/09/2026 : quatre fois dans
              le dossier). Ici, un renvoi. */}
          <p>
            Les travaux planifiés — alertes, objectifs de service, sondes, purge — tournent à part, tout
            comme le serveur MCP, qui passe par l&apos;API de lecture et n&apos;a aucun accès à la base.
            Les autres services, et leur état, sont décrits dans{" "}
            <Link href="#specs" className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
              les spécifications
            </Link>
            .
          </p>
          <p>
            Topologie relevée le {TOPOLOGIE_RELEVEE.railway}. Où sont les données, et sous quel droit :{" "}
            <Link href="/presentation#hebergement" className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
              le tableau de la présentation
            </Link>
            .
          </p>
        </div>
        {/* Sous les deux colonnes : son tableau (`min-w-max`) tient en pleine largeur à
            1440 px, et défile dans son propre conteneur à 390 px. */}
        <div className="min-w-0 lg:col-span-2">
          <TableAlternative
            alternative={{
              legende: "Les pièces du dessin, dans l'ordre du chemin de la mesure.",
              colonnes: ["Pièce", "Hébergeur", "Région", "Rôle"],
              lignes: PIECES.map((p) => [p.titre, p.hebergeur, p.region, p.role]),
            }}
          />
        </div>
      </div>
    </SousPartie>
  );
}
