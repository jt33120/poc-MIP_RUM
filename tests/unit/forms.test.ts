// Form Analytics — cœur pur (FormTracker) + identifiant de champ non sensible.
import { describe, expect, it } from "vitest";
import { fieldKey, FormTracker } from "../../packages/rum-sdk/src/forms";

describe("fieldKey", () => {
  it("préfère name, puis id, puis tag:type", () => {
    expect(fieldKey({ name: "email", type: "email" })).toBe("email");
    expect(fieldKey({ id: "nom", type: "text" })).toBe("nom");
    expect(fieldKey({ tagName: "SELECT", type: "" })).toBe("select:text");
  });
  it("password réduit à [password] (jamais de valeur/identifiant sensible)", () => {
    expect(fieldKey({ name: "user_password", type: "password" })).toBe("[password]");
  });
});

describe("FormTracker", () => {
  it("ordre, temps par champ, dernier champ", () => {
    const t = new FormTracker();
    t.focus("nom", 0);
    t.blur(1000); // 1 s sur nom
    t.focus("email", 1000);
    t.input("email");
    t.blur(3500); // 2,5 s sur email, modifié
    const s = t.summary();
    expect(s.fields.map((f) => f.name)).toEqual(["nom", "email"]);
    expect(s.fields[0]).toMatchObject({ order: 1, timeMs: 1000, changed: false });
    expect(s.fields[1]).toMatchObject({ order: 2, timeMs: 2500, changed: true });
    expect(s.totalTimeMs).toBe(3500);
    expect(s.lastField).toBe("email");
    expect(s.changedCount).toBe(1);
  });

  it("un nouveau focus clôt le champ précédent encore ouvert", () => {
    const t = new FormTracker();
    t.focus("a", 0);
    t.focus("b", 2000); // pas de blur explicite -> a reçoit 2 s
    const s = t.summary(2000);
    expect(s.fields.find((f) => f.name === "a")?.timeMs).toBe(2000);
  });

  it("compte les retours (refocus) sans dupliquer le champ", () => {
    const t = new FormTracker();
    t.focus("a", 0);
    t.blur(500);
    t.focus("b", 500);
    t.blur(700);
    t.focus("a", 700); // retour sur a
    t.blur(900);
    const s = t.summary();
    expect(s.fields).toHaveLength(2);
    const a = s.fields.find((f) => f.name === "a")!;
    expect(a.refocus).toBe(1);
    expect(a.timeMs).toBe(700); // 500 + 200
  });

  it("summary(ts) clôt un focus ouvert (abandon)", () => {
    const t = new FormTracker();
    t.focus("email", 1000);
    t.input("email");
    const s = t.summary(4000); // abandon après 3 s sur email
    expect(s.fields[0].timeMs).toBe(3000);
    expect(s.lastField).toBe("email");
    expect(t.touched).toBe(true);
  });

  it("touched=false tant qu'aucun champ", () => {
    expect(new FormTracker().touched).toBe(false);
  });
});
