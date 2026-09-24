import { CODES_ERREUR, type CodeErreur } from "@mip/console-contract";

/**
 * Un refus DU CONTRAT, levé par une garde ou un traitement : un code stable, un
 * message pour un humain, éventuellement des détails. Tout autre `Error` est une
 * PANNE : 500, message générique, pile au journal — jamais dans la réponse.
 */
export class ErreurContrat extends Error {
  readonly code: CodeErreur;
  readonly statut: number;
  readonly details?: unknown;
  readonly entetes?: Readonly<Record<string, string>>;

  constructor(code: CodeErreur, message: string, options: { details?: unknown; entetes?: Record<string, string> } = {}) {
    super(message);
    this.name = "ErreurContrat";
    this.code = code;
    this.statut = CODES_ERREUR[code];
    this.details = options.details;
    this.entetes = options.entetes;
  }
}
