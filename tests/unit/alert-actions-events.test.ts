import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/next-cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// C8 : les actions passent par leurs commandes — la session vient de `getUser`, l'écriture
// d'une transaction (un client inerte ici).
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ q: vi.fn(async () => []), tx: vi.fn(async (fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })) }));
vi.mock("@/lib/queries-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries-v2")>();
  return {
    ...actual,
    insertAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
  };
});

import { createRuleAction, updateRuleAction } from "@/app/alerts/actions";
import { getUser, requireAdmin } from "@/lib/auth";
import { insertAlertRule, updateAlertRule } from "@/lib/queries-v2";

function eventRuleForm(extra: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    app_id: "app-a",
    metric: "event",
    event_name: " checkout ",
    comparator: ">",
    threshold: "10",
    window_minutes: "15",
    mode: "threshold",
    severity: "warning",
    sensitivity: "3",
    baseline_weeks: "4",
    ...extra,
  })) fd.set(key, value);
  return fd;
}

describe("actions alertes — adaptation event:<nom>", () => {
  afterEach(() => vi.clearAllMocks());

  it("adapte création et édition du formulaire vers la métrique stockée", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });

    await createRuleAction(eventRuleForm());
    await updateRuleAction(eventRuleForm({ id: "12", event_name: "signup" }));

    expect(insertAlertRule).toHaveBeenCalledWith(
      expect.objectContaining({ app_id: "app-a", metric: "event:checkout", threshold: 10 }),
      expect.anything(),
    );
    // La règle est cherchée dans son application (celle du formulaire, faute de champ `app`).
    expect(updateAlertRule).toHaveBeenCalledWith(12, "app-a", expect.objectContaining({ metric: "event:signup" }), expect.anything());
  });

  it("refuse une métrique événement sans nom", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    await expect(createRuleAction(eventRuleForm({ event_name: "" }))).rejects.toThrow(/metric invalide/);
    expect(insertAlertRule).not.toHaveBeenCalled();
  });
});

describe("actions alertes — pic d'une issue issue:<uuid>", () => {
  afterEach(() => vi.clearAllMocks());
  const ISSUE = "11111111-2222-4333-8444-555555555555";

  it("compose la métrique depuis l'identifiant d'issue et garde l'env", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    await createRuleAction(eventRuleForm({ metric: "issue", issue_id: ` ${ISSUE.toUpperCase()} `, env: " prod " }));
    expect(insertAlertRule).toHaveBeenCalledWith(expect.objectContaining({ metric: `issue:${ISSUE}`, env: "prod" }), expect.anything());

    await updateRuleAction(eventRuleForm({ id: "7", metric: "issue", issue_id: ISSUE, env: "" }));
    expect(updateAlertRule).toHaveBeenCalledWith(7, "app-a", expect.objectContaining({ metric: `issue:${ISSUE}`, env: null }), expect.anything());
  });

  it("refuse un identifiant d'issue invalide et un env hors d'une alerte d'issue", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    vi.mocked(getUser).mockResolvedValue({ email: "admin@example.test", role: "admin", apps: null });
    await expect(createRuleAction(eventRuleForm({ metric: "issue", issue_id: "pas-un-uuid" }))).rejects.toThrow(/metric invalide/);
    await expect(createRuleAction(eventRuleForm({ env: "prod" }))).rejects.toThrow(/env invalide/);
    await expect(
      createRuleAction(eventRuleForm({ metric: "issue", issue_id: ISSUE, env: "x".repeat(121) })),
    ).rejects.toThrow(/env invalide/);
    // U+0085 : refusé par `[[:cntrl:]]` en base, donc ici, avant l'écriture.
    await expect(createRuleAction(eventRuleForm({ metric: "issue", issue_id: ISSUE, env: "prod\u0085" }))).rejects.toThrow(/env invalide/);
    expect(insertAlertRule).not.toHaveBeenCalled();
  });
});
