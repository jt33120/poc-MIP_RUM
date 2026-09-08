// Crée (ou met à jour) le compte de démonstration de la vitrine publique — celui
// que /demo ouvre sans mot de passe quand DEMO_USER_EMAIL le désigne.
//
//   DATABASE_URL=... node scripts/seed-demo-user.mjs
//   DATABASE_URL=... node scripts/seed-demo-user.mjs "Console MIP RUM" insight-performance
//
// Les arguments désignent les applications que le visiteur pourra voir, par
// app_id exact OU par nom (correspondance insensible à la casse et partielle,
// pour taper le nom lu dans la console plutôt qu'un identifiant). Sans argument,
// on retombe sur DEMO_APPS par défaut.
//
// Idempotent : ré-exécuter met le scope à jour sans rien casser.
//
// TROIS PROPRIÉTÉS QUE CE SCRIPT TIENT, et qu'il ne faut pas contourner à la main :
//
//   1. role = 'viewer'. Jamais admin : /demo refuse un compte admin, mais un
//      compte créé admin ici serait un compte admin sans mot de passe utilisable
//      en base — on ne le crée pas du tout.
//   2. Mot de passe INUTILISABLE. Le hash posé n'est pas un hash bcrypt valide,
//      donc `bcrypt.compare` renvoie toujours false : ce compte ne peut PAS se
//      connecter par le formulaire de login, uniquement par /demo.
//   3. Scope explicite et vérifié. Chaque application demandée doit exister dans
//      app_registry, sinon le script s'arrête sans rien écrire et affiche ce qui
//      existe. Un scope vide donnerait une démo qui ne montre rien ; un scope
//      null donnerait une démo qui montre TOUT, y compris les vrais clients.
//
// CE QUE VOUS PUBLIEZ : tout ce que voient les applications listées devient
// visible par quiconque clique sur le bouton de la vitrine — routes, temps de
// chargement, messages d'erreur, parcours. À n'ouvrir que sur des applications
// dont c'est acceptable.
import pg from "pg";

const EMAIL = (process.env.DEMO_USER_EMAIL ?? "demo@mip-rum.local").trim().toLowerCase();
const DEMO_APPS = ["Console MIP RUM", "Insight Performance"];

// Non-hash : 60 caractères au format bcrypt mais dont le corps n'est pas du
// base64 bcrypt valide. bcrypt.compare renvoie false pour toute entrée.
const UNUSABLE = "$2b$10$" + "x".repeat(53);

const demandes = process.argv.slice(2).length ? process.argv.slice(2) : DEMO_APPS;

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

const { rows: apps } = await pool.query(
  `select app_id, name, active from app_registry order by app_id`,
);

/** Résout un argument en app_id : identifiant exact d'abord, puis nom. */
function resoudre(saisie) {
  const s = saisie.trim().toLowerCase();
  const parId = apps.find((a) => a.app_id.toLowerCase() === s);
  if (parId) return parId;
  const parNom = apps.filter((a) => a.name.toLowerCase().includes(s));
  if (parNom.length === 1) return parNom[0];
  if (parNom.length > 1) {
    console.error(
      `✘ « ${saisie} » correspond à ${parNom.length} applications : ` +
        parNom.map((a) => a.app_id).join(", ") +
        ". Précisez l'app_id.",
    );
    process.exit(1);
  }
  return null;
}

const resolues = demandes.map((d) => ({ saisie: d, app: resoudre(d) }));
const manquantes = resolues.filter((r) => !r.app);

if (manquantes.length) {
  console.error(`✘ introuvable(s) : ${manquantes.map((m) => `« ${m.saisie} »`).join(", ")}`);
  console.error("\nApplications enregistrées dans cette base :");
  for (const a of apps) {
    console.error(`  ${a.active ? "●" : "○"} ${a.app_id.padEnd(24)} ${a.name}`);
  }
  console.error(
    "\nRien n'a été écrit. Créez l'application manquante dans la console (/select/new),\n" +
      "puis relancez — un scope incomplet donnerait une démo à moitié vide.",
  );
  await pool.end();
  process.exit(1);
}

const scope = resolues.map((r) => r.app.app_id);
const inactives = resolues.filter((r) => !r.app.active);

await pool.query(
  `insert into console_user (email, password_hash, role, apps, active)
   values ($1, $2, 'viewer', $3, true)
   on conflict (email) do update
     set role = 'viewer', apps = excluded.apps, active = true,
         password_hash = excluded.password_hash`,
  [EMAIL, UNUSABLE, scope],
);
await pool.query(`insert into audit_log (user_email, action, detail) values ($1, $2, $3)`, [
  EMAIL,
  "demo_user_seeded",
  JSON.stringify({ apps: scope }),
]);

console.log(`✓ compte démo : ${EMAIL} (viewer, lecture seule, sans mot de passe utilisable)`);
for (const r of resolues) console.log(`    → ${r.app.app_id.padEnd(24)} ${r.app.name}`);
if (inactives.length) {
  console.log(
    `\n⚠ application(s) désactivée(s) dans app_registry : ${inactives
      .map((r) => r.app.app_id)
      .join(", ")} — la démo les listera sans données.`,
  );
}
console.log(
  `\nIl reste UNE chose à faire pour que le bouton apparaisse sur la vitrine :\n` +
    `    vercel env add DEMO_USER_EMAIL production   # coller : ${EMAIL}\n` +
    `puis redéployer. Sans cette variable, /demo renvoie vers /login et le bouton\n` +
    `n'est pas rendu — la démo reste fermée.`,
);

await pool.end();
