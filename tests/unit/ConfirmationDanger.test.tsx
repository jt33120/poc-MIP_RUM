// ConfirmationDanger (recette du 26/09/2026, revues E et F) : un geste qui ne se
// défait pas demande une confirmation DANS la page, qui nomme la cible et dit la
// conséquence.
//
// Sans navigateur, on ne clique pas : on vérifie ce que le serveur rend (fermé, sans
// aucun `submit` — le geste ne peut pas partir en un clic), le déclencheur grisé
// d'un geste interdit, et l'encadré ouvert rendu seul (`EncadreConfirmation`).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmationDanger, EncadreConfirmation } from "@/components/ConfirmationDanger";

const QUESTION = "Désactiver l’application « Mini-site de démo » ?";
const CONSEQUENCE = "Ses données seront refusées jusqu’à sa réactivation.";

const rendre = (props: Partial<React.ComponentProps<typeof ConfirmationDanger>> = {}) =>
  renderToStaticMarkup(
    <form>
      <input type="hidden" name="app_id" value="demo-app" />
      <ConfirmationDanger
        libelle="Désactiver"
        question={QUESTION}
        consequence={CONSEQUENCE}
        confirmer="Désactiver l’application"
        testid="desactiver-demo-app"
        {...props}
      />
    </form>,
  );

const attr = (html: string, nom: string) => new RegExp(`${nom}="([^"]*)"`).exec(html)?.[1];

describe("ConfirmationDanger — rendu serveur", () => {
  it("fermé : un déclencheur `button`, aucun `submit` — le formulaire ne part pas en un clic", () => {
    const html = rendre();
    expect(html).not.toContain('type="submit"');
    expect(html).toMatch(/<button type="button" aria-expanded="false"/);
    expect(html).toContain(">Désactiver</button>");
    // La question n'est pas rendue tant que rien n'est demandé.
    expect(html).not.toContain("Mini-site de démo");
  });

  it("`aria-controls` désigne un élément qui existe, masqué", () => {
    const html = rendre();
    const cible = attr(html, "aria-controls");
    expect(cible).toBeTruthy();
    expect(html).toContain(`<div id="${cible}" class="hidden"></div>`);
  });

  it("style « danger » par défaut, remplaçable ; nom accessible pour un symbole", () => {
    expect(rendre()).toContain("text-bad-ink");
    const croix = rendre({ libelle: "✕", libelleAccessible: "Retirer la carte « Sessions » — 2 sur 5", classeDeclencheur: "btn-ghost" });
    expect(croix).toContain('aria-label="Retirer la carte « Sessions » — 2 sur 5"');
    expect(croix).toContain('class="btn-ghost"');
  });

  it("deux rendus identiques : rien d'aléatoire qui casserait l'hydratation", () => {
    expect(rendre()).toBe(rendre());
  });
});

describe("ConfirmationDanger — geste interdit", () => {
  const RAISON = "Vous ne pouvez pas désactiver votre propre compte.";
  const html = rendre({ desactive: true, raisonDesactive: RAISON });

  it("grisé mais focalisable (`aria-disabled`, pas `disabled`), sans encadré à ouvrir", () => {
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("aria-controls");
    expect(html).toContain("opacity-50");
  });

  it("dit pourquoi : infobulle, et texte lu par le lecteur d'écran", () => {
    expect(html).toContain(`title="${RAISON}"`);
    const id = attr(html, "aria-describedby");
    expect(html).toContain(`<span id="${id}" class="sr-only">${RAISON}</span>`);
  });
});

describe("EncadreConfirmation — ouvert", () => {
  const encadre = (p: Partial<React.ComponentProps<typeof EncadreConfirmation>> = {}) =>
    renderToStaticMarkup(
      <EncadreConfirmation
        id="c-encadre"
        idQuestion="c-question"
        idConsequence="c-consequence"
        ouvert
        flottant={false}
        question={QUESTION}
        consequence={CONSEQUENCE}
        confirmer="Désactiver l’application"
        enCours="En cours…"
        envoi={false}
        soumettre
        testid="t"
        {...p}
      />,
    );

  it("nomme la cible et dit la conséquence : groupe nommé par sa question, décrit par sa conséquence", () => {
    const html = encadre();
    expect(html).toMatch(/role="group" aria-labelledby="c-question" aria-describedby="c-consequence" tabindex="-1"/);
    expect(html).toContain(`<p id="c-question" class="font-semibold text-ink">${QUESTION}</p>`);
    expect(html).toContain(`<p id="c-consequence" class="mt-1">${CONSEQUENCE}</p>`);
  });

  it("dans un formulaire : la confirmation SOUMET le formulaire parent ; « Annuler » ne soumet rien", () => {
    const html = encadre();
    expect(html).toMatch(/<button type="submit" data-testid="t-confirmer" class="[^"]*bg-bad-fond[^"]*">Désactiver l’application<\/button>/);
    expect(html).toMatch(/<button type="button" class="btn-ghost[^"]*">Annuler<\/button>/);
  });

  it("avec un gestionnaire client : la confirmation est un simple bouton", () => {
    const html = encadre({ soumettre: false, onConfirmer: () => undefined });
    expect(html).not.toContain('type="submit"');
    expect(html).toMatch(/<button type="button" data-testid="t-confirmer"/);
  });

  it("pendant l'envoi : libellé d'attente, boutons inactifs (pas de double envoi)", () => {
    const html = encadre({ envoi: true });
    expect(html).toContain(">En cours…</button>");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("flottant : posé sous le déclencheur, jamais plus large que la fenêtre", () => {
    const html = encadre({ flottant: true });
    expect(html).toContain("absolute");
    expect(html).toContain("max-w-[calc(100vw-2rem)]");
  });
});
