// P6b.G — l'étape « Poser le code de suivi » de la fiche d'une application.
//
// Sans collecte directe, rien ne change (ni phrase « recommandé », ni second
// code). Avec, le code principal vise le collecteur, la CSP à ajouter cite
// l'origine du COLLECTEUR, et le code par la console reste là pour un site dont
// la CSP fige `connect-src` — avec, lui, l'origine de la console.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SnippetStep } from "@/components/wizard/SnippetStep";
import { buildInjectionArtifacts, buildSnippet } from "@/lib/onboarding";

const SDK = "https://mip-rum-console.vercel.app/mip-rum.js";
const CONSOLE = "https://mip-rum-console.vercel.app/api/ingest/v1/traces";
const DIRECTE = "https://collector-production-d769.up.railway.app/v1/traces";
const base = { sdkUrl: SDK, appId: "client-pilote", clientId: null };

function rendre(endpoint: string, parLaConsole: { snippet: string; endpoint: string } | null) {
  const voie = parLaConsole ? ("directe" as const) : undefined;
  return renderToStaticMarkup(
    <SnippetStep
      snippet={buildSnippet({ ...base, endpoint, withConsent: false, voie })}
      snippetConsent={buildSnippet({ ...base, endpoint, withConsent: true, voie })}
      sdkUrl={SDK}
      endpoint={endpoint}
      injection={buildInjectionArtifacts({ ...base, endpoint })}
      parLaConsole={parLaConsole}
    />,
  );
}

describe("SnippetStep — collecte directe", () => {
  it("fermée : l'écran d'avant, un seul code, la CSP de la console", () => {
    const html = rendre(CONSOLE, null);
    expect(html).not.toContain('data-testid="voie-directe"');
    expect(html).not.toContain('data-testid="voie-console"');
    expect(html).toContain("connect-src https://mip-rum-console.vercel.app");
    expect(html).not.toContain("railway.app");
  });

  it("ouverte : recommandée, CSP qui cite le collecteur, et le code par la console à côté", () => {
    const html = rendre(DIRECTE, {
      endpoint: CONSOLE,
      snippet: buildSnippet({ ...base, endpoint: CONSOLE, withConsent: false }),
    });
    expect(html).toContain('data-testid="voie-directe"');
    expect(html).toContain("connect-src https://collector-production-d769.up.railway.app");
    expect(html).toContain('data-testid="voie-console"');
    // Le second code vise bien la console, et sa CSP la cite.
    expect(html).toContain("/api/ingest/v1/traces");
    expect(html).toContain("connect-src https://mip-rum-console.vercel.app");
    // Le code principal dit sa voie dans son en-tête.
    expect(html).toContain("collecte directe (pays par l&#x27;adresse IP)");
  });
});
