// Les trois parcours de `/installer`, rendus côté serveur avec une application
// d'exemple : ce que la page ÉCRIT au client.
//
// CE QUE CES TESTS EMPÊCHENT.
//   - Un avertissement de l'extension qui ne serait plus en tête de son parcours.
//   - Un lien d'administration (régénérer la clé, changer les domaines) montré à un
//     client en lecture seule, ou retiré à l'administrateur.
//   - Une directive CSP ou une stratégie de parc qui ne serait plus préremplie.
//   - Une clé réelle dans un code : seul son repère y figure.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChoixParcours } from "@/components/installer/ChoixParcours";
import { ParcoursExtension, ParcoursServeur, ParcoursSnippet, type ContexteParcours } from "@/components/installer/Parcours";
import { TableauxPersonnalisation } from "@/components/installer/TableauPersonnalisation";
import { EXTENSION_ID } from "@/lib/extension-deploiement";
import {
  appelInit,
  codeNextAppRouter,
  codeNextPagesRouter,
  directivesCsp,
  personnalisation,
  verificationsDe,
} from "@/lib/installer";
import { buildInjectionArtifacts, buildSnippet } from "@/lib/onboarding";
import { REPERE_CLE_API, recettesAgentsOtel } from "@/lib/recettes-agents-otel";

const APP = "client-pilote";
const SDK = "https://mip-rum-console.vercel.app/mip-rum.js";
const ENDPOINT = "https://mip-rum-console.vercel.app/api/ingest/v1/traces";
const LOGS = "https://mip-rum-console.vercel.app/api/ingest/v1/logs";

const contexte = (p: "snippet" | "extension" | "serveur", reste: Partial<ContexteParcours> = {}): ContexteParcours => ({
  app: APP,
  nomSecret: `cle:${APP}`,
  administrable: false,
  aUneCle: true,
  active: true,
  suspendue: false,
  origines: ["https://app.client.fr"],
  domainesExtension: [{ domaine: "app.client.fr", etat: "actif" }],
  sondeEnEchec: false,
  verifications: verificationsDe(p, null),
  ...reste,
});

const base = { sdkUrl: SDK, endpoint: ENDPOINT, appId: APP, clientId: null };
const snippet = (ctx: ContexteParcours, parLaConsole: { snippet: string; connectSrc: string } | null = null) =>
  renderToStaticMarkup(
    <ParcoursSnippet
      ctx={ctx}
      snippet={buildSnippet({ ...base, withConsent: false })}
      snippetConsent={buildSnippet({ ...base, withConsent: true })}
      codeAppRouter={codeNextAppRouter(SDK, appelInit(base))}
      codePagesRouter={codeNextPagesRouter(SDK, appelInit(base))}
      injection={buildInjectionArtifacts(base)}
      csp={directivesCsp(base)}
      parLaConsole={parLaConsole}
    />,
  );
const extension = (ctx: ContexteParcours, updateUrl: string | null = null) =>
  renderToStaticMarkup(<ParcoursExtension ctx={ctx} storeUrl={null} updateUrl={updateUrl} />);
const serveur = (ctx: ContexteParcours) =>
  renderToStaticMarkup(<ParcoursServeur ctx={ctx} recettes={recettesAgentsOtel({ appId: APP, adresses: { traces: ENDPOINT, logs: LOGS } })} />);

describe("parcours « code de suivi »", () => {
  it("collecte directe (P6b.G) : le code par la console reste à côté, et sa CSP ; sinon un seul code", () => {
    const direct = snippet(contexte("snippet"), { snippet: "CODE-PAR-LA-CONSOLE", connectSrc: "connect-src https://console.test" });
    expect(direct).toContain('data-testid="voie-directe"');
    expect(direct).toContain('data-testid="voie-console"');
    expect(direct).toContain("CODE-PAR-LA-CONSOLE");
    expect(direct).toContain("connect-src https://console.test");
    const seul = snippet(contexte("snippet"));
    expect(seul).not.toContain('data-testid="voie-directe"');
    expect(seul).not.toContain('data-testid="voie-console"');
  });

  it("les domaines déclarés, le code prérempli avec le repère de la clé, la CSP à ajouter", () => {
    const html = snippet(contexte("snippet"));
    expect(html).toContain("https://app.client.fr");
    expect(html).toContain(REPERE_CLE_API);
    expect(html).not.toMatch(/mip_[0-9a-f]{32}/);
    expect(html).toContain("script-src https://mip-rum-console.vercel.app");
    expect(html).toContain("connect-src https://mip-rum-console.vercel.app");
    // Les piles : App Router et Pages Router, et le sans-code.
    expect(html).toContain("app/layout.tsx");
    expect(html).toContain("pages/_document.tsx");
    expect(html).toContain("Cloudflare Worker");
    // 8 gestes à cocher et 2 cases de sonde.
    expect(html).toContain("0 / 10");
  });

  it("un client en lecture seule : aucun lien vers la fiche, la demande à l'administrateur", () => {
    const html = snippet(contexte("snippet"));
    expect(html).not.toContain(`href="/admin/customers/${APP}"`);
    expect(html).toContain("Demandez-le à votre administrateur MIP.");
  });

  it("un administrateur de l'application : les liens vers la fiche (domaines, clé)", () => {
    const html = snippet(contexte("snippet", { administrable: true }));
    expect(html).toContain(`href="/admin/customers/${APP}"`);
    expect(html).toContain("Régénérer la clé sur la fiche");
  });

  it("application désactivée, sans clé, sans domaine : chaque refus est dit", () => {
    const html = snippet(contexte("snippet", { active: false, aUneCle: false, origines: [] }));
    expect(html).toContain("L&#x27;application est désactivée");
    expect(html).toContain("Aucune clé pour l&#x27;instant");
    expect(html).toContain("Aucun domaine déclaré");
  });
});

describe("parcours « extension »", () => {
  it("la règle sans clé en tête, avant la première étape, sans alerte", () => {
    const html = extension(contexte("extension"));
    const regle = html.indexOf('data-testid="regle-extension"');
    expect(regle).toBeGreaterThan(-1);
    expect(regle).toBeLessThan(html.indexOf('data-testid="etape-extension-domaine"'));
    expect(html).toContain("domaine enregistré");
    expect(html).not.toContain('data-testid="avertissement-extension"');
  });

  it("le domaine enregistré et son état, le zip, la stratégie préremplie avec l'identifiant", () => {
    const html = extension(contexte("extension"));
    expect(html).toContain('data-etat="actif"');
    expect(html).toContain("/downloads/mip-rum-extension.zip");
    expect(html).toContain(EXTENSION_ID);
    expect(html).toContain("*://app.client.fr");
    expect(html).toContain("chrome://extensions");
    expect(html).toContain("edge://extensions");
    expect(html).toContain("Activer sur ce domaine");
  });

  it("lecture des domaines en échec : l'état d'erreur, pas une liste vide", () => {
    const html = extension(contexte("extension", { domainesExtension: null }));
    expect(html).toContain('data-testid="etat-erreur"');
  });
});

describe("parcours « serveur »", () => {
  it("les recettes des agents officiels, le nom du service, le CORS de traceparent", () => {
    const html = serveur(contexte("serveur"));
    expect(html).toContain('data-testid="recettes-agents"');
    expect(html).toContain(`${APP}-api`);
    expect(html).toContain("Access-Control-Allow-Headers: traceparent, tracestate");
  });
});

describe("cartes et tableaux", () => {
  it("trois cartes, chacune vers son ancre", () => {
    const html = renderToStaticMarkup(<ChoixParcours vert={{ snippet: true, extension: false, serveur: false }} />);
    for (const p of ["snippet", "extension", "serveur"]) expect(html).toContain(`href="#${p}"`);
    expect(html).toContain("Recommandé");
    expect(html).toContain("Données déjà reçues");
  });

  it("un tableau par parcours, « propre à » l'application puis « pareil pour tous »", () => {
    const faits = {
      appId: APP,
      clientId: null,
      aUneCle: true,
      origines: ["https://app.client.fr"],
      sdkUrl: SDK,
      endpoint: ENDPOINT,
      endpointLogs: LOGS,
      domaines: [{ domaine: "app.client.fr", etat: "actif" as const }],
    };
    const html = renderToStaticMarkup(
      <TableauxPersonnalisation
        app={APP}
        lignes={{ snippet: personnalisation("snippet", faits), extension: personnalisation("extension", faits), serveur: personnalisation("serveur", faits) }}
      />,
    );
    expect(html.match(/Propre à client-pilote/g)).toHaveLength(3);
    expect(html.match(/Pareil pour tous/g)).toHaveLength(3);
    expect(html.indexOf("Propre à client-pilote")).toBeLessThan(html.indexOf("Pareil pour tous"));
  });
});
