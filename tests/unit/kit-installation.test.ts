// Le kit d'installation (`lib/kit-installation.ts`, « À faire » X11) : le code que la
// page « Installer » écrit pour le client.
//
// CE QUE CES TESTS EMPÊCHENT. Le code produit part tel quel chez le client : il est
// EXÉCUTÉ ici, pas seulement relu.
//   - Un fichier de configuration qui ne s'exécute pas, ou qui passe au SDK une option
//     qu'on n'a pas choisie (un rejeu allumé par défaut, un consentement oublié).
//   - Un pont de consentement qui n'appelle jamais `MIPRum.consent`, ou l'appelle avant
//     la réponse du visiteur.
//   - Un filtre de données personnelles qui casserait un identifiant de trace.
//   - Un script de source maps qui laisserait les maps dans les fichiers publics, ou
//     ferait échouer la construction.
//   - Une mention de confidentialité qui promettrait ce que les réglages ne font pas.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  MARQUE_RELEASE,
  REGLAGES_PAR_DEFAUT,
  balisesEnTete,
  bornerTaux,
  commandeBuild,
  echantillonnageConseille,
  fichierInit,
  jetonsARenouveler,
  mentionConfidentialite,
  scriptSourcemaps,
  type ReglagesKit,
} from "@/lib/kit-installation";
import { REPERE_CLE_API } from "@/lib/recettes-agents-otel";

const APP = { endpoint: "https://collecte.exemple/v1/traces", appId: "boutique", clientId: "acme" };
const reglages = (r: Partial<ReglagesKit> = {}): ReglagesKit => ({ ...REGLAGES_PAR_DEFAUT, ...r });

/** Exécute le fichier de configuration dans un navigateur de pacotille ; rend ce que le SDK a reçu. */
function executer(code: string, globaux: Record<string, unknown> = {}) {
  const init: Record<string, unknown>[] = [];
  const consentements: boolean[] = [];
  const contexte: Record<string, unknown> = {
    MIPRum: { init: (o: Record<string, unknown>) => init.push(o), consent: (c: boolean) => consentements.push(c) },
    ...globaux,
  };
  contexte.window = contexte;
  runInNewContext(code, contexte);
  return { init: init[0], consentements, contexte };
}

describe("le fichier de configuration", () => {
  it("s'exécute et passe au SDK les valeurs de l'application, clé à coller comprise", () => {
    const { init } = executer(fichierInit(APP, reglages()));
    expect(init).toMatchObject({ endpoint: APP.endpoint, appId: "boutique", clientId: "acme", apiKey: REPERE_CLE_API, sampleRate: 1 });
  });

  it("n'allume ni le rejeu ni le consentement qu'on n'a pas choisis", () => {
    const { init } = executer(fichierInit(APP, reglages({ filtreDonnees: false })));
    expect(init).not.toHaveProperty("replay");
    expect(init).not.toHaveProperty("requireConsent");
    expect(init).not.toHaveProperty("beforeSend");
  });

  it("rejeu : taux, masquage et zones démasquées ; pas de zones sous « saisies seulement »", () => {
    const { init } = executer(fichierInit(APP, reglages({ rejeu: 0.25, masquage: "media", zonesDemasquees: "nav, .menu" })));
    expect(init).toMatchObject({ replay: 0.25, replayMask: "media", replayUnmask: "nav, .menu" });
    const saisies = executer(fichierInit(APP, reglages({ rejeu: 1, masquage: "inputs", zonesDemasquees: "nav" }))).init;
    expect(saisies).toMatchObject({ replay: 1, replayMask: "inputs" });
    expect(saisies).not.toHaveProperty("replayUnmask");
  });

  it("le SDK absent (script bloqué) : rien ne se passe, aucune erreur", () => {
    expect(() => runInNewContext(fichierInit(APP, reglages({ consentement: "axeptio" })), { window: {} })).not.toThrow();
  });

  it("garde la ligne que le script des source maps remplace, seulement si la version est demandée", () => {
    expect(fichierInit(APP, reglages())).toContain(MARQUE_RELEASE);
    expect(fichierInit(APP, reglages({ release: false }))).not.toContain(MARQUE_RELEASE);
  });

  it("le filtre retire e-mails et longs numéros des textes, jamais d'un identifiant", () => {
    const { init } = executer(fichierInit(APP, reglages({ filtreDonnees: true })));
    const filtre = init.beforeSend as (a: Record<string, unknown>) => Record<string, unknown>;
    const sortie = filtre({
      "mip.url": "https://boutique.fr/compte?email=jean.dupont@exemple.fr&tel=0612345678",
      "exception.message": "client 123456789012 introuvable",
      "mip.trace_id": "4bf92f3577b34da6123456789012e4736",
      "mip.session_id": "s123456789012",
      "webvital.value": 2340,
    });
    expect(sortie["mip.url"]).toBe("https://boutique.fr/compte?email=[email]&tel=[numéro]");
    expect(sortie["exception.message"]).toBe("client [numéro] introuvable");
    expect(sortie["mip.trace_id"]).toBe("4bf92f3577b34da6123456789012e4736");
    expect(sortie["mip.session_id"]).toBe("s123456789012");
    expect(sortie["webvital.value"]).toBe(2340);
  });

  it("les balises de l'en-tête chargent le SDK puis le fichier du site", () => {
    expect(balisesEnTete("https://console/mip-rum.js")).toMatch(/mip-rum\.js"><\/script>\n<script src="\/init-mip-rum\.js">/);
  });
});

describe("les ponts de consentement", () => {
  it("un outil choisi : le SDK attend l'accord (requireConsent)", () => {
    for (const consentement of ["axeptio", "didomi", "tarteaucitron", "autre"] as const) {
      expect(executer(fichierInit(APP, reglages({ consentement })), { _axcb: [], didomiOnReady: [] }).init).toMatchObject({
        requireConsent: true,
      });
    }
  });

  it("Axeptio : la réponse du visiteur, pour le service déclaré, devient MIPRum.consent", () => {
    const { contexte, consentements } = executer(fichierInit(APP, reglages({ consentement: "axeptio" })));
    const ecouteurs: Record<string, (c: Record<string, boolean>) => void> = {};
    for (const rappel of contexte._axcb as ((sdk: unknown) => void)[]) rappel({ on: (e: string, f: never) => (ecouteurs[e] = f) });
    ecouteurs["cookies:complete"]({ mip_rum: true });
    ecouteurs["cookies:complete"]({ autre_service: true });
    expect(consentements).toEqual([true, false]);
  });

  it("Didomi : rien avant la réponse, puis l'état du fournisseur et ses changements", () => {
    const { contexte, consentements } = executer(fichierInit(APP, reglages({ consentement: "didomi", identifiantOutil: "c:mip" })));
    let ecouteur: ((s: unknown) => void) | null = null;
    const Didomi = {
      getCurrentUserStatus: () => ({ vendors: {} }),
      addVendorStatusListener: (id: string, f: (s: unknown) => void) => {
        expect(id).toBe("c:mip");
        ecouteur = f;
      },
    };
    for (const rappel of contexte.didomiOnReady as ((d: unknown) => void)[]) rappel(Didomi);
    expect(consentements).toEqual([]);
    ecouteur!({ enabled: true });
    ecouteur!({ enabled: false });
    expect(consentements).toEqual([true, false]);
  });

  it("tarteaucitron : un service déclaré, mis en file ; accepter et refuser appellent le SDK", () => {
    const tarteaucitron: { services: Record<string, { js(): void; fallback(): void; needConsent: boolean }>; job?: string[] } = { services: {} };
    const { consentements } = executer(fichierInit(APP, reglages({ consentement: "tarteaucitron" })), { tarteaucitron });
    expect(tarteaucitron.job).toEqual(["miprum"]);
    expect(tarteaucitron.services.miprum.needConsent).toBe(true);
    tarteaucitron.services.miprum.js();
    tarteaucitron.services.miprum.fallback();
    expect(consentements).toEqual([true, false]);
  });
});

describe("le script des source maps", () => {
  function site() {
    const racine = mkdtempSync(join(tmpdir(), "kit-sm-"));
    const dist = join(racine, "dist");
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "init-mip-rum.js"), fichierInit(APP, reglages()));
    writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)");
    writeFileSync(join(dist, "assets", "index-abc.js.map"), JSON.stringify({ version: 3, sources: ["src/main.ts"], mappings: "" }));
    const script = join(racine, "mip-sourcemaps.mjs");
    writeFileSync(script, scriptSourcemaps({ appId: "boutique", urlEnvoi: "http://127.0.0.1:9/inutilise", dossier: "dist" }));
    return { racine, dist, script };
  }

  it("sans jeton : écrit la version, retire les maps, et ne fait pas échouer la construction", () => {
    const { racine, dist, script } = site();
    const sortie = execFileSync(process.execPath, [script], { cwd: racine, env: { PATH: process.env.PATH, GITHUB_SHA: "abc123" } }).toString();
    expect(sortie).toContain("MIP_SOURCEMAP_TOKEN absent");
    expect(readdirSync(join(dist, "assets"))).toEqual(["index-abc.js"]);
    const init = readFileSync(join(dist, "init-mip-rum.js"), "utf8");
    expect(init).toContain('    release: "abc123",');
    // Le fichier réécrit s'exécute toujours, et passe la version au SDK.
    expect(executer(init).init).toMatchObject({ release: "abc123" });
  });

  it("avec un jeton : chaque map part à MIP, avec l'application, la version et le nom du bundle", async () => {
    const recues: { auth?: string; corps: { appId: string; release: string; maps: { filename: string }[] } }[] = [];
    const serveur = createServer((req, res) => {
      let corps = "";
      req.on("data", (d) => (corps += d));
      req.on("end", () => {
        recues.push({ auth: req.headers.authorization, corps: JSON.parse(corps) });
        res.writeHead(201).end("{}");
      });
    });
    await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
    const { port } = serveur.address() as { port: number };
    const { racine, dist, script } = site();
    const enfant = spawn(process.execPath, [script], {
      cwd: racine,
      env: { PATH: process.env.PATH, VERCEL_GIT_COMMIT_SHA: "f00d", MIP_SOURCEMAP_TOKEN: "msu_test", MIP_SOURCEMAP_URL: `http://127.0.0.1:${port}/api/sourcemaps` },
    });
    let sortie = "";
    enfant.stdout.on("data", (d) => (sortie += d));
    await new Promise((ok) => enfant.on("close", ok));
    serveur.close();
    expect(sortie).toContain("index-abc.js : 201");
    expect(recues).toHaveLength(1);
    expect(recues[0].auth).toBe("Bearer msu_test");
    expect(recues[0].corps).toMatchObject({ appId: "boutique", release: "f00d", maps: [{ filename: "index-abc.js" }] });
    expect(readdirSync(join(dist, "assets"))).toEqual(["index-abc.js"]);
  });

  it("la commande de construction lance le script après l'outil choisi", () => {
    expect(commandeBuild("vite")).toBe('"build": "vite build && node scripts/mip-sourcemaps.mjs"');
    expect(commandeBuild("webpack")).toContain("webpack --mode production && node scripts/mip-sourcemaps.mjs");
  });
});

describe("l'échantillonnage conseillé", () => {
  it("tout mesurer sous le plafond de la sonde, un quart au-delà, tout au départ", () => {
    expect(echantillonnageConseille(null).taux).toBe(1);
    expect(echantillonnageConseille(420).taux).toBe(1);
    expect(echantillonnageConseille(1000).taux).toBe(0.25);
  });

  it("un taux saisi reste dans ses bornes", () => {
    expect(bornerTaux(3)).toBe(1);
    expect(bornerTaux(-1)).toBe(0);
    expect(bornerTaux(0, 0.01)).toBe(0.01);
    expect(bornerTaux(Number.NaN)).toBe(1);
  });
});

describe("la mention de confidentialité", () => {
  const mention = (r: Partial<ReglagesKit>) => mentionConfidentialite({ nomSite: "Boutique", retentionJours: 30, reglages: reglages(r) });

  it("dit la conservation de l'application, l'absence d'adresse IP et l'hébergement", () => {
    const texte = mention({});
    expect(texte).toContain("conservées 30 jours");
    expect(texte).toContain("Aucune adresse IP n'est conservée");
    expect(texte).toContain("Union européenne");
  });

  it("ne parle du rejeu que s'il est allumé, et dit ce que son masquage laisse voir", () => {
    expect(mention({ rejeu: 0 })).not.toContain("rejeu");
    expect(mention({ rejeu: 0.1, masquage: "all" })).toContain("sans le texte affiché");
    expect(mention({ rejeu: 0.1, masquage: "inputs" })).toContain("jamais ce que vous saisissez");
  });

  it("ne promet un accord que si un outil de consentement est branché", () => {
    expect(mention({ consentement: "aucun" })).not.toContain("qu'avec votre accord");
    expect(mention({ consentement: "didomi" })).toContain("qu'avec votre accord");
  });
});

describe("les jetons à renouveler", () => {
  const maintenant = Date.parse("2026-12-25T12:00:00Z");
  const jeton = (nom: string, expire: string, revoque: string | null = null) =>
    ({ nom, nature: "source maps", expiresAt: expire, revokedAt: revoque }) as const;

  it("les actifs qui expirent sous quinze jours, ou viennent d'expirer, du plus urgent au moins urgent", () => {
    const r = jetonsARenouveler(
      [
        jeton("loin", "2027-03-01T00:00:00Z"),
        jeton("bientot", "2027-01-03T00:00:00Z"),
        jeton("expire", "2026-12-20T00:00:00Z"),
        jeton("revoque", "2026-12-27T00:00:00Z", "2026-12-01T00:00:00Z"),
        jeton("vieux", "2026-10-01T00:00:00Z"),
      ],
      maintenant,
    );
    expect(r.map((j) => [j.nom, j.joursRestants])).toEqual([
      ["expire", -5],
      ["bientot", 9],
    ]);
  });
});

// Le script produit est un module valide pour Node, au-delà des deux cas exécutés plus haut.
describe("le script produit", () => {
  it("passe la vérification de syntaxe de Node", () => {
    const fichier = join(mkdtempSync(join(tmpdir(), "kit-check-")), "s.mjs");
    writeFileSync(fichier, scriptSourcemaps({ appId: "a", urlEnvoi: "https://x/api/sourcemaps", dossier: "build" }));
    expect(() => execFileSync(process.execPath, ["--check", fichier])).not.toThrow();
  });
});
