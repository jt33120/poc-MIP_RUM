import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));

import { sessionTimeline } from "../../apps/console/lib/queries";

beforeEach(() => q.mockReset());

describe("timeline progressive v66/v67", () => {
  it("ne référence aucune colonne P3 sur v66", async () => {
    q.mockResolvedValueOnce([{ v67: false }]).mockResolvedValueOnce([]);
    await sessionTimeline("session-v66");
    const sql = String(q.mock.calls[1][0]);
    expect(sql).not.toContain("from rum_action");
    expect(sql).not.toContain("f.action_id");
    expect(sql).toContain("null::text as action_id");
  });

  it("affiche les racines et groupe les effets par action sur v67 sans multiplier le back", async () => {
    q.mockResolvedValueOnce([{ v67: true }]).mockResolvedValueOnce([]);
    await sessionTimeline("session-v67");
    const sql = String(q.mock.calls[1][0]);
    expect(sql).toContain("from rum_action where session_id = $1");
    expect(sql).toContain("event_type is distinct from 'action'");
    expect(sql).toContain("a.action_id = t.action_id and a.app_id = t.app_id and a.session_id = $1");
    expect(sql).toContain("child.parent_span_id = f.span_id");
    expect(sql).toContain("limit 1");
    expect(sql).toContain("case when t.kind = 'action' then 0 else 1 end");
  });

  it("conserve le contrat visuel racine action et badge causal des effets", () => {
    const component = readFileSync(
      new URL("../../apps/console/components/sessions/Timeline.tsx", import.meta.url),
      "utf8",
    );
    const constants = readFileSync(
      new URL("../../apps/console/lib/timeline-constants.tsx", import.meta.url),
      "utf8",
    );
    expect(component).toContain('item.action_id && item.kind !== "action"');
    expect(component).toContain('↳ {item.action_name ?? "action"}');
    expect(component).toContain('case "action"');
    expect(constants).toContain('label: "Action"');
    expect(constants).toContain('action: <Icon');
  });
});
