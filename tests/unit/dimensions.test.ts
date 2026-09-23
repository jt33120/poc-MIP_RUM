// P6.1 — dimensions normalisées à l'ingestion (shared/dimensions.mjs).
//
// Ce corpus verrouille ce que le parseur NOMME et, surtout, ce qu'il REFUSE de
// nommer : un robot, un user-agent inconnu, une version figée par le navigateur
// ou une release hors bornes restent NULL, c'est-à-dire « Inconnu ». Une valeur
// devinée deviendrait une catégorie de filtre qu'aucun terminal n'a déclarée.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIMENSION_BOUNDS,
  boundedDimension,
  boundedRelease,
  clientDimensions,
} from "../../packages/backend/shared/dimensions.mjs";

type Dimensions = {
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  os_version: string | null;
  device_type: string | null;
};

const lire = (ua: unknown, indice?: unknown): Dimensions => clientDimensions(ua)(indice);
const INCONNU: Dimensions = { browser: null, browser_version: null, os: null, os_version: null, device_type: null };
const d = (browser: string | null, browser_version: string | null, os: string | null, os_version: string | null, device_type: string | null): Dimensions =>
  ({ browser, browser_version, os, os_version, device_type });

describe("clientDimensions — navigateurs usuels", () => {
  it.each([
    ["Chrome Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", d("Chrome", "139", "Windows", null, "desktop")],
    ["Edge Windows (se déclare aussi Chrome)", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0", d("Edge", "139", "Windows", null, "desktop")],
    ["Edge historique (EdgeHTML)", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 Edge/18.19582", d("Edge", "18", "Windows", null, "desktop")],
    ["Firefox Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0", d("Firefox", "142", "Windows", null, "desktop")],
    ["Opera Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 OPR/122.0.0.0", d("Opera", "122", "Windows", null, "desktop")],
    ["Safari macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15", d("Safari", "18", "macOS", null, "desktop")],
    ["Chrome macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", d("Chrome", "139", "macOS", null, "desktop")],
    ["Firefox macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0", d("Firefox", "142", "macOS", null, "desktop")],
    ["Safari sur un macOS antérieur au gel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15", d("Safari", "14", "macOS", "10.14", "desktop")],
    ["Chrome Linux", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", d("Chrome", "139", "Linux", null, "desktop")],
    ["Chrome ChromeOS", "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", d("Chrome", "139", "ChromeOS", null, "desktop")],
    ["Internet Explorer 11 sous Windows 7", "Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko", d("Internet Explorer", "11", "Windows", "7", "desktop")],
    ["Chrome sous Windows XP", "Mozilla/5.0 (Windows NT 5.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.112 Safari/537.36", d("Chrome", "49", "Windows", "XP", "desktop")],
    ["Chrome Android (user-agent réduit)", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36", d("Chrome", "139", "Android", null, "mobile")],
    ["Edge Android", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 EdgA/139.0.0.0", d("Edge", "139", "Android", null, "mobile")],
    ["Samsung Internet", "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36", d("Samsung Internet", "28", "Android", "14", "mobile")],
    ["Firefox Android", "Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0", d("Firefox", "142", "Android", "15", "mobile")],
    ["UC Browser", "Mozilla/5.0 (Linux; U; Android 11; en-US; RMX2185 Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/13.4.0.1306 Mobile Safari/537.36", d("UC Browser", "13", "Android", "11", "mobile")],
    ["Safari iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1", d("Safari", "17", "iOS", "17", "mobile")],
    ["Chrome iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1", d("Chrome", "139", "iOS", "17", "mobile")],
    ["Firefox iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15", d("Firefox", "142", "iOS", "17", "mobile")],
    ["WebView Android (application)", "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.7258.94 Mobile Safari/537.36", d("Android WebView", "139", "Android", "14", "mobile")],
    ["WebView iOS (navigateur intégré)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/476.0.0.40.108]", d("iOS WebView", null, "iOS", "17", "mobile")],
  ])("%s", (_nom, ua, attendu) => {
    expect(lire(ua)).toEqual(attendu);
  });
});

describe("clientDimensions — tablettes", () => {
  it.each([
    ["iPad (user-agent mobile)", "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1", d("Safari", "12", "iOS", "12", "tablet")],
    ["Chrome sur tablette Android (sans « Mobile »)", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", d("Chrome", "139", "Android", null, "tablet")],
    ["Samsung Internet sur Galaxy Tab", "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Safari/537.36", d("Samsung Internet", "28", "Android", "14", "tablet")],
    ["Firefox Android « Tablet »", "Mozilla/5.0 (Android 14; Tablet; rv:142.0) Gecko/142.0 Firefox/142.0", d("Firefox", "142", "Android", "14", "tablet")],
    ["Kindle Fire (Silk)", "Mozilla/5.0 (Linux; Android 9; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/130.4.1 like Chrome/130.0.6723.102 Safari/537.36", d("Silk", "130", "Android", "9", "tablet")],
  ])("%s", (_nom, ua, attendu) => {
    expect(lire(ua)).toEqual(attendu);
  });

  it("un iPad sous iPadOS 13+ se présente en Macintosh : desktop, limite assumée", () => {
    expect(lire("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"))
      .toEqual(d("Safari", "17", "macOS", null, "desktop"));
  });

  it("un téléviseur ou un boîtier n'est ni tablette ni desktop", () => {
    expect(lire("Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7285) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112.3.1 like Chrome/112.0.5615.213 Safari/537.36").device_type)
      .toBeNull();
    expect(lire("Mozilla/5.0 (Linux; Android 9; BRAVIA 4K UR2 Build/PTT1.190515.001.S104) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36").device_type)
      .toBeNull();
  });
});

describe("clientDimensions — versions figées par les navigateurs", () => {
  it("Windows NT 10.0 couvre Windows 10 et 11 : version inconnue", () => {
    expect(lire("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36").os_version).toBeNull();
    expect(lire("Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36").os_version).toBe("8.1");
  });

  it("iOS déclaré 18.6 : la version de Safari départage un vrai 18.6 d'un iOS 26 figé", () => {
    const ios = (suffixe: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${suffixe}`;
    expect(lire(ios("Version/26.0 Mobile/15E148 Safari/604.1"))).toEqual(d("Safari", "26", "iOS", "26", "mobile"));
    expect(lire(ios("Version/18.6 Mobile/15E148 Safari/604.1"))).toEqual(d("Safari", "18", "iOS", "18", "mobile"));
    // Sans Safari, rien ne départage : inconnu plutôt qu'une version fausse.
    expect(lire(ios("CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1")).os_version).toBeNull();
  });
});

describe("clientDimensions — React Native, robots, inconnus", () => {
  it.each([
    ["MIP-RN/0.1 (ios 17)", d(null, null, "iOS", "17", "mobile")],
    ["MIP-RN/0.1 (ios 17.4.1)", d(null, null, "iOS", "17", "mobile")],
    ["MIP-RN/0.1 (android 14)", d(null, null, "Android", "14", "mobile")],
    // Plateforme non déclarée à l'init : un mobile, système inconnu.
    ["MIP-RN/0.1 (mobile)", d(null, null, null, null, "mobile")],
  ])("user-agent synthétique du SDK React Native %s", (ua, attendu) => {
    expect(lire(ua)).toEqual(attendu);
  });

  it.each([
    ["Googlebot smartphone", "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.94 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
    ["Chrome sans tête", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/139.0.0.0 Safari/537.36"],
    ["Lighthouse", "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse"],
    ["client HTTP", "curl/8.7.1"],
  ])("un robot (%s) n'a ni navigateur ni système ; sa classe ne vient que de l'indice du SDK", (_nom, ua) => {
    expect(lire(ua)).toEqual(INCONNU);
    // Comme avant P6.1 : le trafic robot ne change pas de classe dans les agrégats existants.
    expect(lire(ua, "desktop")).toEqual(d(null, null, null, null, "desktop"));
  });

  it("un user-agent inconnu, absent ou hostile reste inconnu sans lever", () => {
    for (const ua of ["Mozilla/5.0 Test", "", "   ", null, undefined, 42, {}, "x".repeat(1025), "(".repeat(1000)]) {
      expect(lire(ua)).toEqual(INCONNU);
    }
  });
});

describe("clientDimensions — indice mip.device_type du SDK", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
  const TABLETTE_ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

  it("l'user-agent prime : le SDK web range les tablettes Android en desktop", () => {
    expect(lire(TABLETTE_ANDROID, "desktop").device_type).toBe("tablet");
    expect(lire(IPHONE, "desktop").device_type).toBe("mobile");
  });

  it("sans user-agent exploitable, l'indice sert de classe ; ios/android deviennent mobile et donnent le système", () => {
    expect(lire(null, "tablet")).toEqual(d(null, null, null, null, "tablet"));
    expect(lire("Mozilla/5.0 Test", " Desktop ")).toEqual(d(null, null, null, null, "desktop"));
    expect(lire(undefined, "ios")).toEqual(d(null, null, "iOS", null, "mobile"));
    expect(lire(undefined, "android")).toEqual(d(null, null, "Android", null, "mobile"));
  });

  it("un indice hors taxonomie n'est jamais recopié", () => {
    for (const indice of ["tv", "phablet", "constructor", "", 1, null]) {
      expect(lire(undefined, indice).device_type).toBeNull();
    }
  });

  it("l'user-agent n'est lu qu'une fois : la fonction rendue ne dépend que de l'indice", () => {
    const appareil = clientDimensions(IPHONE);
    expect(appareil("desktop")).toEqual(appareil(undefined));
  });
});

describe("boundedDimension — env et service déclarés", () => {
  it("scrubbe, retire les espaces de bord, ne tronque jamais", () => {
    expect(boundedDimension("  production ")).toBe("production");
    expect(boundedDimension("prod jean@client.fr")).toBe("prod [email]");
    expect(boundedDimension("x".repeat(120))).toBe("x".repeat(120));
    expect(boundedDimension("x".repeat(121))).toBeNull();
    expect(boundedDimension("abcd", 3)).toBeNull();
    for (const vide of ["", "   ", 42, true, null, undefined]) expect(boundedDimension(vide)).toBeNull();
  });

  it("refuse contrôle C0/C1, format et séparateurs Unicode, que [[:cntrl:]] peut viser selon la locale", () => {
    for (const code of [0x07, 0x7f, 0x85, 0x9f, 0x200b, 0x200d, 0x2028, 0x2029, 0xfeff]) {
      expect(boundedDimension(`pr${String.fromCharCode(code)}od`), code.toString(16)).toBeNull();
    }
  });
});

describe("boundedRelease — la release bornée à l'ingestion (suivi P5)", () => {
  it("garde l'identifiant de build À L'OCTET PRÈS : jamais scrubbé", () => {
    // Scrubbées, ces releases deviendraient « [ip] » et « build-[number] » et ne
    // correspondraient plus aux source maps ni aux marqueurs de déploiement.
    expect(boundedRelease("4.8.0.1")).toBe("4.8.0.1");
    expect(boundedRelease("build-17654321098")).toBe("build-17654321098");
    expect(boundedRelease("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678")).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678");
    expect(boundedRelease("2.3.1-rc.1+build.5")).toBe("2.3.1-rc.1+build.5");
  });

  it("1 à 120 caractères après espaces de bord ; au-delà, inconnue et non tronquée", () => {
    expect(boundedRelease("  1.2.3 ")).toBe("1.2.3");
    expect(boundedRelease("r".repeat(120))).toBe("r".repeat(120));
    expect(boundedRelease("r".repeat(121))).toBeNull();
    // Le cas du suivi P5 : une release de 2 000 caractères faisait échouer l'index (app_id, release).
    expect(boundedRelease("r".repeat(2000))).toBeNull();
    for (const vide of ["", "   ", 1.2, true, null, undefined, ["1.2.3"]]) expect(boundedRelease(vide)).toBeNull();
  });

  it("refuse les caractères de contrôle et de format", () => {
    for (const code of [0x00, 0x0a, 0x7f, 0x85, 0x200d, 0x2028]) {
      expect(boundedRelease(`1.2${String.fromCharCode(code)}3`), code.toString(16)).toBeNull();
    }
  });
});

describe("bornes partagées avec migration-v75", () => {
  it("les contraintes SQL reprennent exactement les bornes de l'ingestion", () => {
    const v75 = readFileSync(join(__dirname, "..", "..", "packages", "db", "sql", "migration-v75.sql"), "utf8");
    expect(DIMENSION_BOUNDS).toEqual({ family: 80, version: 120, declared: 120 });
    for (const famille of ["browser", "os"]) {
      expect(v75).toContain(`(${famille} is null or char_length(${famille}) between 1 and ${DIMENSION_BOUNDS.family})`);
      expect(v75).toContain(`(${famille}_version is null or char_length(${famille}_version) between 1 and ${DIMENSION_BOUNDS.version})`);
    }
    for (const declaree of ["env", "release", "service"]) {
      expect(v75).toContain(`(${declaree} is null or char_length(${declaree}) between 1 and ${DIMENSION_BOUNDS.declared})`);
    }
  });
});
