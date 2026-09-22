// HealthBanner (F11, plan § 4.1, § 5.1.2) : variante `compact` de la Vue d'ensemble.
// Le détail de chaque facteur est VISIBLE sous sa barre (plus dans un `title`) ; un
// facteur sans donnée dit « n/a » (ou sa raison) et garde son détail ; aucun
// libellé tronqué ; chaque facteur mène à l'écran de sa mesure ; la ligne fixe dit
// que le score mêle deux fenêtres.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HealthBanner, LIGNE_FIXE_SANTE } from "@/components/health/HealthBanner";
import type { Health } from "@/lib/health";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const SANTE: Health = {
  score: 72,
  label: "Dégradé",
  anomalies: [],
  factors: [
    { key: "vitals", label: "Web Vitals", detail: "81 % de mesures « good » (pondéré, LCP x2)", earned: 32.4, max: 40 },
    // Sans page vue : aucun dénominateur, la composante sort du score (« n/a »).
    { key: "errors", label: "Erreurs navigateur", detail: "aucune page vue : ratio non calculable", earned: null, max: 30 },
    { key: "stability", label: "Stabilité des sessions", detail: "18/20 session(s) sans erreur", earned: 18, max: 20 },
    {
      key: "anomalies",
      label: "Anomalies LCP (24 h)",
      detail: "non testable : 0 route avec 5 heures de mesures LCP sur 8 jours",
      earned: null,
      max: 10,
      raisonNull: "non testable",
    },
  ],
};

const LIENS = { vitals: "/pages?app=a", errors: "/errors?app=a", stability: "/sessions?app=a", anomalies: "#anomalies" };

describe("HealthBanner compact", () => {
  const html = renderToStaticMarkup(<HealthBanner health={SANTE} periodLabel="24 h" compact liens={LIENS} />);
  const t = texte(html);

  it("écrit le détail de chaque facteur sous sa barre, pas dans un title", () => {
    for (const f of SANTE.factors) expect(t).toContain(f.detail);
    expect(html.match(/data-testid="facteur-detail"/g)).toHaveLength(4);
    expect(html).not.toContain(" title=");
  });

  it("un facteur sans donnée dit « n/a » (ou sa raison), et garde son détail", () => {
    const erreurs = html.slice(html.indexOf('data-testid="facteur-errors"'));
    expect(texte(erreurs.slice(0, erreurs.indexOf("</a>")))).toContain("n/a");
    expect(t).toContain("aucune page vue : ratio non calculable");
    // La raison « non testable » de P*.1 (0-c) reste écrite à la place de « n/a ».
    const anomalies = html.slice(html.indexOf('data-testid="facteur-anomalies"'));
    expect(texte(anomalies.slice(0, anomalies.indexOf("</a>")))).toContain("non testable");
  });

  it("aucun libellé de facteur n'est tronqué : il passe à la ligne", () => {
    for (const f of SANTE.factors) expect(t).toContain(f.label);
    const libelles = html.match(/<span[^>]*data-testid="facteur-libelle"[^>]*>/g) ?? [];
    expect(libelles).toHaveLength(4);
    for (const l of libelles) expect(l).not.toContain("truncate");
  });

  it("chaque facteur mène à l'écran de sa mesure", () => {
    expect(html).toContain('href="/pages?app=a"');
    expect(html).toContain('href="/errors?app=a"');
    expect(html).toContain('href="/sessions?app=a"');
    expect(html).toContain('href="#anomalies"');
  });

  it("l'anneau est une image nommée ; formule et ligne fixe sont écrites", () => {
    expect(html).toMatch(/role="img" aria-label="Score de santé 72 sur 100, Dégradé"/);
    expect(t).toContain("30 % erreurs navigateur");
    expect(t).toContain(LIGNE_FIXE_SANTE);
    expect(t).toContain("Mêle la période choisie et des anomalies sur 24 h fixes.");
  });

  it("aucun facteur n'est affiché en pourcentage d'erreurs", () => {
    expect(t).not.toMatch(/\d+(,\d+)? ?% d'erreurs/);
    expect(t).not.toMatch(/taux d'erreur/i);
  });

  it("score inconnu : « Santé : données insuffisantes », jamais un 0", () => {
    const vide = renderToStaticMarkup(
      <HealthBanner health={{ ...SANTE, score: null, label: null }} periodLabel="1 h" compact liens={LIENS} />,
    );
    expect(texte(vide)).toContain("Santé : données insuffisantes");
    expect(vide).not.toContain('data-testid="health-score"');
  });
});

describe("HealthBanner (variante complète)", () => {
  it("garde le détail en bulle et la liste des points perdus", () => {
    const html = renderToStaticMarkup(<HealthBanner health={SANTE} periodLabel="24 h" />);
    expect(html).toContain('title="81 % de mesures « good » (pondéré, LCP x2)"');
    expect(texte(html)).toContain("Points perdus");
    expect(html).not.toContain('data-testid="facteur-detail"');
  });
});
