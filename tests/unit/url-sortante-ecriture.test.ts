// P1 — les URL sortantes jugées À L'ÉCRITURE : checks uptime, webhook d'une
// règle, cible d'un canal.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Qu'un administrateur enregistre une sonde ou un webhook vers les
//     métadonnées cloud, le réseau privé Railway ou la boucle locale, et ne
//     l'apprenne qu'au premier tick (ou jamais) ;
//   - que le refus sorte en exception : en production, Next la remplace par
//     l'écran d'erreur générique, sans dire quoi corriger. Il sort en redirection
//     portant un CODE, que la page traduit par `motifDeRefus`.
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `next` est une dépendance de la CONSOLE : ses modules se simulent par leur chemin
// résolu depuis `apps/console`, comme dans alert-actions-release.test.ts.
const depuisConsole = createRequire(`${process.cwd()}/apps/console/package.json`);
vi.doMock(depuisConsole.resolve("next/navigation"), () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECTION ${url}`);
  },
}));
vi.doMock(depuisConsole.resolve("next/cache"), () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/next-cache", () => ({ revalidatePath: vi.fn() }));
// C8 : les actions passent par leurs commandes — la session vient de `getUser`, l'écriture
// et son audit d'une transaction (un client inerte ici).
vi.mock("@/lib/auth", () => ({
  getUser: vi.fn(async () => ({ email: "admin@exemple.test", role: "admin", apps: null })),
  requireAdmin: vi.fn(async () => ({ email: "admin@exemple.test", role: "admin", apps: null })),
}));
vi.mock("@/lib/db", () => ({ q: vi.fn(async () => []), tx: vi.fn(async (fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })) }));
vi.mock("@/lib/queries-uptime", () => ({
  createUptimeCheck: vi.fn(),
  deleteUptimeCheck: vi.fn(),
  toggleUptimeCheck: vi.fn(),
}));
vi.mock("@/lib/queries-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries-v2")>();
  return { ...actual, insertAlertRule: vi.fn(), updateAlertRule: vi.fn(), appDeRegle: vi.fn() };
});
vi.mock("@/lib/queries-alerting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries-alerting")>();
  return { ...actual, insertChannel: vi.fn() };
});

const { createUptimeCheckAction } = await import("@/app/admin/uptime/actions");
const { createChannelAction, createRuleAction, updateRuleAction } = await import("@/app/alerts/actions");
const { createUptimeCheck } = await import("@/lib/queries-uptime");
const { insertAlertRule, updateAlertRule } = await import("@/lib/queries-v2");
const { insertChannel } = await import("@/lib/queries-alerting");
const { motifDeRefus } = await import("../../packages/backend/lib/net/safe-fetch.mjs");

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

const check = (url: string) => formulaire({ app: "app-a", name: "Accueil", url, expect_status: "200" });
const canal = (target: string, kind = "webhook") => formulaire({ kind, target, severity_min: "warning", app_id: "app-a" });
const regle = (webhook_url: string, extra: Record<string, string> = {}) =>
  formulaire({
    app_id: "app-a",
    metric: "LCP",
    comparator: ">",
    threshold: "2500",
    window_minutes: "15",
    mode: "threshold",
    severity: "warning",
    webhook_url,
    ...extra,
  });

/** Le code porté par la redirection de refus, après vérification qu'il se traduit. */
async function codeDeRefus(promesse: Promise<unknown>, page: string): Promise<string> {
  const err = (await promesse.then(
    () => null,
    (e: unknown) => e,
  )) as Error | null;
  const m = err?.message.match(new RegExp(`^REDIRECTION ${page}\\?url_refusee=([a-z_]+)$`));
  expect(m, err?.message ?? "aucune redirection").not.toBeNull();
  const code = m![1];
  expect(motifDeRefus(code)).toMatch(/\S/);
  return code;
}

afterEach(() => vi.clearAllMocks());

describe("uptime — l'URL d'un check est jugée à l'écriture", () => {
  it("refuse les métadonnées cloud, littérales ou en IPv6 mappée, et 10.0.0.1", async () => {
    expect(await codeDeRefus(createUptimeCheckAction(check("http://169.254.169.254/latest/meta-data/")), "/admin/uptime")).toBe("ip_litterale");
    expect(await codeDeRefus(createUptimeCheckAction(check("http://[::ffff:169.254.169.254]/")), "/admin/uptime")).toBe("ip_litterale");
    expect(await codeDeRefus(createUptimeCheckAction(check("http://10.0.0.1/")), "/admin/uptime")).toBe("ip_litterale");
    expect(createUptimeCheck).not.toHaveBeenCalled();
  });

  it("refuse *.railway.internal, localhost et un nom sans domaine", async () => {
    for (const url of ["http://postgres.railway.internal:5432/", "http://localhost:3000/", "http://collector:4318/"]) {
      expect(await codeDeRefus(createUptimeCheckAction(check(url)), "/admin/uptime"), url).toBe("hote_interne");
    }
    expect(createUptimeCheck).not.toHaveBeenCalled();
  });

  it("refuse un autre protocole avec son motif, et garde l'erreur de champ manquant", async () => {
    expect(await codeDeRefus(createUptimeCheckAction(check("ftp://exemple.fr/")), "/admin/uptime")).toBe("protocole");
    await expect(createUptimeCheckAction(check(""))).rejects.toThrow("REDIRECTION /admin/uptime?error=1");
  });

  it("enregistre une URL publique", async () => {
    await expect(createUptimeCheckAction(check("https://exemple.fr/health"))).rejects.toThrow("REDIRECTION /admin/uptime");
    expect(createUptimeCheck).toHaveBeenCalledWith("app-a", "Accueil", "https://exemple.fr/health", 200, expect.anything());
  });
});

describe("alertes — webhook de règle et cible de canal jugés à l'écriture", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuse un canal webhook ou Slack vers une IP privée ou un nom interne", async () => {
    expect(await codeDeRefus(createChannelAction(canal("http://10.0.0.1/hook")), "/alerts")).toBe("ip_litterale");
    expect(await codeDeRefus(createChannelAction(canal("https://api.railway.internal/x", "slack")), "/alerts")).toBe("hote_interne");
    expect(insertChannel).not.toHaveBeenCalled();
  });

  it("n'applique pas le contrôle d'URL à un canal e-mail, et enregistre un webhook public", async () => {
    await createChannelAction(canal("ops@exemple.fr", "email"));
    await createChannelAction(canal("https://hooks.slack.com/services/T0/B0/x", "slack"));
    expect(insertChannel).toHaveBeenCalledTimes(2);
  });

  it("refuse le webhook d'une règle, à la création comme à l'édition", async () => {
    expect(await codeDeRefus(createRuleAction(regle("http://localhost:9000/hook")), "/alerts")).toBe("hote_interne");
    expect(await codeDeRefus(updateRuleAction(regle("http://[::ffff:169.254.169.254]/", { id: "7" })), "/alerts")).toBe("ip_litterale");
    expect(insertAlertRule).not.toHaveBeenCalled();
    expect(updateAlertRule).not.toHaveBeenCalled();
  });

  it("enregistre une règle au webhook public, ou sans webhook", async () => {
    await createRuleAction(regle("https://hooks.slack.com/services/T0/B0/x"));
    await createRuleAction(regle(""));
    expect(insertAlertRule).toHaveBeenCalledTimes(2);
    expect(vi.mocked(insertAlertRule).mock.calls.map(([r]) => r.webhook_url)).toEqual([
      "https://hooks.slack.com/services/T0/B0/x",
      null,
    ]);
  });
});
