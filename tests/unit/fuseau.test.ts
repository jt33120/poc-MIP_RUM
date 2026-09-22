// F05 (plan § 1.5 R-T, § 3.3, § 4.4) — jours et heures LOCAUX convertis en instants
// UTC côté serveur. Une case de heatmap « 9 h » à Paris, l'été, n'est pas
// l'heure 09:00 UTC : c'est 07:00-08:00 UTC. Un lien construit autrement ouvre
// le trafic d'une autre heure, sans que rien à l'écran ne le signale.
import { describe, expect, it } from "vitest";
import {
  bornesHeureLocale,
  bornesJourLocal,
  joursLocaux,
  libelleDeuxFuseaux,
} from "../../apps/console/lib/fuseau";

const PARIS = "Europe/Paris";

describe("bornesHeureLocale — une case jour × heure du fuseau de l'app", () => {
  it("Europe/Paris, case 9 h un jour d'été → 07:00-08:00 UTC", () => {
    expect(bornesHeureLocale("2026-07-15", 9, PARIS)).toEqual({
      from: "2026-07-15T07:00:00Z",
      to: "2026-07-15T08:00:00Z",
    });
  });

  it("Europe/Paris, case 9 h un jour d'hiver → 08:00-09:00 UTC", () => {
    expect(bornesHeureLocale("2026-01-15", 9, PARIS)).toEqual({
      from: "2026-01-15T08:00:00Z",
      to: "2026-01-15T09:00:00Z",
    });
  });

  it("la case 0 h commence la veille en UTC ; la case 23 h finit au minuit local suivant", () => {
    expect(bornesHeureLocale("2026-09-10", 0, PARIS)).toEqual({
      from: "2026-09-09T22:00:00Z",
      to: "2026-09-09T23:00:00Z",
    });
    expect(bornesHeureLocale("2026-09-10", 23, PARIS)).toEqual({
      from: "2026-09-10T21:00:00Z",
      to: "2026-09-10T22:00:00Z",
    });
  });

  it("recul d'automne (25/10/2026) : la case 2 h couvre ses DEUX heures réelles", () => {
    // 02:00-03:00 existe deux fois (CEST puis CET) ; `extract(hour …)` les range dans
    // la même case : le lien doit ouvrir les deux.
    expect(bornesHeureLocale("2026-10-25", 2, PARIS)).toEqual({
      from: "2026-10-25T00:00:00Z",
      to: "2026-10-25T02:00:00Z",
    });
    // L'heure d'après reprend à l'heure d'hiver.
    expect(bornesHeureLocale("2026-10-25", 3, PARIS)).toEqual({
      from: "2026-10-25T02:00:00Z",
      to: "2026-10-25T03:00:00Z",
    });
  });

  it("saut de printemps (29/03/2026) : la case 2 h n'existe pas, plage vide ; 1 h et 3 h encadrent le saut", () => {
    const deux = bornesHeureLocale("2026-03-29", 2, PARIS);
    expect(deux.from).toBe(deux.to);
    expect(bornesHeureLocale("2026-03-29", 1, PARIS)).toEqual({
      from: "2026-03-29T00:00:00Z",
      to: "2026-03-29T01:00:00Z",
    });
    expect(bornesHeureLocale("2026-03-29", 3, PARIS)).toEqual({
      from: "2026-03-29T01:00:00Z",
      to: "2026-03-29T02:00:00Z",
    });
  });

  it("UTC : l'heure locale EST l'heure UTC", () => {
    expect(bornesHeureLocale("2026-07-15", 9, "UTC")).toEqual({
      from: "2026-07-15T09:00:00Z",
      to: "2026-07-15T10:00:00Z",
    });
  });

  it("refuse un jour ou une heure qui n'existent pas, au lieu d'inventer une plage", () => {
    expect(() => bornesHeureLocale("2026-02-30", 9, PARIS)).toThrow(RangeError);
    expect(() => bornesHeureLocale("15/07/2026", 9, PARIS)).toThrow(RangeError);
    expect(() => bornesHeureLocale("2026-07-15", 24, PARIS)).toThrow(RangeError);
    expect(() => bornesHeureLocale("2026-07-15", 9.5, PARIS)).toThrow(RangeError);
  });
});

describe("bornesJourLocal — un point quotidien", () => {
  it("jour d'été 10/09 à Paris → 2026-09-09T22:00:00Z → 2026-09-10T22:00:00Z", () => {
    expect(bornesJourLocal("2026-09-10", PARIS)).toEqual({
      from: "2026-09-09T22:00:00Z",
      to: "2026-09-10T22:00:00Z",
    });
  });

  it("jour de recul d'heure : 25 heures", () => {
    const { from, to } = bornesJourLocal("2026-10-25", PARIS);
    expect(from).toBe("2026-10-24T22:00:00Z");
    expect(to).toBe("2026-10-25T23:00:00Z");
    expect((Date.parse(to) - Date.parse(from)) / 3_600_000).toBe(25);
  });

  it("jour de saut d'heure : 23 heures", () => {
    const { from, to } = bornesJourLocal("2026-03-29", PARIS);
    expect((Date.parse(to) - Date.parse(from)) / 3_600_000).toBe(23);
  });

  it("fuseau à l'ouest d'UTC : le jour local commence le jour même en UTC", () => {
    expect(bornesJourLocal("2026-09-10", "America/New_York")).toEqual({
      from: "2026-09-10T04:00:00Z",
      to: "2026-09-11T04:00:00Z",
    });
  });
});

describe("libelleDeuxFuseaux — l'écran d'arrivée dit les deux fuseaux", () => {
  it("une heure : date locale, heures locales, heures UTC", () => {
    const { from, to } = bornesHeureLocale("2026-09-10", 9, PARIS);
    expect(libelleDeuxFuseaux(from, to, PARIS)).toBe("10/09 09:00-10:00 Europe/Paris (07:00-08:00 UTC)");
  });

  it("un jour : « 00:00-24:00 », et les dates UTC quand elles diffèrent", () => {
    const { from, to } = bornesJourLocal("2026-09-10", PARIS);
    expect(libelleDeuxFuseaux(from, to, PARIS)).toBe(
      "10/09 00:00-24:00 Europe/Paris (09/09 22:00 - 10/09 22:00 UTC)",
    );
  });

  it("en UTC, un seul libellé", () => {
    expect(libelleDeuxFuseaux("2026-09-10T07:00:00Z", "2026-09-10T08:00:00Z", "UTC")).toBe("10/09 07:00-08:00 UTC");
  });
});

describe("joursLocaux — l'axe de la heatmap, dans le repère de ses cases", () => {
  it("à 00:30 à Paris (22:30 UTC la veille), la dernière rangée est le jour LOCAL", () => {
    // L'ancien axe (jours UTC) s'arrêtait au 09/09 : la rangée du 10 manquait.
    const maintenant = Date.parse("2026-09-09T22:30:00Z");
    const jours = joursLocaux(14, PARIS, maintenant);
    expect(jours).toHaveLength(14);
    expect(jours.at(-1)).toBe("2026-09-10");
    expect(jours[0]).toBe("2026-08-28");
  });

  it("jours consécutifs, sans doublon ni trou à travers un changement d'heure", () => {
    const jours = joursLocaux(3, PARIS, Date.parse("2026-10-26T12:00:00Z"));
    expect(jours).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });
});
