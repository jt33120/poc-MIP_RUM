// Décomposition réseau : les pièges de PerformanceNavigationTiming, et la
// lecture défensive de navigator.connection.
import { describe, expect, it } from "vitest";
import { phasesReseau, qualiteReseau } from "../../packages/rum-sdk/src/navtiming";

/** Une entrée de navigation minimale, complétée par le cas testé. */
const nav = (o: Partial<PerformanceNavigationTiming>): PerformanceNavigationTiming =>
  ({
    redirectStart: 0, redirectEnd: 0,
    domainLookupStart: 0, domainLookupEnd: 0,
    connectStart: 0, connectEnd: 0, secureConnectionStart: 0,
    requestStart: 0, responseStart: 0, responseEnd: 0,
    ...o,
  }) as PerformanceNavigationTiming;

describe("phasesReseau", () => {
  it("ventile une navigation HTTPS complète", () => {
    expect(
      phasesReseau(nav({
        domainLookupStart: 10, domainLookupEnd: 35,          // DNS 25
        connectStart: 35, secureConnectionStart: 60, connectEnd: 140, // TCP 25, TLS 80
        requestStart: 140, responseStart: 300, responseEnd: 460,      // REQUEST 160, RESPONSE 160
      })),
    ).toEqual({ REDIRECT: 0, DNS: 25, TCP: 25, TLS: 80, REQUEST: 160, RESPONSE: 160 });
  });

  // secureConnectionStart vaut 0 — pas une date — quand il n'y a pas de TLS.
  // Le soustraire aveuglément donnerait une poignée de main énorme.
  it("ne fabrique pas de TLS sur une connexion en clair", () => {
    const p = phasesReseau(nav({ connectStart: 20, connectEnd: 50, secureConnectionStart: 0 }));
    expect(p.TLS).toBe(0);
    expect(p.TCP).toBe(30);
  });

  // connectEnd - connectStart englobe TLS : sans borne, TCP et TLS compteraient
  // deux fois le même temps et leur somme dépasserait le TTFB.
  it("ne compte pas la poignée de main deux fois", () => {
    const p = phasesReseau(nav({ connectStart: 0, secureConnectionStart: 30, connectEnd: 100 }));
    expect(p.TCP + p.TLS).toBe(100);
    expect(p.TCP).toBe(30);
  });

  // Une phase à 0 est une VRAIE mesure — connexion réutilisée, DNS en cache —
  // et c'est même l'information la plus utile sur un site bien configuré.
  it("garde les zéros d'une connexion réutilisée", () => {
    const p = phasesReseau(nav({ requestStart: 5, responseStart: 90, responseEnd: 95 }));
    expect(p.DNS).toBe(0);
    expect(p.TCP).toBe(0);
    expect(p.REQUEST).toBe(85);
  });

  it("écarte NaN, négatifs et valeurs absurdes plutôt que de les stocker", () => {
    const p = phasesReseau(nav({
      domainLookupStart: 100, domainLookupEnd: 10,             // négatif
      connectStart: Number.NaN, connectEnd: 50,                // NaN
      requestStart: 0, responseStart: 9_000_000,               // au-delà du plafond
    }));
    expect(p.DNS).toBeUndefined();
    expect(p.TCP).toBeUndefined();
    expect(p.REQUEST).toBeUndefined();
  });
});

describe("qualiteReseau", () => {
  it("lit ce que Chromium expose", () => {
    const r = qualiteReseau({ effectiveType: "4g", rtt: 55, downlink: 8.35, saveData: true });
    expect(r.type).toBe("4g");
    expect(r.economie).toBe(true);
    expect(r.mesures).toEqual({ RTT: 55, DOWNLINK: 8.35 });
  });

  // L'API n'existe ni sur Safari ni sur Firefox : l'absence est le cas NORMAL.
  it("survit à l'absence totale de l'API", () => {
    expect(qualiteReseau(undefined)).toEqual({ type: null, mesures: {}, economie: false });
    expect(qualiteReseau({})).toEqual({ type: null, mesures: {}, economie: false });
  });

  it("ignore les valeurs d'un mauvais type ou hors bornes", () => {
    const r = qualiteReseau({ effectiveType: 42, rtt: "vite", downlink: -3, saveData: "oui" });
    expect(r.type).toBeNull();
    expect(r.mesures).toEqual({});
    expect(r.economie).toBe(false);
  });

  // Arrondir le débit à l'entier écraserait toutes les connexions lentes, qui sont
  // précisément celles qu'on cherche à voir.
  it("garde deux décimales sur un débit faible", () => {
    expect(qualiteReseau({ downlink: 0.42 }).mesures.DOWNLINK).toBe(0.42);
  });
});
