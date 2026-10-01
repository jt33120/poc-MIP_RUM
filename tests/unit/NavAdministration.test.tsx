// Le bloc Administration repliable (recette du 30/09/2026 : « possibilité de toggle
// toutes les pages en dessous de ADMINISTRATION »). Rendu serveur : replié hors
// /admin, ouvert d'office sur une page /admin ; bouton-disclosure accessible ; le
// choix mémorisé ne casse pas quand le stockage du navigateur est fermé.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { NAVIGATION, chemin } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return {
    NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation"),
    chemin: { valeur: "/" },
  };
});
vi.mock(NAVIGATION, () => ({ usePathname: () => chemin.valeur }));

const { NavAdministration, administrationOuverte, lireChoixAdministration, CLE_ADMINISTRATION } = await import(
  "@/components/NavAdministration"
);

const rendu = (p: string) => {
  chemin.valeur = p;
  return renderToStaticMarkup(<NavAdministration />);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NavAdministration — rendu serveur", () => {
  it("hors /admin : replié, liste cachée, bouton qui désigne la liste", () => {
    const html = rendu("/pages");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
    const id = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<nav[^>]*id="${id}"[^>]*hidden=""`));
    // Le nombre d'entrées cachées est dit à côté du libellé.
    expect(html).toContain(">11<");
  });

  it("sur /admin : ouvert d'office, entrée courante marquée", () => {
    const html = rendu("/admin/audit");
    expect(html).toMatch(/<button[^>]*aria-expanded="true"/);
    expect(html).not.toMatch(/<nav[^>]*hidden=""/);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/audit"|<a[^>]*href="\/admin\/audit"[^>]*aria-current="page"/);
  });

  it("libellé « Jetons d'accès », adresse inchangée", () => {
    const html = rendu("/admin/read-tokens");
    expect(html).toContain("Jetons d&#x27;accès");
    expect(html).toContain('href="/admin/read-tokens"');
    expect(html).not.toMatch(/Jetons de lecture/);
  });

  it("la liste est un repère de navigation nommé « Administration »", () => {
    expect(rendu("/admin/users")).toMatch(/<nav[^>]*aria-label="Administration"/);
  });
});

describe("état initial et choix mémorisé", () => {
  it("ouvert sur /admin quel que soit le choix ; ailleurs, le choix, sinon replié", () => {
    expect(administrationOuverte(true, false)).toBe(true);
    expect(administrationOuverte(true, null)).toBe(true);
    expect(administrationOuverte(false, true)).toBe(true);
    expect(administrationOuverte(false, false)).toBe(false);
    expect(administrationOuverte(false, null)).toBe(false);
  });

  it("lit « ouvert » et « replie », ignore toute autre valeur", () => {
    const valeurs: Record<string, string> = {};
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => valeurs[k] ?? null } });
    expect(lireChoixAdministration()).toBeNull();
    valeurs[CLE_ADMINISTRATION] = "ouvert";
    expect(lireChoixAdministration()).toBe(true);
    valeurs[CLE_ADMINISTRATION] = "replie";
    expect(lireChoixAdministration()).toBe(false);
    valeurs[CLE_ADMINISTRATION] = "n'importe quoi";
    expect(lireChoixAdministration()).toBeNull();
  });

  it("stockage fermé (navigation privée, données bloquées) : pas d'exception, pas de choix", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    expect(lireChoixAdministration()).toBeNull();
  });
});
