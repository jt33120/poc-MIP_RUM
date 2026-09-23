// F44 — détail de session : onglets et compatibilité des anciens liens, résumé
// chiffré (compte inconnu sur une chronologie tronquée, garde capteur mobile,
// occurrences sommées), puces sans identité, échantillonnage jamais « 100 % »
// pour une session d'avant v58.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEAD_CLICK_WINDOW_MS,
  RAGE_MIN_CLICKS,
  RAGE_WINDOW_MS,
} from "../../packages/rum-sdk/src/frustration";
import type { TimelineItem } from "../../apps/console/lib/queries";
import { LIMITE_CHRONOLOGIE } from "../../apps/console/lib/recit-session";
import {
  ATTRIBUTS_SESSION,
  LECTURE_FRUSTRATION,
  attributsDeSession,
  dureeObservee,
  encoreActive,
  estWebVital,
  lireInstant,
  lireOnglet,
  occurrencesLisibles,
  pucesDeSession,
  resumeDeSession,
  routeEnCours,
  statutAppel,
  texteEchantillonnage,
  texteVisiteur,
  type MetaPuces,
} from "../../apps/console/lib/session-detail";

const NBSP = String.fromCharCode(0xa0);
const T = (s: number) => new Date(Date.UTC(2026, 8, 20, 10, 0, s));

function ligne(kind: TimelineItem["kind"], s: number, extra: Partial<TimelineItem> = {}): TimelineItem {
  return { kind, ts: T(s), title: null, detail: null, value: null, rating: null, action_id: null, action_name: null, ...extra };
}

const CHRONOLOGIE: TimelineItem[] = [
  ligne("pageview", 0, { title: "/" }),
  ligne("vital", 1, { title: "LCP", detail: "/", value: 2100 }),
  ligne("vital", 1, { title: "DNS", detail: "/", value: 12 }),
  ligne("pageview", 10, { title: "/paiement" }),
  ligne("action", 20, { title: "Payer", action_id: "a1", action_name: "Payer" }),
  ligne("error", 21, { title: "TypeError", detail: "x is undefined", value: 3, action_id: "a1", action_name: "Payer" }),
  ligne("error", 22, { title: "RangeError", detail: "trop", value: 1 }),
  ligne("event", 23, { title: "frustration.rage" }),
  ligne("event", 24, { title: "frustration.dead" }),
  ligne("event", 25, { title: "panier.valide" }),
  ligne("api", 26, { title: "POST /api/panier", detail: "500 · serveur 45 ms", value: 180, rating: "poor" }),
  ligne("api", 27, { title: "GET /api/stock", detail: "0", value: 30, rating: "poor" }),
  ligne("api", 28, { title: "GET /api/prix", detail: "200", value: 90 }),
];

describe("lireOnglet et lireInstant", () => {
  it("anciens liens : tab=replay et tab=timeline ouvrent le Déroulé, sans avertissement", () => {
    expect(lireOnglet("replay")).toEqual({ onglet: "deroule", ignore: null });
    expect(lireOnglet("timeline")).toEqual({ onglet: "deroule", ignore: null });
    expect(lireOnglet(undefined)).toEqual({ onglet: "deroule", ignore: null });
  });

  it("onglets déclarés lus tels quels ; valeur inconnue → Déroulé et ligne d'avertissement", () => {
    expect(lireOnglet("erreurs").onglet).toBe("erreurs");
    expect(lireOnglet("attributs").onglet).toBe("attributs");
    // F46 : la cascade est un onglet, plus un réglage ignoré.
    expect(lireOnglet("cascade")).toEqual({ onglet: "cascade", ignore: null });
    const inconnu = lireOnglet("photo");
    expect(inconnu.onglet).toBe("deroule");
    expect(inconnu.ignore).toContain("Réglage d'affichage ignoré : tab=photo");
  });

  it("at : un entier en ms, rien d'autre", () => {
    expect(lireInstant("1758362400000")).toBe(1758362400000);
    expect(lireInstant("12.5")).toBeNull();
    expect(lireInstant("-3")).toBeNull();
    expect(lireInstant(undefined)).toBeNull();
  });
});

describe("resumeDeSession", () => {
  it("occurrences SOMMÉES (V1), frustration, appels en échec (≥ 400 ou 0), Web Vitals sans les phases réseau", () => {
    expect(resumeDeSession(CHRONOLOGIE, "browser")).toEqual({
      tronquee: false,
      erreursLignes: 2,
      occurrences: 4,
      frustration: 2,
      apiEchecs: 2,
      apiLignes: 3,
      vitaux: 1,
    });
  });

  it("session React Native : frustration non collectée (null), jamais 0", () => {
    expect(resumeDeSession(CHRONOLOGIE, "react_native").frustration).toBeNull();
    expect(resumeDeSession([], "react_native").frustration).toBeNull();
    // Une session navigateur sans signal : 0 est un vrai zéro.
    expect(resumeDeSession([ligne("pageview", 0, { title: "/" })], null).frustration).toBe(0);
  });

  it("chronologie tronquée à 500 lignes : tout compte en vient inconnu", () => {
    const longue = Array.from({ length: LIMITE_CHRONOLOGIE }, (_, i) => ligne("error", i, { title: "E", value: 1 }));
    const r = resumeDeSession(longue, null);
    expect(r.tronquee).toBe(true);
    expect(r).toMatchObject({ erreursLignes: null, occurrences: null, frustration: null, apiEchecs: null, vitaux: null });
  });

  it("une ligne d'erreur sans occurrences (schéma d'avant v67) : occurrences inconnues, lignes comptées", () => {
    const ancien = [ligne("error", 0, { title: "E", value: null }), ligne("error", 1, { title: "E", value: 2 })];
    expect(occurrencesLisibles(ancien)).toBe(false);
    expect(resumeDeSession(ancien, null)).toMatchObject({ occurrences: null, erreursLignes: 2 });
    expect(occurrencesLisibles(CHRONOLOGIE)).toBe(true);
  });

  it("Web Vital : LCP oui, phase réseau non", () => {
    expect(estWebVital(ligne("vital", 0, { title: "LCP" }))).toBe(true);
    expect(estWebVital(ligne("vital", 0, { title: "DNS" }))).toBe(false);
  });
});

describe("durée et activité", () => {
  it("durée observée jamais négative ; encore active dans les 30 dernières minutes", () => {
    expect(dureeObservee(T(0), T(372))).toBe(372_000);
    expect(dureeObservee(T(10), T(0))).toBe(0);
    const maintenant = T(0).getTime() + 20 * 60_000;
    expect(encoreActive(T(0), maintenant)).toBe(true);
    expect(encoreActive(T(0), T(0).getTime() + 31 * 60_000)).toBe(false);
  });
});

describe("puces de contexte", () => {
  const META: MetaPuces = {
    app_id: "shop",
    device_type: "desktop",
    geo_country: "FR",
    geo_source: "geoip",
    collection_source: "extension",
    visitor_id: "abcdef0123456789-complet",
    started_at: new Date("2026-09-20T10:00:00Z"),
    browser: "Firefox",
    browser_version: "131.0",
    os: null,
    os_version: null,
    release: "1.4.2",
    sample_rate: 0.5,
    error_sample_rate: 1,
    has_error: false,
  };

  it("ordre du plan, inconnu nommé, version accolée, release liée, capteur en toutes lettres", () => {
    const puces = pucesDeSession(META, (r) => `/errors?release=${r}`);
    expect(puces.map((p) => p.label)).toEqual([
      "App",
      "Appareil",
      "Navigateur",
      "Système",
      "Pays estimé",
      "Capteur",
      "Release à l'ouverture",
      "Visiteur (aléatoire)",
      "Échantillonnage",
    ]);
    const par = Object.fromEntries(puces.map((p) => [p.label, p]));
    expect(par["Navigateur"].valeur).toBe("Firefox 131.0");
    expect(par["Système"].valeur).toBe("Inconnu");
    expect(par["Pays estimé"].provenance).toBeTruthy();
    expect(par["Capteur"].valeur).toBe("Extension navigateur");
    expect(par["Release à l'ouverture"].href).toBe("/errors?release=1.4.2");
  });

  it("visiteur tronqué à 8 caractères ; sans identifiant aléatoire, jamais l'empreinte héritée", () => {
    const puces = pucesDeSession(META, () => "");
    const texte = JSON.stringify(puces);
    expect(texte).toContain("abcdef01…");
    expect(texte).not.toContain("abcdef0123456789-complet");
    expect(texteVisiteur(null)).toEqual({ label: "Visiteur", valeur: expect.stringContaining("n'identifie pas une personne") });
  });

  it("échantillonnage : p = sr sans erreur, sr + (1 − sr) × esr avec erreur ; jamais « 100 % » avant v58", () => {
    expect(texteEchantillonnage(META)).toBe(`retenue avec probabilité 50,0${NBSP}%`);
    expect(texteEchantillonnage({ ...META, sample_rate: 0.2, error_sample_rate: 0.5, has_error: true })).toBe(
      `retenue avec probabilité 60,0${NBSP}%`,
    );
    const avant = texteEchantillonnage({ ...META, started_at: new Date("2026-08-01T00:00:00Z"), sample_rate: 1 });
    expect(avant).toBe("probabilité d'inclusion non enregistrée");
    expect(texteEchantillonnage({ ...META, sample_rate: undefined })).toBe("probabilité d'inclusion non enregistrée");
  });
});

describe("tables des onglets", () => {
  it("vue en cours d'une erreur : la dernière page vue qui la précède", () => {
    expect(routeEnCours(CHRONOLOGIE, 5)).toBe("/paiement");
    expect(routeEnCours(CHRONOLOGIE, 1)).toBe("/");
    expect(routeEnCours([ligne("error", 0)], 0)).toBeNull();
  });

  it("statut d'un appel : 0 est « réseau (statut 0) », jamais 500 ; temps serveur séparé", () => {
    expect(statutAppel("500 · serveur 45 ms")).toEqual({ statut: "500", serveur: "45 ms" });
    expect(statutAppel("0")).toEqual({ statut: "réseau (statut 0)", serveur: null });
    expect(statutAppel("—")).toEqual({ statut: "—", serveur: null });
    expect(statutAppel(null)).toEqual({ statut: "—", serveur: null });
  });

  it("attributs : colonnes non identifiantes seulement, inconnu nommé", () => {
    expect(ATTRIBUTS_SESSION).not.toContain("user_id_hash");
    expect(ATTRIBUTS_SESSION).not.toContain("account_id_hash");
    expect(ATTRIBUTS_SESSION).not.toContain("user_hash");
    expect(ATTRIBUTS_SESSION).not.toContain("visitor_id");
    const attributs = attributsDeSession({ session_id: "s1", app_id: "a", runtime: null, user_id_hash: "secret" } as never);
    expect(attributs.find((a) => a.cle === "runtime")?.valeur).toBe("Inconnu");
    expect(JSON.stringify(attributs)).not.toContain("secret");
  });
});

describe("piège 16 : conteneurs défilants du détail", () => {
  // Un `sr-only` (position absolue) dans un conteneur `overflow-x-auto` sans ancêtre
  // positionné se place par rapport à la PAGE et l'élargit : la table des erreurs
  // portait la page à 575 px sur une fenêtre de 390 (e2e « aucun débordement »).
  it("tout conteneur overflow-x-auto de la page porte `relative`", () => {
    const source = readFileSync(new URL("../../apps/console/app/sessions/[id]/page.tsx", import.meta.url), "utf8");
    const classes = [...source.matchAll(/className=\{?[`"]([^`"]*overflow-x-auto[^`"]*)[`"]/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThanOrEqual(2);
    for (const c of classes) expect(c.split(/\s+/), c).toContain("relative");
  });
});

describe("règles de frustration écrites = celles du SDK", () => {
  it("3 clics en 1 s, 1 500 ms sans réaction", () => {
    expect(LECTURE_FRUSTRATION).toContain(`${RAGE_MIN_CLICKS} clics en ${RAGE_WINDOW_MS / 1000} s`);
    expect(LECTURE_FRUSTRATION).toContain(`${DEAD_CLICK_WINDOW_MS.toLocaleString("fr-FR").replace(/\s/g, " ")} ms`);
  });
});
