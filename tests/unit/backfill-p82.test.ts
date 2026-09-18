// P8.2 — ce qui se prouve SANS base : les frontières, les refus, les
// empreintes, et le contrat que les quatre reconstructions doivent tenir.
//
// Ces tests gardent les décisions qui, oubliées, ne feraient échouer aucun
// test SQL : une borne acceptée sans fuseau, une taille de lot hors bornes, une
// empreinte qui change avec l'ordre des clés d'un JSON, un module de
// reconstruction ajouté sans entrer dans le calcul d'empreinte de code — et la
// moyenne de p75, qui doit rester impossible à obtenir.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import {
  APP_INTERDITES,
  FICHIERS_CODE,
  KINDS,
  LOT,
  RETENTION_DEFAUT_JOURS,
  borneUtc,
  empreinteCode,
  empreintePlan,
  fenetre,
  tailleLot,
  // @ts-expect-error module JS sans déclarations
} from "../../apps/ingest/lib/backfills/planner.mjs";
// @ts-expect-error module JS sans déclarations
import { ETATS, avancer, codeErreur } from "../../apps/ingest/lib/backfills/runner.mjs";
// @ts-expect-error module JS sans déclarations
import { ErreurBackfill, fusionnerSkips, totalSkips } from "../../apps/ingest/lib/backfills/commun.mjs";
// @ts-expect-error module JS sans déclarations
import { fusionHistogrammesPossible, fusionnerHistogrammes } from "../../apps/ingest/lib/backfills/rollups.mjs";
// @ts-expect-error module JS sans déclarations
import { CARTE_RENDUE_MAX, ECHANTILLON_CARTE_MAX } from "../../apps/ingest/lib/backfills/error-groups.mjs";
// @ts-expect-error module JS sans déclarations
import { ENTETE_HERITEE } from "../../apps/ingest/lib/error-issue-workflow.mjs";
// @ts-expect-error module JS sans déclarations
import { analyserArgs, exiger } from "../../scripts/backfill-rum.mjs";

const RACINE = join(__dirname, "..", "..");

describe("P8.2 — bornes de fenêtre", () => {
  it("n'accepte qu'un instant UTC explicite", () => {
    expect(borneUtc("2026-09-01T00:00:00Z", "--from")).toBe("2026-09-01T00:00:00Z");
    expect(borneUtc("2026-09-01T00:00Z", "--from")).toBe("2026-09-01T00:00Z");
    expect(borneUtc("2026-09-01T00:00:00.123456Z", "--from")).toBe("2026-09-01T00:00:00.123456Z");
    // Sans fuseau, la même commande décrirait deux fenêtres différentes selon la
    // machine qui la lance.
    for (const mauvais of ["2026-09-01", "2026-09-01 00:00:00", "2026-09-01T00:00:00+02:00", "hier", "", null, 17]) {
      expect(() => borneUtc(mauvais, "--from")).toThrowError(/instant UTC explicite/);
    }
  });

  it("exige `[from, to)` non vide et ordonné", () => {
    expect(fenetre("2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"))
      .toEqual({ from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" });
    expect(() => fenetre("2026-09-02T00:00:00Z", "2026-09-01T00:00:00Z")).toThrowError(/semi-ouvert/);
    // Une fenêtre d'instant nul ne contient rien : `[t, t)` est vide.
    expect(() => fenetre("2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z")).toThrowError(/semi-ouvert/);
  });
});

describe("P8.2 — taille de lot", () => {
  it("vaut 1 000 par défaut et reste entre 100 et 5 000", () => {
    expect(LOT).toEqual({ defaut: 1_000, min: 100, max: 5_000 });
    expect(tailleLot(undefined)).toBe(1_000);
    expect(tailleLot(null)).toBe(1_000);
    expect(tailleLot(100)).toBe(100);
    expect(tailleLot("5000")).toBe(5_000);
    for (const mauvais of [0, 1, 99, 5_001, 50_000, 1.5, "beaucoup", -100]) {
      expect(() => tailleLot(mauvais)).toThrowError(/entre 100 et 5000/);
    }
  });
});

describe("P8.2 — `all` n'est pas une application", () => {
  it("nomme les formes refusées", () => {
    expect([...APP_INTERDITES]).toEqual(["all", "*", "tous", "toutes"]);
  });
});

describe("P8.2 — empreinte de plan", () => {
  const plan = {
    kind: "event-index",
    app: "boutique",
    from: "2026-09-01T00:00:00Z",
    to: "2026-09-02T00:00:00Z",
    taille_lot: 1_000,
    cutoffs: { rum_pageview: { ordre: "id", borne_haute: "42" }, _taille_lot: 1_000 },
    code_sha: "a".repeat(64),
    schema_sha: "b".repeat(64),
  };

  it("ne dépend PAS de l'ordre des clés — `jsonb` les range à sa façon", () => {
    const relu = {
      ...plan,
      // Ce que PostgreSQL rend après un aller-retour en jsonb : mêmes valeurs,
      // autre ordre. L'empreinte doit être la même, sinon aucune reprise ne
      // serait jamais possible.
      cutoffs: { _taille_lot: 1_000, rum_pageview: { borne_haute: "42", ordre: "id" } },
    };
    expect(empreintePlan(relu)).toBe(empreintePlan(plan));
  });

  it("change dès que le périmètre, les bornes, le code ou le schéma changent", () => {
    const reference = empreintePlan(plan);
    expect(empreintePlan({ ...plan, app: "autre" })).not.toBe(reference);
    expect(empreintePlan({ ...plan, from: "2026-09-01T00:00:01Z" })).not.toBe(reference);
    expect(empreintePlan({ ...plan, taille_lot: 500 })).not.toBe(reference);
    expect(empreintePlan({ ...plan, code_sha: "c".repeat(64) })).not.toBe(reference);
    expect(empreintePlan({ ...plan, schema_sha: "c".repeat(64) })).not.toBe(reference);
    expect(empreintePlan({ ...plan, cutoffs: { ...plan.cutoffs, rum_pageview: { ordre: "id", borne_haute: "43" } } }))
      .not.toBe(reference);
  });

  it("ne dépend PAS des comptes ni des durées : ils bougent à chaque relevé", () => {
    const reference = empreintePlan(plan);
    expect(empreintePlan({ ...plan, comptes: { eligibles: 12 }, charge: { lots_estimes: 3 } })).toBe(reference);
  });
});

describe("P8.2 — empreinte de code", () => {
  it("couvre les modules de reprise ET les normalisateurs réutilisés", () => {
    expect(empreinteCode()).toMatch(/^[0-9a-f]{64}$/);
    expect(empreinteCode()).toBe(empreinteCode());
    for (const rel of FICHIERS_CODE) {
      expect(existsSync(join(RACINE, "apps", "ingest", rel))).toBe(true);
    }
    // Les normalisateurs SONT dans l'empreinte : leur évolution change la règle
    // de reconstruction, donc doit interdire une reprise à mi-fenêtre.
    expect(FICHIERS_CODE).toContain("supabase/functions/_shared/otlp.mjs");
    expect(FICHIERS_CODE).toContain("supabase/functions/_shared/dimensions.mjs");
    expect(FICHIERS_CODE).toContain("supabase/functions/_shared/error-normalize.mjs");
  });

  it("contient le module de CHAQUE `kind` — un oubli rendrait l'empreinte aveugle", () => {
    for (const nom of Object.keys(KINDS)) {
      expect(FICHIERS_CODE).toContain(`lib/backfills/${nom.replace("error-groups", "error-groups")}.mjs`);
    }
    expect(FICHIERS_CODE).toContain("lib/backfills/planner.mjs");
    expect(FICHIERS_CODE).toContain("lib/backfills/runner.mjs");
  });
});

describe("P8.2 — contrat des quatre reconstructions", () => {
  it("les quatre besoins de §3 sont couverts, et seulement eux", () => {
    expect(Object.keys(KINDS)).toEqual(["event-index", "rollups", "dimensions", "error-groups"]);
  });

  for (const [nom, kind] of Object.entries(KINDS) as [string, Record<string, unknown>][]) {
    it(`${nom} : expose ses sources, ses cibles, sa clé unique et ses impossibilités`, () => {
      expect(kind.nom).toBe(nom);
      expect((kind.sources as unknown[]).length).toBeGreaterThan(0);
      for (const s of kind.sources as { table: string; ordre: string; ts: string }[]) {
        expect(s.table).toMatch(/^[a-z_]+$/);
        expect(s.ordre).toBeTruthy();
        expect(s.ts).toBeTruthy();
      }
      expect((kind.cibles as string[]).length).toBeGreaterThan(0);
      expect(kind.cleUnique).toBeTruthy();
      for (const m of ["segments", "bornes", "comptes", "collisions", "lire", "ecrire", "verifier"]) {
        expect(typeof kind[m]).toBe("function");
      }
      // Ce qu'on ne saura PAS reconstruire est nommé, avec sa raison.
      expect((kind.impossible as { quoi: string; raison: string }[]).length).toBeGreaterThan(0);
      for (const i of kind.impossible as { quoi: string; raison: string }[]) {
        expect(i.quoi.length).toBeGreaterThan(10);
        expect(i.raison.length).toBeGreaterThan(20);
      }
    });

    it(`${nom} : ses segments sont PURS — une reprise doit retrouver la même liste`, () => {
      const plan = { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" };
      const a = (kind.segments as (p: unknown) => { nom: string }[])(plan);
      const b = (kind.segments as (p: unknown) => { nom: string }[])(plan);
      expect(a.map((s) => s.nom)).toEqual(b.map((s) => s.nom));
      expect(a.length).toBeGreaterThan(0);
    });
  }
});

describe("P8.2 — progression des phases", () => {
  const segments = [{ nom: "a" }, { nom: "b" }];

  it("parcourt tous les segments, PUIS réconcilie, PUIS s'arrête", () => {
    expect(avancer({ segments, phase: "fenetre", i: 0 })).toEqual({ phase: "fenetre", i: 1, curseur: null });
    // Dernier segment de la fenêtre : on passe à la réconciliation, pas à la fin.
    expect(avancer({ segments, phase: "fenetre", i: 1 })).toEqual({ phase: "reconciliation", i: 0, curseur: null });
    expect(avancer({ segments, phase: "reconciliation", i: 0 })).toEqual({ phase: "reconciliation", i: 1, curseur: null });
    expect(avancer({ segments, phase: "reconciliation", i: 1 }))
      .toEqual({ phase: "reconciliation", i: 1, curseur: null, termine: true });
  });

  it("la réconciliation n'est pas facultative : un segment unique y passe aussi", () => {
    const un = [{ nom: "seul" }];
    expect(avancer({ segments: un, phase: "fenetre", i: 0 })).toEqual({ phase: "reconciliation", i: 0, curseur: null });
    expect(avancer({ segments: un, phase: "reconciliation", i: 0 }))
      .toEqual({ phase: "reconciliation", i: 0, curseur: null, termine: true });
  });

  it("les cinq états de §3 sont ceux du journal", () => {
    expect([...ETATS]).toEqual(["planned", "running", "paused", "completed", "failed"]);
  });
});

describe("P8.2 — un échec ne devient jamais un succès, et ne fuit rien", () => {
  it("rend un CODE borné, jamais un message PostgreSQL", () => {
    expect(codeErreur(new ErreurBackfill("plan_modifie", "…"))).toBe("plan_modifie");
    expect(codeErreur(Object.assign(new Error("x"), { code: "23505" }))).toBe("sqlstate_23505");
    expect(codeErreur(Object.assign(new Error("x"), { code: "55P03" }))).toBe("sqlstate_55p03");
    expect(codeErreur(Object.assign(new Error("verrou"), { name: "ErreurVerrouIngestion" })))
      .toBe("verrou_ingestion_indisponible");
    expect(codeErreur(Object.assign(new Error("portée"), { name: "ErreurPorteeApp" }))).toBe("portee_app");
    // Un message qui citerait la valeur d'une ligne ne passe pas la frontière.
    const fuite = new Error("duplicate key value violates … (session_id)=(s-alice-42)");
    expect(codeErreur(fuite)).toBe("erreur_inattendue");
    // Et le code produit tient dans la contrainte de la colonne.
    for (const err of [fuite, new ErreurBackfill("code_modifie", ""), Object.assign(new Error(""), { code: "XX000" })]) {
      expect(codeErreur(err)).toMatch(/^[a-z][a-z0-9_]{0,59}$/);
    }
  });
});

describe("P8.2 — compteurs de skip", () => {
  it("additionne par raison sans en perdre aucune", () => {
    const cumul = {};
    fusionnerSkips(cumul, { span_id_invalide: 2, hors_retention: 1 });
    fusionnerSkips(cumul, { span_id_invalide: 3 });
    fusionnerSkips(cumul, undefined);
    expect(cumul).toEqual({ span_id_invalide: 5, hors_retention: 1 });
    expect(totalSkips(cumul)).toBe(6);
    expect(totalSkips(undefined)).toBe(0);
  });
});

describe("P8.2 — percentiles historiques : la moyenne de p75 est interdite", () => {
  const base = {
    gamma: 1.02,
    plancher: 0.001,
    population: "core_vitals_sans_robots_pondere_v80",
    seaux: new Map([[3, 10], [7, 4]]),
  };

  it("refuse de fusionner des frontières ou des populations différentes", () => {
    expect(fusionHistogrammesPossible(base, { ...base, gamma: 1.05 }))
      .toEqual({ possible: false, raison: "pas_geometrique_different" });
    expect(fusionHistogrammesPossible(base, { ...base, plancher: 0.01 }))
      .toEqual({ possible: false, raison: "plancher_different" });
    expect(fusionHistogrammesPossible(base, { ...base, population: "avec_robots" }))
      .toEqual({ possible: false, raison: "population_differente" });
    expect(fusionHistogrammesPossible(base, null)).toEqual({ possible: false, raison: "histogramme_absent" });
    expect(fusionHistogrammesPossible(base, { ...base })).toEqual({ possible: true, raison: null });
  });

  it("fusionne en ADDITIONNANT des effectifs, jamais en moyennant des percentiles", () => {
    const autre = { ...base, seaux: new Map([[3, 5], [9, 1]]) };
    const sortie = fusionnerHistogrammes([base, autre]) as { possible: true; seaux: Map<number, number> };
    expect(sortie.possible).toBe(true);
    // Les effectifs s'additionnent seau par seau : le percentile de la somme est
    // EXACT, là où une moyenne de p75 n'aurait aucune définition.
    expect([...sortie.seaux.entries()].sort((a, b) => a[0] - b[0])).toEqual([[3, 15], [7, 4], [9, 1]]);
  });

  it("déclare l'opération IMPOSSIBLE plutôt que de l'approcher", () => {
    expect(fusionnerHistogrammes([base, { ...base, population: "brut" }]))
      .toEqual({ possible: false, raison: "population_differente" });
    expect(fusionnerHistogrammes([])).toEqual({ possible: false, raison: "aucun_histogramme" });
    expect(fusionnerHistogrammes(null)).toEqual({ possible: false, raison: "aucun_histogramme" });
  });
});

describe("P8.2 — note héritée d'un groupe scindé", () => {
  it("annonce qu'elle décrit le GROUPE, pas l'issue", () => {
    const entete = ENTETE_HERITEE("empreinte-large", 3);
    expect(entete).toContain("hérité du groupe historique empreinte-large");
    expect(entete).toContain("scindé en 3 issues");
    expect(entete).toContain("cette note décrit le groupe, pas cette issue en particulier");
    expect(entete.endsWith("\n")).toBe(true);
  });
});

describe("P8.2 — carte de correspondance", () => {
  it("borne son échantillon et ce qu'elle rend", () => {
    expect(ECHANTILLON_CARTE_MAX).toBe(20_000);
    expect(CARTE_RENDUE_MAX).toBe(200);
  });
});

describe("P8.2 — interface en ligne de commande", () => {
  it("lit `--clé valeur` et refuse tout le reste", () => {
    expect(analyserArgs(["--app", "boutique", "--from", "2026-09-01T00:00:00Z"], ["app", "from"]))
      .toEqual({ app: "boutique", from: "2026-09-01T00:00:00Z" });
    expect(() => analyserArgs(["--inconnu", "x"], ["app"])).toThrowError(/option inconnue/);
    expect(() => analyserArgs(["boutique"], ["app"])).toThrowError(/argument inattendu/);
    // Une option sans valeur ne prend pas silencieusement l'option suivante.
    expect(() => analyserArgs(["--app", "--from", "x"], ["app", "from"])).toThrowError(/attend une valeur/);
    expect(() => analyserArgs(["--app"], ["app"])).toThrowError(/attend une valeur/);
  });

  it("dit POURQUOI une option est obligatoire", () => {
    expect(exiger({ app: "boutique" }, "app", "…")).toBe("boutique");
    expect(() => exiger({}, "app", "une reprise s'applique à UNE application"))
      .toThrowError(/--app est obligatoire : une reprise s'applique à UNE application/);
  });
});

describe("P8.2 — rétention", () => {
  it("le défaut n'est utilisé QUE si le registre ne dit rien", () => {
    // La valeur existe pour refléter `purge_rum_tenants`, pas pour être écrite
    // en dur dans une fenêtre : le plan lit `app_registry.retention_days`
    // d'abord, et le test SQL le vérifie sur une vraie base.
    expect(RETENTION_DEFAUT_JOURS).toBe(30);
  });
});
