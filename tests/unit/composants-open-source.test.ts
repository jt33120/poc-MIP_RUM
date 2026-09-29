// L'inventaire des composants open source (page /presentation/open-source).
//
// Le JSON que lit la page est produit par scripts/composants-open-source.mjs depuis
// les manifestes du dépôt. Ce fichier vérifie :
//   1. que le JSON versionné EST ce que le script produit aujourd'hui (mode --verifier) :
//      un `pnpm add` sans régénération fait rougir la CI ;
//   2. qu'aucune ligne n'a de licence ou de dépôt vide sans le dire (« non déclarée ») ;
//   3. qu'aucun auteur ni adresse e-mail d'un paquet tiers n'est recopié (dépôt public) ;
//   4. que les données tierces de lib/legal.ts y sont, sous la même licence ;
//   5. que la lecture des champs `repository` et des images tient ses formes ;
//   6. que la page est publique, par son chemin exact ;
//   7. que la page rend chaque ligne et ses décomptes, lus dans le JSON, et que le
//      pied de page de la vitrine y mène.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Pied } from "../../apps/console/components/presentation/Cadre";
import PageOpenSource from "../../apps/console/app/presentation/open-source/page";
import {
  CATEGORIES,
  DEPOT_NON_DECLARE,
  LICENCE_NON_DECLAREE,
  SORTIE,
  categorieEspace,
  depotHttps,
  licenceDe,
  lireAction,
  lireImage,
  motifsEspaces,
  paquetsDuLockfile,
} from "../../scripts/composants-open-source.mjs";
import { vigilance } from "../../apps/console/app/presentation/open-source/inventaire";
import { estCheminPublic } from "../../apps/console/lib/chemins-publics";
import { DATA_SOURCES, SUBPROCESSORS } from "../../apps/console/lib/legal";

const RACINE = join(__dirname, "..", "..");
const BRUT = readFileSync(join(RACINE, SORTIE), "utf8");
const INVENTAIRE = JSON.parse(BRUT) as {
  releveLe: string;
  paquetsDuLockfile: number;
  espaces: { chemin: string; nom: string }[];
  categories: string[];
  composants: {
    categorie: string;
    type: string;
    nom: string;
    version: string;
    licence: string;
    depot: string;
    utilisePar: { nom: string; dev?: boolean }[];
    sources: string[];
    attribution?: string;
  }[];
};

describe("1 — le JSON versionné est l'inventaire du dépôt d'aujourd'hui", () => {
  it("le mode --verifier ne trouve aucun écart", () => {
    const r = spawnSync(process.execPath, ["scripts/composants-open-source.mjs", "--verifier"], {
      cwd: RACINE,
      encoding: "utf8",
    });
    expect(r.status, `${r.stderr}${r.stdout}`).toBe(0);
  });
});

describe("2 — chaque ligne dit sa licence et son dépôt, ou dit qu'ils manquent", () => {
  const { composants } = INVENTAIRE;

  it("une licence non vide sur chaque ligne ; « non déclarée » quand le paquet n'en dit rien", () => {
    const vides = composants.filter((c) => typeof c.licence !== "string" || !c.licence.trim());
    expect(vides.map((c) => c.nom)).toEqual([]);
  });

  it("un dépôt en https sur chaque ligne, ou « non déclaré »", () => {
    const fautifs = composants.filter((c) => c.depot !== DEPOT_NON_DECLARE && !/^https:\/\/[\w.-]+\/\S+$/.test(c.depot));
    expect(fautifs.map((c) => `${c.nom} : ${c.depot}`)).toEqual([]);
  });

  it("une version, une catégorie connue et au moins un usage sur chaque ligne", () => {
    for (const c of composants) {
      expect(c.version, c.nom).toBeTruthy();
      expect(CATEGORIES, c.nom).toContain(c.categorie);
      expect(c.utilisePar.length, c.nom).toBeGreaterThan(0);
      expect(c.sources.length, c.nom).toBeGreaterThan(0);
    }
  });

  it("chaque catégorie de la page a au moins une ligne", () => {
    expect(INVENTAIRE.categories).toEqual(CATEGORIES);
    for (const cat of CATEGORIES) expect(composants.some((c) => c.categorie === cat), cat).toBe(true);
  });

  it("les paquets internes n'y sont pas", () => {
    const internes = new Set(INVENTAIRE.espaces.map((e) => e.nom));
    expect(composants.filter((c) => c.nom.startsWith("@mip/") || internes.has(c.nom)).map((c) => c.nom)).toEqual([]);
  });

  it("le nombre de paquets du lockfile est celui de sa section `packages:`", () => {
    expect(INVENTAIRE.paquetsDuLockfile).toBe(paquetsDuLockfile(readFileSync(join(RACINE, "pnpm-lock.yaml"), "utf8")));
    expect(INVENTAIRE.paquetsDuLockfile).toBeGreaterThan(INVENTAIRE.composants.length);
  });

  it("le relevé est daté JJ/MM/AAAA", () => {
    expect(INVENTAIRE.releveLe).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("3 — rien d'un auteur tiers n'est recopié", () => {
  it("aucune adresse e-mail, aucun champ auteur ou mainteneur", () => {
    expect(BRUT).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}/i);
    expect(BRUT).not.toMatch(/"(author|maintainers|contributors|email)"/);
  });
});

describe("4 — les données tierces de lib/legal.ts sont inventoriées, sous la même licence", () => {
  it.each(DATA_SOURCES.map((d) => [d.name, d] as const))("%s", (_nom, d) => {
    const c = INVENTAIRE.composants.find((x) => x.nom === d.name);
    expect(c, `${d.name} absent de l'inventaire`).toBeDefined();
    expect(c!.categorie).toBe("donnees");
    expect(c!.licence).toBe(d.licence);
    expect(c!.attribution).toBe(d.attribution);
  });

  it("une licence d'attribution est signalée à surveiller", () => {
    expect(vigilance("CC BY 4.0")).toMatch(/Attribution/);
    expect(vigilance("MPL-2.0")).toMatch(/Copyleft faible/);
    expect(vigilance("GPL-3.0-only")).toMatch(/Copyleft/);
    expect(vigilance(LICENCE_NON_DECLAREE)).toMatch(/Aucune licence/);
    expect(vigilance("MIT")).toBeNull();
    expect(vigilance("Apache-2.0")).toBeNull();
  });
});

describe("5 — la lecture des manifestes", () => {
  it("normalise les formes de `repository` en https", () => {
    expect(depotHttps("git+https://github.com/vercel/next.js.git")).toBe("https://github.com/vercel/next.js");
    expect(depotHttps("git://github.com/a/b.git")).toBe("https://github.com/a/b");
    expect(depotHttps("git+ssh://git@github.com/a/b.git")).toBe("https://github.com/a/b");
    expect(depotHttps("git@gitlab.com:a/b.git")).toBe("https://gitlab.com/a/b");
    expect(depotHttps("github:a/b")).toBe("https://github.com/a/b");
    expect(depotHttps("a/b")).toBe("https://github.com/a/b");
    expect(depotHttps({ type: "git", url: "https://github.com/facebook/react.git", directory: "packages/react" })).toBe(
      "https://github.com/facebook/react/tree/HEAD/packages/react",
    );
    expect(depotHttps(undefined)).toBe(DEPOT_NON_DECLARE);
    expect(() => depotHttps("svn:quelque-part")).toThrow(/dépôt illisible/);
  });

  it("lit la licence, formes anciennes comprises, et dit quand elle manque", () => {
    expect(licenceDe({ license: "MIT" })).toBe("MIT");
    expect(licenceDe({ license: { type: "ISC" } })).toBe("ISC");
    expect(licenceDe({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("MIT OR Apache-2.0");
    expect(licenceDe({})).toBe(LICENCE_NON_DECLAREE);
  });

  it("découpe une image Docker et une action GitHub épinglée", () => {
    expect(lireImage("node:24.21.0-bookworm-slim@sha256:abc")).toEqual({
      nom: "node",
      version: "24.21.0-bookworm-slim",
      empreinte: "sha256:abc",
    });
    expect(lireImage("registre:5000/equipe/outil")).toEqual({ nom: "registre:5000/equipe/outil", version: "latest", empreinte: null });
    const sha = "9e17d413dbe219f19d62538d9c06b5dbb5e9abf8";
    expect(lireAction(`railwayapp/config@${sha}`, "v1.2.0").version).toBe("v1.2.0 (9e17d41)");
    expect(lireAction("actions/checkout@v6", undefined)).toMatchObject({ nom: "actions/checkout", version: "v6" });
  });

  it("lit les motifs de pnpm-workspace.yaml, et refuse un espace sans catégorie", () => {
    expect(motifsEspaces('# x\npackages:\n  - "packages/*"\n  - apps/*\nautre: 1\n')).toEqual(["packages/*", "apps/*"]);
    expect(categorieEspace("apps/console")).toBe("console");
    expect(categorieEspace("packages/rum-sdk")).toBe("capteurs");
    expect(categorieEspace("services/collector")).toBe("backend");
    expect(() => categorieEspace("apps/nouvelle")).toThrow(/sans catégorie/);
  });
});

describe("6 — la page est publique, par son chemin exact", () => {
  it("/presentation/open-source s'ouvre sans compte, pas ses variantes", () => {
    expect(estCheminPublic("/presentation/open-source")).toBe(true);
    expect(estCheminPublic("/presentation/open-source/x")).toBe(false);
    expect(estCheminPublic("/presentation/open-sources")).toBe(false);
  });
});

describe("7 — la page rend l'inventaire, sans rien taper", () => {
  // Rendu SSR réel : le premier rendu, celui d'un lecteur sans JavaScript, montre tout.
  const html = renderToStaticMarkup(createElement(PageOpenSource));

  it("une ligne par composant, et chaque dépôt en lien", () => {
    expect(html.split('data-testid="composant"').length - 1).toBe(INVENTAIRE.composants.length);
    for (const c of INVENTAIRE.composants.filter((x) => x.depot !== DEPOT_NON_DECLARE)) {
      expect(html, c.nom).toContain(`href="${c.depot}"`);
    }
  });

  it("l'en-tête dit la date du relevé, le nombre de composants et de licences, lus dans le JSON", () => {
    const releve = /data-testid="open-source-releve"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1].replace(/<[^>]+>/g, "") ?? "";
    const licencesDistinctes = new Set(INVENTAIRE.composants.map((c) => c.licence)).size;
    expect(releve).toContain(INVENTAIRE.releveLe);
    expect(releve).toContain(`${INVENTAIRE.composants.length} composants`);
    expect(releve).toContain(`${licencesDistinctes} licences distinctes`);
  });

  it("les services hébergés sont ceux de lib/legal.ts, et l'attribution GeoIP est rendue", () => {
    for (const s of SUBPROCESSORS) expect(html).toContain(s.name.replace(/&/g, "&amp;"));
    for (const d of DATA_SOURCES) expect(html).toContain(d.attribution);
  });

  it("le pied de page de la vitrine y mène", () => {
    expect(renderToStaticMarkup(createElement(Pied))).toMatch(/<a [^>]*href="\/presentation\/open-source"/);
  });
});
