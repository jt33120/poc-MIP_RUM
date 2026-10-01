// ReleaseCompare et sa case, « à mix égal » (nuit du 01/10/2026) : sous LCP, INP et
// sessions en erreur, la même mesure à mix de trafic égal, sa couverture et ses strates ;
// une ligne sous un seuil se tait et dit pourquoi en une ligne ; un échec de lecture
// est dit une fois. Jamais de cause affirmée.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LIBELLE_MIX,
  PHRASE_FENETRE,
  PHRASE_MIX,
  ReleaseCompare,
  VignetteRelease,
  type ReleaseStats,
  type Standardise,
} from "@/components/ReleaseCompare";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

const A: ReleaseStats = { release: "1.4.1", sessions: 1000, lcp_p75: 2000, inp_p75: 180, sessionsEnErreur: 50 };
const B: ReleaseStats = { release: "1.4.2", sessions: 400, lcp_p75: 2600, inp_p75: 220, sessionsEnErreur: 40 };
const couverture = { a: 0.92, b: 0.85, ensemble: 0.9 };

const STANDARD: Standardise = {
  disponible: true,
  lcp: { ok: true, a: 2100, b: 2150, couverture, strates: { communes: 12, total: 15 }, effectifs: { a: 900, b: 340 } },
  inp: {
    ok: false,
    raison: "couverture 42 % des mesures de B, 50 % requis",
  },
  erreurs: { ok: true, a: 0.06, b: 0.062, couverture: { a: 0.88, b: 0.8, ensemble: 0.87 }, strates: { communes: 6, total: 9 }, effectifs: { a: 880, b: 320 } },
  couvertureSessions: { a: 0.88, b: 0.8, ensemble: 0.87 },
};

const props = (standardise?: Standardise) => ({
  a: A,
  b: B,
  plage: "24 h",
  source: "occurrence" as const,
  regleChoix: "1.4.2 : dernier déploiement déclaré ; 1.4.1 : déploiement précédent",
  hrefs: { a: "/?release=1.4.1", b: "/?release=1.4.2" },
  standardise,
});

const fenetre = (s?: Standardise) => renderToStaticMarkup(<ReleaseCompare {...props(s)} />);
const caseSeule = (s?: Standardise) => {
  const html = renderToStaticMarkup(<VignetteRelease {...props(s)} />);
  // La case est le bouton ; la fenêtre (<dialog>) suit.
  return html.slice(0, html.indexOf("<dialog"));
};

describe("ReleaseCompare — lignes « à mix égal »", () => {
  it("écrit, sous chaque mesure brute, A et B à mix égal, la couverture et les strates", () => {
    const html = fenetre(STANDARD);
    const t = texte(html);
    expect(html).toContain('data-testid="release-mix-lcp"');
    expect(t).toContain(`LCP p75, ↳ ${LIBELLE_MIX} 2,1 s couv. 92 % des mesures 2,2 s couv. 85 % des mesures`);
    // Écart standardisé à côté de l'écart brut (+30 %).
    expect(t).toContain("+30 %");
    expect(t).toContain("+2,4 %");
    expect(t).toContain("12/15 strates");
    // La part de sessions en erreur s'écarte en points, couverture en sessions.
    expect(t).toContain("6,0 % couv. 88 % des sessions 6,2 % couv. 80 % des sessions +0,2 pt");
  });

  it("une ligne sous un seuil se tait et dit pourquoi, en une ligne", () => {
    const html = fenetre(STANDARD);
    expect(html).toContain('data-testid="release-mix-inp"');
    expect(texte(html)).toContain("INP p75, ↳ à mix égal non calculée : couverture 42 % des mesures de B, 50 % requis");
  });

  it("la phrase garde la limite des valeurs brutes et dit ce que la pondération égalise ; la méthode est dans la bulle", () => {
    const html = fenetre(STANDARD);
    const t = texte(html);
    expect(t).toContain(`Valeurs brutes : ${PHRASE_FENETRE}.`);
    expect(t).toContain(PHRASE_MIX);
    expect(html).toContain('aria-label="Méthode : à mix de trafic égal"');
    expect(html).toContain('role="tooltip"');
    expect(t).toContain("Poids d'une unité de la release r dans la strate s = part de s dans la référence ÷ part de s dans r");
    expect(t).toContain("Strate commune : 10 unités au moins de chaque côté");
  });

  it("un échec de lecture est dit une fois, sans ligne par mesure", () => {
    const html = fenetre("echec");
    expect(html).not.toContain('data-testid="release-mix-lcp"');
    expect(texte(html)).toContain(`Lignes « ${LIBELLE_MIX} » non calculées : lecture en échec.`);
  });

  it("un schéma sans release par mesure le dit, une fois", () => {
    const t = texte(fenetre({ disponible: false, raison: "la release n'est pas portée par chaque mesure" }));
    expect(t).toContain("non calculées : la release n'est pas portée par chaque mesure.");
  });

  it("non lue (vitrine, autre appelant) : rien n'est dit, la phrase d'avant reste", () => {
    const html = fenetre(undefined);
    expect(html).not.toContain("release-mix");
    expect(texte(html)).toContain(`Comparaison sur la ${PHRASE_FENETRE}.`);
  });

  it("aucune cause affirmée : l'écran dit « à mix égal », jamais « effet du code »", () => {
    const t = texte(fenetre(STANDARD));
    expect(t).not.toMatch(/effet du code|caus/i);
  });
});

describe("VignetteRelease — la case", () => {
  it("une colonne « à mix égal » (écart standardisé, « — » pour une ligne qui se tait) et la couverture en % des sessions", () => {
    const html = caseSeule(STANDARD);
    const t = texte(html);
    expect(html).toContain('data-testid="vignette-release-mix"');
    // LCP : 2,0 s → 2,6 s brut (+30 %), +2,4 % à mix égal ; INP tu : « — ». La
    // pastille de verdict de B (forme seule, sans couleur à mix égal) peut précéder B.
    expect(t).toMatch(/LCP 2,0 s (\S )?2,6 s \+30 % \+2,4 %/);
    expect(t).toMatch(/INP 180 ms (\S )?220 ms \+22,2 % —/);
    expect(t).toMatch(/En erreur 5,0 % 10,0 % \+5 pts \+0,2 pt/);
    expect(t).toContain("à mix égal : couverture 87 % des sessions");
    // L'écran vocal entend la même chose.
    expect(html).toContain("à mix égal : LCP p75 +2,4");
  });

  it("toutes les lignes tues : la case dit la première raison", () => {
    const tues: Standardise = {
      disponible: true,
      lcp: { ok: false, raison: "20 mesures de B dans des strates communes, 50 requises" },
      inp: { ok: false, raison: "20 mesures de B dans des strates communes, 50 requises" },
      erreurs: { ok: false, raison: "12 sessions de B dans des strates communes, 50 requises" },
      couvertureSessions: { a: 1, b: 0.3, ensemble: 0.9 },
    };
    expect(texte(caseSeule(tues))).toContain("à mix égal : 20 mesures de B dans des strates communes, 50 requises");
  });

  it("lecture en échec : la case le dit ; non lue : pas de colonne", () => {
    expect(texte(caseSeule("echec"))).toContain("à mix égal : lecture en échec");
    expect(caseSeule(undefined)).not.toContain("vignette-release-mix");
  });
});
