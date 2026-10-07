// La cartographie du graphe technique (lib/cartographie) dit tout le projet sur une
// page publique : ce test la confronte au dépôt, pour qu'elle ne dérive pas au
// premier service ajouté ou à la première table supprimée.
//
//   · la forme : identifiants uniques, liens et parcours qui visent des éléments qui
//     existent, chaque élément dans sa zone, aucun élément sur un autre ;
//   · les sources : chaque `fichier:ligne` cité existe, et la ligne aussi ;
//   · les listes : les tables (refaites à partir des migrations), les services
//     Railway (de l'IaC), les workflows GitHub, les outils MCP (du catalogue) ;
//   · les chiffres : ceux que la carte affiche se recomptent ici.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TABLES_CARTE } from "@/lib/cartographie/base";
import { CARTOGRAPHIE, CHIFFRES } from "@/lib/cartographie/donnees";
import { HAUTEUR_ELEMENT, LARGEUR_ELEMENT, idLien, type Element } from "@/lib/cartographie/types";
import { POIDS_KO } from "@/lib/installation-faits";
import { FEEDBACK_GZIP_KO, REPLAY_GZIP_KO, SDK_GZIP_KO, koTexte } from "@/lib/sdk-poids";

const RACINE = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");
const PAR_ID = new Map(CARTOGRAPHIE.elements.map((e) => [e.id, e]));

function fichiers(dossier: string, filtre: (nom: string) => boolean): string[] {
  const racine = join(RACINE, dossier);
  const out: string[] = [];
  const parcourir = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".next") parcourir(p);
      } else if (filtre(e.name)) out.push(relative(RACINE, p).split("\\").join("/"));
    }
  };
  parcourir(racine);
  return out.sort();
}

const rectangle = (e: Element) => ({
  x1: e.x,
  y1: e.y,
  x2: e.x + (e.largeur ?? LARGEUR_ELEMENT),
  y2: e.y + (e.hauteur ?? HAUTEUR_ELEMENT),
});

describe("la forme de la carte", () => {
  it("des identifiants uniques, des liens et des parcours qui visent des éléments existants", () => {
    const ids = CARTOGRAPHIE.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const liens = CARTOGRAPHIE.liens.map(idLien);
    expect(new Set(liens).size).toBe(liens.length);
    const orphelins = CARTOGRAPHIE.liens.flatMap((l) => [l.de, l.vers]).filter((id) => !PAR_ID.has(id));
    expect(orphelins).toEqual([]);
    const inconnus = CARTOGRAPHIE.parcours.flatMap((p) => p.etapes.flatMap((e) => e.elements)).filter((id) => !PAR_ID.has(id));
    expect(inconnus).toEqual([]);
  });

  it("chaque élément relié à au moins un autre : une carte n'a pas d'île", () => {
    const relies = new Set(CARTOGRAPHIE.liens.flatMap((l) => [l.de, l.vers]));
    expect(CARTOGRAPHIE.elements.filter((e) => !relies.has(e.id)).map((e) => e.id)).toEqual([]);
  });

  it("chaque élément dans sa zone, et aucun sur un autre", () => {
    const zones = new Map(CARTOGRAPHIE.zones.map((z) => [z.id, z]));
    const dehors = CARTOGRAPHIE.elements.filter((e) => {
      if (!e.zone) return false;
      const z = zones.get(e.zone)!;
      const r = rectangle(e);
      return r.x1 < z.x || r.y1 < z.y || r.x2 > z.x + z.largeur || r.y2 > z.y + z.hauteur;
    });
    expect(dehors.map((e) => e.id)).toEqual([]);

    const chevauchements: string[] = [];
    const tous = CARTOGRAPHIE.elements.map((e) => ({ id: e.id, r: rectangle(e) }));
    for (let i = 0; i < tous.length; i++) {
      for (let j = i + 1; j < tous.length; j++) {
        const a = tous[i].r;
        const b = tous[j].r;
        if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) chevauchements.push(`${tous[i].id} × ${tous[j].id}`);
      }
    }
    expect(chevauchements).toEqual([]);
  });

  it("les zones ne se chevauchent pas", () => {
    const z = CARTOGRAPHIE.zones;
    const fautes: string[] = [];
    for (let i = 0; i < z.length; i++) {
      for (let j = i + 1; j < z.length; j++) {
        const a = z[i];
        const b = z[j];
        if (a.x < b.x + b.largeur && b.x < a.x + a.largeur && a.y < b.y + b.hauteur && b.y < a.y + a.hauteur) {
          fautes.push(`${a.id} × ${b.id}`);
        }
      }
    }
    expect(fautes).toEqual([]);
  });

  it("chaque parcours a au moins deux étapes, chacune sur au moins un élément", () => {
    for (const p of CARTOGRAPHIE.parcours) {
      expect(p.etapes.length, p.id).toBeGreaterThanOrEqual(2);
      for (const e of p.etapes) expect(e.elements.length, `${p.id} : ${e.titre}`).toBeGreaterThan(0);
    }
  });
});

describe("les sources citées existent", () => {
  it("chaque `fichier:ligne` pointe un fichier du dépôt, et une ligne qu'il contient", () => {
    const fautes: string[] = [];
    for (const e of CARTOGRAPHIE.elements) {
      for (const f of e.faits) {
        expect(f.sources.length, `${e.id} : « ${f.texte} » sans source`).toBeGreaterThan(0);
        for (const s of f.sources) {
          const m = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(s)!;
          const chemin = join(RACINE, m[1]);
          if (!existsSync(chemin) || !statSync(chemin).isFile()) {
            fautes.push(`${e.id} : ${s} (fichier absent)`);
            continue;
          }
          // Un chemin seul ne demande que l'existence du fichier : on ne l'ouvre pas.
          if (!m[2]) continue;
          const lignes = readFileSync(chemin, "utf8").split("\n").length;
          const fin = Number(m[3] ?? m[2]);
          if (fin > lignes) fautes.push(`${e.id} : ${s} (le fichier a ${lignes} lignes)`);
        }
      }
    }
    expect(fautes).toEqual([]);
  });

  // Le test précédent ne voit qu'une ligne qui existe : une citation décalée par un
  // ajout en amont reste verte, et le panneau en fait un lien vers le mauvais code.
  // Pour les fichiers du SDK que les lots modifient le plus, la plage citée doit
  // contenir le code qu'elle prouve.
  it("les plages citées du rejeu et des options du SDK montrent le code qu'elles prouvent", () => {
    const ANCRES: Record<string, string[]> = {
      "packages/rum-sdk/src/replay.ts:137-146": ["function optionsMasquage", "maskAllInputs: true", 'maskTextSelector: "*"'],
      "packages/rum-sdk/src/replay.ts:9-11": ["REPLAY_MAX_MS = 120_000", "REPLAY_MAX_COMPRESSED_BYTES = 1024 * 1024", "CHUNK_FLUSH_MS = 10_000"],
      "packages/rum-sdk/src/replay.ts:353-361": ['"x-mip-session"', '"x-mip-app"', '"x-mip-seq"', '"x-mip-key"'],
      "packages/rum-sdk/src/types.ts:112-128": ["interface CaptureErrorsConfig", "console?:", "resources?:", "csp?:", "network?:", "workers?:", "websockets?:"],
    };
    const citees = new Set(CARTOGRAPHIE.elements.flatMap((e) => e.faits.flatMap((f) => f.sources)));
    const fautes: string[] = [];
    for (const [source, attendus] of Object.entries(ANCRES)) {
      if (!citees.has(source)) {
        fautes.push(`${source} n'est plus citée : mettre l'ancre à jour avec la citation`);
        continue;
      }
      const [, chemin, debut, fin] = /^(.+):(\d+)-(\d+)$/.exec(source)!;
      const extrait = lire(chemin).split("\n").slice(Number(debut) - 1, Number(fin)).join("\n");
      for (const a of attendus) if (!extrait.includes(a)) fautes.push(`${source} ne contient pas ${a}`);
    }
    expect(fautes).toEqual([]);
  });
});

describe("les listes de la carte sont celles du dépôt", () => {
  it("les tables : celles que les migrations laissent, plus le registre du migrateur", () => {
    const sql = fichiers("packages/db/sql", (n) => /^(schema|migration-v\d+)\.sql$/.test(n))
      .map((f) => ({ f, n: f.endsWith("schema.sql") ? 1 : Number(/v(\d+)/.exec(f)![1]) }))
      .sort((a, b) => a.n - b.n);
    const tables = new Set<string>();
    for (const { f } of sql) {
      // Les commentaires SQL ne créent rien : on les retire avant de chercher.
      const texte = lire(f).replace(/--[^\n]*/g, "");
      // Un `drop table` peut en nommer plusieurs : `drop table if exists a, b, c;`.
      for (const m of texte.matchAll(/\b(create\s+(?:unlogged\s+)?table|drop\s+table)\s+(?:if\s+(?:not\s+)?exists\s+)?([^;(]+)/gi)) {
        const noms = m[2]
          .split(",")
          .map((n) => /^\s*(?:public\.)?"?([a-z_][a-z0-9_]*)"?/i.exec(n)?.[1]?.toLowerCase())
          .filter((n): n is string => Boolean(n));
        if (/^create/i.test(m[1])) tables.add(noms[0]);
        else for (const n of noms) tables.delete(n);
      }
    }
    expect(lire("packages/db/migrate.mjs")).toMatch(/create table if not exists schema_migration/i);
    tables.add("schema_migration");
    expect([...TABLES_CARTE].sort()).toEqual([...tables].sort());
    expect(TABLES_CARTE.length).toBe(CHIFFRES.tables);
    expect(sql.at(-1)!.n).toBe(CHIFFRES.derniereMigration);
  });

  it("les services Railway : un dossier `services/<x>` avec son Dockerfile, un élément chacun", () => {
    // AGENTS.md : « services/<x> — ce que Railway exécute ».
    const services = readdirSync(join(RACINE, "services"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(RACINE, "services", d.name, "Dockerfile")))
      .map((d) => d.name);
    expect(services.length).toBeGreaterThan(0);
    for (const s of services) expect(PAR_ID.get(s)?.zone, s).toBe("railway");
    expect(CARTOGRAPHIE.elements.filter((e) => e.zone === "railway" && e.famille === "service").length).toBe(services.length);
  });

  it("les workflows GitHub : un élément chacun", () => {
    const workflows = readdirSync(join(RACINE, ".github/workflows")).filter((n) => n.endsWith(".yml"));
    for (const w of workflows) expect(PAR_ID.has(`workflow-${w.replace(/\.yml$/, "")}`), w).toBe(true);
  });

  it("les outils MCP : ceux du catalogue", () => {
    const outils = [...lire("packages/mcp-tools/lib/catalogue.mjs").matchAll(/nom: "(mip_rum_[a-z_]+)"/g)].map((m) => m[1]);
    const mcp = PAR_ID.get("mcp")!;
    expect(mcp.liste?.entrees.map((x) => x.nom).sort()).toEqual([...outils].sort());
    expect(outils.length).toBe(CHIFFRES.outilsMcp);
  });
});

describe("les chiffres affichés se recomptent", () => {
  it("les écrans de la console, hors vitrine", () => {
    const pages = fichiers("apps/console/app", (n) => n === "page.tsx").filter((f) => !f.includes("/app/presentation"));
    expect(pages.length).toBe(CHIFFRES.ecrans);
  });

  it("les routes de l'API v1", () => {
    expect(fichiers("apps/console/app/api/v1", (n) => n === "route.ts").length).toBe(CHIFFRES.routesApiV1);
  });

  // Les opérations de console-api se recomptent depuis sa table : tests/unit/console-api-table.test.ts.

  // Le poids du SDK est écrit à la main dans la carte : sans ce garde, un rebuild
  // qui fait bouger lib/sdk-poids.ts (remesuré par specs.test.ts) le laissait faux.
  it("le poids du SDK web : celui de lib/sdk-poids.ts", () => {
    const sdk = PAR_ID.get("sdk-web")!;
    const textes = [sdk.sousTitre ?? "", ...sdk.faits.map((f) => f.texte)].join("\n");
    const poids = [...textes.matchAll(/(\d+(?:,\d+)?) Ko gzip/g)].map((m) => m[1]);
    expect(poids.length).toBeGreaterThan(0);
    for (const p of poids) expect(p).toBe(koTexte(SDK_GZIP_KO));
  });

  // Même garde pour les autres poids écrits à la main dans la carte : l'archive de
  // l'extension (85 Ko restés après la refonte des zips à 87 Ko), le rejeu, le widget.
  it("les poids du rejeu, du widget d'avis et de l'extension : ceux de l'installateur", () => {
    const sousTitre = (id: string) => PAR_ID.get(id)!.sousTitre ?? "";
    expect(sousTitre("rejeu")).toContain(`${koTexte(REPLAY_GZIP_KO)} Ko gzip`);
    expect(sousTitre("avis")).toContain(`${koTexte(FEEDBACK_GZIP_KO)} Ko gzip`);
    expect(sousTitre("extension")).toContain(`${koTexte(POIDS_KO.extension)} Ko`);
  });

  it("les fichiers de tests, suite par suite", () => {
    for (const [suite, n] of Object.entries(CHIFFRES.fichiersDeTests)) {
      const trouves = fichiers(`tests/${suite}`, (f) => /\.(test|spec)\.(ts|tsx|mjs|js)$/.test(f));
      expect(trouves.length, suite).toBe(n);
    }
  });
});
