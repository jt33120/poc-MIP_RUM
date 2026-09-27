// Contre-recette du 26/09/2026 : une requête d'ingestion coupée par le CLIENT (onglet
// fermé pendant l'envoi d'un rejeu) était journalisée « busy: database unavailable ».
// Node lève `Error: aborted` avec le code ECONNRESET — celui d'une connexion à la
// base coupée. La console distingue désormais les deux.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ pool: { query: vi.fn() } }));

const { estAbandonClient, log, refusIngestion } = await import("../../apps/console/lib/ingest");

/** L'erreur que lève Node quand le client coupe la requête en cours de lecture. */
function abandon(): Error {
  return Object.assign(new Error("aborted"), { code: "ECONNRESET" });
}

describe("ingestion — un abandon du client n'est pas une panne de base", () => {
  it("reconnaît l'abandon du client, pas une coupure côté base", () => {
    expect(estAbandonClient(abandon())).toBe(true);
    expect(estAbandonClient(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(false);
    expect(estAbandonClient(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(estAbandonClient(null)).toBe(false);
  });

  it("l'abandon est journalisé comme tel, sans « database unavailable » ni 503", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const reponse = refusIngestion(abandon(), {});
    expect(reponse?.status).toBe(400);
    expect(info).toHaveBeenCalledWith("aborted: client closed the request", {});
    expect(warn).not.toHaveBeenCalled();
  });

  it("une vraie coupure de la base reste un 503 à rejouer", () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const reponse = refusIngestion(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), {});
    expect(reponse?.status).toBe(503);
    expect(reponse?.headers.get("retry-after")).toBe("2");
  });
});
