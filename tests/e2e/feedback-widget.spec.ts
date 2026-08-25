// E2E du widget d'avis (CSAT) — les 5 critères d'acceptation du 11/08/2026.
//
// Le test pilote le fichier RÉELLEMENT déployé (apps/console/public/mip-rum-feedback.js,
// servi par la démo) au-dessus du SDK fraîchement buildé, et lit ce qui part
// vraiment sur le réseau. Un test de source ne pourrait pas prouver ces
// propriétés : les deux défauts d'origine étaient des défauts de comportement au
// clic, invisibles à la lecture du fichier.
import { expect, test, type Page } from "@playwright/test";

/** Avis capturés sur le fil OTLP, décodés depuis l'attribut `mip.props`. */
type Feedback = { score: number | null; comment: string; route: string };

interface Wire {
  feedbacks: Feedback[];
  frustrations: { kind: string; target: string }[];
}

/**
 * Charge la démo + le widget, et intercepte l'ingestion pour lire les spans.
 * On n'écrit pas en base ici : l'objet du test est ce que le NAVIGATEUR émet.
 */
async function mount(page: Page, config: Record<string, unknown> = {}): Promise<Wire> {
  const wire: Wire = { feedbacks: [], frustrations: [] };

  await page.route("**/v1/traces", async (route) => {
    const body = route.request().postData() ?? "{}";
    const spans =
      JSON.parse(body).resourceSpans?.flatMap((rs: any) =>
        rs.scopeSpans.flatMap((ss: any) => ss.spans),
      ) ?? [];
    for (const s of spans) {
      const a = Object.fromEntries(
        s.attributes.map((x: any) => [x.key, Object.values(x.value)[0]]),
      );
      if (s.name === "track.feedback") wire.feedbacks.push(JSON.parse(a["mip.props"]));
      if (s.name === "frustration") {
        wire.frustrations.push({
          kind: a["frustration.kind"],
          target: a["frustration.target"],
        });
      }
    }
    await route.fulfill({
      status: 200,
      body: "{}",
      headers: { "access-control-allow-origin": "*" },
    });
  });

  await page.goto("http://localhost:8080/dashboard", { waitUntil: "load" });
  await page.evaluate((cfg) => {
    (window as any).MIPRumFeedback = cfg;
  }, config);
  await page.addScriptTag({ url: "/mip-rum-feedback.js" });
  await page.waitForSelector('button[aria-label="Votre avis ?"]');
  return wire;
}

/** Laisse partir le lot de spans (le SDK batche) avant de lire le fil. */
async function settle(page: Page) {
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).MIPRum.flush());
  await page.waitForTimeout(200);
}

const OPEN = 'button[aria-label="Votre avis ?"]';
const CANCEL = 'button[aria-label="Fermer sans envoyer"]';
const CLOSE_DONE = 'button[aria-label="Fermer la confirmation"]';
const COMMENT = "Le tableau de bord met du temps à charger le matin.";

test("critère 1 — note ET commentaire : le commentaire complet part avec l'avis", async ({
  page,
}) => {
  const wire = await mount(page);
  await page.click(OPEN);
  await page.click('button[aria-label="4 sur 5"]');
  await page.locator("textarea").type(COMMENT, { delay: 10 });
  await page.click('button:has-text("Envoyer")');
  await settle(page);

  expect(wire.feedbacks).toEqual([{ score: 4, comment: COMMENT, route: "/dashboard" }]);
});

test("critère 1 bis — le commentaire survit à un ré-rendu de l'application hôte", async ({
  page,
}) => {
  // Le défaut d'origine : le texte ne vivait que dans le nœud <textarea>. Ici
  // l'application hôte remanie le DOM pendant la saisie — le brouillon en mémoire
  // doit rendre l'avis insensible à ces remaniements.
  const wire = await mount(page);
  await page.click(OPEN);
  await page.click('button[aria-label="2 sur 5"]');
  await page.locator("textarea").type(COMMENT, { delay: 5 });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("afterbegin", "<div>données chargées</div>");
  });
  await page.click('button:has-text("Envoyer")');
  await settle(page);

  expect(wire.feedbacks).toEqual([{ score: 2, comment: COMMENT, route: "/dashboard" }]);
});

test("critère 2 — note seule : comment vaut \"\" et l'événement part quand même", async ({
  page,
}) => {
  const wire = await mount(page);
  await page.click(OPEN);
  await page.click('button[aria-label="5 sur 5"]');
  await page.click('button:has-text("Envoyer")');
  await settle(page);

  expect(wire.feedbacks).toEqual([{ score: 5, comment: "", route: "/dashboard" }]);
});

test("chemin inverse — commentaire sans note : part avec score null", async ({ page }) => {
  // Décision produit : le verbatim est le signal le plus riche, on ne le jette
  // pas au motif qu'il manque un scalaire. La console exclut déjà les scores
  // nuls de ses moyennes CSAT, l'agrégat n'est donc pas faussé.
  const wire = await mount(page);
  await page.click(OPEN);
  await page.locator("textarea").type(COMMENT, { delay: 5 });
  await page.click('button:has-text("Envoyer")');
  await settle(page);

  expect(wire.feedbacks).toEqual([{ score: null, comment: COMMENT, route: "/dashboard" }]);
});

test("ni note ni commentaire : rien n'est émis, et le widget le dit", async ({ page }) => {
  const wire = await mount(page);
  await page.click(OPEN);
  await page.click('button:has-text("Envoyer")');
  await settle(page);

  expect(wire.feedbacks).toEqual([]);
  await expect(page.getByText(/Choisissez une note, ou laissez un commentaire/)).toBeVisible();
});

test("critère 3 — l'accusé de réception reste affiché jusqu'à ce que l'utilisateur le ferme", async ({
  page,
}) => {
  // cooldownDays: 0 — ce test porte sur le CYCLE DE VIE de la confirmation, pas
  // sur la période de silence (couverte par feedback-cooldown.spec.ts). Sans ça,
  // le lanceur ne reviendrait pas après fermeture, et on mélangerait deux sujets.
  const wire = await mount(page, { cooldownDays: 0 });
  await page.click(OPEN);
  await page.click('button[aria-label="5 sur 5"]');
  await page.click('button:has-text("Envoyer")');

  const merci = page.getByText(/votre avis a bien été envoyé/i);
  await expect(merci).toBeVisible();
  // Le défaut d'origine : la confirmation s'effaçait seule au bout de 1,4 s.
  await page.waitForTimeout(3000);
  await expect(merci).toBeVisible();

  // …et elle ne se ferme que sur action explicite.
  await page.click(CLOSE_DONE);
  await expect(merci).toBeHidden();
  await expect(page.locator(OPEN)).toBeVisible();
  await settle(page);
  expect(wire.feedbacks).toHaveLength(1);
});

test("le widget reste utilisable après un envoi (il n'est pas à usage unique)", async ({
  page,
}) => {
  // cooldownDays: 0 : la propriété testée ici est STRUCTURELLE — le panneau n'est
  // plus détruit à l'envoi (l'ancien `panel.innerHTML = ""` le rendait à usage
  // unique). Le silence est une POLITIQUE par-dessus, désactivable, et testée
  // ailleurs. On neutralise la politique pour éprouver la structure.
  const wire = await mount(page, { cooldownDays: 0 });
  for (const [note, texte] of [
    ["3 sur 5", "premier avis"],
    ["5 sur 5", "second avis"],
  ] as const) {
    await page.click(OPEN);
    await page.click(`button[aria-label="${note}"]`);
    await page.locator("textarea").fill(texte);
    await page.click('button:has-text("Envoyer")');
    await page.click(CLOSE_DONE);
  }
  await settle(page);

  expect(wire.feedbacks).toEqual([
    { score: 3, comment: "premier avis", route: "/dashboard" },
    { score: 5, comment: "second avis", route: "/dashboard" },
  ]);
});

test("une saisie abandonnée ne fuit pas dans l'avis suivant", async ({ page }) => {
  const wire = await mount(page);
  await page.click(OPEN);
  await page.locator("textarea").fill("brouillon abandonné");
  await page.click(CANCEL); // abandon explicite
  await page.click(OPEN);
  await page.click('button[aria-label="1 sur 5"]');
  await page.click('button:has-text("Envoyer")');
  await settle(page);

  expect(wire.feedbacks).toEqual([{ score: 1, comment: "", route: "/dashboard" }]);
});

test("critère 4 — utiliser le widget ne produit aucun clic mort sur le widget", async ({
  page,
}) => {
  // C'est le défaut de MESURE : le détecteur du SDK signalait un frustration.dead
  // sur le bouton du widget lui-même, polluant les métriques de l'app cliente.
  // cooldownDays: 0 pour enchaîner trois cycles complets — c'est la répétition
  // qui rend le faux positif observable.
  const wire = await mount(page, { cooldownDays: 0 });
  for (let i = 0; i < 3; i++) {
    await page.click(OPEN);
    await page.click('button[aria-label="4 sur 5"]');
    await page.locator("textarea").fill("essai " + i);
    await page.click('button:has-text("Envoyer")');
    await page.click(CLOSE_DONE);
  }
  // Au-delà de la fenêtre de détection (DEAD_CLICK_WINDOW_MS = 1500 ms).
  await page.waitForTimeout(2000);
  await settle(page);

  const surLeWidget = wire.frustrations.filter((f) => /Votre avis|★/.test(f.target));
  expect(surLeWidget).toEqual([]);
  expect(wire.feedbacks).toHaveLength(3);
});

test("critère 5 — sur mobile, le panneau tient dans l'écran et l'avis part", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  // offset : le coin bas-droit est partagé avec les pastilles flottantes de
  // l'app hôte ; le widget doit pouvoir s'écarter sans casser sa mise en page.
  const wire = await mount(page, { offset: 72 });

  await page.click(OPEN);
  const boite = await page.locator('[data-mip-rum-ui="feedback-panel"]').boundingBox();
  expect(boite).not.toBeNull();
  expect(boite!.x).toBeGreaterThanOrEqual(0);
  expect(boite!.x + boite!.width).toBeLessThanOrEqual(360);

  await page.click('button[aria-label="5 sur 5"]');
  await page.locator("textarea").fill("depuis mobile");
  await page.click('button:has-text("Envoyer")');
  await settle(page);

  expect(wire.feedbacks).toEqual([
    { score: 5, comment: "depuis mobile", route: "/dashboard" },
  ]);
  await ctx.close();
});

test("le widget ne soumet pas un formulaire de l'application hôte", async ({ page }) => {
  // Applications d'entreprise qui enveloppent toute la page dans un <form> : sans
  // type="button", chaque clic (étoile comprise) la rechargerait et l'avis serait
  // perdu — exactement le symptôme « le widget ne marche pas ».
  const wire = await mount(page);
  await page.evaluate(() => {
    const f = document.createElement("form");
    f.action = "/soumis";
    document.body.appendChild(f);
    for (const sel of ['[data-mip-rum-ui="feedback-button"]', '[data-mip-rum-ui="feedback-panel"]'])
      f.appendChild(document.querySelector(sel)!);
  });
  await page.click(OPEN);
  await page.click('button[aria-label="4 sur 5"]');
  await page.locator("textarea").fill("dans un form hôte");
  await page.click('button:has-text("Envoyer")');
  await settle(page);

  expect(page.url()).toContain("/dashboard");
  expect(wire.feedbacks).toEqual([
    { score: 4, comment: "dans un form hôte", route: "/dashboard" },
  ]);
});
