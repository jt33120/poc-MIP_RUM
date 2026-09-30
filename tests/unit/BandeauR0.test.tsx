// Bandeau R0 de la Vue d'ensemble (spec A2 § 5.2-5.3, vague 2) : « ça va ? » en une
// ligne. Ce qui compte : l'absence de constat ne se lit jamais « tout va bien », et
// une lecture en échec se dit au lieu de laisser un bandeau muet.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BandeauR0, type ProprietesBandeauR0 } from "@/components/vue-ensemble/BandeauR0";

const BASE: ProprietesBandeauR0 = {
  sante: { score: 82, label: "Bon" },
  constat: { titre: "LCP /checkout : 4,8 s à 14 h", href: "/pages?route=%2Fcheckout" },
  nbConstats: 3,
  constatsPartiels: false,
  deploiement: { version: "v1.4.2", ts: "2026-09-29T12:00:00Z" },
  hrefSante: "#sante",
  hrefDeploiement: "#release-titre",
};

const rendu = (p: Partial<ProprietesBandeauR0> = {}) => renderToStaticMarkup(<BandeauR0 {...BASE} {...p} />);

describe("BandeauR0", () => {
  it("score, phrase du premier constat, compte et dernier déploiement", () => {
    const html = rendu();
    expect(html).toContain("82");
    expect(html).toContain("Bon");
    expect(html).toContain('href="/pages?route=%2Fcheckout"');
    expect(html).toContain("LCP /checkout : 4,8 s à 14 h");
    expect(html).toContain("3 constats");
    expect(html).toContain('href="#release-titre"');
    expect(html).toContain("v1.4.2");
    // Heure de Paris, jamais d'ISO à l'écran.
    expect(html).toContain("29/09 à 14:00");
    expect(html).not.toContain("2026-09-29T");
  });

  it("aucun constat : « Aucun constat sur la période », jamais « tout va bien »", () => {
    const html = rendu({ constat: null, nbConstats: 0 });
    expect(html).toContain("Aucun constat sur la période");
    expect(html.toLowerCase()).not.toContain("tout va bien");
    expect(html).toContain("0 constat");
  });

  it("les lectures en échec se disent", () => {
    const html = rendu({ sante: "echec", deploiement: "echec", constatsPartiels: true });
    expect(html).toContain("Santé non lue");
    expect(html).toContain("Déploiements non lus");
    expect(html).toContain("constats partiels");
  });

  it("sans score calculable, un tiret ; bloc santé éteint, pas de lien mort", () => {
    const html = rendu({ sante: null, hrefSante: undefined, deploiement: null });
    expect(html).toContain("Santé");
    expect(html).toContain("—");
    expect(html).not.toContain('href="#sante"');
    expect(html).toContain("Aucun déploiement");
  });
});
