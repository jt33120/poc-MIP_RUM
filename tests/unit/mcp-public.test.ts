// Les extraits de configuration distribués sur la page « API et MCP ».
//
// Ce qui est couvert ici n'a de filet nulle part ailleurs : un bloc de
// configuration est copié-collé SANS être relu. Une virgule en trop et
// l'utilisateur obtient une erreur de parsing qu'il attribuera au produit ; un
// champ manquant et son client échoue d'une façon incompréhensible. Le
// typecheck ne voit rien de tout cela — ce sont des chaînes.
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  CONSOLE_ORIGINE,
  MCP_ENDPOINT,
  MCP_NOM,
  MCP_ORIGINE,
  commandeCli,
  configDistante,
  configLocale,
  curlVerification,
} from "../../apps/console/lib/mcp-public";
import { sonderMcp } from "../../apps/console/lib/mcp-sonde";

describe("adresse du serveur", () => {
  it("est en HTTPS — un client MCP distant refuse le HTTP simple", () => {
    expect(MCP_ORIGINE.startsWith("https://")).toBe(true);
  });

  it("porte le chemin /mcp, qui n'est pas optionnel", () => {
    // Coller l'origine seule dans un client donne un 404 muet : la racine sert
    // la sonde de l'hébergeur, pas le protocole.
    expect(MCP_ENDPOINT).toBe(`${MCP_ORIGINE}/mcp`);
  });

  it("ne pointe pas vers la console — ce sont deux services distincts", () => {
    expect(MCP_ORIGINE).not.toBe(CONSOLE_ORIGINE);
  });
});

describe("configuration distante", () => {
  const cfg = JSON.parse(configDistante());
  const entree = cfg.mcpServers[MCP_NOM];

  it("est du JSON valide", () => {
    expect(() => JSON.parse(configDistante())).not.toThrow();
  });

  // Le piège documenté : une entrée avec `url` mais sans `type` est lue comme un
  // serveur stdio et échoue sans rien dire d'utile.
  it("déclare type: http — sans quoi le client la lit comme un serveur local", () => {
    expect(entree.type).toBe("http");
  });

  it("pointe l'endpoint complet", () => {
    expect(entree.url).toBe(MCP_ENDPOINT);
  });

  it("porte le jeton dans l'en-tête Authorization, au format Bearer", () => {
    expect(entree.headers.Authorization).toMatch(/^Bearer /);
  });

  it("laisse un marqueur évident à remplacer, jamais un vrai jeton", () => {
    const texte = configDistante();
    expect(texte).toContain("VOTRE_JETON");
    // Un exemple qui ressemble à un vrai secret serait recopié tel quel.
    expect(texte).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/);
  });
});

describe("configuration locale (stdio)", () => {
  const cfg = JSON.parse(configLocale());
  const entree = cfg.mcpServers[MCP_NOM];

  it("est du JSON valide", () => {
    expect(() => JSON.parse(configLocale())).not.toThrow();
  });

  it("lance le point d'entrée stdio, pas le point d'entrée HTTP", () => {
    // services/mcp/http.mjs sur stdio écrirait son journal sur stdout et
    // corromprait la trame JSON-RPC.
    expect(entree.command).toBe("node");
    expect(entree.args[0]).toContain("services/mcp/stdio.mjs");
  });

  it("fournit les DEUX variables sans lesquelles le serveur refuse de démarrer", () => {
    expect(entree.env.MIP_CONSOLE_URL).toBe(CONSOLE_ORIGINE);
    expect(entree.env.MIP_API_TOKEN).toBe("VOTRE_JETON");
  });

  it("ne déclare ni type ni url — c'est ce qui en fait un serveur local", () => {
    expect(entree.type).toBeUndefined();
    expect(entree.url).toBeUndefined();
  });
});

describe("commande CLI", () => {
  const cmd = commandeCli();

  it("utilise le transport http et l'endpoint complet", () => {
    expect(cmd).toContain("--transport http");
    expect(cmd).toContain(MCP_ENDPOINT);
  });

  it("passe le jeton par un en-tête", () => {
    expect(cmd).toContain('--header "Authorization: Bearer VOTRE_JETON"');
  });

  it("continue proprement sur la seconde ligne", () => {
    // Une commande multiligne sans `\` s'exécute en deux commandes tronquées.
    const lignes = cmd.split("\n");
    expect(lignes[0].endsWith("\\")).toBe(true);
  });
});

describe("commandes de vérification", () => {
  const sh = curlVerification();

  it("propose d'abord la sonde de santé", () => {
    expect(sh).toContain(`${MCP_ORIGINE}/health`);
  });

  // Un utilisateur qui ne teste que le cas passant ne saura pas si son serveur
  // est ouvert à tous. Le cas qui DOIT échouer est le plus important des trois.
  it("inclut le test SANS jeton, celui qui doit répondre 401", () => {
    expect(sh).toContain("401");
    expect(sh).toContain("%{http_code}");
  });

  it("envoie l'en-tête Accept que le transport exige", () => {
    expect(sh).toContain("text/event-stream");
  });

  it("appelle bien /mcp et non la racine", () => {
    expect(sh).toContain(`${MCP_ORIGINE}/mcp`);
  });
});

// La sonde qui décide de la pastille d'état sur la page. Testée avec un vrai
// serveur HTTP local : la branche « en ligne » ne peut pas être vérifiée depuis
// l'environnement de développement, dont le proxy sortant refuse Railway.
describe("sonderMcp — la pastille est mesurée, jamais affirmée", () => {
  /** Lance un serveur jetable qui répond ce qu'on lui dit. */
  async function serveur(handler: (req: unknown, res: ServerResponse) => void) {
    const s = createServer(handler as never);
    await new Promise<void>((r) => s.listen(0, r));
    const port = (s.address() as AddressInfo).port;
    return { origine: `http://127.0.0.1:${port}`, fermer: () => new Promise((r) => s.close(r)) };
  }

  it("dit « en ligne » et remonte la version quand le service répond", async () => {
    const s = await serveur((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "mcp", name: "mip-rum-mcp-server", version: "0.1.0" }));
    });
    expect(await sonderMcp(s.origine)).toEqual({ joignable: true, version: "0.1.0", motif: null });
    await s.fermer();
  });

  // Une page d'attente d'hébergeur, un proxy, un domaine recyclé : tous
  // répondent 200. Se fier au seul code de statut afficherait une pastille verte
  // sur un service qui n'est plus le nôtre.
  it("refuse un 200 qui n'est pas notre service", async () => {
    const s = await serveur((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "autre-chose" }));
    });
    const e = await sonderMcp(s.origine);
    expect(e.joignable).toBe(false);
    expect(e.motif).toContain("inattendue");
    await s.fermer();
  });

  it("remonte le code HTTP quand le service répond en erreur", async () => {
    const s = await serveur((_req, res) => {
      res.writeHead(502);
      res.end();
    });
    expect(await sonderMcp(s.origine)).toMatchObject({ joignable: false, motif: "HTTP 502" });
    await s.fermer();
  });

  // Échec DOUX : la page doit se rendre quand même. Une sonde qui jette
  // casserait un écran entier pour un badge.
  it("ne jette jamais quand l'hôte est injoignable", async () => {
    const e = await sonderMcp("http://127.0.0.1:1");
    expect(e.joignable).toBe(false);
    expect(e.motif).toBeTruthy();
  });
});
