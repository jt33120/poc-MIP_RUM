// Écrans de performance resserrés (recette du 30/09/2026) : ce qui tenait sur une
// grande boîte ou un paragraphe tient sur UNE ligne, et la vérité qu'il portait reste
// dans la page — dans une fenêtre, une bulle ou le texte lu par les lecteurs d'écran.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ExperienceUnavailable } from "@/components/ExperienceUnavailable";
import { ErrorNotices } from "@/components/errors/ErrorNotices";
import { FiltreStatut } from "@/components/errors/ListeErreurs";
import { StabiliteParRelease } from "@/components/mobile/StabiliteParRelease";
import { BoutonFenetre } from "@/components/perf/BoutonFenetre";
import { CATEGORIE_VITAL, SOURCE_VITAL } from "@/components/perf/sources";
import { VITAUX } from "@/lib/fmt-ids";
import type { MobileParRelease } from "@/lib/queries-mobile";

const rendu = (el: ReactElement) => renderToStaticMarkup(el);
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("BoutonFenetre — une ligne qui ouvre une fenêtre", () => {
  const html = rendu(
    <BoutonFenetre libelle="Installer →" titre="Installer le module d'avis" testId="ouvrir">
      <pre>{`<script src="/mip-rum-feedback.js"></script>`}</pre>
    </BoutonFenetre>,
  );

  it("un bouton annoncé comme ouvrant une fenêtre, et un <dialog> natif nommé", () => {
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*data-testid="ouvrir"/);
    expect(html).toMatch(/<dialog[^>]*aria-label="Installer le module d&#x27;avis"/);
    // Fermée par défaut : aucun attribut `open` rendu au serveur.
    expect(html).not.toMatch(/<dialog[^>]* open/);
  });

  it("le contenu de la fenêtre reste dans la page (lu par une recherche de texte)", () => {
    expect(texte(html)).toContain('<script src="/mip-rum-feedback.js"></script>');
    expect(html).toContain('aria-label="Fermer"');
  });
});

describe("sources des cases — chaque mesure dit d'où elle vient", () => {
  it("les cinq Web Vitals ont une source qui cite l'API du navigateur et la référence des seuils", () => {
    for (const vital of VITAUX) {
      expect(SOURCE_VITAL[vital]).toMatch(/web-vitals/);
      expect(SOURCE_VITAL[vital]).toContain("web.dev");
      expect(CATEGORIE_VITAL[vital]).toBeTruthy();
    }
  });
});

describe("états vides sur une ligne", () => {
  it("Satisfaction sans avis : « Données insuffisantes », sur une ligne, sans boîte de 260 px", () => {
    const html = rendu(<ExperienceUnavailable />);
    expect(texte(html)).toContain("Données insuffisantes");
    expect(texte(html)).toContain("la satisfaction ne se trace pas");
    expect(html).not.toContain("h-[260px]");
    expect(html).not.toContain("/100");
  });

  it("Mobile sans session : la stabilité par release dit son vide sur une ligne, sans table", () => {
    const vide: Extract<MobileParRelease, { disponible: true }> = {
      disponible: true,
      releases: 0,
      apps: 1,
      tronque: false,
      lignes: [],
      declarantes: { rate: null, reason: null, sessions: 0, touchees: 0, exclues: 0, occurrences: null },
    };
    const html = rendu(
      <StabiliteParRelease
        resultat={vide}
        tri="fourni"
        triHref={{ fourni: "/mobile", gravite: "/mobile?tri=gravite", volume: "/mobile?tri=volume" }}
        hrefDeRelease={() => "/mobile"}
        plage="24 h"
      />,
    );
    expect(texte(html)).toContain("Aucune session React Native sur 24 h.");
    expect(html).not.toContain('data-testid="impact-table"');
    // Le vide est une ligne de texte, pas une boîte encadrée.
    expect(html).not.toContain("rounded-lg border leading-relaxed");
  });
});

describe("réserves des erreurs en pastilles", () => {
  it("échantillonnage et enrichissement : deux mots à l'écran, la phrase entière dans la page", () => {
    const html = rendu(
      <ErrorNotices
        sampling={{ min_inclusion_probability: 0.5, message: "Occurrences échantillonnées : une sur deux est gardée." }}
        enrichment={{ available: false, diagnostic: "Pile non symbolisée : aucune source map déposée." }}
      />,
    );
    expect(texte(html)).toContain("Échantillonné");
    expect(texte(html)).toContain("Occurrences échantillonnées : une sur deux est gardée.");
    expect(texte(html)).toContain("Enrichissement partiel");
    expect(texte(html)).toContain("Pile non symbolisée : aucune source map déposée.");
    expect(html).toContain('class="sr-only"');
  });

  it("rien à signaler : aucun bloc rendu", () => {
    const html = rendu(
      <ErrorNotices sampling={{ min_inclusion_probability: null, message: null }} enrichment={{ available: true, diagnostic: null }} />,
    );
    expect(html).toBe("");
  });
});

describe("filtre de statut — dans la rangée d'en-tête, sans carte", () => {
  it("formulaire GET intact, sans carte ni bouton plein", () => {
    const html = rendu(<FiltreStatut caches={[["app", "boutique"]]} statut={null} hrefSansFiltre="/errors?app=boutique" />);
    expect(html).toContain('method="get"');
    expect(html).toContain('name="statut"');
    expect(html).not.toMatch(/class="card /);
    expect(html).not.toContain("btn-accent");
  });
});
