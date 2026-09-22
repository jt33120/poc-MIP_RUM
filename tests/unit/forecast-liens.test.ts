// Liens des jours de /forecast (§ 5.20.3, TE5-TE7, F65 ; § 3.3, R-T) : un point du
// 10/09 à Paris ouvre le 10/09 À PARIS, converti en instants UTC par le serveur —
// jamais « le 10/09 UTC », qui montrerait deux heures de la veille.
import { describe, expect, it } from "vitest";
import { lienJour, liensDesJours } from "../../apps/console/lib/forecast-liens";

// Gabarit tel que `hrefWithQuery` l'écrit : accolades encodées par URLSearchParams.
const GABARIT = "/?app=demo&from=%7Bfrom%7D&to=%7Bto%7D";

describe("lienJour — bornes UTC du jour local", () => {
  it("Europe/Paris, jour d'été : from à 22:00:00Z la veille, to à 22:00:00Z le jour même", () => {
    const { href, libelle } = lienJour(GABARIT, "2026-09-10", "Europe/Paris");
    const url = new URL(href, "http://console.local");
    expect(url.searchParams.get("from")).toBe("2026-09-09T22:00:00Z");
    expect(url.searchParams.get("to")).toBe("2026-09-10T22:00:00Z");
    expect(url.searchParams.get("app")).toBe("demo");
    expect(libelle).toBe("10/09 00:00-24:00 Europe/Paris (09/09 22:00 - 10/09 22:00 UTC)");
  });

  it("Europe/Paris, jour d'hiver : 23:00:00Z la veille", () => {
    const url = new URL(lienJour(GABARIT, "2026-01-15", "Europe/Paris").href, "http://console.local");
    expect(url.searchParams.get("from")).toBe("2026-01-14T23:00:00Z");
    expect(url.searchParams.get("to")).toBe("2026-01-15T23:00:00Z");
  });

  it("jour de changement d'heure (25 octobre 2026) : 25 heures", () => {
    const url = new URL(lienJour(GABARIT, "2026-10-25", "Europe/Paris").href, "http://console.local");
    const duree = Date.parse(url.searchParams.get("to")!) - Date.parse(url.searchParams.get("from")!);
    expect(duree).toBe(25 * 3_600_000);
  });

  it("gabarit aux accolades brutes : même résultat", () => {
    const { href } = lienJour("/errors?from={from}&to={to}", "2026-09-10", "Europe/Paris");
    expect(href).toBe("/errors?from=2026-09-09T22%3A00%3A00Z&to=2026-09-10T22%3A00%3A00Z");
  });
});

describe("liensDesJours", () => {
  it("une entrée par jour, clé = le jour de la grille", () => {
    const liens = liensDesJours(GABARIT, ["2026-09-09", "2026-09-10"], "UTC");
    expect(Object.keys(liens)).toEqual(["2026-09-09", "2026-09-10"]);
    expect(liens["2026-09-10"].libelle).toBe("10/09 00:00-24:00 UTC");
  });
});
