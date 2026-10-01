// RankBar (F03, plan § 4.1) : props de ligne inchangées ; alternative textuelle
// intégrée, libellés bornés à 7rem sous 640 px, image sans lien / liste avec liens.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RankBar, texteLibelle } from "@/components/charts/RankBar";
import { SERIE } from "@/lib/palette";

const LIGNES = [
  { label: "/checkout", value: 3420, display: "3,4 s", sub: "412 mesures" },
  { label: "/compte", value: null, sub: "12 mesures" },
];

describe("RankBar", () => {
  it("alternative intégrée : mêmes lignes que les barres, valeur inconnue « — »", () => {
    const html = renderToStaticMarkup(<RankBar data={LIGNES} legende="LCP p75 par route" />);
    expect(html).toContain('data-testid="alternative"');
    expect(html).toContain("LCP p75 par route");
    expect(html.match(/scope="row"/g)).toHaveLength(2);
    expect(html).toMatch(/scope="row"[^>]*>\/compte<\/th><td[^>]*>—</);
  });

  it("alternative={false} : pas de doublon dans une Figure", () => {
    expect(renderToStaticMarkup(<RankBar data={LIGNES} alternative={false} />)).not.toContain("<details");
  });

  it("sans lien : une image nommée ; avec liens : une liste (un role=img masquerait les liens)", () => {
    expect(renderToStaticMarkup(<RankBar data={LIGNES} legende="LCP" />)).toContain('role="img" aria-label="LCP"');
    const liens = renderToStaticMarkup(<RankBar data={[{ ...LIGNES[0], href: "/pages?route=%2Fcheckout" }]} />);
    expect(liens).toContain('role="list"');
    expect(liens).not.toContain('role="img"');
  });

  it("libellés : 7rem au plus sous 640 px, largeur voulue au-delà", () => {
    const html = renderToStaticMarkup(<RankBar data={LIGNES} labelWidth="14rem" />);
    expect(html).toContain("--rank-label:14rem");
    expect(html).toContain("w-[min(7rem,var(--rank-label))]");
    expect(html).toContain("sm:w-[var(--rank-label)]");
  });

  it("couleur par défaut : la série principale de lib/palette.ts ; valeur null : aucune barre", () => {
    const html = renderToStaticMarkup(<RankBar data={LIGNES} />);
    const couleur = SERIE.principale.toLowerCase();
    // Un jeton `rgb(var(--c-serie))` : compté comme texte, ses parenthèses ne sont pas une regex.
    expect(html.toLowerCase().split(`background-color:${couleur}`).length - 1).toBe(1);
  });

  // Recette du 26/09/2026 : « Direct ou référen… » à 390 px — le libellé passe à la ligne.
  // Recette du 01/10/2026 : le sous-texte sur trois lignes faisait de chaque rangée un
  // paragraphe — il tient sur une ligne, coupé, entier en bulle.
  it("libellé : passe à la ligne, jamais coupé ; sous-texte : une ligne coupée, entier en bulle", () => {
    const html = renderToStaticMarkup(
      <RankBar data={[{ label: "Direct ou référent inconnu", value: 12, sub: "12 sessions · 7,1 % du total", href: "/x" }]} />,
    );
    expect(html).toMatch(/<a class="block min-w-0 \[overflow-wrap:anywhere\][^"]*"[^>]*>Direct ou référent inconnu<\/a>/);
    expect(html).toContain('<div class="truncate text-[10px] text-ink-faint" title="12 sessions · 7,1 % du total">');
    expect(html.match(/truncate/g)).toHaveLength(1);
  });

  it("libellé en nœud (pictogramme + nom) : `labelTexte` donne la bulle, la clé et l'alternative", () => {
    const html = renderToStaticMarkup(
      <RankBar
        data={[{ label: <><i aria-hidden="true">🇫🇷</i> France</>, labelTexte: "France", value: 40 }]}
        legende="Sessions par pays"
      />,
    );
    expect(html).toContain('title="France"');
    expect(html).toContain("🇫🇷");
    expect(html).toMatch(/scope="row"[^>]*>France<\/th>/);
    expect(texteLibelle({ label: "Chrome" })).toBe("Chrome");
    expect(texteLibelle({ label: <b>x</b> })).toBe("");
    expect(texteLibelle({ label: <b>x</b>, labelTexte: "Firefox" })).toBe("Firefox");
  });

  it("ligne active : marquée et annoncée (aria-current)", () => {
    const html = renderToStaticMarkup(
      <RankBar data={[{ label: "form-contact", value: 4, href: "/forms?form=a", actif: true }, { label: "form-b", value: 2, href: "/forms?form=b" }]} />,
    );
    expect(html.match(/aria-current="true"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/data-actif=""/g)).toHaveLength(1);
  });
});
