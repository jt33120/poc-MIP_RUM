#!/usr/bin/env node
// Échantillonneur SERVEUR du verrou d'ingestion d'une application.
//
// POURQUOI IL EXISTE. La porte de P2 se joue sur staging, contre le collector
// DÉPLOYÉ. Son image (`pnpm deploy --prod`) n'embarque pas la sonde client
// (`sonde-pg.mjs`), et il ne faut pas qu'elle l'embarque. Reste ce que la base
// voit : `pg_locks`. Un verrou pris par `pg_advisory_xact_lock(int4, int4)` y
// apparaît en `locktype = 'advisory'`, clé 1 dans `classid`, clé 2 dans
// `objid` (entier non signé), `objsubid = 2` — accordé (`granted`) tant que la
// transaction qui le tient n'a pas commis, en attente sinon. Lire cette vue à
// cadence fixe donne, sans toucher au collector :
//   - l'UTILISATION : part des échantillons où le verrou de l'app est tenu ;
//   - la FILE : combien de transactions attendent derrière lui.
//
// C'est un sondage, pas une mesure exacte : sa précision tient au nombre
// d'échantillons (≈ 1/√n), et sa cadence au temps d'une requête (un
// aller-retour : ~100 échantillons/s depuis Amsterdam vers Francfort, plus
// qu'assez sur 30 s). Le banc local (`banc-collecteur-local.mjs`) le lance à
// côté de la sonde client, qui mesure la tenue exacte : l'écart entre les deux
// est écrit dans le relevé, et c'est ce qui autorise à ne garder que lui sur
// staging.
//
// Usage (base de STAGING ou de banc — jamais DATABASE_URL, jamais la production) :
//   BENCH_DATABASE_URL=postgres://…/… APP=gip-banc DUREE_S=30 [PERIODE_MS=5] \
//     node scripts/bench/echantillonner-verrou.mjs
// Lancer `scripts/load-bench.mjs` (RATE=…) en même temps, sur la même app.
import { pathToFileURL } from "node:url";
import { VERROU_INGESTION_NS } from "../../packages/backend/lib/privacy-barriere.mjs";

/**
 * La requête d'un échantillon. `objid` est un oid (non signé) : `hashtext`
 * rend un int4 signé, d'où le masque sur 32 bits avant la comparaison.
 */
export const SQL_ECHANTILLON = `
  select count(*) filter (where granted)::int as tenus,
         count(*) filter (where not granted)::int as en_attente
    from pg_locks
   where locktype = 'advisory' and objsubid = 2
     and classid = $1::oid
     and objid = ((hashtext($2)::int8) & 4294967295)::oid`;

const maintenant = () => performance.timeOrigin + performance.now();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Échantillonne jusqu'à `arret()` (ou `dureeMs`). Chaque échantillon est
 * horodaté au MILIEU de son aller-retour : c'est l'instant le plus probable
 * de sa lecture côté serveur.
 * @param {{ query: Function }} client  un client `pg` connecté
 * @returns {Promise<{t: number, tenus: number, enAttente: number}[]>}
 */
export async function echantillonner(client, { app, dureeMs = Infinity, periodeMs = 5, arret = () => false }) {
  const echantillons = [];
  const fin = maintenant() + dureeMs;
  while (!arret() && maintenant() < fin) {
    const t0 = maintenant();
    const { rows } = await client.query(SQL_ECHANTILLON, [VERROU_INGESTION_NS, app]);
    echantillons.push({ t: (t0 + maintenant()) / 2, tenus: rows[0].tenus, enAttente: rows[0].en_attente });
    if (periodeMs > 0) await dormir(periodeMs);
  }
  return echantillons;
}

/** Réduit des échantillons à une fenêtre [depuis, jusqua]. PURE. */
export function resumer(echantillons, { depuis = -Infinity, jusqua = Infinity } = {}) {
  const dans = echantillons.filter((e) => e.t >= depuis && e.t <= jusqua);
  const n = dans.length;
  if (!n) return { echantillons: 0, utilisation: null, fileMoyenne: null, fileMax: null, ecartType: null };
  const p = dans.filter((e) => e.tenus > 0).length / n;
  return {
    echantillons: n,
    utilisation: Math.round(p * 10_000) / 10_000,
    // Erreur type d'une proportion : l'ordre de grandeur de la précision.
    ecartType: Math.round(Math.sqrt((p * (1 - p)) / n) * 10_000) / 10_000,
    fileMoyenne: Math.round((dans.reduce((s, e) => s + e.enAttente, 0) / n) * 100) / 100,
    fileMax: Math.max(...dans.map((e) => e.enAttente)),
  };
}

async function main() {
  const url = process.env.BENCH_DATABASE_URL;
  const app = process.env.APP;
  if (!url || !app) {
    console.error("[echantillonner-verrou] BENCH_DATABASE_URL et APP sont obligatoires (DATABASE_URL n'est jamais lue)");
    process.exit(2);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, application_name: "mip-banc-echantillonneur" });
  await client.connect();
  try {
    const dureeMs = Number(process.env.DUREE_S ?? 30) * 1000;
    const debut = maintenant();
    const e = await echantillonner(client, { app, dureeMs, periodeMs: Number(process.env.PERIODE_MS ?? 5) });
    console.log(JSON.stringify({ app, fenetre: { debut, fin: maintenant() }, ...resumer(e) }, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[echantillonner-verrou] échec :", err?.message ?? err);
    process.exit(1);
  });
}
