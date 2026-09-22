// FriseEtats (F56, plan § 4.2, § 5.7 CR7-b) : l'état se lit par la forme et le texte,
// une case « absent » n'a pas de remplissage plein, aucune bande ni échelle, les
// cases sont posées sur la grille en temps, et le regroupement prend le pire état.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FriseEtats, placerCases, regrouperCases, type EtatDef } from "@/components/charts/FriseEtats";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const ETATS: EtatDef[] = [
  { cle: "ok", libelle: "ok", forme: "basse", ton: "neutre" },
  { cle: "warn", libelle: "avertissement", forme: "moyenne", glyphe: "!", ton: "warn" },
  { cle: "incident", libelle: "incident", forme: "haute", glyphe: "×", ton: "bad" },
  { cle: "inconnu", libelle: "état inconnu", forme: "contour", ton: "vide" },
  { cle: "absent", libelle: "aucun passage", forme: "hachure", ton: "vide" },
];

const H = 3_600_000;
const T0 = Date.parse("2026-09-22T00:00:00Z");
const grille = Array.from({ length: 6 }, (_v, i) => new Date(T0 + i * H).toISOString().replace(".000Z", "Z"));
const cases = [
  { t: grille[0], etat: "ok", detail: "premier chargement 820 ms · 3" },
  { t: grille[1], etat: "incident", detail: "premier chargement 4,2 s · 3" },
  { t: grille[2], etat: "absent", detail: "aucun passage du robot" },
  { t: grille[3], etat: "warn", detail: "premier chargement 2,1 s" },
  { t: grille[4], etat: "inconnu", detail: "état non renseigné" },
  // grille[5] manque : il devient « absent ».
];

/** Le groupe SVG de la première case d'un état, dans la couche détaillée. */
const caseDe = (html: string, etat: string) => {
  const detail = html.split('data-couche="groupe"')[0];
  return detail.match(new RegExp(`<g[^>]*data-etat="${etat}"[\\s\\S]*?</g>`))?.[0] ?? "";
};

describe("FriseEtats", () => {
  const html = renderToStaticMarkup(
    <FriseEtats grille={grille} seauSecondes={3600} cases={cases} etats={ETATS} ariaLabel="Robot · état par heure" />,
  );

  it("incident : rendu avec le texte « incident » et le glyphe « × », forme haute", () => {
    const c = caseDe(html, "incident");
    expect(c).toContain('data-forme="haute"');
    expect(c).toContain("×");
    expect(texte(html)).toContain("22/09 01:00 → 02:00 UTC : incident — premier chargement 4,2 s · 3");
  });

  it("absent : case sans remplissage plein (hachures seulement)", () => {
    const c = caseDe(html, "absent");
    expect(c).toContain('data-plein="false"');
    expect(c).not.toContain('fill="currentColor"');
    expect(c).toMatch(/fill="url\(#[^)]+-hachure\)"/);
  });

  it("aucune bande ni échelle de valeur dans le rendu", () => {
    expect(html).not.toMatch(/bande|ReferenceArea|recharts/i);
    expect(html).not.toMatch(/<text[^>]*>\s*\d/);
  });

  it("une case par seau, posée en temps ; un seau sans ligne devient « aucun passage »", () => {
    expect(html).toContain('data-cases="6"');
    const places = placerCases(grille, 3600, cases, ETATS);
    expect(places.map((c) => Math.round(c.x * 1000) / 1000)).toEqual([0, 16.667, 33.333, 50, 66.667, 83.333]);
    expect(places[5].def.cle).toBe("absent");
    // Le centre de la case i est le centre de la bande i (même découpage que la série au-dessus).
    for (const [i, c] of places.entries()) expect(c.x + c.largeur / 2).toBeCloseTo(((i + 0.5) / 6) * 100, 6);
  });

  it("un seul arrêt de tabulation par couche ; chaque case a son libellé complet", () => {
    const detail = html.split('data-couche="groupe"')[0];
    expect(detail.match(/tabindex="0"/g)).toHaveLength(1);
    expect(detail.match(/data-case=""/g)).toHaveLength(6);
    expect(detail).toContain('aria-label="22/09 00:00 → 01:00 UTC : ok — premier chargement 820 ms · 3"');
    expect(html).toContain('data-testid="alternative"');
  });

  it("zoomHref : chaque case est un lien sur ses bornes UTC", () => {
    const zoom = renderToStaticMarkup(
      <FriseEtats grille={grille} seauSecondes={3600} cases={cases} etats={ETATS} zoomHref="/correlation?from={from}&to={to}" ariaLabel="x" />,
    );
    expect(zoom).toContain(`href="/correlation?from=${encodeURIComponent("2026-09-22T01:00:00Z")}&amp;to=${encodeURIComponent("2026-09-22T02:00:00Z")}"`);
  });

  it("regroupement par 3 : le pire état du groupe, dit", () => {
    const groupes = regrouperCases(placerCases(grille, 3600, cases, ETATS));
    expect(groupes).toHaveLength(2);
    expect(groupes[0].def.cle).toBe("incident");
    expect(groupes[1].def.cle).toBe("warn");
    expect(groupes[0].secondes).toBe(3 * 3600);
    expect(groupes[0].detail).toContain("pire état des 3 seaux");
    expect(html).toContain('data-testid="frise-etats-regroupee"');
    // Le seuil de la requête de conteneur : 6 seaux × 2 px + marges (56 + 16).
    expect(html).toContain("@container (max-width:83.98px)");
  });
});
