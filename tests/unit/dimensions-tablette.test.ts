// Finding 2.13 de docs/AUDIT_RUM_EXTERNE.md — les tablettes, et la dernière qui
// échappait : l'iPad sous iPadOS 13+.
//
// L'ingestion classait déjà iPad et tablettes Android d'après l'user-agent
// (tests/unit/dimensions.test.ts). Restait l'iPad récent, dont Safari se présente
// en « Macintosh » : compté ordinateur. Seul le navigateur sait qu'il est tactile.
// Ce fichier tient les deux moitiés du correctif et leur couture :
//   - le SDK (`classeAppareil`) déclare « tablet » pour un Macintosh tactile et
//     pour un Android sans « Mobile », sans compter un téléviseur ni un vieux
//     « Tablet PC » Windows ;
//   - l'ingestion (`clientDimensions`) laisse cet indice l'emporter sur SA lecture
//     « desktop » d'un user-agent Macintosh, et sur elle seule : partout ailleurs
//     l'user-agent prime, comme avant.
import { describe, expect, it } from "vitest";
import { classeAppareil } from "../../packages/rum-sdk/src/appareil";
import { buildResourceSpans, msToHr } from "../../packages/rum-sdk/src/otlp-encode";
// @ts-expect-error module JS partagé sans déclarations
import { clientDimensions } from "../../packages/backend/shared/dimensions.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const UA = {
  ipadOs17Safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  ipadOs17Chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  ipad12: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  androidTablette: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  androidTelephone: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
  firefoxTablette: "Mozilla/5.0 (Android 14; Tablet; rv:142.0) Gecko/142.0 Firefox/142.0",
  firefoxTelephone: "Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
  kindle: "Mozilla/5.0 (Linux; Android 9; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/130.4.1 like Chrome/130.0.6723.102 Safari/537.36",
  fireTv: "Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7285) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112.3.1 like Chrome/112.0.5615.213 Safari/537.36",
  bravia: "Mozilla/5.0 (Linux; Android 9; BRAVIA 4K UR2 Build/PTT1.190515.001.S104) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  windowsTabletPc: "Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; SLCC2; .NET CLR 2.0.50727; Tablet PC 2.0; rv:11.0) like Gecko",
};

describe("SDK — classeAppareil(ua, points tactiles)", () => {
  it.each([
    ["iPad sous iPadOS 13+ (Safari, Macintosh tactile)", UA.ipadOs17Safari, 5, "tablet"],
    ["iPad sous iPadOS 13+ (Chrome, Macintosh tactile)", UA.ipadOs17Chrome, 5, "tablet"],
    ["Mac (Macintosh, sans écran tactile)", UA.ipadOs17Safari, 0, "desktop"],
    ["Mac et un seul point tactile (pavé, stylet) : pas une tablette", UA.ipadOs17Safari, 1, "desktop"],
    ["iPad antérieur à iPadOS 13", UA.ipad12, 5, "tablet"],
    ["iPhone", UA.iphone, 5, "mobile"],
    ["tablette Android (sans « Mobile »)", UA.androidTablette, 10, "tablet"],
    ["téléphone Android", UA.androidTelephone, 10, "mobile"],
    ["Firefox tablette Android", UA.firefoxTablette, 10, "tablet"],
    ["Firefox téléphone Android", UA.firefoxTelephone, 10, "mobile"],
    ["Kindle (Silk)", UA.kindle, 10, "tablet"],
    ["Fire TV : pas une tablette, rangé comme avant", UA.fireTv, 0, "desktop"],
    ["téléviseur Android : pas une tablette, rangé comme avant", UA.bravia, 0, "desktop"],
    ["Windows tactile : un ordinateur", UA.windows, 10, "desktop"],
    ["« Tablet PC 2.0 » de l'ancien Internet Explorer : un ordinateur", UA.windowsTabletPc, 0, "desktop"],
  ])("%s", (_nom, ua, points, attendu) => {
    expect(classeAppareil(ua, points)).toBe(attendu);
  });
});

describe("ingestion — l'indice « tablet » l'emporte sur la lecture « desktop » d'un Macintosh, et sur elle seule", () => {
  const lire = (ua: string, indice?: string) => clientDimensions(ua)(indice);

  it("Macintosh + indice tablet : tablette sous iOS, version du système inconnue (figée à 10_15_7)", () => {
    expect(lire(UA.ipadOs17Safari, "tablet")).toEqual({
      browser: "Safari", browser_version: "17", os: "iOS", os_version: null, device_type: "tablet",
    });
    expect(lire(UA.ipadOs17Chrome, "tablet")).toMatchObject({ browser: "Chrome", os: "iOS", device_type: "tablet" });
  });

  it("Macintosh sans indice, ou avec l'indice desktop d'un SDK antérieur : un Mac, comme avant", () => {
    expect(lire(UA.ipadOs17Safari)).toMatchObject({ os: "macOS", device_type: "desktop" });
    expect(lire(UA.ipadOs17Safari, "desktop")).toMatchObject({ os: "macOS", device_type: "desktop" });
    expect(lire(UA.ipadOs17Safari, "mobile")).toMatchObject({ os: "macOS", device_type: "desktop" });
  });

  it("ailleurs l'user-agent prime toujours : l'indice tablet ne fait pas d'un Windows ni d'un iPhone une tablette", () => {
    expect(lire(UA.windows, "tablet")).toMatchObject({ os: "Windows", device_type: "desktop" });
    expect(lire(UA.iphone, "tablet")).toMatchObject({ os: "iOS", device_type: "mobile" });
    expect(lire(UA.androidTelephone, "tablet")).toMatchObject({ os: "Android", device_type: "mobile" });
  });

  it("un téléviseur reste hors des trois classes quand son user-agent le dit", () => {
    expect(lire(UA.fireTv).device_type).toBeNull();
  });
});

describe("couture — un iPad récent, de l'indice du SDK à la session écrite", () => {
  it("le pageview d'un iPad sous iPadOS 13+ ouvre une session tablette", () => {
    const debut = 1_800_000_000_000;
    const corps = buildResourceSpans(
      { "mip.app_id": "demo", "mip.user_agent": UA.ipadOs17Safari },
      [{
        name: "pageview",
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        startTime: msToHr(debut),
        endTime: msToHr(debut),
        attributes: {
          "mip.session_id": "sess-ipad",
          "mip.route": "/",
          "mip.url": "https://app.test/",
          "mip.device_type": classeAppareil(UA.ipadOs17Safari, 5),
        },
      }],
    );
    const { sessions } = flattenOtlp(corps, { now: debut + 1_000 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ device_type: "tablet", os: "iOS", browser: "Safari" });
  });
});
