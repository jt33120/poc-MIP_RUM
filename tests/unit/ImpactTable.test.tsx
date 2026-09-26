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

  // Recette du 26/09/2026 : « Impact » barré en permanence. Un ordre que l'écran ne
  // propose pas n'est pas montré ; les ordres proposés restent des liens.
  it("un ordre non proposé (impact) n'est pas affiché ; l'ordre proposé est un lien", () => {
    expect(html).not.toContain('data-testid="tri-impact"');
    expect(html).toContain('data-testid="tri-gravite"');
    expect(html).toContain('href="/?tri=volume"');
  });

  it("un seul ordre possible : il est écrit, pas proposé comme un choix", () => {
    const seul = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        tri="gravite"
        triHref={{ gravite: "/?", volume: null, impact: null, fourni: null }}
        reference={null}
        referenceRaison="—"
        lignes={[LIGNE("/a", 900, 40)]}
      />,
    );
    expect(seul).not.toContain('data-testid="bascule-tri"');
    expect(texte(seul)).toContain("Classés par gravité");
  });

  it("un sélecteur de l'écran (le vital) se pose dans la même rangée que l'ordre", () => {
    const avec = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        tri="gravite"
        commandes={<nav data-testid="choix-vital">Vital : LCP p75</nav>}
        reference={null}
        referenceRaison="—"
        lignes={[LIGNE("/a", 900, 40)]}
      />,
    );
    const rangee = avec.split('data-testid="impact-commandes"')[1]?.split("</div>")[0] ?? "";
    expect(rangee).toContain('data-testid="choix-vital"');
    expect(rangee).toContain('data-testid="bascule-tri"');
  });

  it("une notice vide ne laisse aucun paragraphe vide", () => {
    const sans = renderToStaticMarkup(
      <ImpactTable {...BASE} notice="" tri="gravite" reference={null} referenceRaison="—" lignes={[LIGNE("/a", 900, 40)]} />,
    );
    expect(sans).not.toMatch(/<p[^>]*><\/p>/);
  });

  it("valeur approchée : la valeur classée s'écrit « ≈ »", () => {
    const approchee = renderToStaticMarkup(
      <ImpactTable {...BASE} approchee tri="gravite" reference={null} referenceRaison="—" lignes={[LIGNE("/a", 93, 40)]} />,
    );
    expect(texte(approchee)).toContain("≈ 93 ms");
  });

  // Recette du 26/09/2026 : la tuile disait « verdict incertain » pour 304 ms, la table
  // « À améliorer ». Avec son intervalle, la table suit la règle des tuiles.
  it("verdict avec intervalle : affirmé s'il tient sur tout l'intervalle, sinon « incertain » sans couleur", () => {
    const ligne = (cle: string, pilote: number, bas: number, haut: number): ImpactLigne => ({
      ...LIGNE(cle, pilote, 400),
      mesures: [
        {
          cle: "inp",
          valeur: pilote,
          affichage: `${pilote} ms`,
          vital: "INP",
          n: 400,
          intervalle: { bas, haut, niveau: 0.95, methode: "quantile_normal" },
        },
      ],
    });
    const rendu = renderToStaticMarkup(
      <ImpactTable
        {...BASE}
        colonnes={["INP p75"]}
        tri="gravite"
        reference={null}
        referenceRaison="—"
        lignes={[ligne("/incertain", 304, 180, 330), ligne("/etabli", 320, 260, 380)]}
      />,
    );
    const lignes = rendu.split('data-testid="impact-ligne"').slice(1);
    expect(texte(lignes[0])).toContain("verdict incertain : entre Bon et À améliorer");
    expect(lignes[0]).not.toMatch(/bg-warn|bg-good|bg-bad/);
    expect(texte(lignes[1])).toContain("À améliorer");
    expect(lignes[1]).toContain('data-verdict="etabli"');
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
