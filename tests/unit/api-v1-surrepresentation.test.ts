// `GET /api/v1/errors/{fingerprint}/overrepresentation` : les valeurs de session
// sur-représentées parmi les sessions touchées par un groupe d'erreurs.
//
// Ce que ces cas verrouillent :
//   - le test est celui du paquet (`@mip/stats/surrepresentation`), rendu tel quel ;
//   - la réserve d'association est écrite par qui affiche (RM5), jamais par le calcul ;
//   - le refus est chiffré (« 7 sessions touchées, 10 requises »), jamais une liste vide ;
//   - l'empreinte se résout comme pour le détail : ambiguë → 400 avec les apps, inconnue → 404.
// Les effectifs sont simulés ; leur SQL est prouvé sur PostgreSQL
// (tests/integration/surrepresentation-sql.test.ts) et par le contrat de parité.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyserSurrepresentation, UNITES_SESSIONS } from "../../packages/stats/src/surrepresentation";

const lectures = vi.hoisted(() => ({ effectifsDuGroupe: vi.fn(), resolveErrorGroup: vi.fn() }));
vi.mock("@/lib/queries-surrepresentation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/queries-surrepresentation")>()),
  effectifsDuGroupe: lectures.effectifsDuGroupe,
}));
vi.mock("@/lib/queries-errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/console/lib/queries-errors")>()),
  resolveErrorGroup: lectures.resolveErrorGroup,
}));

// L'implémentation, telle que le service `api` la compile : la console ne fait que transmettre.
import { GET } from "../../apps/console/lib/api/service/surrepresentation";
import { RESERVE_ASSOCIATION, surrepresentationDuGroupe } from "../../apps/console/lib/api/surrepresentation";

/** 12 sessions touchées sur 210 : Safari en porte 9, contre 63 dans la base. */
const EFFECTIFS = {
  totaux: { touches: 12, base: 210 },
  dimensions: [
    {
      cle: "browser",
      libelle: "Navigateur",
      valeurs: [
        { valeur: "Safari", nTouches: 9, nBase: 63 },
        { valeur: "Chrome", nTouches: 3, nBase: 140 },
        { valeur: "Inconnu", nTouches: 0, nBase: 7 },
      ],
    },
    {
      cle: "os",
      libelle: "Système",
      valeurs: [
        { valeur: "iOS", nTouches: 9, nBase: 70 },
        { valeur: "Windows", nTouches: 3, nBase: 140 },
      ],
    },
  ],
};

beforeEach(() => {
  process.env.CONSOLE_API_TOKENS = "global,tok-a@app-a";
});
afterEach(() => {
  delete process.env.CONSOLE_API_TOKENS;
  vi.clearAllMocks();
});

describe("surrepresentationDuGroupe — le test du paquet, et sa réserve", () => {
  it("les valeurs testées portent leur test ; les retenues, leur phrase et la réserve d'association", () => {
    const r = surrepresentationDuGroupe({ app_id: "app-a", fingerprint: "fp1" }, EFFECTIFS);
    const attendue = analyserSurrepresentation(EFFECTIFS.dimensions, EFFECTIFS.totaux, UNITES_SESSIONS);
    if (!r.analyse.ok || !attendue.ok) throw new Error("analyse attendue");
    expect(r.analyse.testees).toBe(attendue.testees);
    expect(r.analyse.retenues.map((x) => `${x.cle}:${x.valeur}`)).toEqual(attendue.retenues.map((x) => `${x.cle}:${x.valeur}`));
    const safari = r.analyse.retenues.find((x) => x.valeur === "Safari");
    expect(safari?.phrase).toContain("Safari : 9 des 12 sessions touchées");
    expect(safari?.phrase.endsWith(RESERVE_ASSOCIATION)).toBe(true);
    // Chaque valeur testée porte le test du paquet ; « Inconnu » est affiché, jamais testé.
    const [navigateur] = r.dimensions;
    expect(navigateur.valeurs.find((v) => v.valeur === "Safari")?.test).toEqual(
      attendue.dimensions.find((d) => d.cle === "browser")?.tests.Safari,
    );
    expect(navigateur.valeurs.find((v) => v.valeur === "Inconnu")).toEqual({ valeur: "Inconnu", nTouches: 0, nBase: 7, test: null });
    expect(r.groupe).toEqual({ app: "app-a", fingerprint: "fp1" });
  });

  it("moins de 10 sessions touchées : aucun test, et ce qui manque EN CHIFFRES — jamais une liste vide", () => {
    const r = surrepresentationDuGroupe({ app_id: "app-a", fingerprint: "fp1" }, { ...EFFECTIFS, totaux: { touches: 7, base: 210 } });
    expect(r.analyse).toEqual({
      ok: false,
      raison: "pas de test : 7 sessions touchées, 10 requises",
      manque: { requis: 10, observe: 7, unite: "sessions touchées" },
    });
    expect(r.dimensions.flatMap((d) => d.valeurs).every((v) => v.test === null)).toBe(true);
  });
});

describe("GET /api/v1/errors/{fingerprint}/overrepresentation", () => {
  const appel = (fingerprint: string, query: string) => {
    const url = `http://console.test/api/v1/errors/${encodeURIComponent(fingerprint)}/overrepresentation?${query}`;
    return GET(
      { url, nextUrl: new URL(url), headers: new Headers({ authorization: "Bearer global" }), cookies: { get: () => undefined } } as never,
      { params: Promise.resolve({ fingerprint }) },
    );
  };

  it("résout le groupe dans son app, compte ses sessions, et annonce l'app des chiffres dans meta", async () => {
    lectures.resolveErrorGroup.mockResolvedValue({ kind: "found", ref: { app_id: "app-a", fingerprint: "fp1" } });
    lectures.effectifsDuGroupe.mockResolvedValue(EFFECTIFS);
    const reponse = await appel("fp1", "period=7d");
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.meta.app).toBe("app-a");
    expect(corps.data.analyse.ok).toBe(true);
    expect(lectures.effectifsDuGroupe.mock.calls[0][0]).toEqual({ app_id: "app-a", fingerprint: "fp1" });
  });

  it("empreinte ambiguë sans app : 400 avec les apps candidates ; inconnue : 404 ; illisible : 400", async () => {
    lectures.resolveErrorGroup.mockResolvedValue({ kind: "ambiguous", candidates: [{ app_id: "app-a" }, { app_id: "app-b" }] });
    const ambigue = await appel("fp1", "");
    expect(ambigue.status).toBe(400);
    expect((await ambigue.json()).error).toContain("app-a, app-b");
    lectures.resolveErrorGroup.mockResolvedValue({ kind: "not_found" });
    expect((await appel("fp1", "")).status).toBe(404);
    expect((await appel("x".repeat(65), "")).status).toBe(400);
    expect(lectures.effectifsDuGroupe).not.toHaveBeenCalled();
  });
});
