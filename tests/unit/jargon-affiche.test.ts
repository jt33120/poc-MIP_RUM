// GARDE — aucun code interne dans un texte AFFICHÉ par la console (recette du 26/09/2026).
//
// La recette a relevé, à l'écran : des codes de lot (« (parité C3) », « B30 absent »,
// « S6 », « (B5) »), « seau » (le « bucket » de la conception), des chemins du dépôt
// (« lib/impact.ts », « docs/INTEGRATION.md »), des noms de tables (« rum_span ») et de
// migrations. Ils restent permis dans les COMMENTAIRES, où ils servent : cette garde ne
// lit que ce qu'un utilisateur peut voir.
//
// CE QUI EST LU. Le texte JSX et les chaînes des écrans et composants (`app/`,
// `components/`), et celles des modules de textes d'écran de `lib/` (glossaire,
// catalogues de blocs, libellés de l'Explorer…). Sont écartés : les commentaires (par
// construction : on lit l'arbre syntaxique), les imports, les types, les clés, les
// comparaisons, les attributs techniques (`className`, `href`, `data-*`…), les
// messages d'exception, le SQL, et les valeurs rangées sous une clé de PREUVE
// (`sources`, `preuve`, `table`…) qu'un écran garde sans les afficher.
//
// HORS GARDE. `app/admin/composants` : page de développement (vitrine des composants),
// hors production. `app/api` et les `route.ts` : des réponses d'API, pas un écran.
// Les modules de `lib/` qui LISENT la base (requêtes, chargeurs, commandes) : leurs
// chaînes sont du SQL.
//
// Une occurrence légitime (un nom de produit comme « S3 ») s'ajoute à `PERMIS`, avec sa
// raison ; un faux positif de la lecture se corrige dans la lecture, pas par une liste.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CONSOLE = path.join(process.cwd(), "apps", "console");
// TypeScript est une dépendance de la CONSOLE : résolu depuis elle, comme le fait
// `scripts/dev/inventaire-console.mjs`.
const ts: typeof import("typescript") = createRequire(path.join(CONSOLE, "package.json"))("typescript");

/** Avant et après un motif : ni lettre (accents compris), ni chiffre, ni `%` d'une URL encodée. */
const AVANT = "(?<![\\p{L}\\p{N}_%/.\\-])";
const APRES = "(?![\\p{L}\\p{N}_])";

const MOTIFS: readonly { nom: string; re: RegExp }[] = [
  // B30, C3, P8.6, S6, F69… ; R-P, R-V ; W-E3, W-B1 ; P*.1.
  { nom: "code de lot", re: new RegExp(`${AVANT}(?:[BCFRSP]\\d{1,2}(?:\\.\\d)?|R-[A-Z]{1,2}|W-[A-Z]\\d*|P\\*\\.\\d)${APRES}`, "gu") },
  { nom: "parité", re: /\(parité [A-Z]\d+\)/gu },
  { nom: "lecture à créer", re: /lecture à créer/giu },
  { nom: "« seau »", re: new RegExp(`(?<![\\p{L}\\p{N}_])seaux?${APRES}`, "giu") },
  { nom: "chemin du dépôt", re: new RegExp(`${AVANT}(?:apps|packages|lib|docs|components|tests)/[\\w./-]+`, "gu") },
  { nom: "table", re: new RegExp(`(?<![\\p{L}\\p{N}_])rum_[a-z0-9_]+`, "gu") },
  { nom: "migration", re: /migration-v\d+/gu },
];

/** Occurrences légitimes, chacune avec sa raison. */
const PERMIS: Readonly<Record<string, string>> = {
  S3: "Amazon S3, un hébergement statique cité à l'installation",
};

/**
 * Le graphe technique de la vitrine (`/presentation/graphe-technique`, ex-dossier) cite les identifiants
 * du registre de couverture (A1…F3, D14) et des points « Ce qui reste » (R1…R11) :
 * ce sont les références que les tests de couverture exigent, pas des codes de lot.
 * Ce motif-là, et lui seul, y est admis.
 */
const DOSSIER = /^(?:components\/presentation\/(?:Annexe|Reste|SaitFaire|Contient|Capteurs|Specs|Positionnement|Releve|GrapheTechnique|CouvertureBarre|Ancres|Partie)\.tsx|lib\/(?:presentation-(?:reste|sait-faire|contient)|specs|couverture)\.ts|app\/presentation\/graphe-technique\/.*)$/;
const IDENTIFIANT_REGISTRE = /^[A-FR]\d{1,2}$/;

/**
 * La cartographie du graphe technique (30/09/2026) est une carte du CODE, pour qui
 * veut le lire : elle montre, par choix, les noms des tables, des chemins et des
 * migrations. Ces trois motifs-là, et eux seuls, y sont admis ; un code de lot ou
 * « seau » y reste une faute.
 */
const CARTOGRAPHIE = /^(?:components\/presentation\/cartographie|lib\/cartographie)\//;
const MOTIFS_DE_LA_CARTE = new Set(["table", "chemin du dépôt", "migration"]);

/** Hors garde : développement, API, et modules de `lib/` qui lisent la base. */
const HORS_GARDE = [
  /^app\/admin\/composants\//,
  /^app\/api\//,
  /(?:^|\/)route\.tsx?$/,
  /^lib\/(?:queries[^/]*|chargeurs\/.*|commandes\/.*|commande[^/]*|api\/.*|db|dsar|query-(?:compiler|sql|schema)|analytics-compiler|server-trace[^/]*|ingest[^/]*|[^/]*-relay|auth|oidc[^/]*|backend|log-forward|mcp-sonde|error-symbolication|platform-flag|forecast-comparaison|session-console|aiguillage-console-api|next-cache)\.tsx?$/,
];

/** Attributs JSX qui ne s'affichent pas. */
const ATTRIBUTS_TECHNIQUES = new Set([
  "className", "id", "key", "href", "src", "type", "name", "role", "htmlFor", "method", "action", "rel", "target", "style",
  "fill", "stroke", "d", "viewBox", "width", "height", "scope", "colSpan", "rowSpan", "autoComplete", "inputMode",
  "pattern", "encType", "dataKey", "xmlns", "strokeDasharray", "textAnchor", "points", "transform", "patternUnits",
  "patternTransform", "aria-controls", "aria-describedby", "aria-labelledby", "aria-current", "aria-hidden", "form",
  "accept", "value", "defaultValue", "lang", "dir", "tabIndex", "prefetch", "scroll", "as", "sizes", "media",
  "crossOrigin", "integrity", "nonce", "referrerPolicy", "sandbox", "allow", "loading", "decoding", "fetchPriority",
  "icon", "domain", "align", "side", "variant", "size", "ton", "kind", "testId", "testid", "format", "cle", "motif", "origine",
]);

/** Clés sous lesquelles une valeur est une PREUVE ou une donnée technique, gardée sans être affichée. */
const CLES_TECHNIQUES = new Set([
  "sources", "preuve", "preuves", "fichier", "fichiers", "module", "marqueur", "table", "tables", "colonne", "column", "sql",
]);

const EGALITES = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.InKeyword,
]);

const SQL = /\b(?:select|insert into|update|delete from|from|where|coalesce|join)\b[\s\S]*\b(?:from|where|set|values|on|as)\b/i;

type Noeud = import("typescript").Node;

function nomDe(n: import("typescript").PropertyName | import("typescript").JsxAttributeName): string {
  return ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : n.getText();
}

/** Le nœud est-il rangé sous une clé technique, à travers gabarits, tableaux et objets imbriqués ? */
function sousCleTechnique(n: Noeud): boolean {
  for (let a: Noeud | undefined = n.parent; a; a = a.parent) {
    if (ts.isPropertyAssignment(a)) {
      if (CLES_TECHNIQUES.has(nomDe(a.name))) return true;
    } else if (
      !ts.isArrayLiteralExpression(a) &&
      !ts.isObjectLiteralExpression(a) &&
      !ts.isTemplateSpan(a) &&
      !ts.isTemplateExpression(a) &&
      !ts.isAsExpression(a) &&
      !ts.isSatisfiesExpression(a) &&
      !ts.isParenthesizedExpression(a)
    ) {
      return false;
    }
  }
  return false;
}

/** Les usages (hors déclaration) de chaque identifiant du fichier. */
type Usages = Map<string, Noeud[]>;

function usagesDe(sf: import("typescript").SourceFile): Usages {
  const usages: Usages = new Map();
  const visiter = (n: Noeud) => {
    if (ts.isIdentifier(n) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
      usages.set(n.text, [...(usages.get(n.text) ?? []), n]);
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return usages;
}

/** Une chaîne qu'aucun utilisateur ne lit. */
function ecartee(n: Noeud, dansLib: boolean, usages: Usages): boolean {
  const p = n.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isBinaryExpression(p) && EGALITES.has(p.operatorToken.kind)) return true;
  if (ts.isCallExpression(p)) {
    const f = p.expression;
    if (f.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(f) && f.text === "require")) return true;
    if (ts.isPropertyAccessExpression(f) && ts.isIdentifier(f.expression) && f.expression.text === "console") return true;
  }
  if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && /Error$/.test(p.expression.text)) return true;
  // Attribut JSX technique, en littéral ou en expression (`className={"…"}`, `href={`…`}`).
  for (let a: Noeud | undefined = p; a && !ts.isJsxElement(a) && !ts.isSourceFile(a); a = a.parent) {
    if (ts.isJsxAttribute(a)) {
      const nom = nomDe(a.name);
      if (ATTRIBUTS_TECHNIQUES.has(nom) || nom.startsWith("data-")) return true;
      break;
    }
  }
  // Valeur rangée sous une clé technique, à travers tableaux et objets imbriqués.
  if (sousCleTechnique(n)) return true;
  // Constante qui ne sert QUE sous une clé technique (le chemin commun des sources d'une
  // table de preuves, `const DOC = "docs/…"`) : elle n'est pas affichée non plus.
  if (ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name)) {
    const refs = usages.get(p.name.text) ?? [];
    if (refs.length > 0 && refs.every(sousCleTechnique)) return true;
  }
  if (dansLib && SQL.test(n.getText())) return true;
  return false;
}

interface Texte {
  texte: string;
  ligne: number;
}

function textesAffiches(fichier: string, dansLib: boolean, source = readFileSync(fichier, "utf8")): Texte[] {
  const sf = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, fichier.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Texte[] = [];
  const usages = usagesDe(sf);
  const ligne = (n: Noeud) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visiter = (n: Noeud) => {
    if (ts.isJsxText(n)) {
      const t = n.getText(sf).replace(/\s+/g, " ").trim();
      if (t) out.push({ texte: t, ligne: ligne(n) });
    } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ecartee(n, dansLib, usages)) {
      out.push({ texte: n.text, ligne: ligne(n) });
    } else if (ts.isTemplateExpression(n) && !ecartee(n, dansLib, usages)) {
      out.push({ texte: [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" "), ligne: ligne(n) });
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return out;
}

function lister(dossier: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dossier)) {
    const p = path.join(dossier, e);
    if (e === "node_modules" || e === ".next") continue;
    if (statSync(p).isDirectory()) lister(p, acc);
    else if (/\.tsx?$/.test(e) && !e.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

/** Le relevé : une ligne par occurrence, « fichier:ligne — motif « trouvé » : texte ». */
export function releverJargon(): string[] {
  const fautes: string[] = [];
  for (const racine of ["app", "components", "lib"]) {
    for (const fichier of lister(path.join(CONSOLE, racine))) {
      const rel = path.relative(CONSOLE, fichier).split(path.sep).join("/");
      if (HORS_GARDE.some((re) => re.test(rel))) continue;
      const dossier = DOSSIER.test(rel);
      for (const { texte, ligne } of textesAffiches(fichier, racine === "lib")) {
        for (const { nom, re } of MOTIFS) {
          for (const m of texte.matchAll(re)) {
            if (PERMIS[m[0]]) continue;
            if (dossier && nom === "code de lot" && IDENTIFIANT_REGISTRE.test(m[0])) continue;
            if (CARTOGRAPHIE.test(rel) && MOTIFS_DE_LA_CARTE.has(nom)) continue;
            fautes.push(`${rel}:${ligne} — ${nom} « ${m[0]} » : ${texte.slice(0, 120)}`);
          }
        }
      }
    }
  }
  return fautes;
}

describe("aucun code interne dans un texte affiché", () => {
  it("ni code de lot, ni « seau », ni chemin du dépôt, ni table, ni migration", () => {
    expect(releverJargon()).toEqual([]);
  }, 60_000);

  // La lecture elle-même : un faux négatif rendrait la garde muette.
  it("la lecture ne garde que le texte affiché", () => {
    const source = `
      // B30 : un commentaire peut citer un lot.
      import { x } from "@/lib/format";
      const DOC = "docs/PREUVE.md";
      const LIGNES = [{ titre: "Vue", sources: [\`\${DOC}:12\`] }];
      export function Ecran({ n }: { n: number }) {
        if (n === 0) throw new Error("lib/backend : réservé au serveur");
        return (
          <div className="B30" data-lot="C3" title="Réglage (parité C3)">
            Indisponible (B30 absent)
            <p>{\`\${n} seaux\`}</p>
          </div>
        );
      }`;
    const textes = textesAffiches("Ecran.tsx", false, source).map((t) => t.texte);
    expect(textes).toContain("Réglage (parité C3)");
    expect(textes).toContain("Indisponible (B30 absent)");
    expect(textes.some((t) => t.includes("seaux"))).toBe(true);
    expect(textes).toContain("Vue");
    // Ni commentaire, ni import, ni attribut technique, ni exception, ni preuve.
    expect(textes.join(" ")).not.toMatch(/un commentaire|@\/lib|docs\/PREUVE|lib\/backend|^B30$/);
    expect(textes).not.toContain("B30");
    expect(textes).not.toContain("C3");
  });

  it("les motifs trouvent ce qu'ils doivent trouver", () => {
    const [code, , , seau, chemin, table, migration] = MOTIFS.map((m) => new RegExp(m.re.source, m.re.flags));
    expect("Indisponible (B30 absent)".match(code)).toEqual(["B30"]);
    expect("réseau et serveur".match(seau)).toBeNull();
    expect("seau de 1 h".match(seau)).toEqual(["seau"]);
    expect("voir lib/impact.ts".match(chemin)).toEqual(["lib/impact.ts"]);
    expect("https://nextjs.org/docs/messages".match(chemin)).toBeNull();
    expect("stocké en table rum_span".match(table)).toEqual(["rum_span"]);
    expect("avec migration-v86".match(migration)).toEqual(["migration-v86"]);
    expect("/errors?browser=Navigateur%20int%C3%A9gr%C3%A9".match(code)).toBeNull();
  });
});
