// C6 — la ligne d'audit d'une commande, avant et après migration-v90.
//
// La console publiée écrit AVANT que v90 soit appliquée en production (elle attend
// sa répétition sur une branche Neon) : la présence des colonnes `request_id`,
// `actor_kind` et `app_id` est sondée, et sans elles la ligne s'écrit sous sa forme
// d'avant — jamais une écriture refusée pour une colonne absente.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));
const { ecrireAudit, oublierSondeAudit } = await import("@/lib/commandes/audit");

const LIGNE = { email: "a@mip.test", action: "goal.create", detail: "demo-app \"Achat\"", requestId: "req-0000-0001", app: "demo-app" };

describe("C6 — ecrireAudit", () => {
  beforeEach(() => {
    oublierSondeAudit();
    q.mockReset();
  });

  it("v90 appliquée : la requête, l'acteur (un compte) et l'application, dans la transaction de l'écriture", async () => {
    q.mockResolvedValue([{ ok: true }]);
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    await ecrireAudit(client, LIGNE);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("request_id, actor_kind, app_id"), [
      "a@mip.test",
      "goal.create",
      "demo-app \"Achat\"",
      "req-0000-0001",
      "demo-app",
    ]);
  });

  it("v90 absente : la ligne d'avant (acteur, action, détail), l'écriture passe", async () => {
    q.mockResolvedValue([{ ok: false }]);
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    await ecrireAudit(client, LIGNE);
    expect(client.query).toHaveBeenCalledWith("insert into audit_log (user_email, action, detail) values ($1, $2, $3)", [
      "a@mip.test",
      "goal.create",
      "demo-app \"Achat\"",
    ]);
  });

  it("la sonde est mémorisée quelques secondes : une rafale d'écritures ne la relance pas", async () => {
    q.mockResolvedValue([{ ok: true }]);
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    await ecrireAudit(client, LIGNE);
    await ecrireAudit(client, LIGNE);
    expect(q).toHaveBeenCalledTimes(1);
  });
});
