// F18 — tuiles de /errors (components/errors/ApercuErreurs.tsx), rendu SSR réel.
//
// Ce que la rangée refuse d'affirmer : des sessions touchées « 0 » quand aucune
// occurrence n'est rattachée à une session (erreurs backend), une part calculée sans
// dénominateur ou sur une population échantillonnée différemment, un « % » sur un
// compte d'occurrences.
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { TuilesErreurs } from "@/components/errors/ApercuErreurs";
import type { TotauxErreurs } from "@/lib/queries-errors";

// Une tuile en échec rend « Réessayer » (SectionErreur, client), qui lit le routeur
// de Next : hors application, un routeur inerte (même montage que Figure.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

type Props = ComponentProps<typeof TuilesErreurs>;

const totaux = (over: Partial<TotauxErreurs["totals"]> = {}): TotauxErreurs => ({
  totals: {
    occurrences: 77,
    sessions_affected: 6,
    visitors_affected: 6,
    identified_users_affected: null,
    session_coverage: 1,
    identity_coverage: 1,
    groups: 6,
    unfingerprinted: 0,
    ...over,
  },
  trend: [0, 1, 2].map((i) => ({ bucket: new Date(Date.UTC(2026, 8, 22, i)), occurrences: [30, 40, 7][i] })),
});

const BASE: Props = {
  plage: "24 h",
  totaux: { ok: true, data: totaux() },
  totauxPrec: null,
  part: { ok: true, data: { lu: { base: 60, touchees: 6, tauxMin: 1 } } },
  partPrec: null,
  nouveaux: { ok: true, data: 6 },
  nouveauxPrec: null,
  reference: null,
  hrefSessions: "/errors?app=a&tri=sessions#groupes-erreurs",
  hrefNouveaux: "/errors?app=a&nouveaux=1#groupes-erreurs",
};

const rendu = (props: Partial<Props> = {}) =>
  renderToStaticMarkup(<TuilesErreurs {...BASE} {...props} />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("F18 — TuilesErreurs", () => {
  it("quatre tuiles ; les occurrences sont un compte, jamais un « % »", () => {
    const html = renderToStaticMarkup(<TuilesErreurs {...BASE} />);
    expect(html.match(/data-testid="kpi-tile"/g)).toHaveLength(4);
    const texte = rendu();
    expect(texte).toContain("Occurrences 77");
    expect(texte).toContain("Groupes apparus sur la période 6");
    expect(texte).toContain("Part des sessions touchées 10,0");
    expect(texte).toContain("6 sessions avec vue et au moins une erreur, sur 60 sessions avec au moins une vue");
  });

  it("aucune occurrence rattachée à une session → « Inconnu », jamais 0", () => {
    const texte = rendu({ totaux: { ok: true, data: totaux({ sessions_affected: null, session_coverage: 0 }) } });
    expect(texte).toContain("Sessions touchées — Inconnu : aucune occurrence rattachée à une session");
    expect(texte).not.toContain("Sessions touchées 0");
  });

  it("aucune occurrence du tout → 0 sessions touchées (un vide réel)", () => {
    const texte = rendu({ totaux: { ok: true, data: totaux({ occurrences: 0, sessions_affected: null, session_coverage: null }) } });
    expect(texte).toContain("Sessions touchées 0");
  });

  it("part : base vide → raison nommant la plage ; échantillonnage biaisé → non calculable ; filtre refusé → dit", () => {
    expect(rendu({ part: { ok: true, data: { lu: { base: 0, touchees: 0, tauxMin: null } } } })).toContain(
      "aucune session avec vue sur 24 h",
    );
    expect(rendu({ part: { ok: true, data: { lu: { base: 60, touchees: 6, tauxMin: 0.1 } } } })).toContain(
      "part non calculable",
    );
    expect(rendu({ part: { ok: true, data: { refus: "« Service » est sans objet pour les pages vues" } } })).toContain(
      "part non calculable : « Service » est sans objet pour les pages vues",
    );
  });

  it("une lecture en échec n'efface que SA tuile, et ne dit jamais 0", () => {
    const html = renderToStaticMarkup(<TuilesErreurs {...BASE} nouveaux={{ ok: false, raison: "boom" }} />);
    expect(html.match(/data-testid="kpi-tile"/g)).toHaveLength(3);
    expect(html).toContain("Groupes apparus sur la période");
    expect(html).toContain('data-testid="echec-lecture"');
  });

  it("cmp=prev : la référence datée est écrite ; une période précédente en échec n'est pas « pas de mesure »", () => {
    const reference = "vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC)";
    const avecPrec = rendu({
      reference,
      totauxPrec: { ok: true, data: totaux({ occurrences: 70 }) },
      couvErreurs: { etat: "complete", raison: null },
    });
    expect(avecPrec).toContain("+10 % vs 24 h précédentes");
    const enEchec = rendu({ reference, totauxPrec: { ok: false, raison: "boom" } });
    expect(enEchec).toContain("période précédente incomplète : lecture de la période précédente en échec");
  });

  it("aucune tuile n'a de ton de verdict (R-S)", () => {
    const html = renderToStaticMarkup(<TuilesErreurs {...BASE} />);
    expect(html).not.toContain('data-ton="bad"');
  });
});
