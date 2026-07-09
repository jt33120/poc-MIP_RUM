// Form Analytics — agrégats par formulaire et par champ. Logique pure.
import { describe, expect, it } from "vitest";
import { fieldReport, formReport, type FormEvent } from "../../apps/console/lib/form-analytics";

const submit = (form: string, fields: FormEvent["props"]["fields"], t = 1000): FormEvent => ({
  name: "form.submit",
  props: { form, submitted: true, fields, total_time_ms: t },
});
const abandon = (
  form: string,
  fields: FormEvent["props"]["fields"],
  last: string,
  t = 500,
): FormEvent => ({
  name: "form.abandon",
  props: { form, submitted: false, fields, total_time_ms: t, last_field: last },
});

describe("formReport", () => {
  it("conversion = submits / starters, temps moyen", () => {
    const events = [
      submit("checkout", [{ name: "email" }], 2000),
      abandon("checkout", [{ name: "email" }], "email", 1000),
      abandon("checkout", [{ name: "email" }], "email", 1000),
      submit("login", [{ name: "user" }], 500),
    ];
    const r = formReport(events);
    const co = r.find((x) => x.form === "checkout")!;
    expect(co).toMatchObject({ starters: 3, submits: 1, abandons: 2 });
    expect(co.conversion).toBeCloseTo(1 / 3);
    expect(co.avgTimeMs).toBe(Math.round((2000 + 1000 + 1000) / 3));
    // trié par starters desc : checkout (3) avant login (1)
    expect(r[0].form).toBe("checkout");
  });
  it("form manquant -> (inconnu)", () => {
    expect(formReport([{ name: "form.submit", props: {} }])[0].form).toBe("(inconnu)");
  });
});

describe("fieldReport", () => {
  const events = [
    submit("f", [
      { name: "nom", timeMs: 1000, changed: true },
      { name: "email", timeMs: 3000, changed: true },
    ]),
    abandon("f", [{ name: "nom", timeMs: 800, changed: true }, { name: "email", timeMs: 200, changed: false }], "email"),
    abandon("f", [{ name: "nom", timeMs: 900, changed: true }], "nom"),
  ];
  it("temps moyen, taux de modif, dropoff (dernier champ avant abandon)", () => {
    const r = fieldReport(events);
    const email = r.find((x) => x.name === "email")!;
    const nom = r.find((x) => x.name === "nom")!;
    expect(email.interactions).toBe(2);
    expect(email.avgTimeMs).toBe(1600); // (3000 + 200) / 2
    expect(email.changedRate).toBeCloseTo(0.5); // 1 sur 2
    expect(email.dropoff).toBe(1); // 1 abandon avec last_field=email
    expect(nom.dropoff).toBe(1);
    // tri par dropoff desc puis interactions : nom (dropoff1, inter3) avant email (dropoff1, inter2)
    expect(r[0].name).toBe("nom");
  });
  it("filtre par formulaire", () => {
    const mixed = [...events, submit("autre", [{ name: "x", timeMs: 100 }])];
    const r = fieldReport(mixed, "autre");
    expect(r.map((x) => x.name)).toEqual(["x"]);
  });
});
