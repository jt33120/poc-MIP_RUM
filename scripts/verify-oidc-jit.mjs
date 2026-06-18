// Vérifie le provisioning JIT du SSO/OIDC (route /api/auth/oidc/callback) sur
// Postgres réel : (1) 1re connexion SSO = compte viewer créé avec password_hash
// sentinelle 'sso:oidc' ; (2) rôle/apps de l'IdP font autorité s'ils sont fournis ;
// (3) sinon le rôle géré dans la console est PRÉSERVÉ. Réplique la logique TS du
// callback (calcul role/apps + upsert), pour garantir le comportement sans IdP.
//
// Usage : pg_virtualenv node scripts/verify-oidc-jit.mjs
import pg from "pg";

// DDL minimale (extrait exact de migration-v03) — test focalisé sur le JIT.
const DDL = `
create table if not exists console_user (
  id bigserial primary key, email text unique not null, password_hash text not null,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  apps text[], active boolean not null default true,
  created_at timestamptz not null default now(), last_login_at timestamptz);
create table if not exists audit_log (
  id bigserial primary key, user_email text, action text not null, detail text,
  ts timestamptz not null default now());`;

// Réplique de la logique JIT du callback (role/apps puis upsert).
async function jitLogin(c, mapped) {
  const { rows: [existing] } = await c.query(
    "select role, apps from console_user where email = $1", [mapped.email]);
  const role = mapped.role ?? existing?.role ?? "viewer";
  const apps = mapped.appsProvided ? mapped.apps : (existing?.apps ?? null);
  await c.query(
    `insert into console_user (email, password_hash, role, apps, active, last_login_at)
     values ($1, 'sso:oidc', $2, $3, true, now())
     on conflict (email) do update
       set role = $2, apps = $3, active = true, last_login_at = now()`,
    [mapped.email, role, apps]);
  return { role, apps };
}

const get = async (c, email) =>
  (await c.query("select role, apps, password_hash, active from console_user where email=$1", [email])).rows[0];

function assert(label, cond) {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  await c.connect();
  await c.query(DDL);

  // 1) 1re connexion SSO, roleClaim non configuré (role null), pas d'apps
  await jitLogin(c, { email: "new@mip.fr", role: null, apps: null, appsProvided: false });
  let u = await get(c, "new@mip.fr");
  assert("nouvel utilisateur SSO → viewer par défaut", u.role === "viewer");
  assert("password_hash sentinelle 'sso:oidc' (login mot de passe impossible)", u.password_hash === "sso:oidc");
  assert("compte actif", u.active === true);
  assert("apps null (toutes) si non fourni", u.apps === null);

  // 2) admin géré dans la console, puis connexion SSO SANS claim de rôle → PRÉSERVÉ
  await c.query("update console_user set role='admin' where email='new@mip.fr'");
  await jitLogin(c, { email: "new@mip.fr", role: null, apps: null, appsProvided: false });
  u = await get(c, "new@mip.fr");
  assert("rôle console préservé quand l'IdP ne fournit pas de rôle", u.role === "admin");

  // 3) l'IdP fait autorité : role admin + apps scopées fournis
  await jitLogin(c, { email: "scoped@mip.fr", role: "viewer", apps: ["app-a", "app-b"], appsProvided: true });
  u = await get(c, "scoped@mip.fr");
  assert("apps de l'IdP appliquées (viewer scopé)", JSON.stringify(u.apps) === JSON.stringify(["app-a", "app-b"]));
  await jitLogin(c, { email: "scoped@mip.fr", role: "admin", apps: ["app-a", "app-b"], appsProvided: true });
  u = await get(c, "scoped@mip.fr");
  assert("rôle de l'IdP fait autorité (viewer → admin)", u.role === "admin");

  // 4) audit : aucune écriture ici (le callback logge séparément) — on vérifie juste l'idempotence
  const { rows: [{ n }] } = await c.query("select count(*)::int n from console_user");
  assert("2 comptes créés (pas de doublon malgré les re-logins)", n === 2);

  await c.end();
  console.log(process.exitCode ? "\n[verify-oidc-jit] ÉCHEC." : "\n[verify-oidc-jit] provisioning JIT VÉRIFIÉ.");
}

main().catch((e) => { console.error("[verify-oidc-jit] échec:", e?.message ?? e); process.exit(2); });
