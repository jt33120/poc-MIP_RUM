// La ligne « Latence d'alerte » de la vitrine, déduite du battement de cœur du
// scheduler plutôt qu'écrite en dur.
//
// Ce qui est vérifié ici est ce qui a DÉJÀ mal tourné une fois : une affirmation
// statique qui devient fausse en silence le jour où l'infrastructure change.
import { describe, expect, it } from "vitest";
import {
  CADENCE_TICK_MIN,
  TOLERANCE_MIN,
  ligneLatence,
} from "../../apps/console/lib/etat-latence";

const MAINTENANT = new Date("2026-09-08T15:30:00Z").getTime();
const ilYa = (min: number) => new Date(MAINTENANT - min * 60_000);

describe("ligne « Latence d'alerte »", () => {
  it("annonce la cadence tenue quand un tick vient de passer", () => {
    const l = ligneLatence(ilYa(2), MAINTENANT);
    expect(l.s).toBe("atteint");
    expect(l.depuisMin).toBe(2);
    expect(l.reel).toContain(`${CADENCE_TICK_MIN} minutes`);
    expect(l.reel).toContain("il y a 2 min");
  });

  // Trois cadences de tolérance : un redéploiement ou un builder lent décale un
  // tick sans que rien ne soit cassé. La vitrine ne doit pas clignoter pour ça.
  it("tolère un retard jusqu'à trois cadences", () => {
    expect(ligneLatence(ilYa(TOLERANCE_MIN), MAINTENANT).s).toBe("atteint");
    expect(ligneLatence(ilYa(TOLERANCE_MIN + 1), MAINTENANT).s).toBe("partiel");
  });

  it("dit que les alertes sont à l'arrêt au-delà de la tolérance", () => {
    const l = ligneLatence(ilYa(120), MAINTENANT);
    expect(l.s).toBe("partiel");
    expect(l.reel).toContain("aucun passage depuis 120 min");
    expect(l.reel).toMatch(/à l'arrêt/);
  });

  // Le cas qui compte pour l'honnêteté : sans preuve, on n'affirme pas que ça
  // marche. Une base injoignable et un scheduler jamais déployé sont
  // indiscernables — les deux donnent null, les deux donnent « non atteint ».
  it("sans aucune trace, n'affirme rien et reste en « non atteint »", () => {
    const l = ligneLatence(null, MAINTENANT);
    expect(l.s).toBe("manque");
    expect(l.depuisMin).toBeNull();
    expect(l.reel).toContain("aucun passage constaté");
  });

  // Une horloge de base légèrement en avance ne doit pas produire « il y a -1 min ».
  it("ne renvoie jamais un âge négatif", () => {
    expect(ligneLatence(new Date(MAINTENANT + 30_000), MAINTENANT).depuisMin).toBe(0);
  });
});
