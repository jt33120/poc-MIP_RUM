// /sessions — les colonnes « Frustration » et « Rejeu » de la liste (recette du 26/09/2026).
//
// La page forçait les deux signaux à `null` (`page.map((s) => ({ ...s, frustration:
// null, rejeu: null }))`) : « — » sur chaque ligne, et donc « pas de rejeu » pour
// 140 sessions de la démo qui en avaient un. Ces tests rendent la page avec une
// lecture simulée et vérifient que ce que le chargeur LIT arrive dans la table :
// un compte de signaux, un lien vers le rejeu, et « — » seulement quand la lecture
// manque (session mobile sans capteur, lecture en échec) — jamais un « 0 » inventé.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAnalyticsQuery } from "@/lib/query-contract";
import type { SessionRow } from "@/lib/queries";

const { donnees } = vi.hoisted(() => ({ donnees: { courant: null as unknown } }));

vi.mock("@/lib/ecran", () => ({
  avecBlocs: async (sp: Record<string, string>) => sp,
  chargerEcran: async () => donnees.courant,
}));
vi.mock("@/components/states/SectionErreur", () => ({
  EchecLecture: ({ titre }: { titre: string }) => <div data-echec={titre} />,
  SectionErreur: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const query = (() => {
  const p = parseAnalyticsQuery(new URLSearchParams("app=demo-app&period=24h"), {
    principal: { role: "admin", apps: null },
    nowMs: Date.now(),
  });
  if (!p.ok) throw new Error(p.error.code);
  return p.value;
})();

const T0 = Date.now() - 3_600_000;
function session(id: string, o: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: id,
    app_id: "demo-app",
    device_type: "desktop",
    geo_country: "FR",
    user_agent: "Mozilla/5.0 Firefox/130.0",
    started_at: new Date(T0).toISOString(),
    last_seen_at: new Date(T0 + 60_000).toISOString(),
    page_count: 3,
    routes: ["/", "/partners"],
    err_count: 0,
    collection_source: "sdk",
    cursor_ts: new Date(T0 + 60_000).toISOString(),
    ...o,
  };
}

const echec = { ok: false, code: "lecture_en_echec" } as const;
const cle = (id: string) => `demo-app\u0000${id}`;

function lecture(signaux: unknown) {
  return {
    etat: "ok",
    query,
    label: "24 h",
    prev: false,
    schema: [],
    rows: { ok: true, data: [session("avec-rejeu-7"), session("sans-rejeu-3"), session("mobile-sans-capteur", { runtime: "react_native" })] },
    vs: echec,
    tendance: echec,
    tendancePrec: { ok: true, data: null },
    engagementLu: echec,
    engagementPrec: { ok: true, data: null },
    visiteursLu: echec,
    visiteursPrec: { ok: true, data: null },
    erreursLu: echec,
    erreursPrec: { ok: true, data: null },
    repartition: { ok: true, data: null },
    deploys: { ok: true, data: [] },
    releaseParOccurrence: true,
    echantillonnage: echec,
    couvSessions: [],
    couvTaux: [],
    couvErreurs: [],
    couvVisiteurs: [],
    panneauLu: null,
    signaux,
  };
}

const { default: Sessions } = await import("@/app/sessions/page");

async function rendre(): Promise<string> {
  return renderToStaticMarkup(await Sessions({ searchParams: Promise.resolve({ app: "demo-app" }) }));
}

/** La rangée de table d'une session (rendu `sm` et plus), repérée par le lien de son panneau. */
function rangee(html: string, id: string): string {
  const lien = html.indexOf(`panel=session%3A${id}"`);
  expect(lien, `ligne ${id} rendue`).toBeGreaterThan(-1);
  const debut = html.lastIndexOf("<tr", lien);
  return html.slice(debut, html.indexOf("</tr>", debut));
}

beforeEach(() => {
  donnees.courant = lecture({
    ok: true,
    data: {
      [cle("avec-rejeu-7")]: { frustration: 7, rejeu: true },
      [cle("sans-rejeu-3")]: { frustration: 3, rejeu: false },
      [cle("mobile-sans-capteur")]: { frustration: null, rejeu: false },
    },
  });
});

describe("/sessions — Frustration et Rejeu viennent de la lecture, plus d'un null forcé", () => {
  it("le rejeu lu s'ouvre depuis la ligne ; l'absence lue s'écrit « Non »", async () => {
    const html = await rendre();
    const avec = rangee(html, "avec-rejeu-7");
    expect(avec).toContain("tab=replay");
    expect(avec).toContain("▶ Rejeu");
    expect(rangee(html, "sans-rejeu-3")).toContain(">Non<");
  });

  /** Les deux dernières cellules d'une rangée : Frustration, puis Rejeu. */
  const signauxDe = (tr: string) => {
    const cellules = tr.split("<td").slice(1);
    return { frustration: cellules.at(-2) ?? "", rejeu: cellules.at(-1) ?? "" };
  };

  it("le compte de signaux est écrit ; une session mobile sans capteur reste « — », jamais 0", async () => {
    const html = await rendre();
    expect(signauxDe(rangee(html, "avec-rejeu-7")).frustration).toMatch(/>7<\/td>$/);
    expect(signauxDe(rangee(html, "sans-rejeu-3")).frustration).toMatch(/>3<\/td>$/);
    const mobile = signauxDe(rangee(html, "mobile-sans-capteur"));
    expect(mobile.frustration).toContain('data-testid="signal-non-lu"');
    expect(mobile.frustration).not.toMatch(/>0</);
    expect(mobile.rejeu).toContain(">Non<");
  });

  it("lecture des signaux en échec : « — » partout, la liste reste lisible", async () => {
    donnees.courant = lecture(echec);
    const html = await rendre();
    expect(rangee(html, "avec-rejeu-7")).toContain('data-testid="signal-non-lu"');
    expect(html).not.toContain("tab=replay");
  });
});
