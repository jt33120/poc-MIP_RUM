// Les détections horaires (migration-v101, A2 § 7.1) — la logique PURE, sans base :
// médiane et MAD, écart robuste, règle des deux heures et hystérésis, garde de
// fraîcheur, créneaux à travers le changement d'heure, décision d'une série et son
// idempotence, et le VOCABULAIRE des phrases produites (A2 § 7.0 et § 8.9).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deciderSerie, heuresEvaluees } from "../../packages/backend/jobs/detections.mjs";
import {
  FRAICHEUR_MAX_MS,
  SIGMA_MIN,
  bandeAttendue,
  choisirReference,
  decalageMin,
  entiteSerie,
  evaluerHeure,
  gardeFraicheur,
  instantsReference,
  madEchelle,
  mediane,
  memeHeureLocale,
  phraseEpisode,
  priorite,
  sigmaEchantillon,
  suivreEpisode,
  transformer,
} from "../../packages/backend/shared/plage-habituelle.mjs";

const H = 3_600_000;
const T0 = Date.parse("2026-09-28T12:00:00Z"); // un lundi, 14:00 à Paris

describe("centre et dispersion robustes", () => {
  it("médiane paire et impaire", () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(mediane([]))).toBe(true);
  });

  it("le MAD ignore une valeur aberrante, l'écart-type non", () => {
    const serie = [10, 10.2, 9.8, 10.1, 9.9, 10, 1000];
    expect(madEchelle(serie)).toBeCloseTo(1.4826 * 0.1, 6);
  });

  it("une série parfaitement stable garde une plage non nulle (plancher ln 1,05)", () => {
    const ref = Array(12).fill(Math.log(2000));
    const e = evaluerHeure({ nom: "LCP", p75: 2000 }, ref)!;
    expect(e.sigma).toBeCloseTo(SIGMA_MIN, 12);
    expect(e.haut).toBeGreaterThan(e.bas);
    expect(e.z).toBeCloseTo(0, 12);
  });

  it("z robuste : 3 écarts au-dessus de la médiane, en échelle logarithmique", () => {
    const ref = Array(12).fill(Math.log(2000));
    const valeur = 2000 * Math.exp(3 * SIGMA_MIN);
    expect(evaluerHeure({ nom: "LCP", p75: valeur }, ref)!.z).toBeCloseTo(3, 9);
  });

  it("le bruit d'échantillonnage élargit la plage d'une heure creuse", () => {
    const ref = Array(12).fill(Math.log(2000));
    const sans = evaluerHeure({ nom: "LCP", p75: 2400 }, ref)!;
    const avec = evaluerHeure({ nom: "LCP", p75: 2400, p75Bas: 1500, p75Haut: 3500 }, ref)!;
    expect(sigmaEchantillon("LCP", 1500, 3500)).toBeCloseTo((Math.log(3500) - Math.log(1500)) / (2 * 1.96), 12);
    expect(avec.sigmaTot).toBeGreaterThan(sans.sigmaTot);
    expect(Math.abs(avec.z)).toBeLessThan(Math.abs(sans.z));
  });

  it("le CLS nul reste transformable (décalage 0,01) ; une valeur négative ne l'est pas", () => {
    expect(transformer("CLS", 0)).toBeCloseTo(Math.log(0.01), 12);
    expect(transformer("LCP", 0)).toBeNull();
    expect(transformer("LCP", -1)).toBeNull();
  });

  it("bande sans valeur de l'heure : médiane et ± 3 écarts de la référence seule", () => {
    const b = bandeAttendue("LCP", Array(10).fill(Math.log(1000)))!;
    expect(b.mediane).toBeCloseTo(1000, 6);
    expect(b.bas).toBeCloseTo(1000 * Math.exp(-3 * SIGMA_MIN), 6);
    expect(bandeAttendue("LCP", [])).toBeNull();
  });
});

describe("épisodes : deux heures au-dessus de 3, fermeture après deux heures à 2 ou moins", () => {
  it("une heure isolée au-dessus de 3 n'ouvre rien", () => {
    expect(suivreEpisode([0.5, 4, 0.2, 1])).toEqual({ ouvert: false, debut: null, fin: null });
  });

  it("deux heures consécutives ouvrent, à la première des deux", () => {
    expect(suivreEpisode([0.5, 1, 3.4, 4.1])).toEqual({ ouvert: true, debut: 2, fin: null });
  });

  it("trois heures sur quatre ouvrent, même non consécutives", () => {
    expect(suivreEpisode([3.5, 1, 3.2, 1])).toMatchObject({ ouvert: false });
    expect(suivreEpisode([3.5, 1, 3.2, 3.9]).ouvert).toBe(true);
    expect(suivreEpisode([3.5, 2.5, 3.2, 3.1]).debut).toBe(2);
  });

  it("hystérésis : une heure à 2,5 ne ferme pas ; deux heures à 2 ou moins ferment", () => {
    expect(suivreEpisode([2.5, 2.6], true)).toEqual({ ouvert: true, debut: null, fin: null });
    expect(suivreEpisode([1.9, 3.5, 2, 1.5], true)).toEqual({ ouvert: false, debut: null, fin: 2 });
  });

  it("une heure non évaluée n'ouvre ni ne ferme", () => {
    expect(suivreEpisode([3.5, null, 3.6]).ouvert).toBe(false);
    expect(suivreEpisode([1, null, 1.2], true).ouvert).toBe(false);
    expect(suivreEpisode([1, null], true).ouvert).toBe(true);
  });

  it("le sens favorable ne fait pas de constat", () => {
    expect(suivreEpisode([-5, -6, -7, -8]).ouvert).toBe(false);
  });
});

describe("garde de fraîcheur (A2 § 7.0)", () => {
  it("au-delà de 15 min sans ingestion : suspendue, avec le retard écrit", () => {
    const g = gardeFraicheur(T0, T0 - FRAICHEUR_MAX_MS - 60_000);
    expect(g.suspendue).toBe(true);
    expect(g.raison).toContain("16 min");
  });
  it("à 15 min tout juste : active ; sans aucune ingestion : suspendue", () => {
    expect(gardeFraicheur(T0, T0 - FRAICHEUR_MAX_MS).suspendue).toBe(false);
    expect(gardeFraicheur(T0, null).suspendue).toBe(true);
  });
});

describe("créneaux locaux et références", () => {
  it("à travers le passage à l'heure d'hiver, la même heure LOCALE une semaine plus tôt", () => {
    const apres = Date.parse("2026-10-26T10:00:00Z"); // 11:00 à Paris (UTC+1)
    const avant = memeHeureLocale(apres, 7);
    expect(new Date(avant).toISOString()).toBe("2026-10-19T09:00:00.000Z"); // 11:00 à Paris (UTC+2)
    expect(decalageMin(apres)).toBe(60);
    expect(decalageMin(avant)).toBe(120);
  });

  it("instants : 18 hebdomadaires, 42 quotidiens, 48 horaires", () => {
    const i = instantsReference(T0);
    expect(i.hebdomadaire).toHaveLength(18);
    expect(i.quotidien).toHaveLength(42);
    expect(i["48h"]).toHaveLength(48);
  });

  it("repli : hebdomadaire dès 9 valeurs, sinon quotidien (15), sinon 48 h (24), sinon aucune plage", () => {
    const i = instantsReference(T0);
    const seul = (liste: number[]) => (ms: number) => (liste.includes(ms) ? Math.log(2000) : null);
    expect(choisirReference(T0, seul(i.hebdomadaire.slice(0, 9)))?.niveau).toBe("hebdomadaire");
    expect(choisirReference(T0, seul(i.quotidien.slice(0, 15)))?.niveau).toBe("quotidien");
    expect(choisirReference(T0, seul(i["48h"].slice(0, 24)))?.niveau).toBe("48h");
    // 40 heures d'historique : aucune bande (A2 § 7.8).
    expect(choisirReference(T0, seul(i["48h"].slice(0, 23)))).toBeNull();
  });
});

describe("priorité (A2 § 7.6)", () => {
  it("impact × ampleur × confiance, bornée à [0 ; 1]", () => {
    expect(priorite({ part: 1, ecartRelatif: 0.5, z: 6 })).toBe(1);
    expect(priorite({ part: 0.5, ecartRelatif: 0.25, z: 3 })).toBeCloseTo(0.125, 12);
    expect(priorite({ part: 2, ecartRelatif: -3, z: -12 })).toBe(1);
    expect(priorite({ part: NaN, ecartRelatif: 1, z: 1 })).toBe(0);
  });
});

/** Une série synthétique : 48 h de référence stables, puis les 4 heures évaluées. */
function serie(valeursEvaluees: number[], maintenant = T0 + 5 * 60_000) {
  const heures = heuresEvaluees(maintenant);
  const lignes = new Map<number, { n: number; p75: number | null; p75_bas: number | null; p75_haut: number | null }>();
  for (let k = 1; k <= 60; k++) lignes.set(heures[0] - k * H, { n: 100, p75: 2000 * (1 + 0.01 * ((k % 5) - 2)), p75_bas: null, p75_haut: null });
  heures.forEach((h, i) => lignes.set(h, { n: 100, p75: valeursEvaluees[i], p75_bas: null, p75_haut: null }));
  return { heures, lignes };
}

describe("décision d'une série, et son idempotence", () => {
  it("une marche de +40 % pendant les deux dernières heures ouvre UN épisode, daté de sa première heure", () => {
    const { heures, lignes } = serie([2000, 2010, 2800, 2800]);
    const d = deciderSerie({ nom: "LCP", route: "", lignes, totaux: new Map(), episodes: [], heures });
    expect(d.action?.type).toBe("ouvrir");
    const l = (d.action as { ligne: { debutMs: number; statut: string; preuves: { phrase: string; n: number; z: number } } }).ligne;
    expect(l.debutMs).toBe(heures[2]);
    expect(l.statut).toBe("ouvert");
    expect(l.preuves.n).toBe(100);
    expect(l.preuves.z).toBeGreaterThan(3);
  });

  it("REJOUÉ avec l'épisode ouvert : il le suit, sans le refermer sur les heures calmes d'avant son début", () => {
    const { heures, lignes } = serie([2000, 2010, 2800, 2800]);
    const episodes = [{ id: 7, debutMs: heures[2], finMs: null, statut: "ouvert" }];
    const d = deciderSerie({ nom: "LCP", route: "", lignes, totaux: new Map(), episodes, heures });
    expect(d.action?.type).toBe("suivre");
  });

  it("deux heures revenues dans la plage le ferment, à la première heure calme", () => {
    const { heures, lignes } = serie([2800, 2800, 2000, 2010]);
    const episodes = [{ id: 7, debutMs: heures[0], finMs: null, statut: "ouvert" }];
    const d = deciderSerie({ nom: "LCP", route: "", lignes, totaux: new Map(), episodes, heures });
    expect(d.action).toEqual({ type: "fermer", id: 7, finMs: heures[2] });
  });

  it("budget de bruit : un épisode refermé il y a moins de 6 h ne renaît pas", () => {
    const { heures, lignes } = serie([2000, 2010, 2800, 2800]);
    const episodes = [{ id: 3, debutMs: heures[0] - 8 * H, finMs: heures[0] - 2 * H, statut: "clos" }];
    const d = deciderSerie({ nom: "LCP", route: "", lignes, totaux: new Map(), episodes, heures });
    expect(d.action).toBeNull();
    expect(d.budget).toBe(true);
  });

  it("une heure creuse (n < 13) n'est pas évaluée", () => {
    const { heures, lignes } = serie([2000, 2010, 2800, 2800]);
    lignes.set(heures[3], { n: 12, p75: 2800, p75_bas: null, p75_haut: null });
    const d = deciderSerie({ nom: "LCP", route: "", lignes, totaux: new Map(), episodes: [], heures });
    expect(d.evaluees).toBe(3);
    expect(d.action).toBeNull();
  });

  it("la part d'une route est celle de ses mesures dans l'heure", () => {
    const { heures, lignes } = serie([2000, 2010, 2800, 2800]);
    const totaux = new Map(heures.map((h) => [h, 400]));
    const d = deciderSerie({ nom: "LCP", route: "/checkout", lignes, totaux, episodes: [], heures });
    const l = (d.action as { ligne: { entite: string; impact: { part_mesures: number } } }).ligne;
    expect(l.entite).toBe(entiteSerie("LCP", "/checkout"));
    expect(l.impact.part_mesures).toBe(0.25);
  });
});

// ── Vocabulaire (A2 § 7.0, § 8.8 et § 8.9) : un gabarit, pas une relecture ────
const INTERDITS = [/\bcause/i, /\bcaus[ée]/i, /l['’]IA\b/i, /\bIA\b/, /intelligence artificielle/i, /avec certitude/i, /\bprédi[tc]/i, /\bpense\b/i];

describe("vocabulaire des constats", () => {
  const phrases = [
    phraseEpisode({ nom: "LCP", route: "/checkout", valeur: 3100, mediane: 2200, z: 3.4, n: 312, debutMs: T0, niveau: "hebdomadaire", legende: "même heure, même jour, 3 à 6 dernières semaines" }),
    phraseEpisode({ nom: "CLS", route: "", valeur: 0.12, mediane: 0.05, z: 4.2, n: 80, debutMs: T0, niveau: "quotidien", legende: "même heure, 7 à 14 derniers jours" }),
    phraseEpisode({ nom: "INP", route: "", valeur: 180, mediane: 120, z: 3.1, n: 40, debutMs: T0, niveau: "48h", legende: "48 dernières heures, sans saisonnalité" }),
  ];

  it("chaque phrase porte un fait chiffré, son effectif, « écarts robustes » et « plage habituelle »", () => {
    for (const p of phrases) {
      expect(p).toMatch(/\d+ mesures/);
      expect(p).toContain("écarts robustes");
      expect(p).toContain("plage habituelle");
      expect(p).toContain("Détecté par calcul");
    }
    expect(phrases[0]).toBe(
      "LCP p75 de /checkout à 3,1 s depuis 14:00, contre 2,2 s habituellement le lundi à cette heure " +
        "(3,4 écarts robustes, 312 mesures). Détecté par calcul ; plage habituelle : même heure, même jour, 3 à 6 dernières semaines.",
    );
  });

  it("aucune phrase, ni aucun texte des modules, ne prête une cause ou une intention au calcul", () => {
    const racine = join(__dirname, "..", "..");
    const sources = [
      "packages/backend/shared/plage-habituelle.mjs",
      "packages/backend/jobs/detections.mjs",
      "apps/console/lib/queries-detections.ts",
      "apps/console/lib/chargeurs/constats.ts",
      "apps/console/lib/chargeurs/vital-horaire.ts",
      // Vague 3b : ce qui porte les détections à l'écran.
      "apps/console/lib/chargeurs/detections-accueil.ts",
      "apps/console/lib/detections-ecran.ts",
      "apps/console/components/vue-ensemble/ConstatsDetectes.tsx",
    ]
      .map((f) => readFileSync(join(racine, f), "utf8"))
      // Les commentaires expliquent la règle (et la nomment) : ils ne vont pas à l'écran.
      .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));
    // Les chaînes littérales des modules : ce qui peut finir à l'écran.
    const litteraux = sources.flatMap((s) => [...s.matchAll(/"([^"\n]{12,})"|`([^`]{12,})`/g)].map((m) => m[1] ?? m[2]));
    for (const texte of [...phrases, ...litteraux]) {
      for (const motif of INTERDITS) expect(texte, texte).not.toMatch(motif);
    }
  });
});
