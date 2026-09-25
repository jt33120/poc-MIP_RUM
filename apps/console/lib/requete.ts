// UNE REQUÊTE D'ÉCRITURE, dans la transaction d'une commande ou seule (C8).
//
// Les commandes (`lib/commandes/`) écrivent et inscrivent leur audit dans UNE
// transaction : les fonctions d'écriture des modules de requêtes prennent donc un
// client facultatif. Sans lui, elles passent par le pool, comme avant. Le résultat
// garde `rowCount` : une écriture filtrée par son application (`where id = $1 and
// app_id = $2`) qui ne touche aucune ligne dit « introuvable », jamais « fait ».
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "./db";

export type ClientEcriture = Pick<PoolClient, "query">;

export async function ecrire<T extends QueryResultRow = Record<string, unknown>>(
  client: ClientEcriture | undefined,
  texte: string,
  valeurs: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  const r = await (client ?? pool).query<T>(texte, valeurs);
  return { rows: r.rows, rowCount: r.rowCount ?? 0 };
}
