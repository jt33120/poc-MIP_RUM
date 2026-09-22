// Lectures historiques des écrans d'usage (règles S3 et S4) — logique pure.
import { describe, expect, it } from "vitest";
import {
  NOTE_LECTURE_NON_MIGREE,
  fenetreDansPhrase,
  fenetreLue,
  heureUtc,
  noteLectureHistorique,
  plafondAtteint,
} from "../../apps/console/lib/lecture-historique";

describe("plafondAtteint (S4)", () => {
  it("atteint dès que la lecture rend autant de lignes que son plafond", () => {
    expect(plafondAtteint(20_000, 20_000)).toBe(true);
    expect(plafondAtteint(19_999, 20_000)).toBe(false);
    expect(plafondAtteint(0, 20_000)).toBe(false);
  });
  it("un plafond non positif n'est pas un plafond", () => {
    expect(plafondAtteint(0, 0)).toBe(false);
  });
});

describe("fenêtre lue (S3)", () => {
  const luA = new Date("2026-09-22T14:02:37Z");
  it("heure de lecture en UTC, sur deux chiffres", () => {
    expect(heureUtc(luA)).toBe("14:02 UTC");
    expect(heureUtc(new Date("2026-09-22T03:05:00Z"))).toBe("03:05 UTC");
  });
  it("texte du plan, avec l'accord du participe", () => {
    expect(fenetreLue("7d", luA)).toBe("7 derniers jours glissants, lus à 14:02 UTC");
    expect(fenetreLue("24h", luA)).toBe("24 dernières heures glissantes, lues à 14:02 UTC");
    expect(fenetreLue("1h", luA)).toBe("Dernière heure glissante, lue à 14:02 UTC");
  });
  it("la note dit ce que la lecture n'applique pas", () => {
    expect(noteLectureHistorique("7d", luA)).toBe(
      "7 derniers jours glissants, lus à 14:02 UTC (lecture non migrée : ni plage personnalisée, ni tablette, ni « Inconnu »).",
    );
    expect(NOTE_LECTURE_NON_MIGREE).toContain("lecture non migrée");
  });
  it("dans une phrase : « Aucune session sur les 7 derniers jours glissants »", () => {
    expect(fenetreDansPhrase("7d")).toBe("les 7 derniers jours glissants");
    expect(fenetreDansPhrase("1h")).toBe("la dernière heure glissante");
  });
});
