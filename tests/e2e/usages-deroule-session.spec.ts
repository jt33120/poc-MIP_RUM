// E2E — Déroulé groupé par vue du détail de session (F45, domaine Usages, règle S8).
//
// CE QUE CE SPEC EXISTE POUR PROUVER :
//   - la chronologie n'est plus une liste plate : une SECTION par page vue, ses
//     Web Vitals en pastilles sur son titre, ses phases réseau repliées ;
//   - preuve de fin du lot : plus aucune ligne « Vital RTT » — les phases n'ont
//     plus l'étiquette de nature « Vital » (§ 5.12.6) ;
//   - les effets d'une action sont imbriqués SOUS elle (causalité `action_id`) ;
//   - `voir=erreur` ne montre que les erreurs, et une valeur non déclarée
//     (`voir=error`) est IGNORÉE ET SIGNALÉE, jamais refusée (§ 3.1, règle 3) ;
//   - les tuiles « Pages vues » et « Signaux de frustration » ouvrent le Déroulé
//     filtré sur leur nature ;
//   - B32 non livré : aucun lien mort vers `/errors/<empreinte>` ni
//     `/tracing/<trace>`, et la section dit pourquoi ;
//   - aucun débordement à 390, 768 et 1440 px.
//
// Fichier À PART de `usages-detail-session.spec.ts` (F44) : ce bloc a sa propre
// app, son propre compte et son propre pool — le `afterAll` de F44 ferme le sien.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { compteDedie } from "./helpers/compte-dedie";
import { LARGEURS, debordements } from "./helpers/debordements";

const poolF45 = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/mip_rum",
});
const consoleUrlF45 = process.env.PLAYWRIGHT_CONSOLE_URL ?? "http://localhost:3000";

test.describe("F45 — Détail de session : déroulé groupé par vue", () => {
  const APP_F45 = "f45-e2e-deroule";
  const EMAIL_F45 = "e2e-f45-deroule@mip-rum.local";
  const SESSION = "f45e2e-deroule";
  /** `rum_action.action_id` : 32 hexadécimaux (contrainte v67). */
  const ACTION = "f45e2e".padEnd(31, "0") + "a";
  let motDePasse = "";

  async function menage() {
    for (const t of ["rum_error", "rum_metric", "rum_pageview", "rum_event", "rum_span", "rum_action"])
      await poolF45.query(`delete from ${t} where app_id = $1`, [APP_F45]).catch(() => {});
    await poolF45.query("delete from rum_session where app_id = $1", [APP_F45]);
  }

  async function semer() {
    await poolF45.query(
      "insert into app_registry (app_id, name, active) values ($1, 'Déroulé F45 E2E', true) on conflict (app_id) do update set active = true",
      [APP_F45],
    );
    await menage();
    const t0 = "now() - interval '2 hours'";
    const a = (s: number) => `${t0} + interval '${s} seconds'`;
    await poolF45.query(
      `insert into rum_session (session_id, app_id, device_type, started_at, last_seen_at, page_count)
       values ($1, $2, 'desktop', ${t0}, ${a(300)}, 2)`,
      [SESSION, APP_F45],
    );
    await poolF45.query(
      `insert into rum_pageview (span_id, session_id, app_id, route, started_at, nav_type)
       values ('f45e2epv0', $1, $2, '/', ${t0}, 'navigate'),
              ('f45e2epv1', $1, $2, '/panier', ${a(60)}, 'route-change')`,
      [SESSION, APP_F45],
    );
    // Un Web Vital de « / », et les HUIT phases réseau de la même vue : c'est
    // l'agrégat qui produisait huit lignes « Vital … », dont « Vital RTT ».
    await poolF45.query(
      `insert into rum_metric (span_id, session_id, app_id, route, name, value, rating, ts)
       select 'f45e2em' || g.i, $1, $2, '/', g.nom, g.valeur, g.verdict, ${t0} + g.i * interval '1 second'
         from (values (1, 'LCP', 2100::float, 'good'), (2, 'REDIRECT', 4::float, null),
                      (3, 'DNS', 12::float, null), (4, 'TCP', 9::float, null),
                      (5, 'TLS', 21::float, null), (6, 'REQUEST', 33::float, null),
                      (7, 'RESPONSE', 44::float, null), (8, 'RTT', 55::float, null),
                      (9, 'UNLOAD', 2::float, null)) as g(i, nom, valeur, verdict)`,
      [SESSION, APP_F45],
    );
    // Une action sur /panier et ses deux effets : un appel API en échec et une erreur.
    await poolF45.query(
      `insert into rum_action (action_id, span_id, session_id, app_id, type, name, route, ts)
       values ($1, 'f45e2eac000000aa', $2, $3, 'click', 'Payer', '/panier', ${a(90)})`,
      [ACTION, SESSION, APP_F45],
    );
    await poolF45.query(
      `insert into rum_span (span_id, trace_id, tier, session_id, app_id, route, url, method, status_code, duration_ms, ts, action_id)
       values ('f45e2eapi', 'f45e2etrace', 'front', $1, $2, '/panier', 'https://site.example/api/paiement', 'POST', 500, 180, ${a(91)}, $3)`,
      [SESSION, APP_F45, ACTION],
    );
    await poolF45.query(
      `insert into rum_error (span_id, session_id, app_id, kind, message, error_type, fingerprint, occurrences, route, ts, action_id)
       values ('f45e2eerr', $1, $2, 'error', 'x is undefined', 'TypeError', 'f45-e2e-fp', 3, '/panier', ${a(92)}, $3)`,
      [SESSION, APP_F45, ACTION],
    );
    await poolF45.query(
      `insert into rum_event (span_id, session_id, app_id, route, name, props, ts)
       values ('f45e2efr', $1, $2, '/panier', 'frustration.rage', '{}'::jsonb, ${a(93)})`,
      [SESSION, APP_F45],
    );
  }

  async function connexion(page: Page) {
    await page.goto(`${consoleUrlF45}/login`);
    await page.fill('input[name="email"]', EMAIL_F45);
    await page.fill('input[name="password"]', motDePasse);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
  }

  const adresse = (extra = "") => `${consoleUrlF45}/sessions/${SESSION}?app=${APP_F45}${extra}`;

  test.beforeAll(async () => {
    motDePasse = await compteDedie(poolF45, EMAIL_F45);
    await semer();
  });

  test.afterAll(async () => {
    await menage();
    await poolF45.end();
  });

  test("une section par vue, vitals en pastilles, phases repliées, plus aucune ligne « Vital RTT »", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    const chronologie = page.locator("#chronologie");
    await expect(chronologie.getByTestId("entete-vue")).toHaveCount(2);
    await expect(chronologie.getByTestId("entete-vue").first()).toContainText("/");
    await expect(chronologie.getByTestId("entete-vue").nth(1)).toContainText("/panier");
    await expect(chronologie.getByTestId("pastille-vital").first()).toContainText("LCP");

    const phases = chronologie.getByTestId("phases-reseau");
    await expect(phases).toHaveCount(1);
    await expect(phases.locator("summary")).toHaveText("Phases réseau (8)");
    // Preuve de fin : le RTT n'est plus une ligne étiquetée « Vital ».
    await expect(chronologie.getByText("Vital", { exact: true })).toHaveCount(0);
    await phases.locator("summary").click();
    await expect(phases).toContainText("RTT");
  });

  test("la route d'une vue mène à la même page pour tous les visiteurs", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await expect(
      page.locator("#chronologie").getByTestId("entete-vue").nth(1).getByRole("link"),
    ).toHaveAttribute("href", `/pages?app=${APP_F45}&route=%2Fpanier`);
  });

  test("les effets d'une action sont imbriqués sous elle", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    const effets = page.locator("#chronologie").getByTestId("effets-action");
    await expect(effets).toHaveCount(1);
    await expect(effets).toContainText("POST /api/paiement");
    await expect(effets).toContainText("TypeError");
  });

  test("`voir=erreur` ne montre que les erreurs ; `voir=error` est ignoré et signalé", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse("&voir=erreur"), { waitUntil: "domcontentloaded" });
    const chronologie = page.locator("#chronologie");
    await expect(chronologie).toContainText("TypeError");
    await expect(chronologie.getByTestId("entete-vue")).toHaveCount(0);
    await expect(chronologie.getByTestId("phases-reseau")).toHaveCount(0);
    await expect(chronologie).not.toContainText("frustration.rage");
    await expect(chronologie).not.toContainText("POST /api/paiement");
    // Le filtre ne touche AUCUN chiffre : les comptes d'onglets restent entiers.
    await expect(page.getByTestId("session-tabs").getByRole("link", { name: /^Appels API/ })).toHaveText(
      /Appels API\s\(1\)/,
    );

    // Valeur non déclarée (§ 3.1 nomme les natures en français) : ignorée, dite,
    // et la chronologie reste complète — jamais un refus 400.
    await page.goto(adresse("&voir=error"), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("reglage-ignore").filter({ hasText: "voir=error" })).toHaveCount(1);
    await expect(page.locator("#chronologie").getByTestId("entete-vue")).toHaveCount(2);
  });

  test("les tuiles ouvrent le Déroulé filtré sur leur nature", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    // La tuile EST le lien (`CadreTuile`, F03) : l'attribut se lit sur elle.
    const tuile = (libelle: string) =>
      page.getByTestId("resume-session").locator(`[data-testid="kpi-tile"][aria-label^="${libelle}"]`);
    await expect(tuile("Pages vues")).toHaveAttribute("href", /voir=vue/);
    await expect(tuile("Signaux de frustration")).toHaveAttribute("href", /voir=frustration/);

    await page.goto(adresse("&voir=frustration"), { waitUntil: "domcontentloaded" });
    await expect(page.locator("#chronologie")).toContainText("frustration.rage");
    await expect(page.locator("#chronologie")).not.toContainText("TypeError");
  });

  test("B32 non livré : aucun lien mort vers l'erreur groupée ni vers la trace, et la raison est dite", async ({ page }) => {
    await connexion(page);
    await page.goto(adresse(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("liens-sortants-b32")).toContainText("non disponibles");
    const chronologie = page.locator("#chronologie");
    await expect(chronologie.locator('a[href*="/errors/"]')).toHaveCount(0);
    await expect(chronologie.locator('a[href*="/tracing/"]')).toHaveCount(0);
  });

  test("aucun débordement horizontal à 390, 768 et 1440 px", async ({ page }) => {
    await connexion(page);
    const fautes: string[] = [];
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      for (const extra of ["", "&voir=erreur"]) {
        await page.goto(adresse(extra), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("deroule-filtres")).toBeVisible();
        for (const f of await debordements(page)) fautes.push(`déroulé${extra} @ ${largeur} px — ${f}`);
      }
    }
    expect(fautes).toEqual([]);
  });
});
