// Détection de bots à l'ingestion — classifieur pur (shared/bots.mjs).
import { describe, expect, it } from "vitest";
import { isBot } from "../../packages/backend/shared/bots.mjs";

const REAL_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const REAL_SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("isBot", () => {
  it("ne flague pas les vrais navigateurs", () => {
    expect(isBot(REAL_CHROME)).toBe(false);
    expect(isBot(REAL_SAFARI_IOS)).toBe(false);
  });

  it("flague les navigateurs headless / automatisés", () => {
    expect(isBot("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/126.0.0.0 Safari/537.36")).toBe(true);
    expect(isBot("Mozilla/5.0 ... PhantomJS/2.1.1")).toBe(true);
    expect(isBot("Lighthouse")).toBe(true);
  });

  it("flague les crawlers moteurs & réseaux sociaux", () => {
    expect(isBot("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(true);
  });

  it("flague les moniteurs synthétiques et clients non-navigateur", () => {
    expect(isBot("Pingdom.com_bot_version_1.4")).toBe(true);
    expect(isBot("python-requests/2.31.0")).toBe(true);
    expect(isBot("curl/8.4.0")).toBe(true);
    expect(isBot("Go-http-client/1.1")).toBe(true);
  });

  it("respecte le signal webdriver explicite", () => {
    expect(isBot(REAL_CHROME, true)).toBe(true);
    expect(isBot(REAL_CHROME, "true")).toBe(true);
    expect(isBot(REAL_CHROME, false)).toBe(false);
  });

  it("UA absent/invalide -> pas un bot (on ne suppose rien)", () => {
    expect(isBot(null)).toBe(false);
    expect(isBot(undefined)).toBe(false);
    expect(isBot("")).toBe(false);
    expect(isBot(42 as unknown as string)).toBe(false);
  });
});
