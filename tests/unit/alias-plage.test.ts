// Alias `?range=` de la plage (recette du 30/09/2026) : `/?app=x&range=7d` ouvrait la
// vue d'ensemble sur 24 h. Le middleware réécrit l'alias vers le paramètre du
// contrat (`period`, ou `from`/`to` pour 30 jours) ; les liens existants gardent
// leur sens.
import { describe, expect, it } from "vitest";
import { RANGE_MAX_MS, canoniserAliasPlage, resolveRange } from "@/lib/query-contract";

const MAINTENANT = Date.parse("2026-09-30T10:17:42.123Z");
const canon = (qs: string) => canoniserAliasPlage(new URLSearchParams(qs), MAINTENANT)?.toString() ?? null;
const plageDe = (qs: string) => {
  // La lecture de l'écran (`parseAnalyticsQuery`) passe ces trois paramètres à `resolveRange`.
  const sp = new URLSearchParams(qs);
  const r = resolveRange({ period: sp.get("period"), from: sp.get("from"), to: sp.get("to") }, MAINTENANT);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe("canoniserAliasPlage", () => {
  it("sans alias : rien à réécrire (les liens existants ne bougent pas)", () => {
    expect(canon("app=a&period=7d")).toBeNull();
    expect(canon("app=a")).toBeNull();
    expect(canon("")).toBeNull();
  });

  it("range=7d devient period=7d, et l'écran lit bien 7 jours", () => {
    const qs = canon("app=mip-rum-console&range=7d");
    expect(qs).toBe("app=mip-rum-console&period=7d");
    expect(plageDe(qs!).preset).toBe("7d");
  });

  it("1h, 7j et les majuscules sont acceptés ; 24h (défaut) n'est pas écrit", () => {
    expect(canon("app=a&range=1h")).toBe("app=a&period=1h");
    expect(canon("app=a&range=7J")).toBe("app=a&period=7d");
    expect(canon("app=a&range=24h")).toBe("app=a");
    expect(canon("app=a&range=1d")).toBe("app=a");
  });

  it("range=30d : la plage personnalisée des 30 derniers jours, arrêtée à la minute", () => {
    const qs = canon("app=a&range=30d");
    const p = new URLSearchParams(qs!);
    expect(p.get("to")).toBe("2026-09-30T10:17:00.000Z");
    expect(Date.parse(p.get("to")!) - Date.parse(p.get("from")!)).toBe(RANGE_MAX_MS);
    expect(p.has("period")).toBe(false);
    // Le contrat l'accepte (≤ 30 jours, `to` pas dans le futur).
    const plage = plageDe(qs!);
    expect(plage.preset).toBeNull();
    expect(Date.parse(plage.to) - Date.parse(plage.from)).toBe(RANGE_MAX_MS);
  });

  it("un period, from ou to explicite prime : l'alias est seulement retiré", () => {
    expect(canon("app=a&period=1h&range=7d")).toBe("app=a&period=1h");
    expect(canon("app=a&from=2026-09-29T00:00:00Z&to=2026-09-29T06:00:00Z&range=7d")).toBe(
      "app=a&from=2026-09-29T00%3A00%3A00Z&to=2026-09-29T06%3A00%3A00Z",
    );
  });

  it("valeur inconnue : retirée, la plage retombe sur 24 h comme un period inconnu", () => {
    expect(canon("app=a&range=3semaines")).toBe("app=a");
    expect(canon("app=a&range=")).toBe("app=a");
  });

  it("les autres paramètres (comparaison, filtres) sont gardés", () => {
    expect(canon("app=a&range=7d&cmp=prev&device=mobile")).toBe("app=a&cmp=prev&device=mobile&period=7d");
  });
});
