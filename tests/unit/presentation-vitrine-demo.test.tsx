// La vitrine refondue pour la démo (30/09/2026) : un film, deux entrées, un aperçu
// défilant (components/presentation/Landing.tsx). L'ancienne vitrine est archivée et
// garde ses tests (presentation-vitrine.test.tsx, sur LandingArchive).
//
// Ce que ces tests tiennent, en rendu SSR réel (`renderToStaticMarkup`) :
//   - les entrées : le compte démo passe par la connexion pré-remplie, la connexion et
//     l'inscription sont à droite ; connecté, une seule entrée ; démo fermée, verrouillée ;
//   - le film : monté, présent, léger, avec son affiche ;
//   - l'aperçu : une légende par étape, une scène animée qui commence sur la santé ;
//   - le pied de page commun (attribution GeoIP, conditions d'utilisation) ;
//   - les images servies sans session (matcher du middleware).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landing } from "@/components/presentation/Landing";
import type { SessionUser } from "@/lib/auth";
import { ETAPES_APERCU, FILM_ACCUEIL } from "@/lib/vitrine";

const RACINE = join(__dirname, "../..");
const ADMIN: SessionUser = { email: "a@mip.test", role: "admin", apps: null };
const VISITEUR = renderToStaticMarkup(<Landing user={null} demoOuverte />);

const compte = (html: string, motif: string) => html.split(motif).length - 1;
/** La balise ouvrante qui porte ce repère de test (l'ordre des attributs n'y fait rien). */
const balise = (html: string, testid: string) =>
  new RegExp(`<(a|span)\\b[^>]*data-testid="${testid}"[^>]*>`).exec(html)?.[0] ?? "";

describe("les deux entrées", () => {
  it("visiteur : le compte démo mène à la connexion pré-remplie ; la connexion et l'inscription à côté", () => {
    expect(balise(VISITEUR, "vitrine-demo")).toMatch(/^<a [^>]*href="\/login\?demo=1"/);
    expect(balise(VISITEUR, "vitrine-connexion")).toMatch(/^<a [^>]*href="\/login"/);
    expect(balise(VISITEUR, "vitrine-inscription")).toMatch(/^<a [^>]*href="\/inscription"/);
    // Jamais /demo en direct : le visiteur passe par l'écran de connexion pré-rempli.
    expect(VISITEUR).not.toContain('href="/demo"');
    expect(VISITEUR).not.toContain("vitrine-console");
  });

  it("connecté : une seule entrée, la console, par une navigation document", () => {
    const html = renderToStaticMarkup(<Landing user={ADMIN} demoOuverte />);
    expect(compte(html, 'data-testid="vitrine-console"')).toBe(1);
    expect(balise(html, "vitrine-console")).toMatch(/^<a [^>]*href="\/"/);
    expect(html).not.toContain("vitrine-demo");
    expect(html).not.toContain("vitrine-connexion");
  });

  it("démo fermée : l'entrée reste, verrouillée, sans lien", () => {
    const html = renderToStaticMarkup(<Landing user={null} demoOuverte={false} />);
    expect(balise(html, "vitrine-demo")).toMatch(/^<span [^>]*aria-disabled="true"/);
    expect(html).not.toContain("/login?demo=1");
  });
});

describe("le film d'accueil", () => {
  it("un seul h1, qui dit le produit, que le film soit monté ou non", () => {
    expect(compte(VISITEUR, "<h1 ")).toBe(1);
    expect(VISITEUR).toContain('id="vitrine-titre"');
    if (!FILM_ACCUEIL) expect(VISITEUR).not.toContain("<video");
    // Le premier écran animé est toujours là : le film ne le recouvre qu’une fois lancé.
    expect(VISITEUR).toContain("Voir ce que vivent");
  });

  it("le film monté est un fichier du dépôt, léger, avec son affiche ; muet, sans lecture automatique en HTML", () => {
    if (!FILM_ACCUEIL) return;
    for (const f of [FILM_ACCUEIL.mp4, FILM_ACCUEIL.affiche]) {
      expect(existsSync(join(RACINE, "apps/console/public", f)), f).toBe(true);
    }
    expect(statSync(join(RACINE, "apps/console/public", FILM_ACCUEIL.mp4)).size).toBeLessThanOrEqual(8_000_000);
    const video = /<video [^>]*>/.exec(VISITEUR)?.[0] ?? "";
    expect(video).toContain("muted");
    expect(video).toContain(`poster="${FILM_ACCUEIL.affiche}"`);
    // La lecture part du script, et jamais pour qui a demandé moins de mouvement.
    expect(video).not.toContain("autoplay");
  });
});

describe("l'aperçu défilant", () => {
  it("une légende par étape ; la scène animée commence sur la santé, et se tait pour les lecteurs d'écran", () => {
    expect(compte(VISITEUR, 'data-testid="apercu-legende"')).toBe(ETAPES_APERCU.length);
    expect(VISITEUR).toMatch(/<div class="scene" data-vue="sante" aria-hidden="true"/);
    // Plus de captures : la scène est dessinée.
    expect(VISITEUR).not.toMatch(/<img [^>]*src="\/vitrine\//);
  });

  it("chaque étape est un écran de la scène, une seule fois ; la légende dit qu'il s'agit d'une illustration", () => {
    const vues = ETAPES_APERCU.map((e) => e.nom);
    expect(new Set(vues).size).toBe(vues.length);
    expect(vues).toEqual(["sante", "pages", "erreurs", "session", "tracing", "assistant"]);
    expect(VISITEUR).toContain("Illustration animée d&#x27;une boutique fictive");
  });
});

describe("le cadre commun", () => {
  it("toujours sombre ; le pied de page garde l'attribution GeoIP et les conditions d'utilisation", () => {
    expect(VISITEUR).toMatch(/<div class="dark vitrine /);
    expect(VISITEUR).toMatch(/<a [^>]*href="\/legal\/cgu"/);
    expect(VISITEUR).not.toContain("/legal/cgv");
  });

  it("le middleware sert les captures sans session (sinon : une redirection vers /login à la place de l'image)", () => {
    const middleware = readFileSync(join(RACINE, "apps/console/middleware.ts"), "utf8");
    const matcher = /matcher: \["([^"]+)"\]/.exec(middleware)?.[1] ?? "";
    const garde = new RegExp(`^${matcher}$`);
    expect(garde.test("/vitrine/sante.webp")).toBe(false);
    expect(garde.test("/presentation")).toBe(true);
    expect(garde.test("/vitrines")).toBe(true);
  });
});
