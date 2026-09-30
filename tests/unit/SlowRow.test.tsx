// La ligne d'une trace lente et sa mini-cascade (recette du 30/09/2026).
//
// Ce que ces tests verrouillent :
//   · la barre est longue comme la durée VUE DU NAVIGATEUR, sur l'échelle commune du
//     tableau (la trace la plus longue = 100 %) ;
//   · elle se coupe en serveur puis trajet avec les durées de CETTE trace, jamais des
//     percentiles soustraits ;
//   · sans jumeau serveur, la barre reste d'un seul tenant, hachurée : la part serveur
//     est inconnue, pas nulle — et la cellule « Serveur » dit « non suivi », jamais 0 ms.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MiniCascade, SlowRow } from "@/components/tracing/SlowRow";
import type { SlowTrace } from "@/lib/queries-tracing";
import { queryOf } from "@/lib/filters";

const trace = (p: Partial<SlowTrace> = {}): SlowTrace =>
  ({
    trace_id: "0123456789abcdef0123456789abcdef",
    span_id: "0123456789abcdef",
    ts: new Date("2026-09-30T12:00:00Z"),
    method: "GET",
    url: "/api/panier",
    front_status: 200,
    front_ms: 800,
    back_ms: 600,
    network_ms: 200,
    session_id: null,
    ...p,
  }) as SlowTrace;

const largeurs = (html: string) => [...html.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));

describe("MiniCascade", () => {
  it("longueur = durée navigateur sur l'échelle commune ; serveur puis trajet, parts de la trace", () => {
    const html = renderToStaticMarkup(<MiniCascade t={trace()} maxMs={1600} />);
    // 800 ms sur 1 600 : la moitié de la piste ; 600 sur 800 : les trois quarts pour le serveur.
    expect(largeurs(html)).toEqual([50, 75]);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("repeating-linear-gradient");
  });

  it("sans jumeau serveur : une barre hachurée d'un seul tenant, aucune part serveur", () => {
    const html = renderToStaticMarkup(<MiniCascade t={trace({ back_ms: null, network_ms: null })} maxMs={800} />);
    expect(largeurs(html)).toEqual([100]);
    expect(html).toContain("repeating-linear-gradient");
  });

  it("une trace très courte reste visible (2 % au moins), jamais une barre de largeur nulle", () => {
    const html = renderToStaticMarkup(<MiniCascade t={trace({ front_ms: 1, back_ms: 1, network_ms: 0 })} maxMs={10_000} />);
    expect(largeurs(html)[0]).toBe(2);
  });
});

describe("SlowRow", () => {
  const query = queryOf({ app: "demo", period: "24h", device: null, segment: [], includeBots: false, includeInternal: false });

  it("« non suivi » sans jumeau serveur, jamais « 0 ms » ; la cascade n'est rendue qu'avec son échelle", () => {
    const sans = renderToStaticMarkup(
      <table>
        <tbody>
          <SlowRow t={trace({ back_ms: null, network_ms: null })} query={query} />
        </tbody>
      </table>,
    );
    expect(sans).toContain("non suivi");
    expect(sans).not.toMatch(/>0\s?ms</);
    expect(sans).not.toContain('data-testid="mini-cascade"');
    const avec = renderToStaticMarkup(
      <table>
        <tbody>
          <SlowRow t={trace()} query={query} maxMs={800} />
        </tbody>
      </table>,
    );
    expect(avec).toContain('data-testid="mini-cascade"');
  });
});
