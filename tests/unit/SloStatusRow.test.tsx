// SloRow (F63, plan § 5.18 SL5) : la ligne « Définitions et état » d'un SLO.
//
// Ce que la ligne ne doit jamais faire : écrire « 0 % » ou « objectif manqué » pour
// un SLO que rien n'a mesuré (V3), colorer un budget sous 100 % (R-S), ou RENDRE un
// bouton d'écriture pour un viewer (V9).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Les actions serveur tirent la base : seules leurs références comptent ici.
vi.mock("@/app/alerts/actions", () => ({ toggleSloAction: () => undefined, deleteSloAction: () => undefined }));

import { SloRow } from "@/components/slo/SloStatusRow";
import type { SloRaw, SloStatusRow } from "@/lib/queries-alerting";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const raw = (p: Partial<SloRaw> = {}): SloRaw => ({
  id: 7,
  app_id: "demo",
  name: "INP sans mesure",
  metric: "INP",
  objective: 0.9,
  window_days: 7,
  route: null,
  active: true,
  ...p,
});

const statut = (p: Partial<SloStatusRow> = {}): SloStatusRow => ({
  slo_id: 7,
  app_id: "demo",
  name: "INP sans mesure",
  metric: "INP",
  route: null,
  objective: 0.9,
  window_days: 7,
  attainment: null,
  budget: 0.1,
  burned_pct: null,
  fast_burn: null,
  ...p,
});

const rendre = (el: React.ReactElement) => renderToStaticMarkup(<table><tbody>{el}</tbody></table>);

describe("SloRow", () => {
  it("sans mesure : « non mesurable », ni « 0 % » ni « objectif manqué » ; métrique en clair, route « toutes »", () => {
    const t = texte(rendre(<SloRow raw={raw()} status={statut()} alertes7j={0} admin={false} />));
    expect(t).toContain("non mesurable");
    expect(t).not.toMatch(/(^|\s)0 %/);
    expect(t).not.toContain("objectif manqué");
    expect(t).toContain("Part des mesures INP notées Bon");
    expect(t).toContain("toutes");
    expect(t).toContain("inconnu");
  });

  it("viewer : aucun bouton ni lien d'écriture rendu", () => {
    const html = rendre(<SloRow raw={raw()} status={statut()} alertes7j={2} admin={false} />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Créer une alerte");
    // La lecture reste : le compte d'alertes mène à la piste du SLO.
    expect(html).toContain('href="/alerts#slo-7"');
  });

  it("admin : activer / désactiver, supprimer et « Créer une alerte » (paramètres regle_*)", () => {
    const html = rendre(
      <SloRow raw={raw({ route: "/checkout", metric: "LCP" })} status={statut({ metric: "LCP" })} alertes7j={0} admin />,
    );
    expect(html).toContain('data-testid="toggle-slo-7"');
    expect(html).toContain('data-testid="delete-slo-7"');
    expect(html).toContain("/alerts?regle_metrique=LCP&amp;regle_route=%2Fcheckout#nouvelle-regle");
  });

  it("épuisé : seul verdict coloré ; sous 100 % : neutre", () => {
    const epuise = rendre(
      <SloRow raw={raw()} status={statut({ attainment: 0.6, burned_pct: 400, fast_burn: true })} alertes7j={1} admin={false} />,
    );
    expect(texte(epuise)).toContain("400 % épuisé");
    expect(epuise).toContain("text-bad-ink");
    const tenu = rendre(<SloRow raw={raw()} status={statut({ attainment: 0.96, burned_pct: 40, fast_burn: false })} alertes7j={0} admin={false} />);
    expect(texte(tenu)).toContain("40 % dans le budget");
    expect(tenu).not.toMatch(/text-(good|warn|bad)/);
  });

  it("SLO désactivé : ligne grisée, « désactivé », état « — » ; lecture d'alertes en échec : « — »", () => {
    const html = rendre(<SloRow raw={raw({ active: false })} alertes7j={null} admin={false} />);
    expect(html).toContain("opacity-60");
    expect(texte(html)).toContain("désactivé");
    expect(html).not.toContain("/alerts#slo-7");
  });
});
