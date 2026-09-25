// Effacer SES lignes d'audit à la fin d'un test, malgré `audit_log` en ajout seul.
//
// Depuis migration-v90, un déclencheur refuse toute modification ou suppression
// dans `audit_log` (42501). Un test qui veut rester rejouable sur une base locale
// doit pourtant retirer les lignes qu'il a écrites. Le seul chemin : un
// SUPERUTILISATEUR en `session_replication_role = replica`, qui ne déclenche pas
// les déclencheurs ordinaires — le cas des bases de test (rôle `postgres`), jamais
// celui de la production (Neon ne donne pas de superutilisateur). Le réglage est
// LOCAL à une transaction : il ne survit pas sur la connexion rendue au pool.
//
// Sur une base antérieure à v90 (bases `pre_v*` de la CI), le réglage ne change
// rien : il n'y a pas de déclencheur à contourner.
import type pg from "pg";

/** `delete from audit_log where <condition>`, contournant le déclencheur d'ajout seul. */
export async function effacerAudit(db: pg.Pool, condition: string, valeurs: readonly unknown[] = []): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    await c.query(`delete from audit_log where ${condition}`, valeurs as unknown[]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
