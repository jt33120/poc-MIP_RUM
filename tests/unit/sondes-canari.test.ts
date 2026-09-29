// Vague 1 — le canari de bout en bout et la tenue du registre des fenêtres.
//
// Ce que ce fichier tient, sans base :
//   · le lot du canari passe par le VRAI parseur d'ingestion et y produit
//     exactement ce que la vérification relira (session, page vue, vital, span
//     serveur, entrée d'index), sans rien d'une personne ;
//   · les verdicts (émission, écriture, état de la chaîne) suivent les seuils ;
//   · le registre ferme, prolonge, remplace ou ouvre la bonne fenêtre, et la
//     reconstitution ne s'invente pas de silence ;
//   · le travail du tick : la clé n'est écrite qu'en empreinte, un refus juste
//     après l'avoir écrite n'accuse pas la chaîne, et le journal part en UN insert.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  APP_CANARI,
  GRACE_CLE_MS,
  TABLES_VERIFIEES,
  cheminDeReponse,
  construireLotCanari,
  creerSondes,
  etatChaine,
  idsCanari,
  jugerEcriture,
  jugerEmission,
  planReconstitution,
  planRegistre,
  sessionCanari,
  tirerCle,
  // @ts-expect-error module JS partagé sans déclarations
} from "../../packages/backend/jobs/sondes.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { buildEventIndex, flattenOtlp } from "../../packages/backend/shared/otlp.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { travaux } from "../../packages/backend/jobs/planifie.mjs";

const PASSAGE = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const EMIS = new Date("2026-09-29T21:15:00.123Z");
const CLE = "mip_0123456789abcdef0123456789abcdef";

describe("le lot du canari", () => {
  it("traverse le parseur d'ingestion : une session, une page vue, un vital, un span serveur, rien de rejeté", () => {
    const { payload, ids } = construireLotCanari({ passageId: PASSAGE, emisA: EMIS, cle: CLE });
    const rows = flattenOtlp(JSON.parse(JSON.stringify(payload)), { now: EMIS.getTime() });
    expect(rows.rejected).toBe(0);
    expect(rows.errors).toEqual([]);
    expect(rows.apiKeys).toEqual([{ app_id: APP_CANARI, api_key: CLE }]);
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0]).toMatchObject({ session_id: ids.session_id, app_id: APP_CANARI, visitor_id: null, user_hash: null });
    expect(rows.pageviews).toEqual([
      expect.objectContaining({ span_id: ids.pageview, route: "/canari", url: "https://canari.invalid/canari", nav_type: "navigate" }),
    ]);
    expect(rows.metrics).toEqual([expect.objectContaining({ span_id: ids.vital, name: "LCP", value: 1000, metric_uid: ids.vital_uid })]);
    expect(rows.spans).toEqual([expect.objectContaining({ span_id: ids.serveur, trace_id: ids.trace_id, tier: "back", route: "/canari" })]);
    // L'entrée d'index que la vérification cherche : la page vue, par son span.
    const index = buildEventIndex(rows);
    expect(index).toContainEqual(expect.objectContaining({ kind: "pageview", source_span_id: ids.pageview, app_id: APP_CANARI }));
  });

  it("ne porte rien d'une personne : ni visiteur, ni identité, ni erreur, ni texte libre", () => {
    const { payload } = construireLotCanari({ passageId: PASSAGE, emisA: EMIS, cle: CLE });
    const brut = JSON.stringify(payload);
    for (const interdit of ["visitor_id", "user_hash", "identity", "user_id", "account_id", "exception", "mip.props"]) {
      expect(brut).not.toContain(interdit);
    }
    expect(brut.length).toBeLessThan(2_500);
  });

  it("des identifiants dérivés du passage : un rejeu est inerte, un autre chemin est distinct", () => {
    const a = idsCanari(PASSAGE, EMIS, "c1");
    expect(idsCanari(PASSAGE, EMIS, "c1")).toEqual(a);
    const b = idsCanari(PASSAGE, EMIS, "c2");
    expect(b.pageview).not.toBe(a.pageview);
    for (const id of [a.pageview, a.vital, a.serveur]) expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set([a.pageview, a.vital, a.serveur]).size).toBe(3);
    expect(a.trace_id).toBe("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
    expect(sessionCanari(EMIS, "c1")).toBe("canari-202609292115-c1");
  });

  it("une clé au format de la console, jamais la même", () => {
    const k = tirerCle();
    expect(k).toMatch(/^mip_[0-9a-f]{32}$/);
    expect(tirerCle()).not.toBe(k);
  });
});

describe("les verdicts", () => {
  it("émission : ok ≤ 2 s, lent jusqu'à 8 s, échec au-delà, sur un non-2xx ou sans réponse", () => {
    expect(jugerEmission({ statut: 200, latenceMs: 2_000 })).toBe("ok");
    expect(jugerEmission({ statut: 200, latenceMs: 2_001 })).toBe("lent");
    expect(jugerEmission({ statut: 200, latenceMs: 8_000 })).toBe("lent");
    expect(jugerEmission({ statut: 200, latenceMs: 8_001 })).toBe("echec");
    expect(jugerEmission({ statut: 503, latenceMs: 100 })).toBe("echec");
    expect(jugerEmission({ statut: 403, latenceMs: 100 })).toBe("echec");
    expect(jugerEmission({ statut: null, latenceMs: 10_000, erreur: "delai" })).toBe("echec");
  });

  it("écriture : absent si la page vue ou le vital manque, échec si une projection seule manque", () => {
    const tout = Object.fromEntries(TABLES_VERIFIEES.map((t: string) => [t, true]));
    expect(jugerEcriture(tout)).toEqual({ resultat: "ok", manquantes: [] });
    expect(jugerEcriture({ ...tout, rum_span: false })).toEqual({ resultat: "echec", manquantes: ["rum_span"] });
    expect(jugerEcriture({ ...tout, rum_metric: false }).resultat).toBe("absent");
    expect(jugerEcriture({}).resultat).toBe("absent");
  });

  it("chaîne : interrompue, dégradée, ok — et inconnue quand l'émission est sautée", () => {
    expect(etatChaine({ emission: "ok", ecriture: "ok" })).toBe("ok");
    expect(etatChaine({ emission: "lent", ecriture: "ok" })).toBe("degradee");
    expect(etatChaine({ emission: "ok", ecriture: "echec" })).toBe("degradee");
    expect(etatChaine({ emission: "ok", ecriture: "ok", chemin: "local" })).toBe("degradee");
    expect(etatChaine({ emission: "echec", ecriture: "absent" })).toBe("interrompue");
    expect(etatChaine({ emission: "ok", ecriture: "absent" })).toBe("interrompue");
    expect(etatChaine({ emission: "saute", ecriture: "saute" })).toBeNull();
  });

  it("le chemin ne se lit que dans l'en-tête du relais, et seulement s'il est connu", () => {
    expect(cheminDeReponse(new Headers({ "x-mip-chemin": "relais" }))).toBe("relais");
    expect(cheminDeReponse(new Headers({ "x-mip-chemin": " Local " }))).toBe("local");
    expect(cheminDeReponse(new Headers({ "x-mip-chemin": "ailleurs" }))).toBeNull();
    expect(cheminDeReponse(new Headers())).toBeNull();
  });
});

describe("le registre des fenêtres", () => {
  const A = new Date("2026-09-29T21:15:00Z");

  it("ok sans fenêtre : rien ; ok avec une fenêtre : elle se ferme à l'émission", () => {
    expect(planRegistre({ ouverte: null, etat: "ok", a: A })).toEqual([]);
    expect(planRegistre({ ouverte: { id: 7, etat: "interrompue" }, etat: "ok", a: A })).toEqual([{ op: "fermer", id: 7, fin: A }]);
  });

  it("même état : la fenêtre se prolonge ; autre état : l'ancienne se ferme, une nouvelle s'ouvre", () => {
    expect(planRegistre({ ouverte: { id: 7, etat: "degradee" }, etat: "degradee", a: A, preuve: "p" })).toEqual([
      { op: "prolonger", id: 7, preuve: "p" },
    ]);
    expect(planRegistre({ ouverte: { id: 7, etat: "degradee" }, etat: "interrompue", a: A, cause: "c" })).toEqual([
      { op: "fermer", id: 7, fin: A },
      { op: "ouvrir", etat: "interrompue", debut: A, cause: "c", preuve: null },
    ]);
    expect(planRegistre({ ouverte: null, etat: "degradee", a: A })).toEqual([
      { op: "ouvrir", etat: "degradee", debut: A, cause: null, preuve: null },
    ]);
  });

  it("un passage sans verdict (clé renouvelée) ne touche pas le registre", () => {
    expect(planRegistre({ ouverte: { id: 7, etat: "interrompue" }, etat: null, a: A })).toEqual([]);
  });

  it("reconstitution : seulement au-delà de 2 × cadence + 5 min de silence, de dernier + cadence à maintenant", () => {
    const dernier = new Date("2026-09-29T20:00:00Z");
    expect(planReconstitution({ dernierPassage: null, maintenant: A, cadenceMin: 15 })).toBeNull();
    // 35 min pile à 15 min de cadence : encore un passage manqué ordinaire.
    expect(planReconstitution({ dernierPassage: dernier, maintenant: new Date("2026-09-29T20:35:00Z"), cadenceMin: 15 })).toBeNull();
    expect(planReconstitution({ dernierPassage: dernier, maintenant: A, cadenceMin: 15 })).toEqual({
      debut: new Date("2026-09-29T20:15:00Z"),
      fin: A,
    });
  });
});

/** Un faux pool qui répond selon le texte de la requête et garde la trace des appels. */
function poolFactice(reponses: Array<[RegExp, (params: unknown[]) => unknown[]]> = []) {
  const appels: Array<{ text: string; params: unknown[] }> = [];
  return {
    appels,
    query: vi.fn(async (q: string | { text: string }, params: unknown[] = []) => {
      const text = typeof q === "string" ? q : q.text;
      appels.push({ text, params });
      for (const [motif, rep] of reponses) if (motif.test(text)) return { rows: rep(params) };
      return { rows: [] };
    }),
  };
}

const muet = { info: () => {}, warn: vi.fn(), error: () => {} };

describe("le travail du tick", () => {
  function monter({ statut = 200, ecrite = 0, presence = true, horloge = 1_000_000 } = {}) {
    let t = horloge;
    const pool = poolFactice([
      [/to_regclass/, () => [{ present: true }]],
      [/with app as/, () => [{ presente: 1, ecrite }]],
      [/select exists\(select 1 from rum_session/, () => [Object.fromEntries(TABLES_VERIFIEES.map((x: string) => [x, presence]))]],
      [/select max\(emis_at\)/, () => [{ dernier: null }]],
      [/from collecte_fenetre where portee = '\*'/, () => []],
      [/insert into collecte_fenetre/, () => [{ id: 1 }]],
      [/check_collecte_silence/, () => [{ r: { ouvertes: 0 } }]],
    ]);
    const envois: Array<{ url: string; init: { body: string; headers: Record<string, string> } }> = [];
    const fetchImpl = vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
      envois.push({ url, init });
      t += 150;
      return new Response(null, { status: statut });
    });
    const sondes = creerSondes({ pool, url: "https://ingest.example.test/api/ingest/v1/traces", log: muet, fetchImpl, maintenant: () => t, cle: CLE });
    return { pool, envois, sondes };
  }

  it("émet le lot avec la clé en ressource, n'écrit en base que l'empreinte, puis journalise en UN insert", async () => {
    const { pool, envois, sondes } = monter();
    const e = await sondes.emettre.run();
    expect(e).toMatchObject({ resultat: "ok", http_status: 200, latence_ms: 150 });
    expect(envois).toHaveLength(1);
    expect(envois[0].init.headers["content-type"]).toBe("application/json");
    expect(envois[0].init.body).toContain(CLE);
    const ecriture = pool.appels.find((a) => /with app as/.test(a.text))!;
    expect(ecriture.params).toEqual([APP_CANARI, createHash("sha256").update(CLE).digest("hex")]);
    expect(JSON.stringify(pool.appels.map((a) => a.params))).not.toContain(CLE);

    const v = await sondes.verifier.run();
    expect(v).toMatchObject({ etat: "ok", emission: "ok", ecriture: "ok", reconstitution: false, alerte_canari: null });
    const inserts = pool.appels.filter((a) => /insert into sonde_passage/.test(a.text));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toContain("ingest_console");
    expect(inserts[0].params).toContain("ecriture");
    // L'alerte d'absence tourne, chaîne en service.
    expect(pool.appels.find((a) => /check_collecte_silence/.test(a.text))!.params).toEqual([60, true]);
  });

  it("un 403 juste après avoir écrit la clé : passage sauté, registre intact", async () => {
    const { pool, sondes } = monter({ statut: 403, ecrite: 1 });
    expect(GRACE_CLE_MS).toBeGreaterThan(60_000);
    expect(await sondes.emettre.run()).toMatchObject({ resultat: "saute" });
    const v = await sondes.verifier.run();
    expect(v).toMatchObject({ etat: "inconnu", emission: "saute", ecriture: "saute" });
    expect(pool.appels.some((a) => /insert into collecte_fenetre/.test(a.text))).toBe(false);
  });

  it("un 503 : échec, fenêtre « interrompue » ouverte, alerte d'absence des apps suspendue", async () => {
    const { pool, sondes } = monter({ statut: 503, presence: false });
    expect(await sondes.emettre.run()).toMatchObject({ resultat: "echec" });
    const v = await sondes.verifier.run();
    expect(v).toMatchObject({ etat: "interrompue", emission: "echec", ecriture: "absent" });
    const ouverture = pool.appels.find((a) => /insert into collecte_fenetre/.test(a.text))!;
    expect(ouverture.params[0]).toBe("interrompue");
    expect(pool.appels.find((a) => /check_collecte_silence/.test(a.text))!.params).toEqual([60, false]);
  });

  it("le tick l'encadre : émission en tête, vérification avant la livraison ; sans sondes, rien ne change", async () => {
    const { sondes } = monter();
    const ordre: string[] = [];
    const pool = poolFactice();
    const bilan = await travaux(pool as never, {
      log: muet,
      dispatch: async () => ordre.push("dispatch"),
      sondes: {
        emettre: { name: "canari_emettre", run: async () => ordre.push("emettre") },
        verifier: { name: "canari_verifier", run: async () => ordre.push("verifier") },
      },
    }).tick();
    expect(Object.keys(bilan.resultats)[0]).toBe("canari_emettre");
    expect(ordre).toEqual(["emettre", "verifier", "dispatch"]);
    const sans = await travaux(poolFactice() as never, { log: muet }).tick();
    expect(Object.keys(sans.resultats)).not.toContain("canari_emettre");
    expect(sondes.empreinte).toMatch(/^[0-9a-f]{64}$/);
  });
});
