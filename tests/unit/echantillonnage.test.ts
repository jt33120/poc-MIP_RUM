// F40 — bandeau d'échantillonnage des écrans d'usage (règle S7, lecture B38).
//
// Ce que ce test empêche : qu'un écran d'usage affiche des comptes d'échantillon
// comme des totaux, ou « 100 % » pour des sessions dont la probabilité d'inclusion
// n'a jamais été enregistrée (avant le 09/09/2026, `sample_rate` vaut 1 par défaut).
// Les textes sont lus sur le RENDU réel d'`EtatSurface` (renderToStaticMarkup).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EtatSurface, type Etat } from "@/components/states/EtatSurface";
import {
  RAISON_ECHANTILLONNAGE_NON_LU,
  etatEchantillonnage,
  etatLectureEchantillonnage,
  type EchantillonnageSessions,
} from "@/lib/echantillonnage";

const e = (partiel: Partial<EchantillonnageSessions>): EchantillonnageSessions => ({
  probaMin: 1,
  sessions: 12,
  sansTaux: 0,
  biaiseErreurs: false,
  ...partiel,
});

/** Texte lisible du rendu : balises retirées, entités et espaces insécables normalisés. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ");

const rendu = (etat: Etat) => texte(renderToStaticMarkup(createElement(EtatSurface, { etat })));

describe("etatEchantillonnage", () => {
  it("{probaMin: 0,5, sansTaux: 0} → « au moins 50 % », comptes observés, non extrapolés", () => {
    const etat = etatEchantillonnage(e({ probaMin: 0.5 }));
    expect(etat).toEqual({ kind: "echantillonne", unite: "session", probaMin: 0.5 });
    const t = rendu(etat!);
    expect(t).toContain("chaque session avait au moins 50 % de chances d'être retenue");
    expect(t).toContain("comptes observés, non extrapolés");
  });

  it("{probaMin: 1, sansTaux: 3} → probaMin null (inconnue, jamais 100 %), « 3 sessions » avant le 09/09/2026", () => {
    const etat = etatEchantillonnage(e({ probaMin: 1, sansTaux: 3 }));
    expect(etat).toEqual({ kind: "echantillonne", unite: "session", probaMin: null, sansTaux: 3 });
    const t = rendu(etat!);
    expect(t).toContain("probabilité d'inclusion de chaque session inconnue");
    expect(t).toContain("3 sessions commencées avant le 09/09/2026");
    expect(t).not.toMatch(/100\s*%/);
  });

  it("{probaMin: 1, sansTaux: 0} → null : rien n'est échantillonné, aucun bandeau", () => {
    expect(etatEchantillonnage(e({ probaMin: 1, sansTaux: 0 }))).toBeNull();
  });

  it("aucune session lue → null : l'état « vide » des figures suffit", () => {
    expect(etatEchantillonnage(e({ sessions: 0, probaMin: null }))).toBeNull();
    expect(etatEchantillonnage(e({ sessions: 0, probaMin: 0.1, sansTaux: 2 }))).toBeNull();
  });

  it("sessions sans taux ET sessions échantillonnées : la borne « au moins p % » serait fausse → inconnue", () => {
    const etat = etatEchantillonnage(e({ probaMin: 0.25, sansTaux: 4 }));
    expect(etat).toMatchObject({ probaMin: null, sansTaux: 4 });
    expect(rendu(etat!)).not.toContain("au moins 25");
  });

  it("biaisé-erreurs : la part de sessions en erreur est dite surestimée", () => {
    const etat = etatEchantillonnage(e({ probaMin: 0.1, biaiseErreurs: true }));
    expect(etat).toEqual({ kind: "echantillonne", unite: "session", probaMin: 0.1, biaiseErreurs: true });
    expect(rendu(etat!)).toContain("Les sessions avec erreur sont sur-représentées");
  });

  it("probabilité minimale illisible (NaN) avec des sessions : inconnue, pas le silence", () => {
    expect(etatEchantillonnage(e({ probaMin: Number.NaN }))).toMatchObject({ kind: "echantillonne", probaMin: null });
  });
});

describe("etatLectureEchantillonnage", () => {
  it("lecture en échec → « partiel » qui le dit, jamais le silence", () => {
    expect(etatLectureEchantillonnage({ ok: false, raison: "connexion refusée" })).toEqual({
      kind: "partiel",
      raison: RAISON_ECHANTILLONNAGE_NON_LU,
    });
    expect(RAISON_ECHANTILLONNAGE_NON_LU).toBe("échantillonnage non lu : les comptes peuvent porter sur un échantillon");
  });

  it("lecture réussie → l'état de la population", () => {
    expect(etatLectureEchantillonnage({ ok: true, data: e({ probaMin: 1 }) })).toBeNull();
    expect(etatLectureEchantillonnage({ ok: true, data: e({ probaMin: 0.5 }) })).toMatchObject({ kind: "echantillonne" });
  });
});

describe("BandeauEchantillonnage", () => {
  it("ne rend rien quand rien n'est échantillonné", () => {
    expect(renderToStaticMarkup(createElement(BandeauEchantillonnage, { lecture: { ok: true, data: e({}) } }))).toBe("");
  });

  it("rend le bandeau (note, testid) quand la population est échantillonnée", () => {
    const html = renderToStaticMarkup(
      createElement(BandeauEchantillonnage, { lecture: { ok: true, data: e({ probaMin: 0.5 }) } }),
    );
    expect(html).toContain('data-testid="bandeau-echantillonnage"');
    expect(html).toContain('role="note"');
    expect(texte(html)).toContain("au moins 50 %");
  });

  it("lecture en échec : un bandeau « partiel », pas une section vide", () => {
    const html = renderToStaticMarkup(
      createElement(BandeauEchantillonnage, { lecture: { ok: false, raison: "délai dépassé" } }),
    );
    expect(texte(html)).toContain("Partiel : échantillonnage non lu");
    expect(html).not.toContain("délai dépassé"); // la raison technique n'est jamais affichée
  });
});
