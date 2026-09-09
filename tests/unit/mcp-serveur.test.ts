// Le serveur MCP : ce qu'une IA peut demander au portail, et ce qu'elle reçoit.
//
// Ce qui est couvert ici est ce qui n'a PAS de filet ailleurs. Un serveur MCP
// n'est vérifié par personne à l'exécution : le modèle qui l'interroge n'a
// aucun moyen de savoir qu'un chemin a été mal construit ou qu'un champ a
// disparu du rendu — il prendra la réponse pour argent comptant et la
// présentera à l'utilisateur. Les trois pièges couverts :
//
//   1. la construction d'URL (un filtre silencieusement ignoré = des chiffres
//      qui répondent à une autre question que celle posée) ;
//   2. le rabattage de périmètre par l'API (des chiffres d'une AUTRE app,
//      présentés comme ceux de l'app demandée) ;
//   3. le rendu (un champ perdu se lit comme un zéro).
import { describe, expect, it } from "vitest";
import { OUTILS, construireChemin, outilParNom } from "../../apps/mcp/lib/catalogue.mjs";
import { ErreurApi, creerClient } from "../../apps/mcp/lib/client.mjs";
import { avertissementPerimetre, enMarkdown, indicesPage } from "../../apps/mcp/lib/rendu.mjs";
import { executer, schemaEntree } from "../../apps/mcp/serveur.mjs";

const outil = (nom: string) => {
  const o = outilParNom(nom);
  if (!o) throw new Error(`outil inconnu dans le test : ${nom}`);
  return o;
};

/** Client factice : mémorise le chemin demandé, renvoie l'enveloppe fournie. */
function clientFactice(enveloppe: unknown, erreur?: Error) {
  const vus: string[] = [];
  return {
    vus,
    client: {
      racine: "http://console/api/v1",
      async appeler(chemin: string) {
        vus.push(chemin);
        if (erreur) throw erreur;
        return enveloppe;
      },
    },
  };
}

describe("catalogue — le contrat exposé à l'IA", () => {
  it("nomme tous les outils avec le préfixe du service", () => {
    // Un serveur MCP cohabite avec d'autres : `list_sessions` seul entrerait en
    // collision avec n'importe quel autre outil de session.
    expect(OUTILS.every((o) => o.nom.startsWith("mip_rum_"))).toBe(true);
  });

  it("n'expose aucun nom en double", () => {
    expect(new Set(OUTILS.map((o) => o.nom)).size).toBe(OUTILS.length);
  });

  it("décrit chaque outil et chaque paramètre", () => {
    for (const o of OUTILS) {
      expect(o.description.length, o.nom).toBeGreaterThan(80);
      for (const [nom, schema] of Object.entries(schemaEntree(o))) {
        // Un paramètre sans description est un paramètre que le modèle devine.
        expect((schema as { description?: string }).description, `${o.nom}.${nom}`).toBeTruthy();
      }
    }
  });

  // La garantie centrale du serveur : aucun outil n'écrit. `POST /api/v1/deploys`
  // existe côté API et n'est délibérément pas exposé — ce test échoue si
  // quelqu'un l'ajoute sans y repenser.
  it("n'expose que de la lecture", () => {
    expect(OUTILS.every((o) => !("methode" in o) || o.methode === "GET")).toBe(true);
    expect(OUTILS.some((o) => /deploy|create|record|delete/i.test(o.nom))).toBe(false);
  });
});

describe("construireChemin", () => {
  it("place les filtres en query string, dans l'ordre déclaré", () => {
    expect(construireChemin(outil("mip_rum_get_overview"), { app: "gip", period: "7d" })).toBe(
      "/overview?app=gip&period=7d",
    );
  });

  it("omet les valeurs absentes ou vides plutôt que d'envoyer un filtre vide", () => {
    // `?app=` serait interprété par l'API comme « app nommée chaîne vide », donc
    // comme un filtre — et non comme « pas de filtre ».
    expect(construireChemin(outil("mip_rum_get_overview"), { app: "", period: undefined })).toBe("/overview");
  });

  it("ignore un paramètre que l'outil ne déclare pas", () => {
    // L'API l'ignorerait aussi ; le transmettre donnerait à l'IA l'illusion d'un
    // filtre qui n'existe pas, et donc une réponse mal interprétée.
    expect(construireChemin(outil("mip_rum_get_overview"), { app: "gip", limit: 10 })).toBe("/overview?app=gip");
  });

  it("n'envoie jamais `format` à l'API — c'est un réglage du serveur MCP", () => {
    expect(construireChemin(outil("mip_rum_list_apps"), { format: "markdown" })).toBe("/apps");
  });

  it("encode les segments de chemin", () => {
    expect(construireChemin(outil("mip_rum_get_error_group"), { fingerprint: "a/b?c" })).toBe(
      "/errors/a%2Fb%3Fc",
    );
  });

  it("refuse un segment de chemin manquant plutôt que de construire /errors/undefined", () => {
    expect(() => construireChemin(outil("mip_rum_get_error_group"), {})).toThrow(/fingerprint/);
  });

  it("n'accepte pas de filtre sur le détail d'une session (la route n'en lit aucun)", () => {
    expect(construireChemin(outil("mip_rum_get_session"), { session_id: "s1", period: "7d" })).toBe(
      "/sessions/s1",
    );
  });
});

describe("avertissementPerimetre — le mensonge à ne pas laisser passer", () => {
  it("signale que la réponse porte sur une autre app que celle demandée", () => {
    const a = avertissementPerimetre("beta", { app: "alpha" });
    expect(a).toContain("beta");
    expect(a).toContain("alpha");
    expect(a).toContain("ne concernent PAS");
  });

  it("se tait quand l'app obtenue est celle demandée", () => {
    expect(avertissementPerimetre("alpha", { app: "alpha" })).toBeNull();
  });

  it("se tait quand aucune app précise n'était demandée", () => {
    expect(avertissementPerimetre(null, { app: "alpha" })).toBeNull();
    expect(avertissementPerimetre("all", { app: "alpha" })).toBeNull();
  });
});

describe("indicesPage — pagination sans total", () => {
  const page = (limit: number, offset: number, n: number) => ({
    sessions: Array.from({ length: n }, (_, i) => ({ id: i })),
    page: { limit, offset },
  });

  it("annonce une suite probable quand la page est pleine", () => {
    expect(indicesPage(page(2, 0, 2))).toMatchObject({ peut_avoir_suite: true, offset_suivant: 2 });
  });

  it("annonce la fin quand la page est incomplète", () => {
    expect(indicesPage(page(50, 0, 3))).toMatchObject({ peut_avoir_suite: false, offset_suivant: null });
  });

  // L'API ne renvoie AUCUN total. En inventer un (par exemple offset + reçus)
  // serait un chiffre faux présenté comme mesuré.
  it("laisse le total à null au lieu de l'inventer", () => {
    expect(indicesPage(page(2, 10, 2))?.total).toBeNull();
  });

  it("ne renvoie rien pour un endpoint non paginé", () => {
    expect(indicesPage({ health: { score: 90 } })).toBeNull();
  });
});

describe("rendu markdown — générique, donc incapable d'omettre", () => {
  const enveloppe = {
    meta: { app: "alpha", period: "7d", device: "all", generatedAt: "2026-09-09T06:00:00.000Z" },
    data: { routes: [{ route: "/a", p75_lcp: 2100 }, { route: "/b", p75_inp: 300 }] },
  };

  it("rend l'en-tête meta : l'app RÉELLEMENT servie est toujours visible", () => {
    expect(enMarkdown("Pages", enveloppe)).toContain("app : alpha");
  });

  it("garde toutes les colonnes, y compris celles absentes d'une ligne", () => {
    const md = enMarkdown("Pages", enveloppe);
    expect(md).toContain("| route | p75_lcp | p75_inp |");
    expect(md).toContain("| /b | — | 300 |"); // valeur absente marquée, pas supprimée
  });

  it("échappe les pipes au lieu de couper la valeur", () => {
    const md = enMarkdown("X", { meta: {}, data: { l: [{ v: "a|b" }] } });
    expect(md).toContain("a\\|b");
  });

  it("dit « liste vide » plutôt que de ne rien afficher", () => {
    expect(enMarkdown("X", { meta: {}, data: { routes: [] } })).toContain("liste vide");
  });

  it("tombe en JSON intégral pour une structure imbriquée", () => {
    const md = enMarkdown("X", { meta: {}, data: { arbre: [{ a: { b: 1 } }] } });
    expect(md).toContain('"b": 1');
  });
});

describe("client — messages d'erreur actionnables", () => {
  const fauxFetch = (statut: number, corps: unknown) => async () =>
    new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });

  it("normalise la base, avec ou sans barre finale", () => {
    expect(creerClient({ base: "https://c/", jeton: "t" }).racine).toBe("https://c/api/v1");
    expect(creerClient({ base: "https://c", jeton: "t" }).racine).toBe("https://c/api/v1");
  });

  it("dit qu'un 401 ne se corrige pas en reformulant la requête", async () => {
    const c = creerClient({ base: "https://c", jeton: "secret-du-client", fetchImpl: fauxFetch(401, {}) });
    await expect(c.appeler("/apps")).rejects.toThrow(/même résultat/);
  });

  // Écrit en attrapant l'erreur À LA MAIN, et non avec
  // `rejects.toThrow(expect.not.stringContaining(...))` : cette forme-là
  // n'échoue JAMAIS (vérifié en injectant une vraie fuite — le test restait
  // vert). Une assertion négative qui ne peut pas échouer est pire que pas
  // d'assertion : elle fait croire que le point est couvert.
  it.each([401, 403, 404, 429, 500])("ne recopie jamais le jeton dans le message d'un %i", async (statut) => {
    // Le message remonte à l'IA, qui peut le répéter dans sa réponse — et une
    // réponse de modèle finit dans des journaux, des captures, des tickets.
    const jeton = "secret-du-client";
    const c = creerClient({ base: "https://c", jeton, fetchImpl: fauxFetch(statut, { error: "refusé" }) });
    const erreur = await c.appeler("/apps").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(erreur).toBeInstanceOf(ErreurApi);
    expect(erreur!.message).not.toContain(jeton);
  });

  it("ne recopie ni le jeton ni l'URL quand le réseau tombe", async () => {
    const jeton = "secret-du-client";
    const c = creerClient({
      base: "https://console-interne.local",
      jeton,
      fetchImpl: async () => {
        throw new Error(`connect ECONNREFUSED https://console-interne.local/api/v1/apps (${jeton})`);
      },
    });
    const erreur = await c.appeler("/apps").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(erreur!.message).not.toContain(jeton);
    expect(erreur!.message).not.toContain("console-interne.local");
  });

  it("oriente un 403 vers la liste des apps réellement accessibles", async () => {
    const c = creerClient({ base: "https://c", jeton: "t", fetchImpl: fauxFetch(403, {}) });
    await expect(c.appeler("/apps")).rejects.toThrow(/mip_rum_list_apps/);
  });

  it("suggère d'élargir la période sur un 404", async () => {
    const c = creerClient({ base: "https://c", jeton: "t", fetchImpl: fauxFetch(404, {}) });
    await expect(c.appeler("/errors/x")).rejects.toThrow(/élargir 'period'/);
  });

  it("distingue une panne serveur d'une erreur d'appel", async () => {
    const c = creerClient({ base: "https://c", jeton: "t", fetchImpl: fauxFetch(502, {}) });
    await expect(c.appeler("/apps")).rejects.toThrow(/pas une erreur d'appel/);
  });

  it("refuse un 200 au corps illisible au lieu de renvoyer null à l'IA", async () => {
    const c = creerClient({
      base: "https://c",
      jeton: "t",
      fetchImpl: async () => new Response("<html>proxy</html>", { status: 200 }),
    });
    await expect(c.appeler("/apps")).rejects.toThrow(ErreurApi);
  });
});

describe("executer — de l'appel d'outil à la réponse", () => {
  const enveloppe = {
    meta: { app: "alpha", period: "24h", device: "all", generatedAt: "2026-09-09T06:00:00.000Z" },
    data: { apps: [{ app_id: "alpha", sessions: 42 }] },
  };

  it("renvoie l'enveloppe de l'API telle quelle en JSON", async () => {
    const { client } = clientFactice(enveloppe);
    const { structure } = await executer(outil("mip_rum_list_apps"), {}, client);
    expect(structure.meta).toEqual(enveloppe.meta);
    expect(structure.data).toEqual(enveloppe.data);
  });

  it("sépare ce que le serveur MCP a constaté de ce que l'API a mesuré", async () => {
    // `_mcp` est un espace à part : on ne doit jamais pouvoir confondre une
    // observation du serveur avec une donnée mesurée.
    const { client } = clientFactice(enveloppe);
    const { structure } = await executer(outil("mip_rum_list_apps"), {}, client);
    expect(structure._mcp.outil).toBe("mip_rum_list_apps");
    expect(structure._mcp.chemin).toBe("/apps");
    expect(Object.keys(enveloppe)).not.toContain("_mcp");
  });

  it("fait remonter l'avertissement de périmètre dans les deux formats", async () => {
    const { client } = clientFactice(enveloppe);
    const json = await executer(outil("mip_rum_get_overview"), { app: "beta" }, client);
    expect(json.structure._mcp.avertissement).toContain("beta");
    const md = await executer(outil("mip_rum_get_overview"), { app: "beta", format: "markdown" }, client);
    // En markdown il passe EN TÊTE : un avertissement en bas de page se lit après
    // qu'on a déjà cru les chiffres.
    expect(md.texte.startsWith("⚠️")).toBe(true);
  });

  it("appelle le chemin construit à partir des arguments", async () => {
    const { client, vus } = clientFactice(enveloppe);
    await executer(outil("mip_rum_get_vitals"), { app: "a", period: "7d", series: "LCP" }, client);
    expect(vus).toEqual(["/vitals?app=a&period=7d&series=LCP"]);
  });

  it("propage l'erreur du client sans la maquiller", async () => {
    const { client } = clientFactice(null, new ErreurApi("message d'origine", 429));
    await expect(executer(outil("mip_rum_list_apps"), {}, client)).rejects.toThrow("message d'origine");
  });
});
