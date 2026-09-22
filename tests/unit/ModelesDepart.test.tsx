// ModelesDepart (F31, W-E1, § 4.3) : des liens, rien d'autre. Rendu SSR réel.
//
// Une carte ouvrable est un lien entier (un seul arrêt de tabulation) ; une carte
// inapplicable n'a PAS de lien et écrit sa raison — visible, pas dans un `title`.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelesDepart } from "@/components/explorer/ModelesDepart";
import { modelesDeDepart, type ModeleDepart } from "@/lib/explorer-modeles";
import { parseAnalyticsQuery } from "@/lib/query-contract";
import { schemaComplet } from "../fixtures/dimension-schema";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

function requete(qs: string) {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), {
    principal: { role: "admin", apps: null },
    nowMs: Date.parse("2026-09-17T12:00:00.000Z"),
  });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

describe("ModelesDepart", () => {
  it("les six analyses de départ : six liens exécutés, titre et question écrits", () => {
    const modeles = modelesDeDepart(requete("app=demo"), schemaComplet());
    const html = renderToStaticMarkup(<ModelesDepart modeles={modeles} />);
    const liens = html.match(/<a [^>]*href="[^"]*"/g) ?? [];
    expect(liens).toHaveLength(6);
    for (const lien of liens) expect(lien).toContain("run=1");
    const t = texte(html);
    for (const m of modeles) {
      expect(t).toContain(m.titre);
      expect(t).toContain(m.question);
    }
  });

  it("une carte inapplicable : pas de lien, raison écrite", () => {
    const modeles: ModeleDepart[] = [
      { cle: "a", titre: "Ouvrable", question: "Q1 ?", href: "/explorer?run=1" },
      { cle: "b", titre: "Bloquée", question: "Q2 ?", href: null, raison: "« Navigateur » n'est pas encore collecté" },
    ];
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(<ModelesDepart modeles={modeles} compact={compact} />);
      expect((html.match(/<a /g) ?? []).length, `compact=${compact}`).toBe(1);
      expect(html).toContain('aria-disabled="true"');
      expect(texte(html)).toContain("Indisponible : « Navigateur » n'est pas encore collecté");
    }
  });
});
