// Couverture du jour de référence des tuiles de /forecast (F65, revue) : le même
// jour de la semaine précédente n'est comparable que s'il a été ENTIÈREMENT
// collecté. Une app dont la collecte commence à 18 h ce jour-là afficherait
// « +1 900 % » ; la tuile doit se taire et dire pourquoi.
import { describe, expect, it } from "vitest";
import { couvertureJourReference, SOURCES_TENDANCES } from "../../apps/console/lib/forecast-comparaison";
import { queryOf } from "../../apps/console/lib/filters";

const QUERY = queryOf({ app: "demo", period: "24h", device: null, segment: [], includeBots: false, includeInternal: false });
const NOW = Date.parse("2026-09-22T10:00:00Z");
const base = {
  query: QUERY,
  source: SOURCES_TENDANCES.vues[0],
  jour: "2026-09-14", // jour local à Paris : 2026-09-13T22:00:00Z → 2026-09-14T22:00:00Z
  tz: "Europe/Paris",
  nowMs: NOW,
  retentionJours: 30,
  n: 820,
};

describe("couvertureJourReference", () => {
  it("collecte commencée à 18 h locale le jour de référence : partielle, date écrite", () => {
    const c = couvertureJourReference({ ...base, debut: new Date("2026-09-14T16:00:00Z") });
    expect(c).toEqual({ etat: "partielle", raison: "pages vues collectées depuis le 14/09 à 18:00 seulement", n: 820 });
  });

  it("collecte commencée la veille à 23:30 locale : le jour de référence est complet", () => {
    expect(couvertureJourReference({ ...base, debut: new Date("2026-09-13T21:30:00Z") })).toEqual({
      etat: "complete",
      raison: null,
      n: 820,
    });
  });

  it("collecte commencée à 00:30 locale le jour même (22:30 UTC la veille) : partielle — le fuseau décide", () => {
    expect(couvertureJourReference({ ...base, debut: new Date("2026-09-13T22:30:00Z") }).etat).toBe("partielle");
  });

  it("aucune donnée : partielle ; début non lu : inconnue — jamais « complète » par défaut", () => {
    expect(couvertureJourReference({ ...base, debut: null }).etat).toBe("partielle");
    expect(couvertureJourReference({ ...base, debut: "echec" })).toMatchObject({ etat: "inconnue", raison: "début de collecte non lu" });
  });

  it("jour de référence au-delà de la rétention : partielle (rétention)", () => {
    const c = couvertureJourReference({ ...base, jour: "2026-08-01", debut: new Date("2026-01-01T00:00:00Z") });
    expect(c.etat).toBe("partielle");
    expect(c.raison).toContain("rétention");
  });

  it("jour de 25 heures (changement d'heure) : même règle, sans décalage", () => {
    const c = couvertureJourReference({
      ...base,
      jour: "2026-10-25",
      nowMs: Date.parse("2026-11-02T10:00:00Z"),
      debut: new Date("2026-10-24T21:59:00Z"),
    });
    expect(c.etat).toBe("complete");
  });
});

describe("couvertureJourReference — collecte interrompue (sixième règle)", () => {
  // FIXTURES : en production, les fenêtres viennent du registre en base.
  const avant = new Date("2026-09-01T00:00:00Z");

  it("interruption pendant le jour de référence : partielle, datée", () => {
    const c = couvertureJourReference({
      ...base,
      debut: avant,
      fenetres: [{ debut: "2026-09-14T08:00:00Z", fin: "2026-09-14T12:00:00Z", etat: "interrompue" }],
    });
    expect(c).toEqual({ etat: "partielle", raison: "collecte interrompue du 14/09 à 10:00 au 14/09 à 14:00", n: 820 });
  });

  it("interruption pendant le jour comparé (J, sept jours après) : partielle, et le dit", () => {
    const c = couvertureJourReference({
      ...base,
      debut: avant,
      fenetres: [{ debut: "2026-09-21T08:00:00Z", fin: null, etat: "interrompue" }],
    });
    expect(c.etat).toBe("partielle");
    expect(c.raison).toBe("collecte interrompue depuis le 21/09 à 10:00, pendant le jour comparé");
  });

  it("interruption entre les deux jours, ou dégradée : l'écart reste valide", () => {
    const entre = { debut: "2026-09-17T08:00:00Z", fin: "2026-09-17T12:00:00Z", etat: "interrompue" as const };
    const degradee = { debut: "2026-09-14T08:00:00Z", fin: "2026-09-14T12:00:00Z", etat: "degradee" as const };
    expect(couvertureJourReference({ ...base, debut: avant, fenetres: [entre, degradee] }).etat).toBe("complete");
  });
});
