// B36 (plan § 6.3) — `GET /api/replay/[sessionId]` COMPTE ses segments illisibles.
//
// CE QUE CE TEST TIENT :
//   - un segment illisible (gzip corrompu, JSON invalide, ou JSON qui n'est pas une
//     liste d'événements) reste ignoré — le reste du rejeu se lit — mais il est
//     désormais compté dans `ignores`, pour que le lecteur le DISE ;
//   - un rejeu sain répond `ignores: 0` (jamais un champ absent) ;
//   - la garde de périmètre est inchangée : une session d'une app hors périmètre
//     répond 404 et ses segments ne sont jamais lus.
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ q: vi.fn() }));
vi.mock("@/lib/server-trace", () => ({
  withServerTrace: (_req: Request, _meta: unknown, handler: () => Promise<Response>) => handler(),
}));

import { GET } from "@/app/api/replay/[sessionId]/route";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";

const segment = (valeur: unknown) => ({ seq: 0, events_count: null, body: gzipSync(JSON.stringify(valeur)) });
const appel = (id = "s1") =>
  GET(new Request(`https://console.test/api/replay/${id}`), { params: Promise.resolve({ sessionId: id }) });

describe("GET /api/replay/:sessionId — B36, segments illisibles comptés", () => {
  afterEach(() => vi.clearAllMocks());

  it("ignore ET compte un gzip corrompu, un JSON invalide et un JSON qui n'est pas une liste", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "a@example.test", role: "admin", apps: null } as never);
    vi.mocked(q)
      .mockResolvedValueOnce([{ app_id: "shop" }] as never)
      .mockResolvedValueOnce([
        segment([{ type: 4 }, { type: 2 }]),
        { seq: 1, events_count: null, body: Buffer.from("pas du gzip") },
        { seq: 2, events_count: null, body: gzipSync("{ tronqué") },
        segment({ type: 3 }),
        segment([{ type: 3 }]),
      ] as never);

    const res = await appel();
    expect(res.status).toBe(200);
    const corps = (await res.json()) as { chunks: number; events: unknown[]; ignores: number };
    expect(corps.chunks).toBe(5);
    expect(corps.events).toHaveLength(3); // les segments lisibles restent rejouables
    expect(corps.ignores).toBe(3);
  });

  it("un rejeu sain répond `ignores: 0`, jamais un champ absent", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "a@example.test", role: "admin", apps: null } as never);
    vi.mocked(q)
      .mockResolvedValueOnce([{ app_id: "shop" }] as never)
      .mockResolvedValueOnce([segment([{ type: 4 }, { type: 2 }])] as never);
    const corps = (await (await appel()).json()) as { ignores: number };
    expect(corps.ignores).toBe(0);
  });

  it("périmètre inchangé : hors de ses apps, 404 et aucun segment lu", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "v@example.test", role: "viewer", apps: ["autre"] } as never);
    vi.mocked(q).mockResolvedValueOnce([{ app_id: "shop" }] as never);
    const res = await appel();
    expect(res.status).toBe(404);
    expect(q).toHaveBeenCalledTimes(1);
    expect(await res.text()).not.toContain("events");
  });
});
