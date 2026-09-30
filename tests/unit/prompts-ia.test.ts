// « Copier pour mon IA de code » (lib/prompts-ia.ts) : un prompt porte les MÊMES codes
// que les blocs de /installer, les valeurs de l'application, et jamais la clé d'API —
// le coller, c'est l'envoyer au fournisseur de l'IA.
import { describe, expect, it } from "vitest";
import { strategieExtension, strategieNommage } from "@/lib/extension-deploiement";
import { appelInit, codeNextAppRouter, codeNextPagesRouter, directivesCsp } from "@/lib/installer";
import { buildSnippet } from "@/lib/onboarding";
import { promptExtension, promptSdk, promptServeur } from "@/lib/prompts-ia";
import { REPERE_CLE_API, recettesAgentsOtel } from "@/lib/recettes-agents-otel";

const base = { sdkUrl: "https://console.exemple/mip-rum.js", endpoint: "https://console.exemple/api/ingest/v1/traces", appId: "boutique", clientId: null };
const snippet = buildSnippet({ ...base, withConsent: false });
const snippetConsent = buildSnippet({ ...base, withConsent: true });
const init = appelInit(base);
const csp = directivesCsp(base);

describe("les prompts pour l'IA de code", () => {
  const sdk = promptSdk({
    app: "boutique",
    nom: "Boutique",
    origines: ["https://www.boutique.fr"],
    snippet,
    snippetConsent,
    codeAppRouter: codeNextAppRouter(base.sdkUrl, init),
    codePagesRouter: codeNextPagesRouter(base.sdkUrl, init),
    csp,
  });

  it("le SDK : les codes de la page, tels quels, la CSP et les domaines déclarés", () => {
    for (const code of [snippet, snippetConsent, codeNextAppRouter(base.sdkUrl, init), codeNextPagesRouter(base.sdkUrl, init)]) {
      expect(sdk).toContain(code);
    }
    expect(sdk).toContain(csp.scriptSrc);
    expect(sdk).toContain(csp.connectSrc);
    expect(sdk).toContain("https://www.boutique.fr");
  });

  it("l'extension : les deux stratégies de la page, et les domaines", () => {
    const strategie = strategieExtension(["www.boutique.fr"], null);
    const p = promptExtension({ nom: "Boutique", zip: "https://console.exemple/downloads/x.zip", strategie, nommage: strategieNommage(), hotes: ["www.boutique.fr"] });
    expect(p).toContain(strategie);
    expect(p).toContain(strategieNommage());
    expect(p).toContain("www.boutique.fr");
  });

  it("le serveur : un prompt par recette, qui en porte le code, les pièges et la documentation", () => {
    const { agents } = recettesAgentsOtel({ appId: "boutique", adresses: { traces: "https://c/t", logs: "https://c/l" } });
    for (const r of agents) {
      const p = promptServeur(r, "Boutique");
      expect(p, r.id).toContain(r.code);
      for (const piege of r.pieges) expect(p, r.id).toContain(piege);
      expect(p, r.id).toContain(r.documentation);
    }
  });

  it("aucun ne porte de clé : seulement son repère, et la consigne de la lire dans l'environnement", () => {
    const { agents } = recettesAgentsOtel({ appId: "boutique", adresses: { traces: "https://c/t", logs: "https://c/l" } });
    for (const p of [sdk, promptServeur(agents[0], "Boutique")]) {
      expect(p).toContain(REPERE_CLE_API);
      expect(p).toMatch(/variable d'environnement/);
      expect(p).toMatch(/n'est PAS dans ce prompt/);
    }
  });
});
