// Acquisition — classification de canal + agrégat. Logique pure.
import { describe, expect, it } from "vitest";
import { acquisitionReport, classifyChannel, hostOf } from "../../apps/console/lib/acquisition";
import { serieCanaux, TOP_ENTREES } from "../../apps/console/lib/acquisition";
import {
  CHANNELS,
  LIBELLE_CANAL,
  TOP_REFERENTS,
  lignesCanaux,
  partDuTotal,
  partHorsDirect,
  referentsTronques,
} from "../../apps/console/lib/acquisition";

describe("hostOf", () => {
  it("normalise (minuscule, sans www), null si illisible", () => {
    expect(hostOf("https://WWW.Example.com/x?a=1")).toBe("example.com");
    expect(hostOf("http://sub.site.fr")).toBe("sub.site.fr");
    expect(hostOf("pas une url")).toBeNull();
    expect(hostOf(null)).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("classifyChannel", () => {
  const self = "https://app.mip.fr/page";
  it("direct si pas de referrer", () => {
    expect(classifyChannel(null, self)).toBe("direct");
    expect(classifyChannel("", self)).toBe("direct");
  });
  it("interne si même hôte", () => {
    expect(classifyChannel("https://app.mip.fr/autre", self)).toBe("internal");
    expect(classifyChannel("https://www.app.mip.fr/autre", self)).toBe("internal");
  });
  it("recherche / social / referral selon l'hôte", () => {
    expect(classifyChannel("https://www.google.com/search", self)).toBe("search");
    expect(classifyChannel("https://t.co/abc", self)).toBe("social");
    expect(classifyChannel("https://linkedin.com/feed", self)).toBe("social");
    expect(classifyChannel("https://blog.partenaire.fr/article", self)).toBe("referral");
  });
});

describe("acquisitionReport", () => {
  it("répartit par canal + top référents externes", () => {
    const entries = [
      { referrer: null, url: "https://s.fr/a" }, // direct
      { referrer: "https://s.fr/x", url: "https://s.fr/a" }, // internal
      { referrer: "https://google.com/", url: "https://s.fr/a" }, // search
      { referrer: "https://google.com/", url: "https://s.fr/a" }, // search
      { referrer: "https://partner.fr/", url: "https://s.fr/a" }, // referral
    ];
    const r = acquisitionReport(entries);
    expect(r.total).toBe(5);
    const byChannel = Object.fromEntries(r.channels.map((c) => [c.channel, c.sessions]));
    expect(byChannel).toMatchObject({ direct: 1, internal: 1, search: 2, referral: 1, social: 0 });
    // top référents externes : google (2) avant partner (1) ; interne/direct exclus
    expect(r.referrers[0]).toEqual({ host: "google.com", channel: "search", sessions: 2 });
    expect(r.referrers.find((x) => x.host === "s.fr")).toBeUndefined();
  });
});

// F48 (§ 5.16) — ce que l'écran lit du report : les cinq canaux toujours, les parts
// sur TOUTES les sessions lues, l'inconnu jamais chiffré.
describe("lignesCanaux", () => {
  it("rend toujours les 5 canaux, dans l'ordre fixe, zéros compris", () => {
    const r = acquisitionReport([
      { referrer: null, url: "https://s.fr/a" },
      { referrer: "https://google.com/", url: "https://s.fr/a" },
    ]);
    const lignes = lignesCanaux(r);
    expect(lignes.map((l) => l.channel)).toEqual([...CHANNELS]);
    expect(lignes.find((l) => l.channel === "social")).toEqual({ channel: "social", sessions: 0, part: 0 });
  });

  it("parts calculées sur le total des sessions lues (leur somme vaut 1)", () => {
    const r = acquisitionReport([
      { referrer: null, url: "https://s.fr/a" },
      { referrer: null, url: "https://s.fr/a" },
      { referrer: "https://s.fr/x", url: "https://s.fr/a" },
      { referrer: "https://partner.fr/", url: "https://s.fr/a" },
    ]);
    const parts = Object.fromEntries(lignesCanaux(r).map((l) => [l.channel, l.part]));
    expect(parts).toEqual({ direct: 0.5, search: 0, social: 0, referral: 0.25, internal: 0.25 });
    expect(lignesCanaux(r).reduce((s, l) => s + (l.part ?? 0), 0)).toBeCloseTo(1);
  });

  it("sans session : 5 canaux à 0 et parts null (pas de dénominateur), jamais « 0 % »", () => {
    const lignes = lignesCanaux(acquisitionReport([]));
    expect(lignes).toHaveLength(5);
    expect(lignes.every((l) => l.sessions === 0 && l.part === null)).toBe(true);
  });

  it("un report incomplet (canal manquant) garde les 5 canaux", () => {
    const lignes = lignesCanaux({ channels: [{ channel: "search", sessions: 3 }], referrers: [], total: 3 });
    expect(lignes.map((l) => l.sessions)).toEqual([0, 3, 0, 0, 0]);
  });
});

describe("partHorsDirect", () => {
  it("(total − direct − interne) / total", () => {
    const r = acquisitionReport([
      { referrer: null, url: "https://s.fr/a" }, // direct
      { referrer: "https://s.fr/x", url: "https://s.fr/a" }, // interne
      { referrer: "https://google.com/", url: "https://s.fr/a" }, // recherche
      { referrer: "https://t.co/z", url: "https://s.fr/a" }, // social
    ]);
    expect(partHorsDirect(r)).toBe(0.5);
  });
  it("sans session : null ; un vrai 0 quand tout est direct", () => {
    expect(partHorsDirect(acquisitionReport([]))).toBeNull();
    expect(partHorsDirect(acquisitionReport([{ referrer: null, url: "https://s.fr/a" }]))).toBe(0);
  });
});

describe("partDuTotal et référents tronqués", () => {
  it("part d'un référent sur le total, pas sur le top renvoyé", () => {
    // 25 hôtes distincts + 75 directs : la part se lit sur les 100 sessions lues.
    const entries = [
      ...Array.from({ length: 25 }, (_, i) => ({ referrer: `https://ref${i}.example/`, url: "https://s.fr/a" })),
      ...Array.from({ length: 75 }, () => ({ referrer: null, url: "https://s.fr/a" })),
    ];
    const r = acquisitionReport(entries);
    expect(r.referrers).toHaveLength(TOP_REFERENTS);
    expect(partDuTotal(r.referrers[0].sessions, r.total)).toBe(0.01);
    expect(partDuTotal(3, 0)).toBeNull();
  });
  it("« ≥ 20 » dès que la lecture en renvoie 20 ; exact en dessous", () => {
    const hotes = (n: number) =>
      acquisitionReport(Array.from({ length: n }, (_, i) => ({ referrer: `https://h${i}.example/`, url: "https://s.fr/a" })));
    expect(referentsTronques(hotes(19))).toBe(false);
    expect(referentsTronques(hotes(20))).toBe(true);
    expect(referentsTronques(hotes(30))).toBe(true);
  });
  it("« Direct » dit ce qu'il recouvre", () => {
    expect(LIBELLE_CANAL.direct).toBe("Direct ou référent masqué");
  });
});

// B31 (§ 5.16.4, A4 et A6) — la route d'entrée et le seau de la 1re vue arrivent
// avec la lecture sur le contrat : la table croisée et la série se calculent ici,
// purs, sur les MÊMES entrées que les canaux.
describe("acquisitionReport — routes d'entrée par canal (B31)", () => {
  it("une ligne par route, cinq canaux zéros compris ; somme des cellules = total de la ligne", () => {
    const r = acquisitionReport([
      { referrer: null, url: "https://s.fr/a", route: "/" },
      { referrer: "https://google.com/", url: "https://s.fr/a", route: "/" },
      { referrer: "https://google.com/", url: "https://s.fr/p", route: "/produit" },
      { referrer: "https://s.fr/x", url: "https://s.fr/b", route: "/blog" },
      { referrer: "https://google.com/", url: "https://s.fr/a", route: "/" },
    ]);
    expect(r.entrees[0]).toEqual({ route: "/", parCanal: { direct: 1, search: 2, social: 0, referral: 0, internal: 0 }, total: 3 });
    for (const ligne of r.entrees) {
      expect(CHANNELS.reduce((s, c) => s + ligne.parCanal[c], 0)).toBe(ligne.total);
    }
    // Égalité de total : ordre alphabétique des routes.
    expect(r.entrees.map((e) => e.route)).toEqual(["/", "/blog", "/produit"]);
    expect(r.routesEntree).toBe(3);
  });

  it("top 10 routes, le nombre de routes distinctes dit la troncature ; entrée sans route : dans les canaux, dans aucune ligne", () => {
    const r = acquisitionReport([
      ...Array.from({ length: 12 }, (_, i) => ({ referrer: null, url: "https://s.fr/", route: `/r${String(i).padStart(2, "0")}` })),
      { referrer: null, url: "https://s.fr/" },
    ]);
    expect(r.entrees).toHaveLength(TOP_ENTREES);
    expect(r.routesEntree).toBe(12);
    expect(r.total).toBe(13);
    expect(r.entrees.reduce((s, e) => s + e.total, 0)).toBe(10);
  });
});

describe("serieCanaux (B31, A6)", () => {
  const H = 3_600_000;
  const debuts = [0, H, 2 * H];

  it("chaque entrée dans le seau de sa 1re vue ; seaux vides à 0 ; grille conservée", () => {
    const { points, horsGrille } = serieCanaux(
      [
        { referrer: null, url: "https://s.fr/", t: 0 },
        { referrer: "https://google.com/", url: "https://s.fr/", t: 0 },
        { referrer: "https://t.co/x", url: "https://s.fr/", t: 2 * H },
      ],
      debuts,
    );
    expect(points.map((p) => p.t)).toEqual(debuts.map((t) => new Date(t).toISOString()));
    expect(points[0].canaux).toEqual({ direct: 1, search: 1, social: 0, referral: 0, internal: 0 });
    expect(points[1].canaux).toEqual({ direct: 0, search: 0, social: 0, referral: 0, internal: 0 });
    expect(points[2].canaux.social).toBe(1);
    expect(horsGrille).toBe(0);
  });

  it("une entrée hors grille n'est rangée dans aucun seau voisin : elle est comptée à part", () => {
    const { points, horsGrille } = serieCanaux([{ referrer: null, url: "https://s.fr/", t: H / 2 }], debuts);
    expect(points.every((p) => Object.values(p.canaux).every((n) => n === 0))).toBe(true);
    expect(horsGrille).toBe(1);
  });
});
