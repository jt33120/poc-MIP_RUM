// La liste des chemins publics. Petite fonction, grosse conséquence : elle
// décide À LA FOIS ce qui est lisible sans compte (middleware) et ce qui se rend
// sans la coquille de la console (layout). Une erreur ici est soit une page
// privée ouverte à l'internet, soit une page publique devenue inatteignable.
import { describe, expect, it } from "vitest";
import { estCheminPublic } from "../../apps/console/lib/chemins-publics";

describe("estCheminPublic", () => {
  it("ouvre la vitrine et la confidentialité de l'extension", () => {
    expect(estCheminPublic("/presentation")).toBe(true);
    // URL exigée par le Chrome Web Store : elle ne peut pas être derrière un login.
    expect(estCheminPublic("/extension-privacy")).toBe(true);
  });

  it("ouvre les documents légaux, index compris", () => {
    for (const p of ["/legal", "/legal/mentions", "/legal/cgu", "/legal/cgv", "/legal/dpa", "/legal/confidentialite"])
      expect(estCheminPublic(p), p).toBe(true);
  });

  // Le middleware testait `p.startsWith("/legal")`. Un écran nommé
  // `/legal-interne` ou `/legalites-admin` aurait donc été servi à l'internet
  // entier sans session — un contournement d'authentification créé par la simple
  // création d'un fichier, sans que personne touche à la règle d'accès.
  it("ne s'ouvre pas à un chemin qui COMMENCE par « legal » sans en être", () => {
    expect(estCheminPublic("/legal-interne")).toBe(false);
    expect(estCheminPublic("/legalites-admin")).toBe(false);
    expect(estCheminPublic("/legalxyz")).toBe(false);
  });

  it("ne s'ouvre pas non plus sur une variante de la vitrine", () => {
    expect(estCheminPublic("/presentations")).toBe(false);
    expect(estCheminPublic("/presentation/secret")).toBe(false);
  });

  it("laisse privés les écrans de console et l'administration", () => {
    for (const p of ["/", "/sessions", "/errors", "/slo", "/api-docs", "/admin/users", "/admin/audit", "/select", "/logout"])
      expect(estCheminPublic(p), p).toBe(false);
  });

  it("laisse privées les routes d'API", () => {
    for (const p of ["/api/v1/overview", "/api/ingest/v1/traces", "/api/cron/tick"])
      expect(estCheminPublic(p), p).toBe(false);
  });

  // Le layout lit le chemin dans un en-tête ; s'il est absent il vaut "". Une
  // chaîne vide ne doit pas passer pour publique, sinon la console entière se
  // rendrait sans sa navigation.
  it("ne considère pas la chaîne vide comme publique", () => {
    expect(estCheminPublic("")).toBe(false);
  });
});
