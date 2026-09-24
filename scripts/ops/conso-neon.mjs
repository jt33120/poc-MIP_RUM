// Consommation du projet Neon, relue par son API — le premier réflexe quand la
// base refuse les connexions (ADR-0014).
//
// POURQUOI. Le 24/09/2026, la production est tombée sur « Your account or project
// has exceeded the quota » : 110 heures de calcul consommées pour 100 autorisées
// par l'offre gratuite. Rien dans le code n'était en cause, et rien ne le disait
// avant la coupure. Ce script le dit avant : calcul consommé depuis le début du
// mois, projection à la fin du mois au rythme observé, stockage.
//
// LECTURE SEULE, par l'API d'administration de Neon : il ne se connecte pas à la
// base, et ne la réveille donc pas.
//
// Usage :
//   NEON_API_KEY=… node scripts/ops/conso-neon.mjs [projet]
// La clé vient du gestionnaire de mots de passe ou de l'environnement de
// l'opérateur. JAMAIS `source .env` : ce fichier porte aussi la chaîne de
// connexion de production.
//
// Codes de sortie : 0 sous 80 % du quota projeté · 1 au-delà · 2 appel impossible.
const PROJET = process.argv[2] ?? "rough-firefly-49250892";
/** Offre gratuite de Neon (free_v3), relevée le 24/09/2026. */
const QUOTA_CU_H = 100;
const STOCKAGE_MAX_OCTETS = 0.5 * 1024 ** 3;

const cle = process.env.NEON_API_KEY?.trim();
if (!cle) {
  console.error("NEON_API_KEY absente — rien n'est appelé.");
  process.exit(2);
}

let projet;
try {
  const res = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(PROJET)}`, {
    headers: { authorization: `Bearer ${cle}`, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  projet = (await res.json()).project;
} catch (err) {
  console.error(`API Neon injoignable : ${err.message}`);
  process.exit(2);
}

const cuH = (projet.compute_time_seconds ?? 0) / 3600;
const debut = new Date(projet.consumption_period_start);
const fin = new Date(projet.consumption_period_end);
const ecoule = Math.max(1, Date.now() - debut.getTime());
const projete = cuH * ((fin.getTime() - debut.getTime()) / ecoule);
const stockage = projet.synthetic_storage_size ?? 0;
const offre = projet.owner?.subscription_type ?? "inconnue";

const pct = (x, max) => `${Math.round((100 * x) / max)} %`;
console.log(`Projet ${projet.name} (${PROJET}), offre ${offre}`);
console.log(`Période : ${debut.toISOString().slice(0, 10)} → ${fin.toISOString().slice(0, 10)}`);
console.log(`Calcul consommé : ${cuH.toFixed(1)} CU-h (${pct(cuH, QUOTA_CU_H)} du quota gratuit de ${QUOTA_CU_H})`);
console.log(`Projection fin de période : ${projete.toFixed(0)} CU-h (${pct(projete, QUOTA_CU_H)})`);
console.log(`Stockage : ${(stockage / 1024 ** 2).toFixed(0)} Mo (${pct(stockage, STOCKAGE_MAX_OCTETS)} de 0,5 Go)`);
console.log(`Historique restaurable : ${((projet.history_retention_seconds ?? 0) / 3600).toFixed(0)} h`);

const alerte = offre.startsWith("free") && (projete > 0.8 * QUOTA_CU_H || stockage > 0.8 * STOCKAGE_MAX_OCTETS);
if (alerte) console.log("⚠ au rythme actuel, un quota de l'offre gratuite sera dépassé : ralentir les cadences ou passer en offre payante (ADR-0014).");
process.exit(alerte ? 1 : 0);
