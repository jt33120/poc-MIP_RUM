// PrioriteSessions (F42, § 4.3 / § 5.11.4) : rendu SSR réel — on vérifie ce que
// l'utilisateur lira, pas la structure des props.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrioriteSessions, alternativePriorite } from "@/components/sessions/PrioriteSessions";
import type { SessionRow } from "@/lib/queries";
import { hrefsPriorite, type SessionPrioritaire } from "@/lib/sessions-priorite";

const T0 = Date.UTC(2026, 8, 21, 14, 0, 0);
const PLAGE = "24 dernières heures";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&laquo;|&#xAB;/g, "«")
    .replace(/&raquo;|&#xBB;/g, "»")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");

function ligne(id: string, o: Partial<SessionPrioritaire> = {}): SessionPrioritaire {
  const row: SessionRow = {
    session_id: id,
    app_id: "a",
    device_type: "mobile",
    geo_country: "FR",
    geo_source: "ip",
    user_agent: null,
    started_at: new Date(T0),
    last_seen_at: new Date(T0 + 300_000),
    page_count: 2,
    routes: ["/", "/panier"],
    err_count: 3,
    collection_source: "sdk",
    cursor_ts: new Date(T0).toISOString(),
    browser: "Chrome",
    os: "Android",
  };
  return {
    ...row,
    frustration: 2,
    api_echecs: 1,
    premiere_erreur_ts: new Date(T0 + 5_000).toISOString(),
    rejeu: true,
    raison: {
      erreurs: [{ type: "TypeError", occurrences: 3 }],
      frustration: [{ kind: "rage", cible: "Payer", n: 2 }],
      api: [{ methode: "POST", chemin: "/api/panier", statut: 500 }],
    },
    ...o,
  };
}

const rendu = (lignes: SessionPrioritaire[]) =>
  renderToStaticMarkup(
    <PrioriteSessions
      lignes={lignes}
      hrefs={hrefsPriorite(lignes, Object.fromEntries(lignes.map((s) => [s.session_id, `/sessions/${s.session_id}?app=a`])))}
      plage={PLAGE}
    />,
  );

describe("PrioriteSessions — chaque ligne porte sa raison", () => {
  it("écrit la raison en toutes lettres, pas un score", () => {
    const t = texte(rendu([ligne("s1")]));
    expect(t).toContain("3 occurrences de TypeError");
    expect(t).toContain("2 clics de rage sur « Payer »");
    expect(t).toContain("1 appel POST /api/panier en 500");
  });

  it("le début est daté en UTC et la durée observée est affichée", () => {
    const t = texte(rendu([ligne("s1")]));
    expect(t).toContain("21/09 14:00 UTC");
    expect(t).toContain("5 min");
  });

  it("le parcours va de la première à la dernière route", () => {
    const t = texte(rendu([ligne("s1", { routes: ["/", "/a", "/b", "/panier"] })]));
    expect(t).toContain("/");
    expect(t).toContain("+2");
    expect(t).toContain("/panier");
  });
});

describe("PrioriteSessions — les trois états du rejeu", () => {
  it("rejeu lu et présent : ▶ vers ?tab=replay&at=<ms de la première erreur>", () => {
    const html = rendu([ligne("s1")]);
    expect(html).toContain(`href="/sessions/s1?app=a&amp;tab=replay&amp;at=${T0 + 5_000}"`);
    expect(texte(html)).toContain("▶ Rejeu");
  });

  it("rejeu lu et absent : aucun bouton, pas même désactivé", () => {
    const html = rendu([ligne("s1", { rejeu: false })]);
    expect(html).not.toContain("tab=replay");
    expect(html).not.toContain("▶");
  });

  it("existence non lue : « ▶ — » et sa raison, jamais « pas de rejeu »", () => {
    const html = rendu([ligne("s1", { rejeu: null })]);
    expect(html).toContain('title="existence du rejeu non lue"');
    expect(texte(html)).toContain("▶ —");
    expect(html).not.toContain("tab=replay");
  });
});

describe("PrioriteSessions — aucune session à signal", () => {
  it("dit l'absence sur la plage et mène à la liste, sans dessiner de lignes", () => {
    const t = texte(rendu([]));
    expect(t).toContain("Aucune session avec erreur, frustration ou appel en échec sur 24 dernières heures");
    expect(t).toContain("Voir toutes les sessions");
    expect(rendu([])).toContain('href="#toutes-les-sessions"');
  });
});

describe("PrioriteSessions — alternative textuelle", () => {
  it("porte les mêmes lignes que la liste, et nomme l'ordre", () => {
    const alt = alternativePriorite([ligne("s1")], PLAGE);
    expect(alt.legende).toContain("occurrences d'erreur, signaux de frustration, appels API en échec");
    expect(alt.lignes).toHaveLength(1);
    expect(alt.lignes[0]).toContain(3);
    expect(String(alt.lignes[0][6])).toContain("3 occurrences de TypeError");
  });
});
