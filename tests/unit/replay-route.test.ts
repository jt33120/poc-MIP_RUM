// B36 (plan § 6.3) — `GET /api/replay/[sessionId]` COMPTE ses segments illisibles.
//
// CE QUE CE TEST TIENT :
//   - un segment illisible (gzip corrompu, JSON invalide, ou JSON qui n'est pas une
//     liste d'événements) reste ignoré — le reste du rejeu se lit — mais il est
//     désormais compté dans `ignores`, pour que le lecteur le DISE ;
//   - un rejeu sain répond `ignores: 0` (jamais un champ absent) ;
//   - la garde de périmètre est inchangée : une session d'une app hors périmètre
//     répond 404 et ses segments ne sont jamais lus ;
//   - C3 : au-delà du plafond décompressé d'une session, les segments suivants ne
//     sont pas rendus, et leur nombre est DIT (`tronques`).
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

// `total` : le nombre de segments de la session (fenêtre SQL), porté par chaque ligne.
const segment = (valeur: unknown, total = 1) => ({ seq: 0, total: String(total), body: gzipSync(JSON.stringify(valeur)) });
const appel = (id = "s1") =>
  GET(new Request(`https://console.test/api/replay/${id}`), { params: Promise.resolve({ sessionId: id }) });

describe("GET /api/replay/:sessionId — B36, segments illisibles comptés", () => {
  afterEach(() => vi.clearAllMocks());

  it("ignore ET compte un gzip corrompu, un JSON invalide et un JSON qui n'est pas une liste", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "a@example.test", role: "admin", apps: null } as never);
    vi.mocked(q)
      .mockResolvedValueOnce([{ app_id: "shop" }] as never)
      .mockResolvedValueOnce([
        segment([{ type: 4 }, { type: 2 }], 5),
        { seq: 1, total: "5", body: Buffer.from("pas du gzip") },
        { seq: 2, total: "5", body: gzipSync("{ tronqué") },
        segment({ type: 3 }, 5),
        segment([{ type: 3 }], 5),
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
    const corps = (await (await appel()).json()) as { ignores: number; tronques: number };
    expect(corps.ignores).toBe(0);
    expect(corps.tronques).toBe(0);
  });

  it("C3 — plafond par session : au-delà, les segments ne sont pas rendus, et leur nombre est dit", async () => {
    vi.mocked(getUser).mockResolvedValue({ email: "a@example.test", role: "admin", apps: null } as never);
    // Trois segments de ~30 Mio décompressés (compressés : quelques Kio) : le troisième dépasse 64 Mio.
    const gros = (i: number) => ({ seq: i, total: "4", body: gzipSync(JSON.stringify([{ type: 3, pad: "x".repeat(30 * 1024 * 1024) }])) });
    vi.mocked(q)
      .mockResolvedValueOnce([{ app_id: "shop" }] as never)
      // La base n'a rendu que trois des quatre segments (plafond compressé, fenêtre SQL).
      .mockResolvedValueOnce([gros(0), gros(1), gros(2)] as never);
    const corps = (await (await appel()).json()) as { chunks: number; events: unknown[]; tronques: number };
    expect(corps.chunks).toBe(4);
    expect(corps.events).toHaveLength(2);
    expect(corps.tronques).toBe(2);
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
