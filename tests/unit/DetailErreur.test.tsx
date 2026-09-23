// F21 — blocs du détail d'erreur (components/errors/DetailErreur.tsx), rendu SSR réel.
//
// Ces blocs servent trois supports : le panneau et la page d'un groupe (F20), et
// la page d'une issue v2 (F21). Ce que ce fichier prouve des ajouts de F21 :
//   - une issue qui se TAIT sur la fenêtre (zéro occurrence) touche zéro session et
//     zéro visiteur — un compte vide, jamais « Inconnu » (V3 : l'inconnu n'est dit
//     que lorsqu'il y a des occurrences non rattachées) ;
//   - les tuiles de la page d'une issue gardent les repères `issue-*` que ses e2e
//     désignent depuis P5.5 ; celles d'un groupe, `detail-*` ;
//   - « Versions touchées » d'une issue écrit ce que l'issue PERSISTE (release de sa
//     première et de sa dernière occurrence), dit que ni la fenêtre ni les filtres ne
//     s'y appliquent, et n'invente pas de nombre de versions distinctes ;
//   - le bloc d'un groupe garde son texte.
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  PhraseImpact,
  TuilesDetailErreur,
  VersionsTouchees,
  comptesTouches,
  versionsDeLIssue,
} from "@/components/errors/DetailErreur";
import { fmtDate } from "@/lib/format";
import type { ErrorImpact } from "@/lib/queries-errors";
// Revue de fin de vague 7 — portée des occurrences affichées (blocs 1 et 5).
import {
  BoutonRejeu as BoutonRejeuV7,
  QuOntEnCommun as QuOntEnCommunV7,
  occurrencesDuRepli as occurrencesDuRepliV7,
  porteeOccurrences as porteeOccurrencesV7,
  texteSansRejeu as texteSansRejeuV7,
  type PorteeOccurrences as PorteeOccurrencesV7,
} from "@/components/errors/DetailErreur";
import type { ErrorOccurrenceRow as ErrorOccurrenceRowV7 } from "@/lib/queries-errors";

// Un bloc en échec rend « Réessayer » (SectionErreur, client), qui lit le routeur de
// Next : hors application, un routeur inerte (même montage que TuilesErreurs.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

/** Le texte rendu, balises retirées et espaces (dont insécables) normalisés. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/[\s\u00a0\u202f]+/g, " ");

/** La valeur rendue sous un repère de test : `<span data-testid="x">valeur</span>`. */
const valeurSous = (html: string, testid: string) =>
  html.match(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`))?.[1] ?? null;

const impact = (over: Partial<ErrorImpact> = {}): ErrorImpact => ({
  occurrences: 8,
  sessions_affected: 1,
  visitors_affected: 1,
  identified_users_affected: null,
  session_coverage: 1,
  identity_coverage: 1,
  ...over,
});

const PART_LUE: ComponentProps<typeof PhraseImpact>["part"] = {
  ok: true,
  data: { lu: { base: 4, touchees: 2, tauxMin: 1 } },
};

describe("F21 — comptesTouches : sessions et visiteurs touchés", () => {
  it("zéro occurrence : zéro session et zéro visiteur, un compte vide", () => {
    expect(comptesTouches(impact({ occurrences: 0, sessions_affected: null, visitors_affected: null }))).toEqual({
      sessions: 0,
      visiteurs: 0,
    });
  });

  it("des occurrences non rattachées : inconnu (null), jamais 0", () => {
    expect(comptesTouches(impact({ sessions_affected: null, visitors_affected: null }))).toEqual({
      sessions: null,
      visiteurs: null,
    });
    expect(comptesTouches(impact())).toEqual({ sessions: 1, visiteurs: 1 });
  });
});

describe("F21 — PhraseImpact sur l'impact d'une issue", () => {
  it("issue muette sur la fenêtre : « 0 sessions et 0 visiteurs », aucun « Inconnu »", () => {
    const html = renderToStaticMarkup(
      <PhraseImpact
        impact={impact({ occurrences: 0, sessions_affected: null, visitors_affected: null, identity_coverage: null })}
        plage="24 h"
        part={{ ok: true, data: { lu: { base: 4, touchees: 0, tauxMin: 1 } } }}
        hrefSessions={null}
      />,
    );
    const t = texte(html);
    expect(t).toContain("0 occurrences sur 24 h, touchant 0 sessions et 0 visiteurs");
    expect(t).not.toContain("Inconnu");
  });

  it("erreur backend : sessions et visiteurs « Inconnu » ; la part garde son dénominateur nommé", () => {
    const t = texte(
      renderToStaticMarkup(
        <PhraseImpact
          impact={impact({ sessions_affected: null, visitors_affected: null })}
          plage="24 h"
          part={PART_LUE}
          hrefSessions={null}
        />,
      ),
    );
    expect(t).toContain("touchant Inconnu sessions et Inconnu visiteurs");
    expect(t).toContain("des 4 sessions avec au moins une vue");
  });
});

describe("F21 — TuilesDetailErreur : repères de test par support", () => {
  it("page d'une issue : `issue-*`, les repères que ses e2e désignent", () => {
    const html = renderToStaticMarkup(<TuilesDetailErreur impact={impact()} plage="24 h" prefixe="issue" />);
    expect(valeurSous(html, "issue-occurrences")).toBe("8");
    expect(valeurSous(html, "issue-sessions")).toBe("1");
    expect(valeurSous(html, "issue-users")).toBe("1");
    expect(html).toContain('data-testid="issue-couverture"');
    expect(html).not.toContain('data-testid="detail-');
  });

  it("groupe et panneau (défaut) : `detail-*`, inchangés", () => {
    const html = renderToStaticMarkup(<TuilesDetailErreur impact={impact()} plage="24 h" />);
    expect(valeurSous(html, "detail-occurrences")).toBe("8");
    expect(html).not.toContain('data-testid="issue-');
  });

  it("issue muette : visiteurs 0, pas « — » avec une raison d'inconnu", () => {
    const html = renderToStaticMarkup(
      <TuilesDetailErreur
        impact={impact({ occurrences: 0, sessions_affected: null, visitors_affected: null, identity_coverage: null })}
        plage="24 h"
        prefixe="issue"
      />,
    );
    expect(valeurSous(html, "issue-sessions")).toBe("0");
    expect(valeurSous(html, "issue-users")).toBe("0");
    expect(texte(html)).not.toContain("aucune occurrence rattachée à un visiteur connu");
    // Sans occurrence, la couverture n'a pas de dénominateur : elle reste inconnue.
    expect(valeurSous(html, "issue-couverture")).toBe("—");
  });
});

describe("F21 — versionsDeLIssue", () => {
  const PREMIERE = new Date("2026-09-20T08:00:00Z");
  const DERNIERE = new Date("2026-09-23T07:55:00Z");

  it("release de la première et de la dernière occurrence, datées de ces occurrences", () => {
    expect(
      versionsDeLIssue({ first_release: "1.0.0", first_seen: PREMIERE, last_release: "1.1.0", last_seen: DERNIERE }),
    ).toEqual({
      premiere: { release: "1.0.0", ts: PREMIERE },
      derniere: { release: "1.1.0", ts: DERNIERE },
    });
  });

  it("une occurrence sans version : null (« release non déclarée »), jamais la version d'une autre", () => {
    expect(
      versionsDeLIssue({ first_release: null, first_seen: PREMIERE, last_release: "1.1.0", last_seen: DERNIERE }),
    ).toEqual({ premiere: null, derniere: { release: "1.1.0", ts: DERNIERE } });
    expect(
      versionsDeLIssue({ first_release: "", first_seen: PREMIERE, last_release: null, last_seen: DERNIERE }),
    ).toEqual({ premiere: null, derniere: null });
  });
});

describe("F21 — VersionsTouchees", () => {
  const PREMIERE = new Date("2026-09-20T08:00:00Z");
  const DERNIERE = new Date("2026-09-23T07:55:00Z");

  it("issue : deux lignes datées, la portée dite, aucun nombre de versions inventé", () => {
    const html = renderToStaticMarkup(
      <VersionsTouchees
        issue={{ premiere: { release: "1.0.0", ts: PREMIERE }, derniere: { release: "1.1.0", ts: DERNIERE } }}
      />,
    );
    expect(html).toContain('data-portee="issue"');
    expect(texte(valeurSous(html, "premiere-release") ?? "")).toBe(texte(`1.0.0 · ${fmtDate(PREMIERE)}`));
    expect(texte(valeurSous(html, "derniere-release") ?? "")).toBe(texte(`1.1.0 · ${fmtDate(DERNIERE)}`));
    const t = texte(html);
    expect(t).toContain("ni la fenêtre ni les filtres de l'écran ne s'y appliquent");
    expect(t).toContain("groupes historiques repris compris");
    expect(t).not.toMatch(/versions? distinctes?|une seule version/);
  });

  it("issue sans version déclarée : dit, jamais une version devinée", () => {
    const html = renderToStaticMarkup(<VersionsTouchees issue={{ premiere: null, derniere: null }} />);
    expect(texte(html)).toContain(
      "Release non déclarée : ni la première ni la dernière occurrence de l'issue ne porte de version.",
    );
    expect(html).not.toContain('data-testid="premiere-release"');
  });

  it("issue dont seule la dernière occurrence déclare une version", () => {
    const html = renderToStaticMarkup(
      <VersionsTouchees issue={{ premiere: null, derniere: { release: "1.1.0", ts: DERNIERE } }} />,
    );
    expect(valeurSous(html, "premiere-release")).toBe("release non déclarée");
    expect(texte(valeurSous(html, "derniere-release") ?? "")).toBe(texte(`1.1.0 · ${fmtDate(DERNIERE)}`));
  });

  it("groupe (F20) : texte inchangé, nombre de versions distinctes lu", () => {
    const html = renderToStaticMarkup(
      <VersionsTouchees
        releases={{
          ok: true,
          data: {
            premiere: { release: "1.0.0", ts: PREMIERE },
            derniere: { release: "1.5.0", ts: DERNIERE },
            distinctes: 3,
          },
        }}
      />,
    );
    expect(html).toContain('data-portee="groupe"');
    expect(texte(html)).toContain(
      "3 versions distinctes ont porté ce groupe — depuis toujours, hors fenêtre. Une première release récente se lit comme une régression, une première release ancienne comme une dette.",
    );
    const vide = renderToStaticMarkup(
      <VersionsTouchees releases={{ ok: true, data: { premiere: null, derniere: null, distinctes: 0 } }} />,
    );
    expect(texte(vide)).toContain("Release non déclarée : aucune occurrence de ce groupe ne porte de version.");
  });

  it("groupe en échec de lecture : l'échec dit, aucune ligne dessinée", () => {
    const html = renderToStaticMarkup(<VersionsTouchees releases={{ ok: false, raison: "panne" }} />);
    expect(html).not.toContain('data-testid="versions-touchees"');
    expect(texte(html)).toContain("Versions touchées");
  });
});

// Revue de fin de vague 7 (F20/F21) — le bloc 5 écrivait « dernières occurrences
// affichées… les plus récentes » et le bloc 1 « Aucune occurrence de la fenêtre n'a de
// rejeu » MÊME EN PAGINANT : les occurrences lues sont alors celles de la page
// affichée, ni les plus récentes, ni toute la fenêtre.
describe("Revue v7 — portée des occurrences affichées : fenêtre, plus récentes, cette page", () => {
  /** Une occurrence de la route `route`, avec ou sans rejeu enregistré. */
  const occurrenceV7 = (id: number, route: string, rejeu = false): ErrorOccurrenceRowV7 => ({
    id,
    ts: new Date(Date.parse("2026-09-17T10:00:00Z") - id * 60_000),
    route,
    session_id: `s${id}`,
    kind: "error",
    message: "boom",
    device_type: "desktop",
    occurrences: 1,
    release: "1.4.2",
    error_source: "browser_js",
    handled: false,
    is_fatal: null,
    view_name: null,
    env: null,
    service: null,
    trace_id: null,
    source_parent_span_id: null,
    links: { session: true, replay: rejeu, trace: false, parent_span: false, action: null },
  });
  const SANS_REJEU = [occurrenceV7(1, "/panier"), occurrenceV7(2, "/panier"), occurrenceV7(3, "/compte")];
  const repli = (portee: PorteeOccurrencesV7) =>
    renderToStaticMarkup(
      <QuOntEnCommunV7 occurrences={SANS_REJEU} plage="24 h" touchees={3} hrefValeur={() => null} portee={portee} />,
    );

  it("la portée se déduit du curseur et de la page suivante", () => {
    expect(porteeOccurrencesV7({ curseur: false, suite: false })).toBe("fenetre");
    expect(porteeOccurrencesV7({ curseur: false, suite: true })).toBe("recentes");
    // Une page atteinte par curseur : « cette page », qu'une suite existe ou non.
    expect(porteeOccurrencesV7({ curseur: true, suite: true })).toBe("page");
    expect(porteeOccurrencesV7({ curseur: true, suite: false })).toBe("page");
  });

  it("bloc 5 en paginant : « des N occurrences de cette page », jamais « dernières » ni « les plus récentes »", () => {
    const html = texte(repli("page"));
    expect(html).toContain("Répartition des 3 occurrences de cette page (pas de la population)");
    expect(html).toContain("Ces parts sont celles des occurrences de CETTE PAGE : elles ne disent pas");
    expect(html).not.toContain("dernières occurrences");
    expect(html).not.toContain("les plus récentes");
    // L'alternative de chaque répartition porte la même population.
    expect(html).toContain("Route des 3 occurrences de cette page");
  });

  it("bloc 5 en première page : les dernières occurrences affichées, les plus récentes (texte d'avant)", () => {
    for (const portee of ["fenetre", "recentes"] as const) {
      const html = texte(repli(portee));
      expect(html, portee).toContain("Répartition des 3 dernières occurrences affichées (pas de la population)");
      expect(html, portee).toContain("Ces parts sont celles des occurrences AFFICHÉES, les plus récentes : elles ne disent pas");
      expect(html, portee).not.toContain("cette page");
    }
  });

  it("une seule occurrence lue : au singulier, jamais « des 1 occurrences »", () => {
    expect(occurrencesDuRepliV7("page", 1)).toBe("de l'occurrence de cette page");
    expect(occurrencesDuRepliV7("recentes", 1)).toBe("de la dernière occurrence affichée");
    expect(occurrencesDuRepliV7("page", 2)).toBe("des 2 occurrences de cette page");
  });

  it("bloc 1 sans rejeu : la phrase ne porte que sur les occurrences LUES", () => {
    const absent = (portee: PorteeOccurrencesV7, occurrences = SANS_REJEU) =>
      texte(renderToStaticMarkup(<BoutonRejeuV7 occurrences={occurrences} appId="a" portee={portee} />)).trim();
    expect(absent("fenetre")).toBe("Aucune occurrence de la fenêtre n'a de rejeu.");
    expect(absent("recentes")).toBe("Aucune des 3 occurrences les plus récentes n'a de rejeu.");
    expect(absent("recentes", [occurrenceV7(1, "/panier")])).toBe("L'occurrence la plus récente n'a pas de rejeu.");
    expect(absent("page")).toBe("Aucune occurrence de cette page n'a de rejeu.");
    expect(texteSansRejeuV7("page", 3)).not.toContain("fenêtre");
  });

  it("bloc 1 avec un rejeu : le même bouton, quelle que soit la page", () => {
    const avec = [occurrenceV7(1, "/panier"), occurrenceV7(2, "/panier", true)];
    for (const portee of ["fenetre", "recentes", "page"] as const) {
      const html = renderToStaticMarkup(<BoutonRejeuV7 occurrences={avec} appId="a" portee={portee} />);
      expect(html, portee).toContain('data-testid="voir-le-rejeu"');
      expect(html, portee).toContain(`href="/sessions/s2?app=a&amp;tab=replay&amp;at=${avec[1].ts.getTime()}"`);
      expect(html, portee).not.toContain("rejeu-absent");
    }
  });
});
