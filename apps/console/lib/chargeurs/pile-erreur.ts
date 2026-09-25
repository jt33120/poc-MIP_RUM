// LA PILE DU DERNIER EXEMPLAIRE d'un groupe historique ou d'une issue (C4) — lue
// par le chargeur de l'écran (`/errors/[fingerprint]`, `/errors/issues/[id]`),
// rendue par `components/errors/ErrorStackCard.tsx`.
//
// Stack source (P0 #3, P5.4) : écrite par l'ingestion, sinon symbolisée à la
// lecture si une map est arrivée depuis. L'ADMINISTRATEUR (hors démo) voit en
// plus le code autour de la première frame résolue ; jamais le viewer, jamais
// l'API. Le rôle est celui du principal du chargeur — relu en base par
// console-api. Jamais sur une stack backend (P5.3) : une map navigateur n'en
// décrit aucune frame.
import { adminCodeContext, exemplarSymbolication } from "../error-symbolication";
import { stackSymbolisable } from "../erreurs-sources";
import type { ErrorExemplar } from "../queries-errors";

export async function lirePileErreur(appId: string, last: ErrorExemplar | null, admin: boolean) {
  const symbolication = stackSymbolisable(last?.error_source ?? null)
    ? await exemplarSymbolication(appId, last, { positions: admin })
    : null;
  const deminified = symbolication?.symbolication_status === "resolved" && !!symbolication.stack_symbolicated;
  const premiere = symbolication?.positions[0];
  const contexte =
    admin && deminified && premiere && last?.release ? await adminCodeContext(appId, last.release, premiere) : null;
  return { symbolication, contexte };
}

export type PileErreur = Awaited<ReturnType<typeof lirePileErreur>>;
