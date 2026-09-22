// ReleaseCompare (F08, plan § 4.2) : phrase de fenêtre obligatoire, règle de choix
// écrite, CLS « non lue », release sans session dite, taux sans dénominateur = null.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CLS_NON_LU,
  PHRASE_FENETRE,
  ReleaseCompare,
  SANS_SESSION,
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

  it("taux de sessions en erreur : null sans dénominateur, jamais 0 %", () => {
    expect(tauxSessionsEnErreur({ ...A, sessions: 0, sessionsEnErreur: 0 })).toBeNull();
    expect(tauxSessionsEnErreur(A)).toBe(0.05);
  });
});
