// Présence d'un rejeu pour une session (P*.9) : le récit dit quand il n'y en a pas.
//
// Une existence, pas une lecture des segments : l'index `idx_replay_session`
// (migration-v03) y répond sans ouvrir un octet de rrweb. Bornée à l'app de la
// session, comme `GET /api/replay/[sessionId]` : un segment d'une autre app qui
// citerait cet identifiant (émis par le client) ne fait pas croire à un rejeu.
import { q } from "./db";

export async function sessionARejeu(sessionId: string, appId: string): Promise<boolean> {
  const [row] = await q<{ present: boolean }>(
    `select exists (
       select 1 from replay_chunk where session_id = $1 and app_id = $2
     ) as present`,
    [sessionId, appId],
  );
  return row?.present === true;
}
