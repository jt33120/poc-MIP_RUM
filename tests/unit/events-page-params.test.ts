import { describe, expect, it } from "vitest";
import {
  eventPagePagination,
  eventResetHref,
  eventSearchParams,
} from "../../apps/console/lib/events-page-params";
import { parseAnalyticsQuery } from "../../apps/console/lib/query-contract";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const ADMIN = { role: "admin" as const, apps: null };

describe("paramètres de la page Événements", () => {
  it("refuse les query params répétés au lieu d'en choisir un silencieusement", () => {
    expect(eventSearchParams({ name: ["checkout", "signup"] })).toBeNull();
    expect(eventSearchParams({ app: ["tenant-a", "tenant-b"] })).toBeNull();
  });

  it("force offset=0 lorsqu'un curseur stable est fourni", () => {
    expect(eventPagePagination({ limit: 25, offset: 500 }, { ts: "x", id: "1" })).toEqual({
      limit: 25,
      offset: 0,
    });
    expect(eventPagePagination({ limit: 25, offset: 500 }, null).offset).toBe(500);
  });

  it("réinitialise seulement les filtres événementiels, tablette et contexte global compris", () => {
    const url = eventSearchParams({
      app: "demo-app",
      period: "7d",
      device: "tablet",
      browser: "Firefox",
      seg: "geo==FR",
      bots: "1",
      name: "checkout",
      attr_source: "props",
      cursor: "abc",
      offset: "20",
    });
    const parsed = parseAnalyticsQuery(url!, { principal: ADMIN, nowMs: NOW });
    if (!parsed.ok) throw new Error(parsed.error.code);
    const href = eventResetHref(parsed.value);
    expect(href).toBe("/events?app=demo-app&period=7d&device=tablet&browser=Firefox&seg=v2%3Acountry%3Aeq%3AFR&bots=1");
    expect(href).not.toMatch(/name|attr_|cursor|offset/);
  });

  it("garde une plage personnalisée telle quelle, bornes UTC comprises", () => {
    const parsed = parseAnalyticsQuery(
      new URLSearchParams("app=demo-app&from=2026-09-10T00:00:00Z&to=2026-09-11T00:00:00Z&name=x"),
      { principal: ADMIN, nowMs: NOW },
    );
    if (!parsed.ok) throw new Error(parsed.error.code);
    expect(eventResetHref(parsed.value)).toBe(
      "/events?app=demo-app&from=2026-09-10T00%3A00%3A00.000Z&to=2026-09-11T00%3A00%3A00.000Z",
    );
  });
});

// ─────────────────────────── F25 — liens du Journal ───────────────────────────
import { cleSansValeur, lienJournal, lienPanneauJournal, paginationJournal } from "../../apps/console/lib/events-page-params";

describe("Journal (F25) : facettes, panneau, pagination", () => {
  const courant = new URLSearchParams("app=demo-app&period=1h&name=checkout&cursor=abc&offset=20&panel=event%3A42&limit=10");

  it("un clic de facette garde population et filtres, repart de la 1re page et ferme le panneau", () => {
    const href = lienJournal(courant, { attr_source: "props", attr_key: "plan", attr_type: null, attr_value: null });
    const p = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/events?")).toBe(true);
    expect(p.get("app")).toBe("demo-app");
    expect(p.get("period")).toBe("1h");
    expect(p.get("name")).toBe("checkout");
    expect(p.get("attr_source")).toBe("props");
    expect(p.get("attr_key")).toBe("plan");
    expect(p.get("limit")).toBe("10");
    for (const nom of ["cursor", "offset", "panel", "attr_type", "attr_value"]) expect(p.has(nom)).toBe(false);
  });

  it("clic sur un nom : `?name=<nom>` remplace le nom courant", () => {
    const p = new URLSearchParams(lienJournal(courant, { name: "signup" }).split("?")[1]);
    expect(p.getAll("name")).toEqual(["signup"]);
  });

  it("panneau : même liste (curseur compris), seul `panel` change ; fermer le retire", () => {
    const ouvrir = new URLSearchParams(lienPanneauJournal(courant, "event:7").split("?")[1]);
    expect(ouvrir.get("panel")).toBe("event:7");
    expect(ouvrir.get("cursor")).toBe("abc");
    const fermer = new URLSearchParams(lienPanneauJournal(courant, null).split("?")[1]);
    expect(fermer.has("panel")).toBe(false);
    expect(fermer.get("cursor")).toBe("abc");
    expect(lienPanneauJournal(new URLSearchParams("panel=event%3A1"), null)).toBe("/events");
  });

  it("clé choisie sans valeur : reconnue, et retirée de l'URL lue ; filtre complet ou type explicite : non", () => {
    const choisie = cleSansValeur(new URLSearchParams("app=a&attr_source=props&attr_key=plan"));
    expect(choisie?.cle).toEqual({ source: "props", key: "plan" });
    expect(choisie?.sansCle.toString()).toBe("app=a");
    expect(cleSansValeur(new URLSearchParams("attr_source=props&attr_key=plan&attr_type=string"))?.cle.key).toBe("plan");
    expect(cleSansValeur(new URLSearchParams("attr_source=props&attr_key=plan&attr_type=string&attr_value=pro"))).toBeNull();
    // Le formulaire soumet toujours `attr_value`, même vide : c'est un filtre sur « ».
    expect(cleSansValeur(new URLSearchParams("attr_source=props&attr_key=plan&attr_type=string&attr_value="))).toBeNull();
    expect(cleSansValeur(new URLSearchParams("attr_source=props&attr_key=plan&attr_type=number"))).toBeNull();
    expect(cleSansValeur(new URLSearchParams("attr_source=props"))).toBeNull();
    expect(cleSansValeur(new URLSearchParams(""))).toBeNull();
  });

  it("50 lignes par défaut ; un `limit` explicite l'emporte ; un curseur remet l'offset à 0", () => {
    expect(paginationJournal(new URLSearchParams(""), { limit: 100, offset: 0 }, null)).toEqual({ limit: 50, offset: 0 });
    expect(paginationJournal(new URLSearchParams("limit=1"), { limit: 1, offset: 0 }, null)).toEqual({ limit: 1, offset: 0 });
    expect(paginationJournal(new URLSearchParams(""), { limit: 100, offset: 30 }, { ts: "x", id: "1" })).toEqual({
      limit: 50,
      offset: 0,
    });
  });
});
