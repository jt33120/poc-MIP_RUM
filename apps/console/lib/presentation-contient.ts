// Partie 1 de la vitrine, « Ce qu'il contient » : ce qui se LIT dans le document de
// couverture (docs/RUM_PARITY_STATUS.md, via lib/couverture.ts) au lieu de s'écrire
// à la main — PUR, sans accès base.
//
// POURQUOI CE FICHIER. Le plan (§ 8.2, PS6) écrivait « la CI ne vérifie pas les
// types » et « un test SQL échoue quand on joue la suite que la CI saute » : vrai au
// relevé du 18/09/2026, faux à celui du 23/09 (F2 est passée « déployé, non
// éprouvé », la fenêtre v82→v83 tourne en CI). Une phrase recopiée d'un relevé ne
// voit pas le suivant. Ici, chaque réserve de « Ce que ces chiffres ne disent pas »
// nomme la ligne qui la fonde ET le verdict qu'elle suppose :
// tests/unit/presentation-contient.test.ts échoue dès qu'un nouveau relevé change ce
// verdict — la phrase est alors à réécrire depuis la ligne, pas à garder.
import { CAPACITES, type Capacite, type Verdict } from "./couverture";

/**
 * Un nombre cité dans la cellule « Preuve » d'une ligne du document (« 18 familles
 * de routes »), ou null s'il n'y est plus : la vitrine tait alors le nombre plutôt
 * que d'en garder un ancien.
 */
export function nombreDansPreuve(
  id: string,
  motif: RegExp,
  capacites: readonly Capacite[] = CAPACITES,
): number | null {
  const preuve = capacites.find((c) => c.id === id)?.preuve;
  const m = preuve ? motif.exec(preuve) : null;
  return m ? Number(m[1]) : null;
}

/** Familles de routes de l'API publique v1 (ligne E1). */
export const FAMILLES_API_V1 = nombreDansPreuve("E1", /(\d+) familles de routes/);
/** Outils du serveur MCP, recomptés au relevé (ligne E2). */
export const OUTILS_MCP = nombreDansPreuve("E2", /\*\*(\d+) outils\*\*/);

/** Une réserve de « Ce que ces chiffres ne disent pas », avec la ligne qui la fonde. */
export interface ReserveChaine {
  /** Identifiant de la ligne du document (§ 4.6, chaîne de livraison). */
  source: string;
  /** Verdict de cette ligne quand la phrase a été écrite : un autre verdict la rend fausse. */
  verdict: Verdict;
  texte: string;
}

// Relevé du 23/09/2026 (P**.10) : F3 « livré avec un défaut connu » (les deux bancs,
// faute de BENCH_DATABASE_URL), F2 « déployé, non éprouvé » (la CI type la console
// et les quatre paquets publiés, pas l'extension), F1 « livré avec un défaut
// connu » (`pnpm -r build` échoue sur un dépôt fraîchement installé).
export const RESERVES_CHAINE: readonly ReserveChaine[] = [
  {
    source: "F3",
    verdict: "livre_avec_defaut_connu",
    texte: "ces deux bancs ne tournent jamais en CI, et les temps publiés ne sont donc jamais revérifiés",
  },
  {
    source: "F2",
    verdict: "deploye_non_eprouve",
    texte: "la CI ne vérifie pas les types de l'extension navigateur",
  },
  {
    source: "F1",
    verdict: "livre_avec_defaut_connu",
    texte: "la construction échoue sur un dépôt fraîchement installé",
  },
];

/**
 * Les réserves dont la ligne source n'a plus le verdict supposé, ou n'existe plus
 * (vide = la phrase dit encore vrai). Chaque message nomme la ligne à relire.
 */
export function reservesPerimees(
  reserves: readonly ReserveChaine[] = RESERVES_CHAINE,
  capacites: readonly Capacite[] = CAPACITES,
): string[] {
  return reserves.flatMap((r) => {
    const cap = capacites.find((c) => c.id === r.source);
    if (!cap) return [`${r.source} n'est plus une ligne du document : réécrire « ${r.texte} »`];
    if (cap.verdict !== r.verdict) {
      return [`${r.source} est passée de « ${r.verdict} » à « ${cap.verdict} » : réécrire « ${r.texte} » depuis sa ligne`];
    }
    return [];
  });
}

/**
 * Banc ClickHouse (plan § 8.2, PS6) : infra/clickhouse.notes.md:7 (date, local),
 * :14-15 (égalité des p75 à 1 ms près), :25-26 (×15 à données identiques). Mesuré
 * avant la migration vers Neon, jamais rejoué depuis.
 */
export const BANC_CLICKHOUSE = { le: "11/06/2026", compacite: 15 } as const;
