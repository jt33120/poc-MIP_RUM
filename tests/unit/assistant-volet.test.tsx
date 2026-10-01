// Le volet de l'assistant (`components/assistant/`), rendu côté serveur, et ses deux
// comportements sans rendu : la réponse demandée à la route (ou calculée sur place), et
// le surlignage d'une source sur la page.
//
// CE QUE CES TESTS EMPÊCHENT.
//   - Un volet qui ne dirait plus sa portée, ou sans ses quatre questions.
//   - Une réponse dont les citations ne seraient plus des pastilles numérotées, ou
//     dont la liste des sources perdrait le libellé, la valeur ou la cible.
//   - Une session de démonstration (la route la refuse) laissée sans réponse.
//   - Un surlignage qui ne s'enlève pas, ou une cible absente qui lèverait.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Assistant,
  obtenirReponse,
  ReponseAssistantVue,
  texteACopier,
  VoletAssistant,
  type MessageAssistant,
} from "@/components/assistant/Assistant";
import { CLASSE_SURLIGNAGE, DUREE_SURLIGNAGE_MS, surligner, trouverCible } from "@/components/assistant/surligner";
import { construireDigestVueEnsemble } from "@/lib/assistant/digest";
import { QUESTIONS_SUGGEREES, resumerEtat } from "@/lib/assistant/resume";
import { entrees } from "./assistant-fixtures";

const digest = construireDigestVueEnsemble(entrees());
const rien = () => undefined;
const volet = (messages: MessageAssistant[] = [], props: Partial<Parameters<typeof VoletAssistant>[0]> = {}) =>
  renderToStaticMarkup(
    <VoletAssistant
      digest={digest}
      messages={messages}
      enCours={false}
      saisie=""
      alerte={null}
      idTitre="assistant-titre"
      surSaisie={rien}
      surQuestion={rien}
      surSource={rien}
      surFermer={rien}
      {...props}
    />,
  );

describe("le volet — vide", () => {
  const html = volet();

  it("annonce sa portée : cet écran, l'application, la période, le nombre de chiffres lus", () => {
    expect(html).toContain('data-testid="assistant-portee"');
    for (const p of ["Vue d&#x27;ensemble", "boutique", "24 h", `${digest.faits.length} chiffres lus`]) expect(html).toContain(p);
  });

  it("propose les quatre questions, la première recevant le focus à l'ouverture", () => {
    expect(html.match(/data-testid="assistant-suggestion"/g)).toHaveLength(4);
    for (const q of QUESTIONS_SUGGEREES) expect(html).toContain(q.replace(/'/g, "&#x27;"));
    expect(html).toMatch(/data-premier=""[^>]*data-testid="assistant-suggestion"/);
  });

  it("se ferme par un bouton annoncé, et Échap", () => {
    expect(html).toMatch(/aria-label="Fermer l&#x27;assistant"[^>]*aria-keyshortcuts="Escape"/);
  });

  it("un champ de question borné à 500 caractères, étiqueté, un bouton d'envoi éteint à vide", () => {
    expect(html).toMatch(/<input[^>]*maxLength="500"/);
    expect(html).toContain('<label class="sr-only" for="assistant-titre-saisie">Question sur ce tableau de bord</label>');
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*aria-label="Envoyer la question"/);
  });
});

describe("le volet — une réponse et ses sources", () => {
  const reponse = resumerEtat(digest);
  const cites = digest.faits.filter((f) => reponse.citations.includes(f.id));
  const messages: MessageAssistant[] = [
    { id: 1, role: "question", texte: QUESTIONS_SUGGEREES[0] },
    { id: 2, role: "reponse", reponse, faits: cites },
  ];
  const html = volet(messages);

  it("chaque citation devient une pastille numérotée dans l'ordre, qui nomme sa source", () => {
    const pastilles = [...html.matchAll(/data-testid="assistant-pastille"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
    expect(pastilles.length).toBeGreaterThanOrEqual(reponse.citations.length);
    expect(Math.max(...pastilles)).toBe(reponse.citations.length);
    expect(html).toMatch(/aria-label="Source 1 : Santé de la période, 72 \/ 100\. Voir sur le tableau de bord"/);
    // Plus de crochets à l'écran : les citations sont toutes dessinées.
    expect(html).not.toMatch(/\[F\d+\]/);
  });

  it("la liste des sources : numéro, libellé, valeur, et la cible sur la page", () => {
    expect(html.match(/data-testid="assistant-source"/g)).toHaveLength(reponse.citations.length);
    expect(html).toContain('data-cible="#sante"');
    expect(html).toContain("Santé de la période");
    expect(html).toContain(`data-cible="[data-testid=&quot;tuile-erreurs&quot;]"`);
  });

  it("dit son mode et son avertissement, et garde les autres questions à portée", () => {
    const avecAvertissement = volet([messages[0], { ...messages[1], reponse: { ...reponse, avertissement: "Réponse calculée par règles : aucun modèle d'IA n'est configuré." } } as MessageAssistant]);
    expect(avecAvertissement).toContain('data-mode="regles"');
    expect(avecAvertissement).toContain(">Règles<");
    expect(avecAvertissement).toContain("aucun modèle d&#x27;IA n&#x27;est configuré");
    expect(avecAvertissement).toContain("Quelles pages sont les plus lentes ?");
    expect(avecAvertissement).not.toContain('data-testid="assistant-suggestion"');
  });

  it("une réponse du modèle nomme le modèle", () => {
    const html2 = renderToStaticMarkup(
      <ReponseAssistantVue reponse={{ mode: "modele", modele: "mistral-medium-latest", texte: "Santé 72 [F1].", citations: ["F1"] }} faits={digest.faits} surSource={rien} />,
    );
    expect(html2).toContain("IA · mistral-medium-latest");
  });

  it("une source absente de l'écran est dite dans le volet", () => {
    expect(volet(messages, { alerte: "« LCP p75 par tranche » n'est pas affiché sur l'écran en ce moment." })).toContain('data-testid="assistant-absent"');
  });

  it("le texte copié remplace les citations par leur numéro et liste les sources", () => {
    const texte = texteACopier({ mode: "regles", texte: "Santé 72 [F1]. Erreurs 3,2 % [F6].", citations: ["F1", "F6"] }, digest.faits);
    expect(texte).toMatch(/^Santé 72 \[1\]\. Erreurs 3,2 % \[2\]\.\n\nSources \(tableau de bord\) :\n\[1\] Santé de la période : 72/);
  });
});

describe("le bouton", () => {
  it("rendu serveur : le bouton seul, fermé, lié au volet (monté dans <body> après l'hydratation)", () => {
    const html = renderToStaticMarkup(<Assistant digest={digest} />);
    expect(html).toMatch(/data-testid="assistant-ouvrir"/);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/aria-controls="assistant-volet-/);
    expect(html).not.toContain('data-testid="assistant-volet"');
  });
});

describe("obtenirReponse — la route, ou les règles sur place", () => {
  const question = QUESTIONS_SUGGEREES[0];
  const repond = (statut: number, corps: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(corps), { status: statut }));

  it("la route répond : sa réponse, citations relues contre le condensé du navigateur", async () => {
    const appel = repond(200, { mode: "modele", modele: "m", texte: "Santé [F1] [F999].", citations: ["F1", "F999"] });
    const r = await obtenirReponse(question, digest, appel as unknown as typeof fetch);
    expect(appel).toHaveBeenCalledWith("/api/assistant", expect.objectContaining({ method: "POST" }));
    expect(r).toMatchObject({ mode: "modele", citations: ["F1"] });
  });

  it("session de démonstration (403) : réponse par règles, calculée ici, qui le dit", async () => {
    const r = await obtenirReponse(question, digest, repond(403) as unknown as typeof fetch);
    expect(r.mode).toBe("regles");
    expect(r.avertissement).toBe("Compte de démonstration : réponse calculée par règles, sans modèle d'IA.");
    expect(r.texte.split("\n")[0]).toMatch(/^Santé 72/);
  });

  it("débit atteint, session expirée, serveur en panne ou injoignable : toujours une réponse", async () => {
    expect((await obtenirReponse(question, digest, repond(429) as unknown as typeof fetch)).avertissement).toMatch(/Limite de questions/);
    expect((await obtenirReponse(question, digest, repond(401) as unknown as typeof fetch)).avertissement).toMatch(/Session expirée/);
    expect((await obtenirReponse(question, digest, repond(500) as unknown as typeof fetch)).avertissement).toMatch(/n'a pas répondu/);
    expect((await obtenirReponse(question, digest, repond(200, { rien: 1 }) as unknown as typeof fetch)).avertissement).toMatch(/illisible/);
    const panne = vi.fn(async () => Promise.reject(new TypeError("réseau")));
    expect((await obtenirReponse(question, digest, panne as unknown as typeof fetch)).avertissement).toMatch(/injoignable/);
  });
});

describe("surligner une source", () => {
  afterEach(() => vi.useRealTimers());

  /** Un élément de page minimal : ses classes, son défilement, ses ancêtres. */
  function element(tagName = "DIV", parentElement: unknown = null) {
    const classes = new Set<string>();
    return {
      tagName,
      parentElement,
      open: false,
      offsetWidth: 0,
      scrollIntoView: vi.fn(),
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
    };
  }

  it("trouve la cible, sinon son repli ; un sélecteur illisible ne lève pas", () => {
    const tuile = element();
    const racine = { querySelector: (s: string) => (s === '[data-testid="tuile-LCP"]' ? tuile : s === "(" ? (() => { throw new SyntaxError(s); })() : null) };
    expect(trouverCible(racine as never, '[data-testid="vignette-LCP"]', '[data-testid="tuile-LCP"]')).toBe(tuile);
    expect(trouverCible(racine as never, "(", '[data-testid="tuile-LCP"]')).toBe(tuile);
    expect(trouverCible(racine as never, "#absent")).toBeNull();
  });

  it("un grand format dans une fenêtre fermée : c'est la vignette qui l'ouvre qui se surligne", () => {
    const vignette = { getAttribute: (a: string) => (a === "aria-controls" ? "fenetre-1" : null) };
    const autre = { getAttribute: () => "fenetre-2" };
    const fenetre = { open: false, getAttribute: (a: string) => (a === "id" ? "fenetre-1" : null), previousElementSibling: null };
    const historique = {
      closest: (s: string) => (s === "dialog" ? fenetre : null),
      ownerDocument: { querySelectorAll: (s: string) => (s === "[aria-controls]" ? [autre, vignette] : []) },
    };
    const racine = { querySelector: (s: string) => (s === "#historique" ? historique : null) };
    expect(trouverCible(racine as never, "#historique")).toBe(vignette);
    // Fenêtre ouverte : la cible elle-même.
    fenetre.open = true;
    expect(trouverCible(racine as never, "#historique")).toBe(historique);
  });

  it("fait défiler jusqu'à la cible, la surligne 2,5 s, et ouvre le repli qui la cache", () => {
    vi.useFakeTimers();
    const details = element("DETAILS");
    const ligne = element("LI", details);
    surligner(ligne as never);
    expect(details.open).toBe(true);
    expect(ligne.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(ligne.classList.contains(CLASSE_SURLIGNAGE)).toBe(true);
    vi.advanceTimersByTime(DUREE_SURLIGNAGE_MS - 1);
    expect(ligne.classList.contains(CLASSE_SURLIGNAGE)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ligne.classList.contains(CLASSE_SURLIGNAGE)).toBe(false);
    expect(DUREE_SURLIGNAGE_MS).toBe(2500);
  });

  it("sans animation de défilement quand le mouvement est réduit", () => {
    const el = element();
    surligner(el as never, { reduit: true });
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
  });
});
