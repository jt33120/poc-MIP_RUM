// Écrans d'usage sur le contrat (F53, règles S3 et S4) — logique pure.
import { describe, expect, it } from "vitest";
import { couvertureDeTuile, gesteElargir, plafondAtteint, plageDansPhrase } from "../../apps/console/lib/lecture-usages";
import { parseAnalyticsQuery } from "../../apps/console/lib/query-contract";

const NOW = Date.parse("2026-09-22T14:02:37Z");
const requete = (qs: string) => {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal: { role: "admin", apps: null }, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
};

describe("plafondAtteint (S4)", () => {
  it("atteint dès que la lecture rend autant de lignes que son plafond", () => {
    expect(plafondAtteint(20_000, 20_000)).toBe(true);
    expect(plafondAtteint(19_999, 20_000)).toBe(false);
    expect(plafondAtteint(0, 20_000)).toBe(false);
  });
  it("un plafond non positif n'est pas un plafond", () => {
    expect(plafondAtteint(0, 0)).toBe(false);
  });
});

describe("plageDansPhrase : la plage du contrat, plus la fenêtre glissante d'une lecture historique", () => {
  it("presets : « Aucune session sur les dernières 24 h. »", () => {
    expect(plageDansPhrase({ preset: "1h" }, "1 h")).toBe("la dernière heure");
    expect(plageDansPhrase({ preset: "24h" }, "24 h")).toBe("les dernières 24 h");
    expect(plageDansPhrase({ preset: "7d" }, "7 j")).toBe("les 7 derniers jours");
  });
  it("plage personnalisée : son libellé, dans le fuseau de l'app", () => {
    expect(plageDansPhrase({ preset: null }, "du 17/09 10:00 au 17/09 12:00")).toBe("la plage du 17/09 10:00 au 17/09 12:00");
  });
  it("plus jamais « glissant » ni « lecture non migrée »", () => {
    for (const preset of ["1h", "24h", "7d", null] as const) {
      expect(plageDansPhrase({ preset }, "x")).not.toMatch(/glissant|non migrée/);
    }
  });
});

describe("gesteElargir", () => {
  it("vers 7 jours, filtres gardés ; aucun geste déjà sur 7 jours", () => {
    expect(gesteElargir("/paths", requete("app=a&period=24h&device=tablet"), NOW)).toEqual({
      libelle: "Élargir à 7 jours",
      href: "/paths?app=a&device=tablet&period=7d",
    });
    expect(gesteElargir("/paths", requete("app=a&period=7d"), NOW)).toBeUndefined();
  });
  it("une plage personnalisée est REMPLACÉE, jamais combinée avec period (range_conflict)", () => {
    const geste = gesteElargir("/forms", requete("app=a&from=2026-09-22T10:00:00Z&to=2026-09-22T12:00:00Z"), NOW);
    const href = new URL(geste!.href, "http://x");
    expect(href.searchParams.get("period")).toBe("7d");
    expect(href.searchParams.has("from")).toBe(false);
    expect(href.searchParams.has("to")).toBe(false);
  });
});

describe("gesteElargir : la fenêtre proposée CONTIENT la plage lue et est plus longue (revue vague 8)", () => {
  const JOUR = 86_400_000;
  /** La plage que le lien du geste fait lire, résolue à l'instant du clic. */
  const cible = (href: string, clicMs: number) => {
    const parsed = parseAnalyticsQuery(new URL(href, "http://x").searchParams, {
      principal: { role: "admin", apps: null },
      nowMs: clicMs,
    });
    if (!parsed.ok) throw new Error(parsed.error.code);
    return parsed.value.range;
  };
  const contient = (dehors: { from: string; to: string }, dedans: { from: string; to: string }) =>
    Date.parse(dehors.from) <= Date.parse(dedans.from) && Date.parse(dedans.to) <= Date.parse(dehors.to);
  const duree = (r: { from: string; to: string }) => Date.parse(r.to) - Date.parse(r.from);

  it("plage de 26 jours (25/08 → 20/09) : aucun « Élargir », 7 jours la RÉTRÉCIRAIENT", () => {
    // Le scénario de la revue : /acquisition sans session sur 26 jours proposait period=7d.
    expect(gesteElargir("/acquisition", requete("app=a&from=2026-08-25T00:00:00Z&to=2026-09-20T00:00:00Z"), NOW)).toBeUndefined();
  });

  it("plage personnalisée de 7 jours pile : aucun geste (rien de plus large à 7 jours)", () => {
    expect(gesteElargir("/paths", requete("app=a&from=2026-09-01T00:00:00Z&to=2026-09-08T00:00:00Z"), NOW)).toBeUndefined();
  });

  it("2 h le 01/09 : les 7 derniers jours ne la contiennent pas — les 7 jours qui finissent à sa fin, explicites", () => {
    const q = requete("app=a&device=mobile&from=2026-09-01T10:00:00Z&to=2026-09-01T12:00:00Z");
    const geste = gesteElargir("/acquisition", q, NOW);
    expect(geste?.libelle).toBe("Élargir à 7 jours");
    const href = new URL(geste!.href, "http://x");
    expect(href.searchParams.has("period")).toBe(false);
    expect(href.searchParams.get("from")).toBe("2026-08-25T12:00:00.000Z");
    expect(href.searchParams.get("to")).toBe("2026-09-01T12:00:00.000Z");
    // Les filtres restent : seule la plage change.
    expect(href.searchParams.get("device")).toBe("mobile");
    const r = cible(geste!.href, NOW);
    expect(contient(r, q.range)).toBe(true);
    expect(duree(r)).toBe(7 * JOUR);
  });

  it("3 jours compris dans les 7 derniers : period=7d, qui les contient encore au clic", () => {
    const q = requete("app=a&from=2026-09-18T00:00:00Z&to=2026-09-21T00:00:00Z");
    const geste = gesteElargir("/forms", q, NOW);
    expect(new URL(geste!.href, "http://x").searchParams.get("period")).toBe("7d");
    expect(contient(cible(geste!.href, NOW + 30 * 60_000), q.range)).toBe(true);
  });

  it("début au ras de la borne des 7 derniers jours : fenêtre explicite (la fenêtre glissante l'aurait perdu au clic)", () => {
    // Début 20 minutes après NOW − 7 j : contenu au rendu, plus au clic une demi-heure après.
    const debut = new Date(NOW - 7 * JOUR + 20 * 60_000).toISOString();
    const q = requete(`app=a&from=${debut}&to=2026-09-16T00:00:00Z`);
    const geste = gesteElargir("/paths", q, NOW);
    expect(new URL(geste!.href, "http://x").searchParams.has("period")).toBe(false);
    expect(contient(cible(geste!.href, NOW + 30 * 60_000), q.range)).toBe(true);
  });

  it("propriété : tout geste proposé fait lire une plage plus longue, qui contient la plage personnalisée lue", () => {
    const plages = [
      "period=1h",
      "period=24h",
      "from=2026-09-22T10:00:00Z&to=2026-09-22T12:00:00Z",
      "from=2026-09-15T15:00:00Z&to=2026-09-15T16:00:00Z",
      "from=2026-09-10T00:00:00Z&to=2026-09-16T23:00:00Z",
      "from=2026-08-24T00:00:00Z&to=2026-08-24T00:05:00Z",
      "from=2026-08-25T00:00:00Z&to=2026-09-20T00:00:00Z",
      "from=2026-09-12T00:00:00Z&to=2026-09-22T00:00:00Z",
    ];
    for (const plage of plages) {
      const q = requete(`app=a&${plage}`);
      const geste = gesteElargir("/acquisition", q, NOW);
      if (!geste) {
        expect(duree(q.range), plage).toBeGreaterThanOrEqual(7 * JOUR);
        continue;
      }
      const r = cible(geste.href, NOW + 30 * 60_000);
      // Un preset glisse avec l'horloge : il se relit au clic, les 7 derniers jours le couvrent.
      if (q.range.preset === null) expect(contient(r, q.range), plage).toBe(true);
      expect(duree(r), plage).toBeGreaterThan(duree(q.range));
    }
  });
});

describe("couvertureDeTuile (cmp=prev, F53)", () => {
  const complete = { etat: "complete" as const, raison: null };
  it("hors cmp=prev : rien", () => {
    expect(couvertureDeTuile(undefined, [{ atteint: true, raison: "x" }])).toBeUndefined();
  });
  it("une source incomplète décide d'abord, avec l'effectif précédent", () => {
    expect(
      couvertureDeTuile(
        [complete, { etat: "partielle", raison: "période précédente hors rétention" }],
        [{ atteint: true, raison: "plafond" }],
        12,
      ),
    ).toEqual({ etat: "partielle", raison: "période précédente hors rétention", n: 12 });
  });
  it("sources complètes, un plafond atteint : l'écart se tait avec la raison du plafond", () => {
    expect(
      couvertureDeTuile([complete], [
        { atteint: false, raison: "a" },
        { atteint: true, raison: "plafond de 50 transitions atteint" },
      ]),
    ).toEqual({ etat: "partielle", raison: "plafond de 50 transitions atteint", n: null });
  });
  it("rien d'atteint : complète, avec l'effectif précédent", () => {
    expect(couvertureDeTuile([complete], [{ atteint: false, raison: "a" }], 40)).toEqual({ etat: "complete", raison: null, n: 40 });
  });
});
