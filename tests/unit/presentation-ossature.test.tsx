// P**.2 — Ossature de la vitrine : une page, trois parties (plan § 8.2, § 8.4).
//
// Ce que ces tests tiennent, en rendu SSR réel (`renderToStaticMarkup`) :
//   - le sommaire mène aux TITRES des parties, qui acceptent le focus : suivre un
//     lien y place le clavier (PS1) ;
//   - la ligne de relevé ne dit que ce que calcule lib/couverture.ts, et prévient
//     quand le relevé a vieilli (PS0) ;
//   - un visiteur voit la démo (verrouillée sans DEMO_USER_APPS) et la connexion,
//     un connecté voit « Ouvrir la console », et rien d'autre (PS0).
// L'ordre des parties sur la page elle-même est la recette e2e TP1
// (tests/e2e/presentation.spec.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ancres } from "@/components/presentation/Ancres";
import { Actions } from "@/components/presentation/Landing";
import { Partie } from "@/components/presentation/Partie";
import { RELEVE_PERIME_JOURS, Releve, relevePerime } from "@/components/presentation/Releve";
import type { SessionUser } from "@/lib/auth";
import { CAPACITES, RELEVE, SHA, compte } from "@/lib/couverture";
import { PARTIES, idTitre } from "@/lib/presentation-parties";

/** Texte lisible : balises retirées, entités et espaces insécables normalisés. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");

/** Minuit UTC du relevé « JJ/MM/AAAA », décalé de `jours` jours. */
function apresReleve(jours: number): Date {
  const [j, m, a] = RELEVE.split("/").map(Number);
  return new Date(Date.UTC(a, m - 1, j) + jours * 86_400_000);
}

describe("PS1 — le sommaire mène aux titres des parties", () => {
  it("quatre parties, dans l'ordre du plan, titres exacts", () => {
    expect(PARTIES.map((p) => p.titre)).toEqual([
      "Ce qu'il contient",
      "Ce qu'il sait faire",
      "Ce qui reste pour un vrai outil de RUM",
      "Le détail, ligne par ligne",
    ]);
    expect(PARTIES.map((p) => p.ancre)).toEqual(["Ce qu'il contient", "Ce qu'il sait faire", "Ce qui reste", "Le détail"]);
    expect(new Set(PARTIES.map((p) => p.id)).size).toBe(PARTIES.length);
  });

  it("chaque lien vise l'identifiant du titre de sa partie, dans l'ordre", () => {
    const html = renderToStaticMarkup(<Ancres />);
    expect(html).toContain('aria-label="Sommaire de la présentation"');
    const liens = [...html.matchAll(/<a href="#([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], texte(m[2])]);
    expect(liens).toEqual(PARTIES.map((p) => [idTitre(p.id), p.ancre]));
  });

  it("la rangée défile dans un conteneur positionné, jamais la page", () => {
    const html = renderToStaticMarkup(<Ancres />);
    expect(html).toMatch(/class="relative [^"]*overflow-x-auto/);
  });

  it("le titre d'une partie porte l'identifiant visé et accepte le focus ; la section s'y rattache", () => {
    for (const p of PARTIES) {
      const html = renderToStaticMarkup(<Partie id={p.id} chapeau="Chapeau." />);
      expect(html).toContain(`<section id="${p.id}" aria-labelledby="${idTitre(p.id)}"`);
      const h2 = new RegExp(`<h2 id="${idTitre(p.id)}" tabindex="-1"[^>]*>([^<]+)</h2>`).exec(html);
      expect(h2, p.id).not.toBeNull();
      expect(texte(h2![1])).toBe(p.titre);
      expect(texte(html)).toContain("Chapeau.");
    }
  });
});

describe("PS0 — la ligne de relevé ne dit que ce que calcule le document de couverture", () => {
  it("date, commit, total, déployées et « aucune éprouvée », sans chiffre écrit à la main", () => {
    const lu = texte(renderToStaticMarkup(<Releve maintenant={apresReleve(1)} />));
    expect(lu).toContain(
      `État relevé le ${RELEVE} sur ${SHA} : ${CAPACITES.length} capacités recensées, ` +
        `${compte("deploye_non_eprouve")} déployées, aucune éprouvée sur des données réellement ingérées.`,
    );
    expect(lu).not.toContain("plus de");
  });

  it(`au-delà de ${RELEVE_PERIME_JOURS} jours, la ligne prévient que l'état a pu changer`, () => {
    const html = renderToStaticMarkup(<Releve maintenant={apresReleve(RELEVE_PERIME_JOURS + 1)} />);
    expect(texte(html)).toContain(`Ce relevé a plus de ${RELEVE_PERIME_JOURS} jours ; l'état réel peut avoir changé.`);
    expect(html).toContain('data-testid="presentation-releve-perime"');
  });

  it("la borne : 30 jours pile ne suffisent pas, une milliseconde de plus si", () => {
    const pile = apresReleve(RELEVE_PERIME_JOURS);
    expect(relevePerime(RELEVE, pile)).toBe(false);
    expect(relevePerime(RELEVE, new Date(pile.getTime() + 1))).toBe(true);
    expect(relevePerime(RELEVE, apresReleve(0))).toBe(false);
  });

  it("une date illisible compte comme périmée : un âge inconnu ne se présente pas comme frais", () => {
    for (const illisible of ["", "2026-09-23", "23/09/26", "demain"]) {
      expect(relevePerime(illisible, apresReleve(0)), illisible).toBe(true);
    }
  });
});

describe("PS0 — les actions selon la session", () => {
  const ADMIN: SessionUser = { email: "a@mip.test", role: "admin", apps: null };
  afterEach(() => vi.unstubAllEnvs());

  it("visiteur, sans DEMO_USER_APPS : la démo est verrouillée, pas un lien mort ; la connexion reste", () => {
    vi.stubEnv("DEMO_USER_APPS", "");
    const html = renderToStaticMarkup(<Actions user={null} />);
    expect(html).toMatch(/<span aria-disabled="true" title="Démo bientôt disponible" data-testid="presentation-demo"/);
    expect(html).not.toContain('href="/demo"');
    expect(html).toMatch(/<a [^>]*href="\/login"[^>]*data-testid="presentation-login"|<a [^>]*data-testid="presentation-login"[^>]*href="\/login"/);
    expect(html).not.toContain("presentation-console");
  });

  it("visiteur, avec DEMO_USER_APPS : la démo est un lien de navigation document", () => {
    vi.stubEnv("DEMO_USER_APPS", "demo-app");
    const html = renderToStaticMarkup(<Actions user={null} size="sm" />);
    expect(html).toContain('<a href="/demo" data-testid="presentation-demo-top"');
    expect(html).not.toContain("aria-disabled");
  });

  it("connecté : « Ouvrir la console », vers /, et ni démo ni connexion", () => {
    vi.stubEnv("DEMO_USER_APPS", "demo-app");
    for (const user of [ADMIN, { ...ADMIN, role: "viewer" as const }, { ...ADMIN, demo: true }]) {
      const html = renderToStaticMarkup(<Actions user={user} />);
      expect(html).toContain('<a href="/" data-testid="presentation-console"');
      expect(texte(html)).toContain("Ouvrir la console");
      expect(html).not.toContain("presentation-demo");
      expect(html).not.toContain("presentation-login");
    }
    expect(renderToStaticMarkup(<Actions user={ADMIN} size="sm" />)).toContain('data-testid="presentation-console-top"');
  });
});
