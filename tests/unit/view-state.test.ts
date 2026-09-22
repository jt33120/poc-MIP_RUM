// F06 — état de vue porté par l'URL (plan § 3.1).
//
// Ce que ces tests verrouillent :
//   · chaque paramètre de vue fait l'aller-retour écriture → URL → lecture ;
//   · une valeur illisible est IGNORÉE et SIGNALÉE, jamais refusée : elle ne touche
//     aucun chiffre ;
//   · `tri=impact` reste ignoré tant que le classement par impact n'est pas lu (B2) ;
//   · les paramètres de vue ne changent pas `queryFingerprint` — la population et le
//     cache d'une requête n'en dépendent pas ;
//   · seule la comparaison suit la navigation (`contextHref`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_PARAMS, parseAnalyticsQuery, queryFingerprint } from "../../apps/console/lib/query-contract";
import {
  ECRANS_PAR_PARAMETRE,
  NATURES_CHRONOLOGIE,
  TRIS_PAR_ECRAN,
  VIEW_CONTEXT_PARAMS,
  comparaisonParDefaut,
  contextHref,
  ecrireEtatDeVue,
  ignores,
  lireComparaison,
  lireEtatDeVue,
  lireTri,
  type EtatDeVue,
} from "../../apps/console/lib/view-state";

/** Écrit un état partiel comme le ferait un lien, puis le relit. */
function allerRetour(pathname: string, etat: Partial<EtatDeVue>) {
  const sp = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(ecrireEtatDeVue(pathname, etat))) if (valeur !== null) sp.set(cle, valeur);
  // Passage par une vraie chaîne d'URL : l'encodage de `panel`, `appel` ou d'une
  // release à caractères spéciaux doit survivre à la sérialisation du navigateur.
  const relu = new URLSearchParams(sp.toString());
  return { qs: sp.toString(), ...lireEtatDeVue(pathname, relu) };
}

describe("aller-retour de chaque paramètre de vue", () => {
  it("cmp, rel_a, rel_b", () => {
    const r = allerRetour("/", { cmp: "release", relA: "1.4.1 (build : 7)", relB: "1.4.2&x=1" });
    expect(r.etat).toMatchObject({ cmp: "release", relA: "1.4.1 (build : 7)", relB: "1.4.2&x=1" });
    expect(r.ignores).toEqual([]);
    expect(allerRetour("/", { cmp: "none" }).etat.cmp).toBe("none");
    expect(allerRetour("/sessions", { cmp: "prev" }).etat.cmp).toBe("prev");
  });

  it("cmp choisi s'écrit toujours, même égal au défaut de l'écran courant", () => {
    // `cmp` suit la navigation, et les défauts DIFFÈRENT d'un écran à l'autre : élidé
    // au défaut de l'écran courant, le choix se perdait sur l'écran suivant.
    expect(ecrireEtatDeVue("/", { cmp: "prev" })).toEqual({ cmp: "prev", rel_a: null, rel_b: null });
    expect(ecrireEtatDeVue("/sessions", { cmp: "none" }).cmp).toBe("none");
  });

  it("cmp survit au changement d'écran quand il vaut le défaut du seul écran quitté", () => {
    const naviguer = (depuis: string, qs: string, cmp: EtatDeVue["cmp"], vers: string) => {
      const sp = new URLSearchParams(qs);
      for (const [cle, valeur] of Object.entries(ecrireEtatDeVue(depuis, { cmp }))) {
        if (valeur === null) sp.delete(cle);
        else sp.set(cle, valeur);
      }
      const href = contextHref(vers, sp);
      return lireComparaison(vers, new URLSearchParams(href.split("?")[1] ?? "")).valeur.mode;
    };
    // /sessions?cmp=prev → « Aucune » → / : reste « Aucune » (et non le `prev` de /).
    expect(naviguer("/sessions", "cmp=prev", "none", "/")).toBe("none");
    // / → « Période précédente » → /sessions : reste `prev` (et non le `none` de /sessions).
    expect(naviguer("/", "cmp=none", "prev", "/sessions")).toBe("prev");
  });

  it("le défaut de l'écran ne s'écrit pas (réglages propres à l'écran)", () => {
    expect(ecrireEtatDeVue("/", { tri: "gravite" }).tri).toBeNull();
    expect(ecrireEtatDeVue("/pages", { vital: "LCP" }).vital).toBeNull();
    expect(ecrireEtatDeVue("/sessions/abc", { voir: [...NATURES_CHRONOLOGIE] }).voir).toBeNull();
  });

  it("quitter le mode release retire les releases", () => {
    expect(ecrireEtatDeVue("/", { cmp: "none", relA: "1.0", relB: "2.0" })).toEqual({ cmp: "none", rel_a: null, rel_b: null });
  });

  it("tri et vital", () => {
    expect(allerRetour("/", { tri: "volume" }).etat.tri).toBe("volume");
    expect(allerRetour("/errors", { tri: "sessions" }).etat.tri).toBe("sessions");
    expect(allerRetour("/pages", { vital: "INP" }).etat.vital).toBe("INP");
  });

  it("panel : chaque forme, identifiants encodés", () => {
    const panneaux: EtatDeVue["panel"][] = [
      { type: "route", id: "/checkout/:id?x=1&y=é" },
      { type: "error", id: "fp:abc:123" },
      { type: "session", id: "s-42" },
      { type: "noeud", cote: "back", route: "/api/panier" },
      { type: "noeud", cote: "front", route: "/a:b" },
    ];
    for (const panel of panneaux) {
      const r = allerRetour("/pages", { panel });
      expect(r.etat.panel).toEqual(panel);
      expect(r.ignores).toEqual([]);
    }
  });

  it("vue, evt, règle, appel", () => {
    expect(allerRetour("/", { vue: { origine: "produit", cle: "mobile" } }).etat.vue).toEqual({ origine: "produit", cle: "mobile" });
    expect(allerRetour("/", { vue: { origine: "personnelle", index: 3 } }).etat.vue).toEqual({ origine: "personnelle", index: 3 });
    expect(allerRetour("/alerts", { evt: 42 }).etat.evt).toBe(42);
    const regle = { metrique: "event:checkout", route: "/pay", seuil: 2.5 };
    expect(allerRetour("/alerts", { regle }).etat.regle).toEqual(regle);
    const appel = { methode: "GET", chemin: "/api/panier?id=1" };
    const r = allerRetour("/tracing", { appel });
    expect(r.etat.appel).toEqual(appel);
    expect(r.qs).toContain("appel=GET+%2Fapi%2Fpanier%3Fid%3D1");
  });

  it("avec, voir, depuis, type, nouveaux, statut", () => {
    expect(allerRetour("/sessions", { avec: "rejeu" }).etat.avec).toBe("rejeu");
    expect(allerRetour("/sessions/abc", { voir: ["erreur", "vue"] }).etat.voir).toEqual(["vue", "erreur"]);
    expect(allerRetour("/paths", { depuis: "/produits" }).etat.depuis).toBe("/produits");
    expect(allerRetour("/ux", { type: "dead" }).etat.type).toBe("dead");
    expect(allerRetour("/errors", { nouveaux: true }).etat.nouveaux).toBe(true);
    expect(allerRetour("/errors", { statut: "regressed" }).etat.statut).toBe("regressed");
  });

  it("défauts d'un écran sans aucun paramètre", () => {
    const { etat, ignores: lignes } = lireEtatDeVue("/", new URLSearchParams());
    expect(etat).toMatchObject({ cmp: "prev", tri: "gravite", vital: "LCP", panel: null, vue: null, nouveaux: false });
    expect(lireEtatDeVue("/sessions/abc", new URLSearchParams()).etat.voir).toEqual([...NATURES_CHRONOLOGIE]);
    expect(lignes).toEqual([]);
  });
});

describe("paramètre illisible → ignoré et signalé", () => {
  const cas: [string, string, string][] = [
    ["/", "cmp=hier", "cmp=hier"],
    ["/", "tri=alphabetique", "tri=alphabetique"],
    ["/", "vital=FID", "vital=FID"],
    ["/", "panel=ville:Paris", "panel=ville:Paris"],
    ["/", "panel=noeud:milieu:%2Fx", "panel=noeud:milieu:/x"],
    ["/", "vue=z:1", "vue=z:1"],
    ["/alerts", "evt=abc", "evt=abc"],
    ["/alerts", "evt=0", "evt=0"],
    ["/alerts", "regle_seuil=beaucoup", "regle_seuil=beaucoup"],
    ["/alerts", "regle_metrique=drop%20table", "regle_metrique=drop table"],
    ["/tracing", "appel=get%20%2Fx", "appel=get /x"],
    ["/tracing", "appel=GET%20https%3A%2F%2Fex.com%2Fx", "appel=GET https://ex.com/x"],
    ["/sessions", "avec=tout", "avec=tout"],
    ["/sessions/abc", "voir=vue,photo", "voir=vue,photo"],
    ["/ux", "type=colere", "type=colere"],
    ["/errors", "nouveaux=oui", "nouveaux=oui"],
    ["/errors", "statut=closed", "statut=closed"],
  ];
  it.each(cas)("%s?%s", (pathname, qs, cite) => {
    const { etat, ignores: lignes } = lireEtatDeVue(pathname, new URLSearchParams(qs));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain(`Réglage d'affichage ignoré : ${cite}`);
    // Et l'écran retombe sur son défaut, pas sur la valeur illisible.
    const defaut = lireEtatDeVue(pathname, new URLSearchParams()).etat;
    expect(etat).toEqual(defaut);
  });

  it("une valeur interminable est citée tronquée", () => {
    const [ligne] = ignores("/", new URLSearchParams({ cmp: "x".repeat(300) }));
    expect(ligne.length).toBeLessThan(200);
    expect(ligne).toContain("…");
  });

  it("un réglage d'un autre écran est signalé, jamais appliqué", () => {
    const { etat, ignores: lignes } = lireEtatDeVue("/", new URLSearchParams("evt=3&statut=open"));
    expect(etat.evt).toBeNull();
    expect(etat.statut).toBeNull();
    expect(lignes.join("\n")).toContain("ne s'applique pas à cet écran");
    expect(lireEtatDeVue("/sessions", new URLSearchParams("vital=INP")).etat.vital).toBeNull();
  });

  it("deux releases identiques ne se comparent pas", () => {
    const { valeur, ignores: lignes } = lireComparaison("/", new URLSearchParams("cmp=release&rel_a=1.0&rel_b=1.0"));
    expect(valeur).toEqual({ mode: "release", relA: null, relB: null });
    expect(lignes[0]).toContain("même release");
  });

  it("des releases hors du mode release ne sont ni lues ni signalées", () => {
    const { valeur, ignores: lignes } = lireComparaison("/", new URLSearchParams("rel_a=1.0&rel_b=2.0"));
    expect(valeur).toEqual({ mode: "prev", relA: null, relB: null });
    expect(lignes).toEqual([]);
  });
});

describe("tri par écran (TRIS_PAR_ECRAN)", () => {
  it("tri=impact avant B2 : ignoré, signalé, défaut de l'écran", () => {
    for (const pathname of ["/", "/pages"]) {
      const lu = lireTri(pathname, new URLSearchParams("tri=impact"));
      expect(lu.tri).toBe("gravite");
      expect(lu.ignore).toContain("tri=impact");
      expect(lu.ignore).toContain("impact");
    }
  });

  it("une valeur n'est acceptée que si l'écran la déclare", () => {
    expect(lireTri("/errors", new URLSearchParams("tri=volume"))).toMatchObject({ tri: "statut" });
    expect(lireTri("/errors", new URLSearchParams("tri=volume")).ignore).toContain("statut, sessions, recent");
    expect(lireTri("/errors", new URLSearchParams("tri=recent"))).toEqual({ tri: "recent", ignore: null });
    expect(lireTri("/ux", new URLSearchParams("tri=impact")).ignore).toContain("gravite, volume");
    expect(lireTri("/sessions", new URLSearchParams("tri=volume")).ignore).toContain("ne propose pas de tri");
  });

  it("chaque écran déclare un défaut qu'il accepte", () => {
    for (const [ecran, { valeurs, defaut }] of Object.entries(TRIS_PAR_ECRAN)) {
      expect(valeurs as readonly string[], ecran).toContain(defaut);
      expect(lireTri(ecran, new URLSearchParams())).toEqual({ tri: defaut, ignore: null });
    }
  });
});

describe("comparaison par défaut", () => {
  it("période précédente sur Performance, aucune ailleurs", () => {
    for (const p of ["/", "/pages", "/errors", "/errors/abc123", "/errors/issues/42", "/ux", "/actions", "/experience", "/mobile"]) {
      expect(comparaisonParDefaut(p), p).toBe("prev");
    }
    for (const p of ["/sessions", "/explorer", "/events", "/tracing", "/correlation", "/slo", "/pagesx"]) {
      expect(comparaisonParDefaut(p), p).toBe("none");
    }
  });
});

describe("contextHref : la comparaison suit la navigation, pas les réglages d'écran", () => {
  it("garde le contrat et cmp / rel_a / rel_b, laisse le reste derrière", () => {
    const sp = new URLSearchParams(
      "app=demo&period=7d&device=mobile&seg=v2:browser:is_null&cmp=release&rel_a=1.0&rel_b=2.0&tri=volume&panel=route:%2Fx&cursor=abc&hours=business",
    );
    const href = contextHref("/pages", sp);
    const [chemin, qs] = href.split("?");
    const lu = new URLSearchParams(qs);
    expect(chemin).toBe("/pages");
    expect(Object.fromEntries(lu)).toEqual({
      app: "demo",
      period: "7d",
      device: "mobile",
      seg: "v2:browser:is_null",
      cmp: "release",
      rel_a: "1.0",
      rel_b: "2.0",
    });
  });

  it("sans contexte : le chemin nu", () => {
    expect(contextHref("/sessions", new URLSearchParams("tri=volume"))).toBe("/sessions");
  });

  it("reporte tels quels, répétitions comprises (l'écran d'arrivée refuse)", () => {
    const href = contextHref("/", new URLSearchParams("device=mobile&device=desktop&cmp=hier"));
    expect(new URLSearchParams(href.split("?")[1]).getAll("device")).toEqual(["mobile", "desktop"]);
    expect(href).toContain("cmp=hier");
  });
});

describe("les paramètres de vue ne touchent pas la requête commune", () => {
  const TOUS =
    "cmp=release&rel_a=1.0&rel_b=2.0&tri=volume&vital=INP&panel=route:%2Fcheckout&vue=p:mobile&evt=12" +
    "&regle_metrique=LCP&regle_route=%2Fpay&regle_seuil=2500&appel=GET%20%2Fapi&avec=rejeu&voir=vue&depuis=%2F" +
    "&type=rage&nouveaux=1&statut=open";
  const base = "app=demo&from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z&device=mobile&browser=Firefox";
  const principal = { role: "admin" as const, apps: null };
  const nowMs = Date.parse("2026-09-10T00:00:00Z");

  it("queryFingerprint inchangé, en exact comme en glissant", () => {
    const sans = parseAnalyticsQuery(new URLSearchParams(base), { principal, nowMs });
    const avec = parseAnalyticsQuery(new URLSearchParams(`${base}&${TOUS}`), { principal, nowMs });
    expect(sans.ok && avec.ok).toBe(true);
    if (!sans.ok || !avec.ok) return;
    expect(avec.value).toEqual(sans.value);
    expect(queryFingerprint(avec.value)).toBe(queryFingerprint(sans.value));
    expect(queryFingerprint(avec.value, "sliding")).toBe(queryFingerprint(sans.value, "sliding"));
  });

  it("un paramètre de vue illisible n'est jamais une erreur de contrat", () => {
    const r = parseAnalyticsQuery(new URLSearchParams(`${base}&cmp=hier&tri=%00&evt=abc&cmp=none`), { principal, nowMs });
    expect(r.ok).toBe(true);
  });

  it("aucun paramètre de vue n'est un paramètre du contrat", () => {
    for (const nom of Object.keys(ECRANS_PAR_PARAMETRE)) expect(CONTRACT_PARAMS as readonly string[]).not.toContain(nom);
    for (const nom of VIEW_CONTEXT_PARAMS) expect(ECRANS_PAR_PARAMETRE[nom]).toBe("tous");
  });
});

describe("module client-sûr", () => {
  it("n'importe que du code sans accès base (il est chargé par la barre de filtres et la navigation)", () => {
    const src = readFileSync(join(__dirname, "../../apps/console/lib/view-state.ts"), "utf8");
    const imports = [...src.matchAll(/^import .* from "(.+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./query-contract", "./rating"]);
  });
});

describe("gabaritZoom (revue de vague 3)", () => {
  it("un zoom ne change que la plage : comparaison, releases, tri, découpage et heures ouvrées restent", async () => {
    const { gabaritZoom } = await import("@/lib/view-state");
    const href = gabaritZoom("/?app=demo&from=%7Bfrom%7D&to=%7Bto%7D", {
      app: "demo",
      period: "24h",
      cmp: "release",
      rel_a: "1.4.1",
      rel_b: "1.4.2",
      tri: "volume",
      dim: "browser",
      hours: "business",
      cursor: "abc",
      panel: "route:/x",
    });
    const u = new URL(href, "http://x");
    expect(u.pathname).toBe("/");
    expect(u.searchParams.get("from")).toBe("{from}");
    expect(u.searchParams.has("period")).toBe(false);
    for (const [k, v] of [["cmp", "release"], ["rel_a", "1.4.1"], ["rel_b", "1.4.2"], ["tri", "volume"], ["dim", "browser"], ["hours", "business"]]) {
      expect(u.searchParams.get(k)).toBe(v);
    }
    expect(u.searchParams.has("cursor")).toBe(false);
    expect(u.searchParams.has("panel")).toBe(false);
    expect(u.searchParams.getAll("app")).toEqual(["demo"]);
  });
});
