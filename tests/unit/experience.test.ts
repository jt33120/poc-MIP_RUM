// Satisfaction déclarée (Lot A DEM) — logique pure : CSAT, moyenne, répartition.
import { describe, expect, it } from "vitest";
import { avgScore, breakdown, csatRatio } from "../../apps/console/lib/experience";

describe("csatRatio", () => {
  it("part des notes >= 4", () => {
    expect(csatRatio([5, 4, 3, 1])).toBeCloseTo(0.5, 6);
  });
  it("aucun feedback -> null", () => {
    expect(csatRatio([])).toBeNull();
  });
});

describe("avgScore / breakdown", () => {
  it("moyenne", () => {
    expect(avgScore([2, 4])).toBe(3);
    expect(avgScore([])).toBeNull();
  });
  it("promoteurs/passifs/détracteurs", () => {
    expect(breakdown([5, 5, 4, 3, 2, 1])).toEqual({ promoters: 2, passives: 2, detractors: 2 });
  });
});

// ─────────────────────────── F26 — écran Satisfaction ───────────────────────────
import {
  lignesSatisfactionParPage,
  nuageRessenti,
  partPositive,
  repartitionNotes,
} from "../../apps/console/lib/experience";

describe("partPositive (F26)", () => {
  it("jour (ou seau) sans avis noté = trou : null, jamais 0 %", () => {
    expect(partPositive(0, 0)).toBeNull();
    expect(partPositive(3, 0)).toBeNull();
  });
  it("part des avis, bornée à [0, 1]", () => {
    expect(partPositive(3, 4)).toBe(0.75);
    expect(partPositive(0, 4)).toBe(0);
    expect(partPositive(5, 4)).toBe(1);
  });
});

describe("lignesSatisfactionParPage (F26)", () => {
  const lcp = [
    { valeur: "/a", lcp_p75: 2100, lcp_n: 40 },
    { valeur: null, lcp_p75: 9000, lcp_n: 3 },
  ];

  it("route à commentaire seul (count = 0) → pilote, CSAT et part 1-2 null, jamais 0 %", () => {
    const [l] = lignesSatisfactionParPage([{ route: "/b", count: 0, positives: 0, detracteurs: 0 }], lcp);
    expect(l).toEqual({
      route: "/b",
      avis: 0,
      positifs: 0,
      csat: null,
      nonPositifs: null,
      partDetracteurs: null,
      lcp: null,
      lcpN: null,
    });
  });

  it("pilote = 1 − CSAT ; part de notes 1-2 ; LCP p75 joint par route", () => {
    const [l] = lignesSatisfactionParPage([{ route: "/a", count: 10, positives: 7, detracteurs: 2 }], lcp);
    expect(l.csat).toBe(0.7);
    expect(l.nonPositifs).toBeCloseTo(0.3, 10);
    expect(l.partDetracteurs).toBe(0.2);
    expect(l.lcp).toBe(2100);
    expect(l.lcpN).toBe(40);
  });

  it("« toute l'app » (route null) n'emprunte jamais le LCP du groupe « Inconnu »", () => {
    const [l] = lignesSatisfactionParPage([{ route: null, count: 4, positives: 4, detracteurs: 0 }], lcp);
    expect(l.lcp).toBeNull();
  });
});

describe("nuageRessenti (F26)", () => {
  const ligne = (route: string | null, avis: number, lcp: number | null) =>
    lignesSatisfactionParPage([{ route, count: avis, positives: Math.floor(avis / 2), detracteurs: 0 }], lcp === null || route === null ? [] : [{ valeur: route, lcp_p75: lcp, lcp_n: 50 }])[0];

  it("moins de trois pages avec au moins 10 avis et un LCP : pas de nuage (partiel)", () => {
    const r = nuageRessenti([ligne("/a", 12, 2000), ligne("/b", 10, 3000), ligne("/c", 9, 1800), ligne("/d", 40, null), ligne(null, 50, null)]);
    expect(r.eligibles).toBe(2);
    expect(r.suffisant).toBe(false);
    expect(r.points.map((p) => p.route)).toEqual(["/a", "/b"]);
  });

  it("trois pages éligibles : nuage, x = LCP p75, y = CSAT, taille = avis", () => {
    const r = nuageRessenti([ligne("/a", 12, 2000), ligne("/b", 10, 3000), ligne("/c", 20, 1800)]);
    expect(r.suffisant).toBe(true);
    expect(r.points[2]).toEqual({ route: "/c", lcp: 1800, csat: 0.5, avis: 20 });
  });
});

describe("repartitionNotes (F26)", () => {
  it("trois parts d'un même tout ; sans avis, des parts null", () => {
    expect(repartitionNotes({ count: 10, promoters: 5, passives: 3, detractors: 2 }).map((r) => r.part)).toEqual([0.5, 0.3, 0.2]);
    expect(repartitionNotes({ count: 0, promoters: 0, passives: 0, detractors: 0 }).every((r) => r.part === null && r.n === 0)).toBe(true);
  });
});

import { frustrationPour1000 } from "../../apps/console/lib/experience";
// La garde de capteur est celle de F22 (`etatCapteurFrustration`) : mêmes textes.
import { MANQUE_CAPTEUR_MOBILE, RAISON_RUNTIME_ABSENT } from "../../apps/console/lib/perf-domain";

describe("frustrationPour1000 — garde de capteur R-F de F22 (F26, revue)", () => {
  it("app React Native seule → null et « Non collecté », jamais « 0,00 »", () => {
    const r = frustrationPour1000({ sessions: 600, sessionsCouvertes: 0, signaux: 0, runtimeLu: true }, "24 h");
    expect(r.valeur).toBeNull();
    expect(r.etat).toEqual({ kind: "non_collecte", manque: MANQUE_CAPTEUR_MOBILE });
    expect(r.raisonNull).toContain("non collecté");
  });

  it("400 navigateur + 600 React Native → taux sur les 400 seules, partiel « 400 sur 1 000 »", () => {
    const r = frustrationPour1000({ sessions: 1000, sessionsCouvertes: 400, signaux: 20, runtimeLu: true });
    expect(r.valeur).toBe(50); // 20 / 400 × 1 000, pas 20 / 1 000 × 1 000
    expect(r.n).toBe(400);
    // Séparateur de milliers de `fr-FR` : une espace fine insécable, écrite par le formateur.
    expect(r.etat).toEqual({
      kind: "partiel",
      raison: `compté sur les sessions navigateur seulement (400 sur ${(1000).toLocaleString("fr-FR")})`,
    });
  });

  it("colonne runtime absente → taux sur toutes les sessions, partiel « capteur non identifiable »", () => {
    const r = frustrationPour1000({ sessions: 50, sessionsCouvertes: 50, signaux: 5, runtimeLu: false });
    expect(r.valeur).toBe(100);
    expect(r.etat).toEqual({ kind: "partiel", raison: RAISON_RUNTIME_ABSENT });
  });

  it("aucune session commencée → null, sans état ; tout navigateur → le taux, sans état", () => {
    expect(frustrationPour1000({ sessions: 0, sessionsCouvertes: 0, signaux: 0, runtimeLu: true }, "1 h")).toEqual({
      valeur: null,
      raisonNull: "aucune session commencée sur 1 h",
      n: 0,
      etat: null,
    });
    expect(frustrationPour1000({ sessions: 3, sessionsCouvertes: 3, signaux: 0, runtimeLu: true })).toMatchObject({ valeur: 0, etat: null });
  });
});
