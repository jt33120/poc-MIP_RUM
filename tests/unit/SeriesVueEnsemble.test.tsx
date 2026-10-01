// « Charge, erreurs et LCP » (F12, plan § 5.1.2, zone 6) — rendu serveur, sans
// graphique : chaque cas choisit des lectures qui mènent à un ÉTAT par panneau.
//
// Revue de F12 : une lecture en échec n'est pas une série vide. Méta « non lu »,
// alternative « — » ; jamais « 0 occurrence » sur une fenêtre qu'on n'a pas lue.
// Et les occurrences sans source déclarée, hors du panneau (2), sont dites (CP14).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChargeErreursLcp, HeroErreurs, HeroTrafic, VignetteCharge } from "@/components/vue-ensemble/SeriesVueEnsemble";
import { TuileAngleMort } from "@/components/vue-ensemble/AngleMort";
import { VignetteHistorique } from "@/components/vue-ensemble/Historique";
import { heatmapAffichee, VignetteHeatmapLatence } from "@/components/vue-ensemble/HeatmapLatence";
import { LigneSansCase, MiniSerie } from "@/components/vue-ensemble/Vignette";
import { VignetteRelease, type ReleaseStats } from "@/components/ReleaseCompare";
import { ApercuHistorique } from "@/components/charts/HealthHeatmap";
import { seau } from "@/lib/histogramme";
import { construireHeatmap } from "@/lib/heatmap-latence";

// « Réessayer » (SectionErreur, client) lit le routeur de Next : hors application, un
// routeur inerte (même procédé que Figure.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const texte = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const GRILLE = ["2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z"];
const COMMUN = {
  grille: GRILLE,
  seauSecondes: 3600,
  zoomHref: "/?from={from}&to={to}",
  annotations: { annotations: [], indisponible: null },
  plage: "24 h",
};
const VIDE_VUES = GRILLE.map((bucket) => ({ bucket, chargements: 0, spa: 0, inconnu: 0 }));
const VIDE_LCP = GRILLE.map((bucket) => ({ bucket, p75: null, n: 0 }));

/** Les cellules de la colonne `nom` de l'alternative textuelle. */
function colonne(html: string, nom: string): string[] {
  const table = html.slice(html.indexOf("<table"));
  const entetes = [...table.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].replace(/&#x27;/g, "'"));
  const i = entetes.indexOf(nom);
  const lignes = [...table.matchAll(/<tr class="border-b border-line\/60[^"]*">([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([^<]*)<\/t[hd]>/g)].map((c) => c[1]),
  );
  return lignes.map((l) => l[i]);
}

describe("ChargeErreursLcp — lecture en échec", () => {
  it("occurrences non lues : méta « non lu », alternative « — », jamais 0", () => {
    const html = renderToStaticMarkup(
      <ChargeErreursLcp
        {...COMMUN}
        mode={{ kind: "simple" }}
        lectures={{
          vues: { ok: true, data: VIDE_VUES },
          erreurs: { ok: false, raison: "base coupée" },
          lcp: { ok: true, data: VIDE_LCP },
        }}
      />,
    );
    const t = texte(html);
    expect(t).toContain("occurrences navigateur : non lu");
    expect(t).not.toContain("0 occurrences navigateur");
    expect(t).toContain("0 pages vues"); // lue, réellement vide : 0
    expect(colonne(html, "Occurrences d'erreurs navigateur")).toEqual(["—", "—"]);
    expect(colonne(html, "Chargements")).toEqual(["0", "0"]);
  });

  it("LCP non lu : ni p75 ni effectif chiffrés", () => {
    const html = renderToStaticMarkup(
      <ChargeErreursLcp
        {...COMMUN}
        mode={{ kind: "simple" }}
        lectures={{
          vues: { ok: true, data: VIDE_VUES },
          erreurs: { ok: true, data: { restreint: true, points: GRILLE.map((bucket) => ({ bucket, navigateur: 0, sansSource: 0 })) } },
          lcp: { ok: false, raison: "base coupée" },
        }}
      />,
    );
    expect(texte(html)).toContain("mesures LCP : non lu");
    expect(colonne(html, "Mesures LCP")).toEqual(["—", "—"]);
    expect(colonne(html, "LCP p75")).toEqual(["—", "—"]);
  });
});

describe("ChargeErreursLcp — occurrences sans source déclarée (CP14)", () => {
  it("aucune occurrence navigateur, 3 sans source : l'état vide le dit", () => {
    const html = renderToStaticMarkup(
      <ChargeErreursLcp
        {...COMMUN}
        mode={{ kind: "simple" }}
        lectures={{
          vues: { ok: true, data: VIDE_VUES },
          erreurs: {
            ok: true,
            data: { restreint: true, points: [{ bucket: GRILLE[0], navigateur: 0, sansSource: 3 }, { bucket: GRILLE[1], navigateur: 0, sansSource: 0 }] },
          },
          lcp: { ok: true, data: VIDE_LCP },
        }}
      />,
    );
    expect(texte(html)).toContain("3 occurrences sans source déclarée, non comptées.");
  });
});

// ───────────── Vue d'ensemble en vignettes (recette du 30/09/2026) ─────────────
//
// Chaque graphique est une case qui montre son titre et un dessin réduit, et qui s'ouvre
// sur le grand format (axes, légende, méthode, source, alternative). Ce que ces tests
// tiennent : une vignette ne perd aucune vérité du grand format (une lecture en échec
// reste « non lue », jamais 0 ; un trou reste un trou) ; les repères que l'assistant et
// les e2e désignent (`#hero-…`, `#charge-erreurs-lcp`, `#historique`, `heatmap-case`…)
// existent UNE fois, dans la fenêtre ; ce qui n'a rien à dessiner tient sur une ligne.

/** Le contenu d'une case (le bouton) et celui de sa fenêtre (le `<dialog>`). */
function caseEtFenetre(html: string, testId: string): { case: string; fenetre: string } {
  const debut = html.indexOf(`data-testid="${testId}"`);
  const bouton = html.slice(debut, html.indexOf("</button>", debut));
  const d = html.indexOf("<dialog", debut);
  return { case: bouton, fenetre: html.slice(d, html.indexOf("</dialog>", d)) };
}

const GRILLE_V = ["2026-09-29T10:00:00Z", "2026-09-29T11:00:00Z", "2026-09-29T12:00:00Z"];
const COMMUN_V = {
  grille: GRILLE_V,
  seauSecondes: 3600,
  zoomHref: "/?from={from}&to={to}",
  annotations: { annotations: [], indisponible: null },
  plage: "24 h",
};
const VUES_V = [
  { bucket: "2026-09-29T10:00:00.000Z", chargements: 150, spa: 50, inconnu: 0 },
  { bucket: "2026-09-29T12:00:00.000Z", chargements: 10, spa: 0, inconnu: 0 },
];

describe("onglets Erreurs et Trafic : des vignettes, comme les Web Vitals", () => {
  it("Erreurs : un taux et un compte, chacun sa vignette et son grand format", () => {
    const html = renderToStaticMarkup(
      <HeroErreurs
        {...COMMUN_V}
        mode={{ kind: "simple" }}
        vues={{ ok: true, data: VUES_V }}
        erreurs={{ ok: true, data: { restreint: true, points: [{ bucket: "2026-09-29T10:00:00.000Z", navigateur: 3 }] } }}
      />,
    );
    const taux = caseEtFenetre(html, "vignette-taux-erreurs");
    const occ = caseEtFenetre(html, "vignette-occurrences-erreurs");
    // La case : un titre court et son chiffre (« pour 100 » s'écrit %), une courbe en aperçu.
    expect(texte(taux.case)).toContain("Erreurs / 100 pages vues");
    expect(texte(taux.case)).toContain("1,4 %");
    expect(taux.case).toContain("data-apercu");
    expect(texte(occ.case)).toContain("3");
    // La fenêtre : le grand format, avec son ancre, son alternative et sa lecture.
    expect(taux.fenetre).toContain('id="hero-taux-erreurs"');
    expect(taux.fenetre).toContain('data-testid="alternative"');
    expect(occ.fenetre).toContain('id="hero-occurrences-erreurs"');
    expect(texte(occ.fenetre)).toContain("Zéro occurrence ne prouve pas l'absence d'erreur");
    // Chaque ancre existe une fois.
    expect(html.match(/id="hero-taux-erreurs"/g)).toHaveLength(1);
  });

  it("Trafic : pages vues et sessions commencées, deux vignettes, deux axes", () => {
    const html = renderToStaticMarkup(
      <HeroTrafic
        {...COMMUN_V}
        mode={{ kind: "simple" }}
        vues={{ ok: true, data: VUES_V }}
        sessions={{ ok: true, data: [{ bucket: new Date("2026-09-29T11:00:00Z"), sessions: 7 }] }}
      />,
    );
    expect(texte(caseEtFenetre(html, "vignette-pages-vues").case)).toContain("210");
    expect(texte(caseEtFenetre(html, "vignette-sessions").case)).toContain("7");
    expect(caseEtFenetre(html, "vignette-pages-vues").fenetre).toContain('id="hero-trafic"');
    expect(caseEtFenetre(html, "vignette-sessions").fenetre).toContain('id="hero-sessions"');
  });

  it("aucune page vue : une ligne, pas deux vignettes vides", () => {
    const html = renderToStaticMarkup(
      <HeroErreurs {...COMMUN_V} mode={{ kind: "simple" }} vues={{ ok: true, data: [] }} erreurs={{ ok: true, data: { restreint: true, points: [] } }} />,
    );
    expect(html).not.toContain("vignette-");
    expect(html).toContain('data-etat="vide"');
  });
});

describe("« Charge, erreurs et LCP » : un panneau compact qui s'ouvre sur les trois graphiques", () => {
  const LCP = GRILLE_V.map((bucket, i) => ({ bucket, p75: i === 1 ? null : 2000 + i * 1000, n: i === 1 ? 0 : 40 }));

  it("trois bandes réduites, leur total ; la fenêtre porte la figure entière", () => {
    const html = renderToStaticMarkup(
      <VignetteCharge
        {...COMMUN_V}
        mode={{ kind: "simple" }}
        lcpP75={2600}
        lectures={{
          vues: { ok: true, data: VUES_V },
          erreurs: { ok: true, data: { restreint: true, points: [{ bucket: GRILLE_V[0], navigateur: 4, sansSource: 0 }] } },
          lcp: { ok: true, data: LCP },
        }}
      />,
    );
    const { case: c, fenetre } = caseEtFenetre(html, "vignette-charge");
    const t = texte(c);
    expect(t).toContain("Pages vues 210");
    expect(t).toContain("Erreurs 4");
    expect(t).toContain("LCP p75 2,6 s");
    // Une tranche sans mesure LCP est un trou : deux segments, pas une ligne qui la traverse.
    expect(c.match(/<circle/g)?.length ?? 0).toBe(2);
    expect(fenetre).toContain('id="charge-erreurs-lcp"');
    expect(fenetre).toContain('data-testid="charge-panneaux"');
    expect(html.match(/id="charge-erreurs-lcp"/g)).toHaveLength(1);
  });

  it("une lecture en échec : « non lu », jamais 0", () => {
    const html = renderToStaticMarkup(
      <VignetteCharge
        {...COMMUN_V}
        mode={{ kind: "simple" }}
        lectures={{ vues: { ok: true, data: VUES_V }, erreurs: { ok: false }, lcp: { ok: true, data: LCP } }}
      />,
    );
    const t = texte(caseEtFenetre(html, "vignette-charge").case);
    expect(t).toContain("Erreurs non lu");
    expect(t).not.toMatch(/Erreurs 0\b/);
  });

  it("les trois lectures en échec : la figure dit l'échec, sans vignette", () => {
    const html = renderToStaticMarkup(
      <VignetteCharge {...COMMUN_V} mode={{ kind: "simple" }} lectures={{ vues: { ok: false }, erreurs: { ok: false }, lcp: { ok: false } }} />,
    );
    expect(html).not.toContain("vignette-charge");
    expect(html).toContain('data-testid="echec-lecture"');
  });
});

describe("MiniSerie : un aperçu sans axe, mêmes vérités que le grand format", () => {
  it("barres : une par tranche non nulle ; ligne : un trou coupe le tracé", () => {
    const barres = renderToStaticMarkup(<MiniSerie valeurs={[3, 0, 5]} forme="barres" couleur="red" />);
    expect(barres.match(/<rect/g)).toHaveLength(2);
    const ligne = renderToStaticMarkup(<MiniSerie valeurs={[1, 2, null, 4, 5]} forme="ligne" couleur="red" />);
    expect(ligne.match(/<polyline/g)).toHaveLength(2);
    // Des seuils : trois bandes de verdict derrière la ligne.
    const bandes = renderToStaticMarkup(<MiniSerie valeurs={[2000, 3000, 5000]} forme="ligne" couleur="red" seuils={[2500, 4000]} />);
    expect(bandes.match(/fill-opacity="0.1"/g)).toHaveLength(3);
    expect(renderToStaticMarkup(<MiniSerie valeurs={[null, null]} forme="ligne" couleur="red" />)).not.toContain("<polyline");
  });
});

describe("heatmaps en vignettes", () => {
  const H = 3_600_000;
  const T0 = Date.parse("2026-09-29T08:00:00Z");
  const grille = [0, 1, 2].map((i) => new Date(T0 + i * H).toISOString());
  const lignes = [
    { vital: "INP", heure: grille[0], bucket: seau(150), poids: 20, mesures: 20 },
    { vital: "TTFB", heure: grille[2], bucket: seau(900), poids: 30, mesures: 30 },
  ];

  it("latence : la vignette montre le premier vital mesuré ; sa carte s'ouvre cochée sur lui", () => {
    const h = construireHeatmap("LCP", grille, lignes)!;
    const vue = heatmapAffichee(h)!;
    expect(vue.vital).toBe("INP");
    expect(vue.choix?.map((c) => c.vital)).toEqual(["LCP", "INP", "FCP", "TTFB"]);
    const html = renderToStaticMarkup(<VignetteHeatmapLatence heatmap={vue} plage="24 h" />);
    const { case: c, fenetre } = caseEtFenetre(html, "vignette-heatmap-latence");
    expect(texte(c)).toContain("Heatmap de latence · INP");
    // Pas de légende ni d'infobulle dans l'aperçu : elles sont dans la carte.
    expect(c).not.toContain("legende-heatmap");
    expect(c).not.toContain("<title>");
    expect(fenetre).toContain('data-testid="legende-heatmap"');
    const coches = [...fenetre.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]).filter((r) => /\bchecked=""/.test(r));
    expect(coches.map((r) => r.match(/value="(\w+)"/)?.[1])).toEqual(["INP"]);
    // Aucun identifiant de motif en double entre l'aperçu et la carte.
    const motifs = [...html.matchAll(/<pattern id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(motifs).size).toBe(motifs.length);
  });

  it("latence : aucun vital mesuré, pas de vignette", () => {
    expect(heatmapAffichee(construireHeatmap("LCP", grille, [{ vital: "LCP", heure: grille[0], bucket: seau(1), poids: 0, mesures: 0 }])!)).toBeNull();
  });

  const JOURS = ["2026-07-14", "2026-07-15"];
  const CELLULES = [{ day: "2026-07-15", hour: 9, good_w: 7, total_w: 8 }];

  it("historique : l'aperçu est la grille réduite, sans lien ni repère de la carte", () => {
    const apercu = renderToStaticMarkup(<ApercuHistorique jours={JOURS} cellules={CELLULES} />);
    expect(apercu.match(/<span/g)?.length).toBe(1 + 2 * 24);
    expect(apercu).not.toContain("<a ");
    expect(apercu).not.toContain("heatmap-case");
    const html = renderToStaticMarkup(
      <VignetteHistorique
        jours={JOURS}
        cellules={CELLULES}
        fuseau="Europe/Paris"
        zoomHref="/?app=demo&from={from}&to={to}"
        ouvrees={false}
        hrefs={{ tout: "/", ouvrees: "/?hours=business" }}
      />,
    );
    const { case: c, fenetre } = caseEtFenetre(html, "vignette-historique");
    expect(c).not.toContain("<a ");
    // La carte, cliquable case par case, avec sa fenêtre de 14 jours écrite, est dans la fenêtre.
    expect(fenetre).toContain('id="historique"');
    expect(fenetre).toContain('data-testid="heatmap-case"');
    expect(fenetre).toContain('data-testid="historique-fenetre"');
    expect(fenetre).toContain("Heures ouvrées");
  });
});

describe("release face à la précédente : une case chiffrée", () => {
  const A: ReleaseStats = { release: "1.4.1", sessions: 400, lcp_p75: 2000, inp_p75: 150, sessionsEnErreur: 20 };
  const B: ReleaseStats = { release: "1.4.2", sessions: 400, lcp_p75: 5000, inp_p75: 180, sessionsEnErreur: 40 };
  const props = {
    a: A,
    b: B,
    plage: "24 h",
    source: "occurrence" as const,
    regleChoix: "1.4.2 : dernier déploiement déclaré ; 1.4.1 : déploiement précédent",
    hrefs: { a: "/?release=1.4.1", b: "/?release=1.4.2" },
  };

  it("A, B et l'écart ; la pastille seulement pour un verdict affirmé ; la comparaison entière dans la fenêtre", () => {
    const html = renderToStaticMarkup(<VignetteRelease {...props} />);
    const { case: c, fenetre } = caseEtFenetre(html, "vignette-release");
    const t = texte(c);
    expect(t).toContain("Release 1.4.2 vs 1.4.1");
    expect(t).toContain("LCP 2,0 s ■ 5,0 s +150 %");
    expect(t).toContain("En erreur 5,0 % 10,0 % +5 pts");
    // Sans intervalles fournis, le verdict suit la p75 (comme une tuile sans intervalle) :
    // Mauvais pour 5 s (forme ET couleur), Bon pour 180 ms.
    expect(c).toContain("text-bad");
    // Pas de lien dans la case (un lien dans un bouton n'est pas du HTML) ; la fenêtre
    // porte la comparaison entière, ses liens et sa règle.
    expect(c).not.toContain("<a ");
    expect(fenetre).toContain('data-testid="release-compare"');
    expect(fenetre).toContain('href="/?release=1.4.1"');
    expect(texte(fenetre)).toContain("Choix des releases");
  });
});

describe("angle mort : une case, ou une ligne", () => {
  const REGLE = "Robot à l'état ok et LCP p75 réel au-dessus de 2,5 s (seuil Bon du LCP) sur la même heure et la même route.";

  it("un compte : la case ; la règle et les liens dans sa fenêtre", () => {
    const html = renderToStaticMarkup(
      <TuileAngleMort
        etat={{ kind: "ok", heures: 3, pire: { route: "/lent", heures: 3, href: "/correlation?serie=a%3A%252Flent" } }}
        href="/correlation?app=a#angles-morts"
        regle={REGLE}
        plage="24 h"
      />,
    );
    const { case: c, fenetre } = caseEtFenetre(html, "vignette-angle-mort");
    expect(c).toMatch(/data-testid="kpi-valeur">3</);
    expect(texte(c)).toContain("pire /lent");
    expect(fenetre).toContain('data-testid="kpi-methode"');
    expect(fenetre).toContain('data-testid="angle-mort-lien"');
    expect(fenetre).toContain('href="/correlation?serie=a%3A%252Flent"');
  });

  it("sans robot, en ligne : quelques mots, jamais « 0 »", () => {
    const html = renderToStaticMarkup(
      <TuileAngleMort etat={{ kind: "sans_robot" }} href="/correlation" regle={REGLE} plage="24 h" enLigne />,
    );
    expect(html).not.toContain("card");
    expect(texte(html)).toContain("Non collecté : aucune sonde synthétique sur ces routes");
    expect(html).not.toContain(">0<");
  });
});

describe("la ligne des états", () => {
  it("un titre, une raison, un pictogramme d'absence ; les ancres gardées", () => {
    const html = renderToStaticMarkup(
      <LigneSansCase id="heatmap-latence" titre="Heatmap de latence" texte="aucune mesure LCP agrégée par heure sur 24 h" />,
    );
    expect(html).toContain('id="heatmap-latence"');
    expect(html).toContain('role="note"');
    expect(texte(html)).toContain("⊘ Heatmap de latence aucune mesure LCP agrégée par heure sur 24 h");
  });
});
