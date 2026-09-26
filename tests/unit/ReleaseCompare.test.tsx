// ReleaseCompare (F08, plan § 4.2) : phrase de fenêtre obligatoire, règle de choix
// écrite, CLS « non lue », release sans session dite, taux sans dénominateur = null.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CLS_NON_LU,
  PHRASE_FENETRE,
  ReleaseCompare,
  SANS_SESSION,
  ecrireEcart,
  tauxSessionsEnErreur,
  type ReleaseStats,
} from "@/components/ReleaseCompare";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const A: ReleaseStats = { release: "1.4.1", sessions: 1000, lcp_p75: 2000, inp_p75: 180, sessionsEnErreur: 50 };
const B: ReleaseStats = { release: "1.4.2", sessions: 400, lcp_p75: 2600, inp_p75: 220, sessionsEnErreur: 40 };
const rendre = (a: ReleaseStats, b: ReleaseStats) =>
  texte(
    renderToStaticMarkup(
      <ReleaseCompare
        a={a}
        b={b}
        plage="24 h"
        source="occurrence"
        regleChoix="1.4.2 : dernier déploiement déclaré ; 1.4.1 : déploiement précédent"
        hrefs={{ a: "/?release=1.4.1", b: "/?release=1.4.2" }}
      />,
    ),
  );

describe("ReleaseCompare", () => {
  it("écrit la phrase de fenêtre, la règle de choix et l'écart relatif", () => {
    const t = rendre(A, B);
    expect(t).toContain(PHRASE_FENETRE);
    expect(t).toContain("Choix des releases : 1.4.2 : dernier déploiement déclaré ; 1.4.1 : déploiement précédent");
    expect(t).toContain("+30 %");
    expect(t).toContain("40 sur 400 sessions");
  });

  it("CLS absent → « non lue par cette comparaison »", () => {
    expect(rendre(A, B)).toContain(`CLS p75 ${CLS_NON_LU}`);
  });

  it("une release sans session le dit", () => {
    const t = rendre(A, { release: "1.5.0", sessions: 0, lcp_p75: null, inp_p75: null, sessionsEnErreur: null });
    expect(t).toContain(SANS_SESSION);
  });

  it("l'écart d'un taux s'écrit en points, pas en pourcentage relatif (recette du 26/09/2026)", () => {
    expect(ecrireEcart(0.435, 0.636, "pct")).toBe("+20,1\u00a0pts");
    expect(ecrireEcart(0.2, 0.19, "pct")).toBe("−1\u00a0pt");
    expect(ecrireEcart(null, 0.5, "pct")).toBe("—");
    // A : 5 %, B : 10 % → +5 points, et non « +100 % ».
    const t = rendre(A, B);
    expect(t).toContain("+5 pts");
    expect(t).not.toContain("+100 %");
  });

  it("le verdict INP suit l'intervalle, comme la tuile : incertain, il n'est pas affirmé", () => {
    const b: ReleaseStats = {
      ...B,
      inp_p75: 304,
      intervalles: { INP: { bas: 150, haut: 320, niveau: 0.95, methode: "quantile_normal" }, LCP: { bas: 2550, haut: 2700, niveau: 0.95, methode: "quantile_normal" } },
    };
    const t = rendre(A, b);
    expect(t).toContain("verdict incertain : entre Bon et À améliorer");
    // Le LCP, dont l'intervalle reste dans « À améliorer », garde son verdict.
    expect(t).toMatch(/2,6\s?s À améliorer/);
  });

  it("un intervalle non lu ne laisse pas affirmer le verdict", () => {
    const t = rendre(A, { ...B, intervalles: {} });
    expect(t).toContain("verdict non établi (intervalle non lu)");
  });

  it("taux de sessions en erreur : null sans dénominateur, jamais 0 %", () => {
    expect(tauxSessionsEnErreur({ ...A, sessions: 0, sessionsEnErreur: 0 })).toBeNull();
    expect(tauxSessionsEnErreur(A)).toBe(0.05);
  });
});
