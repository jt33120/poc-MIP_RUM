// L'escalade (migration-v108) s'administre par deux commandes — `creerEtapeEscalade`,
// `supprimerEtapeEscalade` — et l'acquittement garde désormais son heure et son
// auteur. Qui peut, dans quelle portée, ce que le formulaire refuse, et ce qui part
// au journal. Les écritures en base sont simulées ici ; elles sont prouvées sur
// PostgreSQL par `tests/integration/escalade-sql.test.ts` et par la matrice
// d'autorisations (`tests/contract/console-api-authz.test.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const simul = vi.hoisted(() => ({
  user: null as null | { email: string; role: "admin" | "viewer"; apps: string[] | null; demo?: boolean },
  requetes: [] as { texte: string; valeurs?: unknown[] }[],
  v108: true,
  escaladeDisponible: vi.fn(async () => true),
  insertEtapeEscalade: vi.fn(),
  deleteEtapeEscalade: vi.fn(),
}));

/** Le client d'une transaction : il note chaque requête ; l'acquittement touche une ligne. */
const client = {
  query: vi.fn(async (texte: string, valeurs?: unknown[]) => {
    simul.requetes.push({ texte, valeurs });
    if (texte.includes("to_regclass('public.alert_escalation_step')")) return { rows: [{ v108: simul.v108 }], rowCount: 1 };
    if (texte.includes("update alert_event")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }),
};

vi.mock("@/lib/auth", () => ({ getUser: async () => simul.user, requireAdmin: vi.fn() }));
vi.mock("@/lib/next-cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db", () => ({
  // La sonde de l'audit (v90) répond « présente » : la ligne d'audit part dans la transaction.
  q: vi.fn(async (texte: string) => (texte.includes("information_schema.columns") ? [{ ok: true }] : [])),
  tx: vi.fn(async (fn: (c: typeof client) => unknown) => fn(client)),
  pool: {},
}));
vi.mock("@/lib/queries-escalade", async (original) => ({
  ...(await original<object>()),
  escaladeDisponible: simul.escaladeDisponible,
  insertEtapeEscalade: simul.insertEtapeEscalade,
  deleteEtapeEscalade: simul.deleteEtapeEscalade,
}));

const { COMMANDES_CONSOLE } = await import("@/lib/commandes");
const { etapeDesChamps } = await import("@/lib/commandes/alertes");
const { createEscalationStepAction, deleteEscalationStepAction, ackEventAction } = await import("@/app/alerts/actions");
const { redirect } = await import("next/navigation");

const PLATEFORME = { email: "plateforme@mip", role: "admin" as const, apps: null };
const ADMIN_A = { email: "admin-a@mip", role: "admin" as const, apps: ["app-a"] };

const CHAMPS = { app_id: "app-a", severity_min: "warning", level: "2", delay_minutes: "30", channel_id: "12" };

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

const audits = () => simul.requetes.filter((r) => r.texte.startsWith("insert into audit_log")).map((r) => r.valeurs);

beforeEach(() => {
  vi.clearAllMocks();
  simul.requetes = [];
  simul.v108 = true;
  simul.user = ADMIN_A;
  simul.escaladeDisponible.mockResolvedValue(true);
});

describe("une étape lue de son formulaire", () => {
  it("les champs exigés, la relance facultative mais par paire", () => {
    expect(etapeDesChamps(CHAMPS)).toEqual({
      app_id: "app-a",
      severity_min: "warning",
      level: 2,
      delay_minutes: 30,
      channel_id: 12,
      repeat_minutes: null,
      repeat_max: null,
    });
    expect(etapeDesChamps({ ...CHAMPS, app_id: "", repeat_minutes: " 60 ", repeat_max: "4" })).toMatchObject({
      app_id: null,
      repeat_minutes: 60,
      repeat_max: 4,
    });
  });

  it("refusé en toutes lettres, jamais complété en silence", () => {
    expect(() => etapeDesChamps({ ...CHAMPS, level: "" })).toThrow("niveau requis");
    expect(() => etapeDesChamps({ ...CHAMPS, level: "10" })).toThrow("niveau invalide : un entier de 1 à 9");
    expect(() => etapeDesChamps({ ...CHAMPS, level: "1.5" })).toThrow(/niveau invalide/);
    expect(() => etapeDesChamps({ ...CHAMPS, delay_minutes: "" })).toThrow("délai requis");
    expect(() => etapeDesChamps({ ...CHAMPS, delay_minutes: "-5" })).toThrow(/délai invalide/);
    expect(() => etapeDesChamps({ ...CHAMPS, delay_minutes: "10081" })).toThrow(/délai invalide : un entier de 0 à 10\s080/);
    expect(() => etapeDesChamps({ ...CHAMPS, channel_id: "" })).toThrow("canal requis");
    expect(() => etapeDesChamps({ ...CHAMPS, channel_id: "abc" })).toThrow("canal requis");
    expect(() => etapeDesChamps({ ...CHAMPS, severity_min: "page" })).toThrow("sévérité invalide : page");
    expect(() => etapeDesChamps({ ...CHAMPS, repeat_minutes: "60" })).toThrow("plafond de relance requis");
    expect(() => etapeDesChamps({ ...CHAMPS, repeat_max: "3" })).toThrow("cadence de relance requise");
    expect(() => etapeDesChamps({ ...CHAMPS, repeat_minutes: "2", repeat_max: "3" })).toThrow(/cadence de relance invalide : un entier de 5/);
    expect(() => etapeDesChamps({ ...CHAMPS, repeat_minutes: "60", repeat_max: "49" })).toThrow(/plafond de relance invalide/);
  });
});

describe("creerEtapeEscalade", () => {
  const creer = (principal: typeof PLATEFORME | typeof ADMIN_A, corps: Record<string, string>) =>
    COMMANDES_CONSOLE.creerEtapeEscalade.executer({ principal, app: null, chemin: {}, corps, requestId: "req-escalade" });

  it("une étape de son application : créée avec son auteur, auditée dans la transaction, l'application au journal", async () => {
    simul.insertEtapeEscalade.mockResolvedValue("41");
    expect(await creer(ADMIN_A, { ...CHAMPS, repeat_minutes: "60", repeat_max: "4" })).toEqual({ etat: "cree", id: "41" });
    expect(simul.insertEtapeEscalade).toHaveBeenCalledWith(
      expect.objectContaining({ app_id: "app-a", level: 2, delay_minutes: 30, channel_id: 12, created_by: "admin-a@mip" }),
      client,
    );
    const [ligne] = audits();
    expect(ligne).toEqual([
      "admin-a@mip",
      "alert_escalation_step.create",
      JSON.stringify({ id: "41", niveau: 2, delai_min: 30, canal: 12, relance: "60 min × 4" }),
      "req-escalade",
      "app-a",
    ]);
  });

  it("une étape GLOBALE : la plateforme seule ; une application hors de la liste : refusée", async () => {
    expect(await creer(ADMIN_A, { ...CHAMPS, app_id: "" })).toEqual({ etat: "hors_perimetre" });
    expect(await creer(ADMIN_A, { ...CHAMPS, app_id: "app-b" })).toEqual({ etat: "hors_perimetre" });
    expect(simul.insertEtapeEscalade).not.toHaveBeenCalled();
    simul.insertEtapeEscalade.mockResolvedValue("42");
    expect(await creer(PLATEFORME, { ...CHAMPS, app_id: "" })).toEqual({ etat: "cree", id: "42" });
    // Une étape globale n'appartient à aucune application : sa ligne d'audit non plus.
    expect(audits()[0]![4]).toBeNull();
  });

  it("un canal introuvable ou hors de la portée de l'étape : refusé, rien au journal", async () => {
    simul.insertEtapeEscalade.mockResolvedValue(null);
    const r = await creer(ADMIN_A, CHAMPS);
    expect(r).toMatchObject({ etat: "invalide", code: "canal_hors_portee", message: expect.stringContaining("canal introuvable") });
    expect(audits()).toEqual([]);
  });

  it("une saisie invalide : `invalide`, avec son motif ; une base sans v108 : dit", async () => {
    expect(await creer(ADMIN_A, { ...CHAMPS, level: "0" })).toMatchObject({ etat: "invalide", message: expect.stringMatching(/niveau invalide/) });
    simul.escaladeDisponible.mockResolvedValue(false);
    expect(await creer(ADMIN_A, CHAMPS)).toMatchObject({ etat: "invalide", message: expect.stringContaining("escalade indisponible") });
    expect(simul.insertEtapeEscalade).not.toHaveBeenCalled();
  });
});

describe("supprimerEtapeEscalade", () => {
  const supprimer = (principal: typeof PLATEFORME | typeof ADMIN_A, id: string) =>
    COMMANDES_CONSOLE.supprimerEtapeEscalade.executer({ principal, app: null, chemin: { id }, corps: undefined, requestId: "req-sup" });

  it("cherchée DANS le périmètre du principal ; introuvable ailleurs, sans rien au journal", async () => {
    simul.deleteEtapeEscalade.mockResolvedValueOnce(undefined);
    expect(await supprimer(ADMIN_A, "7")).toEqual({ etat: "introuvable" });
    expect(simul.deleteEtapeEscalade).toHaveBeenCalledWith(7, ["app-a"], client);
    expect(audits()).toEqual([]);

    simul.deleteEtapeEscalade.mockResolvedValueOnce({ app_id: "app-a" });
    expect(await supprimer(ADMIN_A, "7")).toEqual({ etat: "ok" });
    expect(audits()).toEqual([["admin-a@mip", "alert_escalation_step.delete", JSON.stringify({ id: "7" }), "req-sup", "app-a"]]);
  });

  it("la plateforme voit aussi les étapes globales ; sans v108, il n'y a rien à supprimer", async () => {
    simul.deleteEtapeEscalade.mockResolvedValueOnce({ app_id: null });
    expect(await supprimer(PLATEFORME, "8")).toEqual({ etat: "ok" });
    expect(simul.deleteEtapeEscalade).toHaveBeenCalledWith(8, null, client);
    simul.escaladeDisponible.mockResolvedValue(false);
    expect(await supprimer(PLATEFORME, "8")).toEqual({ etat: "introuvable" });
    expect(simul.deleteEtapeEscalade).toHaveBeenCalledTimes(1);
  });
});

describe("les server actions de la section « Escalade »", () => {
  it("créer : les champs du formulaire vont à la commande ; un viewer et une démo sont refusés avant elle", async () => {
    simul.insertEtapeEscalade.mockResolvedValue("43");
    await createEscalationStepAction(formulaire(CHAMPS));
    expect(simul.insertEtapeEscalade).toHaveBeenCalledWith(expect.objectContaining({ app_id: "app-a", channel_id: 12 }), client);

    simul.insertEtapeEscalade.mockClear();
    simul.user = { email: "v@mip", role: "viewer", apps: ["app-a"] };
    await expect(createEscalationStepAction(formulaire(CHAMPS))).rejects.toThrow();
    simul.user = { ...ADMIN_A, demo: true };
    await expect(createEscalationStepAction(formulaire(CHAMPS))).rejects.toThrow(/démonstration/);
    expect(simul.insertEtapeEscalade).not.toHaveBeenCalled();
  });

  it("créer : un canal hors de la portée de l'étape revient sur la section avec son code, pas l'écran d'erreur", async () => {
    simul.insertEtapeEscalade.mockResolvedValue(null);
    // La destination : dans le `digest` de NEXT_REDIRECT, ou, si le mock de
    // `next/navigation` s'applique au module de l'action, son dernier appel.
    let destination: string | null = null;
    try {
      await createEscalationStepAction(formulaire(CHAMPS));
      const appels = vi.mocked(redirect).mock.calls;
      destination = appels.length ? String(appels[appels.length - 1][0]) : null;
    } catch (e) {
      const digest = (e as { digest?: unknown }).digest;
      if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) throw e;
      destination = digest.split(";")[2] ?? null;
    }
    expect(destination).toBe("/alerts?etape_refusee=canal#escalade");
  });

  it("créer : un refus de saisie remonte en toutes lettres", async () => {
    await expect(createEscalationStepAction(formulaire({ ...CHAMPS, repeat_minutes: "60" }))).rejects.toThrow("plafond de relance requis");
  });

  it("supprimer : l'identifiant du formulaire est le chemin de la commande", async () => {
    simul.deleteEtapeEscalade.mockResolvedValueOnce({ app_id: "app-a" });
    await deleteEscalationStepAction(formulaire({ id: "9" }));
    expect(simul.deleteEtapeEscalade).toHaveBeenCalledWith(9, ["app-a"], client);
  });
});

describe("acquitter garde l'heure et l'auteur (v108)", () => {
  const update = () => simul.requetes.find((r) => r.texte.includes("update alert_event"))!;

  it("avec v108 : heure et auteur posés une seule fois, l'application cherchée par règle, SLO ou issue", async () => {
    await ackEventAction(formulaire({ id: "55", app: "app-a" }));
    const u = update();
    expect(u.valeurs).toEqual([55, "app-a", "admin-a@mip"]);
    expect(u.texte).toContain("acknowledged_at = case when e.acknowledged then e.acknowledged_at else now() end");
    expect(u.texte).toContain("acknowledged_by = case when e.acknowledged then e.acknowledged_by else $3::text end");
    expect(u.texte).toContain("from error_issue_notification n where n.alert_event_id = e.id and n.app_id = $2");
  });

  it("avec v108 : le geste vaut pour l'incident — les déclenchements OUVERTS de la même règle, du même SLO ou de la même issue", async () => {
    await ackEventAction(formulaire({ id: "57", app: "app-a" }));
    const texte = update().texte.replace(/\s+/g, " ");
    expect(texte).toContain("where e.id = c.id or (not e.acknowledged and case");
    expect(texte).toContain("when c.rule_id is not null then e.rule_id = c.rule_id");
    expect(texte).toContain("when c.slo_id is not null then e.rule_id is null and e.slo_id = c.slo_id");
    expect(texte).toContain("n.app_id = $2 and n.issue_id = c.issue_id");
  });

  it("sans v108 (la console précède sa migration) : le booléen seul, comme avant", async () => {
    simul.v108 = false;
    await ackEventAction(formulaire({ id: "56", app: "app-a" }));
    const u = update();
    expect(u.valeurs).toEqual([56, "app-a"]);
    expect(u.texte).not.toContain("acknowledged_at");
  });
});
