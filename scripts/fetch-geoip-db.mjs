#!/usr/bin/env node
// Dépose (ou vérifie) la base DB-IP Lite utilisée par le GeoIP optionnel (P8.7).
//
// ═════════════════ POURQUOI LA BASE N'EST PAS DANS LE DÉPÔT ══════════════════
//
// La livraison pèse 4,5 Mio compressés et DB-IP en publie une PAR MOIS. Le dépôt
// entier fait aujourd'hui 9,9 Mio : y verser une livraison mensuelle ferait
// grossir l'historique — définitivement, puisque git ne l'oublie jamais — de
// 54 Mio par an, pour une donnée qui se périme. On versionne donc ce qui décrit
// la livraison (version, empreinte, taille, comptes), et le fichier lui-même est
// DÉPOSÉ : par ce script, à la construction de l'image ou sur un volume.
//
// L'alternative — committer le fichier — tient en une ligne de `.gitignore` si
// l'exploitation préfère un dépôt auto-suffisant à un dépôt léger. Le manifeste
// reste valable dans les deux cas.
//
// ════════════════════════════ CE QUE CE SCRIPT FAIT ══════════════════════════
//
//   node scripts/fetch-geoip-db.mjs                 dépose la version du manifeste
//   node scripts/fetch-geoip-db.mjs --verify        vérifie la base déposée, sans réseau
//   node scripts/fetch-geoip-db.mjs --update 2026-10  dépose une nouvelle livraison
//                                                     et RÉÉCRIT le manifeste
//
// Le téléchargement est un fichier statique public : aucun compte, aucune clef,
// et surtout AUCUNE adresse IP de visiteur n'est envoyée nulle part. C'est un
// approvisionnement, pas un appel de géolocalisation — la résolution, elle, est
// entièrement locale (cf. _shared/geoip.mjs).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { chargerBase } from "../apps/ingest/supabase/functions/_shared/geoip.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER = path.join(ICI, "..", "apps", "ingest", "data");
const MANIFESTE = path.join(DOSSIER, "dbip-country-lite.manifest.json");
const BASE_URL = "https://download.db-ip.com/free";

function sortie(code, message) {
  console[code === 0 ? "log" : "error"](message);
  process.exit(code);
}

async function lireManifeste() {
  return JSON.parse(await readFile(MANIFESTE, "utf8"));
}

/** Empreinte + comptes réellement observés dans le fichier. */
function mesurer(octets, version) {
  const sha256 = createHash("sha256").update(octets).digest("hex");
  const csv = gunzipSync(octets).toString("utf8");
  const charge = chargerBase(csv, { version });
  if (!charge.ok) return { sha256, octets: octets.length, erreur: charge.raison, detail: charge.detail };
  return { sha256, octets: octets.length, ...charge.base.stats };
}

async function principal() {
  const args = process.argv.slice(2);
  const verify = args.includes("--verify");
  const iUpdate = args.indexOf("--update");
  const nouvelleVersion = iUpdate >= 0 ? args[iUpdate + 1] : null;

  if (iUpdate >= 0 && !/^\d{4}-\d{2}$/.test(nouvelleVersion ?? "")) {
    sortie(2, "usage : --update AAAA-MM (ex. --update 2026-10)");
  }

  const manifeste = await lireManifeste();
  const version = nouvelleVersion ? `dbip-country-lite-${nouvelleVersion}` : manifeste.version;
  const fichier = path.join(DOSSIER, `${version}.csv.gz`);

  if (verify) {
    let octets;
    try {
      octets = await readFile(fichier);
    } catch {
      sortie(1, `base absente : ${path.relative(process.cwd(), fichier)}\n` +
        "GeoIP restera éteint — l'ingestion, elle, fonctionne (pays estimé d'après le fuseau).");
    }
    const mesure = mesurer(octets, version);
    if (mesure.erreur) sortie(1, `base illisible (${mesure.erreur})`);
    const attendu = manifeste.sha256;
    if (attendu && mesure.sha256 !== attendu) {
      sortie(1, `empreinte inattendue\n  attendue ${attendu}\n  obtenue  ${mesure.sha256}`);
    }
    sortie(0, `base vérifiée : ${version}\n  ${JSON.stringify(mesure, null, 2)}`);
  }

  await mkdir(DOSSIER, { recursive: true });
  const url = `${BASE_URL}/${version}.csv.gz`;
  process.stderr.write(`téléchargement ${url}\n`);
  const reponse = await fetch(url);
  if (!reponse.ok) sortie(1, `téléchargement refusé : HTTP ${reponse.status}`);
  const octets = Buffer.from(await reponse.arrayBuffer());
  const mesure = mesurer(octets, version);
  if (mesure.erreur) sortie(1, `fichier téléchargé illisible (${mesure.erreur})`);

  if (!nouvelleVersion && manifeste.sha256 && mesure.sha256 !== manifeste.sha256) {
    sortie(1,
      `empreinte inattendue pour ${version}\n  manifeste ${manifeste.sha256}\n  reçu      ${mesure.sha256}\n` +
      "DB-IP republie parfois un mois : vérifier, puis `--update` pour réécrire le manifeste.");
  }

  await writeFile(fichier, octets);
  if (nouvelleVersion) {
    await writeFile(MANIFESTE, `${JSON.stringify({
      ...manifeste,
      version,
      url,
      sha256: mesure.sha256,
      octets: mesure.octets,
      plages: mesure.lignes,
      plages_v4: mesure.v4,
      plages_v6: mesure.v6,
      releve_le: new Date().toISOString().slice(0, 10),
    }, null, 2)}\n`);
    process.stderr.write("manifeste réécrit\n");
  }
  sortie(0, `base déposée : ${path.relative(process.cwd(), fichier)}\n  ${JSON.stringify(mesure, null, 2)}`);
}

principal().catch((err) => sortie(1, String(err?.stack ?? err)));
