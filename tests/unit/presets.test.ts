// Vues préréglées (F08, plan § 3.6, § 3.2, P13) : nommage « • », vue indisponible
// motivée, « Mobile » ne pose que `device`, choix des releases comparées (CP3).
import { describe, expect, it } from "vitest";
import {
  PARAMS_DE_VUE,
  RAISON_MOINS_DE_DEUX_RELEASES,
  choisirReleases,
  conditionsDeLUrl,
  facette,
  hrefDeVue,
  nommerVue,
  verifierParams,
  vueActuelle,
  vueCorrespond,
  vuesPersonnelles,
  vuesProduit,
  type EntreesVuesProduit,
} from "../../apps/console/lib/presets";
import { SANS_RELEASE } from "../../apps/console/lib/queries-deploys";

const V = (version: string, sessions: number) => ({ version, sessions });

const ENTREES: EntreesVuesProduit = {
  releases: { valeur: choisirReleases([{ version: "1.4.2" }, { version: "1.4.1" }], [V("1.4.1", 900), V("1.4.2", 300)]) },
  navigateurs: {
    valeur: [
      { valeur: "Chrome", lcp_p75: 2400, lcp_n: 3000 },
      { valeur: "Safari", lcp_p75: 2900, lcp_n: 400 },
      { valeur: "Samsung Internet", lcp_p75: 6000, lcp_n: 12 },
    ],
  },
  pays: { valeur: [{ valeur: "BE", volume: 10 }, { valeur: "FR", volume: 300 }, { valeur: null, volume: 999 }] },
};

const vue = (id: string, entrees = ENTREES) => vuesProduit(entrees).find((v) => v.id === id)!;

describe("nommage des vues", () => {
  it("joint les facettes par « • » et ignore les vides", () => {
    expect(nommerVue(["Mobile", "Chrome", "/checkout"])).toBe("Mobile • Chrome • /checkout");
    expect(nommerVue(["Mobile", null, " ", undefined, "FR"])).toBe("Mobile • FR");
  });

  it("une égalité se nomme par sa valeur, une exclusion par sa dimension", () => {
    expect(facette({ dimension: "device", operator: "eq", value: "mobile" })).toBe("Mobile");
    expect(facette({ dimension: "browser", operator: "neq", value: "Chrome" })).toBe("Navigateur ≠ Chrome");
    expect(facette({ dimension: "country", operator: "is_null", value: null })).toBe("Pays estimé inconnu");
  });

  it("la vue actuelle reprend paramètres dédiés et segment, nommée par ses facettes", () => {
    const sp = new URLSearchParams("period=7d&device=mobile&browser=Chrome&seg=v2:route:eq:%2Fcheckout");
    const actuelle = vueActuelle(sp)!;
    expect(actuelle.nom).toBe("Mobile • Chrome • /checkout");
    expect(actuelle.seg).toBe("v2:device:eq:mobile;browser:eq:Chrome;route:eq:%2Fcheckout");
  });

  it("rien à enregistrer sans condition, ni sous un segment illisible", () => {
    expect(vueActuelle(new URLSearchParams("period=7d"))).toBeNull();
    expect(conditionsDeLUrl(new URLSearchParams("seg=v2:inconnue:eq:x"))).toBeNull();
  });
});

describe("vues produit", () => {
  it("« Mobile » ne pose que device", () => {
    expect(vue("p:mobile").params).toEqual({ device: "mobile" });
    expect(vue("p:desktop").params).toEqual({ device: "desktop" });
  });

  it("appliquer « Mobile » ne modifie que device dans l'URL", () => {
    const courants = new URLSearchParams("app=demo&period=7d&device=desktop&browser=Chrome&seg=v2:country:eq:FR&cmp=release&tri=volume");
    const href = hrefDeVue("/pages", courants, vue("p:mobile"));
    const apres = new URL(href, "http://x").searchParams;
    const avant = Object.fromEntries(courants);
    expect(Object.fromEntries(apres)).toEqual({ ...avant, device: "mobile" });
  });

  it("la pagination part avec le changement de population", () => {
    const href = hrefDeVue("/sessions", new URLSearchParams("period=24h&cursor=abc"), vue("p:mobile"));
    expect(href).toBe("/sessions?period=24h&device=mobile");
  });

  it("aucune vue ne pose un paramètre hors du contrat (+ cmp)", () => {
    for (const v of vuesProduit({ ...ENTREES, extension: { segActuel: null } })) {
      for (const cle of Object.keys(v.params)) expect(PARAMS_DE_VUE).toContain(cle);
    }
    expect(() => verifierParams({ tri: "volume" })).toThrow(/hors du contrat/);
    expect(() => hrefDeVue("/", new URLSearchParams(), { params: { vue: "p:mobile" } })).toThrow();
  });

  it("dernière release et comparaison suivent la règle du § 3.2", () => {
    expect(vue("p:derniere-release").params).toEqual({ release: "1.4.2", cmp: null, rel_a: null, rel_b: null });
    expect(vue("p:derniere-release").libelle).toBe("Dernière release • 1.4.2");
    expect(vue("p:release-vs-precedente").params).toEqual({ cmp: "release", release: null, rel_a: "1.4.1", rel_b: "1.4.2" });
  });

  it("« Dernière release » puis « Nouvelle release vs précédente » : le filtre release part, le couple choisi est écrit", () => {
    const depart = new URLSearchParams("period=7d&device=mobile");
    const apresDerniere = new URL(hrefDeVue("/", depart, vue("p:derniere-release")), "http://x").searchParams;
    expect(Object.fromEntries(apresDerniere)).toEqual({ period: "7d", device: "mobile", release: "1.4.2" });
    const apresComparaison = new URL(hrefDeVue("/", apresDerniere, vue("p:release-vs-precedente")), "http://x").searchParams;
    expect(Object.fromEntries(apresComparaison)).toEqual({
      period: "7d",
      device: "mobile",
      cmp: "release",
      rel_a: "1.4.1",
      rel_b: "1.4.2",
    });
    expect(vueCorrespond(apresComparaison, vue("p:release-vs-precedente"))).toBe(true);
    expect(vueCorrespond(apresComparaison, vue("p:derniere-release"))).toBe(false);
  });

  it("« Nouvelle release vs précédente » puis « Dernière release » : la comparaison part, couple hérité compris", () => {
    // Un lien d'annotation avait posé un autre couple : la vue l'écrase, puis « Dernière release » le retire.
    const depart = new URLSearchParams("period=24h&cmp=release&rel_a=1.3.9&rel_b=1.4.1");
    const apresComparaison = new URL(hrefDeVue("/", depart, vue("p:release-vs-precedente")), "http://x").searchParams;
    expect(apresComparaison.get("rel_a")).toBe("1.4.1");
    expect(apresComparaison.get("rel_b")).toBe("1.4.2");
    const apresDerniere = new URL(hrefDeVue("/", apresComparaison, vue("p:derniere-release")), "http://x").searchParams;
    expect(Object.fromEntries(apresDerniere)).toEqual({ period: "24h", release: "1.4.2" });
    expect(vueCorrespond(apresDerniere, vue("p:derniere-release"))).toBe(true);
  });

  it("une vue incalculable est affichée désactivée avec sa raison", () => {
    const seule = vuesProduit({
      releases: { valeur: choisirReleases([], [V("1.4.1", 900)]) },
      navigateurs: { valeur: [{ valeur: "Firefox", lcp_p75: 5000, lcp_n: 29 }] },
      pays: { indisponible: "lecture des pays en échec" },
    });
    const par = (id: string) => seule.find((v) => v.id === id)!;
    expect(par("p:release-vs-precedente").indisponible).toBe(RAISON_MOINS_DE_DEUX_RELEASES);
    expect(par("p:release-vs-precedente").params).toEqual({});
    expect(par("p:pire-navigateur").indisponible).toMatch(/au moins 30 mesures LCP/);
    expect(par("p:premier-pays").indisponible).toBe("lecture des pays en échec");
    // Une seule release : « Dernière release » reste calculable.
    expect(par("p:derniere-release").indisponible).toBeUndefined();
    const sansRelease = vuesProduit({ ...ENTREES, releases: { indisponible: "colonne release absente" } });
    expect(sansRelease.find((v) => v.id === "p:derniere-release")!.indisponible).toBe("colonne release absente");
  });

  it("pire navigateur : gravité LCP parmi les navigateurs mesurés au moins 30 fois", () => {
    expect(vue("p:pire-navigateur").params).toEqual({ browser: "Safari" });
  });

  it("premier pays estimé en volume, jamais l'inconnu", () => {
    expect(vue("p:premier-pays").params).toEqual({ country: "FR" });
    expect(vue("p:premier-pays").libelle).toBe("Pays estimé : FR");
  });

  it("« Capteur extension » ajoute sa condition au segment courant", () => {
    const v = vue("p:extension", { ...ENTREES, extension: { segActuel: "v2:country:eq:FR" } });
    expect(v.params).toEqual({ seg: "v2:country:eq:FR;source:eq:extension" });
    expect(vuesProduit(ENTREES).some((x) => x.id === "p:extension")).toBe(false);
  });

  it("la vue active est celle dont l'URL porte exactement les paramètres", () => {
    expect(vueCorrespond(new URLSearchParams("period=7d&device=mobile"), vue("p:mobile"))).toBe(true);
    expect(vueCorrespond(new URLSearchParams("period=7d&device=tablet"), vue("p:mobile"))).toBe(false);
    expect(vueCorrespond(new URLSearchParams("period=7d"), vue("p:mobile"))).toBe(false);
  });
});

describe("vues personnelles", () => {
  it("posent leur segment et retirent les paramètres dédiés", () => {
    const [v] = vuesPersonnelles([{ name: "Mobile • FR", seg: "v2:device:eq:mobile;country:eq:FR" }]);
    expect(v.id).toBe("u:0");
    expect(v.origine).toBe("personnelle");
    const href = hrefDeVue("/", new URLSearchParams("period=7d&device=mobile&country=FR"), v);
    expect(Object.fromEntries(new URL(href, "http://x").searchParams)).toEqual({
      period: "7d",
      seg: "v2:device:eq:mobile;country:eq:FR",
    });
  });
});

describe("choisirReleases (§ 3.2, CP3)", () => {
  it("B = dernier déploiement déclaré, A = déploiement précédent, même si le volume dit l'inverse", () => {
    const choix = choisirReleases(
      [{ version: "1.4.2" }, { version: "1.4.2" }, { version: "1.4.1" }],
      [V("1.4.1", 5000), V("1.4.2", 200), V("1.3.9", 100)],
    );
    expect(choix).toMatchObject({ relB: "1.4.2", relA: "1.4.1" });
    expect(choix.regle).toBe("1.4.2 : dernier déploiement déclaré ; 1.4.1 : déploiement précédent");
    expect(choix.indisponible).toBeUndefined();
  });

  it("dernier marqueur absent des releases lues → release de plus grand volume, et la règle le dit", () => {
    const choix = choisirReleases([{ version: "2.0.0" }, { version: "1.4.2" }], [V("1.4.1", 5000), V("1.4.2", 200)]);
    expect(choix).toMatchObject({ relB: "1.4.1", relA: "1.4.2" });
    // La liste lue est plafonnée (12 releases les plus vues, F13) : « aucune mesure »
    // n'est pas établi — la release peut être simplement hors de ces 12.
    expect(choix.regle).toMatch(
      /1.4.1 : release de plus grand volume \(le dernier déploiement déclaré, 2.0.0, n'est pas parmi les releases lues sur la fenêtre : aucune mesure, ou hors des releases les plus vues\)/,
    );
  });

  it("sans marqueur précédent mesuré → deuxième par volume", () => {
    const choix = choisirReleases([{ version: "1.4.2" }, { version: "0.9" }], [V("1.4.1", 5000), V("1.4.2", 200), V("1.3.9", 50)]);
    expect(choix).toMatchObject({ relB: "1.4.2", relA: "1.4.1" });
  });

  it("aucun déploiement → les deux premières par volume", () => {
    expect(choisirReleases([], [V("b", 10), V("a", 30)])).toMatchObject({ relB: "a", relA: "b" });
  });

  it("« (non renseignée) » n'est jamais une release ; moins de deux → comparaison indisponible", () => {
    const choix = choisirReleases([{ version: null }], [V(SANS_RELEASE, 9000), V("1.4.1", 10)]);
    expect(choix).toMatchObject({ relB: "1.4.1", relA: null, indisponible: RAISON_MOINS_DE_DEUX_RELEASES });
    expect(choisirReleases([], [])).toMatchObject({ relB: null, relA: null });
  });
});
