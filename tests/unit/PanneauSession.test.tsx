// PanneauSession (F43, plan § 5.11.4 et § 4.3) : rendu SSR réel, et la lecture gardée.
//
// Ce que ce test protège :
//   - la GARDE : une session d'une app que l'écran ne lit pas rend « introuvable »
//     SANS que sa chronologie ni son rejeu soient lus ; un échec de lecture n'est
//     pas une absence ;
//   - la garde capteur R-F : React Native → « Non collecté », jamais « 0 » — même si
//     la chronologie n'a pas pu être lue ; une session navigateur montre son zéro ;
//   - l'identité : ni `visitor_id`, ni empreinte dans le HTML ;
//   - la mini-cascade en hauteur réduite, les quinze premiers événements, le rejeu
//     à trois états. Le clavier et les largeurs sont joués par
//     tests/e2e/usages-sessions-panneau.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// L'îlot clavier et « Réessayer » lisent le routeur de Next : hors application, un
// routeur inerte (même mécanisme que tests/unit/DetailPanel.test.tsx). `lire`
// relance les signaux de Next par `unstable_rethrow` : rien à relancer ici.
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }), unstable_rethrow: () => {} }));

const { sessionMeta, sessionTimeline, sessionARejeu } = vi.hoisted(() => ({
  sessionMeta: vi.fn(),
  sessionTimeline: vi.fn(),
  sessionARejeu: vi.fn(),
}));
vi.mock("@/lib/queries", () => ({ sessionMeta, sessionTimeline }));
vi.mock("@/lib/session-rejeu", () => ({ sessionARejeu }));
vi.mock("@/lib/log-forward", () => ({ forwardLog: vi.fn(async () => {}) }));

import { PanneauSession, lirePanneauSession, type LecturePanneauSession } from "@/components/sessions/PanneauSession";
import type { SessionMeta, TimelineItem } from "@/lib/queries";

const T0 = Date.UTC(2026, 8, 21, 14, 0, 0);
const VISITEUR = "visiteur-secret-0123456789";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

function meta(o: Partial<SessionMeta> = {}): SessionMeta {
  return {
    session_id: "5c8bd251-aaaa-bbbb",
    app_id: "app-a",
    client_id: null,
    visitor_id: VISITEUR,
    id_kind: "random",
    user_hash: "empreinte-heritee",
    user_agent: "Mozilla/5.0",
    device_type: "desktop",
    geo_country: "FR",
    geo_source: "ip",
    started_at: new Date(T0),
    last_seen_at: new Date(T0 + 372_000),
    page_count: 2,
    collection_source: "sdk",
    browser: "Chrome",
    browser_version: "128",
    os: "Windows",
    os_version: "11",
    release: "1.4.2",
    runtime: "browser",
    ...o,
  };
}

function item(kind: TimelineItem["kind"], s: number, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    kind,
    ts: new Date(T0 + s * 1000),
    title: null,
    detail: null,
    value: null,
    rating: null,
    action_id: null,
    action_name: null,
    ...extra,
  };
}

const CHRONOLOGIE: TimelineItem[] = [
  item("pageview", 0, { title: "/", detail: "navigate" }),
  item("vital", 1, { title: "LCP", detail: "/", value: 2100, rating: "good" }),
  item("action", 10, { title: "Payer", detail: "click · /panier" }),
  item("api", 11, { title: "POST /api/paiement", detail: "500", value: 180, rating: "poor" }),
  item("error", 12, { title: "TypeError", detail: "x is undefined", value: 3 }),
  item("event", 13, { title: "frustration.rage", detail: "{}" }),
  item("pageview", 60, { title: "/panier", detail: "route-change" }),
];

const LIENS = {
  fermerHref: "/sessions?app=app-a",
  pageHref: "/sessions/5c8bd251-aaaa-bbbb?app=app-a",
};

function lue(o: { meta?: Partial<SessionMeta>; timeline?: TimelineItem[] | null; rejeu?: boolean | null } = {}) {
  return {
    etat: "lue",
    meta: meta(o.meta),
    timeline: o.timeline === null ? { ok: false, raison: "base" } : { ok: true, data: o.timeline ?? CHRONOLOGIE },
    rejeu: o.rejeu === null ? { ok: false, raison: "base" } : { ok: true, data: o.rejeu ?? true },
  } as Exclude<LecturePanneauSession, { etat: "introuvable" }>;
}

const rendu = (lecture: Exclude<LecturePanneauSession, { etat: "introuvable" }>, extra: Partial<Parameters<typeof PanneauSession>[0]> = {}) =>
  renderToStaticMarkup(<PanneauSession lecture={lecture} plage="24 dernières heures" avecApp={false} {...LIENS} {...extra} />);

/** Le bloc d'une tuile, repéré par le début de son `aria-label` (« <libellé> <valeur>, … »). */
function tuile(html: string, libelle: string): string {
  const debut = html.indexOf(`aria-label="${libelle}`);
  expect(debut, `tuile « ${libelle} »`).toBeGreaterThanOrEqual(0);
  return html.slice(debut, html.indexOf('aria-label="', debut + 12) === -1 ? undefined : html.indexOf('aria-label="', debut + 12));
}

describe("PanneauSession — en-tête et identité", () => {
  it("un <aside> de type session, titré par l'identifiant TRONQUÉ ; aucun visiteur ni empreinte", () => {
    const html = rendu(lue());
    expect(html).toContain('data-type="session"');
    expect(texte(html)).toContain("Session 5c8bd251…");
    expect(html).not.toContain(VISITEUR);
    expect(html).not.toContain(VISITEUR.slice(0, 8));
    expect(html).not.toContain("empreinte-heritee");
  });

  it("les puces du panneau (§ 5.11.4) : qui, sur quoi, où — la provenance du pays écrite", () => {
    const t = texte(rendu(lue()));
    for (const attendu of ["Appareil desktop", "Navigateur Chrome 128", "Système Windows 11", "Capteur SDK", "Release à l'ouverture 1.4.2"]) {
      expect(t).toContain(attendu);
    }
    expect(t).toMatch(/Pays estimé FR \(provenance : [^)]+\)/);
    // Le visiteur et l'échantillonnage restent à la page de session.
    expect(t).not.toContain("Visiteur");
    expect(t).not.toContain("Échantillonnage");
  });

  it("« App » n'apparaît que si l'écran lit plusieurs apps", () => {
    expect(texte(rendu(lue()))).not.toContain("App app-a");
    expect(texte(rendu(lue(), { avecApp: true }))).toContain("App app-a");
  });

  it("la session entière, pas la plage de l'écran : le panneau le dit", () => {
    const t = texte(rendu(lue()));
    expect(t).toContain("Session entière, du 21/09 14:00 au 21/09 14:06 (UTC)");
    expect(t).toContain("ne dépendent pas de la plage de l'écran (24 dernières heures)");
  });

  it("précédent / suivant : éteint en bout de page, absents hors de la page", () => {
    const bout = rendu(lue(), { precedentHref: null, suivantHref: "/sessions?panel=session%3Ab" });
    expect(bout).toMatch(/<span aria-disabled="true"[^>]*>.*Précédent<\/span>/);
    expect(bout).toContain('href="/sessions?panel=session%3Ab"');
    expect(rendu(lue())).not.toContain("Parcourir la liste");
  });
});

describe("PanneauSession — tuiles et garde capteur (R-F)", () => {
  it("quatre tuiles : durée observée, pages vues, occurrences d'erreur (sommées, V1), frustration", () => {
    const html = rendu(lue());
    expect(html.match(/data-testid="kpi-tile"/g)).toHaveLength(4);
    expect(texte(tuile(html, "Durée observée"))).toContain("6 min 12 s");
    expect(tuile(html, "Pages vues")).toContain('data-testid="kpi-valeur">2<');
    expect(tuile(html, "Occurrences d")).toContain('data-testid="kpi-valeur">3<');
    expect(tuile(html, "Signaux de frustration")).toContain('data-testid="kpi-valeur">1<');
  });

  it("session navigateur sans signal : « 0 », un vrai zéro", () => {
    const html = rendu(lue({ timeline: CHRONOLOGIE.filter((it) => it.kind !== "event") }));
    expect(tuile(html, "Signaux de frustration")).toContain('data-testid="kpi-valeur">0<');
  });

  it("session React Native : « Non collecté », jamais « 0 » — même chronologie illisible", () => {
    for (const timeline of [CHRONOLOGIE.filter((it) => it.kind !== "event"), null]) {
      const bloc = tuile(rendu(lue({ meta: { runtime: "react_native", device_type: "mobile" }, timeline })), "Signaux de frustration");
      expect(bloc).toContain('data-testid="kpi-valeur">—<');
      expect(texte(bloc)).toContain("Non collecté : le SDK mobile n'émet pas de signaux de frustration");
      expect(bloc).not.toContain('data-testid="kpi-valeur">0<');
    }
  });

  it("chronologie illisible : les comptes qui en viennent disent « — » et pourquoi, les autres restent", () => {
    const html = rendu(lue({ timeline: null }));
    expect(tuile(html, "Pages vues")).toContain('data-testid="kpi-valeur">2<');
    expect(texte(tuile(html, "Occurrences d"))).toContain("chronologie non lue : compte non établi");
    expect(texte(tuile(html, "Signaux de frustration"))).toContain("chronologie non lue");
    expect(html.match(/data-testid="echec-lecture"/g)).toHaveLength(2); // cascade et événements
  });

  it("chronologie tronquée à 500 lignes : aucun compte tiré d'elle", () => {
    const longue = [item("pageview", 0, { title: "/" }), ...Array.from({ length: 499 }, (_, i) => item("action", 1 + i, { title: `a${i}` }))];
    const html = rendu(lue({ timeline: longue }));
    expect(texte(tuile(html, "Signaux de frustration"))).toContain("chronologie tronquée à 500 événements");
    expect(texte(html)).toContain("Les 15 premiers événements sur 500 lus (chronologie limitée à 500 lignes)");
  });
});

describe("PanneauSession — cascade, événements, rejeu", () => {
  it("mini-cascade : hauteur réduite, l'aperçu par piste seul, « partiel » dit en tête", () => {
    const html = rendu(lue());
    expect(html).toContain('data-hauteur="reduite"');
    expect(html).toContain('data-testid="cascade-apercu"');
    expect(html).not.toContain('data-testid="cascade-elements"');
    expect(texte(html)).toContain("ressources rattachées à une action seulement");
    // Le nom de l'aperçu (`role="img"`) compte les éléments de chaque piste.
    expect(html).toMatch(/aria-label="Aperçu par piste sur [^"]*Pages vues, 2 éléments ; Actions, 1 élément ; Appels API, 1 élément ; Erreurs, 1 élément/);
  });

  it("les quinze premiers événements, groupés par vue ; la route mène à la même page pour tous", () => {
    const html = rendu(lue());
    expect(html.match(/data-testid="entete-vue"/g)).toHaveLength(2);
    expect(html).toContain('href="/pages?app=app-a&amp;route=%2Fpanier"');
    expect(texte(html)).toContain("6 événement(s), groupés par page vue");
    const beaucoup = [item("pageview", 0, { title: "/" }), ...Array.from({ length: 30 }, (_, i) => item("action", 1 + i, { title: `a${i}` }))];
    expect(texte(rendu(lue({ timeline: beaucoup })))).toContain("Les 15 premiers événements sur 31, groupés par page vue");
  });

  it("rejeu à trois états : présent → ▶ vers le déroulé ; absent → dit ; non lu → le lien et le doute", () => {
    expect(rendu(lue({ rejeu: true }))).toContain('href="/sessions/5c8bd251-aaaa-bbbb?app=app-a&amp;tab=replay"');
    const absent = rendu(lue({ rejeu: false }));
    expect(absent).not.toContain("tab=replay");
    expect(texte(absent)).toContain("Aucun rejeu enregistré pour cette session.");
    expect(texte(rendu(lue({ rejeu: null })))).toContain("Rejeu (existence non lue)");
  });

  it("tuiles et liens mènent à la page de session, filtres conservés", () => {
    const html = rendu(lue());
    expect(html).toContain('href="/sessions/5c8bd251-aaaa-bbbb?app=app-a&amp;tab=erreurs"');
    expect(html).toContain('href="/sessions/5c8bd251-aaaa-bbbb?app=app-a&amp;voir=frustration#chronologie"');
    expect(html).toContain('href="/sessions/5c8bd251-aaaa-bbbb?app=app-a"'); // « Ouvrir en page »
  });

  it("lecture de la session en échec : le panneau s'ouvre et le dit — ce n'est pas « introuvable »", () => {
    const html = rendu({ etat: "echec", id: "5c8bd251-aaaa-bbbb" });
    expect(texte(html)).toContain("Session 5c8bd251…");
    expect(html).toContain('data-testid="echec-lecture"');
    expect(texte(html)).not.toContain("introuvable");
  });
});

describe("lirePanneauSession — la garde passe AVANT toute autre lecture", () => {
  beforeEach(() => {
    sessionMeta.mockReset();
    sessionTimeline.mockReset().mockResolvedValue(CHRONOLOGIE);
    sessionARejeu.mockReset().mockResolvedValue(true);
  });

  it("session absente : introuvable", async () => {
    sessionMeta.mockResolvedValue(null);
    await expect(lirePanneauSession("x", null)).resolves.toEqual({ etat: "introuvable" });
    expect(sessionTimeline).not.toHaveBeenCalled();
  });

  it("app hors de ce que l'écran lit : introuvable, sans lire ni chronologie ni rejeu", async () => {
    sessionMeta.mockResolvedValue(meta({ app_id: "app-b" }));
    await expect(lirePanneauSession("5c8bd251-aaaa-bbbb", ["app-a"])).resolves.toEqual({ etat: "introuvable" });
    await expect(lirePanneauSession("5c8bd251-aaaa-bbbb", [])).resolves.toEqual({ etat: "introuvable" });
    expect(sessionTimeline).not.toHaveBeenCalled();
    expect(sessionARejeu).not.toHaveBeenCalled();
  });

  it("dans le périmètre : chronologie et rejeu lus, bornés à l'app de la session", async () => {
    sessionMeta.mockResolvedValue(meta());
    const r = await lirePanneauSession("5c8bd251-aaaa-bbbb", null);
    expect(r.etat).toBe("lue");
    expect(sessionTimeline).toHaveBeenCalledWith("5c8bd251-aaaa-bbbb", "app-a");
    expect(sessionARejeu).toHaveBeenCalledWith("5c8bd251-aaaa-bbbb", "app-a");
  });

  it("lecture en échec : « echec », jamais « introuvable » (une absence non lue)", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionMeta.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(lirePanneauSession("5c8bd251-aaaa-bbbb", null)).resolves.toEqual({ etat: "echec", id: "5c8bd251-aaaa-bbbb" });
    erreur.mockRestore();
  });
});
