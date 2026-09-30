// F27 — gardes de code du domaine performance (plan § 6.5, preuve de fin de F27).
//
// Trois `grep` du plan, rejoués à chaque `pnpm test:unit` plutôt qu'une fois dans une
// PR — une régression doit rougir la CI du lot qui la commet, pas attendre la recette
// suivante :
//
//   - P2 (§ 1.2) : aucun seuil de Web Vital recopié hors de `lib/rating.ts` dans les
//     écrans du domaine — `app/` (ses fichiers de tête : la Vue d'ensemble) et
//     `app/{pages,errors,ux,actions,events,experience}` ; même expression que le plan ;
//   - `fired=` (§ 3.1) : `fired` est le NOMBRE d'alertes émises par « Évaluer
//     maintenant », jamais l'identifiant d'un déclenchement (`evt`) — aucun composant,
//     ni `lib/presets.ts`, ne l'écrit ;
//   - `blindSpots` (F13) : la tuile d'angle mort lit la concordance robot × réel (F57),
//     plus l'ancien champ `blindSpots` — ni la Vue d'ensemble ni `components/perf`.
//
// Et, depuis la vague 4 (29/09/2026), le pendant de P2 pour les SEUILS MIP
// (`lib/seuils.ts`) : aucune de leurs bornes recopiée dans `app/**` ni `components/**`.
// Un écran lit `SEUILS_MIP`, `noteMip` et `texteRegleMip` ; une borne recopiée garde
// l'ancienne valeur le jour où la règle change, et la couleur ment.
//
// Un commentaire compte : le plan grep le texte, pas l'AST. Une borne se cite par son
// nom (`THRESHOLDS`, « borne Bon », `SEUILS_MIP.DNS.mauvais`), jamais par sa valeur.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SEUILS_MIP, type MesureMip, type UniteSeuil } from "../../apps/console/lib/seuils";

const CONSOLE = join(__dirname, "..", "..", "apps", "console");

/** Fichiers d'un dossier ; `recursif: false` : ceux de tête seulement (le `app/` du plan). */
function fichiersDe(dossier: string, recursif = true): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return recursif ? fichiersDe(chemin) : [];
    return e.isFile() ? [chemin] : [];
  });
}

/** Les lignes qui correspondent, « chemin:ligne: texte » — comme `grep -rn`. */
function lignesTrouvees(fichiers: string[], motif: RegExp): string[] {
  return fichiers.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((ligne, i) => (motif.test(ligne) ? [`${relative(CONSOLE, f)}:${i + 1}: ${ligne.trim()}`] : [])),
  );
}

const app = (...segments: string[]) => join(CONSOLE, "app", ...segments);

describe("gardes de code du domaine performance (F27)", () => {
  it("P2 : aucun seuil de Web Vital recopié dans les écrans du domaine", () => {
    const ecrans = [
      ...fichiersDe(app(), false),
      ...["pages", "errors", "ux", "actions", "events", "experience"].flatMap((d) => fichiersDe(app(d))),
    ];
    expect(ecrans.length).toBeGreaterThan(10);
    expect(lignesTrouvees(ecrans, /2500|4000|\b200\b.*500|0\.25/)).toEqual([]);
  });

  it("fired= : aucun lien de composant ni de vue préréglée ne désigne un déclenchement par le compte d'alertes", () => {
    const sources = [...fichiersDe(join(CONSOLE, "components")), join(CONSOLE, "lib", "presets.ts")];
    expect(lignesTrouvees(sources, /fired=/)).toEqual([]);
  });

  it("blindSpots : la Vue d'ensemble et components/perf ne lisent plus l'ancien champ d'angle mort", () => {
    const sources = [app("page.tsx"), ...fichiersDe(join(CONSOLE, "components", "perf"))];
    expect(lignesTrouvees(sources, /blindSpots/)).toEqual([]);
  });

  it("le motif P2 reconnaît bien une borne recopiée (le test n'est pas vide par construction)", () => {
    const motif = /2500|4000|\b200\b.*500|0\.25/;
    expect(motif.test("bandes 200 / 500 ms")).toBe(true);
    expect(motif.test("lcp: 2500")).toBe(true);
    expect(motif.test("un seau de 1200 ms")).toBe(false);
  });
});

// ───────────────────────────── Seuils MIP (vague 4) ─────────────────────────────
//
// Les bornes MIP sont des nombres ordinaires (100, 300, 1 000…) : les chercher nues
// rougirait sur chaque `hauteur={150}`. Une ligne n'est donc retenue que si elle
// réunit les DEUX : un mot qui désigne la mesure (« DNS », « ressource »…) ET une de
// ses bornes écrite comme une borne — avec son unité (« 150 ms », « 1 s », « 5 % »,
// « 1 Mbit/s ») ou après un comparateur (« > 150 », « >= 0.05 »). Les motifs sont
// construits depuis `SEUILS_MIP` : une borne qui change est cherchée à sa nouvelle
// valeur sans toucher ce test.

/** Les mots qui désignent une mesure MIP sur une ligne. */
const MOTS_MIP: Record<MesureMip, RegExp> = {
  REDIRECT: /redirect|redirection/i,
  DNS: /\bdns\b/i,
  TCP: /\btcp\b/i,
  TLS: /\btls\b/i,
  // « requête » et « réponse » sont partout (SQL, HTTP) : seule la clé de phase compte.
  REQUEST: /\bREQUEST\b/,
  RESPONSE: /\bRESPONSE\b/,
  RTT: /\brtt\b|aller-retour/i,
  DOWNLINK: /downlink|débit/i,
  LONGTASK: /long ?tasks?|tâches? longues?/i,
  LOAF: /\bloaf\b|animation longue|animation frame/i,
  RESOURCE: /ressource|resource/i,
  API: /\bapi\b|http\.duration|\bappels?\b/i,
  RAGE_CLICKS: /\brage|rageur/i,
  DEAD_CLICKS: /\bdead\b|clics? morts?/i,
  BROWSER_ERRORS: /erreur|error/i,
};

/** Une borne écrite comme une borne : unité accolée, ou comparateur devant. Jamais le nombre nu. */
function motifsBorne(valeur: number, unite: UniteSeuil): RegExp[] {
  // La borne 0 (REDIRECT) n'est pas cherchable : « 0 ms » est partout, et ce n'est
  // pas une règle qu'on recopie.
  if (valeur === 0) return [];
  // Espace entre le nombre et l'unité : rien, espace, insécable, ou son écriture
  // ` ` / `&nbsp;` dans le source.
  const esp = String.raw`(?:\\u00a0|&nbsp;| |\s)?`;
  const nombre = (v: number) => {
    const t = String(v);
    if (t.includes(".")) return t.replace(".", "[.,]");
    // 1000 s'écrit aussi « 1 000 », « 1_000 », « 1 000 » (insécable).
    return t.length > 3 ? `${t.slice(0, -3)}[ _ ]?${t.slice(-3)}` : t;
  };
  const avant = String.raw`(?<![\d.,])`;
  const motifs = [new RegExp(String.raw`[<>≤≥]=?\s*${nombre(valeur)}(?![\d])`)];
  if (unite === "part") {
    motifs.push(new RegExp(String.raw`${avant}${nombre(Math.round(valeur * 1000) / 10)}(?:[.,]0)?\s*${esp}%`));
  } else if (unite === "Mbit/s") {
    motifs.push(new RegExp(String.raw`${avant}${nombre(valeur)}\s*${esp}Mbit`, "i"));
  } else {
    motifs.push(new RegExp(String.raw`${avant}${nombre(valeur)}\s*${esp}ms\b`));
    if (valeur >= 1000) motifs.push(new RegExp(String.raw`${avant}${nombre(valeur / 1000)}(?:[.,]0)?\s*${esp}s\b`));
  }
  return motifs;
}

/** Une ligne recopie-t-elle une borne MIP ? Rend les mesures concernées. */
function mesuresRecopiees(ligne: string): MesureMip[] {
  return (Object.keys(SEUILS_MIP) as MesureMip[]).filter((mesure) => {
    const s = SEUILS_MIP[mesure];
    if (!MOTS_MIP[mesure].test(ligne)) return false;
    return [...motifsBorne(s.bon, s.unite), ...motifsBorne(s.mauvais, s.unite)].some((m) => m.test(ligne));
  });
}

/**
 * Occurrences tolérées. VIDE depuis le lot 4b (29/09/2026) : les deux exceptions
 * relevées à la création de la garde (`panneau.tsx`, `Cascade.tsx`) écrivaient le
 * seuil de COLLECTE du SDK (`DEFAULT_SLOW_RESOURCE_MS`), égal à la borne « bon » de
 * `SEUILS_MIP.RESOURCE` ; elles lisent maintenant `SEUIL_COLLECTE_RESSOURCE_MS` /
 * `TEXTE_SEUIL_COLLECTE_RESSOURCE` (`lib/resources.ts`), comme les trois copies de
 * `lib/` (`RESOURCE_THRESHOLD_NOTICE`, `lib/deroule.ts`, `lib/presentation-sait-faire.ts`).
 * Ne pas en rajouter : lire la borne.
 */
const EXCEPTIONS_MIP: readonly { fichier: string; extrait: string; releve: string }[] = [];

/**
 * Les deux seuls fichiers de `lib/` qui ÉCRIVENT des bornes : le référentiel MIP et
 * celui des vitals (dont les commentaires citent les budgets web.dev en clair).
 * Depuis le lot 4b, la garde couvre aussi le reste de `lib/` : le 300 ms de
 * `lib/resources.ts` y avait échappé.
 */
const SOURCES_DES_BORNES = new Set(["lib/seuils.ts", "lib/rating.ts"]);

function bornesMipTrouvees(): string[] {
  const fichiers = [
    ...fichiersDe(app()),
    ...fichiersDe(join(CONSOLE, "components")),
    ...fichiersDe(join(CONSOLE, "lib")).filter((f) => /\.tsx?$/.test(f) && !SOURCES_DES_BORNES.has(relative(CONSOLE, f))),
  ];
  return fichiers.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((ligne, i) => {
        const mesures = mesuresRecopiees(ligne);
        return mesures.length ? [`${relative(CONSOLE, f)}:${i + 1}: [${mesures.join(", ")}] ${ligne.trim()}`] : [];
      }),
  );
}

const estException = (trouvee: string) =>
  EXCEPTIONS_MIP.some((e) => trouvee.startsWith(`${e.fichier}:`) && trouvee.includes(e.extrait));

describe("gardes de code des seuils MIP (vague 4)", () => {
  it("aucune borne de SEUILS_MIP recopiée dans app/** ni components/** (hors exceptions datées)", () => {
    expect(bornesMipTrouvees().filter((t) => !estException(t))).toEqual([]);
  });

  it("plus aucune exception : les deux relevées le 29/09/2026 sont résorbées (lot 4b)", () => {
    expect(EXCEPTIONS_MIP).toEqual([]);
  });

  it("chaque exception datée correspond encore à une ligne (sinon, la retirer d'EXCEPTIONS_MIP)", () => {
    const trouvees = bornesMipTrouvees();
    for (const e of EXCEPTIONS_MIP) {
      expect(e.releve).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(
        trouvees.some((t) => t.startsWith(`${e.fichier}:`) && t.includes(e.extrait)),
        `exception obsolète : ${e.fichier} « ${e.extrait} »`,
      ).toBe(true);
    }
  });

  it("chaque mesure de SEUILS_MIP a ses mots", () => {
    expect(Object.keys(MOTS_MIP).sort()).toEqual(Object.keys(SEUILS_MIP).sort());
  });

  it("le motif MIP reconnaît une borne recopiée et ignore un nombre nu (le test n'est pas vide par construction)", () => {
    // Recopiées : unité accolée ou comparateur, à côté du mot de la mesure.
    expect(mesuresRecopiees("règle : DNS > 150 ms")).toEqual(["DNS"]);
    expect(mesuresRecopiees("if (p75DNS >= 150) ton = 'bad'")).toEqual([]); // « DNS » collé : pas un mot
    expect(mesuresRecopiees("const dns = p75 > 150 ? 'bad' : 'ok'")).toEqual(["DNS"]);
    expect(mesuresRecopiees("Ressources lentes : au-delà de 1 000 ms")).toContain("RESOURCE");
    expect(mesuresRecopiees("appel API lent (> 1 s)")).toEqual(["API"]); // 1 s = 1 000 ms
    expect(mesuresRecopiees("appel API lent (1 s et plus)")).toEqual(["API"]);
    expect(mesuresRecopiees("appel API lent (> 2 s)")).toEqual([]);
    expect(mesuresRecopiees("clics rageurs : mauvais au-delà de 5 %")).toEqual(["RAGE_CLICKS"]);
    expect(mesuresRecopiees("if (part > 0.08) // clics morts")).toEqual(["DEAD_CLICKS"]);
    expect(mesuresRecopiees("débit < 1 Mbit/s")).toEqual(["DOWNLINK"]);
    expect(mesuresRecopiees("Tâches longues de plus de 250 ms")).toEqual(["LONGTASK"]);
    // Ignorés : un nombre nu, une valeur de démonstration, un nombre plus long.
    expect(mesuresRecopiees("<Chart titre=\"Tâches longues\" hauteur={150} />")).toEqual([]);
    expect(mesuresRecopiees("{ valeur: \"Firefox\", nBase: 300, partTouches: 0.05, href: \"/errors\" }")).toEqual([]);
    expect(mesuresRecopiees("DNS : 1500 ms")).toEqual([]);
  });
});
