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
  SEUILS_C2,
  TABLES_VERIFIEES,
  URL_COLLECTOR_DEFAUT,
  cheminDeReponse,
  construireLotCanari,
  creerSondes,
  decisionSilence,
  etatChaine,
  heureLocale,
  heuresTouchees,
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

  it("deux chemins (C1 console, C2 collector) : interrompue si les deux échouent, dégradée si un seul (A3 § 2.4)", () => {
    const ok = { emission: "ok", ecriture: "ok" };
    const tombe = { emission: "echec", ecriture: null };
    expect(etatChaine({ ...ok, c2: ok })).toBe("ok");
    expect(etatChaine({ emission: "echec", ecriture: "absent", c2: ok })).toBe("degradee");
    expect(etatChaine({ ...ok, c2: tombe })).toBe("degradee");
    // Le collector répond 200 mais n'écrit rien : c'est un échec du chemin.
    expect(etatChaine({ ...ok, c2: { emission: "ok", ecriture: "absent" } })).toBe("degradee");
    expect(etatChaine({ emission: "echec", ecriture: "absent", c2: tombe })).toBe("interrompue");
    expect(etatChaine({ ...ok, c2: { emission: "lent", ecriture: "ok" } })).toBe("degradee");
    // Un chemin sauté (clé renouvelée) n'a rien prouvé : l'autre ne peut pas, seul,
    // déclarer la chaîne coupée — au pire dégradée (relevé du 30/09/2026).
    expect(etatChaine({ emission: "saute", ecriture: "saute", c2: tombe })).toBe("degradee");
    expect(etatChaine({ emission: "echec", ecriture: "absent", c2: { emission: "saute" } })).toBe("degradee");
    expect(etatChaine({ emission: "saute", ecriture: "saute", c2: ok })).toBe("ok");
    expect(etatChaine({ emission: "saute", c2: { emission: "saute" } })).toBeNull();
  });

  it("C2 a ses propres seuils : ok ≤ 1,5 s, lent jusqu'à 4 s (échéance dure du collector), échec au-delà", () => {
    expect(jugerEmission({ statut: 200, latenceMs: 1_500 }, SEUILS_C2)).toBe("ok");
    expect(jugerEmission({ statut: 200, latenceMs: 1_501 }, SEUILS_C2)).toBe("lent");
    expect(jugerEmission({ statut: 200, latenceMs: 4_001 }, SEUILS_C2)).toBe("echec");
    expect(URL_COLLECTOR_DEFAUT).toBe("https://collector-production-d769.up.railway.app/v1/traces");
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
  function monter({
    statut = 200,
    ecrite = 0,
    presence = true,
    horloge = 1_000_000,
    etatSilence = [] as unknown[],
    // C2 coupé par défaut : ces cas-ci tiennent le chemin de la console seul.
    urlCollector = null as string | null,
    statutC2 = 200,
    presenceC2 = true,
  } = {}) {
    let t = horloge;
    const pool = poolFactice([
      [/to_regclass/, () => [{ present: true }]],
      [/with app as/, () => [{ presente: 1, ecrite }]],
      [
        /select exists\(select 1 from rum_session/,
        (params) => [
          Object.fromEntries(TABLES_VERIFIEES.map((x: string) => [x, String(params[1]).endsWith("-c2") ? presenceC2 : presence])),
        ],
      ],
      [/sonde_reconstituer_uptime/, () => [{ n: 0 }]],
      [/select max\(emis_at\)/, () => [{ dernier: null }]],
      [/from collecte_fenetre where portee = '\*'/, () => []],
      [/insert into collecte_fenetre/, () => [{ id: 1 }]],
      [/sonde_etat_silence/, () => etatSilence],
      [/sonde_ouvrir_silence/, () => [{ alerte: 99 }]],
      [/sonde_fermer_silence/, () => [{ ok: true }]],
    ]);
    const envois: Array<{ url: string; init: { body: string; headers: Record<string, string> } }> = [];
    const fetchImpl = vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
      envois.push({ url, init });
      const c2 = url === urlCollector;
      return new Response(null, { status: c2 ? statutC2 : statut });
    });
    const horlogeParChemin = { t0: t };
    const sondes = creerSondes({
      pool,
      url: "https://ingest.example.test/api/ingest/v1/traces",
      urlCollector,
      log: muet,
      fetchImpl: async (u: string, init: { body: string; headers: Record<string, string> }) => {
        const r = await fetchImpl(u, init);
        // Les deux chemins partent ensemble : chacun mesure 150 ms.
        t = horlogeParChemin.t0 + 150;
        return r;
      },
      maintenant: () => t,
      cle: CLE,
    });
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
    // L'alerte d'absence lit ses faits en UNE requête (habitude : 4 jours sur 7).
    expect(pool.appels.find((a) => /sonde_etat_silence/.test(a.text))!.params).toEqual([7, 4]);
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
  });

  it("C2 : le même lot, en direct sur le collector, avec la même clé ; journalisé `ingest_collector`, chemin direct", async () => {
    const C2 = "https://collector.example.test/v1/traces";
    const { pool, envois, sondes } = monter({ urlCollector: C2 });
    const e = await sondes.emettre.run();
    expect(e).toMatchObject({ resultat: "ok", c2: { resultat: "ok", http_status: 200 } });
    expect(envois.map((x) => x.url).sort()).toEqual([C2, "https://ingest.example.test/api/ingest/v1/traces"].sort());
    const lotC2 = envois.find((x) => x.url === C2)!.init.body;
    expect(lotC2).toContain(CLE);
    expect(lotC2).toContain("-c2");
    const v = await sondes.verifier.run();
    expect(v).toMatchObject({ etat: "ok", collector: "ok", reconstitution_uptime: 0 });
    const insert = pool.appels.find((a) => /insert into sonde_passage/.test(a.text))!;
    expect(insert.params).toContain("ingest_collector");
    expect(insert.params).toContain("direct");
  });

  it("C1 tombe, C2 passe : chaîne dégradée (pas d'alerte canari) ; les deux tombent : interrompue", async () => {
    const C2 = "https://collector.example.test/v1/traces";
    const un = monter({ urlCollector: C2, statut: 503, presence: false });
    await un.sondes.emettre.run();
    expect(await un.sondes.verifier.run()).toMatchObject({ etat: "degradee", emission: "echec", collector: "ok", alerte_canari: null });
    const ouverture = un.pool.appels.find((a) => /insert into collecte_fenetre/.test(a.text))!;
    expect(ouverture.params[0]).toBe("degradee");
    expect(ouverture.params[2]).toMatch(/chemin console en échec/);

    const deux = monter({ urlCollector: C2, statut: 503, presence: false, statutC2: 503, presenceC2: false });
    await deux.sondes.emettre.run();
    expect(await deux.sondes.verifier.run()).toMatchObject({ etat: "interrompue", collector: "echec" });

    // Le collector répond 200 sans écrire : `absent`, le chemin compte comme tombé.
    const trois = monter({ urlCollector: C2, presenceC2: false });
    await trois.sondes.emettre.run();
    expect(await trois.sondes.verifier.run()).toMatchObject({ etat: "degradee", collector: "absent" });
  });

  it("premier démarrage : la reconstitution depuis uptime_result, une fois par processus", async () => {
    const { pool, sondes } = monter();
    for (let i = 0; i < 2; i++) {
      await sondes.emettre.run();
      await sondes.verifier.run();
    }
    const appels = pool.appels.filter((a) => /sonde_reconstituer_uptime/.test(a.text));
    expect(appels).toHaveLength(1);
    expect(appels[0].params).toEqual([30, 15]);
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

describe("l'alerte d'absence : un silence ANORMAL seulement", () => {
  const PARIS = "Europe/Paris";
  // Trafic simulé de gip-plateforme : 10 h à 17 h, et un filet de nuit de 0 h à 6 h.
  const JOUR = [10, 11, 12, 13, 14, 15, 16];
  const JOUR_ET_NUIT = [0, 1, 2, 3, 4, 5, ...JOUR];
  // Lundi 28 et mardi 29/09/2026, heure d'été : Paris = UTC + 2.
  const paris = (jour: number, h: number, m = 0) => Date.UTC(2026, 8, jour, h - 2, m);

  it("l'heure locale et les heures touchées suivent le fuseau de l'application", () => {
    expect(heureLocale(paris(29, 11, 5), PARIS)).toBe(11);
    expect(heureLocale(paris(29, 0, 30), PARIS)).toBe(0);
    expect(heuresTouchees(paris(29, 10, 5), paris(29, 11, 5), PARIS)).toEqual([10, 11]);
    expect(heuresTouchees(paris(29, 10, 0), paris(29, 10, 45), PARIS)).toEqual([10]);
  });

  it("trafic de jour : muette depuis 17 h, pas d'alerte le soir", () => {
    for (const [h, m] of [[18, 5], [19, 0], [21, 30], [23, 45]]) {
      const d = decisionSilence({
        dernier: new Date(paris(28, 17, 0)),
        maintenant: paris(28, h, m),
        silenceMin: 60,
        fuseau: PARIS,
        heuresHabituelles: JOUR_ET_NUIT,
        ouverte: false,
      });
      expect(d, `${h}:${m}`).toMatchObject({ action: "rien", raison: "heure creuse" });
    }
  });

  it("trafic habituel à 11 h, absent un mardi à 11 h : alerte — même si le silence a traversé la nuit", () => {
    const d = decisionSilence({
      dernier: new Date(paris(28, 17, 0)), // lundi, fin des robots ; rien depuis
      maintenant: paris(29, 11, 5),
      silenceMin: 60,
      fuseau: PARIS,
      heuresHabituelles: JOUR,
      ouverte: false,
    });
    expect(d).toEqual({ action: "ouvrir", heures: [10, 11] });
    // Mardi à 10 h 30, l'heure de 9 h est encore dans la queue du silence : pas encore.
    expect(
      decisionSilence({
        dernier: new Date(paris(28, 17, 0)),
        maintenant: paris(29, 10, 30),
        silenceMin: 60,
        fuseau: PARIS,
        heuresHabituelles: JOUR,
        ouverte: false,
      }),
    ).toMatchObject({ action: "rien", raison: "heure creuse" });
  });

  it("une seule alerte par épisode, fermée au retour de la donnée", () => {
    const base = { silenceMin: 60, fuseau: PARIS, heuresHabituelles: JOUR };
    expect(decisionSilence({ ...base, dernier: new Date(paris(29, 9, 0)), maintenant: paris(29, 12, 0), ouverte: true })).toMatchObject({
      action: "rien",
      raison: "épisode en cours",
    });
    expect(decisionSilence({ ...base, dernier: new Date(paris(29, 11, 50)), maintenant: paris(29, 12, 0), ouverte: true })).toEqual({
      action: "fermer",
    });
    expect(decisionSilence({ ...base, dernier: new Date(paris(29, 11, 50)), maintenant: paris(29, 12, 0), ouverte: false })).toEqual({
      action: "rien",
    });
  });

  it("muette quand la chaîne est coupée ; rien à juger sans donnée récente ; sans heure habituelle, aucune alerte", () => {
    const base = { silenceMin: 60, fuseau: PARIS, maintenant: paris(29, 11, 5), ouverte: false };
    expect(decisionSilence({ ...base, dernier: new Date(paris(29, 9, 0)), heuresHabituelles: JOUR, chaineOk: false })).toMatchObject({
      raison: "chaîne coupée",
    });
    expect(decisionSilence({ ...base, dernier: null, heuresHabituelles: JOUR })).toMatchObject({ action: "rien" });
    expect(decisionSilence({ ...base, dernier: new Date(paris(29, 9, 0)), heuresHabituelles: [] })).toMatchObject({ raison: "heure creuse" });
  });

  it("le tick : ouvre UNE fois pour l'app muette à une heure habituelle, laisse les autres tranquilles", async () => {
    const maintenant = paris(29, 11, 5);
    const pool = poolFactice([
      [
        /sonde_etat_silence/,
        () => [
          { app_id: "muette", fuseau: PARIS, dernier: new Date(paris(28, 17, 0)), heures_habituelles: JOUR, fenetre_id: null },
          { app_id: "deja", fuseau: PARIS, dernier: new Date(paris(28, 17, 0)), heures_habituelles: JOUR, fenetre_id: 5 },
          { app_id: "nuit", fuseau: PARIS, dernier: new Date(paris(29, 6, 0)), heures_habituelles: [0, 1, 2, 3, 4, 5], fenetre_id: null },
        ],
      ],
      [/sonde_ouvrir_silence/, () => [{ alerte: 42 }]],
      [/to_regclass/, () => [{ present: true }]],
      [/with app as/, () => [{ presente: 1, ecrite: 0 }]],
      [/select exists\(select 1 from rum_session/, () => [Object.fromEntries(TABLES_VERIFIEES.map((x: string) => [x, true]))]],
    ]);
    const sondes = creerSondes({
      pool,
      log: muet,
      cle: CLE,
      maintenant: () => maintenant,
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    await sondes.emettre.run();
    const v = await sondes.verifier.run();
    expect(v.silence).toEqual({ ouvertes: 1, fermees: 0, alertes: 1, heures_creuses: 1 });
    const ouvertures = pool.appels.filter((a) => /sonde_ouvrir_silence/.test(a.text));
    expect(ouvertures.map((a) => a.params)).toEqual([["muette", new Date(paris(28, 17, 0)), 60, [10, 11]]]);
  });
});
