#!/usr/bin/env node
// LES RÔLES DE console-api (C13, migration-v93) : la base accorde-t-elle EXACTEMENT
// ce que dit `packages/db/roles/console-api.mjs` — ni plus, ni moins ?
//
//   DATABASE_URL=<base migrée> node scripts/ci/verify-db-roles-console.mjs [--bundle <fichier>]
//
// En CI après les migrations, et en lecture contre la production (rien n'est
// écrit). Pour chaque rôle (`mip_console`, `mip_identity`) :
//   1. le rôle : aucun attribut de rôle privilégié, aucune appartenance, ses
//      réglages et son plafond de connexions ;
//   2. les relations : les privilèges de TABLE sont exactement ceux de la liste,
//      sur toutes les relations du schéma ; les privilèges de COLONNE aussi ;
//   3. les fonctions à droits de propriétaire retirées à PUBLIC : exécutables par
//      le rôle, exactement celles de la liste ;
//   4. RLS : une policy du rôle sur chaque table accordée sous RLS ;
//   5. le bundle de console-api : toute relation qu'il NOMME est couverte par l'un
//      des deux rôles, et toute fonction retirée à PUBLIC qu'il appelle est
//      accordée à `mip_console` — la garde « une migration retire EXECUTE à PUBLIC
//      sans l'accorder au rôle qui s'en sert ».
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { HORS_DROITS, MIP_CONSOLE, PRIVILEGES, ROLES } from "../../packages/db/roles/console-api.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Le nom apparaît-il comme identifiant entier dans le code ? */
export function nomme(code, nom) {
  return new RegExp(`(?<![A-Za-z0-9_])${nom}(?![A-Za-z0-9_])`).test(code);
}

/** Les privilèges attendus d'un rôle sur une colonne, par privilège. */
function colonnesAttendues(spec, table, privilege) {
  return new Set(spec.colonnes[table]?.[privilege] ?? []);
}

/**
 * @param {import("pg").ClientBase} c
 * @param {typeof MIP_CONSOLE} spec
 */
export async function verifierRole(c, spec) {
  const constats = [];
  const ok = (m) => constats.push({ ok: true, message: `${spec.nom} — ${m}` });
  const faute = (m) => constats.push({ ok: false, message: `${spec.nom} — ${m}` });

  const { rows: [role] } = await c.query(
    `select r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolconnlimit,
            coalesce(r.rolconfig, '{}') as rolconfig,
            array(select g.rolname::text from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid) as membre_de
       from pg_roles r where r.rolname = $1`,
    [spec.nom],
  );
  if (!role) {
    faute("le rôle n'existe pas (migration-v93 non appliquée ?)");
    return constats;
  }
  const attributs = ["rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb", "rolreplication"].filter((a) => role[a]);
  (attributs.length ? faute : ok)(`attributs : ${attributs.join(", ") || "aucun privilège de rôle"}`);
  (role.membre_de.length ? faute : ok)(`appartenances : ${role.membre_de.join(", ") || "aucune"}`);
  const reglages = new Map(role.rolconfig.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  for (const [cle, valeur] of Object.entries(spec.reglages)) {
    (reglages.get(cle) === valeur ? ok : faute)(`réglage ${cle} = ${reglages.get(cle) ?? "(absent)"} (attendu ${valeur})`);
  }
  for (const cle of reglages.keys()) if (!(cle in spec.reglages)) faute(`réglage ${cle} posé, hors de la liste`);
  (role.rolconnlimit === spec.limiteConnexions ? ok : faute)(`plafond de connexions : ${role.rolconnlimit} (attendu ${spec.limiteConnexions})`);

  // Les relations, niveau table.
  const { rows: relations } = await c.query(
    `select c.relname, c.relrowsecurity, ${PRIVILEGES.map((p) => `has_table_privilege($1, c.oid, '${p}') as "${p}"`).join(", ")},
            has_table_privilege($1, c.oid, 'TRUNCATE') as "TRUNCATE"
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition
      order by c.relname`,
    [spec.nom],
  );
  const parNom = new Map(relations.map((r) => [r.relname, r]));
  for (const t of [...Object.keys(spec.tables), ...Object.keys(spec.colonnes)]) if (!parNom.has(t)) faute(`${t} : dans la liste, absente de la base`);
  let ecarts = 0;
  for (const r of relations) {
    const accordes = [...PRIVILEGES, "TRUNCATE"].filter((p) => r[p]);
    const attendus = spec.tables[r.relname] ?? [];
    if (accordes.join() !== [...attendus].sort((a, b) => PRIVILEGES.indexOf(a) - PRIVILEGES.indexOf(b)).join()) {
      ecarts++;
      faute(`${r.relname} : ${accordes.join(", ") || "aucun droit"} (attendu ${attendus.join(", ") || "aucun"})`);
    }
  }
  if (!ecarts) ok(`droits de table : ${Object.keys(spec.tables).length} relations, rien d'autre sur ${relations.length}`);

  // Les colonnes : ce qui n'est accordé que par colonnes.
  const { rows: colonnes } = await c.query(
    `select c.relname, a.attname,
            ${["SELECT", "INSERT", "UPDATE"].map((p) => `has_column_privilege($1, c.oid, a.attnum, '${p}') and not has_table_privilege($1, c.oid, '${p}') as "${p}"`).join(", ")}
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_any_column_privilege($1, c.oid, 'SELECT, INSERT, UPDATE')`,
    [spec.nom],
  );
  let ecartsColonnes = 0;
  for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
    const reel = new Map();
    for (const col of colonnes) if (col[privilege]) reel.set(col.relname, [...(reel.get(col.relname) ?? []), col.attname]);
    const tables = new Set([...reel.keys(), ...Object.keys(spec.colonnes).filter((t) => spec.colonnes[t][privilege])]);
    for (const t of tables) {
      const a = [...(reel.get(t) ?? [])].sort().join(", ");
      const e = [...colonnesAttendues(spec, t, privilege)].sort().join(", ");
      if (a !== e) {
        ecartsColonnes++;
        faute(`${t} : ${privilege} par colonnes (${a || "aucune"}), attendu (${e || "aucune"})`);
      }
    }
  }
  if (!ecartsColonnes) ok(`droits par colonnes : ${Object.keys(spec.colonnes).length} tables, conformes`);

  // Les fonctions à droits de propriétaire que PUBLIC n'exécute plus.
  const { rows: fonctions } = await c.query(
    `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege($1, p.oid, 'EXECUTE')
        and not has_function_privilege('public', p.oid, 'EXECUTE')`,
    [spec.nom],
  );
  const executees = fonctions.map((f) => f.proname).sort().join(", ");
  const attendues = [...spec.fonctions].sort().join(", ");
  (executees === attendues ? ok : faute)(`fonctions retirées à PUBLIC exécutables : ${executees || "aucune"} (attendu ${attendues || "aucune"})`);

  // RLS : une policy du rôle sur chaque table accordée sous RLS.
  const { rows: policies } = await c.query(
    `select c.relname from pg_policy p join pg_class c on c.oid = p.polrelid
      where (select oid from pg_roles where rolname = $1) = any(p.polroles)`,
    [spec.nom],
  );
  const couvertes = new Set(policies.map((p) => p.relname));
  const sansPolicy = [...Object.keys(spec.tables), ...Object.keys(spec.colonnes)].filter((t) => parNom.get(t)?.relrowsecurity && !couvertes.has(t));
  (sansPolicy.length ? faute : ok)(`RLS : ${sansPolicy.length ? `sans policy : ${sansPolicy.join(", ")}` : "une policy sur chaque table accordée sous RLS"}`);
  return constats;
}

/** Le bundle : relations nommées couvertes, fonctions retirées à PUBLIC accordées. */
export async function verifierBundle(c, code) {
  const constats = [];
  const { rows: relations } = await c.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition`,
  );
  const couvertes = new Set(ROLES.flatMap((r) => [...Object.keys(r.tables), ...Object.keys(r.colonnes)]));
  const orphelines = relations
    .map((r) => r.relname)
    .filter((t) => nomme(code, t) && !couvertes.has(t) && !(t in HORS_DROITS));
  constats.push(
    orphelines.length
      ? { ok: false, message: `bundle : relations nommées sans droit — ${orphelines.join(", ")} (une migration doit les accorder, et la liste les nommer)` }
      : { ok: true, message: "bundle : toute relation nommée est couverte par un rôle" },
  );
  const { rows: fermees } = await c.query(
    `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and not has_function_privilege('public', p.oid, 'EXECUTE')`,
  );
  const appelees = fermees.map((f) => f.proname).filter((f) => new RegExp(`(?<![A-Za-z0-9_])${f}\\s*\\(`).test(code) && !MIP_CONSOLE.fonctions.includes(f));
  constats.push(
    appelees.length
      ? { ok: false, message: `bundle : fonctions retirées à PUBLIC appelées sans droit — ${appelees.join(", ")}` }
      : { ok: true, message: "bundle : toute fonction retirée à PUBLIC qu'il appelle est accordée à mip_console" },
  );
  return constats;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL requise (une base migrée)");
    process.exit(2);
  }
  const i = process.argv.indexOf("--bundle");
  const bundle = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(RACINE, "services", "console-api", "dist", "server.mjs");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const constats = [];
  try {
    for (const spec of ROLES) constats.push(...(await verifierRole(c, spec)));
    if (existsSync(bundle)) constats.push(...(await verifierBundle(c, readFileSync(bundle, "utf8"))));
    else constats.push({ ok: true, message: `bundle absent (${path.relative(RACINE, bundle)}) : non vérifié` });
  } finally {
    await c.end();
  }
  for (const k of constats) console.log(`${k.ok ? "✓" : "✗"} ${k.message}`);
  const fautes = constats.filter((k) => !k.ok).length;
  if (fautes) {
    console.error(`::error::rôles de console-api : ${fautes} écart(s) avec packages/db/roles/console-api.mjs`);
    process.exit(1);
  }
  console.log("rôles de console-api : conformes à leurs listes");
}
