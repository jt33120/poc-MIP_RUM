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
  LIMITES,
  SERIES_MAX,
  explorerDatasetHref,
  explorerDemande,
  explorerHref,
  explorerOngletHref,
  explorerPlanParams,
  explorerResetHref,
  explorerResume,
  explorerSource,
  libelleCle,
  limitePour,
  mesureDefaut,
  mesuresDe,
  pastillesRequete,
  representationDemandee,
} from "../../apps/console/lib/explorer-page-params";
import {
  encodeExplorerCursor,
  explorerFingerprint,
  parseExplorerPlan,
  type ExplorerPlan,
} from "../../apps/console/lib/analytics-schema";
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

// ─────────────── F31 : pastilles de la requête appliquée (QueryPills) ───────────────

/** Paramètres d'un lien interne de l'Explorer. */
const paramsDe = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

describe("F31 — chaque pastille retirable rend la même analyse SANS elle", () => {
  it("retirer une condition : l'URL la perd, garde tout le reste, et ne porte aucun curseur", () => {
    const qs = "app=demo&period=7d&release=1.4.2&browser=Firefox&dataset=errors&measure=occurrences:sum&viz=table&limit=25&run=1";
    const query = requete(qs);
    const sansCurseur = plan(qs, query);
    // Un journal PAGINÉ : le plan porte un curseur valide pour cette requête.
    const curseur = encodeExplorerCursor({
      fingerprint: explorerFingerprint(query, sansCurseur),
      ts: "2026-09-17T11:00:00.000Z",
      key: "42",
    });
    const pagine = plan(`${qs}&cursor=${curseur}`, query);
    expect(pagine.cursor).not.toBeNull();

    const pastilles = pastillesRequete(query, pagine);
    const release = pastilles.find((p) => p.libelle === "Release = 1.4.2");
    expect(release?.retirerHref).toBeTruthy();
    const sp = paramsDe(release!.retirerHref!);
    expect(sp.has("release")).toBe(false);
    expect(sp.has("cursor")).toBe(false);
    // Le reste de la requête survit : autre condition, fenêtre, app, plan, exécution.
    expect(sp.get("browser")).toBe("Firefox");
    expect(sp.get("period")).toBe("7d");
    expect(sp.get("app")).toBe("demo");
    expect(sp.get("measure")).toBe("occurrences:sum");
    expect(sp.get("viz")).toBe("table");
    expect(sp.get("run")).toBe("1");
    // Aucune pastille ne propose un lien avec curseur.
    for (const p of pastilles) if (p.retirerHref) expect(p.retirerHref, p.cle).not.toContain("cursor=");
  });

  it("une condition de segment est retirée de `seg` à son rang, les autres restent", () => {
    const qs = "app=demo&seg=v2:browser:is_null;os:neq:Windows&dataset=views&measure=rows:count&viz=value&run=1";
    const query = requete(qs);
    const pastilles = pastillesRequete(query, plan(qs, query));
    const inconnu = pastilles.find((p) => p.libelle === "Navigateur inconnu");
    const windows = pastilles.find((p) => p.libelle === "Système ≠ Windows");
    expect(paramsDe(inconnu!.retirerHref!).get("seg")).toBe("v2:os:neq:Windows");
    expect(paramsDe(windows!.retirerHref!).get("seg")).toBe("v2:browser:is_null");
  });

  it("retirer un regroupement garde l'autre ; retirer l'appareil ne touche pas au reste", () => {
    const qs = "app=demo&device=mobile&dataset=errors&measure=occurrences:sum&viz=toplist&g0=route&g1=release&limit=10&run=1";
    const query = requete(qs);
    const pastilles = pastillesRequete(query, plan(qs, query));
    const route = pastilles.find((p) => p.cle === "groupe-route");
    expect(route?.libelle).toBe("Groupé par route");
    const sp = paramsDe(route!.retirerHref!);
    expect(sp.get("g0")).toBe("release");
    expect(sp.has("g1")).toBe(false);
    const appareil = pastilles.find((p) => p.libelle === "Appareil = mobile");
    const sansAppareil = paramsDe(appareil!.retirerHref!);
    expect(sansAppareil.has("device")).toBe(false);
    expect(sansAppareil.get("g0")).toBe("route");
  });

  it("jeu, mesure et variante obligatoire ne se retirent pas, et disent pourquoi", () => {
    const qs = "app=demo&dataset=vitals&variant=LCP&measure=value:p75&viz=value&run=1";
    const query = requete(qs);
    const pastilles = pastillesRequete(query, plan(qs, query));
    for (const cle of ["jeu", "mesure", "variante"]) {
      const p = pastilles.find((x) => x.cle === cle);
      expect(p, cle).toBeDefined();
      expect(p!.retirerHref, cle).toBeNull();
      expect(p!.raison, cle).toBeTruthy();
    }
    expect(pastilles.find((p) => p.cle === "variante")!.libelle).toBe("Métrique : LCP");
    expect(pastilles.find((p) => p.cle === "mesure")!.libelle).toBe("p75 — Valeur");
  });

  it("une variante facultative se retire ; une variante imposée par la mesure ne se retire pas", () => {
    const facultative = "app=demo&dataset=longtasks&variant=loaf&measure=blocking_ms:p95&viz=value&run=1";
    const q1 = requete(facultative);
    const loaf = pastillesRequete(q1, plan(facultative, q1)).find((p) => p.cle === "variante");
    expect(paramsDe(loaf!.retirerHref!).has("variant")).toBe(false);

    const imposee = "app=demo&dataset=custom_events&measure=timing_ms:p95&viz=value&run=1";
    const q2 = requete(imposee);
    const timing = pastillesRequete(q2, plan(imposee, q2)).find((p) => p.cle === "variante");
    expect(timing!.retirerHref).toBeNull();
    expect(timing!.raison).toContain("timing");
  });

  it("robots et apps internes : inclus → retirables ; exclus par défaut → dit, non retirable", () => {
    const inclus = "app=demo&bots=1&internal=1&dataset=views&measure=rows:count&viz=value&run=1";
    const q1 = requete(inclus);
    const p1 = pastillesRequete(q1, plan(inclus, q1));
    expect(paramsDe(p1.find((p) => p.cle === "robots")!.retirerHref!).has("bots")).toBe(false);
    expect(paramsDe(p1.find((p) => p.cle === "internes")!.retirerHref!).has("internal")).toBe(false);

    const defaut = "app=demo&dataset=views&measure=rows:count&viz=value&run=1";
    const q2 = requete(defaut);
    const p2 = pastillesRequete(q2, plan(defaut, q2));
    expect(p2.find((p) => p.cle === "robots")).toMatchObject({ libelle: "Robots exclus", retirerHref: null });
    expect(p2.find((p) => p.cle === "internes")).toBeUndefined();
  });

  it("les paramètres de vue (`cmp`) suivent le retrait d'une pastille", () => {
    const qs = "app=demo&route=/panier&dataset=views&measure=rows:count&viz=value&run=1";
    const query = requete(qs);
    const route = pastillesRequete(query, plan(qs, query), { cmp: "prev" }).find((p) => p.libelle === "Route = /panier");
    expect(paramsDe(route!.retirerHref!).get("cmp")).toBe("prev");
  });
});

// ─────────────── F31 : onglets de représentation ───────────────

describe("F31 — un onglet relit la même requête sous une autre forme", () => {
  it("garde population, jeu, mesure et regroupements ; change `viz` ; garde `run` ; perd le curseur", () => {
    const qs = "app=demo&period=7d&browser=Firefox&dataset=errors&measure=occurrences:sum&viz=table&g0=route&limit=25&run=1&cursor=abc";
    const sp = paramsDe(explorerOngletHref(requete(qs), new URLSearchParams(qs), "toplist"));
    expect(sp.get("viz")).toBe("toplist");
    expect(sp.get("browser")).toBe("Firefox");
    expect(sp.get("period")).toBe("7d");
    expect(sp.get("dataset")).toBe("errors");
    expect(sp.get("measure")).toBe("occurrences:sum");
    expect(sp.get("g0")).toBe("route");
    expect(sp.get("run")).toBe("1");
    expect(sp.has("cursor")).toBe(false);
  });

  it("sans exécution, un onglet n'exécute toujours pas", () => {
    const qs = "app=demo&dataset=views&measure=rows:count&viz=value";
    const sp = paramsDe(explorerOngletHref(requete(qs), new URLSearchParams(qs), "timeseries"));
    expect(sp.get("viz")).toBe("timeseries");
    expect(explorerDemande(sp)).toBe(false);
  });

  it("jamais une requête refusée au changement d'onglet : la limite suit la représentation", () => {
    const qs = "app=demo&dataset=errors&measure=occurrences:sum&viz=toplist&g0=route&limit=20&run=1";
    const query = requete(qs);
    const lire = new URLSearchParams(qs);
    // 20 groupes en classement → 5 séries au plus (P14), jamais 20 courbes.
    expect(paramsDe(explorerOngletHref(query, lire, "timeseries")).get("limit")).toBe(String(SERIES_MAX));
    // Une limite proposée par la cible est gardée.
    const cinq = new URLSearchParams(qs.replace("limit=20", "limit=5"));
    expect(paramsDe(explorerOngletHref(query, cinq, "timeseries")).get("limit")).toBe("5");
    // Chaque onglet produit un plan que le registre accepte.
    for (const viz of ["value", "toplist", "timeseries", "table"] as const) {
      const cible = paramsDe(explorerOngletHref(query, lire, viz));
      const parsed = parseExplorerPlan(explorerSource(cible), query);
      expect(parsed.ok, viz).toBe(true);
      if (parsed.ok && viz === "timeseries") expect(parsed.value.limit).toBeLessThanOrEqual(SERIES_MAX);
    }
  });

  it("limitePour : la courante si la représentation la propose, sinon son défaut", () => {
    expect(limitePour("toplist", 20)).toBe(20);
    expect(limitePour("toplist", 3)).toBe(10);
    expect(limitePour("timeseries", 10)).toBe(SERIES_MAX);
    expect(limitePour("table", 10)).toBe(50);
    expect(limitePour("table", null)).toBe(50);
    expect(LIMITES.timeseries).toEqual([1, 3, 5]);
  });

  it("une représentation illisible dans l'URL se lit « Valeur », jamais une autre forme", () => {
    expect(representationDemandee(new URLSearchParams("viz=toplist"))).toBe("toplist");
    expect(representationDemandee(new URLSearchParams("viz=camembert"))).toBe("value");
    expect(representationDemandee(new URLSearchParams(""))).toBe("value");
  });
});
