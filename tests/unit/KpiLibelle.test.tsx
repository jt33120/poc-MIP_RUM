// KpiLibelle (F03, plan § 4.2) : une tuile dont la valeur est un texte. Même
// gabarit que KpiTile, sans delta ni verdict ; l'inconnu se dit « — » avec sa raison.
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { KpiLibelle } from "@/components/charts/KpiLibelle";

type Props = ComponentProps<typeof KpiLibelle>;
const rendu = (props: Props) => renderToStaticMarkup(<KpiLibelle {...props} />);
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("KpiLibelle", () => {
  it("texte : libellé et valeur, dans le gabarit des tuiles", () => {
    const html = rendu({ label: "Page d'entrée n°1", texte: "/partners · 28 sessions sur 28", lecture: "sessions commencées" });
    const t = texte(html);
    expect(t).toContain("Page d'entrée n°1");
    expect(t).toContain("/partners · 28 sessions sur 28");
    expect(t).toContain("sessions commencées");
    expect(html).toContain("card");
  });

  it("texte null → « — » et la raison, jamais une tuile vide", () => {
    const html = rendu({ label: "Service le plus sollicité", texte: null, raisonNull: "aucun appel tracé sur la période" });
    expect(html).toMatch(/data-testid="kpi-libelle-texte"[^>]*>—</);
    expect(texte(html)).toContain("aucun appel tracé sur la période");
  });

  it("texte vide : traité comme inconnu", () => {
    const html = rendu({ label: "Page d'entrée n°1", texte: "  ", raisonNull: "aucune session commencée" });
    expect(html).toMatch(/data-testid="kpi-libelle-texte"[^>]*>—</);
  });

  it("ni delta ni verdict", () => {
    const html = rendu({ label: "Route la plus lente", texte: "/checkout · 412 mesures" });
    expect(html).not.toContain('data-testid="delta"');
    expect(html).not.toContain("kpi-verdict");
    expect(html).not.toMatch(/(good|warn|bad)-ink/);
  });

  it("un texte long se coupe n'importe où plutôt que d'élargir la page", () => {
    const html = rendu({ label: "Route", texte: "/compte/historique-des-commandes-archivees/2026/septembre" });
    expect(html).toContain("[overflow-wrap:anywhere]");
  });

  it("href : la tuile entière est un seul lien, libellé annoncé complet", () => {
    const html = rendu({ label: "Route la plus lente", texte: "/checkout · 412 mesures", href: "/pages?route=%2Fcheckout" });
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('aria-label="Route la plus lente /checkout · 412 mesures"');
  });
});
