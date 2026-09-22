// EtatSurface (F02, § 3.8 / § 4.2) : chaque état a son texte et son rôle, et
// aucun ne peut se lire comme un autre. Rendu SSR réel (`renderToStaticMarkup`) :
// on vérifie ce que l'utilisateur lira, pas la structure des props.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EtatSurface, pctAuMoins, type Etat } from "@/components/states/EtatSurface";

const rendu = (etat: Etat, compact?: boolean) => renderToStaticMarkup(<EtatSurface etat={etat} compact={compact} />);

/** Texte lisible : balises retirées, entités et espaces insécables normalisés. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ");

describe("EtatSurface — échantillonné", () => {
  it("probabilité d'inclusion inconnue : jamais « 100 % »", () => {
    const html = rendu({ kind: "echantillonne", probaMin: null, unite: "session" });
    expect(texte(html)).toContain("probabilité d'inclusion de chaque session inconnue");
    expect(texte(html)).not.toMatch(/100\s*%/);
    expect(html).toContain('role="note"');
  });

  it("une probabilité hors de ]0, 1[ se lit comme inconnue, pas comme « toutes »", () => {
    for (const probaMin of [1, 0, Number.NaN, 1.2]) {
      const html = rendu({ kind: "echantillonne", probaMin, unite: "session" });
      expect(texte(html)).not.toMatch(/100\s*%/);
      expect(texte(html)).toContain("inconnue");
    }
  });

  it("probabilité connue : « au moins p % », comptes non extrapolés", () => {
    const t = texte(rendu({ kind: "echantillonne", probaMin: 0.25, unite: "session" }));
    expect(t).toContain("chaque session avait au moins 25 % de chances d'être retenue");
    expect(t).toContain("comptes observés, non extrapolés");
  });

  it("arrondi vers le bas : 0,9996 ne devient jamais « 100 % »", () => {
    expect(pctAuMoins(0.9996).replace(/\u00a0/g, " ")).toBe("99,9 %");
    expect(pctAuMoins(0.125).replace(/\u00a0/g, " ")).toBe("12,5 %");
    expect(pctAuMoins(0.0042).replace(/\u00a0/g, " ")).toBe("0,42 %");
  });

  it("biais des erreurs et sessions sans taux : dits, jamais corrigés", () => {
    const t = texte(rendu({ kind: "echantillonne", probaMin: 0.5, unite: "session", biaiseErreurs: true, sansTaux: 12 }));
    expect(t).toContain("Les sessions avec erreur sont sur-représentées : une part de sessions en erreur calculée ici est surestimée");
    expect(t).toContain("12 sessions commencées avant le 09/09/2026 : probabilité d'inclusion non enregistrée");
    const un = texte(rendu({ kind: "echantillonne", probaMin: 0.5, unite: "session", sansTaux: 1 }));
    expect(un).toContain("1 session commencée avant le 09/09/2026");
    const zero = texte(rendu({ kind: "echantillonne", probaMin: 0.5, unite: "session", sansTaux: 0 }));
    expect(zero).not.toContain("avant le 09/09/2026");
  });
});

describe("EtatSurface — autres états", () => {
  it("vide : population et plage, geste utile, rôle status", () => {
    const html = rendu({
      kind: "vide",
      population: "session commencée",
      plage: "24 h",
      geste: { libelle: "Élargir à 7 jours", href: "/sessions?period=7d" },
    });
    expect(texte(html)).toContain("Aucune session commencée sur 24 h.");
    expect(html).toContain('href="/sessions?period=7d"');
    expect(html).toContain('role="status"');
  });

  it("erreur : le titre de la section, sans bouton, rôle alert", () => {
    const html = rendu({ kind: "erreur", titre: "Historique de santé", digest: "abc123" });
    const t = texte(html);
    expect(t).toContain("Lecture en échec.");
    expect(t).toContain("La lecture de « Historique de santé » a échoué. Les autres blocs restent valides.");
    expect(t).toContain("Référence : abc123");
    expect(html).toContain('role="alert"');
    // Le bouton « Réessayer » vit dans SectionErreur, pas ici.
    expect(html).not.toContain("<button");
  });

  it("partiel et non collecté : une note, jamais un chiffre", () => {
    const partiel = rendu({ kind: "partiel", raison: "liste tronquée à 200 routes" });
    expect(texte(partiel)).toContain("Partiel : liste tronquée à 200 routes");
    expect(partiel).toContain('role="note"');
    const nc = rendu({ kind: "non_collecte", manque: "la table des actions n'existe pas sur ce déploiement" });
    expect(texte(nc)).toContain("Non collecté : la table des actions n'existe pas sur ce déploiement");
    expect(nc).toContain('role="note"');
  });

  it("chargement : aria-busy et texte pour lecteur d'écran", () => {
    const html = rendu({ kind: "chargement", titre: "Vue d'ensemble" });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(texte(html)).toContain("Chargement de Vue d'ensemble");
  });

  it("compact : même texte, cadre resserré", () => {
    const html = rendu({ kind: "partiel", raison: "x" }, true);
    expect(html).toContain("text-xs");
    expect(texte(html)).toContain("Partiel : x");
  });
});
