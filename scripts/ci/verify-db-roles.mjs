#!/usr/bin/env node
// Garde CI : le rôle `mip_api` a EXACTEMENT les droits de sa liste blanche.
//
//   DATABASE_URL=<base migrée> node scripts/ci/verify-db-roles.mjs [--bundle <fichier>]
//
// Le script ne lit que les catalogues (`pg_roles`, `pg_class`, `has_*_privilege`) :
// il peut viser une base de production, en propriétaire ou en `mip_api`.
//
// CE QU'IL VÉRIFIE, dans les deux sens — rien de moins, rien de plus :
//   1. le rôle : ni superutilisateur, ni BYPASSRLS, ni CREATEROLE, CREATEDB,
//      REPLICATION ; membre d'AUCUN rôle ; ses réglages (lecture seule par
//      défaut, 15 s par requête, …) et son plafond de connexions ;
//   2. les tables : SELECT sur la liste blanche, sur les colonnes listées pour
//      les tables lues par colonnes, et AUCUN autre droit sur aucune relation —
//      ni INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, ni séquence ;
//      droits de PUBLIC compris (`has_table_privilege` les compte) ;
//   3. les fonctions : parmi celles à droits de propriétaire (SECURITY DEFINER),
//      `mip_api` n'exécute QUE les lectures listées — une fonction qui écrit et
//      reste ouverte à PUBLIC lui rendrait l'écriture que ses droits lui refusent ;
//   4. le schéma et la base : aucun CREATE ;
//   5. RLS : une policy de LECTURE pour `mip_api` sur chaque table de la liste
//      sous RLS (sans elle, il lirait 0 ligne, sans erreur), et aucune policy
//      d'écriture ;
//   6. le bundle du service `api` : toute relation qu'il NOMME est accordée, ou
//      déclarée « hors lecture » avec sa raison. C'est ce qui fait échouer une PR
//      de la console qui ajoute une lecture v1 sur une table nouvelle sans la
//      migration qui l'accorde — en CI, pas en production.
//
// Une entrée de la liste que le bundle ne nomme plus est SIGNALÉE (⚠), pas
// refusée : la retirer demande une migration, qui n'a pas à bloquer la PR de
// console qui a cessé de la lire.
//
// Liste blanche : `packages/db/roles/mip-api.mjs`. Migration : v89.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import {
  COLONNES,
  FONCTIONS,
  HORS_LECTURE,
  LIMITE_CONNEXIONS,
  REGLAGES,
  RETIREES_A_PUBLIC,
  TABLES,
} from "../../packages/db/roles/mip-api.mjs";

const ROLE = "mip_api";
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRIVILEGES_TABLE = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const PRIVILEGES_COLONNE = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];

/** Le bundle à confronter : `--bundle <fichier>`, sinon celui que construit `services/api/build.mjs`. */
function cheminBundle(argv) {
  const i = argv.indexOf("--bundle");
  return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : path.join(RACINE, "services", "api", "dist", "server.mjs");
}

/** Le nom apparaît-il comme identifiant entier dans le code ? (`rum_event` ≠ `rum_event_index`) */
export function nomme(code, nom) {
  return new RegExp(`(?<![A-Za-z0-9_])${nom}(?![A-Za-z0-9_])`).test(code);
}

/**
 * Confronte l'état d'une base à la liste blanche. Rend les constats ; n'écrit rien.
 * @param {import("pg").ClientBase} c
 * @param {{ code?: string | null }} [options]
 */
export async function verifierRoleApi(c, { code = null } = {}) {
  /** @type {{ ok: boolean, niveau?: "alerte", message: string }[]} */
  const constats = [];
  const ok = (message) => constats.push({ ok: true, message });
  const faute = (message) => constats.push({ ok: false, message });
  const alerte = (message) => constats.push({ ok: true, niveau: "alerte", message });

  // ── 1. Le rôle ──────────────────────────────────────────────────────────────
  const { rows: [role] } = await c.query(
    `select r.oid, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
            r.rolconnlimit, coalesce(r.rolconfig, '{}') as rolconfig,
            array(select g.rolname::text from pg_auth_members m join pg_roles g on g.oid = m.roleid
                   where m.member = r.oid order by 1) as membre_de
       from pg_roles r where r.rolname = $1`,
    [ROLE],
  );
  if (!role) {
    faute(`le rôle ${ROLE} n'existe pas (migration-v89 non appliquée ?)`);
    return constats;
  }
  const attributs = ["rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb", "rolreplication"].filter((a) => role[a]);
  (attributs.length ? faute : ok)(`attributs : ${attributs.length ? attributs.join(", ") : "aucun privilège de rôle"}`);
  (role.membre_de.length ? faute : ok)(`appartenances : ${role.membre_de.length ? role.membre_de.join(", ") : "aucune"}`);
  const reglages = new Map(role.rolconfig.map((/** @type {string} */ l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  for (const [cle, valeur] of Object.entries(REGLAGES)) {
    (reglages.get(cle) === valeur ? ok : faute)(`réglage ${cle} = ${reglages.get(cle) ?? "(absent)"} (attendu ${valeur})`);
  }
  (role.rolconnlimit === LIMITE_CONNEXIONS ? ok : faute)(`plafond de connexions : ${role.rolconnlimit} (attendu ${LIMITE_CONNEXIONS})`);

  // ── 2. Les relations ────────────────────────────────────────────────────────
  const { rows: relations } = await c.query(
    `select c.oid, c.relname, c.relkind, c.relrowsecurity,
            ${PRIVILEGES_TABLE.map((p) => `has_table_privilege($1, c.oid, '${p}') as "${p}"`).join(", ")}
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      order by c.relname`,
    [ROLE],
  );
  const parNom = new Map(relations.map((r) => [r.relname, r]));
  const tables = new Set(TABLES);
  const parColonnes = new Map(Object.entries(COLONNES));
  for (const nom of [...tables, ...parColonnes.keys()]) {
    if (!parNom.has(nom)) faute(`${nom} : dans la liste blanche, absente de la base`);
  }
  let tablesEnTrop = 0;
  for (const r of relations) {
    const accordes = PRIVILEGES_TABLE.filter((p) => r[p]);
    const attendus = tables.has(r.relname) ? ["SELECT"] : [];
    if (accordes.join() !== attendus.join()) {
      tablesEnTrop++;
      faute(`${r.relname} : droits ${accordes.join(", ") || "aucun"} (attendu ${attendus.join(", ") || "aucun"})`);
    }
  }
  if (!tablesEnTrop) ok(`droits de table : SELECT sur ${tables.size} relations, rien d'autre sur ${relations.length}`);

  // Par colonne : un droit d'écriture sur UNE colonne ne se voit pas au niveau
  // de la table ; un SELECT par colonnes non plus. Toutes les tables sont lues.
  const { rows: colonnes } = await c.query(
    `select c.relname, a.attname, has_table_privilege($1, c.oid, 'SELECT') as table_lue,
            ${PRIVILEGES_COLONNE.map((p) => `has_column_privilege($1, c.oid, a.attnum, '${p}') as "${p}"`).join(", ")}
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_any_column_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')`,
    [ROLE],
  );
  const vues = new Map();
  for (const col of colonnes) {
    for (const p of PRIVILEGES_COLONNE.filter((p) => p !== "SELECT")) {
      if (col[p]) faute(`${col.relname}.${col.attname} : ${p} accordé`);
    }
    if (col.SELECT && !col.table_lue) vues.set(col.relname, [...(vues.get(col.relname) ?? []), col.attname]);
  }
  for (const [nom, attendues] of parColonnes) {
    const lues = (vues.get(nom) ?? []).sort();
    const voulues = [...attendues].sort();
    (lues.join() === voulues.join() ? ok : faute)(`${nom} : colonnes ${lues.join(", ") || "aucune"} (attendu ${voulues.join(", ")})`);
  }
  for (const nom of vues.keys()) {
    if (!parColonnes.has(nom)) faute(`${nom} : colonnes lisibles hors liste (${vues.get(nom).join(", ")})`);
  }

  const { rows: sequences } = await c.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'
        and (has_sequence_privilege($1, c.oid, 'USAGE') or has_sequence_privilege($1, c.oid, 'SELECT')
             or has_sequence_privilege($1, c.oid, 'UPDATE'))`,
    [ROLE],
  );
  (sequences.length ? faute : ok)(`séquences : ${sequences.length ? sequences.map((s) => s.relname).join(", ") : "aucun droit"}`);

  // ── 3. Les fonctions à droits de propriétaire ───────────────────────────────
  const { rows: fonctions } = await c.query(
    `select p.proname, p.prosecdef, p.oid::regprocedure::text as signature,
            has_function_privilege($1, p.oid, 'EXECUTE') as execute
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype
      order by 1`,
    [ROLE],
  );
  const definer = fonctions.filter((f) => f.prosecdef);
  const lectures = new Set(FONCTIONS);
  const ouvertes = definer.filter((f) => f.execute && !lectures.has(f.proname));
  (ouvertes.length ? faute : ok)(
    `fonctions à droits de propriétaire exécutables : ${
      ouvertes.length ? `hors liste — ${ouvertes.map((f) => f.signature).join(", ")}` : `celles de la liste seulement (${FONCTIONS.join(", ")})`
    }`,
  );
  for (const nom of FONCTIONS) {
    const trouvees = definer.filter((f) => f.proname === nom);
    (trouvees.length && trouvees.every((f) => f.execute) ? ok : faute)(`fonction de lecture ${nom} : ${trouvees.length ? "exécutable" : "absente"}`);
  }
  for (const nom of RETIREES_A_PUBLIC) {
    const encore = definer.filter((f) => f.proname === nom && f.execute);
    (encore.length ? faute : ok)(`fonction d'écriture ${nom} : ${encore.length ? "encore exécutable" : "fermée"}`);
  }

  // ── 4. Schéma et base ───────────────────────────────────────────────────────
  const { rows: [creation] } = await c.query(
    `select has_schema_privilege($1, 'public', 'CREATE') as schema,
            has_database_privilege($1, current_database(), 'CREATE') as base`,
    [ROLE],
  );
  (creation.schema || creation.base ? faute : ok)(
    `création d'objets : ${creation.schema ? "CREATE sur le schéma public " : ""}${creation.base ? "CREATE sur la base" : ""}${!creation.schema && !creation.base ? "aucune" : ""}`,
  );

  // ── 5. RLS ──────────────────────────────────────────────────────────────────
  const { rows: policies } = await c.query(
    `select c.relname, p.polname, p.polcmd, pg_get_expr(p.polqual, p.polrelid) as qual
       from pg_policy p join pg_class c on c.oid = p.polrelid
      where $1::oid = any(p.polroles)`,
    [role.oid],
  );
  const lecturesRls = new Set(policies.filter((p) => p.polcmd === "r").map((p) => p.relname));
  for (const p of policies.filter((p) => p.polcmd !== "r")) faute(`policy ${p.relname}.${p.polname} : commande ${p.polcmd}, pas une lecture`);
  const sansPolicy = [...tables, ...parColonnes.keys()].filter((n) => parNom.get(n)?.relrowsecurity && !lecturesRls.has(n));
  (sansPolicy.length ? faute : ok)(`RLS : ${sansPolicy.length ? `aucune policy de lecture sur ${sansPolicy.join(", ")} (0 ligne, sans erreur)` : "une policy de lecture sur chaque table de la liste sous RLS"}`);
  const horsListe = [...lecturesRls].filter((n) => !tables.has(n) && !parColonnes.has(n));
  (horsListe.length ? faute : ok)(`RLS : ${horsListe.length ? `policies sur des tables hors liste — ${horsListe.join(", ")}` : "aucune policy hors liste"}`);

  // ── 6. Le bundle ────────────────────────────────────────────────────────────
  if (code !== null) {
    const nommees = relations.map((r) => r.relname).filter((n) => nomme(code, n));
    const manquantes = nommees.filter((n) => !tables.has(n) && !parColonnes.has(n) && !(n in HORS_LECTURE));
    (manquantes.length ? faute : ok)(
      `bundle : ${manquantes.length ? `relations lues sans droit — ${manquantes.join(", ")} (une migration doit les accorder, et packages/db/roles/mip-api.mjs les lister)` : `les ${nommees.length} relations nommées sont couvertes`}`,
    );
    for (const n of [...tables, ...parColonnes.keys()]) {
      if (!nomme(code, n)) alerte(`${n} : accordée, mais le bundle ne la nomme plus (à retirer par une migration)`);
    }
    const fermees = fonctions.filter((f) => !f.execute && nomme(code, f.proname));
    (fermees.length ? faute : ok)(`bundle : ${fermees.length ? `fonctions appelées sans droit — ${fermees.map((f) => f.signature).join(", ")}` : "aucune fonction appelée sans droit"}`);
  }
  return constats;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL requise (une base migrée)");
    process.exit(2);
  }
  const bundle = cheminBundle(process.argv);
  if (!existsSync(bundle)) {
    console.error(`bundle absent : ${path.relative(RACINE, bundle)} — le construire d'abord : node services/api/build.mjs`);
    process.exit(2);
  }
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: "verify-db-roles" });
  await c.connect();
  try {
    const constats = await verifierRoleApi(c, { code: readFileSync(bundle, "utf8") });
    for (const k of constats) console.log(`${k.ok ? (k.niveau === "alerte" ? "⚠" : "✓") : "✗"} ${k.message}`);
    const fautes = constats.filter((k) => !k.ok).length;
    if (fautes) {
      console.error(`::error::rôle ${ROLE} : ${fautes} écart(s) avec packages/db/roles/mip-api.mjs`);
      process.exitCode = 1;
    } else {
      console.log(`rôle ${ROLE} : conforme à sa liste blanche`);
    }
  } finally {
    await c.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
