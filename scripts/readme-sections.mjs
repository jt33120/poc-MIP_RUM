#!/usr/bin/env node
// Les zones générées du README de la racine (plan § 8.4, P**.9).
//
// POURQUOI LE README EST EN PARTIE GÉNÉRÉ. C'est la porte d'entrée GitHub, et il
// a contredit la vitrine pendant des semaines : Supabase à Paris quand la base
// était chez Neon à Francfort, une « edge function Deno » qui n'existait plus, un
// statut arrêté à v0.3. Un texte tapé à la main finit par dire autre chose que le
// code. Deux sections sont donc écrites ici, depuis les MÊMES sources que la
// vitrine :
//   - « Architecture » : apps/console/lib/presentation-topologie.ts (pièces, rôles,
//     liaisons, dates de relevé), qui lit société, région et ville dans les
//     phrases HOSTS de apps/console/lib/legal.ts — celles de la politique de
//     confidentialité ;
//   - « Statut » : apps/console/lib/couverture.generated.json, l'extraction du
//     document de couverture (docs/RUM_PARITY_STATUS.md) : date, commit, décomptes.
// tests/unit/readme.test.ts régénère les deux zones et échoue si le README versionné
// diffère : un nouveau relevé du document rougit le README comme il rougit le site.
//
// LECTURE DU TYPESCRIPT : LE MODULE EST ÉVALUÉ, PAS LU AU MOTIF. Aucune expression
// régulière sur le source : Node (≥ 22.18, 26 en CI) retire lui-même les
// annotations de type d'un `.ts` (« type stripping », parseur SWC embarqué), et un
// crochet de résolution (`module.registerHooks`) ne fait que compléter ce que le
// compilateur de la console sait déjà faire — `./legal` → `./legal.ts`, `@/x` →
// `apps/console/x`. Les valeurs obtenues sont celles que la vitrine calcule, à
// l'octet près : c'est le même code qui tourne. Un `.ts` qui cesserait d'être
// effaçable (enum, namespace…) ferait échouer le script avec l'erreur de Node,
// jamais produire un README approximatif. Sous vitest, le test importe le même
// module par le transformateur de vitest, et joue en plus cette commande-ci.
//
// Usage :
//   node scripts/readme-sections.mjs            réécrit les deux zones du README
//   node scripts/readme-sections.mjs --verifier échoue si le README n'est pas à jour
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERDICTS } from "./couverture-extraire.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const README = "README.md";
export const TOPOLOGIE = "apps/console/lib/presentation-topologie.ts";
export const COUVERTURE = "apps/console/lib/couverture.generated.json";

/** Les deux zones, dans l'ordre du README. */
export const ZONES = ["readme-architecture", "readme-statut"];
export const ouverture = (zone) => `<!-- genere:${zone} -->`;
export const FERMETURE = "<!-- /genere -->";

// ─────────────────────────── Mise en forme ───────────────────────────

/** Cellule de table Markdown : un `|` y est échappé, un retour à la ligne aplati. */
const cellule = (texte) => String(texte).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

function table(colonnes, lignes, alignement = colonnes.map(() => "---")) {
  return [
    `| ${colonnes.map(cellule).join(" | ")} |`,
    `|${alignement.join("|")}|`,
    ...lignes.map((l) => `| ${l.map(cellule).join(" | ")} |`),
  ].join("\n");
}

/** Libellé de nœud Mermaid : entre guillemets, un guillemet s'écrit `#quot;`. */
const mermaid = (texte) => `"${String(texte).replace(/"/g, "#quot;")}"`;

/** « a », « a et b », « a, b et c ». */
function enumeration(elements) {
  if (elements.length < 2) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} et ${elements[elements.length - 1]}`;
}

const uniques = (valeurs) => [...new Set(valeurs)];

// ─────────────────────────── Zone « Architecture » ───────────────────────────

/**
 * Architecture : le chemin de la mesure (PS3) et l'hébergement (PS4), depuis le
 * module de la vitrine. `t` est l'espace de noms de presentation-topologie.ts.
 */
export function zoneArchitecture(t) {
  const { PIECES, LIAISONS, HEBERGEURS, DROIT_HEBERGEURS, INGEST_SUPPRIME_LE, MIGRATIONS_CONSTATEES, TOPOLOGIE_RELEVEE } = t;
  const hebergeurs = Object.values(HEBERGEURS);

  const noeuds = PIECES.map((p) => `  ${p.id}[${mermaid([p.titre, ...p.lignes].join("<br/>"))}]`);
  const fleches = LIAISONS.map((l) => `  ${l.de} -->${l.libelle ? `|${mermaid(l.libelle)}|` : ""} ${l.vers}`);

  const lieux = uniques(hebergeurs.map((h) => (h.lieu ? `${h.lieu.ville}, ${h.lieu.pays}` : h.phrase)));

  return [
    `<!-- Zone écrite par \`node scripts/readme-sections.mjs\` depuis ${TOPOLOGIE}, qui lit les hébergeurs dans apps/console/lib/legal.ts. Ne pas la modifier à la main : tests/unit/readme.test.ts la régénère et compare. -->`,
    "",
    "Le chemin de la mesure, tel que le dessine la vitrine de la console (`/presentation`) :",
    "",
    "```mermaid",
    "flowchart TB",
    ...noeuds,
    ...fleches,
    "```",
    "",
    table(
      ["Pièce", "Hébergeur", "Région", "Rôle"],
      PIECES.map((p) => [p.titre, p.hebergeur, p.region ?? "—", p.role]),
    ),
    "",
    `- Régions : ${lieux.join(" ; ")}. Droit des trois hébergeurs (${enumeration(hebergeurs.map((h) => h.societe))}) : ${DROIT_HEBERGEURS}.`,
    "- Le collecteur est une route de la console : c'est l'adresse que visent les SDK. Le même parseur existe en " +
      "service Node autonome (`services/collector/server.mjs`), construit et démarré par la CI (`docker-smoke`), pour un " +
      "hébergement chez le client ; en production, il ne tourne nulle part : le service Railway `ingest`, qui " +
      `l'exécutait sans domaine public, a été supprimé le ${INGEST_SUPPRIME_LE}.`,
    `- Le \`scheduler\` applique les migrations au pré-déploiement : constaté le ${MIGRATIONS_CONSTATEES.le} dans les ` +
      `journaux du déploiement \`${MIGRATIONS_CONSTATEES.deploiement}\`.`,
    `- Topologie relevée par les API Railway et Vercel le ${TOPOLOGIE_RELEVEE.railwayEtVercel}, puis par l'API Railway ` +
      `le ${TOPOLOGIE_RELEVEE.railway} : [docs/TOPOLOGIE_BACKEND.md](docs/TOPOLOGIE_BACKEND.md).`,
  ].join("\n");
}

// ─────────────────────────── Zone « Statut » ───────────────────────────

/**
 * Statut : l'état relevé par le document de couverture. `c` a la forme de
 * couverture.generated.json (c'est aussi ce que rend `extraireCouverture`).
 */
export function zoneStatut(c) {
  const compte = (verdict) => c.capacites.filter((x) => x.verdict === verdict).length;
  const total = c.capacites.length;
  const [meilleur] = VERDICTS;
  const ignores = c.testsSql.ignores;
  return [
    `<!-- Zone écrite par \`node scripts/readme-sections.mjs\` depuis ${COUVERTURE}, l'extraction de ${c.source}. Ne pas la modifier à la main : tests/unit/readme.test.ts la régénère et compare. -->`,
    "",
    `État relevé le **${c.releve}** sur \`${c.sha}\` par le document de couverture [${c.source}](${c.source}) : ` +
      `**${total}** capacités recensées, **${compte(meilleur)}** déployées, **aucune** éprouvée sur des données ` +
      `réellement ingérées — le vocabulaire du document n'a pas de verdict au-dessus de \`${meilleur}\`.`,
    "",
    table(
      ["Verdict", "Capacités"],
      VERDICTS.map((v) => [`\`${v}\``, String(compte(v))]),
      ["---", "--:"],
    ),
    "",
    "Le document ne recense que les capacités des lots P5 à P8 : les écrans plus anciens de la console n'y ont pas " +
      "de verdict, et ce README ne leur en donne pas. La vitrine (`/presentation`) reprend les mêmes verdicts, ligne par ligne.",
    "",
    `Tests comptés au relevé, pas aujourd'hui : ${c.testsUnitaires.tests} tests unitaires verts ` +
      `(${c.testsUnitaires.fichiers} fichiers) ; suite SQL verte, ${c.testsSql.tests} tests (${c.testsSql.fichiers} fichiers) ` +
      `dont ${ignores.tests} ignorés (${ignores.fichiers} fichiers).`,
  ].join("\n");
}

/** Les deux zones, par nom. */
export function zones({ topologie, couverture }) {
  return { "readme-architecture": zoneArchitecture(topologie), "readme-statut": zoneStatut(couverture) };
}

// ─────────────────────────── Marqueurs ───────────────────────────

const occurrences = (texte, motif) => texte.split(motif).length - 1;

/**
 * Bornes de chaque zone. Échoue, en nommant le marqueur, si une ouverture n'est
 * pas présente exactement une fois, ou si elle n'est pas fermée avant la suivante.
 */
export function reperer(texte) {
  const bornes = {};
  for (const zone of ZONES) {
    const debut = ouverture(zone);
    const n = occurrences(texte, debut);
    if (n !== 1) throw new Error(`${README} — « ${debut} » trouvé ${n} fois, 1 attendu`);
    const apres = texte.indexOf(debut) + debut.length;
    const fin = texte.indexOf(FERMETURE, apres);
    const suivante = texte.indexOf("<!-- genere:", apres);
    if (fin < 0 || (suivante >= 0 && suivante < fin)) {
      throw new Error(`${README} — « ${debut} » n'est pas fermé par « ${FERMETURE} » avant la zone suivante`);
    }
    bornes[zone] = { apres, fin };
  }
  const fermetures = occurrences(texte, FERMETURE);
  if (fermetures !== ZONES.length) {
    throw new Error(`${README} — « ${FERMETURE} » trouvé ${fermetures} fois, ${ZONES.length} attendus`);
  }
  return bornes;
}

/** Le README avec ses zones remplacées ; ce qui est hors des zones n'est pas touché. */
export function remplacerZones(texte, contenus) {
  const bornes = reperer(texte);
  // De la dernière zone à la première : les positions des précédentes restent justes.
  const ordre = ZONES.slice().sort((a, b) => bornes[b].apres - bornes[a].apres);
  let sortie = texte;
  for (const zone of ordre) {
    const { apres, fin } = bornes[zone];
    sortie = `${sortie.slice(0, apres)}\n${contenus[zone]}\n${sortie.slice(fin)}`;
  }
  return sortie;
}

// ─────────────────────────── Chargement des sources ───────────────────────────

const CONSOLE = join(RACINE, "apps/console");
let crochetPose = false;

/** Premier fichier TypeScript qui existe pour ce chemin sans extension. */
function versTypeScript(url) {
  for (const suffixe of [".ts", ".tsx", "/index.ts"]) {
    const candidat = new URL(`${url.href}${suffixe}`);
    if (existsSync(fileURLToPath(candidat))) return candidat.href;
  }
  return null;
}

/**
 * Pose, une fois, le crochet de résolution des sources de la console. Il ne
 * touche qu'aux imports d'un fichier `.ts` : `./x` sans extension et l'alias `@/`
 * du tsconfig de la console. Il déclare le format `module-typescript`, que Node
 * déduirait sinon après un second essai et un avertissement.
 */
function poserCrochet() {
  if (crochetPose) return;
  crochetPose = true;
  registerHooks({
    resolve(specifier, context, suivant) {
      let cible = specifier;
      if (context.parentURL?.endsWith(".ts") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
        if (/^\.\.?\//.test(specifier)) cible = versTypeScript(new URL(specifier, context.parentURL)) ?? specifier;
        else if (specifier.startsWith("@/")) cible = versTypeScript(pathToFileURL(join(CONSOLE, specifier.slice(2)))) ?? specifier;
      }
      const resolu = suivant(cible, context);
      return resolu.url.endsWith(".ts") ? { ...resolu, format: "module-typescript" } : resolu;
    },
  });
}

/** Le module de la vitrine, évalué par Node : les valeurs que la vitrine affiche. */
export async function chargerTopologie() {
  poserCrochet();
  return import(pathToFileURL(join(RACINE, TOPOLOGIE)).href);
}

export function chargerCouverture() {
  return JSON.parse(readFileSync(join(RACINE, COUVERTURE), "utf8"));
}

// Chemins RÉELS des deux côtés, comme couverture-extraire.mjs : lancé par un lien
// symbolique, le script ne doit pas se croire importé et sortir en 0 sans rien faire.
const estPrincipal = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (estPrincipal) {
  try {
    const actuel = readFileSync(join(RACINE, README), "utf8");
    const attendu = remplacerZones(actuel, zones({ topologie: await chargerTopologie(), couverture: chargerCouverture() }));
    if (process.argv.includes("--verifier")) {
      if (actuel !== attendu) {
        console.error(`${README} n'a plus ses zones à jour : relancer \`node scripts/readme-sections.mjs\`.`);
        process.exit(1);
      }
      console.log(`${README} à jour.`);
    } else {
      writeFileSync(join(RACINE, README), attendu);
      console.log(`${README} écrit : zones ${ZONES.join(", ")}.`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
