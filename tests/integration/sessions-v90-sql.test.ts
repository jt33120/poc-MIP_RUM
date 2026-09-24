// C0 — migration-v90 : sessions de la console, débit d'authentification, audit
// en ajout seul, sur un vrai PostgreSQL.
//
// Ce que ce fichier prouve ne se lit pas dans la migration :
//
//   · qu'une ligne de session n'a que DEUX formes — un compte, ou une démo avec
//     son étiquette et son périmètre — et qu'une démo ne peut porter aucun rôle ;
//   · qu'un compteur d'échecs ne peut pas contenir une adresse IP ni un e-mail
//     en clair ;
//   · que le journal d'audit refuse modification, suppression et vidage, tout en
//     restant ouvert à l'insertion avec ses trois colonnes nouvelles ;
//   · que la purge quotidienne efface ce qu'il faut, et rien d'autre ;
//   · qu'aucun rôle applicatif (`console_ro`, `mip_api`) ne lit une session.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effacerAudit } from "../fixtures/effacer-audit";

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const V90 = readFileSync(join(SQL_DIR, "migration-v90.sql"), "utf8");
const EMAIL = "c0-v90@test.local";
const MARQUE = "c0-v90-test";
const HEX = "a".repeat(64);

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

(url ? describe : describe.skip)("C0 — migration-v90 : sessions, débit d'authentification, audit en ajout seul", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 3 } : {});
  let userId: string;

  async function nettoyer() {
    await pool.query("delete from console_session where demo_email = $1 or user_id in (select id from console_user where email = $1)", [EMAIL]).catch(() => {});
    await pool.query("delete from auth_throttle where key like 'ip:%' or key like 'email:%'").catch(() => {});
    await effacerAudit(pool, "detail = $1", [MARQUE]).catch(() => {});
    await pool.query("delete from console_user where email = $1", [EMAIL]);
  }

  /** Une session d'utilisateur, ouverte `ilYa` avant maintenant, pour `duree`. */
  async function session(o: { ilYa?: string; duree?: string; revoquee?: string } = {}): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into console_session (user_id, created_at, expires_at, revoked_at, revoked_reason)
       values ($1, now() - $2::interval, now() - $2::interval + $3::interval,
               case when $4::interval is null then null else now() - $4::interval end,
               case when $4::interval is null then null else 'logout' end)
       returning id`,
      [userId, o.ilYa ?? "0 minutes", o.duree ?? "8 hours", o.revoquee ?? null],
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    await nettoyer();
    const { rows } = await pool.query<{ id: string }>(
      "insert into console_user (email, password_hash, role) values ($1, 'x', 'viewer') returning id",
      [EMAIL],
    );
    userId = rows[0].id;
  });

  afterAll(async () => {
    await nettoyer();
    await pool.end();
  });

  it("la migration se rejoue sans erreur", async () => {
    await pool.query(V90);
    await pool.query(V90);
  });

  it("une session de compte : l'identifiant du compte, rien de la démo", async () => {
    const id = await session();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      pool.query("insert into console_session (user_id, demo_apps, expires_at) values ($1, array['a'], now() + interval '1 hour')", [userId]),
    ).rejects.toThrow(/console_session_forme/);
    await expect(pool.query("insert into console_session (expires_at) values (now() + interval '1 hour')")).rejects.toThrow(/console_session_forme/);
  });

  it("une session de démo : ni compte, une étiquette, au moins une application — et aucune colonne de rôle", async () => {
    await pool.query(
      "insert into console_session (demo, demo_email, demo_apps, expires_at) values (true, $1, array['mip-rum-console'], now() + interval '8 hours')",
      [EMAIL],
    );
    for (const [valeurs, sql] of [
      [[userId, EMAIL], "insert into console_session (demo, user_id, demo_email, demo_apps, expires_at) values (true, $1, $2, array['a'], now() + interval '1 hour')"],
      [[EMAIL], "insert into console_session (demo, demo_email, demo_apps, expires_at) values (true, $1, array[]::text[], now() + interval '1 hour')"],
      [[EMAIL], "insert into console_session (demo, demo_email, demo_apps, expires_at) values (true, $1, null, now() + interval '1 hour')"],
      [[EMAIL], "insert into console_session (demo, demo_email, demo_apps, expires_at) values (true, $1, array['a', null], now() + interval '1 hour')"],
      [[], "insert into console_session (demo, demo_apps, expires_at) values (true, array['a'], now() + interval '1 hour')"],
    ] as const) {
      await expect(pool.query(sql, [...valeurs]), sql).rejects.toThrow(/console_session_forme/);
    }
    const { rows } = await pool.query("select column_name from information_schema.columns where table_name = 'console_session' and column_name = 'role'");
    expect(rows).toEqual([]);
  });

  it("une session dure 30 jours au plus, et une révocation dit sa raison", async () => {
    await expect(session({ duree: "31 days" })).rejects.toThrow(/console_session_duree/);
    await expect(session({ duree: "-1 hour" })).rejects.toThrow(/console_session_duree/);
    await expect(
      pool.query("insert into console_session (user_id, expires_at, revoked_at) values ($1, now() + interval '1 hour', now())", [userId]),
    ).rejects.toThrow(/console_session_revocation/);
    await expect(
      pool.query("insert into console_session (user_id, expires_at, revoked_at, revoked_reason) values ($1, now() + interval '1 hour', now(), 'Parce que !')", [userId]),
    ).rejects.toThrow(/console_session_raison/);
  });

  it("supprimer un compte emporte ses sessions", async () => {
    const { rows } = await pool.query<{ id: string }>(
      "insert into console_user (email, password_hash) values ('c0-v90-jetable@test.local', 'x') returning id",
    );
    await pool.query("insert into console_session (user_id, expires_at) values ($1, now() + interval '1 hour')", [rows[0].id]);
    await pool.query("delete from console_user where id = $1", [rows[0].id]);
    const reste = await pool.query("select 1 from console_session where user_id = $1", [rows[0].id]);
    expect(reste.rowCount).toBe(0);
  });

  it("un compteur d'échecs n'a pour clé qu'un HMAC : jamais une IP ni un e-mail en clair", async () => {
    await pool.query("insert into auth_throttle (key, window_start, failures) values ($1, now(), 1)", [`ip:${HEX}`]);
    for (const cle of ["ip:203.0.113.7", `email:${EMAIL}`, `ip:${HEX.toUpperCase()}`, `autre:${HEX}`, HEX]) {
      await expect(pool.query("insert into auth_throttle (key, window_start) values ($1, now())", [cle]), cle).rejects.toThrow(/auth_throttle_cle/);
    }
    await expect(pool.query("insert into auth_throttle (key, window_start, failures) values ($1, now(), -1)", [`email:${HEX}`])).rejects.toThrow(/auth_throttle_echecs/);
  });

  it("audit_log accepte une ligne avec ses trois colonnes nouvelles, et les borne", async () => {
    await pool.query(
      "insert into audit_log (user_email, action, detail, request_id, actor_kind, app_id) values ($1, 'test.v90', $2, 'req-0123456789', 'user', 'app-a')",
      [EMAIL, MARQUE],
    );
    await expect(
      pool.query("insert into audit_log (action, detail, actor_kind) values ('test.v90', $1, 'robot')", [MARQUE]),
    ).rejects.toThrow(/audit_log_actor_kind_v90/);
    await expect(
      pool.query("insert into audit_log (action, detail, request_id) values ('test.v90', $1, 'x y')", [MARQUE]),
    ).rejects.toThrow(/audit_log_request_id_v90/);
    // Les lignes d'avant v90 restent lisibles telles quelles : NULL partout.
    await pool.query("insert into audit_log (user_email, action, detail) values ($1, 'test.v90', $2)", [EMAIL, MARQUE]);
  });

  it("audit_log refuse modification, suppression et vidage (42501)", async () => {
    for (const sql of [
      `update audit_log set action = 'falsifie' where detail = '${MARQUE}'`,
      `delete from audit_log where detail = '${MARQUE}'`,
      "truncate audit_log",
    ]) {
      await expect(pool.query(sql), sql).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/ajout seul/) });
    }
    const { rows } = await pool.query("select count(*)::int as n from audit_log where detail = $1", [MARQUE]);
    expect(rows[0].n).toBe(2);
  });

  it("seul un superutilisateur en mode réplique efface (ce que font les tests, jamais la production)", async () => {
    await effacerAudit(pool, "detail = $1", [MARQUE]);
    const { rows } = await pool.query("select count(*)::int as n from audit_log where detail = $1", [MARQUE]);
    expect(rows[0].n).toBe(0);
    // Le réglage était local à la transaction : le déclencheur tient de nouveau.
    await pool.query("insert into audit_log (action, detail) values ('test.v90', $1)", [MARQUE]);
    await expect(pool.query("delete from audit_log where detail = $1", [MARQUE])).rejects.toMatchObject({ code: "42501" });
  });

  it("la purge quotidienne efface les sessions éteintes depuis 7 jours et les compteurs éteints, rien d'autre", async () => {
    await pool.query("delete from console_session where user_id = $1", [userId]);
    const active = await session();
    const expireeHier = await session({ ilYa: "2 days", duree: "1 day" });
    const expireeIlYa8Jours = await session({ ilYa: "9 days", duree: "1 day" });
    const revoqueeIlYa8Jours = await session({ ilYa: "9 days", duree: "20 days", revoquee: "8 days" });
    const revoqueeHier = await session({ ilYa: "2 days", duree: "20 days", revoquee: "1 day" });

    await pool.query("delete from auth_throttle where key like 'ip:%' or key like 'email:%'");
    const cles = { eteint: `ip:${"1".repeat(64)}`, bloque: `ip:${"2".repeat(64)}`, recent: `email:${"3".repeat(64)}` };
    await pool.query("insert into auth_throttle (key, window_start, updated_at) values ($1, now() - interval '2 days', now() - interval '2 days')", [cles.eteint]);
    await pool.query(
      "insert into auth_throttle (key, window_start, updated_at, blocked_until) values ($1, now() - interval '2 days', now() - interval '2 days', now() + interval '1 hour')",
      [cles.bloque],
    );
    await pool.query("insert into auth_throttle (key, window_start) values ($1, now())", [cles.recent]);

    const { rows } = await pool.query<{ n: number }>("select purge_console_sessions() as n");
    expect(rows[0].n).toBeGreaterThanOrEqual(3);

    const sessions = (await pool.query<{ id: string }>("select id from console_session where user_id = $1", [userId])).rows.map((r) => r.id);
    expect(sessions.sort()).toEqual([active, expireeHier, revoqueeHier].sort());
    expect(sessions).not.toContain(expireeIlYa8Jours);
    expect(sessions).not.toContain(revoqueeIlYa8Jours);
    const compteurs = (await pool.query<{ key: string }>("select key from auth_throttle where key like 'ip:%' or key like 'email:%'")).rows.map((r) => r.key);
    expect(compteurs.sort()).toEqual([cles.bloque, cles.recent].sort());
  });

  it("aucun rôle applicatif ne lit une session ni un compteur, ni n'exécute la purge", async () => {
    const { rows: roles } = await pool.query<{ rolname: string }>(
      "select rolname from pg_roles where rolname in ('console_ro', 'mip_api') order by 1",
    );
    expect(roles.map((r) => r.rolname)).toContain("mip_api");
    for (const { rolname } of roles) {
      const { rows } = await pool.query(
        `select has_table_privilege($1, 'console_session', 'select') as sessions,
                has_table_privilege($1, 'auth_throttle', 'select') as compteurs,
                has_function_privilege($1, 'purge_console_sessions()', 'execute') as purge`,
        [rolname],
      );
      expect(rows[0], rolname).toEqual({ sessions: false, compteurs: false, purge: false });
    }
    const { rows: rls } = await pool.query(
      "select relname, relrowsecurity from pg_class where relname in ('console_session', 'auth_throttle') order by relname",
    );
    expect(rls).toEqual([
      { relname: "auth_throttle", relrowsecurity: true },
      { relname: "console_session", relrowsecurity: true },
    ]);
  });
});
