// Stack symboliquée d'un exemplaire d'erreur, pour l'écran de détail et l'API v1 (P5.4).
//
// Deux sources, dans cet ordre : le résultat écrit par l'ingestion
// (`rum_error.stack_symbolicated`), puis une symbolication À LA LECTURE avec le
// même moteur et les mêmes bornes, pour qu'une map mise en ligne APRÈS l'erreur
// améliore l'affichage. Ni l'une ni l'autre ne touche `fingerprint` : l'identité
// du groupe ne dépend pas du moment où la map est arrivée.
//
// Droits : la stack symboliquée est scrubbed et suit les droits RUM existants.
// Le contexte de code (±3 lignes tirées de `sourcesContent`) est réservé à
// l'admin et n'est jamais exposé par l'API.
import { creerSymbolicateur, type SymbolicationStatus } from "@mip/backend/lib/error-symbolication.mjs";
import { createLogger } from "@mip/backend/shared/log.mjs";
import { pool, q } from "./db";
import { type CodeContext, codeContext, type RawSourceMap, type ResolvedFrame } from "./sourcemap";

/** Champs ajoutés au dernier exemplaire par l'API v1 et l'écran de détail. */
interface ExemplarSymbolication {
  stack_symbolicated: string | null;
  symbolication_status: SymbolicationStatus | null;
}

export interface StackSymbolication extends ExemplarSymbolication {
  /** `ingestion` : écrite avec l'erreur ; `lecture` : calculée à l'affichage. */
  origin: "ingestion" | "lecture" | null;
  /** Diagnostic lisible quand la stack n'est pas résolue. */
  reason: string | null;
  /** Frames résolues à la lecture (contexte de code admin) ; vide sinon. */
  positions: ResolvedFrame[];
}

// Un symbolicateur par instance, survivant au rechargement à chaud de next dev.
const g = globalThis as unknown as { mipSymbolicateurLecture?: ReturnType<typeof creerSymbolicateur> };
const symbolicateur = (g.mipSymbolicateurLecture ??= creerSymbolicateur({ log: createLogger("symbolication") }));

/**
 * migration-v71 est-elle appliquée ? Rejouée à chaque lecture, comme la sonde v69
 * de queries-errors.ts : la console est publiée avant la migration.
 */
async function schemaV71(): Promise<boolean> {
  const [row] = await q<{ v71: boolean }>(
    `select exists(select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'rum_error' and column_name = 'symbolication_status') as v71`,
  );
  return row?.v71 === true;
}

/**
 * Stack à afficher pour un exemplaire. `positions: true` (écran admin) refait la
 * symbolication à la lecture même quand l'ingestion l'a déjà faite, pour situer
 * le contexte de code ; le cache la rend peu coûteuse.
 */
export async function exemplarSymbolication(
  appId: string,
  last: { id: number; stack: string | null; release: string | null } | null,
  { positions = false }: { positions?: boolean } = {},
): Promise<StackSymbolication | null> {
  if (!last) return null;
  const v71 = await schemaV71();
  const [ecrite] = v71
    ? await q<ExemplarSymbolication>(
        "select symbolication_status, stack_symbolicated from rum_error where app_id = $1 and id = $2",
        [appId, last.id],
      )
    : [];
  const resolue = ecrite?.symbolication_status === "resolved" && ecrite.stack_symbolicated;
  if ((resolue && !positions) || !last.stack) {
    return {
      stack_symbolicated: ecrite?.stack_symbolicated ?? null,
      symbolication_status: ecrite?.symbolication_status ?? null,
      origin: ecrite?.symbolication_status ? "ingestion" : null,
      reason: null,
      positions: [],
    };
  }
  const [lue] = await symbolicateur.symboliquerLot(
    pool,
    [{ app_id: appId, release: last.release, stack: last.stack }],
    { checksum: v71 },
  );
  if (resolue) {
    return {
      stack_symbolicated: ecrite.stack_symbolicated,
      symbolication_status: "resolved",
      origin: "ingestion",
      reason: null,
      positions: lue?.positions ?? [],
    };
  }
  if (!lue) {
    return { stack_symbolicated: null, symbolication_status: null, origin: null, reason: null, positions: [] };
  }
  return {
    stack_symbolicated: lue.stack,
    symbolication_status: lue.status,
    origin: "lecture",
    reason: lue.raison,
    positions: lue.positions,
  };
}

/**
 * Contexte de code (±3 lignes) d'une frame résolue, tiré de la map du bundle.
 * ADMIN SEULEMENT : c'est le code source du client. `null` si la map n'embarque
 * pas `sourcesContent` ou n'est plus lisible.
 */
export async function adminCodeContext(
  appId: string,
  release: string,
  position: ResolvedFrame,
): Promise<CodeContext | null> {
  const [row] = await q<{ content: string }>(
    "select content from sourcemap where app_id = $1 and release = $2 and filename = $3",
    [appId, release, position.bundle],
  );
  if (!row) return null;
  try {
    return codeContext(JSON.parse(row.content) as RawSourceMap, position.source, position.line);
  } catch {
    return null;
  }
}
