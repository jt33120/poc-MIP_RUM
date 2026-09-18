// Paramètres d'URL de l'écran `/explorer` (P6.4) — logique pure.
//
// Trois exigences de l'écran se vérifient ici, sans navigateur :
//   · le curseur n'est PAS un champ du formulaire, donc toute modification le
//     laisse derrière elle ;
//   · le résumé affiché décrit ce qui est RÉELLEMENT appliqué, y compris quand
//     aucune condition ne l'est ;
//   · une URL partagée rejoue la même requête.
import { describe, expect, it } from "vitest";
import {
  EXPLORER_PARAMS,
  explorerDatasetHref,
  explorerDemande,
  explorerHref,
  explorerPlanParams,
  explorerResetHref,
  explorerResume,
  explorerSource,
  libelleCle,
  mesureDefaut,
  mesuresDe,
} from "../../apps/console/lib/explorer-page-params";
import { parseExplorerPlan, type ExplorerPlan } from "../../apps/console/lib/analytics-schema";
import { parseAnalyticsQuery, type AnalyticsQuery, type ScopePrincipal } from "../../apps/console/lib/query-contract";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

function requete(qs: string, principal: ScopePrincipal = ADMIN): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

function plan(qs: string, query: AnalyticsQuery = requete(qs)): ExplorerPlan {
  const parsed = parseExplorerPlan(explorerSource(new URLSearchParams(qs)), query);
  if (!parsed.ok) throw new Error(`${parsed.error.code} : ${parsed.error.message}`);
  return parsed.value;
}

describe("le curseur n'appartient pas au formulaire", () => {
  it("les champs du plan écrits dans l'URL ne contiennent jamais de curseur", () => {
    const p = plan("app=demo&dataset=errors&measure=occurrences:sum&viz=toplist&g0=release&limit=10");
    expect(Object.keys(explorerPlanParams(p))).not.toContain("cursor");
    // C'est ce qui remet la pagination à zéro : un formulaire soumis ne réécrit
    // que ses propres champs, et `cursor` n'en est pas un.
    expect(EXPLORER_PARAMS).toContain("cursor");
  });

  it("un lien vers l'Explorer retire le curseur, sauf la page suivante qui le pose", () => {
    const query = requete("app=demo");
    const p = plan("app=demo&dataset=views&measure=rows:count&viz=table&limit=25", query);
    expect(explorerHref(query, p)).not.toContain("cursor=");
    expect(explorerHref(query, p, { cursor: "abc" })).toContain("cursor=abc");
  });

  it("changer de jeu de données redémarre le builder : aucun plan, donc aucune exécution", () => {
    const query = requete("app=demo&period=7d&browser=Firefox");
    const href = explorerDatasetHref(query, "vitals");
    const sp = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(sp.get("dataset")).toBe("vitals");
    // Ni mesure héritée du jeu précédent, ni exécution automatique.
    expect(sp.get("measure")).toBeNull();
    expect(explorerDemande(sp)).toBe(false);
    // Les filtres globaux, eux, suivent.
    expect(sp.get("browser")).toBe("Firefox");
    expect(sp.get("period")).toBe("7d");
  });

  it("réinitialiser garde les filtres globaux et rien du builder", () => {
    const href = explorerResetHref(requete("app=demo&period=7d&os=Windows"));
    expect(href.startsWith("/explorer?")).toBe(true);
    for (const champ of ["dataset", "measure", "viz", "g0", "run", "cursor"]) {
      expect(href, champ).not.toContain(`${champ}=`);
    }
    expect(href).toContain("os=Windows");
  });
});

describe("rien ne part sans « Exécuter »", () => {
  it("l'exécution est demandée explicitement", () => {
    expect(explorerDemande(new URLSearchParams(""))).toBe(false);
    expect(explorerDemande(new URLSearchParams("run=0"))).toBe(false);
    expect(explorerDemande(new URLSearchParams("run=1"))).toBe(true);
  });
});

describe("mesures proposées", () => {
  it("une entrée par couple champ × agrégation déclaré, et la première fait le défaut", () => {
    const mesures = mesuresDe("errors");
    expect(mesures.map((m) => m.valeur)).toContain("occurrences:sum");
    expect(mesures.map((m) => m.valeur)).toContain("visitors:distinct");
    expect(mesures.every((m) => m.libelle.includes("—"))).toBe(true);
    expect(mesureDefaut("errors")).toBe(mesures[0].valeur);
  });

  it("une URL sans mesure prend le défaut du jeu, pas celui d'un autre", () => {
    const source = explorerSource(new URLSearchParams("dataset=vitals"));
    expect(source.measure).toMatchObject({ field: "rows", aggregation: "count" });
  });

  it("une limite illisible reste illisible : elle sera refusée, pas rabattue", () => {
    const source = explorerSource(new URLSearchParams("dataset=views&limit=abc"));
    expect(Number.isNaN(source.limit as number)).toBe(true);
  });
});

describe("résumé français de ce qui est RÉELLEMENT appliqué", () => {
  it("énonce mesure, fenêtre, périmètre, conditions, robots et regroupement", () => {
    const qs = "app=demo&period=7d&browser=Firefox&device=mobile&dataset=errors&measure=occurrences:sum&viz=toplist&g0=release&limit=10";
    const query = requete(qs);
    const resume = explorerResume(query, plan(qs, query), "7 j");
    expect(resume).toContain("Somme — occurrences sur erreurs");
    expect(resume).toContain("fenêtre 7 j");
    expect(resume).toContain("application demo");
    expect(resume).toContain("Navigateur = Firefox");
    expect(resume).toContain("Appareil = mobile");
    expect(resume).toContain("robots exclus");
    expect(resume).toContain("groupé par release");
    expect(resume.endsWith(".")).toBe(true);
  });

  it("dit qu'il n'y a AUCUN filtre plutôt que de laisser croire à un filtrage muet", () => {
    const qs = "app=demo&dataset=views&measure=rows:count";
    expect(explorerResume(requete(qs), plan(qs), "24 h")).toContain("aucun filtre de dimension");
  });

  it("annonce les robots et les apps internes quand ils sont inclus", () => {
    const qs = "app=demo&bots=1&internal=1&dataset=views&measure=rows:count";
    const resume = explorerResume(requete(qs), plan(qs), "24 h");
    expect(resume).toContain("robots inclus");
    expect(resume).toContain("applications internes incluses");
  });

  it("nomme la sous-population choisie et « Inconnu » plutôt qu'un vide", () => {
    const qs = "app=demo&dataset=vitals&variant=LCP&measure=value:p75&seg=v2:release:is_null";
    const resume = explorerResume(requete(qs), plan(qs), "24 h");
    expect(resume).toContain("métrique LCP");
    expect(resume).toContain("Release inconnu");
    expect(libelleCle([null, "Firefox"])).toBe("Inconnu · Firefox");
    expect(libelleCle([])).toBe("Ensemble de la population");
  });

  it("dit « toutes les applications autorisées » quand aucune app n'est nommée", () => {
    const qs = "dataset=views&measure=rows:count";
    expect(explorerResume(requete(qs), plan(qs), "24 h")).toContain("toutes les applications autorisées");
  });
});

describe("une URL partagée rejoue la même requête", () => {
  it("l'aller-retour URL → plan → URL est stable", () => {
    const qs = "app=demo&period=7d&dataset=custom_events&variant=timing&measure=timing_ms:p95&viz=timeseries&g0=route&g1=release&limit=5&run=1";
    const query = requete(qs);
    const depart = plan(qs, query);
    const href = explorerHref(query, depart);
    const rejeu = plan(href.slice(href.indexOf("?") + 1), query);
    expect(rejeu).toEqual(depart);
  });
});
