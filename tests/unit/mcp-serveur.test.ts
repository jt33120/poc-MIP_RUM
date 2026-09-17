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
import { OUTILS, PARAMS, construireChemin, outilParNom } from "../../apps/mcp/lib/catalogue.mjs";
import { ErreurApi, creerClient } from "../../apps/mcp/lib/client.mjs";
import { avertissementPerimetre, enMarkdown, indicesPage } from "../../apps/mcp/lib/rendu.mjs";
import { INSTRUCTIONS, executer, schemaEntree } from "../../apps/mcp/serveur.mjs";

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

  // Le smoke Docker compte les identifiants `mip_rum_*` distincts de tools/list,
  // descriptions comprises : un outil cité mais inexistant fausserait ce compte, et
  // enverrait surtout le modèle vers un outil qu'il ne trouvera pas.
  it("ne cite dans ses textes que des outils qui existent", () => {
    const noms = new Set(OUTILS.map((o) => o.nom));
    const textes = [INSTRUCTIONS, ...Object.values(PARAMS), ...OUTILS.map((o) => o.description)].join("\n");
    const cites = [...new Set(textes.match(/mip_rum_[a-z_]*/g) ?? [])];
    expect(cites.filter((nom) => !noms.has(nom))).toEqual([]);
  });

  // La garantie centrale du serveur : aucun outil n'écrit. `POST /api/v1/deploys` et
  // les écritures du workflow des issues (P5.6) existent côté API et ne sont
  // délibérément pas exposés — ce test échoue si quelqu'un les ajoute sans y repenser.
  it("n'expose que de la lecture", () => {
    expect(OUTILS.every((o) => !("methode" in o) || o.methode === "GET")).toBe(true);
    expect(OUTILS.some((o) => /deploy|create|record|delete|triage|comment|link|assign/i.test(o.nom))).toBe(false);
    expect(OUTILS.some((o) => /\/(deploys|triage|comments|links)$/.test(o.chemin))).toBe(false);
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

  it("transmet app, limite et curseur au détail d'un groupe d'erreurs", () => {
    // Sans `app`, une empreinte partagée entre apps est refusée ; sans `cursor`, les
    // occurrences au-delà de la première page seraient inaccessibles.
    expect(construireChemin(outil("mip_rum_get_error_group"), {
      fingerprint: "p51fp001", app: "gip", period: "7d", device: "tablet", limit: 50, cursor: "opaque_cursor",
    })).toBe("/errors/p51fp001?app=gip&period=7d&device=tablet&limit=50&cursor=opaque_cursor");
  });

  it("refuse un segment de chemin manquant plutôt que de construire /errors/undefined", () => {
    expect(() => construireChemin(outil("mip_rum_get_error_group"), {})).toThrow(/fingerprint/);
  });

  it("n'accepte pas de filtre sur le détail d'une session (la route n'en lit aucun)", () => {
    expect(construireChemin(outil("mip_rum_get_session"), { session_id: "s1", period: "7d" })).toBe(
      "/sessions/s1",
    );
  });

  it("construit l'Explorer d'événements sans interpréter clé, valeur ou curseur", () => {
    expect(construireChemin(outil("mip_rum_list_events"), {
      app: "gip", period: "1h", kind: "event", name: "checkout",
      attr_source: "props", attr_key: "plan", attr_type: "string", attr_value: "pro",
      limit: 25, cursor: "opaque_cursor",
    })).toBe("/events?app=gip&period=1h&kind=event&name=checkout&attr_source=props&attr_key=plan&attr_type=string&attr_value=pro&limit=25&cursor=opaque_cursor");
  });

  it("transmet filtres, limite et curseur à la liste des issues, sans rien inventer", () => {
    expect(construireChemin(outil("mip_rum_list_issues"), {
      app: "gip", period: "7d", device: "tablet", status: "for_review", release: "1.4.2", source: "browser_js",
      limit: 20, cursor: "opaque_cursor", fingerprint: "ignoré",
    })).toBe("/issues?app=gip&period=7d&device=tablet&status=for_review&release=1.4.2&source=browser_js&limit=20&cursor=opaque_cursor");
    expect(construireChemin(outil("mip_rum_list_issues"), {})).toBe("/issues");
  });

  it("place l'identifiant de l'issue dans le chemin, encodé, et l'exige", () => {
    expect(construireChemin(outil("mip_rum_get_issue"), {
      issue_id: "6e8bd3a1-2b1c-4d7e-9f00-0a1b2c3d4e5f", app: "gip", limit: 10, cursor: "c", status: "open",
    })).toBe("/issues/6e8bd3a1-2b1c-4d7e-9f00-0a1b2c3d4e5f?app=gip&limit=10&cursor=c");
    expect(construireChemin(outil("mip_rum_get_issue"), { issue_id: "a/b" })).toBe("/issues/a%2Fb");
    expect(() => construireChemin(outil("mip_rum_get_issue"), {})).toThrow(/issue_id/);
  });

  it("valide localement statut, source et identifiant d'issue avant tout appel", () => {
    const liste = schemaEntree(outil("mip_rum_list_issues"));
    expect(liste.status.safeParse("for_review").success).toBe(true);
    expect(liste.status.safeParse("reopened").success).toBe(false);
    expect(liste.source.safeParse("python").success).toBe(true);
    expect(liste.source.safeParse("java").success).toBe(false);
    expect(liste.release.safeParse("x".repeat(201)).success).toBe(false);
    const detail = schemaEntree(outil("mip_rum_get_issue"));
    expect(detail.issue_id.safeParse("6e8bd3a1-2b1c-4d7e-9f00-0a1b2c3d4e5f").success).toBe(true);
    expect(detail.issue_id.safeParse("p51fp001").success).toBe(false);
    expect(detail.issue_id.safeParse(undefined).success).toBe(false);
  });

  it("cible les événements custom par défaut", () => {
    expect(construireChemin(outil("mip_rum_list_events"), { app: "gip" })).toBe(
      "/events?app=gip&kind=event",
    );
  });

  it("refuse localement un filtre d'attribut partiel", () => {
    expect(() => construireChemin(outil("mip_rum_list_events"), {
      attr_source: "props",
      attr_key: "plan",
    })).toThrow(/filtre d'attribut incomplet/);
    expect(construireChemin(outil("mip_rum_list_events"), {
      attr_source: "context",
      attr_key: "campaign",
      attr_type: "null",
    })).toBe("/events?kind=event&attr_source=context&attr_key=campaign&attr_type=null");
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

describe("indicesPage — pagination, avec ou sans total", () => {
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

  it("privilégie le curseur stable et le total mesuré de l'Explorer", () => {
    expect(indicesPage({
      events: [{ id: "1" }], trend: Array.from({ length: 28 }, () => ({})),
      total: 42, page: { limit: 1, offset: 0, next_cursor: "opaque" },
    })).toMatchObject({ recus: 1, peut_avoir_suite: true, cursor_suivant: "opaque", total: 42 });
  });

  // L'API ne renvoie AUCUN total. En inventer un (par exemple offset + reçus)
  // serait un chiffre faux présenté comme mesuré.
  it("laisse le total à null au lieu de l'inventer", () => {
    expect(indicesPage(page(2, 10, 2))?.total).toBeNull();
  });

  it("reprend le total mesuré des groupes d'erreurs, avec l'offset suivant", () => {
    expect(indicesPage({
      groups: [{ fingerprint: "a" }, { fingerprint: "b" }], trend: [{}, {}, {}],
      total: 7, page: { limit: 2, offset: 4 },
    })).toMatchObject({ recus: 2, peut_avoir_suite: true, offset_suivant: 6, cursor_suivant: null, total: 7 });
  });

  // `trend` est placé avant `occurrences` à dessein : deviner la liste par « le
  // premier tableau venu » dépendrait de l'ordre des clés, et compterait alors les
  // intervalles de la tendance comme des occurrences reçues.
  it("compte les occurrences d'un détail paginé par curseur, sans inventer d'offset", () => {
    const indices = indicesPage({
      group: { occurrences: 38 }, last: null, trend: Array.from({ length: 25 }, () => ({})),
      occurrences: [{ id: 2 }], page: { limit: 1, next_cursor: "opaque-next" },
    });
    expect(indices).toEqual({
      limit: 1, offset: null, recus: 1, peut_avoir_suite: true,
      offset_suivant: null, cursor_suivant: "opaque-next", total: null,
    });
  });

  it("annonce la fin d'un détail quand la page n'est pas pleine", () => {
    expect(indicesPage({ occurrences: [], trend: [], page: { limit: 100, next_cursor: null } }))
      .toMatchObject({ peut_avoir_suite: false, offset_suivant: null, cursor_suivant: null });
  });

  // Les issues paginent par `data.next_cursor` sans objet `page` : la limite
  // appliquée n'est pas renvoyée, elle n'est donc pas devinée.
  it("suit le curseur des issues sans objet page, ni limite ni offset inventés", () => {
    expect(indicesPage({ issues: [{ kind: "issue" }], total: 12, next_cursor: "suite", sampling: {}, coverage: {} })).toEqual({
      limit: null, offset: null, recus: 1, peut_avoir_suite: true, offset_suivant: null, cursor_suivant: "suite", total: 12,
    });
    expect(indicesPage({ issues: [], total: 0, next_cursor: null })).toMatchObject({ peut_avoir_suite: false, cursor_suivant: null });
    expect(indicesPage({
      issue: { id: "x" }, impact: {}, trend: Array.from({ length: 25 }, () => ({})), last_sample: null,
      occurrences: [{ id: 1 }, { id: 2 }], next_cursor: "occ",
    })).toMatchObject({ recus: 2, cursor_suivant: "occ", limit: null });
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

  it("rend le curseur stable et le total filtré de l'Explorer en markdown", async () => {
    const { client, vus } = clientFactice({
      meta: { app: "alpha", period: "24h", device: "tablet", generatedAt: "2026-09-16T12:00:00.000Z" },
      data: {
        events: [{ id: "1", name: "checkout" }],
        total: 42,
        page: { limit: 1, offset: 0, next_cursor: "opaque-next" },
      },
    });
    const result = await executer(outil("mip_rum_list_events"), { app: "alpha", format: "markdown" }, client);
    expect(vus).toEqual(["/events?app=alpha&kind=event"]);
    expect(result.texte).toContain("cursor=opaque-next");
    expect(result.texte).toContain("Total filtré : 42");
  });

  it("guide la suite d'un détail d'erreur par curseur, sans parler d'offset", async () => {
    const { client, vus } = clientFactice({
      meta: { app: "alpha", period: "24h", device: "all", generatedAt: "2026-09-16T12:00:00.000Z" },
      data: {
        group: { app_id: "alpha", fingerprint: "p51fp001", occurrences: 38 },
        last: null,
        occurrences: [{ id: 2, links: { session: true } }],
        trend: [],
        page: { limit: 1, next_cursor: "opaque-next" },
      },
    });
    const result = await executer(
      outil("mip_rum_get_error_group"),
      { fingerprint: "p51fp001", app: "alpha", limit: 1, format: "markdown" },
      client,
    );
    expect(vus).toEqual(["/errors/p51fp001?app=alpha&limit=1"]);
    expect(result.texte).toContain("cursor=opaque-next");
    expect(result.texte).not.toMatch(/offset/);
  });

  it("guide la suite des issues par curseur en markdown, sans limite ni offset inventés", async () => {
    const { client, vus } = clientFactice({
      meta: { app: "alpha", period: "7d", device: "all", generatedAt: "2026-09-17T12:00:00.000Z" },
      data: { issues: [{ kind: "issue", id: "6e8bd3a1-2b1c-4d7e-9f00-0a1b2c3d4e5f", status: "open" }], total: 3, next_cursor: "suite" },
    });
    const result = await executer(outil("mip_rum_list_issues"), { app: "alpha", period: "7d", format: "markdown" }, client);
    expect(vus).toEqual(["/issues?app=alpha&period=7d"]);
    expect(result.texte).toContain("cursor=suite");
    expect(result.texte).toContain("Total filtré : 3");
    expect(result.texte).not.toMatch(/limite|offset/);
  });

  it("propage l'erreur du client sans la maquiller", async () => {
    const { client } = clientFactice(null, new ErreurApi("message d'origine", 429));
    await expect(executer(outil("mip_rum_list_apps"), {}, client)).rejects.toThrow("message d'origine");
  });
});
