// Acquisition — classification de canal + agrégat. Logique pure.
import { describe, expect, it } from "vitest";
import { acquisitionReport, classifyChannel, hostOf } from "../../apps/console/lib/acquisition";

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
