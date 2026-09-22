// P5.1 — le widget « Top erreurs » lit la même population que l'écran Erreurs.
// L'ancienne conversion vers le modèle de filtres v2 perdait segment, bots et
// apps internes : la tuile pouvait afficher un autre nombre que la liste.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries", () => ({ slowRoutes: vi.fn(), vitalsP75: vi.fn() }));
vi.mock("@/lib/queries-grid", () => ({ dailyTraffic: vi.fn() }));
vi.mock("@/lib/queries-frustration", () => ({ topFrustrations: vi.fn() }));
vi.mock("@/lib/queries-errors", () => ({ listErrorGroups: vi.fn() }));
vi.mock("@/lib/queries-events", () => ({ eventCount: vi.fn() }));

import { listErrorGroups, type ErrorListResult } from "@/lib/queries-errors";
import { RAISON_LECTURE_INDISPONIBLE, resolveWidget } from "@/lib/widget-data";

const widget = { kind: "v1" as const, type: "top_errors" as const, title: "Top erreurs" };
const filters = {
  app: "app-a",
  period: "24h" as const,
  device: "desktop" as const,
  segment: [{ dim: "geo", op: "==" as const, value: "FR" }],
  includeBots: true,
  includeInternal: false,
};

/** Contexte d'une grille : filtres de l'écran, fuseau d'affichage et horloge. */
const ctx = { filters, timeZone: "Europe/Paris", nowMs: Date.parse("2026-09-17T12:00:00Z") };

const groupe = (over: Partial<ErrorListResult["groups"][number]>) => ({
  app_id: "app-a", fingerprint: "fp", error_type: null, sample_message: null, occurrences: 1,
  sessions: 0, users_affected: 0, first_seen: new Date(), last_seen: new Date(), status: "open" as const,
  resolved_at: null, regressed: false, sessions_affected: null, visitors_affected: null,
  identified_users_affected: null, session_coverage: 0, identity_coverage: 0,
  ...over,
});

// Bloc, pas expression : une fonction rendue par beforeEach est exécutée comme
// nettoyage, et `mockReset()` rend le mock lui-même.
beforeEach(() => {
  vi.mocked(listErrorGroups).mockReset();
});

describe("widget top_errors", () => {
  it("passe les filtres tels quels, 8 groupes, et garde les colonnes historiques", async () => {
    vi.mocked(listErrorGroups).mockResolvedValue({
      groups: [
        groupe({ fingerprint: "fp1", error_type: "TypeError", occurrences: 38, sessions: 1, sessions_affected: 1, series: [4, 0, 9, 25] }),
        groupe({ fingerprint: "fp2", sample_message: "boom", occurrences: 3 }),
        groupe({ fingerprint: "fp3", occurrences: 2, regressed: true, series: [1, 0, 0, 1] }),
      ],
      sampling: { min_inclusion_probability: null, message: null },
    } as ErrorListResult);

    const data = await resolveWidget(widget, ctx);
    expect(data.kind).toBe("table");
    expect(data.columns).toEqual(["Erreur", "Occurrences", "Sessions"]);
    // Sessions = compteur historique : 0 quand aucune session n'est connue.
    expect(data.rows).toEqual([["TypeError", 38, 1], ["boom", 3, 0], ["fp3", 2, 0]]);
    // F36 (W-B9) : chaque ligne porte sa tendance, ou l'absence de tendance —
    // une ligne plate se lirait « stable » alors qu'elle n'est pas mesurée.
    expect(data.erreurs).toEqual([
      { fingerprint: "fp1", libelle: "TypeError", occurrences: 38, sessions: 1, statut: "Ouverte", serie: [4, 0, 9, 25] },
      { fingerprint: "fp2", libelle: "boom", occurrences: 3, sessions: 0, statut: "Ouverte", serie: null },
      { fingerprint: "fp3", libelle: "fp3", occurrences: 2, sessions: 0, statut: "Régressée", serie: null },
    ]);
    expect(listErrorGroups).toHaveBeenCalledWith(filters, { limit: 8, offset: 0 }, { series: true });
  });

  // F30 (CE3) : la carte ne casse pas la grille, mais elle DIT son échec — une
  // table vide se lisait « aucune erreur » pendant une panne de la base.
  it("une lecture en échec rend une carte d'erreur, jamais une table vide", async () => {
    vi.mocked(listErrorGroups).mockRejectedValue(new Error("base indisponible"));
    await expect(resolveWidget(widget, ctx)).resolves.toEqual({ kind: "error", reason: RAISON_LECTURE_INDISPONIBLE });
  });
});
