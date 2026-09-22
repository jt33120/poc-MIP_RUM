// Analyses de départ de l'Explorer (F31, W-E1) — logique pure.
//
// Ce que ces tests tiennent :
//   · chaque modèle est un plan que le registre ACCEPTE — le même `parseExplorerPlan`
//     que l'URL, l'API et les tableaux de bord : un modèle ne peut pas promettre
//     une mesure que le formulaire refuserait ;
//   · un lien de modèle ouvre l'Explorer EXÉCUTÉ, population et plage conservées ;
//   · un modèle inapplicable (dimension non collectée, filtre sans objet pour son
//     jeu) est rendu désactivé AVEC sa raison, jamais masqué.
import { describe, expect, it } from "vitest";
import { parseExplorerPlan } from "../../apps/console/lib/analytics-schema";
import { MODELES_EXPLORER, modelesDeDepart } from "../../apps/console/lib/explorer-modeles";
import { SERIES_MAX, explorerDemande, explorerSource } from "../../apps/console/lib/explorer-page-params";
import { parseAnalyticsQuery, type AnalyticsQuery } from "../../apps/console/lib/query-contract";
import { schemaComplet, schemaSans } from "../fixtures/dimension-schema";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

function requete(qs: string): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal: { role: "admin", apps: null }, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

const paramsDe = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

describe("les six analyses de départ du § 5.21.4", () => {
  it("six modèles, clés uniques, titres et questions écrits", () => {
    expect(MODELES_EXPLORER).toHaveLength(6);
    expect(new Set(MODELES_EXPLORER.map((m) => m.cle)).size).toBe(6);
    for (const m of MODELES_EXPLORER) {
      expect(m.titre.length, m.cle).toBeGreaterThan(0);
      expect(m.question.endsWith("?"), m.cle).toBe(true);
    }
  });

  it("chaque plan passe parseExplorerPlan, enregistré (sans fenêtre) comme exécuté sur une fenêtre", () => {
    const query = requete("app=demo&period=7d");
    for (const m of MODELES_EXPLORER) {
      const source = { ...m.plan, cursor: undefined };
      const enregistre = parseExplorerPlan(source, null);
      expect(enregistre.ok, `${m.cle} : ${enregistre.ok ? "" : enregistre.error.message}`).toBe(true);
      const execute = parseExplorerPlan(source, query);
      expect(execute.ok, m.cle).toBe(true);
      // Le registre ne réécrit rien : le plan validé EST le modèle.
      if (execute.ok) expect(execute.value).toEqual({ ...m.plan, cursor: null });
    }
  });

  it("une série temporelle reste dans les options du formulaire (P14 : 5 séries au plus)", () => {
    for (const m of MODELES_EXPLORER.filter((x) => x.plan.visualization === "timeseries")) {
      expect(m.plan.limit, m.cle).toBeLessThanOrEqual(SERIES_MAX);
    }
  });

  it("les occurrences d'erreurs sont une SOMME (V1), jamais un compte de lignes", () => {
    const erreurs = MODELES_EXPLORER.find((m) => m.plan.dataset === "errors");
    expect(erreurs?.plan.measure).toEqual({ field: "occurrences", aggregation: "sum" });
  });
});

describe("liens des modèles", () => {
  it("chaque lien exécute (`run=1`) le plan du modèle, population et plage conservées", () => {
    const query = requete("app=demo&period=7d&device=mobile&browser=Firefox");
    const modeles = modelesDeDepart(query, schemaComplet());
    expect(modeles).toHaveLength(6);
    for (const [i, m] of modeles.entries()) {
      expect(m.href, m.cle).not.toBeNull();
      expect(m.href!.startsWith("/explorer?"), m.cle).toBe(true);
      const sp = paramsDe(m.href!);
      expect(explorerDemande(sp), m.cle).toBe(true);
      expect(sp.get("app")).toBe("demo");
      expect(sp.get("period")).toBe("7d");
      expect(sp.get("device")).toBe("mobile");
      expect(sp.get("browser")).toBe("Firefox");
      expect(sp.has("cursor")).toBe(false);
      // L'URL rejoue exactement le plan du modèle.
      const rejeu = parseExplorerPlan(explorerSource(sp), query);
      expect(rejeu.ok && rejeu.value, m.cle).toEqual({ ...MODELES_EXPLORER[i].plan, cursor: null });
    }
  });

  it("les paramètres de vue (`cmp`) suivent le lien", () => {
    const [premier] = modelesDeDepart(requete("app=demo"), schemaComplet(), { cmp: "prev" });
    expect(paramsDe(premier.href!).get("cmp")).toBe("prev");
  });
});

describe("un modèle inapplicable est montré désactivé, avec sa raison", () => {
  it("dimension de regroupement non collectée : lien retiré, raison de dimensionSupport", () => {
    // Console publiée avant la collecte du navigateur (P6.1).
    const modeles = modelesDeDepart(requete("app=demo"), schemaSans("rum_session.browser"));
    const inp = modeles.find((m) => m.cle === "inp-par-navigateur")!;
    expect(inp.href).toBeNull();
    expect(inp.raison).toContain("Navigateur");
    expect(inp.raison).toContain("pas encore collecté");
    // Les autres restent ouvrables : un défaut local n'éteint pas l'écran.
    expect(modeles.filter((m) => m.href !== null)).toHaveLength(5);
  });

  it("filtre actif sans objet pour le jeu du modèle : désactivé, et la raison nomme le filtre", () => {
    // `service` n'existe que sur les erreurs et les appels tracés.
    const modeles = modelesDeDepart(requete("app=demo&service=api"), schemaComplet());
    const erreurs = modeles.find((m) => m.cle === "erreurs-dans-le-temps")!;
    expect(erreurs.href).not.toBeNull();
    expect(paramsDe(erreurs.href!).get("service")).toBe("api");
    for (const m of modeles.filter((x) => x.cle !== "erreurs-dans-le-temps")) {
      expect(m.href, m.cle).toBeNull();
      expect(m.raison, m.cle).toContain("filtre actif");
      expect(m.raison, m.cle).toContain("Service");
    }
  });

  it("une release filtrée n'a pas de sens pour les sessions (instantané par occurrence) : seul ce modèle s'éteint", () => {
    const modeles = modelesDeDepart(requete("app=demo&release=1.4.2"), schemaComplet());
    const sessions = modeles.find((m) => m.cle === "sessions-par-appareil")!;
    expect(sessions.href).toBeNull();
    expect(sessions.raison).toContain("Release");
    expect(modeles.filter((m) => m.href !== null)).toHaveLength(5);
  });
});
