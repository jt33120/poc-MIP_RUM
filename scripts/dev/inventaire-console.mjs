#!/usr/bin/env node
// C-R — L'INVENTAIRE DE LA CONSOLE, CALCULÉ DEPUIS SON CODE.
//
//   node scripts/dev/inventaire-console.mjs             relevé : réécrit
//        docs/architecture/console-api/inventaire.md et cliquet.json
//   node scripts/dev/inventaire-console.mjs --verifier  le cliquet seul : échoue si
//        un écran, une action, une route ou un composant NOUVEAU atteint la base,
//        ou si l'un d'eux a cessé de l'atteindre sans que le cliquet ait été resserré
//        (tests/unit/inventaire-console.test.ts le joue à chaque `pnpm test:unit`).
//
// POURQUOI UN SCRIPT ET PAS UN DOCUMENT. Le premier inventaire de la piste C
// (23/09/2026, annexes du plan) a été fait à la main, sur une copie en retard de
// 133 commits : plusieurs de ses chiffres étaient faux le jour même. La piste C
// déménage la console écran par écran pendant des mois ; un inventaire qui ne se
// recalcule pas ment dès la deuxième semaine. Celui-ci se relit depuis le code.
//
// POURQUOI UN CLIQUET. L'objectif de la piste C (jalon M4) est une console qui
// n'atteint plus la base du tout. Tant qu'on n'y est pas, deux PR peuvent se
// croiser : l'une libère un écran, l'autre en branche un nouveau sur `lib/db.ts`,
// et le compte ne bouge pas. Le cliquet est la liste nominative de ce qui atteint
// la base ; il ne peut que raccourcir.
//
// « ATTEINT LA BASE » : le graphe d'import À L'EXÉCUTION du fichier contient
// `apps/console/lib/db.ts` (le pool de la console) ou importe le paquet `pg`.
//   · `import type` et `export type` ne comptent pas : ils sont effacés à la
//     compilation. Un import de valeur qui ne sert qu'à un type COMPTE — c'est
//     une surestimation assumée ; la corriger, c'est écrire `import type`.
//   · Le layout racine n'est pas compté dans le graphe des écrans : il tire la
//     base pour toutes les pages (projets, fuseau), et C2 le remplace par
//     `GET /v1/shell`. Il est relevé à part.
//   · Les imports dynamiques (`import("…")`) comptent : ils s'exécutent.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSOLE = path.join(RACINE, "apps", "console");
const SORTIE = path.join(RACINE, "docs", "architecture", "console-api");
const DB = path.join(CONSOLE, "lib", "db.ts");
// TypeScript est une dépendance de la console : le script n'en ajoute aucune.
const ts = createRequire(path.join(CONSOLE, "package.json"))("typescript");

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"];
const IGNORES = new Set(["node_modules", ".next", "test-results", "playwright-report"]);

/** Chemin relatif à la racine du dépôt, en séparateurs POSIX. */
const rel = (f) => path.relative(RACINE, f).split(path.sep).join("/");

function fichiers(dir, filtre, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const nom of readdirSync(dir)) {
    if (IGNORES.has(nom)) continue;
    const f = path.join(dir, nom);
    if (statSync(f).isDirectory()) fichiers(f, filtre, acc);
    else if (filtre(f)) acc.push(f);
  }
  return acc.sort();
}

// ─── 1. Le graphe d'import ────────────────────────────────────────────────────

/** Résout un import local de la console ; `null` pour un paquet. */
function resoudre(depuis, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(CONSOLE, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(depuis), spec);
  else return null;
  const candidats = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => path.join(base, "index" + e))];
  // `./x.mjs` écrit pour un `./x.mts`/`.ts` : la console n'en a pas, mais un
  // spécificateur `.js` qui désigne un `.ts` est courant.
  if (/\.js$/.test(base)) candidats.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  return candidats.find((c) => existsSync(c) && statSync(c).isFile()) ?? { introuvable: spec };
}

/** Nom du paquet d'un spécificateur nu : `@mip/backend/lib/x.mjs` → `@mip/backend`. */
const paquet = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

const analyses = new Map();

/**
 * Ce qu'un fichier importe À L'EXÉCUTION, et ce qu'on en retient pour l'inventaire.
 * @returns {{ locaux: string[], paquets: string[], directive: string|null, texte: string, source: import("typescript").SourceFile|null }}
 */
function analyser(f) {
  const deja = analyses.get(f);
  if (deja) return deja;
  const texte = readFileSync(f, "utf8");
  const resultat = { locaux: [], paquets: [], directive: null, texte, source: null, introuvables: [] };
  analyses.set(f, resultat);
  if (!/\.(tsx?|mjs|jsx?)$/.test(f)) return resultat;
  const source = ts.createSourceFile(f, texte, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : undefined);
  resultat.source = source;
  const premier = source.statements[0];
  if (premier && ts.isExpressionStatement(premier) && ts.isStringLiteral(premier.expression)) {
    resultat.directive = premier.expression.text;
  }
  const specs = [];
  const visiter = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeSeul =
        c?.isTypeOnly ||
        (c && !c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) &&
          c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeSeul) specs.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const typeSeul =
        n.isTypeOnly ||
        (n.exportClause && ts.isNamedExports(n.exportClause) && n.exportClause.elements.length > 0 &&
          n.exportClause.elements.every((e) => e.isTypeOnly));
      if (!typeSeul) specs.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0])) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) {
        specs.push(n.arguments[0].text);
      }
    }
    ts.forEachChild(n, visiter);
  };
  visiter(source);
  for (const spec of specs) {
    const r = resoudre(f, spec);
    if (r === null) resultat.paquets.push(paquet(spec));
    else if (typeof r === "string") resultat.locaux.push(r);
    else resultat.introuvables.push(r.introuvable);
  }
  return resultat;
}

/** La fermeture du graphe d'import d'un fichier : fichiers locaux et paquets. */
function fermeture(entree) {
  const vus = new Set([entree]);
  const paquets = new Set();
  const pile = [entree];
  while (pile.length) {
    const f = pile.pop();
    const a = analyser(f);
    for (const p of a.paquets) paquets.add(p);
    for (const l of a.locaux) {
      if (!vus.has(l)) {
        vus.add(l);
        pile.push(l);
      }
    }
  }
  return { fichiers: vus, paquets };
}

/**
 * La chaîne d'import la plus courte du fichier jusqu'à la base (parcours en
 * largeur). C'est ce qu'il faut couper pour libérer le fichier : souvent un seul
 * maillon, un module de `lib/` qui mêle une constante et une requête.
 */
function chaineVersLaBase(entree) {
  const parent = new Map([[entree, null]]);
  const file = [entree];
  while (file.length) {
    const f = file.shift();
    const a = analyser(f);
    if (f === DB || a.paquets.includes("pg")) {
      const chaine = [];
      for (let x = f; x; x = parent.get(x)) chaine.unshift(rel(x).replace(/^apps\/console\//, ""));
      if (f !== DB) chaine.push("pg");
      return chaine;
    }
    for (const l of a.locaux) {
      if (!parent.has(l)) {
        parent.set(l, f);
        file.push(l);
      }
    }
  }
  return null;
}

function atteintLaBase(f) {
  const { fichiers: vus, paquets } = fermeture(f);
  return {
    base: vus.has(DB) || paquets.has("pg"),
    requetes: [...vus].filter((v) => /\/lib\/queries[^/]*\.ts$/.test(v)).map((v) => path.basename(v, ".ts")).sort(),
    chaine: chaineVersLaBase(f),
  };
}

// ─── 2. Ce que chaque fichier dit de lui ──────────────────────────────────────

/** Appels à `lire(…)` dans le fichier : une section d'écran qui peut tomber seule. */
function appelsLire(a) {
  let n = 0;
  const visiter = (x) => {
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "lire") n++;
    ts.forEachChild(x, visiter);
  };
  if (a.source) visiter(a.source);
  return n;
}

/** Les noms importés d'un module donné (`@/lib/auth`, …), valeurs seulement. */
function nomsImportes(a, motif) {
  const noms = [];
  for (const s of a.source?.statements ?? []) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !motif.test(s.moduleSpecifier.text)) continue;
    const c = s.importClause;
    if (!c || c.isTypeOnly) continue;
    if (c.name) noms.push(c.name.text);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
      for (const e of c.namedBindings.elements) if (!e.isTypeOnly) noms.push(e.name.text);
    }
  }
  return noms;
}

/** Fonctions exportées d'un fichier `"use server"` : ses actions. */
function actionsExportees(a) {
  const noms = [];
  for (const s of a.source?.statements ?? []) {
    const exporte = ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exporte) continue;
    if (ts.isFunctionDeclaration(s) && s.name) noms.push(s.name.text);
    else if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) noms.push(d.name.text);
  }
  return noms;
}

/** Actions déclarées DANS un composant (`async function x() { "use server"; … }`). */
function actionsEnLigne(a) {
  const noms = [];
  const visiter = (x) => {
    const corps = (ts.isFunctionDeclaration(x) || ts.isFunctionExpression(x) || ts.isArrowFunction(x)) && x.body && ts.isBlock(x.body) ? x.body : null;
    const premiere = corps?.statements[0];
    if (premiere && ts.isExpressionStatement(premiere) && ts.isStringLiteral(premiere.expression) && premiere.expression.text === "use server") {
      noms.push(x.name && ts.isIdentifier(x.name) ? x.name.text : "(anonyme)");
    }
    ts.forEachChild(x, visiter);
  };
  if (a.source && a.directive !== "use server") visiter(a.source);
  return noms;
}

const METHODES = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** Chemin d'URL d'un fichier de l'arborescence `app/` : groupes `(x)` retirés. */
function cheminApp(f, suffixe) {
  const brut = "/" + rel(f).replace(/^apps\/console\/app\/?/, "").replace(new RegExp(`/?${suffixe}$`), "");
  return brut.split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/") || "/";
}

// ─── 3. La lecture du plan : où chaque surface doit aller ────────────────────
// Répartition du plan backend (C1 à C11), révisable phase par phase. Le premier
// motif qui correspond l'emporte.

const LOTS_ECRANS = [
  [/^\/(login|select(\/new)?)$/, "C1–C2 identité, sélection"],
  [/^\/(legal(\/.*)?|presentation|api-docs|extension-privacy)$/, "statique ou vitrine"],
  [/^\/admin\/privacy$/, "C10 RGPD"],
  [/^\/admin\//, "C9 administration"],
  [/^\/(alerts|slo)$/, "C8 alerting"],
  [/^\/(dashboards(\/.*)?|explorer\/views)$/, "C6 espace de travail"],
  [/^\/(actions|events|mobile|sessions(\/.*)?|explorer)$/, "C3"],
  [/^\/(|forecast|pages|ux|map|errors(\/.*)?|tracing(\/.*)?|correlation)$/, "C4"],
  [/^\/(svi(\/.*)?|logs|acquisition|forms|retention|paths|experience|goals|ai)$/, "C5"],
];

const CIBLES_ROUTES = [
  [/^\/api\/ingest\//, "collector (relais P3 ; relais pur en C11)"],
  [/^\/api\/sourcemaps$/, "collector pour les jetons de CI, console-api pour l'admin (C11)"],
  [/^\/api\/extension\//, "collector (C11)"],
  [/^\/api\/v1\/deploys$/, "collector, jetons de CI (C11)"],
  [/^\/api\/v1\/(issues\/\[id\]\/(comments|links|triage)|explorer\/views(\/\[id\])?)$/, "console-api pour les écritures (C6, C7) ; api pour les lectures"],
  [/^\/api\/v1(\/|$)/, "api (P4, relais #292)"],
  [/^\/api\/rum\/summary$/, "api (P4)"],
  [/^\/api\/cron\//, "à supprimer (410 depuis P0)"],
  [/^\/api\/metrics$/, "à supprimer (supervision par les /metrics des services)"],
  [/^\/(api\/auth\/|demo$|logout$)/, "console-api (C1 identité)"],
  [/^\/api\/admin\//, "console-api (C9)"],
  [/^\/admin\/privacy\/export$/, "console-api (C10 RGPD)"],
  [/^\/api\/dashboards\//, "console-api (C6)"],
  [/^\/api\/replay\//, "console-api (C3)"],
  [/^\/api\/releases$/, "reste sur Vercel, relais serveur (C11)"],
  [/^\/api\/webhooks\/tickets\//, "notifier, relais octet pour octet (C11)"],
];

const AUTH_MODULES = /^@\/lib\/(auth|api\/auth|api\/handle|api\/admin|queries-read-tokens)$/;
const AUTH_LIBELLES = {
  handle: "jeton ou session (lecture)",
  handleQuery: "jeton ou session (lecture)",
  handleMutation: "session (écriture)",
  authenticateApi: "jeton ou session",
  guardAdmin: "session administrateur",
  getUser: "session",
  signJwt: "émet la session",
  resolveReadToken: "jeton de lecture en base",
  bearerMatches: "jeton de métriques",
};

const lot = (table, chemin) => table.find(([m]) => m.test(chemin))?.[1] ?? "à classer";

/**
 * `SANS_RAFRAICHISSEMENT` de `lib/surfaces.ts`, lu dans sa source. (Il n'y a plus
 * de surface « une application à la fois » : F53 a levé ce refus, toutes les
 * lectures lient les apps effectives du principal.)
 */
function surfaces() {
  const texte = readFileSync(path.join(CONSOLE, "lib", "surfaces.ts"), "utf8");
  const bloc = texte.match(/SANS_RAFRAICHISSEMENT = \{([\s\S]*?)\} as const/)?.[1] ?? "";
  const liste = (cle) => [...(bloc.match(new RegExp(`${cle}:\\s*\\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const exacts = liste("exacts");
  const prefixes = liste("prefixes");
  if (!exacts.length) throw new Error("lib/surfaces.ts : SANS_RAFRAICHISSEMENT introuvable — le script doit suivre sa forme");
  return { fige: (p) => exacts.includes(p) || prefixes.some((x) => p.startsWith(x)) };
}

// ─── 4. Le relevé ─────────────────────────────────────────────────────────────

export function relever() {
  analyses.clear();
  const app = path.join(CONSOLE, "app");
  const sfc = surfaces();

  const ecrans = fichiers(app, (f) => f.endsWith(`${path.sep}page.tsx`)).map((f) => {
    const a = analyser(f);
    const chemin = cheminApp(f, "page.tsx");
    const panneaux = [...new Set([...a.texte.matchAll(/panel\??\.type\s*[!=]==\s*"(\w+)"/g)].map((m) => m[1]))].sort();
    const gardes = nomsImportes(a, /^@\/lib\/(auth|page-guards?|guards?)$/).filter((n) => /^(getUser|require|guard)/.test(n));
    return {
      chemin,
      fichier: rel(f),
      ...atteintLaBase(f),
      sections: appelsLire(a),
      panneaux,
      rafraichi: !sfc.fige(chemin),
      gardes,
      lot: lot(LOTS_ECRANS, chemin),
      enLigne: actionsEnLigne(a),
    };
  });

  const sources = [...fichiers(app, (f) => /\.(tsx?|mjs)$/.test(f)), ...fichiers(path.join(CONSOLE, "lib"), (f) => /\.(tsx?|mjs)$/.test(f)), ...fichiers(path.join(CONSOLE, "components"), (f) => /\.(tsx?|mjs)$/.test(f))];
  const actions = sources
    .filter((f) => analyser(f).directive === "use server")
    .map((f) => {
      const a = analyser(f);
      const { base } = atteintLaBase(f);
      const { fichiers: vus } = fermeture(f);
      const audite = [...vus].some((v) => /audit_log|\baudit\(/.test(analyser(v).texte));
      return { fichier: rel(f), actions: actionsExportees(a), base, audite };
    });

  const routes = fichiers(app, (f) => f.endsWith(`${path.sep}route.ts`)).map((f) => {
    const a = analyser(f);
    const chemin = cheminApp(f, "route.ts");
    const methodes = METHODES.filter((m) => new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`).test(a.texte));
    const auth = [...new Set(nomsImportes(a, AUTH_MODULES).map((n) => AUTH_LIBELLES[n]).filter(Boolean))];
    return { chemin, fichier: rel(f), methodes, auth, base: atteintLaBase(f).base, cible: lot(CIBLES_ROUTES, chemin) };
  });

  const composants = fichiers(path.join(CONSOLE, "components"), (f) => /\.(tsx?)$/.test(f))
    .filter((f) => analyser(f).directive !== "use client" && analyser(f).directive !== "use server")
    .map((f) => ({ fichier: rel(f), ...atteintLaBase(f) }))
    .filter((c) => c.base);

  const lectures = fichiers(path.join(CONSOLE, "lib"), (f) => /\/queries[^/]*\.ts$/.test(f)).map((f) => ({
    module: path.basename(f, ".ts"),
    fonctions: (readFileSync(f, "utf8").match(/^export async function \w+/gm) ?? []).length,
    ecrans: ecrans.filter((e) => e.requetes.includes(path.basename(f, ".ts"))).length,
  }));

  const layout = path.join(app, "layout.tsx");
  const compte = (dir, nom) => fichiers(dir, (f) => f.endsWith(`${path.sep}${nom}`)).length;
  return {
    ecrans,
    actions,
    routes,
    composants,
    lectures,
    layoutBase: existsSync(layout) ? atteintLaBase(layout).base : false,
    frontieres: { error: compte(app, "error.tsx"), notFound: compte(app, "not-found.tsx"), loading: compte(app, "loading.tsx") },
    sectionsTotal: sources.reduce((n, f) => n + appelsLire(analyser(f)), 0),
    actionsEnLigne: ecrans.flatMap((e) => e.enLigne.map((n) => `${e.chemin} → ${n}`)),
  };
}

// ─── 5. Le cliquet ────────────────────────────────────────────────────────────

/** Ce qui atteint la base, nominativement. Le cliquet ne peut que raccourcir. */
export function cliquetDe(r) {
  return {
    ecrans: r.ecrans.filter((e) => e.base).map((e) => e.chemin).sort(),
    actions: r.actions.filter((a) => a.base).map((a) => a.fichier).sort(),
    routes: r.routes.filter((x) => x.base).map((x) => x.chemin).sort(),
    composants: r.composants.map((c) => c.fichier).sort(),
    layout: r.layoutBase,
  };
}

/**
 * Compare le cliquet enregistré à l'état du code.
 * @returns {{ nouveaux: string[], liberes: string[] }} `nouveaux` : ce qui atteint la
 *   base sans être au cliquet (refusé) ; `liberes` : ce qui ne l'atteint plus et
 *   doit en sortir (le cliquet se resserre dans la PR qui libère).
 */
export function comparerCliquet(enregistre, courant) {
  const nouveaux = [];
  const liberes = [];
  for (const cle of ["ecrans", "actions", "routes", "composants"]) {
    const avant = new Set(enregistre[cle] ?? []);
    const maintenant = new Set(courant[cle]);
    for (const x of maintenant) if (!avant.has(x)) nouveaux.push(`${cle} : ${x}`);
    for (const x of avant) if (!maintenant.has(x)) liberes.push(`${cle} : ${x}`);
  }
  if (courant.layout && !enregistre.layout) nouveaux.push("layout racine");
  if (!courant.layout && enregistre.layout) liberes.push("layout racine");
  return { nouveaux, liberes };
}

// ─── 6. Le document ───────────────────────────────────────────────────────────

const oui = (b) => (b ? "**oui**" : "non");
const liste = (l) => (l.length ? l.join(", ") : "—");

export function rendre(r, { date, commit }) {
  const c = cliquetDe(r);
  const L = [];
  L.push("# Inventaire de la console, pour la piste C");
  L.push("");
  L.push(`> **Généré** par \`node scripts/dev/inventaire-console.mjs\` le ${date}, sur \`${commit}\`. Ne pas éditer à la main : relancer le script. Méthode et limites en tête du script ; décisions de contrat dans [README.md](README.md).`);
  L.push("");
  L.push("## En chiffres");
  L.push("");
  L.push("| | Nombre | Atteignent la base |");
  L.push("|---|---|---|");
  L.push(`| Écrans (\`page.tsx\`) | ${r.ecrans.length} | **${c.ecrans.length}** |`);
  L.push(`| Fichiers d'actions serveur (\`"use server"\`) | ${r.actions.length} (${r.actions.reduce((n, a) => n + a.actions.length, 0)} actions) | **${c.actions.length}** |`);
  L.push(`| Actions déclarées dans un écran | ${r.actionsEnLigne.length} | — |`);
  L.push(`| Routes (\`route.ts\`) | ${r.routes.length} | **${c.routes.length}** |`);
  L.push(`| Composants serveur qui atteignent la base eux-mêmes | — | **${c.composants.length}** |`);
  L.push(`| Layout racine | 1 | ${oui(r.layoutBase)} |`);
  L.push(`| Modules \`lib/queries*.ts\` | ${r.lectures.length} (${r.lectures.reduce((n, l) => n + l.fonctions, 0)} fonctions exportées) | — |`);
  L.push(`| Sections \`lire()\` (appels) | ${r.sectionsTotal} | — |`);
  L.push(`| \`error.tsx\` / \`not-found.tsx\` / \`loading.tsx\` | ${r.frontieres.error} / ${r.frontieres.notFound} / ${r.frontieres.loading} | — |`);
  L.push(`| Écrans rafraîchis toutes les 5 s (\`AutoRefresh\`) | ${r.ecrans.filter((e) => e.rafraichi).length} | — |`);
  L.push("");
  L.push("**Le cliquet** (`cliquet.json`) liste nominativement ce qui atteint la base. `tests/unit/inventaire-console.test.ts` refuse toute entrée nouvelle, et demande de le resserrer quand une entrée disparaît.");
  L.push("");
  L.push("## Écrans");
  L.push("");
  L.push("« Sections » : appels `lire()` du fichier de l'écran — chacune tombe seule, le loader de `console-api` rendra un résultat par section. « Panneaux » : types de `panel=` que l'écran ouvre — chacun est une opération à part. « 5 s » : rejoué par `AutoRefresh` toutes les 5 s.");
  L.push("");
  L.push("| Écran | Lot | Base | Modules de requêtes | Sections | Panneaux | 5 s |");
  L.push("|---|---|---|---|---|---|---|");
  for (const e of r.ecrans) {
    L.push(`| \`${e.chemin}\` | ${e.lot} | ${oui(e.base)} | ${e.requetes.length ? e.requetes.map((q) => q.replace(/^queries-?/, "") || "queries").join(", ") : "—"} | ${e.sections || "—"} | ${liste(e.panneaux)} | ${e.rafraichi ? "oui" : "non"} |`);
  }
  L.push("");
  L.push("## Actions serveur");
  L.push("");
  L.push("« Auditée » : le graphe de l'action contient une écriture d'`audit_log`. C0 imposera une action d'audit (ou une exemption) à toute route non-GET de `console-api`.");
  L.push("");
  L.push("| Fichier | Actions | Base | Auditée |");
  L.push("|---|---|---|---|");
  for (const a of r.actions) L.push(`| \`${a.fichier.replace("apps/console/", "")}\` | ${a.actions.join(", ")} | ${oui(a.base)} | ${a.audite ? "oui" : "non"} |`);
  if (r.actionsEnLigne.length) {
    L.push("");
    L.push(`Actions déclarées dans un écran : ${r.actionsEnLigne.map((x) => `\`${x}\``).join(", ")}.`);
  }
  L.push("");
  L.push("## Routes");
  L.push("");
  L.push("« Authentification » : ce que la route importe des modules d'authentification. Vide : publique, ou gardée autrement (secret, signature, clé d'ingestion) — voir la route.");
  L.push("");
  L.push("| Route | Méthodes | Authentification | Base | Destination |");
  L.push("|---|---|---|---|---|");
  for (const x of r.routes) L.push(`| \`${x.chemin}\` | ${x.methodes.join(", ")} | ${liste(x.auth)} | ${oui(x.base)} | ${x.cible} |`);
  L.push("");
  L.push("## Composants serveur qui atteignent la base");
  L.push("");
  if (r.composants.length) {
    L.push("« Chemin » : la chaîne d'import la plus courte jusqu'à `lib/db.ts` — le maillon à couper pour libérer le composant.");
    L.push("");
    L.push("| Composant | Chemin vers la base |");
    L.push("|---|---|");
    for (const k of r.composants) L.push(`| \`${k.fichier.replace("apps/console/", "")}\` | ${k.chaine.slice(1).map((x) => `\`${x}\``).join(" → ")} |`);
  } else {
    L.push("Aucun.");
  }
  L.push("");
  L.push("## Modules de lecture");
  L.push("");
  L.push("| Module | Fonctions exportées | Écrans qui l'atteignent |");
  L.push("|---|---|---|");
  for (const l of r.lectures) L.push(`| \`lib/${l.module}.ts\` | ${l.fonctions} | ${l.ecrans} |`);
  L.push("");
  return L.join("\n");
}

// ─── 7. Ligne de commande ─────────────────────────────────────────────────────

export const FICHIER_CLIQUET = path.join(SORTIE, "cliquet.json");

function main(argv) {
  const r = relever();
  const courant = cliquetDe(r);
  if (argv.includes("--verifier")) {
    const enregistre = JSON.parse(readFileSync(FICHIER_CLIQUET, "utf8"));
    const { nouveaux, liberes } = comparerCliquet(enregistre, courant);
    for (const x of nouveaux) console.error(`✗ atteint la base, hors cliquet : ${x}`);
    for (const x of liberes) console.error(`✗ n'atteint plus la base, à retirer du cliquet : ${x}`);
    if (nouveaux.length || liberes.length) {
      console.error("cliquet : node scripts/dev/inventaire-console.mjs pour le resserrer (jamais pour l'élargir)");
      process.exit(1);
    }
    console.log(`cliquet tenu : ${courant.ecrans.length} écrans, ${courant.actions.length} fichiers d'actions, ${courant.routes.length} routes, ${courant.composants.length} composants`);
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  const commit = argv.find((a) => a.startsWith("--commit="))?.slice(9) ?? "HEAD";
  mkdirSync(SORTIE, { recursive: true });
  writeFileSync(path.join(SORTIE, "inventaire.md"), rendre(r, { date, commit }));
  writeFileSync(FICHIER_CLIQUET, `${JSON.stringify({ releve: date, ...courant }, null, 2)}\n`);
  console.log(`inventaire écrit : ${r.ecrans.length} écrans (${courant.ecrans.length} atteignent la base), ${r.routes.length} routes, ${r.actions.length} fichiers d'actions`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2));
