// Disponibilité 24 h d'une sonde pendant une panne de collecte : « inconnu », pas
// 100 %. La vue `v_uptime_status` ne compte que les vérifications PRÉSENTES ; sans
// passage, elle ne voit aucun échec. Fenêtres de test = FIXTURES (en production,
// elles viennent du registre `collecte_fenetre`).
import { describe, expect, it, vi } from "vitest";

vi.mock("../../apps/console/lib/db", () => ({
  q: async () => {
    throw new Error("aucune lecture attendue");
  },
  pool: {},
}));

const { uptimeSelonCollecte } = await import("../../apps/console/lib/chargeurs/sondes");

const MAINTENANT = Date.parse("2026-09-26T12:00:00Z");
const check = {
  id: 1,
  app_id: "gip-plateforme",
  name: "Accueil",
  uptime_pct_24h: 100,
  checks_24h: 12,
} as unknown as Parameters<typeof uptimeSelonCollecte>[0];

describe("uptimeSelonCollecte", () => {
  it("fenêtre interrompue de la plateforme dans les 24 h : inconnu, jamais 100 %", () => {
    const r = uptimeSelonCollecte(check, [{ debut: "2026-09-24T03:28:00Z", fin: null, etat: "interrompue", portee: "*" }], MAINTENANT);
    expect(r.uptime_pct_24h).toBeNull();
    expect(r.uptime_inconnu).toContain("collecte interrompue");
  });

  it("fenêtre d'une AUTRE application, dégradée, ou antérieure aux 24 h : la valeur de la vue reste", () => {
    const fenetres = [
      { debut: "2026-09-26T01:00:00Z", fin: "2026-09-26T02:00:00Z", etat: "interrompue" as const, portee: "autre-app" },
      { debut: "2026-09-26T01:00:00Z", fin: "2026-09-26T02:00:00Z", etat: "degradee" as const, portee: "*" },
      { debut: "2026-09-20T01:00:00Z", fin: "2026-09-21T02:00:00Z", etat: "interrompue" as const, portee: "*" },
    ];
    const r = uptimeSelonCollecte(check, fenetres, MAINTENANT);
    expect(r.uptime_pct_24h).toBe(100);
    expect(r.uptime_inconnu).toBeNull();
  });

  it("fenêtre de SON application : inconnu", () => {
    const r = uptimeSelonCollecte(
      check,
      [{ debut: "2026-09-26T01:00:00Z", fin: "2026-09-26T02:00:00Z", etat: "interrompue", portee: "gip-plateforme" }],
      MAINTENANT,
    );
    expect(r.uptime_pct_24h).toBeNull();
  });
});
