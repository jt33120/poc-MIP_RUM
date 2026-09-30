// La page « Installer » (`/installer`) : sa logique pure (`lib/installer.ts`).
//
// CE QUE CES TESTS EMPÊCHENT.
//   - Un sondage qui tourne sans fin : la base est payée à l'usage. Il s'arrête au
//     vert, après 120 relectures (10 minutes d'onglet visible), et ne relit jamais
//     onglet masqué ni par-dessus une relecture en cours.
//   - Un vert qui n'a pas été vu : une sonde illisible laisse tout en attente.
//   - Un tableau « propre à votre application » qui mélange les colonnes : l'adresse
//     du SDK et la collecte sont communes, l'identifiant, la clé et les domaines non.
//   - Un code par pile qui perd le repère de la clé, ou une directive CSP qui
//     remplacerait la politique du site au lieu de s'y ajouter.
import { describe, expect, it } from "vitest";
import {
  AVERTISSEMENT_EXTENSION_SANS_CLE,
  DUREE_MAX_SONDAGE_MS,
  INTERVALLE_SONDAGE_MS,
  PLAFOND_COMPTE,
  RELECTURES_MAX,
  appelInit,
  basculerCoche,
  codeNextAppRouter,
  codeNextPagesRouter,
  compteChecklist,
  compteLisible,
  decisionSondage,
  directivesCsp,
  domainesExtension,
  minutesRestantes,
  parcoursDuFragment,
  personnalisation,
  toutVert,
  verificationsDe,
  type FaitsApplication,
  type SondeInstallation,
} from "@/lib/installer";
import { EXTENSION_ID, strategieExtension, strategieNommage } from "@/lib/extension-deploiement";
import { REPERE_CLE_API } from "@/lib/recettes-agents-otel";

const SONDE_VIDE: SondeInstallation = {
  derniere_mesure_sdk: null,
  sessions_sdk_24h: 0,
  dernier_battement: null,
  postes: 0,
  derniere_mesure_extension: null,
  sessions_extension_24h: 0,
  dernier_span_serveur: null,
  spans_serveur_24h: 0,
  dernier_appel_relie: null,
};

const INSTANT = "2026-09-30T12:03:00.000Z";

describe("le sondage du test « ça arrive »", () => {
  it("10 minutes au plus, à 5 secondes : 120 relectures", () => {
    expect(INTERVALLE_SONDAGE_MS).toBe(5_000);
    expect(DUREE_MAX_SONDAGE_MS).toBe(600_000);
    expect(RELECTURES_MAX).toBe(120);
  });

  it("relit tant que rien n'arrête : onglet visible, pas tout vert, sous le plafond, rien en cours", () => {
    expect(decisionSondage({ relectures: 0, toutVert: false, visible: true, enCours: false })).toEqual({ relire: true, etat: "en_cours" });
    expect(decisionSondage({ relectures: 119, toutVert: false, visible: true, enCours: false }).relire).toBe(true);
  });

  it("s'arrête dès que tout est vert, avant tout autre motif", () => {
    expect(decisionSondage({ relectures: 0, toutVert: true, visible: true, enCours: false })).toEqual({ relire: false, etat: "vert" });
    expect(decisionSondage({ relectures: 500, toutVert: true, visible: false, enCours: true }).etat).toBe("vert");
  });

  it("s'arrête après le plafond ; « Vérifier à nouveau » repart de zéro", () => {
    expect(decisionSondage({ relectures: RELECTURES_MAX, toutVert: false, visible: true, enCours: false })).toEqual({ relire: false, etat: "delai" });
    expect(decisionSondage({ relectures: 0, toutVert: false, visible: true, enCours: false }).relire).toBe(true);
  });

  it("onglet masqué : aucune relecture, le sondage est en pause (il ne consomme pas son plafond)", () => {
    expect(decisionSondage({ relectures: 10, toutVert: false, visible: false, enCours: false })).toEqual({ relire: false, etat: "en_pause" });
  });

  it("jamais deux relectures à la fois", () => {
    expect(decisionSondage({ relectures: 10, toutVert: false, visible: true, enCours: true })).toEqual({ relire: false, etat: "en_cours" });
  });

  it("les minutes restantes, entamées, jamais négatives", () => {
    expect(minutesRestantes(0)).toBe(10);
    expect(minutesRestantes(1)).toBe(10);
    expect(minutesRestantes(108)).toBe(1);
    expect(minutesRestantes(120)).toBe(0);
    expect(minutesRestantes(500)).toBe(0);
  });
});

describe("les états du test « ça arrive »", () => {
  it("sonde illisible ou vide : tout en attente, jamais un vert qui n'a pas été vu", () => {
    for (const p of ["snippet", "extension", "serveur"] as const) {
      expect(verificationsDe(p, null).every((v) => !v.ok)).toBe(true);
      expect(verificationsDe(p, SONDE_VIDE).every((v) => !v.ok)).toBe(true);
      expect(toutVert(p, null)).toBe(false);
    }
    expect(verificationsDe("snippet", SONDE_VIDE).map((v) => v.detail)).toEqual(["en attente", "aucune"]);
  });

  it("code de suivi : Web Vitals ET sessions du mode « sdk » pour être tout vert", () => {
    const mesures = { ...SONDE_VIDE, derniere_mesure_sdk: INSTANT };
    expect(toutVert("snippet", mesures)).toBe(false);
    const tout = { ...mesures, sessions_sdk_24h: 3 };
    expect(toutVert("snippet", tout)).toBe(true);
    const [vitals, sessions] = verificationsDe("snippet", tout);
    expect(vitals.detail).toMatch(/^dernière à \d{2}\/\d{2} à \d{2}:\d{2}$/);
    expect(sessions.detail).toBe("3 sessions");
  });

  it("extension : le battement seul ne suffit pas, et l'aide dit pourquoi les mesures manquent", () => {
    const battement = { ...SONDE_VIDE, dernier_battement: INSTANT, postes: 1 };
    const [b, m] = verificationsDe("extension", battement);
    expect(b.ok).toBe(true);
    expect(b.detail).toContain("1 poste");
    expect(m.ok).toBe(false);
    expect(toutVert("extension", battement)).toBe(false);
    // L'avertissement de la clé : tant qu'il est posé, la case des mesures le rappelle.
    expect(Boolean(m.aide)).toBe(Boolean(AVERTISSEMENT_EXTENSION_SANS_CLE));
    expect(toutVert("extension", { ...battement, derniere_mesure_extension: INSTANT })).toBe(true);
  });

  it("serveur : les temps serveur ET un appel du navigateur relié", () => {
    const spans = { ...SONDE_VIDE, dernier_span_serveur: INSTANT, spans_serveur_24h: 12 };
    expect(toutVert("serveur", spans)).toBe(false);
    expect(verificationsDe("serveur", spans)[0].detail).toContain("12 appels sur 24 h");
    expect(toutVert("serveur", { ...spans, dernier_appel_relie: INSTANT })).toBe(true);
  });

  it("un compte plafonné par la sonde se lit « et plus »", () => {
    expect(PLAFOND_COMPTE).toBe(1000);
    expect(compteLisible(1, "session", "sessions")).toBe("1 session");
    expect(compteLisible(PLAFOND_COMPTE, "session", "sessions")).toBe("1 000 sessions et plus");
  });

  it("l'avertissement de l'extension est UNE constante, qui dit la clé et le refus", () => {
    // `null` le retire partout ; tant qu'il est posé, il dit la date, la clé et le 403.
    if (AVERTISSEMENT_EXTENSION_SANS_CLE !== null) {
      expect(AVERTISSEMENT_EXTENSION_SANS_CLE).toContain("29/09/2026");
      expect(AVERTISSEMENT_EXTENSION_SANS_CLE).toContain("clé d'API");
      expect(AVERTISSEMENT_EXTENSION_SANS_CLE).toContain("403");
    }
  });
});

describe("les check-lists : compteur et cases", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "sonde", sonde: { ok: false } }];

  it("cocher et décocher rend un NOUVEL ensemble", () => {
    const vide = new Set<string>();
    const un = basculerCoche(vide, "a");
    expect([...un]).toEqual(["a"]);
    expect(vide.size).toBe(0);
    expect([...basculerCoche(un, "a")]).toEqual([]);
  });

  it("le compteur : cases cochées plus cases de sonde vertes, sur le total", () => {
    expect(compteChecklist(items, new Set())).toEqual({ faits: 0, total: 3, complet: false });
    expect(compteChecklist(items, new Set(["a", "b"]))).toEqual({ faits: 2, total: 3, complet: false });
  });

  it("une case de sonde ne se coche jamais au clic, et devient faite quand la sonde la voit", () => {
    expect(compteChecklist(items, new Set(["a", "b", "sonde"])).faits).toBe(2);
    const vus = [{ id: "a" }, { id: "b" }, { id: "sonde", sonde: { ok: true } }];
    expect(compteChecklist(vus, new Set(["a", "b"]))).toEqual({ faits: 3, total: 3, complet: true });
  });
});

describe("ce qui est propre à l'application, ce qui est pareil pour tous", () => {
  const faits: FaitsApplication = {
    appId: "client-pilote",
    clientId: "groupement-x",
    aUneCle: true,
    origines: ["https://app.client.fr", "http://localhost:5173"],
    sdkUrl: "https://mip-rum-console.vercel.app/mip-rum.js",
    endpoint: "https://mip-rum-console.vercel.app/api/ingest/v1/traces",
    endpointLogs: "https://mip-rum-console.vercel.app/api/ingest/v1/logs",
    domaines: [{ domaine: "app.client.fr", etat: "actif" }],
  };
  const propres = (p: "snippet" | "extension" | "serveur") =>
    personnalisation(p, faits)
      .filter((l) => l.propre)
      .map((l) => l.element);
  const communs = (p: "snippet" | "extension" | "serveur") =>
    personnalisation(p, faits)
      .filter((l) => !l.propre)
      .map((l) => l.element);

  it("code de suivi : l'identifiant, la clé et les domaines sont propres ; le script et la collecte communs", () => {
    expect(propres("snippet").join(" | ")).toMatch(/appId.*clientId.*apiKey.*Domaines/);
    expect(communs("snippet")).toEqual(expect.arrayContaining(["Adresse du script", "Adresse de collecte"]));
    const lignes = personnalisation("snippet", faits);
    expect(lignes.find((l) => l.element.startsWith("Domaines"))?.valeur).toBe("https://app.client.fr, http://localhost:5173");
    expect(lignes.find((l) => l.element === "Adresse de collecte")?.valeur).toBe(faits.endpoint);
  });

  it("sans clientId, sa ligne disparaît ; sans clé, la ligne le dit", () => {
    const sans = personnalisation("snippet", { ...faits, clientId: null, aUneCle: false });
    expect(sans.some((l) => l.element.includes("clientId"))).toBe(false);
    expect(sans.find((l) => l.element.includes("apiKey"))?.valeur).toMatch(/aucune/);
  });

  it("extension : un paquet commun ; propres, les domaines enregistrés, l'autorisation et le libellé du poste", () => {
    expect(communs("extension")).toContain("Le paquet de l'extension");
    expect(propres("extension")).toEqual(
      expect.arrayContaining(["Domaines enregistrés côté MIP", "Autorisation sur chaque poste", "Libellé du poste (facultatif)"]),
    );
    expect(personnalisation("extension", faits)[0].valeur).toBe("app.client.fr");
  });

  it("serveur : l'agent et le socle communs ; le nom du service, mip.app_id et mip.api_key propres", () => {
    expect(propres("serveur")).toEqual([
      "Nom du service (OTEL_SERVICE_NAME)",
      "Identifiant d'application (mip.app_id)",
      "Clé d'API (mip.api_key)",
    ]);
    expect(personnalisation("serveur", faits)[0].valeur).toBe("client-pilote-api (à adapter)");
  });
});

describe("les domaines de l'extension", () => {
  it("le registre d'abord (actif, coupé), puis les domaines déclarés à enregistrer, hors poste local", () => {
    expect(
      domainesExtension(
        [
          { domain: "b.client.fr", active: false },
          { domain: "a.client.fr", active: true },
        ],
        ["https://a.client.fr", "https://c.client.fr", "http://localhost:5173", "http://127.0.0.1:8080", "pas une url"],
      ),
    ).toEqual([
      { domaine: "a.client.fr", etat: "actif" },
      { domaine: "b.client.fr", etat: "coupe" },
      { domaine: "c.client.fr", etat: "non_enregistre" },
    ]);
  });

  it("rien d'enregistré ni de déclaré : une liste vide (la page dit que l'extension n'observera rien)", () => {
    expect(domainesExtension([], [])).toEqual([]);
  });
});

describe("le code de suivi par pile, la CSP et les stratégies", () => {
  const SDK = "https://mip-rum-console.vercel.app/mip-rum.js";
  const ENDPOINT = "https://mip-rum-console.vercel.app/api/ingest/v1/traces";
  const init = appelInit({ endpoint: ENDPOINT, appId: "client-pilote", clientId: null });

  it("l'init porte l'adresse, l'identifiant et le REPÈRE de la clé, jamais une clé", () => {
    expect(init).toBe(
      `MIPRum.init({ endpoint: "${ENDPOINT}", appId: "client-pilote", env: "prod", apiKey: "${REPERE_CLE_API}" });`,
    );
    expect(appelInit({ endpoint: ENDPOINT, appId: "x", clientId: "y" })).toContain('clientId: "y"');
  });

  it("Next.js : les deux balises, le script d'abord, dans le layout ou le document", () => {
    const app = codeNextAppRouter(SDK, init);
    expect(app).toContain("app/layout.tsx");
    expect(app.indexOf(`<script src="${SDK}" />`)).toBeLessThan(app.indexOf("dangerouslySetInnerHTML"));
    expect(app).toContain(REPERE_CLE_API);
    const pages = codeNextPagesRouter(SDK, init);
    expect(pages).toContain('import { Html, Head, Main, NextScript } from "next/document";');
    expect(pages).toContain(`<script src="${SDK}" />`);
  });

  it("la CSP : deux directives à AJOUTER, les origines du script et de la collecte", () => {
    expect(directivesCsp({ sdkUrl: SDK, endpoint: "https://collecte.exemple/api/ingest/v1/traces", appId: "x" })).toEqual({
      scriptSrc: "script-src https://mip-rum-console.vercel.app",
      connectSrc: "connect-src https://collecte.exemple",
    });
  });

  it("les stratégies de parc : l'identifiant de l'extension, les domaines accordés d'avance, la clé « poste »", () => {
    const s = JSON.parse(strategieExtension(["app.client.fr"], null));
    expect(s[EXTENSION_ID]).toEqual({
      installation_mode: "force_installed",
      update_url: "https://<votre-hebergement>/update.xml",
      runtime_allowed_hosts: ["*://app.client.fr"],
    });
    expect(JSON.parse(strategieExtension([], "https://it.client.fr/update.xml"))[EXTENSION_ID].runtime_allowed_hosts).toEqual(["*://app.client.fr"]);
    expect(JSON.parse(strategieNommage())["3rdparty"].extensions[EXTENSION_ID]).toEqual({ poste: "${machine_name}" });
  });
});

describe("l'ancre d'un parcours", () => {
  it.each([
    ["#snippet", "snippet"],
    ["#extension", "extension"],
    ["serveur", "serveur"],
    ["", "snippet"],
    ["#inconnu", "snippet"],
    [null, "snippet"],
  ])("%s → %s", (fragment, parcours) => {
    expect(parcoursDuFragment(fragment)).toBe(parcours);
  });
});
