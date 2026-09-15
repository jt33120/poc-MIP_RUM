// La migration v65 peut suivre le déploiement console : /events doit alors
// répondre vide au lieu de propager « relation does not exist » en 500.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));

import { listEventIndex } from "../../apps/console/lib/queries-events";

beforeEach(() => {
  q.mockResolvedValue([{ present: false }]);
});

describe("listEventIndex avant v65", () => {
  it("ignore une table absente sans lire la relation", async () => {
    await expect(listEventIndex("app-a", null, { limit: 100, offset: 0 })).resolves.toEqual([]);
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][0]).toContain("to_regclass");
    expect(q.mock.calls.some(([sql]) => String(sql).includes("from rum_event_index"))).toBe(false);
  });
});
