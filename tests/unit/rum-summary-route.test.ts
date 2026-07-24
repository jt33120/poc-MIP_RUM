// E1-S5 (revue BMAD) — test d'intégration du contrat de lecture UTI
// GET /api/rum/summary : auth par token, scoping par app_id, et forme de réponse
// (ai_status). Comble le trou de couverture : la logique 401/403 du handler câblé
// n'était testée qu'en pièces isolées. Les accès base (resolveReadToken/rumSummary)
// sont mockés — on teste le HANDLER, pas la DB.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries-read-tokens", () => ({ resolveReadToken: vi.fn() }));
vi.mock("@/lib/queries-summary", () => ({ rumSummary: vi.fn() }));

import { GET } from "@/app/api/rum/summary/route";
import { resolveReadToken } from "@/lib/queries-read-tokens";
import { rumSummary } from "@/lib/queries-summary";

const req = (headers: Record<string, string> = {}, url = "https://x/api/rum/summary") =>
  new Request(url, { headers }) as never;

describe("GET /api/rum/summary — auth & scoping (E1-S5)", () => {
  afterEach(() => vi.clearAllMocks());

  it("401 sans en-tête Authorization", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("401 sur token invalide / révoqué", async () => {
    vi.mocked(resolveReadToken).mockResolvedValue(null);
    const res = await GET(req({ authorization: "Bearer mauvais" }));
    expect(res.status).toBe(401);
    expect(rumSummary).not.toHaveBeenCalled();
  });

  it("403 si le token est scopé sur une AUTRE app que ?app", async () => {
    vi.mocked(resolveReadToken).mockResolvedValue({ id: 1, app_id: "app-a" });
    const res = await GET(req({ authorization: "Bearer t" }, "https://x/api/rum/summary?app=app-b"));
    expect(res.status).toBe(403);
    expect(rumSummary).not.toHaveBeenCalled();
  });

  it("200 + payload (ai_status) sur token valide ; window transmise", async () => {
    vi.mocked(resolveReadToken).mockResolvedValue({ id: 2, app_id: "gip-plateforme" });
    vi.mocked(rumSummary).mockResolvedValue({
      app: "gip-plateforme",
      ai_status: "unavailable",
      ai_calls: null,
    } as never);
    const res = await GET(
      req({ authorization: "Bearer t" }, "https://x/api/rum/summary?app=gip-plateforme&window=7d"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ai_status).toBe("unavailable");
    // app déduit du token + fenêtre parsée transmises au builder
    expect(rumSummary).toHaveBeenCalledWith("gip-plateforme", "7d", "7 days", expect.any(String));
  });
});
