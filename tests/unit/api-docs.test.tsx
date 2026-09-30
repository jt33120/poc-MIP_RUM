// La page « API et MCP » resserrée (recette du 30/09/2026 : « à simplifier et rendre
// propre, avec en haut installer en MCP et le lien des swagger, trop long sinon »).
//
// Ce qui se copie doit rester exact même replié : la commande tient sur UNE ligne,
// la configuration JSON porte `type: "http"`, les appels de contrôle finissent par
// l'appel SANS jeton, et la liste des routes vient de la spec, plus la lecture en
// POST de l'Explorer et l'unique écriture. Le rendu : MCP et Swagger en tête, les
// trois jetons, le détail replié.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OUTILS } from "../../packages/mcp-tools/lib/catalogue.mjs";
import { endpointsDeclares } from "@/lib/api/openapi";
import {
  CHEMIN_MCP,
  JETONS,
  MARQUE_JETON,
  adresseMcp,
  appelsDeVerification,
  baseApi,
  commandeClaudeCode,
  configurationJson,
  configurationStdio,
  exemplesApi,
  origineConsole,
  routesApi,
} from "@/lib/api-docs";
import { ApiEtMcp } from "@/components/api-docs/ApiEtMcp";
import { PastilleMcp } from "@/components/api-docs/EtatMcp";

const MCP = "https://mcp.exemple.test";
const CONSOLE = "https://console.exemple.test";

describe("adresses", () => {
  it("l'origine suit l'hôte de la requête : http en local, https ailleurs", () => {
    expect(origineConsole("localhost:3202")).toBe("http://localhost:3202");
    expect(origineConsole("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(origineConsole("rum.exemple.fr")).toBe("https://rum.exemple.fr");
  });

  it("adresse du serveur MCP et base de l'API", () => {
    expect(adresseMcp(MCP)).toBe(`${MCP}${CHEMIN_MCP}`);
    expect(adresseMcp(`${MCP}/`)).toBe(`${MCP}/mcp`);
    expect(baseApi(CONSOLE)).toBe(`${CONSOLE}/api/v1`);
  });
});

describe("ce qui se copie", () => {
  it("la commande Claude Code tient sur une ligne, transport HTTP, jeton en en-tête", () => {
    const c = commandeClaudeCode(adresseMcp(MCP));
    expect(c).not.toContain("\n");
    expect(c).not.toContain("\\");
    expect(c).toBe(`claude mcp add --transport http mip-rum ${MCP}/mcp --header "Authorization: Bearer ${MARQUE_JETON}"`);
  });

  it("la configuration JSON est valide et porte type: http (sans lui, lue comme un serveur local)", () => {
    const conf = JSON.parse(configurationJson(adresseMcp(MCP)));
    expect(conf.mcpServers["mip-rum"]).toEqual({
      type: "http",
      url: `${MCP}/mcp`,
      headers: { Authorization: `Bearer ${MARQUE_JETON}` },
    });
  });

  it("le serveur sur le poste reçoit l'adresse de la console et le jeton par l'environnement", () => {
    const conf = JSON.parse(configurationStdio(CONSOLE));
    expect(conf.mcpServers["mip-rum"].env).toEqual({ MIP_CONSOLE_URL: CONSOLE, MIP_API_TOKEN: MARQUE_JETON });
    expect(conf.mcpServers["mip-rum"].args[0]).toMatch(/stdio\.mjs$/);
  });

  it("trois appels de contrôle : santé, avec jeton, puis SANS jeton (401 attendu)", () => {
    const lignes = appelsDeVerification(MCP).split("\n").filter((l) => l.startsWith("curl"));
    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toBe(`curl -s ${MCP}/health`);
    expect(lignes[1]).toContain(`Authorization: Bearer ${MARQUE_JETON}`);
    expect(lignes[2]).not.toContain("Authorization");
    expect(lignes[2]).toContain("%{http_code}");
    // Le transport HTTP exige les deux types acceptés, comme le contrôle de l'image.
    for (const l of lignes.slice(1)) expect(l).toContain("Accept: application/json, text/event-stream");
  });

  it("un exemple par jeton, sans aucun jeton réel ni chaîne à forte entropie", () => {
    const ex = exemplesApi(CONSOLE);
    expect(ex).toContain(`${CONSOLE}/api/rum/summary?window=7d`);
    expect(ex).toContain(`${CONSOLE}/api/v1/overview`);
    expect(ex).toContain(`${CONSOLE}/api/v1/deploys`);
    expect(JSON.parse(ex.match(/-d '([^']+)'/)![1])).toMatchObject({ app_id: "VOTRE_APPLICATION" });
    for (const texte of [ex, appelsDeVerification(MCP), configurationJson(MCP), commandeClaudeCode(MCP)]) {
      expect(texte).not.toMatch(/(mrk|msu)_[A-Za-z0-9_-]{8,}/);
    }
  });
});

describe("les trois jetons", () => {
  it("une ligne chacun : jeton d'API, jeton d'accès, jeton de CI", () => {
    expect(JETONS.map((j) => j.nom)).toEqual(["Jeton d'API", "Jeton d'accès", "Jeton de CI"]);
  });

  it("le jeton d'accès (ex-« jeton de lecture ») : synthèse d'une application, en lecture, 1 à 365 j", () => {
    const acces = JETONS[1];
    expect(acces.ouvre).toBe("/api/rum/summary");
    expect(acces.droits).toBe("lecture");
    expect(acces.validite).toBe("1 à 365 j");
    expect(acces.source.href).toBe("/admin/read-tokens");
  });

  it("seul le jeton de CI écrit, et un privilège à la fois", () => {
    expect(JETONS.filter((j) => j.droits !== "lecture").map((j) => j.nom)).toEqual(["Jeton de CI"]);
    expect(JETONS[2].privileges).toContain("deploys:write");
    expect(JETONS[2].privileges).toContain("sourcemaps:write");
  });
});

describe("routes", () => {
  it("toutes les lectures de la spec, la lecture en POST de l'Explorer, l'unique écriture", () => {
    const routes = routesApi();
    for (const e of endpointsDeclares()) expect(routes.some((r) => r.methode === "GET" && r.chemin === e.path), e.path).toBe(true);
    expect(routes.filter((r) => r.methode === "POST").map((r) => [r.chemin, r.ecriture ?? false])).toEqual([
      ["/api/v1/explorer/query", false],
      ["/api/v1/deploys", true],
    ]);
    expect(routes.filter((r) => r.ecriture)).toHaveLength(1);
  });
});

describe("rendu de la page", () => {
  const html = renderToStaticMarkup(<ApiEtMcp origine={CONSOLE} origineMcp={MCP} />);

  it("en tête : le MCP (adresse, commande) et l'API REST (base, Swagger UI, OpenAPI)", () => {
    const mcp = html.indexOf('data-testid="bloc-mcp"');
    const api = html.indexOf('data-testid="bloc-api"');
    const jetons = html.indexOf('data-testid="jetons"');
    expect(mcp).toBeGreaterThan(-1);
    expect(mcp).toBeLessThan(api);
    expect(api).toBeLessThan(jetons);
    expect(html).toContain(`${MCP}/mcp`);
    expect(html).toContain("claude mcp add --transport http mip-rum");
    expect(html).toContain(`${CONSOLE}/api/v1`);
    expect(html).toMatch(/href="\/api\/v1\/docs"/);
    expect(html).toMatch(/href="\/api\/v1\/openapi"/);
  });

  it("les trois jetons en tableau, puis le détail REPLIÉ", () => {
    expect(html.match(/data-testid="jeton-ligne"/g)).toHaveLength(3);
    for (const id of ["api-routes", "api-exemples", "mcp-autres", "mcp-outils"]) {
      expect(html).toMatch(new RegExp(`<details[^>]*data-testid="${id}"`));
    }
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain(`${OUTILS.length}`);
  });

  it("les vérités déplacées dans les bulles restent dans la page", () => {
    // Le protocole, le relais du jeton, la session du navigateur, le champ « type ».
    expect(html).toContain("Model Context Protocol");
    expect(html).toContain("il relaie le vôtre");
    expect(html).toContain("avec votre session");
    expect(html).toContain("est obligatoire");
    expect(html).toContain("doit répondre 401");
  });

  it("aucun « jeton de lecture » : le nom est « jeton d'accès »", () => {
    expect(html).not.toMatch(/jetons? de lecture/i);
    expect(html).toContain("Jetons d&#x27;accès");
  });
});

describe("état du serveur MCP", () => {
  it("joignable : « En ligne » et la version", () => {
    const h = renderToStaticMarkup(<PastilleMcp etat={{ joignable: true, version: "0.1.0", motif: null }} />);
    expect(h).toContain('data-etat="en-ligne"');
    expect(h).toContain("En ligne");
    expect(h).toContain("v0.1.0");
  });

  it("injoignable : « Non vérifié » et pourquoi, jamais « hors ligne » (la cause peut être la console)", () => {
    const h = renderToStaticMarkup(<PastilleMcp etat={{ joignable: false, version: null, motif: "pas de réponse en 3 s" }} />);
    expect(h).toContain('data-etat="non-verifie"');
    expect(h).toContain("Non vérifié");
    expect(h).toContain("pas de réponse en 3 s");
    expect(h).not.toMatch(/hors ligne/i);
  });
});
