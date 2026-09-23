// Les gardes du semis des bancs (`scripts/bench/semer-bancs.mjs`).
//
// POURQUOI UN TEST SANS BASE. Ce script écrit 3 M de lignes, et le `.env` du
// poste fait pointer DATABASE_URL sur la production. La seule chose qui doit
// être vraie en toutes circonstances est qu'il REFUSE une cible qui n'est pas
// une base de banc jetable — et cela se vérifie sans rien connecter.
import { describe, expect, it } from "vitest";
import { verifierCible } from "../../scripts/bench/semer-bancs.mjs";

describe("semer-bancs — la cible doit être une base de banc jetable", () => {
  it("refuse l'absence de BENCH_DATABASE_URL (DATABASE_URL n'est jamais lue)", () => {
    const r = verifierCible(undefined, {});
    expect(r.ok).toBe(false);
  });

  it("refuse une base dont le nom ne porte pas « bench »", () => {
    const r = verifierCible("postgres://postgres:postgres@localhost:5433/mip_rum", {});
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.raison).toContain("bench");
  });

  it("refuse un hôte distant, même nommé « bench », sans accord explicite", () => {
    const url = "postgres://u:p@ep-quelque-chose.eu-central-1.aws.neon.tech/neondb_bench?sslmode=require";
    expect(verifierCible(url, {}).ok).toBe(false);
    expect(verifierCible(url, { BANC_HOTE_DISTANT: "1" }).ok).toBe(false);
    expect(verifierCible(url, { BANC_HOTE_DISTANT: "oui" }).ok).toBe(true);
  });

  it("accepte la base de banc de la CI et celles des en-têtes de migration", () => {
    for (const url of [
      "postgres://postgres:postgres@localhost:5433/mip_rum_bench",
      "postgres://postgres:postgres@localhost:5433/p66_bench",
      "postgres://postgres:postgres@127.0.0.1:5433/p75_bench",
    ]) {
      expect(verifierCible(url, {})).toEqual({ ok: true });
    }
  });

  it("refuse une URL illisible plutôt que de deviner", () => {
    expect(verifierCible("pas une url", {}).ok).toBe(false);
  });
});
