// Ext-D : inventaire de parc — identité d'installation côté extension (logique
// pure) et lecture côté console. Aucune I/O ici.
import { describe, expect, it } from "vitest";
import {
  BEAT_INTERVAL_MS,
  RETRY_MIN_MS,
  beatDue,
  buildBeat,
  heartbeatUrlFrom,
  normalizeLabel,
  readState,
  withAppId,
  type InstallState,
} from "../../apps/extension/lib/install";
import {
  compareVersions,
  displayName,
  fleetVersion,
  freshness,
} from "../../apps/console/lib/extension-installs";
import { browserMajorFromUA, platformFromUA } from "../../apps/console/lib/format";

const NEUF: InstallState = { installId: "id-1", lastBeatAt: 0, lastTryAt: 0, appIds: [] };
const NOW = 1_700_000_000_000;

describe("readState", () => {
  it("garde l'identifiant existant et ignore celui proposé", () => {
    expect(readState({ installId: "abc", lastBeatAt: 5, lastTryAt: 6, appIds: [] }, "neuf").installId).toBe("abc");
  });

  it("adopte l'identifiant neuf quand le stockage est vide", () => {
    expect(readState(undefined, "neuf").installId).toBe("neuf");
    expect(readState({}, "neuf").installId).toBe("neuf");
  });

  // Le stockage d'une extension est modifiable par son utilisateur : aucune
  // valeur relue ne peut être supposée du bon type.
  it("survit à un stockage corrompu", () => {
    const s = readState({ installId: 42, lastBeatAt: "hier", lastTryAt: null, appIds: "app" }, "neuf");
    expect(s).toEqual({ installId: "neuf", lastBeatAt: 0, lastTryAt: 0, appIds: [] });
  });

  it("dédoublonne, trie et purge les app_id non-chaînes", () => {
    const s = readState({ installId: "x", appIds: ["b", "a", "b", 7, ""] }, "neuf");
    expect(s.appIds).toEqual(["a", "b"]);
  });
});

describe("withAppId", () => {
  it("renvoie null quand rien ne change — pas d'écriture de stockage inutile", () => {
    expect(withAppId(["a"], "a")).toBeNull();
    expect(withAppId([], null)).toBeNull();
    expect(withAppId([], undefined)).toBeNull();
  });

  it("ajoute et trie", () => {
    expect(withAppId(["b"], "a")).toEqual(["a", "b"]);
  });
});

describe("beatDue", () => {
  it("bat à la première exécution", () => {
    expect(beatDue(NEUF, NOW, false)).toBe(true);
  });

  it("se tait juste après un battement accepté", () => {
    const s = { ...NEUF, lastBeatAt: NOW - 60_000, lastTryAt: NOW - 60_000 };
    expect(beatDue(s, NOW, false)).toBe(false);
  });

  it("rebat après l'intervalle", () => {
    const t = NOW - BEAT_INTERVAL_MS - 1;
    expect(beatDue({ ...NEUF, lastBeatAt: t, lastTryAt: t }, NOW, false)).toBe(true);
  });

  // Un serveur injoignable ne doit pas transformer chaque navigation en requête.
  it("respecte le délai de reprise après une tentative échouée", () => {
    const s = { ...NEUF, lastBeatAt: 0, lastTryAt: NOW - 60_000 };
    expect(beatDue(s, NOW, false)).toBe(false);
    expect(beatDue({ ...s, lastTryAt: NOW - RETRY_MIN_MS - 1 }, NOW, false)).toBe(true);
  });

  // Le périmètre d'un poste change au plus une fois par application supervisée :
  // court-circuiter la reprise ne peut pas produire de rafale.
  it("un périmètre nouveau court-circuite l'intervalle ET la reprise", () => {
    const s = { ...NEUF, lastBeatAt: NOW, lastTryAt: NOW };
    expect(beatDue(s, NOW, true)).toBe(true);
  });

  it("une horloge reculée ne gèle pas l'inventaire", () => {
    const futur = { ...NEUF, lastBeatAt: NOW + 10 * BEAT_INTERVAL_MS, lastTryAt: 0 };
    expect(beatDue(futur, NOW, false)).toBe(true);
  });
});

describe("buildBeat", () => {
  it("ne transporte que l'identité d'installation — jamais d'URL", () => {
    const beat = buildBeat({ ...NEUF, appIds: ["a"] }, "0.4.3", null);
    expect(beat).toEqual({ install_id: "id-1", version: "0.4.3", label: null, app_ids: ["a"] });
    expect(Object.keys(beat).sort()).toEqual(["app_ids", "install_id", "label", "version"]);
  });
});

describe("normalizeLabel", () => {
  it("trim, vide -> null, non-chaîne -> null", () => {
    expect(normalizeLabel("  PC-07 ")).toBe("PC-07");
    expect(normalizeLabel("   ")).toBeNull();
    expect(normalizeLabel(undefined)).toBeNull();
    expect(normalizeLabel(12)).toBeNull();
  });

  it("tronque un libellé de policy trop long", () => {
    expect(normalizeLabel("x".repeat(500))).toHaveLength(120);
  });
});

describe("heartbeatUrlFrom", () => {
  it("suit l'override de résolution — la pré-prod ne déclare pas ses postes en prod", () => {
    expect(heartbeatUrlFrom("https://staging.exemple.fr/api/extension/resolve")).toBe(
      "https://staging.exemple.fr/api/extension/heartbeat",
    );
    expect(heartbeatUrlFrom("http://localhost:3000/api/extension/resolve/")).toBe(
      "http://localhost:3000/api/extension/heartbeat",
    );
  });

  // Mieux vaut un inventaire muet qu'un POST envoyé à une route qui n'est pas la sienne.
  it("refuse une URL qui ne se termine pas par /resolve", () => {
    expect(heartbeatUrlFrom("https://exemple.fr/api/autre")).toBeNull();
  });
});

describe("compareVersions", () => {
  // En lexicographique, "0.10.0" passerait avant "0.9.0" et l'inventaire
  // déclarerait périmés les postes les plus à jour.
  it("compare numériquement, pas lexicographiquement", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("0.4.3", "0.4.3")).toBe(0);
  });
});

describe("fleetVersion", () => {
  it("prend la plus haute observée et ignore les absentes", () => {
    expect(fleetVersion(["0.4.1", null, "0.10.0", "0.9.9"])).toBe("0.10.0");
    expect(fleetVersion([null, null])).toBeNull();
    expect(fleetVersion([])).toBeNull();
  });
});

describe("freshness", () => {
  const j = 24 * 60 * 60 * 1000;
  it("un poste éteint tout un week-end reste actif", () => {
    expect(freshness(NOW - 2.5 * j, NOW)).toBe("actif");
  });
  it("classe silencieux puis perdu", () => {
    expect(freshness(NOW - 10 * j, NOW)).toBe("silencieux");
    expect(freshness(NOW - 40 * j, NOW)).toBe("perdu");
  });
});

describe("displayName", () => {
  it("préfère le libellé de policy, sinon un identifiant court", () => {
    expect(displayName("PC-COMPTA-07", "abcdef12-0000-0000-0000-000000000000")).toBe("PC-COMPTA-07");
    expect(displayName(null, "abcdef12-0000-0000-0000-000000000000")).toBe("Poste abcdef12");
    expect(displayName("   ", "abcdef12-0000-0000-0000-000000000000")).toBe("Poste abcdef12");
  });
});

describe("lecture de l'User-Agent (côté serveur)", () => {
  const EDGE =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0";
  const CHROME_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  // Edge se déclare AUSSI « Chrome/… » : sans priorité sur Edg/, tout Edge
  // serait compté comme Chrome.
  it("lit la version majeure d'Edge sans la confondre avec Chrome", () => {
    expect(browserMajorFromUA(EDGE)).toBe(128);
    expect(browserMajorFromUA(CHROME_MAC)).toBe(131);
    expect(browserMajorFromUA(null)).toBeNull();
  });

  it("lit la plateforme", () => {
    expect(platformFromUA(EDGE)).toBe("Windows");
    expect(platformFromUA(CHROME_MAC)).toBe("macOS");
    expect(platformFromUA("quelque chose d'inconnu")).toBeNull();
  });
});

// C11 — le collector écrit l'inventaire des postes avec SES fonctions
// (`@mip/backend/lib/extension-parc.mjs`) ; l'écran lit avec celles de la console.
// Les deux doivent dire la même chose d'un même User-Agent.
describe("User-Agent d'un poste : mêmes règles console ↔ collector (C11)", () => {
  it("navigateur, version majeure et système, sur un échantillon de postes", async () => {
    const { browserFromUA } = await import("../../apps/console/lib/format");
    // @ts-expect-error module ESM partagé, sans déclarations
    const parc = await import("../../packages/backend/lib/extension-parc.mjs");
    const ECHANTILLON = [
      null,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "curl/8.7.1",
    ];
    for (const ua of ECHANTILLON) {
      expect(parc.navigateurDe(ua), String(ua)).toBe(browserFromUA(ua));
      expect(parc.versionMajeureDe(ua), String(ua)).toBe(browserMajorFromUA(ua));
      expect(parc.systemeDe(ua), String(ua)).toBe(platformFromUA(ua));
    }
  });
});
