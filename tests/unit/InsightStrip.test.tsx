// InsightStrip (F08, plan § 4.2) : zéro constat → la phrase des règles, jamais un
// bandeau caché ; replié par défaut, compte en tête ; règle visible sur chaque
// ligne ; statuts des détecteurs toujours visibles ; aucun lien `fired=`.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InsightStrip, phraseAucunConstat, type Constat } from "@/components/InsightStrip";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const REGLES = ["z-score > 3 sur 24 h", "+20 % ou plus, ±2 h"];
const CONSTATS: Constat[] = [
  { type: "anomalie", titre: "LCP /checkout : 4,8 s à 14 h", regle: "z-score > 3 sur la moyenne horaire des 7 derniers jours", href: "/pages?route=%2Fcheckout" },
  { type: "alerte", titre: "Alerte LCP /checkout", regle: "règle active, non acquittée", href: "/alerts?evt=42" },
];

describe("InsightStrip", () => {
  it("zéro constat → une ligne qui cite les règles", () => {
    const html = renderToStaticMarkup(<InsightStrip constats={[]} regles={REGLES} fenetre="24 h fixes" />);
    const t = texte(html);
    expect(t).toContain("Constats (0)");
    expect(t).toContain("Aucun constat automatique (règles : z-score > 3 sur 24 h ; +20 % ou plus, ±2 h).");
    expect(html).not.toContain("<details");
    expect(html).toContain('data-testid="constats-aucun"');
  });

  it("aucune règle évaluée : dit, pas inventé", () => {
    expect(phraseAucunConstat([])).toBe("Aucun constat automatique (aucune règle évaluée sur cet écran).");
  });

  it("replié par défaut, compte en tête, règle sur chaque ligne", () => {
    const html = renderToStaticMarkup(<InsightStrip constats={CONSTATS} regles={REGLES} fenetre="24 h fixes" />);
    expect(html).toMatch(/<details>/);
    const t = texte(html);
    expect(t).toContain("Constats (2)");
    expect(t).toContain("24 h fixes");
    expect(t).toContain("Règle : z-score > 3 sur la moyenne horaire des 7 derniers jours");
    expect(t).toContain("Règle : règle active, non acquittée");
    expect(html).toContain('href="/alerts?evt=42"');
    expect(html).not.toContain("fired=");
  });

  it("ouvert à la demande", () => {
    const html = renderToStaticMarkup(<InsightStrip constats={CONSTATS} regles={REGLES} fenetre="24 h" ouvertParDefaut />);
    expect(html).toMatch(/<details open="">/);
  });

  it("les statuts des détecteurs restent visibles, même sans constat", () => {
    const html = renderToStaticMarkup(
      <InsightStrip
        constats={[]}
        regles={REGLES}
        fenetre="24 h fixes"
        statuts={[{ detecteur: "Anomalies quotidiennes", etat: "non_testable", raison: "moins de 4 jours d'historique" }]}
      />,
    );
    expect(texte(html)).toContain("Anomalies quotidiennes : non testable — moins de 4 jours d'historique");
  });
});
