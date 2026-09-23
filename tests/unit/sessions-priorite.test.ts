// F42 — ordre de priorité, raisons écrites et liens du hero « À regarder d'abord »
// (plan § 5.11.4). Logique pure : aucune base, aucun rendu.
import { describe, expect, it } from "vitest";
import type { SessionRow } from "@/lib/queries";
import {
  dureeObservee,
  hrefsPriorite,
  instantPremiereErreur,
  instantUtc,
  navigateurDeSession,
  ordonnerPrioritaires,
  parcoursResume,
  raisonEcrite,
  valeurOuInconnu,
  type SessionPrioritaire,
} from "@/lib/sessions-priorite";

const T0 = Date.UTC(2026, 8, 21, 14, 0, 0);

function base(id: string, o: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: id,
    app_id: "a",
    device_type: "desktop",
    geo_country: "FR",
    geo_source: "ip",
    user_agent: null,
    started_at: new Date(T0),
    last_seen_at: new Date(T0 + 60_000),
    page_count: 1,
    routes: null,
    err_count: 0,
    collection_source: "sdk",
    cursor_ts: new Date(T0).toISOString(),
    ...o,
  };
}

function prioritaire(
  id: string,
  v: { err?: number; frustration?: number; api?: number; minutes?: number; rejeu?: boolean | null; premiere?: string | null },
): SessionPrioritaire {
  return {
    ...base(id, { err_count: v.err ?? 0, last_seen_at: new Date(T0 + (v.minutes ?? 0) * 60_000) }),
    frustration: v.frustration ?? 0,
    api_echecs: v.api ?? 0,
    premiere_erreur_ts: v.premiere ?? null,
    rejeu: v.rejeu ?? null,
    raison: { erreurs: [], frustration: [], api: [] },
  };
}

describe("F42 — ordonnerPrioritaires", () => {
  it("classe par occurrences d'erreur, puis frustration, puis appels en échec, puis récence", () => {
    const lignes = [
      prioritaire("recente", { err: 1, frustration: 1, api: 1, minutes: 90 }),
      prioritaire("api", { err: 1, frustration: 1, api: 5, minutes: 10 }),
      prioritaire("frustree", { err: 1, frustration: 9, api: 0, minutes: 10 }),
      prioritaire("erreurs", { err: 7, frustration: 0, api: 0, minutes: 10 }),
      prioritaire("ancienne", { err: 1, frustration: 1, api: 1, minutes: 5 }),
    ];
    expect(ordonnerPrioritaires(lignes).map((s) => s.session_id)).toEqual([
      "erreurs",
      "frustree",
      "api",
      "recente",
      "ancienne",
    ]);
  });

  it("borne à dix lignes et ne modifie pas la liste reçue", () => {
    const lignes = Array.from({ length: 14 }, (_, i) => prioritaire(`s${i}`, { err: i }));
    const classees = ordonnerPrioritaires(lignes);
    expect(classees).toHaveLength(10);
    expect(classees[0].session_id).toBe("s13");
    expect(lignes[0].session_id).toBe("s0");
  });

  it("une limite explicite est respectée ; une limite négative ne rend rien", () => {
    const lignes = [prioritaire("a", { err: 2 }), prioritaire("b", { err: 1 })];
    expect(ordonnerPrioritaires(lignes, 1).map((s) => s.session_id)).toEqual(["a"]);
    expect(ordonnerPrioritaires(lignes, -3)).toEqual([]);
  });
});

describe("F42 — raisonEcrite", () => {
  it("écrit chaque signal dans son unité, sans score composite", () => {
    expect(
      raisonEcrite({
        erreurs: [{ type: "TypeError", occurrences: 3 }],
        frustration: [{ kind: "rage", cible: "Payer", n: 2 }],
        api: [{ methode: "POST", chemin: "/api/panier", statut: 500 }],
      }),
    ).toEqual(["3 occurrences de TypeError", "2 clics de rage sur « Payer »", "1 appel POST /api/panier en 500"]);
  });

  it("accorde le singulier et nomme ce qui manque, sans jamais l'inventer", () => {
    expect(
      raisonEcrite({
        erreurs: [{ type: "  ", occurrences: 1 }],
        frustration: [{ kind: "dead", cible: "", n: 1 }],
        api: [{ methode: "GET", chemin: "/api/stock", statut: null }],
      }),
    ).toEqual(["1 occurrence de type inconnu", "1 clic mort sur une cible inconnue", "1 appel GET /api/stock sans statut lu"]);
  });

  it("aucun signal : aucun fragment (la ligne le dira elle-même)", () => {
    expect(raisonEcrite({ erreurs: [], frustration: [], api: [] })).toEqual([]);
  });
});

describe("F42 — durée, parcours, dimensions", () => {
  it("la durée observée est l'écart des deux observations ; un écart négatif n'est pas une durée", () => {
    expect(dureeObservee(base("a"))).toBe(60_000);
    expect(dureeObservee(base("a", { last_seen_at: new Date(T0 - 1000) }))).toBeNull();
  });

  it("le parcours résume première → dernière route, le reste compté", () => {
    expect(parcoursResume(["/", "/a", "/b", "/panier"])).toEqual({ premiere: "/", derniere: "/panier", reste: 2 });
    expect(parcoursResume(["/"])).toEqual({ premiere: "/", derniere: null, reste: 0 });
    expect(parcoursResume(null)).toBeNull();
    expect(parcoursResume([])).toBeNull();
  });

  it("le navigateur collecté prime ; la déduction par user-agent est signalée", () => {
    expect(navigateurDeSession({ browser: "Chrome", user_agent: "Mozilla/5.0 Firefox/130" })).toEqual({
      texte: "Chrome",
      deduit: false,
    });
    expect(navigateurDeSession({ browser: null, user_agent: "Mozilla/5.0 Firefox/130" })).toEqual({
      texte: "Firefox",
      deduit: true,
    });
    // Ni colonne ni user-agent : « Inconnu », et surtout pas une déduction affichée.
    expect(navigateurDeSession({ browser: null, user_agent: null })).toEqual({ texte: "Inconnu", deduit: false });
  });

  it("une dimension absente se lit « Inconnu », jamais une chaîne vide (V3)", () => {
    expect(valeurOuInconnu(null)).toBe("Inconnu");
    expect(valeurOuInconnu("  ")).toBe("Inconnu");
    expect(valeurOuInconnu("mobile")).toBe("mobile");
  });

  it("les instants sont datés en UTC (V6), et un instant illisible rend « — »", () => {
    expect(instantUtc(new Date(T0))).toBe("21/09 14:00");
    expect(instantUtc(null)).toBe("—");
    expect(instantUtc("pas une date")).toBe("—");
  });
});

describe("F42 — hrefsPriorite", () => {
  const page = (id: string) => `/sessions/${id}?app=a&period=24h`;

  it("▶ mène au rejeu calé sur la première erreur (?tab=replay&at=<ms>)", () => {
    const s = prioritaire("s1", { rejeu: true, premiere: new Date(T0 + 5_000).toISOString() });
    const liens = hrefsPriorite([s], { s1: page("s1") });
    expect(liens.s1.panel).toBe("/sessions/s1?app=a&period=24h");
    expect(liens.s1.rejeu).toBe(`/sessions/s1?app=a&period=24h&tab=replay&at=${T0 + 5_000}`);
  });

  it("sans erreur datée, le rejeu s'ouvre sans position plutôt qu'à un instant inventé", () => {
    const liens = hrefsPriorite([prioritaire("s2", { rejeu: true, premiere: null })], { s2: page("s2") });
    expect(liens.s2.rejeu).toBe("/sessions/s2?app=a&period=24h&tab=replay");
  });

  it("rejeu absent ou non lu : aucun lien (le composant dit lequel des deux)", () => {
    const liens = hrefsPriorite(
      [prioritaire("absent", { rejeu: false }), prioritaire("inconnu", { rejeu: null })],
      { absent: page("absent"), inconnu: page("inconnu") },
    );
    expect(liens.absent.rejeu).toBeNull();
    expect(liens.inconnu.rejeu).toBeNull();
  });

  it("instantPremiereErreur : une date illisible ne devient pas 0", () => {
    expect(instantPremiereErreur(null)).toBeNull();
    expect(instantPremiereErreur("jamais")).toBeNull();
  });
});

describe("F43 — hrefsPriorite ouvre le panneau de session", () => {
  const page = (id: string) => `/sessions/${id}?app=a&period=24h`;
  const panneau = (id: string) => `/sessions?app=a&period=24h&panel=session%3A${id}`;

  it("avec le lien du panneau, la ligne ouvre `panel=session:` ; ▶ reste sur la page de session", () => {
    const s = prioritaire("s1", { rejeu: true, premiere: new Date(T0 + 5_000).toISOString() });
    const liens = hrefsPriorite([s], { s1: page("s1") }, { s1: panneau("s1") });
    expect(liens.s1.panel).toBe(panneau("s1"));
    expect(liens.s1.rejeu).toBe(`${page("s1")}&tab=replay&at=${T0 + 5_000}`);
  });

  it("sans lien de panneau pour une ligne, elle mène à la page (jamais à un lien vide)", () => {
    const liens = hrefsPriorite([prioritaire("s2", {})], { s2: page("s2") }, {});
    expect(liens.s2.panel).toBe(page("s2"));
  });
});
