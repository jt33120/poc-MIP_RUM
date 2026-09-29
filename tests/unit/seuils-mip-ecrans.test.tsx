// Vague 4, lot 4b — les seuils MIP à l'écran : couleur ET règle écrite.
//
// L'amendement de R-S (plan § 1.5, 29/09/2026) n'autorise une couleur de verdict sur
// une mesure sans seuil publié que si sa règle MIP est écrite à côté de la valeur et
// que la couleur est doublée d'une forme. Ces tests le vérifient écran par écran, et
// les trois incohérences corrigées au passage (point vert fixe des mesures, ambre
// fixe des ressources, 300 ms écrit en dur).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegleMip, ValeurNoteeMip } from "@/components/NoteMip";
import { TimelineRow } from "@/components/sessions/Timeline";
import { Deroule } from "@/components/sessions/Deroule";
import { ResourcesView } from "@/components/ResourcesView";
import { KpiTile } from "@/components/charts/KpiTile";
import type { ResourceGroupe, ResourcesVue } from "@/lib/queries-resources";
import { MESURE_DU_SIGNAL, noteAffichee, partSessionsTouchees, texteNote } from "@/lib/notes-mip";
import { RATING_JETON } from "@/lib/palette";
import type { TimelineItem } from "@/lib/queries";
import { RATING_BAR, RATING_CLASS } from "@/lib/rating";
import {
  RESOURCE_THRESHOLD_NOTICE,
  SEUIL_COLLECTE_RESSOURCE_MS,
  TEXTE_SEUIL_COLLECTE_RESSOURCE,
} from "@/lib/resources";
import { PARTIEL_RESSOURCES } from "@/lib/deroule";
import { SEUILS_MIP, texteRegleMip } from "@/lib/seuils";
import { KIND_STYLE, libelleDeLigne, noteDeLigne, pointDeLigne } from "@/lib/timeline-constants";
import { DEFAULT_SLOW_RESOURCE_MS } from "../../packages/rum-sdk/src/resources";

// Le HTML échappe les chevrons : « > » devient « &gt; ».
const echappe = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ligne(kind: TimelineItem["kind"], extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    kind,
    ts: "2026-09-29T10:00:00.000Z",
    title: null,
    detail: null,
    value: null,
    rating: null,
    action_id: null,
    action_name: null,
    ...extra,
  };
}

describe("ValeurNoteeMip : couleur, forme et règle écrite, toujours ensemble", () => {
  it("DNS au-delà de la borne « mauvais » : rouge, carré, et la règle écrite à côté", () => {
    const html = renderToStaticMarkup(
      <ValeurNoteeMip mesure="DNS" valeur={SEUILS_MIP.DNS.mauvais + 1} texte="151 ms" />,
    );
    expect(html).toContain('data-note="poor"');
    expect(html).toContain(RATING_CLASS.poor);
    expect(html).toContain("■");
    expect(html).toContain('data-regle-mip="DNS"');
    expect(html).toContain(echappe(texteRegleMip("DNS")));
  });

  it("borne « bon » incluse : vert et disque ; entre les deux : ambre et triangle", () => {
    const bon = renderToStaticMarkup(<ValeurNoteeMip mesure="TCP" valeur={SEUILS_MIP.TCP.bon} texte="x" />);
    expect(bon).toContain('data-note="good"');
    expect(bon).toContain("●");
    const moyen = renderToStaticMarkup(<ValeurNoteeMip mesure="TCP" valeur={SEUILS_MIP.TCP.bon + 1} texte="x" />);
    expect(moyen).toContain('data-note="needs-improvement"');
    expect(moyen).toContain("▲");
  });

  it("sans règle MIP (formulaire, vital, nom inconnu) ou sans valeur : texte neutre, aucune règle inventée", () => {
    for (const [mesure, valeur] of [["FORMULAIRES", 12], ["LCP", 9000], ["INCONNU", 1], ["DNS", null]] as const) {
      const html = renderToStaticMarkup(<ValeurNoteeMip mesure={mesure} valeur={valeur} texte="v" />);
      expect(html).toContain('data-note=""');
      expect(html).not.toContain("data-regle-mip");
      expect(html).not.toMatch(/bg-(good|warn|bad)/);
    }
  });

  it("regle={false} : la couleur sans la règle, pour une colonne qui l'écrit une fois (RegleMip)", () => {
    expect(renderToStaticMarkup(<ValeurNoteeMip mesure="API" valeur={5000} texte="5 s" regle={false} />)).not.toContain(
      "data-regle-mip",
    );
    expect(renderToStaticMarkup(<RegleMip mesure="API" />)).toContain(echappe(texteRegleMip("API")));
    expect(renderToStaticMarkup(<RegleMip mesure="FORMULAIRES" />)).toBe("");
  });
});

describe("chronologie de session : plus de point vert fixe ni d'ambre fixe (incohérences du 29/09/2026)", () => {
  it("les styles de nature des mesures et des ressources sont neutres", () => {
    expect(KIND_STYLE.vital.dot).not.toMatch(/good|warn|bad/);
    expect(KIND_STYLE.vital.badge).not.toMatch(/good|warn|bad/);
    expect(KIND_STYLE.resource.dot).not.toMatch(/good|warn|bad/);
    expect(KIND_STYLE.resource.badge).not.toMatch(/good|warn|bad/);
  });

  it("une Core Web Vital garde sa note web.dev (stockée, sinon recalculée)", () => {
    expect(noteDeLigne(ligne("vital", { title: "LCP", value: 5000, rating: "poor" }))).toBe("poor");
    expect(noteDeLigne(ligne("vital", { title: "LCP", value: 1000 }))).toBe("good");
    expect(pointDeLigne(ligne("vital", { title: "LCP", value: 5000, rating: "poor" }))).toBe(RATING_BAR.poor);
    expect(libelleDeLigne(ligne("vital", { title: "LCP" }))).toBe("Web Vital");
  });

  it("une phase réseau se note par sa règle MIP, plus jamais « bon » d'office", () => {
    const dnsLent = ligne("vital", { title: "DNS", value: SEUILS_MIP.DNS.mauvais + 50 });
    expect(noteDeLigne(dnsLent)).toBe("poor");
    expect(pointDeLigne(dnsLent)).toBe(RATING_BAR.poor);
    expect(libelleDeLigne(dnsLent)).toBe("Mesure réseau");
    // Sans valeur : neutre, pas vert.
    expect(pointDeLigne(ligne("vital", { title: "DNS" }))).toBe(KIND_STYLE.vital.dot);
  });

  it("une ressource se note par sa durée (SEUILS_MIP.RESOURCE), plus « à améliorer » par nature", () => {
    expect(noteDeLigne(ligne("resource", { value: SEUILS_MIP.RESOURCE.bon }))).toBe("good");
    expect(pointDeLigne(ligne("resource", { value: SEUILS_MIP.RESOURCE.mauvais + 1 }))).toBe(RATING_BAR.poor);
  });

  it("la ligne rendue écrit la règle à côté de la valeur colorée (phase, ressource, appel API)", () => {
    const cas: [TimelineItem, string][] = [
      [ligne("vital", { title: "TLS", value: SEUILS_MIP.TLS.mauvais + 10 }), "TLS"],
      [ligne("resource", { title: "script", value: SEUILS_MIP.RESOURCE.mauvais + 10, detail: "https://x/a.js" }), "RESOURCE"],
      [ligne("api", { title: "GET /api/a", value: SEUILS_MIP.API.mauvais + 10, detail: "200" }), "API"],
    ];
    for (const [item, mesure] of cas) {
      const html = renderToStaticMarkup(<TimelineRow item={item} t0={Date.parse("2026-09-29T10:00:00.000Z")} />);
      expect(html, mesure).toContain('data-note="poor"');
      expect(html, mesure).toContain(`data-regle-mip="${mesure}"`);
      expect(html, mesure).toContain(echappe(texteRegleMip(mesure)));
      expect(html, mesure).toContain(`data-point="poor"`);
    }
  });

  it("un appel en échec le dit en toutes lettres, indépendamment de sa durée", () => {
    const html = renderToStaticMarkup(
      <TimelineRow item={ligne("api", { title: "GET /a", value: 10, rating: "poor", detail: "500" })} t0={0} />,
    );
    expect(html).toContain("échec");
    expect(html).toContain('data-note="good"');
  });
});

describe("seuil de collecte des ressources : lu, plus écrit en dur (lib/resources.ts:31)", () => {
  it("SEUIL_COLLECTE_RESSOURCE_MS vaut la constante du SDK ET la borne « bon » de SEUILS_MIP.RESOURCE", () => {
    expect(SEUIL_COLLECTE_RESSOURCE_MS).toBe(DEFAULT_SLOW_RESOURCE_MS);
    expect(SEUIL_COLLECTE_RESSOURCE_MS).toBe(SEUILS_MIP.RESOURCE.bon);
  });

  it("les textes qui le citent le lisent", () => {
    expect(RESOURCE_THRESHOLD_NOTICE).toContain(`${TEXTE_SEUIL_COLLECTE_RESSOURCE} par défaut`);
    expect(PARTIEL_RESSOURCES).toContain(`${TEXTE_SEUIL_COLLECTE_RESSOURCE} et plus par défaut`);
  });
});

// ─────────────────────────────── Écrans (lot 4b) ───────────────────────────────

describe("Déroulé — PhasesReseau : chaque phase colorée ET sa règle écrite à côté", () => {
  const T0 = Date.parse("2026-09-29T10:00:00Z");
  const items: TimelineItem[] = [
    ligne("pageview", { ts: new Date(T0).toISOString(), title: "/panier", detail: "navigate" }),
    ligne("vital", { ts: new Date(T0 + 100).toISOString(), title: "DNS", value: SEUILS_MIP.DNS.mauvais + 20 }),
    ligne("vital", { ts: new Date(T0 + 200).toISOString(), title: "TCP", value: SEUILS_MIP.TCP.bon }),
    ligne("vital", { ts: new Date(T0 + 300).toISOString(), title: "UNLOAD", value: 12 }),
  ];
  const html = renderToStaticMarkup(<Deroule items={items} t0={T0} voir={null} liens={{}} tronque={false} />);

  it("DNS lent : rouge + carré + « règle MIP : DNS > … » ; TCP bon : vert + disque", () => {
    expect(html).toContain('data-note="poor" data-mesure="DNS"');
    expect(html).toContain(echappe(texteRegleMip("DNS")));
    expect(html).toContain('data-note="good" data-mesure="TCP"');
    expect(html).toContain(echappe(texteRegleMip("TCP")));
  });

  it("une phase sans règle MIP (UNLOAD) reste neutre, sans règle inventée", () => {
    expect(html).toContain('data-note="" data-mesure="UNLOAD"');
    expect(html).not.toContain('data-regle-mip="UNLOAD"');
  });

  it("le texte ne dit plus « aucun verdict » : il dit que la couleur suit une règle MIP écrite", () => {
    expect(html).not.toContain("donc aucun verdict");
    expect(html).toContain("La couleur suit une règle");
  });
});

describe("ResourcesView : durée p75 notée, règle écrite une fois dans l'en-tête", () => {
  const groupe = (cle: string, p75: number | null): ResourceGroupe => ({ cle, party: null, n: 3, p75_ms: p75, octets: 1000 });
  const vue: ResourcesVue = {
    parType: [groupe("script", SEUILS_MIP.RESOURCE.mauvais + 1), groupe("img", SEUILS_MIP.RESOURCE.bon), groupe("css", null)],
    typesTotal: 3,
    typesTronques: false,
    parOrigine: [],
    originesTotal: 0,
    originesTronquees: false,
    parParty: [],
    total: 9,
    partageCalculable: false,
  };
  const html = renderToStaticMarkup(<ResourcesView vue={vue} periodLabel="24 h" />);

  it("script lent : mauvais ; image au seuil : bon", () => {
    expect(html).toContain('data-note="poor" data-mesure="RESOURCE"');
    expect(html).toContain('data-note="good" data-mesure="RESOURCE"');
  });

  it("la règle est écrite dans l'en-tête de la colonne « Durée p75 »", () => {
    expect(html).toContain('data-regle-mip="RESOURCE"');
    expect(html).toContain(echappe(texteRegleMip("RESOURCE")));
  });
});

describe("KpiTile.noteMip : la tuile écrit la valeur notée et sa règle (frustration, erreurs, tracing)", () => {
  it("part de clics rageurs au-delà de la borne : mauvais, règle écrite", () => {
    const part = partSessionsTouchees(12, 100)!;
    const html = renderToStaticMarkup(
      <KpiTile
        label="Clics rageurs"
        valeur={14}
        format="count"
        noteMip={{ mesure: "RAGE_CLICKS", valeur: part, texte: "12 % des sessions touchées" }}
      />,
    );
    expect(html).toContain('data-testid="kpi-note-mip"');
    expect(html).toContain('data-note="poor" data-mesure="RAGE_CLICKS"');
    expect(html).toContain(echappe(texteRegleMip("RAGE_CLICKS")));
  });

  it("sans noteMip, la tuile reste neutre (R-S pour les mesures sans règle)", () => {
    const html = renderToStaticMarkup(<KpiTile label="Clics erreur" valeur={3} format="count" />);
    expect(html).not.toContain("kpi-note-mip");
    expect(html).not.toContain("data-regle-mip");
  });

  it("les signaux : rage et dead ont une règle, pas les clics « erreur » ; part sans population = null", () => {
    expect(MESURE_DU_SIGNAL).toEqual({ rage: "RAGE_CLICKS", dead: "DEAD_CLICKS", error: null });
    expect(partSessionsTouchees(3, 0)).toBeNull();
    expect(partSessionsTouchees(5, 100)).toBe(0.05);
  });
});

describe("noteAffichee : couleur de figure, forme, libellé et règle d'un coup (TTFB, tracing)", () => {
  it("rend le jeton de thème et la règle ; null sans règle ou sans valeur", () => {
    const n = noteAffichee("REQUEST", SEUILS_MIP.REQUEST.mauvais + 1)!;
    expect(n).toMatchObject({ note: "poor", forme: "■", libelle: "Mauvais", jeton: RATING_JETON.poor, regle: texteRegleMip("REQUEST") });
    expect(noteAffichee("LCP", 9000)).toBeNull();
    expect(noteAffichee("DNS", null)).toBeNull();
    expect(texteNote(n, "700 ms")).toBe("■ 700 ms");
    expect(texteNote(null, "700 ms")).toBe("700 ms");
  });
});
