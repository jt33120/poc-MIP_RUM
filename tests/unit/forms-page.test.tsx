// Écran /forms (F51, § 5.15), rendu côté serveur avec des lectures simulées.
//
// Ce que ces tests verrouillent (recette du 26/09/2026) :
//   - une fonction non livrée ne se montre pas : « Abandons dans le temps » (B34)
//     n'est pas rendue, et aucun code de lot n'apparaît ;
//   - UNE couleur pour « abandon » sur tout l'écran (la série principale), avec une
//     légende visible sur chaque graphique à barres ;
//   - le formulaire dont les champs sont affichés est marqué, et l'écran dit qu'un
//     clic en affiche d'autres ; « échantillon faible » est une marque à part ;
//   - la population et la remarque sur le SDK mobile ne sont dites qu'une fois ; la
//     méthode des tuiles est derrière l'aide « ? ».
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormEvent } from "@/lib/form-analytics";
import { SERIE } from "@/lib/palette";
import { parseAnalyticsQuery } from "@/lib/query-contract";

const { formEvents, samplingSessions, pageFilters } = vi.hoisted(() => ({
  formEvents: vi.fn(),
  samplingSessions: vi.fn(),
  pageFilters: vi.fn(),
}));
vi.mock("@/lib/queries-form-analytics", () => ({ formEvents }));
vi.mock("@/lib/queries-sessions", () => ({ samplingSessions }));
// Le chargeur lit ses filtres par `analyserFiltres` ; `chargerEcran` lit la session.
vi.mock("@/lib/auth", () => ({ getUser: async () => ({ email: "a@b", role: "admin", apps: null }) }));
vi.mock("@/lib/filtres-ecran", () => ({ analyserFiltres: pageFilters }));
vi.mock("@/lib/log-forward", () => ({ forwardLog: async () => {} }));
// « Réessayer » exige le routeur de l'app, absent d'un rendu isolé.
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const ecran = () => {
  const parsed = parseAnalyticsQuery(new URLSearchParams("app=demo"), {
    principal: { role: "admin", apps: null },
    nowMs: Date.now(),
  });
  if (!parsed.ok) throw new Error(parsed.error.code);
  const query = parsed.value;
  const filters = { app: "demo", period: "24h", device: null, segment: [], includeBots: false, query };
  return { ok: true, filters, deviceFilters: filters, query, label: "24 h", bucketLabel: "1 h", notApplied: null };
};

const { default: Forms } = await import("@/app/forms/page");

async function rendre(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await Forms({ searchParams: Promise.resolve(sp) }));
}

/** `n` tentatives identiques. */
const fois = (n: number, e: FormEvent): FormEvent[] => Array.from({ length: n }, () => e);
const champs = [
  { name: "nom", order: 1, timeMs: 1000, changed: true, refocus: 0 },
  { name: "email", order: 2, timeMs: 2000, changed: true, refocus: 1 },
];

/** Le texte visible, sans balises ni entités, espaces insécables compris. */
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

/** Le bloc d'une figure, de son ancre à la figure suivante. */
const bloc = (html: string, id: string) => {
  const debut = html.indexOf(`id="${id}"`);
  expect(debut, `#${id} rendue`).toBeGreaterThan(-1);
  const fin = html.indexOf('data-testid="figure"', html.indexOf(">", debut));
  return html.slice(debut, fin === -1 ? undefined : fin);
};

beforeEach(() => {
  for (const m of [formEvents, samplingSessions, pageFilters]) m.mockReset();
  pageFilters.mockResolvedValue(ecran());
  // « inscription » : 40 soumissions, 6 abandons sur « email » ; « contact » : 5
  // abandons sur 5 tentatives — échantillon faible, en fin de classement.
  formEvents.mockResolvedValue([
    ...fois(40, { name: "form.submit", props: { form: "inscription", submitted: true, total_time_ms: 12000, fields: champs } }),
    ...fois(6, { name: "form.abandon", props: { form: "inscription", fields: champs, last_field: "email" } }),
    ...fois(5, {
      name: "form.abandon",
      props: { form: "contact", fields: [{ name: "message", order: 1, timeMs: 900 }], last_field: "message" },
    }),
  ]);
  samplingSessions.mockResolvedValue({ probaMin: 1, sessions: 18, sansTaux: 0, biaiseErreurs: false });
});

describe("/forms — une fonction non livrée ne se montre pas", () => {
  it("« Abandons dans le temps » n'est pas rendue ; aucun code de lot, aucun bandeau « Partiel »", async () => {
    const html = await rendre();
    expect(html).not.toContain('id="forms-serie"');
    expect(texte(html)).not.toContain("Abandons dans le temps");
    expect(texte(html)).not.toMatch(/\bB34\b|Partiel/);
  });
});

describe("/forms — une couleur pour « abandon », une légende par graphique", () => {
  it("la série principale porte les abandons dans les deux graphiques ; le rouge d'un verdict n'y est plus", async () => {
    const html = await rendre();
    for (const id of ["forms-classement", "forms-champs"]) {
      const figure = bloc(html, id);
      expect(figure, id).toContain(`background-color:${SERIE.principale}`);
      expect(figure, id).toContain('data-testid="forms-legende"');
    }
    expect(html).not.toContain("--c-bad");
    expect(texte(bloc(html, "forms-champs"))).toContain("Abandons dont c'est le dernier champ");
    expect(texte(bloc(html, "forms-champs"))).toContain("Autres tentatives");
  });

  it("les sous-libellés des champs passent à la ligne, au lieu d'être coupés", async () => {
    const champsHtml = bloc(await rendre(), "forms-champs");
    expect(champsHtml).toContain('class="block whitespace-normal leading-snug"');
    expect(texte(champsHtml)).toContain("1 retour en moyenne");
  });
});

describe("/forms — le formulaire sélectionné se voit, et l'écran dit comment en changer", () => {
  const ligne = (html: string, form: string) => {
    const debut = html.indexOf(`title="${form} :`);
    expect(debut, form).toBeGreaterThan(-1);
    const ouverture = html.lastIndexOf("<a ", debut);
    return html.slice(ouverture, html.indexOf("</a>", debut));
  };

  it("sans `form=`, le premier du classement est marqué ; un clic est proposé", async () => {
    const html = await rendre();
    expect(ligne(html, "inscription")).toContain('aria-current="true"');
    expect(ligne(html, "contact")).not.toContain("aria-current");
    expect(texte(bloc(html, "forms-classement"))).toContain("Cliquez sur un formulaire pour afficher ses champs");
    expect(ligne(html, "contact")).toContain("form=contact");
  });

  it("`form=contact` : la ligne de contact est marquée et ses champs sont affichés", async () => {
    const html = await rendre({ form: "contact" });
    expect(ligne(html, "contact")).toContain('aria-current="true"');
    expect(texte(ligne(html, "contact"))).toContain("champs affichés");
    expect(texte(bloc(html, "forms-champs"))).toContain("Champs de contact dans l'ordre de remplissage");
  });

  it("« échantillon faible » est une marque à part, sur la seule ligne concernée", async () => {
    const html = await rendre();
    expect(ligne(html, "contact")).toContain('data-testid="forms-echantillon-faible"');
    expect(ligne(html, "inscription")).not.toContain('data-testid="forms-echantillon-faible"');
  });
});

describe("/forms — dit une fois, et la méthode derrière l'aide", () => {
  it("population et SDK mobile une seule fois ; plus de « Population : » sous les figures", async () => {
    const t = texte(await rendre());
    expect(t).not.toContain("Population :");
    expect(t.match(/Le SDK React Native n'émet aucun événement de formulaire/g)).toHaveLength(1);
    expect(t).toContain("Chaque chiffre de l'écran compte des tentatives de formulaire");
  });

  it("chaque tuile porte sa méthode derrière l'aide « ? »", async () => {
    const html = await rendre();
    expect(html.match(/data-testid="kpi-tile"/g)).toHaveLength(4);
    expect(html.match(/data-testid="kpi-methode"/g)).toHaveLength(4);
  });
});
