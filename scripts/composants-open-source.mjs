#!/usr/bin/env node
// Inventaire des composants open source du dépôt, vers un JSON que la vitrine lit :
// apps/console/lib/composants-open-source.generated.json (page /presentation/open-source).
//
// POURQUOI UN FICHIER PRODUIT PLUTÔT QU'UNE LISTE TAPÉE. La demande (29/09/2026) est
// de pouvoir VÉRIFIER les parties externes qu'on utilise. Une liste écrite à la main
// dérive au premier `pnpm add` ; celle-ci est relue dans les manifestes du dépôt, et
// `tests/unit/composants-open-source.test.ts` échoue si le JSON versionné n'est plus
// ce que le script produit aujourd'hui. Même modèle que scripts/couverture-extraire.mjs.
//
// CE QUI EST LU, ET D'OÙ :
//   - npm : les dépendances DIRECTES de chaque espace de travail (pnpm-workspace.yaml,
//     plus la racine), `dependencies` et `devDependencies` distinguées. Version,
//     licence et dépôt sont lus dans le `package.json` INSTALLÉ (node_modules), jamais
//     dans la plage demandée : `^22` ne dit pas ce qui tourne. Les paquets internes
//     (`workspace:`) sont écartés. Le nombre de paquets du lockfile, transitifs
//     compris, est donné à titre indicatif ;
//   - les images Docker de base (`FROM` de infra/docker/Dockerfile* et de
//     services/*/Dockerfile, `image:` du compose d'infra/docker et des workflows) ;
//   - les actions GitHub (`uses:` des workflows), à leur version ;
//   - les dépendances Python (`requirements*.txt`), s'il y en a ;
//   - Node.js (`.nvmrc`) et pnpm (`packageManager`).
//   Le reste — ce qu'aucun manifeste ne porte — est tenu à la main dans
//   scripts/composants-open-source.externes.json, avec sa raison.
//   labs/ n'est pas lu : des expériences hors produit, qu'aucun service ne lance.
//
// DÉTERMINISTE ET HORS LIGNE. Aucun horodatage (la date affichée est celle du relevé,
// posée dans le fichier des externes : une date tirée de git rendrait `--verifier`
// circulaire — le commit qui régénère le JSON en changerait la date), tout est trié,
// et rien ne part sur le réseau : les licences d'actions et d'images, que le dépôt ne
// contient pas, viennent du fichier des externes. Un composant trouvé sans cette
// licence fait ÉCHOUER le script : un humain va la lire, on ne la devine pas.
//
// AUCUN AUTEUR, AUCUNE ADRESSE. Seuls nom, version, licence et dépôt sont repris d'un
// `package.json` tiers : leurs champs `author` portent souvent une adresse e-mail, et
// le dépôt est public.
//
// Usage :
//   node scripts/composants-open-source.mjs            écrit le JSON
//   node scripts/composants-open-source.mjs --verifier échoue si le JSON versionné diffère
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SORTIE = "apps/console/lib/composants-open-source.generated.json";
export const EXTERNES = "scripts/composants-open-source.externes.json";

/** Ce que la page affiche quand un paquet ne déclare pas l'information : on le dit. */
export const LICENCE_NON_DECLAREE = "non déclarée";
export const DEPOT_NON_DECLARE = "non déclaré";

/** L'ordre des sections de la page. */
export const CATEGORIES = ["console", "backend", "capteurs", "outils", "ci", "conteneurs", "agents", "donnees"];

/**
 * Un paquet d'exécution utilisé par plusieurs espaces se range dans la catégorie la
 * plus exposée : ce qui part chez les clients d'abord, puis ce qui tourne sur nos
 * serveurs.
 */
const PRIORITE_EXECUTION = ["capteurs", "backend", "console", "outils"];

const lire = (chemin) => readFileSync(join(RACINE, chemin), "utf8");
const lireJson = (chemin) => JSON.parse(lire(chemin));
const trier = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function echec(message) {
  return new Error(`composants open source — ${message}`);
}

// ─────────────────────────────── espaces de travail ─────────────────────────────

/** Les motifs de `pnpm-workspace.yaml` : `dossier/*` ou un dossier exact. */
export function motifsEspaces(yaml) {
  const motifs = [];
  let dansPaquets = false;
  for (const ligne of yaml.split("\n")) {
    if (/^packages:\s*$/.test(ligne)) {
      dansPaquets = true;
      continue;
    }
    if (dansPaquets && /^\S/.test(ligne) && !ligne.startsWith("#")) dansPaquets = false;
    const m = dansPaquets && /^\s*-\s*["']?([^"'#\s]+)["']?/.exec(ligne);
    if (m) motifs.push(m[1]);
  }
  return motifs;
}

function listerEspaces() {
  const chemins = ["."];
  for (const motif of motifsEspaces(lire("pnpm-workspace.yaml"))) {
    if (motif.startsWith("!")) continue;
    if (motif.endsWith("/*")) {
      const parent = motif.slice(0, -2);
      if (!existsSync(join(RACINE, parent))) continue;
      for (const d of readdirSync(join(RACINE, parent)).sort(trier)) {
        if (existsSync(join(RACINE, parent, d, "package.json"))) chemins.push(`${parent}/${d}`);
      }
    } else if (!motif.includes("*")) {
      if (existsSync(join(RACINE, motif, "package.json"))) chemins.push(motif);
    } else {
      throw echec(`motif d'espace de travail non pris en charge : « ${motif} »`);
    }
  }
  return chemins.map((chemin) => {
    const pkg = lireJson(join(chemin, "package.json"));
    return { chemin, nom: chemin === "." ? "racine" : pkg.name, pkg };
  });
}

/** La catégorie d'un espace. Un nouvel espace sans catégorie fait échouer : on ne range pas au hasard. */
export function categorieEspace(chemin) {
  if (chemin === "." || chemin.startsWith("tools/")) return "outils";
  if (chemin === "apps/console") return "console";
  if (chemin === "apps/extension" || /^packages\/(?:rum-|agent-)/.test(chemin)) return "capteurs";
  if (chemin.startsWith("packages/") || chemin.startsWith("services/")) return "backend";
  throw echec(`espace de travail sans catégorie : ${chemin} (à ranger dans categorieEspace)`);
}

// ─────────────────────────────── licence et dépôt ───────────────────────────────

/** La licence déclarée par un `package.json`, formes anciennes comprises. */
export function licenceDe(pkg) {
  let l = pkg.license;
  if (l && typeof l === "object") l = l.type;
  if (!l && Array.isArray(pkg.licenses)) {
    l = pkg.licenses
      .map((x) => (typeof x === "string" ? x : x?.type))
      .filter(Boolean)
      .join(" OR ");
  }
  l = typeof l === "string" ? l.trim() : "";
  return l || LICENCE_NON_DECLAREE;
}

const HOTES = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" };

/**
 * Le champ `repository` d'un paquet, en URL https. Formes lues : raccourcis
 * (`github:a/b`, `a/b`), `git+https`, `git://`, `git+ssh://git@…`, `git@hôte:…`,
 * objet `{ url, directory }` — le sous-dossier d'un monodépôt devient un lien
 * `tree/HEAD/…` sur GitHub, pour tomber sur le paquet et pas sur la racine.
 * Une forme inconnue fait échouer : un lien faux est pire qu'un lien absent.
 */
export function depotHttps(repository) {
  const brut = typeof repository === "string" ? repository : repository?.url;
  if (!brut || typeof brut !== "string" || !brut.trim()) return DEPOT_NON_DECLARE;
  let url = brut.trim();
  const raccourci = /^(github|gitlab|bitbucket):(.+)$/.exec(url);
  if (raccourci) url = `https://${HOTES[raccourci[1]]}/${raccourci[2]}`;
  else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  url = url
    .replace(/^git\+/, "")
    .replace(/^git@([^:/]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git:\/\//, "https://")
    .replace(/^http:\/\//, "https://")
    .replace(/#.*$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (!/^https:\/\/[\w.-]+\/[^\s]+$/.test(url)) {
    throw echec(`dépôt illisible : « ${brut} » (forme à ajouter à depotHttps)`);
  }
  const dossier = typeof repository === "object" ? repository?.directory : undefined;
  if (dossier && url.startsWith("https://github.com/") && !url.includes("/tree/")) {
    url = `${url}/tree/HEAD/${String(dossier).replace(/^\.?\/+|\/+$/g, "")}`;
  }
  return url;
}

// ────────────────────────────────────── npm ─────────────────────────────────────

function composantsNpm(espaces, precisions) {
  const parCle = new Map();
  for (const espace of espaces) {
    for (const [champ, dev] of [
      ["dependencies", false],
      ["devDependencies", true],
    ]) {
      for (const [nom, plage] of Object.entries(espace.pkg[champ] ?? {})) {
        if (String(plage).startsWith("workspace:")) continue;
        if (nom.startsWith("@mip/")) continue;
        const manifeste = join(espace.chemin, "node_modules", nom, "package.json");
        if (!existsSync(join(RACINE, manifeste))) {
          throw echec(`${nom} (${espace.chemin}) n'est pas installé : lancer \`pnpm install --frozen-lockfile\``);
        }
        const installe = lireJson(manifeste);
        const cle = `${nom}@${installe.version}`;
        let c = parCle.get(cle);
        if (!c) {
          c = {
            type: "npm",
            nom,
            version: installe.version,
            licence: licenceDe(installe),
            depot: depotHttps(installe.repository),
            usages: [],
            sources: new Set(),
          };
          parCle.set(cle, c);
        }
        c.usages.push({ espace, dev });
        c.sources.add(join(espace.chemin, "package.json"));
      }
    }
  }

  const sortie = [];
  for (const c of parCle.values()) {
    const precision = precisions[c.nom];
    const execution = c.usages.filter((u) => !u.dev).map((u) => categorieEspace(u.espace.chemin));
    const categorie =
      precision?.categorie ??
      (execution.length ? PRIORITE_EXECUTION.find((p) => execution.includes(p)) : "outils");
    // Un espace qui déclare le paquet aux deux endroits compte comme d'exécution.
    const parEspace = new Map();
    for (const u of c.usages) parEspace.set(u.espace.nom, (parEspace.get(u.espace.nom) ?? true) && u.dev);
    const entree = {
      categorie,
      type: "npm",
      nom: c.nom,
      version: c.version,
      licence: c.licence,
      depot: c.depot,
      portee: execution.length ? "execution" : "developpement",
      utilisePar: [...parEspace]
        .map(([nom, dev]) => (dev ? { nom, dev: true } : { nom }))
        .sort((a, b) => trier(a.nom, b.nom)),
      sources: [...c.sources].sort(trier),
    };
    if (precision) {
      for (const f of precision.fichiers ?? []) {
        if (!existsSync(join(RACINE, f))) throw echec(`${c.nom} : fichier cité introuvable, ${f}`);
      }
      if (precision.verifierVersion && !lire(precision.verifierVersion).includes(`"${c.version}"`)) {
        throw echec(
          `${c.nom} : ${precision.verifierVersion} ne porte pas la version installée ${c.version} — recopier le fichier depuis le paquet`,
        );
      }
      if (precision.note) entree.note = precision.note;
      if (precision.fichiers?.length) entree.sources = [...new Set([...entree.sources, ...precision.fichiers])].sort(trier);
    }
    sortie.push(entree);
  }
  for (const nom of Object.keys(precisions)) {
    if (!sortie.some((c) => c.nom === nom)) throw echec(`precisionsNpm cite ${nom}, qui n'est plus une dépendance directe`);
  }
  return sortie;
}

/** Les paquets du lockfile (section `packages:`), transitifs compris. */
export function paquetsDuLockfile(lockfile) {
  let dans = false;
  let n = 0;
  for (const ligne of lockfile.split("\n")) {
    if (/^packages:\s*$/.test(ligne)) {
      dans = true;
      continue;
    }
    if (dans && /^\S/.test(ligne)) break;
    if (dans && /^ {2}\S/.test(ligne)) n++;
  }
  if (!n) throw echec("section `packages:` du lockfile introuvable ou vide");
  return n;
}

// ──────────────────────────── hors npm : fichiers lus ───────────────────────────

function fichiersDe(dossier, filtre) {
  const abs = join(RACINE, dossier);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => filtre(f) && statSync(join(abs, f)).isFile())
    .sort(trier)
    .map((f) => `${dossier}/${f}`);
}

function licenceHorsNpm(horsNpm, cle) {
  const e = horsNpm[cle];
  if (!e?.licence) throw echec(`${cle} : licence à relever et à inscrire dans ${EXTERNES} (horsNpm)`);
  return e;
}

/** `nom[:étiquette][@empreinte]` d'une image Docker. */
export function lireImage(ref) {
  const [avant, empreinte] = ref.split("@");
  const deuxPoints = avant.lastIndexOf(":");
  const aEtiquette = deuxPoints > avant.lastIndexOf("/");
  return {
    nom: aEtiquette ? avant.slice(0, deuxPoints) : avant,
    version: aEtiquette ? avant.slice(deuxPoints + 1) : "latest",
    empreinte: empreinte ?? null,
  };
}

/** Le libellé « où c'est utilisé » d'un fichier : le service, sinon le nom du fichier. */
function libelleFichier(chemin) {
  const service = /^services\/([^/]+)\//.exec(chemin);
  return service ? service[1] : basename(chemin);
}

function composantsImages(horsNpm) {
  const references = [];
  const dockerfiles = [
    ...fichiersDe("infra/docker", (f) => f.startsWith("Dockerfile")),
    ...readdirSync(join(RACINE, "services"))
      .sort(trier)
      .map((d) => `services/${d}/Dockerfile`)
      .filter((f) => existsSync(join(RACINE, f))),
  ];
  for (const fichier of dockerfiles) {
    const etapes = new Set();
    for (const ligne of lire(fichier).split("\n")) {
      const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(ligne);
      if (!m) continue;
      const etapePrecedente = etapes.has(m[1].toLowerCase());
      if (m[2]) etapes.add(m[2].toLowerCase());
      if (etapePrecedente || m[1] === "scratch") continue;
      if (m[1].includes("$")) throw echec(`${fichier} : image calculée (${m[1]}), à inventorier à la main`);
      references.push({ ref: m[1], fichier });
    }
  }
  const composes = [
    ...fichiersDe("infra/docker", (f) => /^docker-compose.*\.ya?ml$/.test(f)),
    ...fichiersDe(".github/workflows", (f) => /\.ya?ml$/.test(f)),
  ];
  for (const fichier of composes) {
    for (const ligne of lire(fichier).split("\n")) {
      const m = /^\s*image:\s*["']?([^"'\s#]+)/.exec(ligne);
      // `mip-rum/<service>:local` : nos propres images, construites depuis les Dockerfile ci-dessus.
      if (m && !m[1].startsWith("mip-rum/") && !m[1].includes("$")) references.push({ ref: m[1], fichier });
    }
  }

  const parCle = new Map();
  for (const { ref, fichier } of references) {
    const img = lireImage(ref);
    const cle = `${img.nom}:${img.version}@${img.empreinte ?? ""}`;
    const c = parCle.get(cle) ?? { ...img, fichiers: new Set() };
    c.fichiers.add(fichier);
    parCle.set(cle, c);
  }
  return [...parCle.values()].map((c) => {
    const e = licenceHorsNpm(horsNpm, `image:${c.nom}`);
    const entree = {
      categorie: "conteneurs",
      type: "image",
      nom: c.nom,
      version: c.version,
      licence: e.licence,
      depot: e.depot ?? DEPOT_NON_DECLARE,
      utilisePar: [...new Set([...c.fichiers].map(libelleFichier))].sort(trier).map((nom) => ({ nom })),
      sources: [...c.fichiers].sort(trier),
    };
    if (c.empreinte) entree.empreinte = c.empreinte;
    if (e.role) entree.role = e.role;
    return entree;
  });
}

/** `propriétaire/dépôt[/chemin]@réf [# vX.Y.Z]` d'une action GitHub. */
export function lireAction(uses, commentaire) {
  const [chemin, ref = ""] = uses.split("@");
  const [proprietaire, depot] = chemin.split("/");
  const sha = /^[0-9a-f]{40}$/.test(ref);
  let version = ref;
  if (sha) version = commentaire ? `${commentaire} (${ref.slice(0, 7)})` : ref.slice(0, 12);
  return { nom: chemin, depot: `https://github.com/${proprietaire}/${depot}`, cle: `${proprietaire}/${depot}`, version };
}

function composantsActions(horsNpm) {
  const parCle = new Map();
  for (const fichier of fichiersDe(".github/workflows", (f) => /\.ya?ml$/.test(f))) {
    for (const ligne of lire(fichier).split("\n")) {
      const m = /^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)["']?\s*(?:#\s*(\S+))?/.exec(ligne);
      if (!m || m[1].startsWith("./") || m[1].startsWith("docker://")) continue;
      const a = lireAction(m[1], m[2]);
      const cle = `${a.nom}@${a.version}`;
      const c = parCle.get(cle) ?? { ...a, fichiers: new Set() };
      c.fichiers.add(fichier);
      parCle.set(cle, c);
    }
  }
  return [...parCle.values()].map((c) => {
    const e = licenceHorsNpm(horsNpm, `action:${c.cle}`);
    const entree = {
      categorie: "ci",
      type: "action",
      nom: c.nom,
      version: c.version,
      licence: e.licence,
      depot: e.depot ?? c.depot,
      utilisePar: [...c.fichiers].map((f) => ({ nom: basename(f) })).sort((a, b) => trier(a.nom, b.nom)),
      sources: [...c.fichiers].sort(trier),
    };
    if (e.role) entree.role = e.role;
    return entree;
  });
}

const ECARTES = new Set(["node_modules", ".git", ".claude", ".next", ".venv", "venv", "__pycache__", "dist", "labs"]);

function trouverRequirements(dossier = "", acc = []) {
  for (const e of readdirSync(join(RACINE, dossier || ".")).sort(trier)) {
    if (ECARTES.has(e)) continue;
    const rel = dossier ? `${dossier}/${e}` : e;
    const st = statSync(join(RACINE, rel));
    if (st.isDirectory()) trouverRequirements(rel, acc);
    else if (/^requirements.*\.txt$/.test(e)) acc.push(rel);
  }
  return acc;
}

function composantsPython(horsNpm) {
  const sortie = [];
  for (const fichier of trouverRequirements()) {
    for (const brute of lire(fichier).split("\n")) {
      const ligne = brute.replace(/\s+#.*$/, "").trim();
      if (!ligne || ligne.startsWith("#") || ligne.startsWith("-")) continue;
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/.exec(ligne);
      if (!m) throw echec(`${fichier} : ligne illisible « ${ligne} »`);
      const nom = m[1].toLowerCase();
      const specification = m[2].split(";")[0].trim();
      const epinglee = /^==\s*([^\s,]+)$/.exec(specification);
      const e = licenceHorsNpm(horsNpm, `python:${nom}`);
      sortie.push({
        categorie: e.categorie ?? "outils",
        type: "python",
        nom,
        version: epinglee ? epinglee[1] : specification || "non épinglée",
        licence: e.licence,
        depot: e.depot ?? DEPOT_NON_DECLARE,
        utilisePar: [{ nom: basename(dirname(fichier)) || "racine" }],
        sources: [fichier],
      });
    }
  }
  return sortie;
}

function composantsOutils(horsNpm) {
  const sortie = [];
  if (existsSync(join(RACINE, ".nvmrc"))) {
    const e = licenceHorsNpm(horsNpm, "outil:node");
    sortie.push({
      categorie: "outils",
      type: "outil",
      nom: "Node.js",
      version: lire(".nvmrc").trim().replace(/^v/, ""),
      licence: e.licence,
      depot: e.depot ?? DEPOT_NON_DECLARE,
      role: e.role,
      utilisePar: [{ nom: "tout le dépôt" }],
      sources: [".nvmrc"],
    });
  }
  const gestionnaire = /^pnpm@([^+]+)/.exec(lireJson("package.json").packageManager ?? "");
  if (gestionnaire) {
    const e = licenceHorsNpm(horsNpm, "outil:pnpm");
    sortie.push({
      categorie: "outils",
      type: "outil",
      nom: "pnpm",
      version: gestionnaire[1],
      licence: e.licence,
      depot: e.depot ?? DEPOT_NON_DECLARE,
      role: e.role,
      utilisePar: [{ nom: "tout le dépôt" }],
      sources: ["package.json"],
    });
  }
  return sortie;
}

// ─────────────────────────── hors npm : tenus à la main ─────────────────────────

const CHAMPS_EXTERNES = ["categorie", "nom", "role", "licence", "depot", "utilisePar"];

function composantsExternes(liste) {
  return liste.map((x) => {
    for (const champ of CHAMPS_EXTERNES) {
      if (x[champ] === undefined || x[champ] === "" || (Array.isArray(x[champ]) && !x[champ].length)) {
        throw echec(`${EXTERNES} : « ${x.nom ?? "?"} » sans ${champ}`);
      }
    }
    if (!CATEGORIES.includes(x.categorie)) throw echec(`${EXTERNES} : « ${x.nom} », catégorie inconnue ${x.categorie}`);
    let version = x.version;
    const sources = [EXTERNES];
    if (x.manifeste) {
      // La base GeoIP change de livraison chaque mois : sa version et sa licence se
      // lisent dans le manifeste que le Dockerfile du collector suit, pas ici.
      const m = lireJson(x.manifeste);
      if (m.licence !== x.licence) throw echec(`${x.nom} : licence ${x.licence} ici, ${m.licence} dans ${x.manifeste}`);
      version = m.version;
      sources.push(x.manifeste);
    }
    if (!version) throw echec(`${EXTERNES} : « ${x.nom} » sans version ni manifeste`);
    const entree = {
      categorie: x.categorie,
      type: "externe",
      nom: x.nom,
      version,
      licence: x.licence,
      depot: x.depot,
      role: x.role,
      utilisePar: [...x.utilisePar].sort(trier).map((nom) => ({ nom })),
      sources: sources.sort(trier),
    };
    if (x.attribution) entree.attribution = x.attribution;
    return entree;
  });
}

// ───────────────────────────────────── relevé ───────────────────────────────────

export function inventorier() {
  const externes = lireJson(EXTERNES);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(externes.releveLe ?? "")) {
    throw echec(`${EXTERNES} : releveLe doit être une date JJ/MM/AAAA`);
  }
  const espaces = listerEspaces();
  for (const e of espaces) categorieEspace(e.chemin); // un espace sans catégorie échoue tout de suite
  const horsNpm = externes.horsNpm ?? {};
  const composants = [
    ...composantsNpm(espaces, externes.precisionsNpm ?? {}),
    ...composantsImages(horsNpm),
    ...composantsActions(horsNpm),
    ...composantsPython(horsNpm),
    ...composantsOutils(horsNpm),
    ...composantsExternes(externes.composants ?? []),
  ];

  const vus = new Set();
  for (const c of composants) {
    if (!CATEGORIES.includes(c.categorie)) throw echec(`${c.nom} : catégorie inconnue ${c.categorie}`);
    const cle = `${c.categorie}|${c.nom}|${c.version}`;
    if (vus.has(cle)) throw echec(`${c.nom} ${c.version} inventorié deux fois dans ${c.categorie}`);
    vus.add(cle);
  }
  composants.sort(
    (a, b) =>
      CATEGORIES.indexOf(a.categorie) - CATEGORIES.indexOf(b.categorie) ||
      trier(a.nom.toLowerCase(), b.nom.toLowerCase()) ||
      trier(a.nom, b.nom) ||
      trier(a.version, b.version),
  );

  return {
    generePar: "node scripts/composants-open-source.mjs",
    releveLe: externes.releveLe,
    paquetsDuLockfile: paquetsDuLockfile(lire("pnpm-lock.yaml")),
    espaces: espaces.map(({ chemin, nom }) => ({ chemin, nom, categorie: categorieEspace(chemin) })),
    categories: CATEGORIES,
    composants,
  };
}

/** Sérialisation stable : c'est elle que le test compare au fichier versionné. */
export function serialiser(inventaire) {
  return `${JSON.stringify(inventaire, null, 2)}\n`;
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
    const attendu = serialiser(inventorier());
    if (process.argv.includes("--verifier")) {
      const versionne = existsSync(join(RACINE, SORTIE)) ? lire(SORTIE) : "";
      if (versionne !== attendu) {
        console.error(`${SORTIE} n'est plus l'inventaire du dépôt : relancer \`node scripts/composants-open-source.mjs\`.`);
        process.exit(1);
      }
      console.log(`${SORTIE} à jour.`);
    } else {
      writeFileSync(join(RACINE, SORTIE), attendu);
      const n = JSON.parse(attendu).composants.length;
      console.log(`${SORTIE} écrit : ${n} composants.`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
