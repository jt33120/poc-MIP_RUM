// Le schéma de /presentation/installation (SchemaInstallation.tsx) n'affirme rien
// que les recettes ne disent : un langage sans cadenas a sa recette dédiée, éprouvée
// en production (lib/recettes-agents-otel.ts) ; un langage sous cadenas est de ceux
// que les recettes renvoient à la seule documentation. Côté navigateur, l'extension
// est dite pour Chrome et Edge (Manifest V3), Firefox hors périmètre.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OngletsInstallation } from "@/components/presentation/installation/OngletsInstallation";
import { LANGAGES, NAVIGATEURS_EXTENSION, SchemaInstallation } from "@/components/presentation/installation/SchemaInstallation";
import { recettesAgentsOtel } from "@/lib/recettes-agents-otel";

const recettes = recettesAgentsOtel({ appId: "exemple", adresses: { traces: "https://x/v1/traces", logs: "https://x/v1/logs" } });

describe("le schéma d'installation", () => {
  it("les langages ouverts sont exactement ceux des recettes éprouvées", () => {
    const ouverts = LANGAGES.filter((l) => l.ouvert).map((l) => l.marque).sort();
    expect(ouverts).toEqual(recettes.agents.map((a) => a.id).sort());
    for (const a of recettes.agents) expect(a.etat, a.id).toMatch(/^éprouvé en production/);
  });

  it("les langages sous cadenas sont ceux renvoyés à la documentation", () => {
    const fermes = LANGAGES.filter((l) => !l.ouvert).map((l) => l.nom).sort();
    expect(fermes).toEqual(recettes.autres.map((a) => a.langage).sort());
  });

  it("l'extension : Chrome et Edge, Firefox hors périmètre, comme le cadrage", () => {
    const cadrage = readFileSync(join(__dirname, "../../docs/CADRAGE_EXTENSION.md"), "utf8");
    expect(cadrage).toMatch(/Chrome\/Edge \*\*Manifest V3 uniquement\*\*/);
    expect(cadrage).toMatch(/Firefox = hors périmètre/);
    expect(NAVIGATEURS_EXTENSION.filter((n) => n.ouvert).map((n) => n.nom)).toEqual(["Chrome", "Edge"]);
    expect(NAVIGATEURS_EXTENSION.filter((n) => !n.ouvert).map((n) => n.nom)).toEqual(["Firefox"]);
  });

  it("fermé au rendu, sans lien (il décrit, les onglets naviguent), et un cadenas se dit aux lecteurs d'écran", () => {
    const html = renderToStaticMarkup(<SchemaInstallation />);
    expect(html.match(/data-ouvert="false"[^>]*data-testid|data-testid="schema-(navigateur|serveur)"[^>]*data-ouvert="false"/g)?.length).toBe(2);
    expect(html).not.toContain("<a ");
    expect(html.split("(pas encore disponible)").length - 1).toBe(
      LANGAGES.filter((l) => !l.ouvert).length + NAVIGATEURS_EXTENSION.filter((n) => !n.ouvert).length,
    );
  });

  it("les sous-onglets : la vue d'ensemble puis les trois parcours, l'onglet courant marqué", () => {
    const html = renderToStaticMarkup(<OngletsInstallation courant="serveur" />);
    const liens = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(liens).toEqual([
      "/presentation/installation",
      "/presentation/installation/sdk-javascript",
      "/presentation/installation/extension",
      "/presentation/installation/serveur",
    ]);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    const courant = /<a [^>]*aria-current="page"[^>]*>/.exec(html)?.[0] ?? "";
    expect(courant).toContain('href="/presentation/installation/serveur"');
  });
});
