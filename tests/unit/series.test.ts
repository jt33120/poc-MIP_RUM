// lib/series.ts (F04, plan § 3.10, § 4.4) : la grille des seaux. Un seau absent est un
// trou (mesure) ou un 0 (compte), jamais une valeur inventée ; une ligne hors grille
// est ignorée ET comptée ; les jours et les heures se lisent dans le bon fuseau.
import { describe, expect, it } from "vitest";
import {
  alignerSeaux,
  alignerSeauxDetail,
  estJour,
  formaterAxe,
  grilleIso,
  hrefZoom,
  instantDe,
  jourDans,
  joursLocaux,
  libelleSeau,
  libelleSeauComplet,
  placerAnnotations,
  type Annotation,
} from "@/lib/series";

const H = 3_600_000;
const H0 = Date.parse("2026-09-22T10:00:00Z");
const STARTS = [H0, H0 + H, H0 + 2 * H];
/** Espaces insécables (fines ou non) → espace ordinaire, pour comparer des textes. */
const txt = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("alignerSeaux — la grille commande", () => {
  it("un seau absent → null (mesure : un trou, jamais une valeur)", () => {
    const rows = [
      { bucket: "2026-09-22T10:00:00.000Z", p75: 2100 },
      { bucket: "2026-09-22T12:00:00.000Z", p75: 2900 },
    ];
    const seaux = alignerSeaux(rows, STARTS, false);
    expect(seaux).toHaveLength(3);
    expect(seaux[0]?.p75).toBe(2100);
    expect(seaux[1]).toBeNull();
    expect(seaux[2]?.p75).toBe(2900);
  });

  it("additif → le seau absent vaut 0 pour chaque champ de compte, avec son début de seau", () => {
    const rows = [
      { bucket: "2026-09-22T10:00:00Z", pageviews: 40, errors: 3 },
      { bucket: "2026-09-22T12:00:00Z", pageviews: 12, errors: 0 },
    ];
    const seaux = alignerSeaux(rows, STARTS, true);
    expect(seaux[1]).toEqual({ bucket: "2026-09-22T11:00:00Z", pageviews: 0, errors: 0 });
    expect(seaux[0]?.pageviews).toBe(40);
  });

  it("additif sans aucune ligne : aucun champ connu, les seaux restent null", () => {
    expect(alignerSeaux([], STARTS, true)).toEqual([null, null, null]);
  });

  it("une ligne hors grille est ignorée et comptée ; un doublon aussi", () => {
    const rows = [
      { bucket: "2026-09-22T10:00:00Z", n: 1 },
      { bucket: "2026-09-22T10:30:00Z", n: 2 }, // pas un début de seau
      { bucket: "2026-09-22T09:00:00Z", n: 3 }, // avant la fenêtre
      { bucket: "2026-09-22T10:00:00Z", n: 4 }, // doublon
    ];
    const { seaux, ignorees } = alignerSeauxDetail(rows, STARTS, false);
    expect(seaux.map((s) => s?.n ?? null)).toEqual([1, null, null]);
    expect(ignorees).toBe(3);
  });

  it("un `Date` rendu par node-postgres se rapproche comme son instant", () => {
    const rows = [{ bucket: new Date(H0 + H) as unknown as string, p75: 1800 }];
    expect(alignerSeaux(rows, STARTS, false)[1]?.p75).toBe(1800);
  });

  it("les jours « AAAA-MM-JJ » s'alignent sur leur propre grille", () => {
    const jours = ["2026-09-20", "2026-09-21", "2026-09-22"];
    const seaux = alignerSeaux([{ bucket: "2026-09-22", p75: 2500 }], jours.map(instantDe), false);
    expect(seaux).toEqual([null, null, { bucket: "2026-09-22", p75: 2500 }]);
  });
});

describe("grille et jours", () => {
  it("grilleIso : ISO UTC sans millisecondes, accepté tel quel par le contrat", () => {
    expect(grilleIso([H0])).toEqual(["2026-09-22T10:00:00Z"]);
  });

  it("estJour distingue une clé de jour d'un instant", () => {
    expect(estJour("2026-09-22")).toBe(true);
    expect(estJour("2026-09-22T10:00:00Z")).toBe(false);
  });

  it("joursLocaux : les n jours qui finissent AUJOURD'HUI dans le fuseau de l'app", () => {
    // 21/09 22:30 UTC = 22/09 00:30 à Paris (été).
    const maintenant = Date.parse("2026-09-21T22:30:00Z");
    expect(joursLocaux(3, "Europe/Paris", maintenant)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(joursLocaux(3, "UTC", maintenant)).toEqual(["2026-09-19", "2026-09-20", "2026-09-21"]);
    expect(jourDans(maintenant, "America/New_York")).toBe("2026-09-21");
  });

  it("joursLocaux traverse les fins de mois", () => {
    expect(joursLocaux(3, "UTC", Date.parse("2026-10-01T08:00:00Z"))).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
  });
});

describe("libellés d'axe et d'infobulle", () => {
  it("heure du seau dans le fuseau d'affichage", () => {
    expect(libelleSeau("2026-09-22T14:00:00Z", 3600, "UTC")).toBe("14:00");
    expect(libelleSeau("2026-09-22T14:00:00Z", 3600, "Europe/Paris")).toBe("16:00");
    expect(libelleSeau("2026-09-22T00:00:00Z", 3600, "UTC")).toBe("00:00");
  });

  it("seau de 6 h : date et heure ; seau d'un jour : la date", () => {
    expect(txt(libelleSeau("2026-09-22T12:00:00Z", 21_600, "UTC"))).toBe("22/09 12:00");
    expect(libelleSeau("2026-09-22T00:00:00Z", 86_400, "UTC")).toBe("22/09");
  });

  it("une clé de jour s'écrit telle quelle, sans conversion de fuseau", () => {
    expect(libelleSeau("2026-09-10", 86_400, "America/Los_Angeles")).toBe("10/09");
    expect(libelleSeauComplet("2026-09-10", 86_400, "America/Los_Angeles")).toBe("10/09");
  });

  it("infobulle : début → fin et fuseau", () => {
    expect(txt(libelleSeauComplet("2026-09-22T14:00:00Z", 3600, "UTC"))).toBe("22/09 14:00 → 15:00 UTC");
    expect(txt(libelleSeauComplet("2026-09-22T18:00:00Z", 21_600, "UTC"))).toBe("22/09 18:00 → 23/09 00:00 UTC");
  });

  it("graduation courte : pas de « pour 100 » ni de « % » d'un ratio ; milliers compactés", () => {
    expect(formaterAxe("pour100", 150)).toBe("150");
    expect(txt(formaterAxe("count", 12_345))).toBe("12,3 k");
    expect(txt(formaterAxe("count", 1240))).toBe("1 240");
    expect(txt(formaterAxe("ms", 2500))).toBe("2,5 s");
  });
});

describe("hrefZoom — clic sur un seau", () => {
  it("remplace {from} et {to} par les bornes du seau, ISO UTC sans millisecondes", () => {
    const href = hrefZoom("/?app=a&from={from}&to={to}", "2026-09-22T10:00:00Z", 3600);
    expect(href).toBe("/?app=a&from=2026-09-22T10%3A00%3A00Z&to=2026-09-22T11%3A00%3A00Z");
  });

  it("accepte les gabarits encodés par URLSearchParams", () => {
    const p = new URLSearchParams({ from: "{from}", to: "{to}" });
    const href = hrefZoom(`/?${p}`, "2026-09-22T10:00:00Z", 3600);
    expect(href).toBe("/?from=2026-09-22T10%3A00%3A00Z&to=2026-09-22T11%3A00%3A00Z");
  });

  it("le seau en cours s'arrête à la minute passée (un `to` futur est refusé par le contrat)", () => {
    const maintenant = Date.parse("2026-09-22T10:37:42Z");
    expect(hrefZoom("/?from={from}&to={to}", "2026-09-22T10:00:00Z", 3600, maintenant)).toContain("to=2026-09-22T10%3A37%3A00Z");
  });

  it("aucun zoom sur un seau vide de temps, ni sur une grille de jours (bornes calculées au serveur)", () => {
    expect(hrefZoom("/?from={from}&to={to}", "2026-09-22T10:00:00Z", 3600, Date.parse("2026-09-22T10:00:30Z"))).toBeNull();
    expect(hrefZoom("/?from={from}&to={to}", "2026-09-22", 86_400)).toBeNull();
  });
});

describe("placerAnnotations", () => {
  const grille = grilleIso(STARTS);
  const a = (t: string, libelle = "v1"): Annotation => ({ t, libelle, type: "deploiement" });

  it("dans le seau qui contient l'instant, à sa fraction", () => {
    const [p] = placerAnnotations([a("2026-09-22T11:15:00Z")], grille, 3600, "UTC");
    expect(p.index).toBe(1);
    expect(p.fraction).toBeCloseTo(0.25);
  });

  it("hors de la fenêtre : écartée, jamais posée au bord", () => {
    expect(placerAnnotations([a("2026-09-22T09:59:00Z"), a("2026-09-22T13:00:00Z")], grille, 3600, "UTC")).toEqual([]);
  });

  it("grille de jours : le jour et l'heure du fuseau d'affichage", () => {
    // 21/09 23:30 UTC = 22/09 01:30 à Paris.
    const [p] = placerAnnotations([a("2026-09-21T23:30:00Z")], ["2026-09-21", "2026-09-22"], 86_400, "Europe/Paris");
    expect(p.index).toBe(1);
    expect(p.fraction).toBeCloseTo(90 / 1440);
  });
});
