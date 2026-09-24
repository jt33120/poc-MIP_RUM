#!/usr/bin/env node
// Upload des source maps d'un build vers MIP RUM (P5.4) — à lancer en CI.
//
//   MIP_SOURCEMAP_TOKEN=… node scripts/upload-sourcemaps.mjs \
//     --app <app_id> --release <release> --dir <dossier du build> --url <URL complète d'upload>
//
// `--url` désigne la destination EXACTE, sans deviner d'autre endpoint :
//   https://<console>/api/sourcemaps   port console (Vercel) : lots de 3 Mio par défaut ;
//   https://<ingest>/v1/sourcemaps     backend direct : maps jusqu'à 15 Mio.
//
// CE QUE LE SCRIPT GARANTIT
//   • Le jeton ne vient QUE de MIP_SOURCEMAP_TOKEN : jamais d'argument (il finirait
//     dans l'historique du shell et les journaux de CI), jamais affiché.
//   • Toutes les maps sont trouvées, reliées à leur bundle et validées AVANT le
//     premier envoi : une map invalide n'en laisse partir aucune.
//   • Manifeste local (bundle → map, taille, SHA-256) et empreinte, identique à
//     celle que la console affiche pour la release.
//   • Chaque lot est vérifié : le serveur rend l'empreinte de chaque map reçue.
//   • Nouvelles tentatives bornées sur réseau, 408, 429 et 5xx — le serveur est
//     idempotent, rejouer un lot ne duplique rien.
//   • Code de sortie non nul dès que l'upload est incomplet (2 : usage).
//
// Options : --dry-run (aucun envoi, jeton non requis), --manifest <fichier.json>,
// --max-batch-bytes <octets>, --retries <0..5>, --retry-delay-ms <ms>.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { empreinteContenu, empreinteManifeste, LIMITES_UPLOAD } from "../packages/backend/lib/sourcemap-upload.mjs";
import { SourceMapError, validateSourceMap } from "../packages/backend/shared/sourcemap.mjs";

const MIO = 1024 * 1024;
export const SORTIE = Object.freeze({ succes: 0, incomplet: 1, usage: 2 });

const USAGE = `Usage : MIP_SOURCEMAP_TOKEN=… node scripts/upload-sourcemaps.mjs --app <app_id> --release <release> --dir <dossier> --url <URL d'upload>
  --url            https://<console>/api/sourcemaps  ou  https://<ingest>/v1/sourcemaps
  --dry-run        valide et affiche le plan sans rien envoyer (jeton non requis)
  --manifest       écrit le manifeste JSON (bundle, map, taille, sha256) dans ce fichier
  --max-batch-bytes  taille maximale d'un lot (défaut : 3 Mio console, 20 Mio backend direct)
  --retries        nouvelles tentatives par lot, 0 à 5 (défaut 3)
  --retry-delay-ms délai de base du recul exponentiel (défaut 1000)`;

class ErreurUsage extends Error {}

/** Port visé, déduit du chemin EXACT de l'URL. */
export function portDeDestination(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new ErreurUsage(`--url invalide : ${url}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new ErreurUsage("--url doit être en https (http accepté seulement vers localhost)");
  }
  if (u.pathname.endsWith("/api/sourcemaps")) {
    return { nom: "console", lotParDefaut: LIMITES_UPLOAD.lotConsole, corpsMax: LIMITES_UPLOAD.corpsConsole };
  }
  if (u.pathname.endsWith("/v1/sourcemaps")) {
    return { nom: "backend direct", lotParDefaut: LIMITES_UPLOAD.corpsDirect, corpsMax: LIMITES_UPLOAD.corpsDirect };
  }
  throw new ErreurUsage("--url doit se terminer par /api/sourcemaps (console) ou /v1/sourcemaps (backend direct)");
}

/** Arguments validés ; `ErreurUsage` sinon. */
export function lireArguments(argv) {
  if (argv.some((a) => a === "--token" || a.startsWith("--token="))) {
    throw new ErreurUsage("le jeton ne se passe jamais en argument : utiliser la variable MIP_SOURCEMAP_TOKEN");
  }
  let valeurs;
  try {
    ({ values: valeurs } = parseArgs({
      args: argv,
      strict: true,
      options: {
        app: { type: "string" },
        release: { type: "string" },
        dir: { type: "string" },
        url: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        manifest: { type: "string" },
        "max-batch-bytes": { type: "string" },
        retries: { type: "string", default: "3" },
        "retry-delay-ms": { type: "string", default: "1000" },
      },
    }));
  } catch (err) {
    throw new ErreurUsage(err.message);
  }
  for (const requis of ["app", "release", "dir", "url"]) {
    if (!valeurs[requis]?.trim()) throw new ErreurUsage(`--${requis} requis`);
  }
  const port = portDeDestination(valeurs.url);
  const entier = (nom, min, max) => {
    const n = Number(valeurs[nom]);
    if (!Number.isInteger(n) || n < min || n > max) throw new ErreurUsage(`--${nom} : entier de ${min} à ${max} attendu`);
    return n;
  };
  const lotMax = valeurs["max-batch-bytes"] === undefined ? port.lotParDefaut : entier("max-batch-bytes", 1024, port.corpsMax);
  return {
    app: valeurs.app.trim(),
    release: valeurs.release.trim(),
    dir: valeurs.dir,
    url: valeurs.url,
    port,
    dryRun: valeurs["dry-run"],
    manifest: valeurs.manifest ?? null,
    lotMax,
    retries: entier("retries", 0, 5),
    delaiBaseMs: entier("retry-delay-ms", 0, 60_000),
  };
}

const BUNDLE = /\.(?:js|mjs|cjs)$/;
const COMMENTAIRE_MAP = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/;

/** Fichiers réguliers sous `racine`, liens symboliques non suivis. */
function parcourir(racine) {
  const out = [];
  const pile = [racine];
  while (pile.length) {
    const dossier = pile.pop();
    for (const nom of readdirSync(dossier)) {
      const chemin = path.join(dossier, nom);
      const info = lstatSync(chemin);
      if (info.isDirectory()) pile.push(chemin);
      else if (info.isFile()) out.push(chemin);
    }
  }
  return out.sort();
}

/** Dernier `sourceMappingURL` d'un bundle (les fins de fichier font foi). */
function referenceMap(contenu) {
  const lignes = contenu.slice(-4096).trimEnd().split("\n");
  for (let i = lignes.length - 1; i >= 0 && i >= lignes.length - 3; i--) {
    const m = COMMENTAIRE_MAP.exec(lignes[i]);
    if (m) return m[1];
  }
  return null;
}

/**
 * Relie chaque bundle à sa map et valide tout, sans rien envoyer. `secret` : le
 * jeton, cherché dans chaque bundle et chaque map — un jeton embarqué dans le
 * build serait publié avec le client.
 *
 * @returns {{ entrees: Array<{ bundle: string, map: string, filename: string, size_bytes: number, checksum: string, content: string }>,
 *   erreurs: string[], avertissements: string[] }}
 */
export function construireManifeste(dir, { secret = null } = {}) {
  const erreurs = [];
  const avertissements = [];
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) {
    return { entrees: [], erreurs: [`--dir introuvable : ${dir}`], avertissements };
  }
  const racine = realpathSync(dir);
  const fichiers = parcourir(racine);
  const relatif = (p) => path.relative(racine, p).split(path.sep).join("/");
  const mapsUtilisees = new Set();
  const parNom = new Map();
  const entrees = [];

  for (const bundle of fichiers.filter((f) => BUNDLE.test(f))) {
    const source = readFileSync(bundle, "utf8");
    if (secret && source.includes(secret)) {
      erreurs.push(`${relatif(bundle)} : contient le jeton MIP_SOURCEMAP_TOKEN, il serait publié avec le client`);
      continue;
    }
    const reference = referenceMap(source);
    const voisine = `${bundle}.map`;
    let map = null;
    if (reference?.startsWith("data:")) {
      avertissements.push(`${relatif(bundle)} : map inline ignorée (elle est déjà publiée avec le bundle)`);
      continue;
    }
    if (reference && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) {
      let chemin;
      try {
        chemin = decodeURIComponent(reference.split(/[?#]/)[0]);
      } catch {
        erreurs.push(`${relatif(bundle)} : sourceMappingURL illisible (${reference})`);
        continue;
      }
      const cible = path.resolve(path.dirname(bundle), chemin);
      if (!existsSync(cible)) {
        erreurs.push(`${relatif(bundle)} : map déclarée introuvable (${reference})`);
        continue;
      }
      map = cible;
    } else if (existsSync(voisine)) {
      map = voisine;
    } else if (reference) {
      erreurs.push(`${relatif(bundle)} : map distante non récupérée, aucune lecture réseau (${reference})`);
      continue;
    } else {
      continue; // bundle sans map : rien à envoyer
    }
    // Chemin réel, liens symboliques résolus : une map ne se lit que DANS le build.
    map = realpathSync(map);
    if (!map.startsWith(`${racine}${path.sep}`)) {
      erreurs.push(`${relatif(bundle)} : map hors du dossier du build, refusée`);
      continue;
    }

    const filename = path.basename(bundle);
    if (parNom.has(filename)) {
      erreurs.push(`deux bundles portent le nom ${filename} (${parNom.get(filename)}, ${relatif(bundle)}) : les stacks ne les distinguent pas`);
      continue;
    }
    parNom.set(filename, relatif(bundle));
    mapsUtilisees.add(map);

    const octets = lstatSync(map).size;
    if (octets > LIMITES_UPLOAD.map) {
      erreurs.push(`${relatif(map)} : ${octets} octets, au-delà de la limite de ${LIMITES_UPLOAD.map / MIO} Mio par map`);
      continue;
    }
    const content = readFileSync(map, "utf8");
    if (secret && content.includes(secret)) {
      erreurs.push(`${relatif(map)} : contient le jeton MIP_SOURCEMAP_TOKEN`);
      continue;
    }
    try {
      validateSourceMap(JSON.parse(content));
    } catch (err) {
      const raison = err instanceof SourceMapError ? err.message : "JSON illisible";
      erreurs.push(`${relatif(map)} : source map invalide (${raison})`);
      continue;
    }
    entrees.push({
      bundle: relatif(bundle),
      map: relatif(map),
      filename,
      size_bytes: Buffer.byteLength(content, "utf8"),
      checksum: empreinteContenu(content),
      content,
    });
  }
  for (const orpheline of fichiers.filter((f) => f.endsWith(".map") && !mapsUtilisees.has(f))) {
    avertissements.push(`${relatif(orpheline)} : map sans bundle correspondant, ignorée`);
  }
  return { entrees, erreurs, avertissements };
}

/** Octets du corps JSON d'un lot. */
function tailleCorps(app, release, maps) {
  return Buffer.byteLength(
    JSON.stringify({ appId: app, release, maps: maps.map((m) => ({ filename: m.filename, content: m.content })) }),
    "utf8",
  );
}

/**
 * Découpe en lots ≤ `lotMax` octets de corps et ≤ 200 maps. Une map qui, seule,
 * dépasse la limite est refusée — avec, vers la console, l'indication du backend direct.
 */
export function decouperEnLots(entrees, { app, release, lotMax, port }) {
  const lots = [];
  const erreurs = [];
  let courant = [];
  for (const entree of entrees) {
    if (tailleCorps(app, release, [entree]) > lotMax) {
      erreurs.push(
        port.nom === "console"
          ? `${entree.map} : indivisible et trop lourde pour un lot console (${Math.floor(lotMax / MIO * 10) / 10} Mio) — utiliser le backend direct : --url https://<ingest>/v1/sourcemaps`
          : `${entree.map} : trop lourde pour un lot de ${lotMax} octets`,
      );
      continue;
    }
    const candidat = [...courant, entree];
    if (courant.length && (candidat.length > LIMITES_UPLOAD.maps || tailleCorps(app, release, candidat) > lotMax)) {
      lots.push(courant);
      courant = [entree];
    } else {
      courant = candidat;
    }
  }
  if (courant.length) lots.push(courant);
  return { lots, erreurs };
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const REJOUABLE = (statut) => statut === 408 || statut === 429 || statut >= 500;

/** Envoie un lot avec nouvelles tentatives bornées. Rend la réponse finale ou l'erreur réseau. */
async function envoyerLot(lot, { app, release, url, jeton, retries, delaiBaseMs }, journal) {
  const corps = JSON.stringify({ appId: app, release, maps: lot.map((m) => ({ filename: m.filename, content: m.content })) });
  for (let tentative = 0; ; tentative++) {
    let statut;
    let reponse = null;
    let retryAfter = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
        body: corps,
      });
      statut = res.status;
      retryAfter = Number(res.headers.get("retry-after"));
      reponse = await res.json().catch(() => null);
    } catch (err) {
      statut = null;
      reponse = { error: `réseau : ${err?.cause?.code ?? err?.message ?? err}` };
    }
    if (statut !== null && !REJOUABLE(statut)) return { statut, reponse };
    if (tentative >= retries) return { statut, reponse };
    const delai = Math.min(
      60_000,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delaiBaseMs * 2 ** tentative,
    );
    journal(`  nouvelle tentative ${tentative + 1}/${retries} dans ${delai} ms (${statut ?? "réseau"})`);
    await attendre(delai);
  }
}

/**
 * Exécution complète. Pur vis-à-vis du processus : arguments, environnement et
 * sorties injectés ; rend le code de sortie.
 */
export async function executer(argv, env, { log = console.log, erreur = console.error } = {}) {
  let options;
  try {
    options = lireArguments(argv);
  } catch (err) {
    if (!(err instanceof ErreurUsage)) throw err;
    erreur(`erreur : ${err.message}\n${USAGE}`);
    return SORTIE.usage;
  }
  const jeton = env.MIP_SOURCEMAP_TOKEN ?? "";
  if (!options.dryRun && !/^msu_[0-9a-f]{32}_[0-9a-f]{64}$/.test(jeton)) {
    erreur(
      jeton
        ? "erreur : MIP_SOURCEMAP_TOKEN n'a pas le format d'un jeton d'upload de source maps (msu_…) — un jeton de lecture n'y donne pas droit"
        : "erreur : variable MIP_SOURCEMAP_TOKEN absente (jeton de CI créé dans Admin › Source maps)",
    );
    return SORTIE.usage;
  }

  const { entrees, erreurs, avertissements } = construireManifeste(options.dir, { secret: jeton || null });
  for (const a of avertissements) log(`avertissement : ${a}`);
  const { lots, erreurs: erreursLots } = decouperEnLots(entrees, options);
  const bloquantes = [...erreurs, ...erreursLots];
  const empreinte = empreinteManifeste(entrees);
  log(`${entrees.length} map(s) pour ${options.app} @ ${options.release} → ${options.port.nom}, ${lots.length} lot(s)`);
  for (const e of entrees) log(`  ${e.bundle} ← ${e.map} (${e.size_bytes} o, sha256 ${e.checksum})`);
  log(`empreinte du manifeste : ${empreinte}`);
  if (options.manifest) {
    writeFileSync(
      options.manifest,
      `${JSON.stringify(
        {
          app: options.app,
          release: options.release,
          fingerprint: empreinte,
          maps: entrees.map(({ content: _contenu, ...reste }) => reste),
        },
        null,
        2,
      )}\n`,
    );
  }
  if (bloquantes.length) {
    for (const b of bloquantes) erreur(`erreur : ${b}`);
    erreur(`upload annulé : ${bloquantes.length} problème(s), aucune map envoyée`);
    return SORTIE.incomplet;
  }
  if (!entrees.length) {
    erreur("erreur : aucune source map trouvée dans le dossier : rien à envoyer");
    return SORTIE.incomplet;
  }
  if (options.dryRun) {
    lots.forEach((lot, i) => log(`lot ${i + 1}/${lots.length} : ${lot.length} map(s), ${tailleCorps(options.app, options.release, lot)} o`));
    log("simulation : rien n'a été envoyé");
    return SORTIE.succes;
  }

  let empreinteServeur = null;
  for (const [i, lot] of lots.entries()) {
    log(`lot ${i + 1}/${lots.length} : ${lot.length} map(s)`);
    const { statut, reponse } = await envoyerLot(lot, { ...options, jeton }, log);
    if (statut !== 200) {
      erreur(`erreur : lot ${i + 1} refusé (${statut ?? "réseau"}) : ${reponse?.error ?? "réponse illisible"}`);
      for (const c of reponse?.conflicts ?? []) {
        erreur(`  conflit ${c.filename} : présent ${c.existing_checksum}, envoyé ${c.received_checksum}`);
      }
      erreur(`upload incomplet : ${i} lot(s) sur ${lots.length} enregistrés`);
      return SORTIE.incomplet;
    }
    const recues = new Map((reponse?.maps ?? []).map((m) => [m.filename, m]));
    const ecarts = lot.filter((m) => recues.get(m.filename)?.checksum !== m.checksum);
    if (ecarts.length) {
      erreur(`erreur : empreinte serveur différente pour ${ecarts.map((m) => m.filename).join(", ")}`);
      return SORTIE.incomplet;
    }
    log(`  ${reponse.created} créée(s), ${reponse.unchanged} inchangée(s)`);
    empreinteServeur = reponse.release ?? empreinteServeur;
  }
  if (empreinteServeur) {
    const identique = empreinteServeur.fingerprint === empreinte;
    log(
      `release côté serveur : ${empreinteServeur.files} fichier(s), empreinte ${empreinteServeur.fingerprint}` +
        (identique ? " (identique au manifeste local)" : " (d'autres maps de cette release existaient déjà)"),
    );
  }
  log("upload complet");
  return SORTIE.succes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await executer(process.argv.slice(2), process.env);
}
