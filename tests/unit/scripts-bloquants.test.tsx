// ScriptsBloquants (/ux, § 5.4.2) — suite de la vague 4 (30/09/2026) : la règle MIP
// `SEUILS_MIP.LOAF` porte sur la DURÉE p75 d'une trame longue, pas sur son temps de
// blocage. Chaque script porte sa durée p75 notée (pastille + forme), la règle est
// écrite une fois en tête de figure ; le blocage — barres, cumul, pire cas — reste
// neutre, et la figure le dit.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PHRASE_BLOCAGE_NEUTRE_SCRIPTS, ScriptsBloquants } from "@/components/ScriptsBloquants";
import type { ScriptBloquant } from "@/lib/queries-frustration";
import { RATING_CLASS } from "@/lib/rating";
import { SEUILS_MIP, texteRegleMip } from "@/lib/seuils";

// « Réessayer » (SectionErreur, client) lit le routeur de Next : hors application, un
// routeur inerte (même montage que tests/unit/LongtasksView.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/ux" }));

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const echappe = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;");

const LOAF = SEUILS_MIP.LOAF;

const script = (extra: Partial<ScriptBloquant>): ScriptBloquant => ({
  url: "https://cdn.example/app.js",
  quoi: "render",
  n: 6,
  totalMs: LOAF.mauvais * 10,
  worstMs: LOAF.mauvais * 3,
  dureeP75Ms: LOAF.mauvais + 1,
  routes: ["/panier"],
  nbRoutes: 1,
  ...extra,
});

const rendu = (data: ScriptBloquant[]) =>
  renderToStaticMarkup(<ScriptsBloquants scripts={{ ok: true, data }} label="24 h" />);

describe("ScriptsBloquants — durée p75 notée par SEUILS_MIP.LOAF", () => {
  it("chaque script : sa durée p75 notée (couleur + forme), la règle écrite une fois en tête", () => {
    const html = rendu([
      script({}),
      script({ url: null, quoi: "BUTTON#go.onclick", dureeP75Ms: LOAF.bon }),
      script({ url: "https://cdn.example/b.js", dureeP75Ms: (LOAF.bon + LOAF.mauvais) / 2 }),
    ]);
    expect(html).toMatch(/data-note="poor" data-mesure="LOAF"/);
    expect(html).toMatch(/data-note="good" data-mesure="LOAF"/);
    expect(html).toMatch(/data-note="needs-improvement" data-mesure="LOAF"/);
    expect(html).toContain(RATING_CLASS.poor);
    for (const forme of ["■", "●", "▲"]) expect(html).toContain(forme);
    // La règle : écrite UNE fois (en tête), pas répétée sur chaque barre.
    expect(html.split('data-regle-mip="LOAF"')).toHaveLength(2);
    expect(html).toContain(echappe(texteRegleMip("LOAF")));
    expect(texte(html)).toContain("durée p75");
  });

  it("le blocage reste neutre : la phrase est écrite, les barres gardent la série principale", () => {
    const html = rendu([script({})]);
    expect(texte(html)).toContain(PHRASE_BLOCAGE_NEUTRE_SCRIPTS);
    expect(html).toContain('data-testid="blocage-neutre"');
    // Aucune couleur de verdict sur la barre du cumul : seules les pastilles de durée
    // portent une classe de note (une par script).
    expect(html.split(RATING_CLASS.poor)).toHaveLength(2);
    expect(texte(html)).toContain("classement par blocage cumulé");
  });

  it("durée absente : valeur neutre, jamais une note par défaut", () => {
    const html = rendu([script({ dureeP75Ms: null })]);
    expect(html).toMatch(/data-note="" data-mesure="LOAF"/);
    expect(html).not.toMatch(/data-note="(good|poor|needs-improvement)"/);
  });

  it("l'alternative textuelle porte la durée p75 et sa note en mots", () => {
    const html = rendu([script({})]);
    expect(texte(html)).toContain("Durée p75 (note MIP)");
    expect(texte(html)).toContain("(mauvais)");
  });

  it("piège 16 : les notes (libellé `sr-only` absolu) ont un ancêtre `relative` dans la figure", () => {
    const html = rendu([script({})]);
    expect(html).toContain('<div class="relative min-w-0"><div class="min-w-0"><div class="flex flex-col gap-2" role="img"');
    expect(html).toMatch(/class="relative min-w-0 text-\[11px\][^"]*\[overflow-wrap:anywhere\]"/);
  });

  it("vide et échec : les états de la figure, sans note", () => {
    expect(texte(rendu([]))).not.toContain("durée p75");
    const echec = renderToStaticMarkup(<ScriptsBloquants scripts={{ ok: false, raison: "base coupée" }} label="24 h" />);
    expect(texte(echec)).toContain("Lecture en échec");
    expect(echec).not.toContain("data-note");
  });
});
