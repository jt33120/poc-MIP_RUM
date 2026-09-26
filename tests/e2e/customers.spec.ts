// E2E v0.5 : onboarding client bout-en-bout — création via /admin/customers,
// clé d'API one-shot, snippet généré, puis ingestion réelle au nom du nouveau
// client et checklist du wizard qui passe au vert (CORS dynamique inclus côté
// dev-server : l'origine vient de la base, pas du code).
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";

const APP_ID = "client-pilote-e2e";
const ORIGIN = "http://localhost:9999";

// utilisateur admin DÉDIÉ à ce spec (même motif que tracing.spec.ts : les spec
// files tournent en parallèle, seed-admin régénérerait le mdp de julian@ en course)
const E2E_EMAIL = "e2e-customers@mip-rum.local";
const E2E_PASSWORD = "e2e-customers-mdp-local";

function bcryptHash(password: string): string {
  return execFileSync(
    "node",
    [
      "-e",
      `const { createRequire } = require("node:module");
       const req = createRequire(process.cwd() + "/apps/console/package.json");
       const m = req("bcryptjs");
       const bcrypt = m.hashSync ? m : m.default;
       process.stdout.write(bcrypt.hashSync(process.argv[1], 4));`,
      password,
    ],
    { encoding: "utf8" },
  );
}

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});

test.beforeAll(async () => {
  await pool.query(
    `insert into console_user (email, password_hash, role, apps, active)
     values ($1, $2, 'admin', null, true)
     on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
    [E2E_EMAIL, bcryptHash(E2E_PASSWORD)],
  );
  // re-runnable : purge l'app e2e et ses données
  await pool.query(`delete from rum_metric where app_id = $1`, [APP_ID]);
  await pool.query(`delete from rum_span where app_id = $1`, [APP_ID]);
  await pool.query(`delete from rum_session where app_id = $1`, [APP_ID]);
  await pool.query(`delete from app_registry where app_id = $1`, [APP_ID]);
});

test.afterAll(() => pool.end());

async function loginConsole(page: Page) {
  await page.goto("http://localhost:3000/login");
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
}

/** Batch OTLP minimal au nom du client créé : 1 session + 1 LCP. */
function otlpFixture(apiKey: string, sessionId: string) {
  const span = (name: string, attrs: Record<string, unknown>) => ({
    traceId: randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    name,
    kind: 1,
    startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
    endTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
    attributes: Object.entries(attrs).map(([key, value]) => ({
      key,
      value:
        typeof value === "number"
          ? Number.isInteger(value)
            ? { doubleValue: value } // webvital.value attendu en number
            : { doubleValue: value }
          : { stringValue: String(value) },
    })),
  });
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "mip.app_id", value: { stringValue: APP_ID } },
            { key: "mip.api_key", value: { stringValue: apiKey } },
            { key: "mip.client_id", value: { stringValue: "e2e" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "mip-rum-sdk", version: "e2e" },
            spans: [
              span("webvital.LCP", {
                "mip.session_id": sessionId,
                "mip.route": "/accueil",
                "webvital.name": "LCP",
                "webvital.value": 1234.5,
              }),
            ],
          },
        ],
      },
    ],
  };
}

test("onboarding : créer un client -> clé one-shot -> snippet -> données reçues -> live", async ({
  page,
  request,
}) => {
  await loginConsole(page);

  // 1. création depuis la liste
  await page.goto("http://localhost:3000/admin/customers");
  await page.fill('input[name="name"]', "Client Pilote E2E");
  await page.fill('input[name="app_id"]', APP_ID);
  await page.fill('input[name="client_id"]', "e2e");
  await page.fill('textarea[name="origins"]', `${ORIGIN}, https://app.pilote.fr`);
  await page.click('form[data-testid="create-customer-form"] button[type="submit"]');

  // 2. wizard : clé affichée UNE fois
  await page.waitForURL((u) => u.pathname === `/admin/customers/${APP_ID}`, { timeout: 15_000 });
  const key = (await page.getByTestId("generated-key").textContent())?.trim() ?? "";
  expect(key).toMatch(/^mip_[0-9a-f]{32}$/);

  // le snippet généré contient l'app_id et jamais la clé réelle
  const snippetBlock = page.locator("pre code").first();
  await expect(snippetBlock).toContainText(`appId: "${APP_ID}"`);
  await expect(snippetBlock).toContainText("COLLE_ICI_LA_CLE_API");
  await expect(snippetBlock).not.toContainText(key);

  // checklist : tout en attente, badge « intégration en cours »
  await expect(page.getByTestId("live-badge")).toContainText("intégration en cours");

  // recharge sans le token : la clé n'est plus affichable (one-shot)
  await page.goto(page.url());
  await expect(page.getByTestId("generated-key")).toHaveCount(0);

  // 3. la base porte bien l'origine ajoutée via le formulaire (CORS dynamique) :
  // le dev-server la lit d'app_registry (cache 60 s) — vérité côté données
  const { rows: reg } = await pool.query(
    `select allowed_origins from app_registry where app_id = $1`,
    [APP_ID],
  );
  expect(reg[0].allowed_origins).toContain(ORIGIN);
  expect(reg[0].allowed_origins).toContain("https://app.pilote.fr");

  // 4. ingestion réelle au nom du client (clé fournie) puis checklist verte
  const sessionId = `e2e-onboarding-${Date.now()}`;
  const res = await request.post("http://localhost:4318/v1/traces", {
    data: otlpFixture(key, sessionId),
    headers: { "content-type": "application/json", origin: ORIGIN },
  });
  expect(res.ok()).toBeTruthy();

  // le metric arrive en base
  await expect
    .poll(
      async () =>
        (await pool.query(`select count(*)::int as n from rum_metric where app_id = $1`, [APP_ID]))
          .rows[0].n,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // 5. la checklist passe au vert (snippet + trafic => live)
  await page.goto(`http://localhost:3000/admin/customers/${APP_ID}`);
  await expect(page.getByTestId("live-badge")).toContainText("live");
  const checklist = page.getByTestId("onboarding-checklist");
  await expect(checklist).toContainText("Premières Web Vitals reçues");
  await expect(checklist.locator("text=✅").first()).toBeVisible();
});

test("onboarding : lien « accès client » préremplit le viewer scopé", async ({ page }) => {
  await loginConsole(page);
  await page.goto(`http://localhost:3000/admin/customers/${APP_ID}`);
  await page.getByRole("link", { name: /compte viewer/i }).click();
  await page.waitForURL((u) => u.pathname === "/admin/users");
  await expect(page.locator('input[name="apps"]')).toHaveValue(APP_ID);
});

// Recette du 26/09/2026 (revues E et F) : les gestes qui ne se défont pas se
// confirment DANS la page — un clic déplie un encadré qui nomme la cible, un
// second envoie. Sans navigateur, les tests unitaires ne voient que le HTML fermé :
// le focus, Échap et l'envoi du formulaire parent ne s'éprouvent qu'ici.
test("désactiver une application : confirmation sur place, Échap et « Annuler » n'envoient rien", async ({ page }) => {
  await loginConsole(page);
  await page.goto("http://localhost:3000/admin/customers");
  const ligne = page.getByTestId(`customer-${APP_ID}`);
  const declencheur = page.getByTestId(`desactiver-${APP_ID}`);
  const actif = async () =>
    (await pool.query<{ active: boolean }>(`select active from app_registry where app_id = $1`, [APP_ID])).rows[0].active;

  // Le premier clic n'envoie rien : il déplie l'encadré, qui prend le focus.
  await declencheur.click();
  const encadre = page.getByRole("group", { name: /Désactiver l.application «\s*Client Pilote E2E\s*»/ });
  await expect(encadre).toBeVisible();
  await expect(encadre).toBeFocused();
  await expect(declencheur).toHaveAttribute("aria-expanded", "true");

  // Échap referme et rend le focus au déclencheur.
  await page.keyboard.press("Escape");
  await expect(encadre).toBeHidden();
  await expect(declencheur).toBeFocused();

  // « Annuler » referme sans rien envoyer.
  await declencheur.click();
  await encadre.getByRole("button", { name: "Annuler" }).click();
  await expect(encadre).toBeHidden();
  expect(await actif()).toBe(true);

  // La confirmation envoie le formulaire parent, champs cachés compris.
  await declencheur.click();
  await page.getByTestId(`desactiver-${APP_ID}-confirmer`).click();
  const reactiver = ligne.getByRole("button", { name: "Activer", exact: true });
  await expect(reactiver).toBeVisible();
  expect(await actif()).toBe(false);

  // Réactiver ne coupe rien : un seul clic.
  await reactiver.click();
  await expect(ligne.getByTestId(`desactiver-${APP_ID}`)).toBeVisible();
  expect(await actif()).toBe(true);
});

test("régénérer la clé d'API : confirmée, la nouvelle clé s'affiche une fois", async ({ page }) => {
  await loginConsole(page);
  await page.goto(`http://localhost:3000/admin/customers/${APP_ID}`);
  const { rows: [avant] } = await pool.query<{ api_key_hash: string }>(`select api_key_hash from app_registry where app_id = $1`, [APP_ID]);

  await page.getByTestId("regenerer-cle").click();
  await expect(page.getByRole("group", { name: /Régénérer la clé d.API de «\s*Client Pilote E2E\s*»/ })).toBeVisible();
  // Rien n'est parti au premier clic.
  const { rows: [pendant] } = await pool.query<{ api_key_hash: string }>(`select api_key_hash from app_registry where app_id = $1`, [APP_ID]);
  expect(pendant.api_key_hash).toBe(avant.api_key_hash);

  await page.getByTestId("regenerer-cle-confirmer").click();
  await expect(page.getByTestId("generated-key")).toHaveText(/^mip_[0-9a-f]{32}$/);
  const { rows: [apres] } = await pool.query<{ api_key_hash: string }>(`select api_key_hash from app_registry where app_id = $1`, [APP_ID]);
  expect(apres.api_key_hash).not.toBe(avant.api_key_hash);
});

test("utilisateurs : « Désactiver » est grisé sur son propre compte, et dit pourquoi", async ({ page }) => {
  await loginConsole(page);
  await page.goto("http://localhost:3000/admin/users");
  const soi = page.getByTestId(`desactiver-${E2E_EMAIL}`);
  // `aria-disabled` (pas `disabled`) : le bouton reste focalisable, Playwright le tient pour inactif.
  await expect(soi).toHaveAttribute("aria-disabled", "true");
  await expect(soi).toBeDisabled();
  await expect(soi).not.toHaveAttribute("aria-expanded");
  await expect(soi).toHaveAttribute("title", "Vous ne pouvez pas désactiver votre propre compte.");
  // Au toucher (pas d'infobulle) : un appui affiche la raison, jusque-là réservée au lecteur d'écran.
  const raison = page.getByText("Vous ne pouvez pas désactiver votre propre compte.");
  await expect(raison).toHaveClass(/sr-only/);
  await soi.click({ force: true });
  await expect(raison).not.toHaveClass(/sr-only/);
  // Aucun encadré ne s'ouvre, rien n'est envoyé.
  await expect(page.getByRole("group", { name: /Désactiver le compte/ })).toHaveCount(0);
});
