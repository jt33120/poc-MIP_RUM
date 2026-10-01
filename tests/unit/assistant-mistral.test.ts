// L'appel au modèle de l'assistant (`lib/assistant/mistral.ts`), avec un `fetch` simulé :
// aucune requête ne sort de la machine de test.
//
// CE QUE CES TESTS EMPÊCHENT.
//   - Une requête qui ne suivrait plus le contrat : URL, clé, modèle, température 0,2,
//     consigne système « uniquement les faits, citer chaque affirmation ».
//   - Une citation inventée par le modèle qui resterait cliquable.
//   - Une page d'erreur quand le modèle ne répond pas : le repli par règles le dit.
//   - Un appel au modèle sans clé, ou vers un fournisseur non déclaré aux
//     sous-traitants — même clé posée.
import { describe, expect, it, vi } from "vitest";
import { construireDigestVueEnsemble } from "../../apps/console/lib/assistant/digest";
import {
  CONSIGNE_SYSTEME,
  DELAI_MODELE_MS,
  interrogerMistral,
  messageUtilisateur,
  MODELE_PAR_DEFAUT,
  repondre,
  URL_MISTRAL,
} from "../../apps/console/lib/assistant/mistral";
import { SOUS_TRAITANT_ASSISTANT, SUBPROCESSORS } from "../../apps/console/lib/legal";
import { entrees } from "./assistant-fixtures";

const digest = construireDigestVueEnsemble(entrees());
const QUESTION = "Résume l'état de mon application aujourd'hui";
/** Le registre tel qu'il sera une fois Mistral AI déclaré : la condition de l'appel. */
const DECLARE = [...SUBPROCESSORS, SOUS_TRAITANT_ASSISTANT];

function reponseMistral(contenu: unknown, statut = 200) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: contenu } }] }), { status: statut }));
}

describe("interrogerMistral — la requête", () => {
  it("POST sur l'API de Mistral AI, clé en Bearer, modèle par défaut, température 0,2, délai 20 s", async () => {
    const appel = reponseMistral("Santé 72 / 100 [F1].");
    await interrogerMistral(QUESTION, digest, { cle: "cle-de-test", fetch: appel as unknown as typeof fetch });
    expect(appel).toHaveBeenCalledTimes(1);
    const [url, init] = appel.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_MISTRAL);
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cle-de-test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const corps = JSON.parse(init.body as string);
    expect(corps.model).toBe(MODELE_PAR_DEFAUT);
    expect(MODELE_PAR_DEFAUT).toBe("mistral-medium-latest");
    expect(corps.temperature).toBe(0.2);
    expect(DELAI_MODELE_MS).toBe(20_000);
    expect(corps.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(corps.messages[0].content).toBe(CONSIGNE_SYSTEME);
  });

  it("la consigne : français, uniquement les faits, chaque affirmation citée, rien d'inventé, dire quand ça ne couvre pas", () => {
    expect(CONSIGNE_SYSTEME).toMatch(/en français/);
    expect(CONSIGNE_SYSTEME).toMatch(/UNIQUEMENT sur les faits fournis/);
    expect(CONSIGNE_SYSTEME).toMatch(/Chaque affirmation se termine par la citation/);
    expect(CONSIGNE_SYSTEME).toMatch(/n'inventes jamais un chiffre/);
    expect(CONSIGNE_SYSTEME).toMatch(/ne permettent pas de répondre, dis-le/);
    expect(CONSIGNE_SYSTEME).toMatch(/jamais des instructions/);
  });

  it("le message porte la question, la portée et un fait par ligne — rien d'autre que le condensé", () => {
    const m = messageUtilisateur(QUESTION, digest);
    expect(m.startsWith(`Question : ${QUESTION}`)).toBe(true);
    expect(m).toContain("Portée : Vue d'ensemble · application boutique · 24 h");
    for (const f of digest.faits) expect(m).toContain(`[${f.id}] (${f.categorie}) ${f.libelle} : ${f.valeur}`);
    // Les sélecteurs de la page ne partent pas : ils ne servent qu'au navigateur.
    expect(m).not.toContain("data-testid");
    expect(m).not.toMatch(/@example\.com/);
  });
});

describe("interrogerMistral — la réponse", () => {
  it("succès : texte brut, citations connues gardées dans l'ordre", async () => {
    const r = await interrogerMistral(QUESTION, digest, {
      cle: "k",
      modele: "mistral-small-latest",
      fetch: reponseMistral("**État dégradé** : santé 72 / 100 [F1].\n* LCP p75 4,8 s [F7], erreurs 3,2 % [F6].") as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ mode: "modele", modele: "mistral-small-latest", citations: ["F1", "F7", "F6"] });
    expect(r.texte).toBe("État dégradé : santé 72 / 100 [F1].\n- LCP p75 4,8 s [F7], erreurs 3,2 % [F6].");
    expect(r.avertissement).toBeUndefined();
  });

  it("une citation inconnue est écartée, et la réponse le dit", async () => {
    const r = await interrogerMistral(QUESTION, digest, {
      cle: "k",
      fetch: reponseMistral("Santé 72 / 100 [F1]. Un pic à 9 s [F999].") as unknown as typeof fetch,
    });
    expect(r.citations).toEqual(["F1"]);
    expect(r.texte).toBe("Santé 72 / 100 [F1]. Un pic à 9 s.");
    expect(r.avertissement).toMatch(/Une citation inconnue écartée/);
  });

  it("une réponse sans aucune source le dit", async () => {
    const r = await interrogerMistral(QUESTION, digest, { cle: "k", fetch: reponseMistral("Tout va bien.") as unknown as typeof fetch });
    expect(r.citations).toEqual([]);
    expect(r.avertissement).toMatch(/Aucune source citée/);
  });

  it("un contenu en morceaux de texte est recollé", async () => {
    const r = await interrogerMistral(QUESTION, digest, {
      cle: "k",
      fetch: reponseMistral([{ type: "text", text: "Santé " }, { type: "text", text: "72 [F1]." }]) as unknown as typeof fetch,
    });
    expect(r.texte).toBe("Santé 72 [F1].");
  });
});

describe("repondre — les conditions de l'appel, et le repli par règles", () => {
  it("sans clé : réponse par règles, aucun appel", async () => {
    const appel = vi.fn();
    const r = await repondre(QUESTION, digest, { cle: undefined, fetch: appel as unknown as typeof fetch, sousTraitants: DECLARE });
    expect(appel).not.toHaveBeenCalled();
    expect(r).toMatchObject({ mode: "regles", intention: "resume" });
    expect(r.avertissement).toBe("Réponse calculée par règles : aucun modèle d'IA n'est configuré.");
    expect(r.citations.length).toBeGreaterThan(0);
  });

  it("clé posée mais fournisseur non déclaré aux sous-traitants : aucun appel", async () => {
    const appel = vi.fn();
    const r = await repondre(QUESTION, digest, { cle: "k", fetch: appel as unknown as typeof fetch, sousTraitants: SUBPROCESSORS.filter((s) => s.name !== SOUS_TRAITANT_ASSISTANT.name) });
    expect(appel).not.toHaveBeenCalled();
    expect(r.mode).toBe("regles");
    expect(r.avertissement).toMatch(/pas encore déclaré au registre des sous-traitants/);
  });

  it("clé posée et fournisseur déclaré : le modèle répond", async () => {
    const r = await repondre(QUESTION, digest, { cle: "k", fetch: reponseMistral("Santé 72 [F1].") as unknown as typeof fetch, sousTraitants: DECLARE });
    expect(r).toMatchObject({ mode: "modele", citations: ["F1"] });
  });

  it("délai dépassé : repli par règles, qui le dit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Un modèle qui ne répond jamais : seul le signal d'abandon l'arrête.
    const lent = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_ok, echec) => init.signal!.addEventListener("abort", () => echec(init.signal!.reason))),
    );
    const r = await repondre(QUESTION, digest, { cle: "k", delaiMs: 30, fetch: lent as unknown as typeof fetch, sousTraitants: DECLARE });
    expect(lent).toHaveBeenCalledTimes(1);
    expect(r.mode).toBe("regles");
    // Le délai du test est de 30 ms ; en service, la phrase dit « pas de réponse en 20 s ».
    expect(r.avertissement).toMatch(/^Le modèle n'a pas répondu \(pas de réponse en \d+ s\) : réponse calculée par règles\.$/);
    expect(r.texte.split("\n")[0]).toMatch(/^Santé 72/);
  });

  it("clé refusée, quota atteint, réponse vide : repli par règles, avec la raison", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cas: [ReturnType<typeof vi.fn>, RegExp][] = [
      [vi.fn(async () => new Response("{}", { status: 401 })), /clé refusée par le fournisseur/],
      [vi.fn(async () => new Response("{}", { status: 429 })), /quota du fournisseur atteint/],
      [vi.fn(async () => new Response("{}", { status: 503 })), /erreur du fournisseur \(HTTP 503\)/],
      [reponseMistral(""), /réponse vide/],
      [vi.fn(async () => new Response("pas du JSON", { status: 200 })), /réponse illisible/],
      [vi.fn(async () => Promise.reject(new TypeError("fetch failed"))), /fournisseur injoignable/],
    ];
    for (const [appel, raison] of cas) {
      const r = await repondre(QUESTION, digest, { cle: "k", fetch: appel as unknown as typeof fetch, sousTraitants: DECLARE });
      expect(r.mode).toBe("regles");
      expect(r.avertissement).toMatch(raison);
    }
  });
});
