// C13 — ouvrir les pools de console-api SOUS SES RÔLES (migration-v93), comme en
// production après la mise en service : `mip_console` (écrans, commandes, RGPD),
// `mip_identity` (connexion, sessions). Les rôles sont NOLOGIN ; le test leur pose
// un mot de passe, comme l'opérateur le fera (`\password`). `null` si la base n'a
// pas les rôles (v93 non appliquée).
import pg from "pg";

export const MOT_DE_PASSE_ROLES = "tests-c13-roles";

export function sousRole(url: string, role: string): string {
  const u = new URL(url);
  u.username = role;
  u.password = MOT_DE_PASSE_ROLES;
  return u.toString();
}

export async function poolsSousRoles(url: string, proprietaire: pg.Pool) {
  const { rows } = await proprietaire.query<{ n: number }>(
    "select count(*)::int as n from pg_roles where rolname in ('mip_console', 'mip_identity')",
  );
  if (rows[0].n !== 2) return null;
  for (const role of ["mip_console", "mip_identity"]) {
    await proprietaire.query(`alter role ${role} login password '${MOT_DE_PASSE_ROLES}'`);
  }
  const console = new pg.Pool({ connectionString: sousRole(url, "mip_console"), max: 4 });
  const identite = new pg.Pool({ connectionString: sousRole(url, "mip_identity"), max: 2 });
  return {
    console,
    identite,
    /** Une transaction sur le pool de l'identité, comme `services/console-api/server.mjs`. */
    transacteur: {
      async transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
        const c = await identite.connect();
        try {
          await c.query("begin");
          const r = await fn(c);
          await c.query("commit");
          return r;
        } catch (e) {
          await c.query("rollback").catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
    },
    async fermer() {
      await Promise.all([console.end(), identite.end()]);
    },
  };
}
