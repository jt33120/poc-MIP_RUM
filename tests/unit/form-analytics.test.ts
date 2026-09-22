// Form Analytics — agrégats par formulaire et par champ (F51, plan § 5.15).
// Logique pure : ordre médian de remplissage, médiane des soumissions, garde
// « échantillon faible » du classement, segments d'une barre de champ, abandons
// incohérents.
import { describe, expect, it } from "vitest";
import {
  fieldReport,
  formReport,
  mediane,
  medianeSoumissionMs,
  quantile,
  SEUIL_ECHANTILLON_FAIBLE,
  type FormEvent,
  type FormFieldProps,
} from "../../apps/console/lib/form-analytics";

const submit = (form: string, fields: FormFieldProps[], t = 1000): FormEvent => ({
  name: "form.submit",
  props: { form, submitted: true, fields, total_time_ms: t },
});
const abandon = (form: string, fields: FormFieldProps[], last: string | null, t = 500): FormEvent => ({
  name: "form.abandon",
  props: { form, submitted: false, fields, total_time_ms: t, last_field: last },
});

/** n copies d'un événement : sème un effectif en une instruction. */
const fois = (n: number, e: FormEvent): FormEvent[] => Array.from({ length: n }, () => e);

describe("mediane / quantile", () => {
  it("médiane d'un effectif impair, puis pair (demi-somme des deux valeurs centrales)", () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([1, 2, 3, 4])).toBe(2.5);
  });
  it("échantillon vide -> null, jamais 0 (V3)", () => {
    expect(mediane([])).toBeNull();
    expect(quantile([], 0.75)).toBeNull();
  });
  it("p75 par interpolation : [1000, 2000, 3000, 4000] -> 3 250", () => {
    expect(quantile([1000, 2000, 3000, 4000], 0.75)).toBe(3250);
  });
  it("ignore les valeurs non finies", () => {
    expect(mediane([1, Number.NaN, 3])).toBe(2);
  });
});

describe("medianeSoumissionMs", () => {
  it("médiane des SOUMISSIONS seules : un abandon rapide ne raccourcit rien", () => {
    const events = [
      submit("f", [{ name: "a" }], 10_000),
      submit("f", [{ name: "a" }], 20_000),
      submit("f", [{ name: "a" }], 30_000),
      abandon("f", [{ name: "a" }], "a", 100),
      abandon("f", [{ name: "a" }], "a", 100),
    ];
    expect(medianeSoumissionMs(events)).toBe(20_000);
  });
  it("aucune soumission -> null", () => {
    expect(medianeSoumissionMs([abandon("f", [{ name: "a" }], "a")])).toBeNull();
  });
});

describe("formReport — classement par abandons, garde n < 30", () => {
  it("un formulaire entamé 12 fois ne passe pas devant un formulaire entamé 400 fois", () => {
    // « petit » : 12 entamés, 12 abandons (100 % d'abandon) ; « gros » : 400 entamés,
    // 100 abandons. Le petit a le pire taux, mais l'effectif ne le porte pas.
    const events = [
      ...fois(12, abandon("petit", [{ name: "a", order: 1 }], "a")),
      ...fois(100, abandon("gros", [{ name: "a", order: 1 }], "a")),
      ...fois(300, submit("gros", [{ name: "a", order: 1 }], 4000)),
    ];
    const r = formReport(events);
    expect(r.map((x) => x.form)).toEqual(["gros", "petit"]);
    const gros = r[0];
    const petit = r[1];
    expect(gros).toMatchObject({ starters: 400, submits: 300, abandons: 100, faible: false });
    expect(petit).toMatchObject({ starters: 12, submits: 0, abandons: 12, faible: true });
    expect(SEUIL_ECHANTILLON_FAIBLE).toBe(30);
  });

  it("conversion = submits / starters ; médiane des soumissions par formulaire", () => {
    const events = [
      submit("checkout", [{ name: "email" }], 2000),
      submit("checkout", [{ name: "email" }], 6000),
      abandon("checkout", [{ name: "email" }], "email"),
      abandon("checkout", [{ name: "email" }], "email"),
    ];
    const co = formReport(events)[0];
    expect(co.conversion).toBeCloseTo(0.5);
    expect(co.medianeSoumissionMs).toBe(4000);
  });

  it("form manquant -> (inconnu)", () => {
    expect(formReport([{ name: "form.submit", props: {} }])[0].form).toBe("(inconnu)");
  });
});

describe("fieldReport — ordre médian de remplissage", () => {
  it("[1,2,3], [2,1,3], [1,2,3] : le champ A est premier", () => {
    const rangs: [number, number, number][] = [
      [1, 2, 3],
      [2, 1, 3],
      [1, 2, 3],
    ];
    const events = rangs.map(([a, b, c]) =>
      submit("f", [
        { name: "A", order: a },
        { name: "B", order: b },
        { name: "C", order: c },
      ]),
    );
    const { champs } = fieldReport(events, "f");
    expect(champs.map((x) => x.name)).toEqual(["A", "B", "C"]);
    expect(champs[0].ordreMedian).toBe(1); // [1, 2, 1] -> 1
    expect(champs[1].ordreMedian).toBe(2); // [2, 1, 2] -> 2
    expect(champs[2].ordreMedian).toBe(3);
  });

  it("l'ordre n'est PAS un tri par abandons : le champ le plus abandonné reste à sa place", () => {
    const events = [
      ...fois(
        5,
        submit("f", [
          { name: "nom", order: 1 },
          { name: "carte", order: 2 },
        ]),
      ),
      ...fois(
        5,
        abandon(
          "f",
          [
            { name: "nom", order: 1 },
            { name: "carte", order: 2 },
          ],
          "carte",
        ),
      ),
    ];
    const { champs } = fieldReport(events, "f");
    expect(champs.map((x) => x.name)).toEqual(["nom", "carte"]);
    expect(champs[1].abandonsIci).toBe(5);
  });

  it("un champ sans ordre émis ferme la liste plutôt que de passer pour le premier", () => {
    const events = [submit("f", [{ name: "ancien" }, { name: "nom", order: 1 }])];
    expect(fieldReport(events, "f").champs.map((x) => x.name)).toEqual(["nom", "ancien"]);
  });
});

describe("fieldReport — segments d'une barre", () => {
  const champ = (last: string | null): FormEvent =>
    last === null
      ? submit("f", [{ name: "email", order: 1, timeMs: 1000, changed: true, refocus: 0 }])
      : abandon("f", [{ name: "email", order: 1, timeMs: 3000, changed: false, refocus: 2 }], last);

  it("champ touché 10 fois dont 4 abandons ici -> segments [4, 6], longueur 10 (jamais 14)", () => {
    const events = [...fois(4, champ("email")), ...fois(6, champ(null))];
    const { champs, incoherents } = fieldReport(events, "f");
    const email = champs[0];
    expect(email.interactions).toBe(10);
    expect(email.abandonsIci).toBe(4);
    expect(email.autres).toBe(6);
    expect(email.abandonsIci + email.autres).toBe(email.interactions);
    expect(email.partAbandons).toBeCloseTo(0.4);
    expect(incoherents).toBe(0);
  });

  it("abandon dont `last_field` est absent de `fields` -> incoherents = 1, segments inchangés", () => {
    const events = [
      ...fois(4, champ("email")),
      ...fois(6, champ(null)),
      // Autre émetteur : le dernier champ déclaré n'a jamais été touché.
      abandon("f", [{ name: "email", order: 1, timeMs: 500 }], "captcha"),
    ];
    const { champs, incoherents } = fieldReport(events, "f");
    expect(incoherents).toBe(1);
    // « captcha » n'existe pas comme champ : il n'a pas été touché.
    expect(champs.map((x) => x.name)).toEqual(["email"]);
    const email = champs[0];
    expect(email.abandonsIci).toBe(4);
    // La 11e tentative a bien touché « email » : elle entre dans « autres ».
    expect(email.interactions).toBe(11);
    expect(email.autres).toBe(7);
    expect(email.abandonsIci + email.autres).toBe(email.interactions);
  });

  it("temps médian et p75, retours moyens, taux de saisie", () => {
    const events = [...fois(4, champ("email")), ...fois(6, champ(null))];
    const email = fieldReport(events, "f").champs[0];
    expect(email.tempsMedianMs).toBe(1000); // six 1 000 et quatre 3 000
    expect(email.tempsP75Ms).toBe(3000);
    expect(email.retoursMoyens).toBeCloseTo(0.8); // quatre 2 et six 0
    expect(email.tauxSaisie).toBeCloseTo(0.6);
  });

  it("un champ répété dans une tentative reste UNE tentative", () => {
    const events = [submit("f", [{ name: "a", order: 1 }, { name: "a", order: 2 }])];
    expect(fieldReport(events, "f").champs[0].interactions).toBe(1);
  });

  it("filtre par formulaire, et plafond de champs du SDK signalé", () => {
    const quarante = Array.from({ length: 40 }, (_, i) => ({ name: `c${i}`, order: i + 1 }));
    const events = [submit("autre", [{ name: "x", order: 1 }]), submit("geant", quarante)];
    expect(fieldReport(events, "autre").champs.map((x) => x.name)).toEqual(["x"]);
    expect(fieldReport(events, "autre").tronqueParSdk).toBe(false);
    expect(fieldReport(events, "geant").tronqueParSdk).toBe(true);
  });
});
