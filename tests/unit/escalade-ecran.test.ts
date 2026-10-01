// L'escalade à l'écran (migration-v108) : ce que /alerts tire des lectures, sans base.
// Les bornes du formulaire et de la commande sont CELLES de la base : relues ici dans
// les contraintes de migration-v108, pour qu'un refus ne dise jamais un autre nombre
// que celui que la base appliquerait.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BORNES_ESCALADE,
  CADENCE_TICK_DEFAUT_MIN,
  dureeMinutes,
  etapesParPortee,
  grainDuTick,
  ligneAcquittement,
  ligneNiveau,
  relanceDeLEtape,
  tuileMtta,
  type EtapeAffichee,
} from "@/lib/escalade-ecran";

const V108 = readFileSync(join(__dirname, "..", "..", "packages", "db", "sql", "migration-v108.sql"), "utf8");
const NBSP = " ";
const sansInsecable = (s: string | null) => s?.replaceAll(NBSP, " ") ?? null;

const etape = (o: Partial<EtapeAffichee> & Pick<EtapeAffichee, "id" | "level">): EtapeAffichee => ({
  app_id: "demo",
  severity_min: "warning",
  delay_minutes: 15,
  repeat_minutes: null,
  repeat_max: null,
  ...o,
});

describe("les bornes d'une étape sont celles de la base", () => {
  it("niveau, délai, cadence et plafond de relance : les nombres des contraintes de migration-v108", () => {
    const sql = V108.replace(/\s+/g, " ");
    expect(sql).toContain(`check (level between ${BORNES_ESCALADE.niveau.min} and ${BORNES_ESCALADE.niveau.max})`);
    expect(sql).toContain(`check (delay_minutes between ${BORNES_ESCALADE.delai.min} and ${BORNES_ESCALADE.delai.max})`);
    expect(sql).toContain(`repeat_minutes between ${BORNES_ESCALADE.relance.min} and ${BORNES_ESCALADE.relance.max}`);
    expect(sql).toContain(`repeat_max between ${BORNES_ESCALADE.plafond.min} and ${BORNES_ESCALADE.plafond.max}`);
    // Le délai plafond est l'horizon de la fonction : au-delà, un déclenchement n'escalade plus.
    expect(BORNES_ESCALADE.delai.max).toBe(7 * 24 * 60);
    expect(sql).toContain("e.fired_at >= p_maintenant - interval '7 days'");
  });
});

describe("dureeMinutes", () => {
  it("minutes, heures, jours — à la française, jamais « 90 min »", () => {
    expect(sansInsecable(dureeMinutes(5))).toBe("5 min");
    expect(sansInsecable(dureeMinutes(60))).toBe("1 h");
    expect(sansInsecable(dureeMinutes(90))).toBe("1 h 30");
    expect(sansInsecable(dureeMinutes(125))).toBe("2 h 05");
    expect(sansInsecable(dureeMinutes(2 * 1440))).toBe("2 j");
    expect(sansInsecable(dureeMinutes(3 * 1440 + 120))).toBe("3 j 2 h");
    expect(dureeMinutes(-1)).toBe("—");
    expect(dureeMinutes(Number.NaN)).toBe("—");
  });
});

describe("le grain du planificateur", () => {
  it("écrit la cadence lue, et celle de la production quand elle n'est pas publiée", () => {
    expect(sansInsecable(grainDuTick(5))).toContain("toutes les 5 min");
    expect(sansInsecable(grainDuTick(null))).toContain(`toutes les ${CADENCE_TICK_DEFAUT_MIN} min`);
    expect(grainDuTick(15)).toContain("un délai plus court part au passage suivant");
  });
});

describe("la relance d'une étape", () => {
  it("sans cadence : aucune", () => {
    expect(relanceDeLEtape(etape({ id: 1, level: 1 }), [])).toEqual({ texte: "sans relance", etat: "aucune" });
  });

  it("le dernier niveau de sa portée : active, avec sa cadence et son plafond", () => {
    const n2 = etape({ id: 2, level: 2, repeat_minutes: 60, repeat_max: 4 });
    const r = relanceDeLEtape(n2, [etape({ id: 1, level: 1 }), n2]);
    expect(r.etat).toBe("active");
    expect(sansInsecable(r.texte)).toBe("relance à 1 h d'intervalle, 4 fois au plus");
  });

  it("un niveau plus haut de la même application, ou global : muette", () => {
    const n1 = etape({ id: 1, level: 1, repeat_minutes: 30, repeat_max: 2 });
    expect(relanceDeLEtape(n1, [n1, etape({ id: 2, level: 3 })])).toMatchObject({ etat: "inactive" });
    expect(relanceDeLEtape(n1, [n1, etape({ id: 3, level: 2, app_id: null })]).texte).toContain("le niveau 2 peut passer après");
    // Le niveau plus haut d'une AUTRE application ne la fait pas taire.
    expect(relanceDeLEtape(n1, [n1, etape({ id: 4, level: 5, app_id: "autre" })]).etat).toBe("active");
  });

  it("une étape globale dépassée par le niveau d'une application : partielle, et nomme l'application", () => {
    const globale = etape({ id: 1, level: 1, app_id: null, repeat_minutes: 30, repeat_max: 2 });
    const r = relanceDeLEtape(globale, [globale, etape({ id: 2, level: 2, app_id: "boutique" })]);
    expect(r.etat).toBe("partielle");
    expect(r.texte).toContain("sauf pour l'application boutique");
  });
});

describe("les étapes par portée", () => {
  it("toutes les applications d'abord, puis par application ; dans chacune, par niveau puis délai", () => {
    const groupes = etapesParPortee([
      etape({ id: 5, level: 2, app_id: "zeta" }),
      etape({ id: 4, level: 2, app_id: "alpha", delay_minutes: 30 }),
      etape({ id: 3, level: 1, app_id: null }),
      etape({ id: 2, level: 2, app_id: "alpha", delay_minutes: 10 }),
      etape({ id: 1, level: 1, app_id: "alpha", delay_minutes: 60 }),
    ]);
    expect(groupes.map((g) => [g.app, g.etapes.map((e) => e.id)])).toEqual([
      [null, [3]],
      ["alpha", [1, 2, 4]],
      ["zeta", [5]],
    ]);
  });
});

describe("la ligne d'acquittement", () => {
  it("« acquittée à HH:MM, après N min », heure de Paris", () => {
    // 08:00 UTC = 10:00 à Paris (heure d'été).
    expect(sansInsecable(ligneAcquittement("2026-09-30T08:00:00Z", "2026-09-30T08:12:00Z"))).toBe("acquittée à 10:12, après 12 min");
  });

  it("un autre jour : la date s'ajoute ; un long délai s'écrit en heures", () => {
    expect(sansInsecable(ligneAcquittement("2026-09-29T20:00:00Z", "2026-09-30T07:30:00Z"))).toBe(
      "acquittée le 30/09 à 09:30, après 11 h 30",
    );
  });

  it("sans heure (acquittée avant l'horodatage) : rien d'inventé", () => {
    expect(ligneAcquittement("2026-09-30T08:00:00Z", null)).toBeNull();
    expect(ligneAcquittement("2026-09-30T08:00:00Z", undefined)).toBeNull();
    expect(ligneAcquittement("pas une date", "2026-09-30T08:00:00Z")).toBeNull();
  });

  it("une horloge en retard ne rend pas un délai négatif", () => {
    expect(sansInsecable(ligneAcquittement("2026-09-30T08:00:30Z", "2026-09-30T08:00:00Z"))).toBe("acquittée à 10:00, après 0 min");
  });
});

describe("le niveau atteint", () => {
  it("niveau seul, ou niveau et rang de relance ; rien sans escalade", () => {
    expect(ligneNiveau(2, 0)).toBe("niveau 2");
    expect(ligneNiveau(3, 2)).toBe("niveau 3 · relance 2");
    expect(ligneNiveau(null, null)).toBeNull();
  });
});

describe("la tuile du délai médian d'acquittement", () => {
  it("une médiane : sa valeur, et sur combien d'acquittements", () => {
    const t = tuileMtta({ disponible: true, mediane_ms: 720_000, n: 4, declenches: 6 }, 30);
    expect(t.valeur).toBe(720_000);
    expect(sansInsecable(t.lecture!)).toBe("médiane de 4 acquittements sur 6 déclenchements nés après l'horodatage");
  });

  it("jamais un 0 : aucun acquittement, aucune horodatage, ou une lecture en échec disent pourquoi", () => {
    expect(tuileMtta({ disponible: true, mediane_ms: null, n: 0, declenches: 3 }, 30)).toMatchObject({
      valeur: null,
      raisonNull: "aucun acquittement horodaté sur 30 j",
    });
    expect(tuileMtta({ disponible: true, mediane_ms: null, n: 0, declenches: 0 }, 30)).toMatchObject({
      valeur: null,
      raisonNull: "aucun déclenchement depuis l'horodatage, sur 30 j",
      lecture: undefined,
    });
    expect(tuileMtta({ disponible: false, mediane_ms: null, n: 0, declenches: 0 }, 30)).toMatchObject({
      valeur: null,
      raisonNull: "heure d'acquittement pas encore enregistrée par la base",
    });
    expect(tuileMtta(null, 30)).toMatchObject({ valeur: null, raisonNull: "lecture en échec" });
  });
});
