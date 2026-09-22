// Acquisition — classification de canal + agrégat. Logique pure.
import { describe, expect, it } from "vitest";
import { acquisitionReport, classifyChannel, hostOf } from "../../apps/console/lib/acquisition";
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
