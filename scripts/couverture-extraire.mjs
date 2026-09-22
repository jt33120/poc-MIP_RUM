#!/usr/bin/env node
// Extraction du document de couverture (docs/RUM_PARITY_STATUS.md) vers un JSON
// que la console lit : apps/console/lib/couverture.generated.json.
//
// POURQUOI UN FICHIER PRODUIT PLUTÔT QU'UN TEXTE DANS LE SITE. La vitrine dit ce
// que le produit sait faire. Si ces phrases sont tapées dans un `.tsx`, elles
// finissent par dire plus que le document qui les fonde — c'est ce qui s'était
// produit (« v0.1 », « souverain », « prouvé »). Ici, chaque capacité, son
// verdict et sa limite viennent d'une ligne du document, avec son numéro ; un
// nouveau relevé met le site à jour au build suivant, et un test compare le JSON
// versionné à une extraction fraîche.
//
// CE QUI FAIT ÉCHOUER L'EXTRACTION, VOLONTAIREMENT :
//   - un verdict hors des sept du vocabulaire (§ 1 du document). Un futur
//     « éprouvé sur donnée réelle » n'est pas une faute de frappe à tolérer :
//     c'est à un humain de décider de ce que le site en dit ;
//   - une ligne de capacité qui ne donne pas exactement cinq cellules ;
//   - un identifiant en double, un en-tête de relevé ou un décompte de tests
//     introuvable.
//
// Usage :
//   node scripts/couverture-extraire.mjs            écrit le JSON
//   node scripts/couverture-extraire.mjs --verifier échoue si le JSON versionné diffère
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOCUMENT = "docs/RUM_PARITY_STATUS.md";
export const SORTIE = "apps/console/lib/couverture.generated.json";

/** Les sept verdicts du § 1 du document, et eux seuls. */
export const VERDICTS = [
  "deploye_non_eprouve",
  "livre_non_deploye",
  "livre_avec_defaut_connu",
  "en_revue",
  "bloque_acces_externe",
  "non_retenu",
  "non_commence",
];

const MOIS = {
  janvier: 1, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12,
};

const COLONNES = ["id", "capacite", "verdict", "preuve", "limite"];

/**
 * Cellules d'une ligne de table Markdown.
 *
 * Un `|` ne sépare deux colonnes que HORS d'un segment `code` et s'il n'est pas
 * échappé (`\|`). D'où une lecture caractère par caractère plutôt qu'un
 * `split("|")` : plusieurs cellules du document portent du code et des
 * points-virgules, et un seul `|` dans un chemin décalerait silencieusement
 * toutes les colonnes suivantes — la limite deviendrait la preuve.
 */
export function cellules(ligne) {
  const brut = ligne.trim();
  if (!brut.startsWith("|") || !brut.endsWith("|")) return null;
  const sortie = [];
  let courante = "";
  let dansCode = false;
  for (let i = 1; i < brut.length; i++) {
    const c = brut[i];
    if (c === "\\" && brut[i + 1] === "|") {
      courante += "|";
      i++;
      continue;
    }
    if (c === "`") dansCode = !dansCode;
    if (c === "|" && !dansCode) {
      sortie.push(courante.trim());
      courante = "";
      continue;
    }
    courante += c;
  }
  // Le dernier `|` ferme la dernière cellule : il ne reste rien après lui.
  return sortie;
}

function erreur(numero, message) {
  return new Error(`${DOCUMENT}:${numero} — ${message}`);
}

function entier(texte) {
  return Number(String(texte).replace(/\D/g, ""));
}

/** Extrait le document ; lève une erreur qui nomme la ligne fautive. */
export function extraireCouverture(texte) {
  const lignes = texte.split("\n");

  // Ligne 3 : « Relevé le **18 septembre 2026**, sur `master` à **`2f216cb`** »
  const entete = /Relevé le \*\*(\d{1,2}) (\p{L}+) (\d{4})\*\*, sur `[^`]+` à \*\*`([0-9a-f]{7,40})`\*\*/u.exec(lignes[2] ?? "");
  if (!entete) throw erreur(3, "en-tête de relevé introuvable (« Relevé le **J mois AAAA**, sur `branche` à **`sha`** »)");
  const mois = MOIS[entete[2].toLowerCase()];
  if (!mois) throw erreur(3, `mois inconnu : « ${entete[2]} »`);
  const releve = `${entete[1].padStart(2, "0")}/${String(mois).padStart(2, "0")}/${entete[3]}`;

  // Ancré sur la ligne de la commande vitest du § 2 : le document CITE ailleurs
  // d'anciens journaux au même format (« **22 fichiers, 314 tests verts »), qui
  // deviendraient en silence les tests unitaires du relevé.
  const unitaires = /^\| `pnpm [^`]*vitest run tests\/unit[^`]*` \| \*\*(\d+) fichiers, ([\d\s\u00a0\u202f]+) tests verts/m.exec(texte);
  if (!unitaires) throw erreur(0, "décompte des tests unitaires introuvable (ligne « | `pnpm exec vitest run tests/unit…` | **N fichiers, N tests verts »)");
  const sql = /\*\*(\d+) fichiers\*\* et \*\*([\d\s\u00a0\u202f]+) tests\*\* au total/.exec(texte);
  if (!sql) throw erreur(0, "décompte des tests SQL introuvable (« **N fichiers** et **N tests** au total »)");

  const debut = lignes.findIndex((l) => /^## 4\. /.test(l));
  if (debut < 0) throw erreur(0, "section « ## 4. » introuvable");
  const finRelative = lignes.slice(debut + 1).findIndex((l) => /^## /.test(l));
  const fin = finRelative < 0 ? lignes.length : debut + 1 + finRelative;

  const familles = [];
  const capacites = [];
  const vus = new Set();
  let famille = null;
  for (let i = debut + 1; i < fin; i++) {
    const numero = i + 1;
    const ligne = lignes[i];
    const titre = /^### 4\.\d+ (.+)$/.exec(ligne);
    if (titre) {
      famille = titre[1].trim();
      familles.push(famille);
      continue;
    }
    if (!ligne.trim().startsWith("|")) continue;
    const cells = cellules(ligne);
    if (cells && cells[0] === "#") continue; // en-tête de table
    if (cells && cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // séparateur
    if (!cells || !/^[A-Z]\d+$/.test(cells[0])) {
      throw erreur(numero, "ligne de table inattendue dans le § 4 : ni en-tête, ni séparateur, ni capacité");
    }
    if (cells.length !== COLONNES.length) {
      throw erreur(numero, `${cells[0]} : ${cells.length} cellules trouvées, ${COLONNES.length} attendues (# · Capacité · Verdict · Preuve · Limite)`);
    }
    if (!famille) throw erreur(numero, `${cells[0]} : capacité hors d'une famille « ### 4.x »`);
    const [id, capacite, verdictBrut, preuve, limite] = cells;
    const verdict = verdictBrut.replace(/`/g, "").trim();
    if (!VERDICTS.includes(verdict)) {
      throw erreur(numero, `${id} : verdict inconnu « ${verdict} » — un humain décide de ce que le site en dit`);
    }
    if (vus.has(id)) throw erreur(numero, `${id} : identifiant en double`);
    vus.add(id);
    capacites.push({ id, famille, capacite, verdict, preuve, limite, ligne: numero });
  }
  if (!capacites.length) throw erreur(debut + 1, "aucune ligne de capacité dans le § 4");

  return {
    source: DOCUMENT,
    releve,
    sha: entete[4],
    testsUnitaires: { fichiers: entier(unitaires[1]), tests: entier(unitaires[2]) },
    testsSql: { fichiers: entier(sql[1]), tests: entier(sql[2]) },
    familles,
    capacites,
  };
}

/** Sérialisation stable : c'est elle que le test compare au fichier versionné. */
export function serialiser(couverture) {
  return `${JSON.stringify(couverture, null, 2)}\n`;
}

// Chemins RÉELS des deux côtés : lancé par un lien symbolique, le script ne doit
// pas se croire importé et sortir en 0 sans rien vérifier.
const estPrincipal = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (estPrincipal) {
  try {
    const attendu = serialiser(extraireCouverture(readFileSync(join(RACINE, DOCUMENT), "utf8")));
    if (process.argv.includes("--verifier")) {
      const versionne = readFileSync(join(RACINE, SORTIE), "utf8");
      if (versionne !== attendu) {
        console.error(`${SORTIE} n'est plus l'extraction de ${DOCUMENT} : relancer \`node scripts/couverture-extraire.mjs\`.`);
        process.exit(1);
      }
      console.log(`${SORTIE} à jour.`);
    } else {
      writeFileSync(join(RACINE, SORTIE), attendu);
      const n = JSON.parse(attendu).capacites.length;
      console.log(`${SORTIE} écrit : ${n} capacités.`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
