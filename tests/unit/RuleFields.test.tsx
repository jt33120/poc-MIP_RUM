// F64 — le formulaire d'une règle d'alerte (plan § 5.19 A8) et sa ligne (A7).
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Que les treize champs reviennent à plat : un `<fieldset>` par mode, et les
//     classes qui portent le masquage `:has()` (pure CSS, aucun JavaScript).
//   - Qu'un champ masqué soit `required` : le navigateur bloquerait alors l'envoi
//     sans que rien ne soit visible.
//   - Que « Régression de release » passe pour utilisable : elle est désactivée,
//     avec sa raison (B52), et son seuil prévu écrit.
//   - Qu'un viewer voie un bouton d'écriture (V9) : la ligne d'une règle ne rend
//     NI formulaire NI bouton sans droit d'écriture.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Les actions serveur tirent la base : seules leurs références comptent ici.
vi.mock("@/app/alerts/actions", () => ({
  toggleRuleAction: () => undefined,
  updateRuleAction: () => undefined,
}));

import { RuleFields, RAISON_REGRESSION_RELEASE, SEUIL_REGRESSION_DEFAUT } from "@/components/alerts/RuleFields";
import { PHRASE_REGLE_RELEASE, RAISON_DETECTION_RELEASE } from "@/components/alerts/RuleFields";
import { PHRASE_FENETRE } from "@/components/ReleaseCompare";
import { RuleRow } from "@/components/alerts/RuleRow";
import type { AlertRuleRow } from "@/lib/queries-v2";

const APPS = [{ app_id: "demo", name: "Démo" }];

const REGLE: AlertRuleRow = {
  id: 7,
  app_id: "demo",
  metric: "LCP",
  route: "/checkout",
  comparator: ">",
  threshold: 2500,
  window_minutes: 15,
  webhook_url: null,
  active: true,
  created_at: new Date("2026-09-01T00:00:00Z"),
  mode: "threshold",
  severity: "warning",
  sensitivity: 3,
  baseline_weeks: 4,
  unacked: 2,
  env: null,
  last_state: "no_data",
  last_value: null,
  last_reason: "moins de 4 fenêtres comparables",
  last_evaluated_at: new Date("2026-09-22T10:00:00Z"),
};

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

describe("F64 — RuleFields : un fieldset par mode", () => {
  const html = renderToStaticMarkup(<RuleFields apps={APPS} />);

  it("les deux modes utilisables sont des boutons radio, « seuil » coché par défaut", () => {
    expect(html).toContain('value="threshold"');
    expect(html).toContain('value="baseline"');
    const seuil = /<input[^>]*value="threshold"[^>]*>/.exec(html)?.[0] ?? "";
    expect(seuil).toContain("checked");
  });

  it("les classes du masquage CSS sont là (sans elles, les deux blocs restent visibles : le repli déclaré)", () => {
    expect(html).toContain("regle-modes");
    expect(html).toContain("regle-mode-seuil");
    expect(html).toContain("regle-mode-baseline");
    expect(html).toContain("regle-champs-seuil");
    expect(html).toContain("regle-champs-baseline");
  });

  it("aucun champ masquable n'est `required` : un champ requis masqué bloquerait l'envoi en silence", () => {
    for (const champ of ["threshold", "sensitivity", "baseline_weeks"]) {
      const balise = new RegExp(`<input[^>]*name="${champ}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(balise, champ).not.toContain("required");
    }
  });

  it("« Régression de release » est présentée, DÉSACTIVÉE par défaut (base sans v86), avec sa raison et son seuil prévu", () => {
    const balise = /<input[^>]*value="release"[^>]*>/.exec(html)?.[0] ?? "";
    expect(balise).toContain("disabled");
    expect(texte(html)).toContain(RAISON_REGRESSION_RELEASE);
    expect(texte(html)).toContain(`${SEUIL_REGRESSION_DEFAUT} % prévu`);
    // Aucun champ d'un mode qu'on ne peut pas choisir.
    expect(html).not.toContain("regle-champs-release");
    expect(html).not.toContain('name="release_pct"');
  });

  it("le pré-remplissage `regle_*` (§ 3.1) remplit métrique, route et seuil", () => {
    const rempli = renderToStaticMarkup(
      <RuleFields apps={APPS} regle={{ metrique: "INP", route: "/checkout", seuil: 300 }} />,
    );
    expect(rempli).toMatch(/name="route"[^>]*value="\/checkout"/);
    expect(rempli).toMatch(/name="threshold"[^>]*value="300"/);
    expect(rempli).toMatch(/<option selected[^>]*value="INP"|value="INP"[^>]*selected/);
  });
});

describe("F68 — RuleFields : « Régression de release » quand la base porte v86 (B52)", () => {
  const DISPONIBLE = { disponible: true } as const;
  const html = renderToStaticMarkup(<RuleFields apps={APPS} modeRelease={DISPONIBLE} />);

  it("l'option est un vrai mode : activée, valeur `release`, classe du masquage, non cochée par défaut", () => {
    const balise = /<input[^>]*value="release"[^>]*>/.exec(html)?.[0] ?? "";
    expect(balise).not.toContain("disabled");
    expect(balise).not.toContain("checked");
    expect(balise).toContain("regle-mode-release");
    expect(html).not.toContain('data-testid="raison-release"');
  });

  it("son fieldset porte la hausse tolérée (+20 % par défaut, sans `required`) et la phrase obligatoire", () => {
    expect(html).toContain("regle-champs-release");
    const hausse = /<input[^>]*name="release_pct"[^>]*>/.exec(html)?.[0] ?? "";
    expect(hausse).toContain(`value="${SEUIL_REGRESSION_DEFAUT}"`);
    expect(hausse).not.toContain("required");
    expect(texte(html)).toContain(PHRASE_REGLE_RELEASE);
    expect(PHRASE_REGLE_RELEASE).toContain(PHRASE_FENETRE);
    expect(PHRASE_REGLE_RELEASE).toContain("100 mesures");
  });

  it("une règle de release existante : mode coché, sa hausse relue dans `threshold`", () => {
    const edition = renderToStaticMarkup(
      <RuleFields apps={APPS} rule={{ ...REGLE, mode: "release", threshold: 35 }} modeRelease={DISPONIBLE} />,
    );
    expect(/<input[^>]*value="release"[^>]*>/.exec(edition)?.[0] ?? "").toContain("checked");
    expect(edition).toMatch(/name="release_pct"[^>]*value="35"/);
  });

  it("détection en échec sur une règle de release : son mode reste envoyé (refusé par l'action, jamais converti en seuil)", () => {
    const edition = renderToStaticMarkup(
      <RuleFields
        apps={APPS}
        rule={{ ...REGLE, mode: "release", threshold: 20 }}
        modeRelease={{ disponible: false, raison: RAISON_DETECTION_RELEASE }}
      />,
    );
    expect(edition).toMatch(/<input type="hidden" name="mode" value="release"\/>/);
    expect(texte(edition)).toContain(RAISON_DETECTION_RELEASE);
    expect(/<input[^>]*value="threshold"[^>]*>/.exec(edition)?.[0] ?? "").not.toContain("checked");
  });
});

describe("F68 — RuleRow d'une règle de release : ce qu'elle a comparé", () => {
  const RELEASE: AlertRuleRow = {
    ...REGLE,
    mode: "release",
    threshold: 20,
    window_minutes: 1440,
    last_state: "breached",
    last_value: 3100,
    last_reason: "1.4.2 : p75 3100 (240 mesures) contre 1.4.1 : p75 2500 (800 mesures), +24 % pour +20 % tolérés",
  };

  it("l'état porte le détail de la comparaison (releases, effectifs, écart), pas une valeur nue", () => {
    const html = texte(renderToStaticMarkup(<RuleRow rule={RELEASE} apps={APPS} />));
    expect(html).toContain(`Franchie — ${RELEASE.last_reason}`);
    expect(html).not.toContain("(3 100)");
    expect(html).toContain("régression de release : p75 en hausse de +20 % ou plus contre la release précédente");
    expect(html).toContain(PHRASE_FENETRE);
  });

  it("sans données : la raison du `no_data`, comme les autres modes", () => {
    const html = texte(
      renderToStaticMarkup(
        <RuleRow
          rule={{ ...RELEASE, last_state: "no_data", last_value: null, last_reason: "une seule release déclarée (1.4.2) : il en faut deux pour comparer" }}
          apps={APPS}
        />,
      ),
    );
    expect(html).toContain("Données insuffisantes — une seule release déclarée (1.4.2) : il en faut deux pour comparer");
  });
});

describe("F64 — RuleRow : l'état d'abord, l'écriture seulement pour un administrateur", () => {
  it("la ligne dit ce que la règle surveille et pourquoi elle n'a pas de données", () => {
    const html = texte(renderToStaticMarkup(<RuleRow rule={REGLE} apps={APPS} admin />));
    expect(html).toContain("LCP (ms) · /checkout");
    expect(html).toContain("Données insuffisantes");
    expect(html).toContain("moins de 4 fenêtres comparables");
    expect(html).toContain("seuil : > 2 500 sur 15 min");
    expect(html).toContain("2 non acquittée(s)");
  });

  it("l'ancre `regle-<id>` existe : la frise et les tuiles y mènent", () => {
    expect(renderToStaticMarkup(<RuleRow rule={REGLE} apps={APPS} admin />)).toContain('id="regle-7"');
  });

  it("sans droit d'écriture : aucun formulaire, aucun bouton dans le DOM (V9)", () => {
    const html = renderToStaticMarkup(<RuleRow rule={REGLE} apps={APPS} />);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    // L'état, lui, reste lisible.
    expect(texte(html)).toContain("Données insuffisantes");
  });
});
