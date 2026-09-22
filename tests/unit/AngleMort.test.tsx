// Tuile « Heures × route en angle mort » (F13, plan § 5.1.2 zone 6) : un compte
// exact et neutre (R-S), la règle écrite, la pire route en lien HORS de la tuile ;
// sans robot « Non collecté », jamais « 0 ».
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TuileAngleMort } from "@/components/vue-ensemble/AngleMort";

const REGLE = "Robot à l'état ok ET LCP p75 réel au-dessus de 2,5 s (borne Bon de lib/rating.ts) sur la même heure et la même route.";

describe("TuileAngleMort", () => {
  it("compte, règle, lien vers /correlation#angles-morts ; pire route dans un second lien", () => {
    const html = renderToStaticMarkup(
      <TuileAngleMort
        etat={{ kind: "ok", heures: 60, pire: { route: "/lent", heures: 60, href: "/correlation?serie=a%3A%252Flent" } }}
        href="/correlation?app=a#angles-morts"
        regle={REGLE}
        plage="24 h"
      />,
    );
    expect(html).toContain('href="/correlation?app=a#angles-morts"');
    expect(html).toContain(">60<");
    expect(html).toContain("borne Bon de lib/rating.ts");
    expect(html).toContain('href="/correlation?serie=a%3A%252Flent"');
    // Neutre : aucun ton « bad » sur un compte sans seuil publié.
    expect(html).toContain('data-ton="neutre"');
    // Pas de lien imbriqué dans un lien.
    expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>).)*<a/s);
  });

  it("sans robot : « Non collecté », jamais « 0 »", () => {
    const html = renderToStaticMarkup(<TuileAngleMort etat={{ kind: "sans_robot" }} href="/correlation" regle={REGLE} plage="24 h" />);
    expect(html).toContain("Non collecté");
    expect(html).toContain("aucune sonde synthétique sur ces routes");
    expect(html).not.toContain(">0<");
  });

  it("filtre que le robot ne porte pas : le compte est dit non calculable", () => {
    const html = renderToStaticMarkup(
      <TuileAngleMort etat={{ kind: "refus", raison: "dimension device non portée" }} href="/correlation" regle={REGLE} plage="24 h" />,
    );
    expect(html).toContain("compte non calculable sous ce filtre : dimension device non portée");
  });
});
