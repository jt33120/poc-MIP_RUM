// Revue de fin de vague 7 — « Sessions de cette heure » de la table des angles morts
// (components/correlation/TableAnglesMorts.tsx), rendu SSR réel.
//
// Le lien portait `route=`, que `/sessions` refuse (une session ne porte pas de
// route) : il ouvrait toujours un écran de refus. Il passe désormais par
// `sessionsDeLaRoute` (lib/breakdowns.ts) ; quand `/sessions` ne sait pas appliquer
// la population, la table n'offre pas de lien : le libellé reste en texte, avec la
// raison en `title` et en texte accessible.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableAnglesMorts, type LigneAngleMort } from "@/components/correlation/TableAnglesMorts";
import { sessionsDeLaRoute } from "@/lib/breakdowns";
import type { DimensionSchema } from "@/lib/query-compiler";
import { parseAnalyticsQuery, type AnalyticsQuery } from "@/lib/query-contract";

const HEURE = "2026-09-17T09:00:00.000Z";
const FIN = "2026-09-17T10:00:00.000Z";
const SCHEMA: DimensionSchema = new Set(["rum_session.device_type", "rum_metric.route", "syn_snapshot.route_hint"]);

function requete(qs: string): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), {
    principal: { role: "admin", apps: null },
    nowMs: Date.parse("2026-09-17T12:00:00.000Z"),
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

/** Une ligne d'angle mort de `/f17-panier`, son lien de sessions calculé comme par l'écran. */
function ligne(qs: string): LigneAngleMort {
  return {
    cle: `a|/f17-panier|${HEURE}|0`,
    app_id: "a",
    route: "/f17-panier",
    heure: HEURE,
    etatRobot: "ok",
    latenceRobot: 800,
    scenarios: "achat",
    lcpReel: 3200,
    mesures: 40,
    ecartMs: 2400,
    liens: {
      heure: "/correlation?app=a",
      sessions: sessionsDeLaRoute(requete(qs), "/f17-panier", SCHEMA, { app: "a", period: null, from: HEURE, to: FIN }),
      pages: "/pages?app=a&route=%2Ff17-panier",
    },
  };
}

const rendu = (l: LigneAngleMort) => renderToStaticMarkup(<TableAnglesMorts lignes={[l]} avecApp={false} />);

describe("TableAnglesMorts — « Sessions de cette heure »", () => {
  it("ouvre la recherche exacte par route de /sessions sur l'heure de la ligne, jamais `route=`", () => {
    // La page /correlation filtrée sur la route (seule dimension que le robot porte).
    const html = rendu(ligne("app=a&period=24h&route=%2Ff17-panier"));
    const href = html.match(/href="(\/sessions\?[^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
    expect(href).toBeDefined();
    const params = new URL(href!, "https://x").searchParams;
    expect(params.has("route")).toBe(false);
    expect(Object.fromEntries(params)).toEqual({ app: "a", from: HEURE, to: FIN, qf: "route", q: "/f17-panier" });
    expect(html).toContain("Sessions de cette heure");
    expect(html).not.toContain("angle-mort-sessions-indisponible");
  });

  it("sous une condition que /sessions refuse : aucun lien, le libellé en texte et la raison dite", () => {
    // Une exclusion de route n'est pas une recherche exacte : /sessions la refuserait.
    const html = rendu(ligne(`app=a&period=24h&seg=${encodeURIComponent("v2:route:neq:%2Ff17-accueil")}`));
    expect(html).not.toMatch(/href="\/sessions/);
    const indisponible = html.match(/<span[^>]*data-testid="angle-mort-sessions-indisponible"[^>]*>/)?.[0] ?? "";
    expect(indisponible).toContain("« Route » est sans objet pour les sessions");
    // Texte accessible : la même raison, lue après le libellé.
    expect(html).toMatch(/Sessions de cette heure : non proposées.*sr-only[^>]*> — Liste des sessions de la route non proposée/s);
  });
});
