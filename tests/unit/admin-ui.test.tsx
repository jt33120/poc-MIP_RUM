// La grammaire des écrans d'administration (refonte du 01/10/2026, `app/admin/_ui`) :
// le temps écoulé écrit court, la part de validité restante, la recherche sans accents,
// la nature d'une action d'audit, et le rendu serveur des briques (pastille, état vide
// sur une ligne, panneau, instant relatif, fenêtre fermée).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Fenetre } from "@/app/admin/_ui/Fenetre";
import { LigneVide, Moment, Panneau, Pastille } from "@/app/admin/_ui/kit";
import { normaliserRecherche } from "@/app/admin/_ui/recherche";
import { ilYa, partRestante, versMs } from "@/app/admin/_ui/temps";
import { natureAction } from "@/app/admin/audit/nature";

const MAINTENANT = Date.parse("2026-10-01T12:00:00Z");
const NBSP = " ";
const avant = (ms: number) => new Date(MAINTENANT - ms).toISOString();

describe("ilYa — le temps écoulé, court, sans horloge cachée", () => {
  it("de l'instant aux mois, une seule unité", () => {
    expect(ilYa(avant(20_000), MAINTENANT)).toBe("à l'instant");
    expect(ilYa(avant(12 * 60_000), MAINTENANT)).toBe(`il y a 12${NBSP}min`);
    expect(ilYa(avant(3 * 3_600_000), MAINTENANT)).toBe(`il y a 3${NBSP}h`);
    expect(ilYa(avant(4 * 86_400_000), MAINTENANT)).toBe(`il y a 4${NBSP}j`);
    expect(ilYa(avant(95 * 86_400_000), MAINTENANT)).toBe(`il y a 3${NBSP}mois`);
  });

  it("une échéance future s'écrit « dans … »", () => {
    expect(ilYa(new Date(MAINTENANT + 29 * 86_400_000 + 5_000), MAINTENANT)).toBe(`dans 29${NBSP}j`);
  });

  it("un instant illisible donne « — », jamais une durée inventée", () => {
    expect(ilYa("pas une date", MAINTENANT)).toBe("—");
    expect(Number.isNaN(versMs("pas une date"))).toBe(true);
  });
});

describe("partRestante — la barre d'échéance d'un jeton", () => {
  const debut = MAINTENANT - 10 * 86_400_000;
  const fin = MAINTENANT + 30 * 86_400_000;
  it("la part de validité qui reste, bornée à [0, 1]", () => {
    expect(partRestante(debut, fin, MAINTENANT)).toBeCloseTo(0.75, 5);
    expect(partRestante(debut, fin, fin + 1)).toBe(0);
    expect(partRestante(debut, fin, debut - 1)).toBe(1);
  });
  it("une validité nulle ou illisible n'a pas de barre", () => {
    expect(partRestante(fin, debut, MAINTENANT)).toBeNull();
    expect(partRestante("?", fin, MAINTENANT)).toBeNull();
  });
});

describe("normaliserRecherche — casse et accents ignorés", () => {
  it("« Désactivé » se trouve en tapant « desactive »", () => {
    expect(normaliserRecherche("  Désactivé  ")).toBe("desactive");
    expect(normaliserRecherche("Jean-François\nÉLU")).toBe("jean-francois elu");
  });
});

describe("natureAction — la teinte d'une action d'audit vient de son code", () => {
  it.each([
    ["user_create", "creation"],
    ["read_token.create", "creation"],
    ["auth_signup", "creation"],
    ["read_token_revoke", "suppression"],
    ["extension_install_forget", "suppression"],
    ["login_failed", "refus"],
    ["auth_oidc_refused", "refus"],
    ["login", "autre"],
    ["app_update_origins", "autre"],
    ["isolation.test", "autre"],
  ])("%s → %s", (code, nature) => {
    expect(natureAction(code)).toBe(nature);
  });
});

describe("briques de rendu (serveur)", () => {
  it("Pastille : un point décoratif ET un mot — le nom de la cellule reste le mot", () => {
    const html = renderToStaticMarkup(<Pastille ton="mauvais">révoqué</Pastille>);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<\/span>révoqué<\/span>$/);
    expect(html).toContain("bg-bad");
  });

  it("LigneVide : une ligne, le pictogramme ⊘, son repère de test", () => {
    const html = renderToStaticMarkup(<LigneVide testId="uptime-vide">Aucune sonde.</LigneVide>);
    expect(html).toContain('data-testid="uptime-vide"');
    expect(html).toContain('role="status"');
    expect(html).toContain("⊘");
    expect(html).not.toContain("<p");
  });

  it("Panneau : titre, compte, et pas de région nommée (le tableau porte la sienne)", () => {
    const html = renderToStaticMarkup(
      <Panneau titre="Jetons" compte={1234} aide="Explication">
        <p>contenu</p>
      </Panneau>,
    );
    expect(html).toContain("Jetons");
    expect(html).toContain("1 234".replace(" ", " "));
    expect(html).not.toContain("<section");
    expect(html).not.toContain("aria-labelledby");
    expect(html).toContain('role="tooltip"');
  });

  it("Moment : relatif à l'écran, l'instant exact au survol et pour le lecteur d'écran ; « jamais » sans instant", () => {
    const html = renderToStaticMarkup(<Moment date={avant(3 * 3_600_000)} maintenant={MAINTENANT} />);
    expect(html).toContain(`il y a 3${NBSP}h`);
    expect(html).toContain('dateTime="2026-10-01T09:00:00.000Z"');
    expect(html).toContain("01/10/2026");
    expect(renderToStaticMarkup(<Moment date={null} maintenant={MAINTENANT} vide="jamais" />)).toContain("jamais");
  });

  it("Fenetre : un bouton qui annonce une fenêtre, la fenêtre fermée au rendu, son contenu présent", () => {
    const html = renderToStaticMarkup(
      <Fenetre libelle="Créer un jeton" titre="Créer un jeton d'accès" testId="ouvrir">
        <form data-testid="formulaire" />
      </Fenetre>,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('data-testid="ouvrir"');
    expect(html).toContain('data-testid="ouvrir-fenetre"');
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).toContain('data-testid="formulaire"');
    expect(html).toContain("Créer un jeton d&#x27;accès");
  });
});
