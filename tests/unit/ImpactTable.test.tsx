// ImpactTable (F05, plan § 4.2, P3) : la référence est une ligne, pas une barre ;
// l'échantillon faible est écrit ; l'inconnu n'a pas de barre ; un tri indisponible
// dit pourquoi ; l'ordre « fourni » est écrit ; aucune ligne « Autres ».
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const LIGNE = (cle: string, pilote: number | null, volume: number, faible = false): ImpactLigne => ({
  cle,
  libelle: cle,
  href: `/pages?route=${encodeURIComponent(cle)}`,
  description: `Route ${cle}`,
  pilote,
  volume,
  mesures: [{ cle: "lcp", valeur: pilote, affichage: pilote == null ? "—" : `${pilote} ms`, vital: "LCP" }],
  echantillonFaible: faible,
});

const BASE = {
  titre: "Segments les plus dégradés",
  triHref: { gravite: "/?", volume: "/?tri=volume", impact: null, fourni: null },
  colonnes: ["LCP p75"],
  unitePilote: "ms",
  volumeLibelle: "Mesures LCP",
  groupes: 3,
  tronque: false,
  notice: "Route normalisée.",
} as const;

describe("ImpactTable", () => {
  const html = renderToStaticMarkup(
    <ImpactTable
      {...BASE}
      tri="gravite"
      reference={{ libelle: "Ensemble", valeurs: { pilote: "2,5 s", volume: "5 608", lcp: "2,5 s" } }}
      lignes={[LIGNE("/checkout", 4100, 412), LIGNE("/rare", 6200, 12, true), LIGNE("Inconnu", null, 0, true)]}
    />,
  );

  it("la référence « Ensemble » est une ligne distincte, jamais une barre", () => {
    expect(html).toContain('data-testid="impact-reference"');
    expect(texte(html)).toContain("référence, non classée");
    expect(html.match(/data-testid="impact-ligne"/g)).toHaveLength(3);
  });

  it("échantillon faible écrit ; pilote inconnu : « — » et aucune barre", () => {
    expect(html.match(/échantillon faible/g)?.length).toBeGreaterThanOrEqual(2);
    // Deux barres pour trois lignes : la ligne sans pilote n'en a pas.
    expect(html.match(/data-barre=""/g)).toHaveLength(2);
  });

  it("verdict écrit à côté de la teinte, seulement pour une mesure qui porte `vital`", () => {
    // La colonne « LCP p75 » double la valeur classée : elle n'est pas répétée, son
    // verdict passe sur la valeur (et la barre prend la teinte du verdict).
    expect(texte(html)).toContain("4,1 s Mauvais");
    expect(texte(html)).not.toContain("LCP p75 4100 ms");
    expect(html).toContain("bg-bad opacity-80");
  });

  it("pistes de largeur FIXE : une grille à colonnes, plus de `flex-1` qui dépend du texte voisin", () => {
    expect(html).toContain("sm:grid-cols-[10rem_12rem_6rem_minmax(0,1fr)]");
    expect(html).not.toContain("flex-1");
    // L'alternative garde toutes les colonnes, doublon compris.
    const alternative = html.split('data-testid="alternative"')[1] ?? "";
    expect(texte(alternative)).toContain("4100 ms (Mauvais)");
  });

  it("colonnePilote = null : aucune colonne n'est retirée", () => {
    const tout = renderToStaticMarkup(
      <ImpactTable {...BASE} tri="gravite" reference={null} referenceRaison="—" lignes={[LIGNE("/a", 900, 40)]} colonnePilote={null} />,
    );
    expect(texte(tout)).toContain("LCP p75 900 ms");
  });

  it("le tri impact indisponible dit sa raison (B2), sans lien", () => {
    expect(html).toMatch(/data-testid="tri-impact"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-testid="tri-impact"/);
    expect(texte(html)).toContain("mesures « Mauvais » par groupe");
    expect(html).toContain('href="/?tri=volume"');
  });

  it("aucune ligne « Autres », aucun total", () => {
    expect(texte(html)).not.toMatch(/\bAutres\b(?! »)|Total/);
  });

  it("ordre fourni : écrit sous le titre, pas de bascule ; sans référence, la raison", () => {
    const fourni = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        tri="fourni"
        ordreLibelle="Releases dans l'ordre chronologique."
        reference={null}
        referenceRaison="aucune part « toutes releases » n'est lue."
        lignes={[LIGNE("1.4.0", 10, 400), LIGNE("1.4.1", 30, 500)]}
      />,
    );
    expect(texte(fourni)).toContain("Releases dans l'ordre chronologique.");
    expect(fourni).not.toContain('data-testid="bascule-tri"');
    expect(texte(fourni)).toContain("Pas de ligne « Ensemble » : aucune part « toutes releases » n'est lue.");
    // L'ordre reçu est rendu tel quel.
    expect(fourni.indexOf("1.4.0")).toBeLessThan(fourni.indexOf("1.4.1"));
  });
});
