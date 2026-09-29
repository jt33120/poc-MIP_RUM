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
