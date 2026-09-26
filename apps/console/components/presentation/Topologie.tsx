// PS3 — Le chemin de la mesure (plan § 8.2) : du navigateur au collecteur de la
// console, puis à la base ; autour, les travaux planifiés et le serveur MCP.
// SVG rendu serveur, sans animation (§ 3.9) : aucun JavaScript envoyé.
//
// Le dessin et son alternative lisent la MÊME liste (lib/presentation-topologie.ts) :
// une boîte = une ligne du tableau, et les hébergeurs y sont lus dans lib/legal.ts,
// pas retapés. Les faits d'exploitation portent leur date de relevé.
//
// UNE COLONNE, À TOUTES LES LARGEURS. Un texte SVG rétrécit avec son dessin : cinq
// boîtes côte à côte, ramenées aux 358 px d'un téléphone, s'écriraient en 7 px. Les
// boîtes s'empilent donc dans l'ordre du chemin, et le serveur MCP rejoint la
// console par un rail à droite (il ne touche pas la base : aucune flèche vers elle).
import { TableAlternative } from "@/components/charts/Figure";
import { SousPartie } from "@/components/presentation/SousPartie";
import {
  ARIA_TOPOLOGIE,
  INGEST_SUPPRIME_LE,
  LIAISONS,
  MIGRATIONS_CONSTATEES,
  PIECES,
  TOPOLOGIE_RELEVEE,
  type Piece,
  type PieceId,
} from "@/lib/presentation-topologie";

const LARGEUR_BOITE = 262;
const RAIL = 284; // abscisse du rail MCP → console, à droite des boîtes
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
  { id: "base", ecart: ECART_RELIE },
  { id: "travaux", ecart: ECART_RELIE },
  { id: "mcp", ecart: ECART_SERRE },
];

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
function trace(de: Place, vers: Place, voisines: boolean): { d: string; milieu: number } {
  if (voisines) {
    const x = LARGEUR_BOITE / 2;
    const [y1, y2] = de.y < vers.y ? [de.y + de.h, vers.y] : [de.y, vers.y + vers.h];
    return { d: `M ${x} ${y1} V ${y2}`, milieu: (y1 + y2) / 2 };
  }
  const bord = LARGEUR_BOITE - BORD;
  const ya = de.y + de.h / 2;
  const yb = vers.y + vers.h / 2;
  return { d: `M ${bord} ${ya} H ${RAIL} V ${yb} H ${bord}`, milieu: (ya + yb) / 2 };
}

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
        const { d, milieu } = trace(de, vers, Math.abs(rang(l.de) - rang(l.vers)) === 1);
        const mesure = l.de === "navigateur" || (l.de === "console" && l.vers === "base");
        return (
          <g key={`${l.de}-${l.vers}`}>
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

const CODE = "rounded bg-app/70 px-1 py-0.5 font-mono text-[12.5px] text-ink";

export function Topologie() {
  return (
    <SousPartie id="contient-topologie" titre="Le chemin de la mesure">
      <div data-testid="topologie" className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <div className="card min-w-0 p-4 sm:p-5">
          <Dessin />
        </div>
        <div className="min-w-0 space-y-3 text-sm leading-relaxed text-ink-soft">
          <p>
            Le collecteur est une route de la console : c&apos;est l&apos;adresse que visent les SDK. Le
            même parseur existe en service Node autonome (<code className={CODE}>services/collector/server.mjs</code>),
            construit et démarré par la CI ; le dépôt le déclare comme service Railway, pas encore
            créé, et le relais de la console vers lui est livré éteint ; en production, il ne
            tourne nulle part : le service Railway <code className={CODE}>ingest</code>, qui
            l&apos;exécutait sans domaine public, a été supprimé le {INGEST_SUPPRIME_LE}.
          </p>
          <p>
            Le <code className={CODE}>scheduler</code> applique les migrations au pré-déploiement : constaté
            le {MIGRATIONS_CONSTATEES.le} dans les journaux du déploiement{" "}
            <code className={CODE}>{MIGRATIONS_CONSTATEES.deploiement}</code>.
          </p>
          <p>
            Topologie relevée par les API Railway et Vercel le {TOPOLOGIE_RELEVEE.railwayEtVercel}, puis
            par l&apos;API Railway le {TOPOLOGIE_RELEVEE.railway}.
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
