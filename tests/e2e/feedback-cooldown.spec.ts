// E2E de la PÉRIODE DE SILENCE du widget d'avis — les 5 critères du 14/08/2026.
//
// Le défaut : le widget n'avait aucune mémoire des avis déjà donnés. L'utilisateur
// de gip-plateforme a répondu, puis a retrouvé le bouton orange à chaque page.
//
// Ces propriétés portent sur ce que le navigateur PERSISTE et sur ce qui est monté
// au chargement suivant : elles ne sont démontrables qu'en pilotant un vrai
// navigateur, avec un vrai localStorage, sur le fichier réellement servi.
import { expect, test, type Page } from "@playwright/test";

const OPEN = 'button[aria-label="Votre avis ?"]';
const CANCEL = 'button[aria-label="Fermer sans envoyer"]';
const CLOSE_DONE = 'button[aria-label="Fermer la confirmation"]';
const JOUR_MS = 86_400_000;

/** Charge la démo, configure le widget, l'injecte, et neutralise l'ingestion. */
async function load(page: Page, cfg: Record<string, unknown> = {}) {
  await page.route("**/v1/traces", (r) =>
    r.fulfill({ status: 200, body: "{}", headers: { "access-control-allow-origin": "*" } }),
  );
  await page.goto("http://localhost:8080/dashboard", { waitUntil: "load" });
  await page.evaluate((c) => {
    (window as any).MIPRumFeedback = c;
  }, cfg);
  await page.addScriptTag({ url: "/mip-rum-feedback.js" });
  await page.waitForTimeout(150);
}

/** Parcours complet : ouvrir, noter, envoyer, fermer la confirmation. */
async function donnerUnAvis(page: Page) {
  await page.click(OPEN);
  await page.click('button[aria-label="5 sur 5"]');
  await page.click('button:has-text("Envoyer")');
  await expect(page.getByText(/votre avis a bien été envoyé/i)).toBeVisible();
  await page.click(CLOSE_DONE);
}

const visible = (page: Page) => page.locator(OPEN).isVisible();
const cle = (appId: string) => `mip_rum_feedback_last:${appId}`;

test("critère 1 — après un avis envoyé, le bouton disparaît et ne revient pas au rechargement", async ({
  page,
}) => {
  await load(page, { appId: "app-a" });
  expect(await visible(page)).toBe(true);

  await donnerUnAvis(page);
  expect(await visible(page)).toBe(false); // retiré sans attendre le rechargement

  await load(page, { appId: "app-a" });
  expect(await visible(page)).toBe(false);
});

test("critère 2 — passé le délai, le bouton réapparaît", async ({ page }) => {
  await load(page, { appId: "app-a", cooldownDays: 60 });
  await donnerUnAvis(page);

  // On avance l'horloge en vieillissant l'horodatage persisté : c'est
  // exactement la donnée dont dépend la décision, et le test reste instantané.
  await page.evaluate(
    ([k, ms]) => localStorage.setItem(k as string, String(Date.now() - (ms as number))),
    [cle("app-a"), 61 * JOUR_MS],
  );
  await load(page, { appId: "app-a", cooldownDays: 60 });
  expect(await visible(page)).toBe(true);
});

test("critère 2 bis — juste avant l'échéance, il se tait encore", async ({ page }) => {
  await load(page, { appId: "app-a", cooldownDays: 60 });
  await donnerUnAvis(page);
  await page.evaluate(
    ([k, ms]) => localStorage.setItem(k as string, String(Date.now() - (ms as number))),
    [cle("app-a"), 59 * JOUR_MS],
  );
  await load(page, { appId: "app-a", cooldownDays: 60 });
  expect(await visible(page)).toBe(false);
});

test("critère 3 — un avis ABANDONNÉ ne déclenche aucun silence", async ({ page }) => {
  await load(page, { appId: "app-a" });
  await page.click(OPEN);
  await page.click('button[aria-label="3 sur 5"]');
  await page.locator("textarea").fill("je change d'avis");
  await page.click(CANCEL); // fermé sans envoyer
  expect(await visible(page)).toBe(true);

  await load(page, { appId: "app-a" });
  expect(await visible(page)).toBe(true);
  expect(await page.evaluate((k) => localStorage.getItem(k), cle("app-a"))).toBeNull();
});

test("critère 4 — deux appId : faire taire l'une n'affecte pas l'autre", async ({ page }) => {
  await load(page, { appId: "app-a" });
  await donnerUnAvis(page);

  await load(page, { appId: "app-b" }); // même navigateur, même origine
  expect(await visible(page)).toBe(true);

  await load(page, { appId: "app-a" });
  expect(await visible(page)).toBe(false);
});

test("critère 5 — localStorage inaccessible : le widget s'affiche et fonctionne", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Navigation privée stricte / stockage bloqué par politique : les DEUX accès
  // lèvent. Le widget ne doit jamais disparaître à cause de ça — dans le doute,
  // on affiche.
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("stockage indisponible");
      },
    });
  });

  const envoyes: unknown[] = [];
  await page.route("**/v1/traces", async (r) => {
    for (const s of JSON.parse(r.request().postData() || "{}").resourceSpans?.flatMap((x: any) =>
      x.scopeSpans.flatMap((y: any) => y.spans),
    ) ?? []) {
      if (s.name === "track.feedback") {
        const a = Object.fromEntries(s.attributes.map((x: any) => [x.key, Object.values(x.value)[0]]));
        envoyes.push(JSON.parse(a["mip.props"]));
      }
    }
    await r.fulfill({ status: 200, body: "{}", headers: { "access-control-allow-origin": "*" } });
  });

  await page.goto("http://localhost:8080/dashboard", { waitUntil: "load" });
  await page.evaluate(() => {
    (window as any).MIPRumFeedback = { appId: "app-a" };
  });
  await page.addScriptTag({ url: "/mip-rum-feedback.js" });
  await page.waitForTimeout(150);

  expect(await visible(page)).toBe(true);
  await donnerUnAvis(page); // l'envoi aboutit malgré l'écriture impossible
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).MIPRum.flush());
  await page.waitForTimeout(300);
  expect(envoyes).toEqual([{ score: 5, comment: "", route: "/dashboard" }]);

  await load(page, { appId: "app-a" }); // rien n'a pu être mémorisé : il revient
  expect(await visible(page)).toBe(true);
  await ctx.close();
});

test("cooldownDays: 0 — aucun silence, le comportement historique est conservé", async ({
  page,
}) => {
  await load(page, { appId: "app-a", cooldownDays: 0 });
  await donnerUnAvis(page);
  expect(await visible(page)).toBe(true);
  await load(page, { appId: "app-a", cooldownDays: 0 });
  expect(await visible(page)).toBe(true);
});

test("once: true — silence définitif, même très longtemps après", async ({ page }) => {
  await load(page, { appId: "app-a", once: true });
  await donnerUnAvis(page);
  await page.evaluate(
    ([k, ms]) => localStorage.setItem(k as string, String(Date.now() - (ms as number))),
    [cle("app-a"), 3650 * JOUR_MS], // dix ans
  );
  await load(page, { appId: "app-a", once: true });
  expect(await visible(page)).toBe(false);
});

test("horodatage dans le FUTUR (horloge reculée) : on affiche plutôt que se taire", async ({
  page,
}) => {
  await load(page, { appId: "app-a" });
  await page.evaluate(
    ([k, ms]) => localStorage.setItem(k as string, String(Date.now() + (ms as number))),
    [cle("app-a"), 400 * JOUR_MS],
  );
  await load(page, { appId: "app-a" });
  expect(await visible(page)).toBe(true);
});

test("valeur de stockage corrompue : on affiche plutôt que se taire", async ({ page }) => {
  await load(page, { appId: "app-a" });
  for (const bidon of ["", "pas-un-nombre", "-1", "0", "NaN"]) {
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k as string, v as string),
      [cle("app-a"), bidon],
    );
    await load(page, { appId: "app-a" });
    expect(await visible(page), `valeur stockée : ${JSON.stringify(bidon)}`).toBe(true);
  }
});

test("le silence est lu via MIPRum.appId() quand la config ne le précise pas", async ({
  page,
}) => {
  // Cas réel des deux intégrations : le widget est posé en <script> nu, sans
  // appId. Il doit alors se cloisonner sur l'appId du SDK (ici "demo-app",
  // celui de la page de démo), et non sur une clé partagée par tout le monde.
  await load(page, {});
  await donnerUnAvis(page);
  const cles = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith("mip_rum_feedback_last:")),
  );
  expect(cles).toEqual(["mip_rum_feedback_last:demo-app"]);
});
