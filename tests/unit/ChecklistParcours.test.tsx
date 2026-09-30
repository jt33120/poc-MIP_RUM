// La check-list d'un parcours de `/installer` : cocher, le compteur « 3 / 7 », l'état
// « tout est fait ».
//
// Sans navigateur, on ne clique pas : `VueChecklist` est le rendu PUR de la
// check-list (les cases cochées lui sont données), et `basculerCoche` est ce que
// fait le clic. On rend donc l'état avant et après un clic, et l'on vérifie ce que
// le serveur écrit : de vraies cases à cocher reliées à leur libellé, un compteur
// juste, et des cases de la sonde que le clic ne change pas.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VueChecklist, type EtapeChecklist } from "@/components/installer/ChecklistParcours";
import { basculerCoche } from "@/lib/installer";

const ETAPES: EtapeChecklist[] = [
  { id: "domaines", groupe: "prerequis", titre: "Vos domaines sont déclarés" },
  { id: "copier", groupe: "installation", titre: "Copier le code de suivi" },
  { id: "consentement", groupe: "installation", titre: "Brancher le consentement", facultatif: true },
  { id: "sdk-mesures", groupe: "verification", titre: "Web Vitals reçues", sonde: { ok: false, detail: "en attente" } },
];

const rendre = (coches: ReadonlySet<string>, etapes = ETAPES) =>
  renderToStaticMarkup(
    <VueChecklist parcours="snippet" titre="Code de suivi" etapes={etapes} coches={coches} onBasculer={() => undefined} />,
  );

/** Le compteur, sans le texte réservé aux lecteurs d'écran. */
const compteur = (html: string) =>
  /data-testid="compteur-snippet"[^>]*>(?:<span class="sr-only">[^<]*<\/span>)?([^<]*)<\/span>/.exec(html)?.[1];

/** La balise `<input>` d'une case, par son identifiant d'étape. */
const caseDe = (html: string, id: string) => new RegExp(`<input[^>]*id="case-snippet-${id}"[^>]*>`).exec(html)?.[0] ?? "";

describe("VueChecklist — cases, compteur, tout coché", () => {
  it("au départ : rien de coché, « 0 / 4 », pas d'état « tout est fait »", () => {
    const html = rendre(new Set());
    expect(compteur(html)).toBe("0 / 4");
    expect(html).toContain('data-complet="non"');
    expect(html).not.toContain("Tout est fait");
    expect(caseDe(html, "domaines")).not.toContain('checked=""');
  });

  it("de vraies cases à cocher, chacune reliée à son libellé (accessibles au clavier)", () => {
    const html = rendre(new Set());
    for (const e of ETAPES) {
      expect(caseDe(html, e.id)).toContain('type="checkbox"');
      expect(html).toContain(`<label for="case-snippet-${e.id}"`);
    }
    // Les cases manuelles ne sont pas désactivées ; une étape facultative le dit.
    expect(caseDe(html, "copier")).not.toContain('disabled=""');
    expect(html).toContain("(facultatif)");
  });

  it("cocher une case (le clic) : elle est cochée et le compteur passe à « 1 / 4 »", () => {
    const apres = basculerCoche(new Set(), "copier");
    const html = rendre(apres);
    expect(caseDe(html, "copier")).toContain('checked=""');
    expect(compteur(html)).toBe("1 / 4");
    expect(html).toContain('data-testid="etape-snippet-copier" data-etat="fait"');
    // La décocher la rend.
    expect(compteur(rendre(basculerCoche(apres, "copier")))).toBe("0 / 4");
  });

  it("la case de la sonde est désactivée : un clic ne la coche pas, seule la sonde la passe au vert", () => {
    const html = rendre(new Set(["sdk-mesures"]));
    expect(caseDe(html, "sdk-mesures")).toContain('disabled=""');
    expect(caseDe(html, "sdk-mesures")).not.toContain('checked=""');
    expect(compteur(html)).toBe("0 / 4");
    expect(html).toContain("vérifié automatiquement");
  });

  it("tout coché et la sonde au vert : « 4 / 4 » et l'état « tout est fait »", () => {
    const vue = ETAPES.map((e) => (e.sonde ? { ...e, sonde: { ok: true, detail: "dernière à 30/09 à 14:03" } } : e));
    const html = rendre(new Set(["domaines", "copier", "consentement"]), vue);
    expect(compteur(html)).toBe("4 / 4");
    expect(html).toContain('data-complet="oui"');
    expect(html).toContain('data-testid="complet-snippet"');
    expect(html).toContain("Tout est fait");
    expect(caseDe(html, "sdk-mesures")).toContain('checked=""');
  });

  it("numérotation continue d'un groupe à l'autre, et trois groupes dans l'ordre", () => {
    const html = rendre(new Set());
    const groupes = ["Prérequis propres à votre application", "Installation", "Vérification en direct"].map((g) => html.indexOf(g));
    expect(groupes.every((i) => i >= 0)).toBe(true);
    expect([...groupes].sort((a, b) => a - b)).toEqual(groupes);
    expect(html).toContain('<ol class="grid gap-2" start="4">');
  });

  it("deux rendus identiques : rien d'aléatoire qui casserait l'hydratation", () => {
    expect(rendre(new Set())).toBe(rendre(new Set()));
  });
});
