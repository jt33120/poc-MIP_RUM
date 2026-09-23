// SessionsTable (F42, § 4.3 / § 5.11.4) : rendu SSR réel. Ce que ce test protège —
// aucune identité brute, aucun zéro à la place d'une lecture absente, et les deux
// rendus (table dès `sm`, cartes à 390 px) présents dans le même balisage.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionsTable } from "@/components/sessions/SessionsTable";
import type { SessionRow } from "@/lib/queries";
import type { LigneSessions } from "@/lib/sessions-priorite";

const T0 = Date.UTC(2026, 8, 21, 14, 0, 0);

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");

function ligne(id: string, o: Partial<LigneSessions> = {}): LigneSessions {
  const row: SessionRow = {
    session_id: id,
    app_id: "a",
    device_type: "desktop",
    geo_country: "FR",
    geo_source: "timezone",
    user_agent: "Mozilla/5.0 (X11) Firefox/130.0",
    started_at: new Date(T0),
    last_seen_at: new Date(T0 + 600_000),
    page_count: 4,
    routes: ["/", "/produit/[id]", "/panier"],
    err_count: 5,
    collection_source: "sdk",
    cursor_ts: new Date(T0).toISOString(),
    browser: "Chrome",
    os: "Linux",
  };
  return { ...row, frustration: null, rejeu: null, ...o };
}

const rendu = (lignes: LigneSessions[], extra: Partial<Parameters<typeof SessionsTable>[0]> = {}) =>
  renderToStaticMarkup(
    <SessionsTable
      lignes={lignes}
      panelHrefs={{}}
      pageHrefs={Object.fromEntries(lignes.map((s) => [s.session_id, `/sessions/${s.session_id}?app=a`]))}
      suivantHref={null}
      vide="Aucune session sur 24 h"
      {...extra}
    />,
  );

describe("SessionsTable — colonnes et valeurs", () => {
  it("porte les treize colonnes du plan, dont « Pays estimé » et sa provenance", () => {
    const html = rendu([ligne("s1")]);
    for (const c of [
      "Dernière activité (UTC)",
      "Début (UTC)",
      "Durée observée",
      "Appareil",
      "Navigateur",
      "Système",
      "Pays estimé",
      "Capteur",
      "Pages vues",
      "Parcours",
      "Occurrences d'erreur",
      "Frustration",
      "Rejeu",
    ]) {
      expect(texte(html)).toContain(c);
    }
    expect(texte(html)).toContain("pays estimé, provenance : Fuseau horaire du terminal");
  });

  it("n'affiche jamais un identifiant complet : huit caractères et une ellipse", () => {
    const html = rendu([ligne("0123456789abcdef")]);
    expect(texte(html)).toContain("01234567…");
    expect(texte(html)).not.toContain("0123456789abcdef …");
  });

  it("les instants sont en UTC et la durée observée est mise en forme", () => {
    const t = texte(rendu([ligne("s1")]));
    expect(t).toContain("21/09 14:00");
    expect(t).toContain("10 min");
  });

  it("le capteur de l'extension est nommé (CP16)", () => {
    expect(texte(rendu([ligne("s1", { collection_source: "extension" })]))).toContain("Extension");
    expect(texte(rendu([ligne("s1")]))).toContain("SDK");
  });
});

describe("SessionsTable — Frustration et Rejeu avant B30", () => {
  it("« — » avec sa raison, jamais « 0 » ni « Non »", () => {
    const html = rendu([ligne("s1")]);
    expect(html).toContain('title="lecture à créer (B30)"');
    expect(texte(html)).toContain("Frustration : —");
    expect(texte(html)).toContain("Rejeu : —");
  });

  it("signaux lus : les nombres s'affichent, et « Non » distingue l'absence de rejeu", () => {
    const html = rendu([ligne("s1", { frustration: 0, rejeu: false })]);
    expect(html).not.toContain('title="lecture à créer (B30)"');
    expect(texte(html)).toContain("Frustration : 0");
    expect(texte(html)).toContain("Rejeu : Non");
  });

  it("rejeu présent : ▶ vers le lien fourni", () => {
    const html = rendu([ligne("s1", { frustration: 3, rejeu: true })], {
      rejeuHrefs: { s1: "/sessions/s1?app=a&tab=replay" },
    });
    expect(html).toContain('href="/sessions/s1?app=a&amp;tab=replay"');
  });
});

describe("SessionsTable — mises en page, liens et vide", () => {
  it("table dès `sm` et cartes compactes à 390 px, dans le même balisage", () => {
    const html = rendu([ligne("s1")]);
    expect(html).toContain('data-testid="sessions-table"');
    expect(html).toContain('data-testid="sessions-cartes"');
    // Un `sr-only` vit dans le conteneur défilant : il doit avoir un ancêtre positionné.
    expect(html).toContain('class="relative hidden overflow-x-auto sm:block"');
  });

  it("sans href de panneau (F43 absent), la ligne mène à la page de session", () => {
    expect(rendu([ligne("s1")])).toContain('href="/sessions/s1?app=a"');
  });

  it("avec href de panneau, la ligne l'emporte", () => {
    const html = rendu([ligne("s1")], { panelHrefs: { s1: "/sessions?panel=session%3As1" } });
    expect(html).toContain('href="/sessions?panel=session%3As1"');
  });

  it("le navigateur déduit est marqué et la note l'explique", () => {
    const html = rendu([ligne("s1", { browser: null })]);
    expect(texte(html)).toContain("Firefox *");
    expect(texte(html)).toContain("navigateur déduit de l'user-agent");
  });

  it("aucune ligne : la phrase fournie, pas une table vide", () => {
    const html = rendu([]);
    expect(texte(html)).toContain("Aucune session sur 24 h");
    expect(html).not.toContain('data-testid="sessions-table"');
  });

  it("« Sessions suivantes » n'apparaît que s'il reste une page", () => {
    expect(rendu([ligne("s1")])).not.toContain("Sessions suivantes");
    expect(rendu([ligne("s1")], { suivantHref: "/sessions?cursor=x" })).toContain("Sessions suivantes");
  });
});
