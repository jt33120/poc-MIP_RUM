// KpiTile (F03, plan § 4.2, § 3.2, § 3.12) : ce que la tuile refuse d'affirmer.
// Rendu SSR réel : on vérifie le texte que l'utilisateur lira.
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import {
  KpiTile,
  TEXTE_ECHANTILLON_DELTA,
  TEXTE_REFERENCE_NULLE,
  comparaisonDeTuile,
} from "@/components/charts/KpiTile";

type Props = ComponentProps<typeof KpiTile>;

const REFERENCE = "vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC)";
const COMPLETE = { etat: "complete", raison: null, n: 1200 } as const;
const BASE: Props = {
  label: "LCP p75",
  valeur: 2700,
  format: "ms",
  vital: "LCP",
  precedent: 2500,
  reference: REFERENCE,
  couverturePrecedente: COMPLETE,
  couverture: { n: 1240, unite: "mesures" },
};

const rendu = (props: Partial<Props> = {}) => renderToStaticMarkup(<KpiTile {...BASE} {...props} />);
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");
const aDelta = (html: string) => html.includes('data-testid="delta"');
/** Un delta chiffré : « +8 % », « −3 % », « 0 % ». */
const DELTA_CHIFFRE = /[+-]?\d+ %/;

describe("KpiTile — valeur inconnue (V3)", () => {
  it("null → « — » et la raison ; ni delta, ni verdict, ni alerte", () => {
    const html = rendu({
      valeur: null,
      raisonNull: "aucune page vue sur la période : pas de dénominateur",
      alerte: { si: ">", valeur: 0, regle: "aucun canal" },
    });
    const t = texte(html);
    expect(t).toContain("—");
    expect(t).toContain("aucune page vue sur la période : pas de dénominateur");
    expect(t).not.toMatch(/\b0\b/);
    expect(aDelta(html)).toBe(false);
    expect(html).not.toContain('data-testid="kpi-verdict"');
    expect(html).toContain('data-ton="neutre"');
    expect(t).not.toContain("aucun canal");
  });
});

describe("KpiTile — comparaison", () => {
  it("delta chiffré avec sa référence visible, couleur selon sensMeilleur", () => {
    const html = rendu();
    const t = texte(html);
    expect(aDelta(html)).toBe(true);
    expect(t).toContain("↑ +8 %");
    expect(t).toContain(REFERENCE);
    // Vital : monter, c'est se dégrader.
    expect(html).toMatch(/text-bad-ink[^"]*">↑/);
  });

  it("précédent null → « pas de mesure sur <référence> », sans chiffre", () => {
    const html = rendu({ precedent: null });
    expect(texte(html)).toContain("pas de mesure sur 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC)");
    expect(aDelta(html)).toBe(false);
  });

  it("précédent 0 → texte exact « pas de mesure de référence non nulle », jamais +∞ %", () => {
    const html = rendu({ label: "Occurrences d'erreurs", vital: undefined, format: "count", valeur: 12, precedent: 0 });
    expect(TEXTE_REFERENCE_NULLE).toBe("pas de mesure de référence non nulle");
    expect(html).toContain(">pas de mesure de référence non nulle<");
    expect(texte(html)).not.toMatch(/∞|Infinity|NaN/);
    expect(aDelta(html)).toBe(false);
  });

  it("couverture précédente partielle → sa raison, et aucun « % » de delta", () => {
    const html = rendu({
      couverturePrecedente: {
        etat: "partielle",
        raison: "période précédente hors rétention (30 jours) : les données les plus anciennes ont été purgées",
      },
    });
    const t = texte(html);
    expect(t).toContain(
      "période précédente incomplète : période précédente hors rétention (30 jours) : les données les plus anciennes ont été purgées",
    );
    expect(aDelta(html)).toBe(false);
    expect(t).not.toMatch(DELTA_CHIFFRE);
  });

  it("la couverture prime : une période purgée qui rend précédent null dit sa vraie cause", () => {
    const t = texte(rendu({ precedent: null, couverturePrecedente: { etat: "inconnue", raison: "début de collecte non lu" } }));
    expect(t).toContain("période précédente incomplète : début de collecte non lu");
    expect(t).not.toContain("pas de mesure sur");
  });

  it("échantillon faible sur la période courante → pas de delta, et le texte le dit", () => {
    const html = rendu({ couverture: { n: 40, unite: "mesures" } });
    const t = texte(html);
    expect(t).toContain(TEXTE_ECHANTILLON_DELTA);
    expect(t).toContain("échantillon faible");
    expect(aDelta(html)).toBe(false);
  });

  it("échantillon faible sur la période précédente → pas de delta non plus", () => {
    const html = rendu({ couverturePrecedente: { etat: "complete", raison: null, n: 12 } });
    expect(texte(html)).toContain(TEXTE_ECHANTILLON_DELTA);
    expect(aDelta(html)).toBe(false);
  });

  it("sans référence écrite, pas de delta (P4)", () => {
    expect(aDelta(rendu({ reference: undefined }))).toBe(false);
  });

  it("sans précédent (cmp=none), ni delta ni phrase de comparaison", () => {
    const html = rendu({ precedent: undefined, reference: undefined, couverturePrecedente: undefined });
    expect(aDelta(html)).toBe(false);
    expect(html).not.toContain('data-testid="kpi-comparaison"');
  });

  it("sous ±2 % : « → », sans couleur", () => {
    const html = rendu({ valeur: 2520 });
    expect(texte(html)).toContain("→ +1 %");
    expect(html).not.toMatch(/text-(bad|good)-ink[^"]*">→/);
  });

  it("sensMeilleur neutre (un volume) : flèche sans couleur", () => {
    const html = rendu({ vital: undefined, format: "count", valeur: 1500, precedent: 1000, sensMeilleur: "neutre" });
    expect(texte(html)).toContain("↑ +50 %");
    expect(html).not.toMatch(/text-(bad|good)-ink/);
  });

  it("sensMeilleur haut : monter est une amélioration", () => {
    const html = rendu({ vital: undefined, format: "pct", valeur: 0.96, precedent: 0.9, sensMeilleur: "haut" });
    expect(html).toMatch(/text-good-ink[^"]*">↑/);
  });
});

describe("KpiTile — alerte (R-S)", () => {
  const ALERTE = { si: ">", valeur: 0, regle: "aucun canal : personne n'est prévenu" } as const;
  const sansVital = { vital: undefined, format: "count", precedent: undefined, reference: undefined } as const;

  it("condition fausse (0 > 0) : aucun ton bad, aucune règle", () => {
    const html = rendu({ ...sansVital, label: "Règles sans canal", valeur: 0, alerte: ALERTE });
    expect(html).toContain('data-ton="neutre"');
    expect(html).not.toContain("bad");
    expect(texte(html)).not.toContain("personne n'est prévenu");
  });

  it("condition vraie (3 > 0) : ton bad et règle écrite sous la valeur", () => {
    const html = rendu({ ...sansVital, label: "Règles sans canal", valeur: 3, alerte: ALERTE });
    expect(html).toContain('data-ton="bad"');
    expect(html).toContain('data-testid="kpi-alerte"');
    expect(texte(html)).toContain("aucun canal : personne n'est prévenu");
  });

  it(">= et < : la condition est lue telle qu'écrite", () => {
    expect(rendu({ ...sansVital, valeur: 5, alerte: { si: ">=", valeur: 5, regle: "r" } })).toContain('data-ton="bad"');
    expect(rendu({ ...sansVital, valeur: 5, alerte: { si: "<", valeur: 5, regle: "r" } })).toContain('data-ton="neutre"');
  });

  it("hors vital et hors alerte, la tuile ne porte aucune couleur de verdict", () => {
    const html = rendu({ ...sansVital, valeur: 0.034, format: "pct" });
    expect(html).not.toMatch(/(good|warn|bad)/);
  });
});

describe("KpiTile — verdict d'un vital (R-V, P*.1)", () => {
  it("vital sans intervalle, n = 40 : le badge est rendu (et l'échantillon dit faible)", () => {
    const html = rendu({ couverture: { n: 40, unite: "mesures" } });
    expect(html).toMatch(/data-testid="kpi-verdict"[^>]*>À améliorer</);
    expect(texte(html)).toContain("échantillon faible");
  });

  it("intervalle indisponible : « verdict non établi (moins de 13 mesures) », sans badge coloré", () => {
    const html = rendu({ valeur: 180, vital: "INP", intervalle: { indisponible: "moins de 13 mesures" } });
    expect(texte(html)).toContain("verdict non établi (moins de 13 mesures)");
    expect(html).not.toMatch(/text-(good|warn|bad)-ink border/);
  });

  it("intervalle qui chevauche une borne : verdict incertain et intervalle écrit", () => {
    const html = rendu({ valeur: 2400, intervalle: { bas: 2100, haut: 3000, niveau: 0.95, methode: "quantile_normal" } });
    const t = texte(html);
    expect(t).toContain("verdict incertain : entre Bon et À améliorer");
    expect(t).toContain("entre 2,1 s et 3,0 s (95 %)");
  });

  it("intervalle entièrement dans une zone : badge établi", () => {
    const html = rendu({ valeur: 2000, intervalle: { bas: 1900, haut: 2200, niveau: 0.95, methode: "quantile_normal" } });
    expect(html).toMatch(/data-testid="kpi-verdict"[^>]*>Bon</);
  });

  it("sparkline d'un vital : bande « Bon » en fond", () => {
    const html = rendu({ serie: [2300, null, 2700, 2600] });
    expect(html).toContain('data-testid="sparkline"');
    expect(html).toContain('data-bande="bon"');
  });
});

describe("KpiTile — accessibilité", () => {
  it("href : un seul lien, libellé annoncé complet", () => {
    const html = rendu({ href: "/pages?vital=LCP" });
    expect(html.match(/<a /g)).toHaveLength(1);
    const aria = /aria-label="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(texte(aria)).toBe(
      "LCP p75 2,7 s, À améliorer, +8 % vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC), 1 240 mesures",
    );
  });

  it("sans href : un groupe étiqueté, aucun lien", () => {
    const html = rendu();
    expect(html).not.toContain("<a ");
    expect(html).toContain('role="group"');
  });
});

describe("comparaisonDeTuile — logique pure", () => {
  const base = {
    valeur: 10,
    precedent: 8,
    reference: "période précédente",
    couverturePrecedente: undefined,
    n: 500,
    faibleSous: 100,
  };
  it("delta relatif", () => {
    expect(comparaisonDeTuile(base)).toEqual({ kind: "delta", pct: 25, reference: "période précédente" });
  });
  it("précédent 0 : silence, même si la valeur est 0", () => {
    expect(comparaisonDeTuile({ ...base, precedent: 0 })).toEqual({ kind: "silence", texte: TEXTE_REFERENCE_NULLE });
    expect(comparaisonDeTuile({ ...base, valeur: 0, precedent: 0 })).toEqual({ kind: "silence", texte: TEXTE_REFERENCE_NULLE });
  });
  it("valeur inconnue : aucune comparaison", () => {
    expect(comparaisonDeTuile({ ...base, valeur: null })).toBeNull();
  });
  it("effectif inconnu : il n'empêche pas le delta (seul un effectif connu et faible le fait)", () => {
    expect(comparaisonDeTuile({ ...base, n: null })?.kind).toBe("delta");
  });
});
