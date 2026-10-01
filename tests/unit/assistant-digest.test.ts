// Le condensé du tableau de bord (`lib/assistant/digest.ts`) : ce que l'assistant a le
// droit de dire, et où la page le montre.
//
// CE QUE CES TESTS EMPÊCHENT.
//   - Un fait qui viserait un endroit que la page ne porte pas (un repère inventé, ou
//     un bloc éteint) : le clic sur la source ne surlignerait rien.
//   - Une valeur sans unité, ou écrite autrement que par la case (« 3,2 pour 100 »
//     au lieu de « 3,2 % »).
//   - Le LCP tu parce que son verdict est incertain entre deux mauvais verdicts.
//   - « La page la plus lente » tirée d'une route vue une fois.
//   - Une adresse e-mail d'un message d'erreur envoyée au modèle.
//   - Un condensé trop lourd pour la route (32 Kio).
import { describe, expect, it } from "vitest";
import {
  construireDigestVueEnsemble,
  MAX_OCTETS_DIGEST,
  octetsDigest,
  valeurDeCase,
  type FaitDigest,
} from "../../apps/console/lib/assistant/digest";
import { CASES, entrees, MAINTENANT } from "./assistant-fixtures";

const digest = construireDigestVueEnsemble(entrees());
const fait = (cle: string) => digest.faits.find((f) => f.cle === cle);
const NBSP = " ";

/** Les repères que la Vue d'ensemble porte déjà : aucun fait n'en vise un autre. */
const REPERES = [
  /^#sante$/,
  /^\[data-testid="tuile-(sessions|pages-vues|erreurs|LCP|INP|CLS|FCP|TTFB)"\]$/,
  /^\[data-testid="vignette-(LCP|INP|CLS)"\]$/,
  /^#constats$/,
  /^#constats \[data-testid="constat"\]:nth-child\(\d+\)$/,
  /^#constat-detecte-\d+$/,
  /^#anomalies$/,
  /^#historique$/,
  /^\[data-testid="impact-table"\]$/,
  /^\[data-testid="impact-table"\] \[data-testid="impact-ligne"\]:nth-child\(\d+\)$/,
  /^\[data-testid="release-compare"\]$/,
  /^#charge-erreurs-lcp$/,
  /^#heatmap-latence$/,
  /^\[data-testid="angle-mort"\]$/,
  /^\[data-testid="onboarding-nudge"\]$/,
  /^\[data-testid="r0-(constats|deploiement)"\]$/,
];

describe("condensé de la Vue d'ensemble — forme", () => {
  it("numérote les faits F1, F2… sans trou ni doublon, et date la lecture", () => {
    expect(digest.faits.map((f) => f.id)).toEqual(digest.faits.map((_f, i) => `F${i + 1}`));
    expect(digest).toMatchObject({ version: 1, ecran: "Vue d'ensemble", app: "boutique", periode: "24 h" });
    expect(digest.genereLe).toBe(new Date(MAINTENANT).toISOString());
  });

  it("chaque fait vise un repère que la page porte déjà, et son repli aussi", () => {
    for (const f of digest.faits) {
      expect(REPERES.some((r) => r.test(f.cible)), `${f.cle} → ${f.cible}`).toBe(true);
      if (f.repli) expect(REPERES.some((r) => r.test(f.repli!)), `${f.cle} → repli ${f.repli}`).toBe(true);
    }
  });

  it("chaque fait a une catégorie, un libellé et une valeur écrite", () => {
    for (const f of digest.faits) {
      expect(f.categorie.length, f.cle).toBeGreaterThan(0);
      expect(f.libelle.length, f.cle).toBeGreaterThan(0);
      expect(f.valeur.length, f.cle).toBeGreaterThan(0);
    }
  });

  it("couvre chaque bloc lu : santé, cases, constats, graphique, latence, charge, angle mort, segments, release, historique, anomalies", () => {
    const cles = digest.faits.map((f) => f.cle);
    for (const attendu of [
      "sante",
      "sante:vitals",
      "tuile:sessions",
      "tuile:erreurs",
      "tuile:LCP",
      "constats",
      "detecte:17",
      "serie:LCP",
      "datation",
      "latence",
      "charge:vues",
      "charge:erreurs",
      "angle-mort",
      "segments:route:LCP",
      "segment:route:1",
      "segment-faible:route:1",
      "release",
      "historique",
      "anomalies",
      "anomalie:1",
    ]) {
      expect(cles, attendu).toContain(attendu);
    }
  });
});

describe("condensé — valeurs écrites comme la case", () => {
  it("un compte porte ce qu'il compte, une durée son unité, « pour 100 » s'écrit %", () => {
    expect(fait("tuile:sessions")?.valeur).toBe(`1${" "}240${NBSP}sessions`);
    expect(fait("tuile:pages-vues")?.valeur).toMatch(/^5\s678 pages vues$/);
    expect(fait("tuile:erreurs")?.valeur).toBe(`3,2${NBSP}%`);
    expect(fait("tuile:LCP")?.valeur).toBe(`4,8${NBSP}s`);
    expect(fait("tuile:INP")?.valeur).toBe(`80${NBSP}ms`);
    expect(valeurDeCase("cls", 0.0312)).toBe("0,031");
    expect(valeurDeCase("ms", null)).toBe("—");
  });

  it("une case en échec ou sans valeur dit pourquoi, jamais « 0 »", () => {
    expect(fait("tuile:CLS")).toMatchObject({ valeur: "—", detail: "lecture en échec : valeur non lue" });
    expect(fait("tuile:TTFB")).toMatchObject({ valeur: "—", detail: "aucune mesure TTFB sur 24 h" });
  });

  it("la variation d'une case est écrite avec sa référence, et son sens jugé", () => {
    const sessions = fait("tuile:sessions")!;
    expect(sessions.variation).toBe(`+24${NBSP}% vs 24 h précédentes (29/09 14:00 → 30/09 14:00)`);
    expect(sessions.ecartPct).toBe(24);
    // Le trafic n'a pas de sens favorable : ni dégradation, ni amélioration.
    expect(sessions.degradation).toBeUndefined();
    const lcp = fait("tuile:LCP")!;
    expect(lcp.ecartPct).toBeCloseTo(23.1, 1);
    expect(lcp.degradation).toBe(true);
    expect(fait("tuile:erreurs")?.degradation).toBe(true);
  });

  it("un verdict incertain entre deux mauvais verdicts est hors du vert — le LCP n'est pas tu", () => {
    const lcp = fait("tuile:LCP")!;
    expect(lcp.ton).toBe("moyen");
    expect(lcp.verdict).toBe("À améliorer ou Mauvais, incertain");
    expect(lcp.detail).toMatch(/entre 3,2\ss et 6,3\ss \(95 %\)/);
    expect(lcp.detail).toContain("276 mesures");
    expect(fait("tuile:FCP")).toMatchObject({ ton: "mauvais", verdict: "Mauvais" });
    expect(fait("tuile:INP")).toMatchObject({ ton: "bon", verdict: "Bon" });
  });

  it("une variation sans période précédente complète se tait, et dit pourquoi", () => {
    const d = construireDigestVueEnsemble(
      entrees({
        cases: [
          {
            cle: "LCP",
            titre: "LCP p75",
            props: { ...(CASES[3] as { props: object }).props, couverturePrecedente: { etat: "partielle", raison: "rétention de 7 jours" } } as never,
          },
        ],
      }),
    );
    const lcp = d.faits.find((f) => f.cle === "tuile:LCP")!;
    expect(lcp.variation).toBeUndefined();
    expect(lcp.detail).toContain("variation non affichée : période précédente incomplète (rétention de 7 jours)");
    // Une référence à zéro : pas de « +∞ % », la raison est écrite.
    const zero = construireDigestVueEnsemble(
      entrees({ cases: [{ cle: "sessions", titre: "Sessions", props: { label: "Sessions commencées", valeur: 12, format: "count", precedent: 0, reference: "vs 24 h précédentes" } }] }),
    );
    expect(zero.faits.find((f) => f.cle === "tuile:sessions")?.detail).toBe("variation non affichée : la valeur de référence est nulle sur 24 h précédentes");
  });
});

describe("condensé — santé, constats, segments", () => {
  it("la santé et ses composantes, avec les points perdus pour ordonner", () => {
    expect(fait("sante")).toMatchObject({ valeur: `72${NBSP}/${NBSP}100`, ton: "moyen", cible: "#sante" });
    expect(fait("sante")?.detail).toMatch(/^Dégradé/);
    expect(fait("sante:vitals")).toMatchObject({ valeur: `24,6${NBSP}/${NBSP}40${NBSP}points` });
    expect(fait("sante:vitals")?.poids).toBeCloseTo(15.4, 5);
    expect(fait("sante:anomalies")).toMatchObject({ valeur: "—", detail: "non testable", poids: 0 });
  });

  it("chaque constat vise SA ligne de la colonne, et l'écart détecté sa carte", () => {
    expect(fait("constats")).toMatchObject({ valeur: `4${NBSP}constats`, ton: "mauvais", cible: "#constats" });
    expect(fait("constat:alerte:1")?.cible).toBe('#constats [data-testid="constat"]:nth-child(1)');
    expect(fait("constat:anomalie:3")?.cible).toBe('#constats [data-testid="constat"]:nth-child(3)');
    expect(fait("detecte:17")).toMatchObject({ cible: "#constat-detecte-17", repli: "#constats", ton: "mauvais" });
  });

  it("sans constat, la colonne se tait : le fait vise le compte du bandeau, puis le tableau des anomalies", () => {
    const d = construireDigestVueEnsemble(
      entrees({ constats: { liste: [], echecs: [], detectes: { kind: "absent" }, affiches: false } }),
    );
    const c = d.faits.find((f) => f.cle === "constats")!;
    expect(c).toMatchObject({ valeur: `0${NBSP}constat`, ton: "bon", cible: '[data-testid="r0-constats"]', repli: "#anomalies" });
    expect(c.detail).toContain("rien à signaler");
  });

  it("le dernier déploiement, écrit dans le bandeau « En bref »", () => {
    const d = construireDigestVueEnsemble(entrees({ deploiement: { version: "2.4.0", ts: "2026-09-30T09:00:00Z" } }));
    expect(d.faits.find((f) => f.cle === "deploiement")).toMatchObject({
      valeur: "2.4.0",
      detail: "le 30/09/2026 à 11:00",
      cible: '[data-testid="r0-deploiement"]',
    });
    const echec = construireDigestVueEnsemble(entrees({ deploiement: "echec" }));
    expect(echec.faits.find((f) => f.cle === "deploiement")).toMatchObject({ valeur: "—", detail: "déploiements non lus" });
  });

  it("aucune adresse e-mail d'un message d'erreur ne sort : elle est masquée", () => {
    const regression = digest.faits.find((f) => f.cle.startsWith("constat:regression:"))!;
    expect(regression.valeur).toContain("[adresse masquée]");
    expect(JSON.stringify(digest)).not.toMatch(/@example\.com/);
  });

  it("les pires segments assez mesurés d'abord, les échantillons faibles à part", () => {
    const fiables = digest.faits.filter((f) => f.cle.startsWith("segment:route:"));
    expect(fiables.map((f) => f.libelle)).toEqual([
      "Route « /checkout » · LCP p75",
      "Route « /produit/:id » · LCP p75",
      "Route « /login » · LCP p75",
    ]);
    // La ligne de la table est celle de l'écran (ordre reçu), pas celle du tri des pires.
    expect(fiables[1].cible).toBe('[data-testid="impact-table"] [data-testid="impact-ligne"]:nth-child(4)');
    expect(fiables[0]).toMatchObject({ degradation: true, ton: "mauvais" });
    expect(fiables[2]).toMatchObject({ degradation: false });
    const faible = fait("segment-faible:route:1")!;
    expect(faible.libelle).toContain("/installer");
    expect(faible.detail).toContain("échantillon faible");
  });

  it("la release, l'historique, la latence, la charge et l'angle mort sont chiffrés", () => {
    expect(fait("release")).toMatchObject({ libelle: "Release 2.4.0 face à 2.3.0", variation: `LCP p75 +20${NBSP}% vs 2.3.0` });
    // (10 + 90 + 1) / (40 + 100 + 2) = 71,1 %.
    expect(fait("historique")?.valeur).toBe(`71,1${NBSP}%`);
    // Le pire créneau parmi ceux qui ont de quoi être lus (13 mesures au moins).
    expect(fait("historique")?.detail).toContain("pire créneau : 29/09/2026 à 14 h (25,0");
    // La colonne faible (5 mesures, 9 s) n'est pas « l'heure la plus lente ».
    expect(fait("latence")).toMatchObject({ valeur: `5,2${NBSP}s`, ton: "mauvais" });
    expect(fait("charge:vues")?.valeur).toBe(`342${NBSP}pages vues`);
    expect(fait("charge:erreurs")?.detail).toContain("12 occurrences sur la période");
    expect(fait("angle-mort")).toMatchObject({ valeur: `3${NBSP}heures` });
    expect(fait("datation")).toMatchObject({ valeur: "non datable" });
  });
});

describe("condensé — ce que l'écran n'affiche pas n'y entre pas", () => {
  it("un bloc éteint (null) ne donne aucun fait, donc aucune cible absente", () => {
    const d = construireDigestVueEnsemble(
      entrees({ sante: null, series: null, datation: null, latence: null, charge: null, segments: null, release: null, historique: null, angleMort: null, anomalies: null }),
    );
    const cibles = new Set(d.faits.map((f: FaitDigest) => f.cible));
    for (const absente of ["#sante", "#historique", "#heatmap-latence", "#charge-erreurs-lcp", '[data-testid="release-compare"]', '[data-testid="impact-table"]']) {
      expect(cibles.has(absente), absente).toBe(false);
    }
  });

  it("une santé en échec se dit, sans score", () => {
    const d = construireDigestVueEnsemble(entrees({ sante: "echec" }));
    expect(d.faits.find((f) => f.cle === "sante")).toMatchObject({ valeur: "—", detail: "lecture en échec" });
  });

  it("aucune visite sur la période : le bandeau d'intégration est la première source", () => {
    const d = construireDigestVueEnsemble(entrees({ sansVisite: { titre: "Aucune visite sur 24 h.", detail: "Le capteur n'a rien envoyé." } }));
    expect(d.faits[0]).toMatchObject({ id: "F1", cle: "sans-visite", cible: '[data-testid="onboarding-nudge"]' });
  });
});

describe("condensé — poids", () => {
  it("le condensé le plus chargé tient sous la borne, loin des 32 Kio de la route", () => {
    const long = "x".repeat(400);
    const lourd = entrees({
      constats: {
        liste: Array.from({ length: 30 }, (_v, i) => ({ type: "alerte" as const, titre: `${long} ${i}`, regle: long, href: "/alerts" })),
        echecs: [],
        detectes: {
          kind: "ok",
          ouverts: 12,
          clos: 0,
          cartes: Array.from({ length: 12 }, (_v, i) => ({
            id: i,
            titre: long,
            preuve: long,
            effectif: long,
            phrase: null,
            priorite: 0.9,
            niveauPriorite: "haute" as const,
            enCours: true,
            methode: [],
          })),
        },
        affiches: true,
      },
    });
    const d = construireDigestVueEnsemble(lourd);
    expect(octetsDigest(d)).toBeLessThanOrEqual(MAX_OCTETS_DIGEST);
    // Les textes sont bornés : un titre de 400 caractères est coupé, avec « … ».
    expect(d.faits.find((f) => f.cle === "constat:alerte:1")!.valeur.length).toBeLessThanOrEqual(140);
    expect(d.faits.find((f) => f.cle === "constat:alerte:1")!.valeur.endsWith("…")).toBe(true);
    // Au plus 8 constats et 5 écarts détectés nommés.
    expect(d.faits.filter((f) => f.cle.startsWith("constat:")).length).toBe(8);
    expect(d.faits.filter((f) => f.cle.startsWith("detecte:")).length).toBe(5);
  });

  it("le condensé ordinaire pèse quelques kilo-octets", () => {
    expect(octetsDigest(digest)).toBeLessThan(16 * 1024);
  });
});
