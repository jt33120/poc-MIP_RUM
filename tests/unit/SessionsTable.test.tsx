// SessionsTable (F42, § 4.3 / § 5.11.4) : rendu SSR réel. Ce que ce test protège —
// aucune identité brute, aucun zéro à la place d'une lecture absente, et les deux
// rendus (table dès `sm`, cartes à 390 px) présents dans le même balisage.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionsTable } from "@/components/sessions/SessionsTable";
import { PictoNavigateur, PictoSysteme, drapeauPays, marqueNavigateur, marqueSysteme } from "@/components/sessions/Pictos";
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

/**
 * Le nom LU d'un en-tête : depuis le 30/09/2026, un en-tête court à l'écran (« Erreurs »,
 * masqué aux lecteurs d'écran) porte son nom complet en `sr-only`.
 */
function nomsDEntetes(html: string): string[] {
  return [...html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => {
    const complet = /<span class="sr-only">([^<]*)<\/span>/.exec(m[1]);
    return texte(complet ? complet[1] : m[1]).trim();
  });
}

describe("SessionsTable — colonnes et valeurs", () => {
  it("porte dix colonnes, erreurs, rejeu et frustration juste après la durée (recette du 26/09/2026)", () => {
    const html = rendu([ligne("s1")]);
    const entetes = nomsDEntetes(html);
    expect(entetes).toEqual([
      "Session",
      "Dernière activité",
      "Durée observée",
      "Occurrences d'erreur",
      "Rejeu",
      "Frustration",
      "Appareil · navigateur · système",
      "Pays estimé",
      "Pages vues",
      "Parcours",
    ]);
    // Plus de colonnes « Capteur » (toujours « SDK ») ni « Début ».
    expect(entetes).not.toContain("Capteur");
    expect(entetes).not.toContain("Début");
    expect(texte(html)).toContain("desktop · Chrome · Linux");
    expect(texte(html)).toContain("pays estimé, provenance : Fuseau horaire du terminal");
  });

  it("n'affiche jamais un identifiant complet : huit caractères et une ellipse", () => {
    const html = rendu([ligne("0123456789abcdef")]);
    expect(texte(html)).toContain("01234567…");
    expect(texte(html)).not.toContain("0123456789abcdef …");
  });

  it("la dernière activité est à l'heure de Paris et la durée observée est mise en forme", () => {
    const t = texte(rendu([ligne("s1")]));
    // Début (16:00) n'a plus de colonne : il se lit de la dernière activité et de la durée.
    expect(t).toContain("21/09 16:10");
    expect(t).toContain("10 min");
  });

  it("le capteur n'est nommé que s'il n'est pas le SDK web : extension (CP16) ou mobile", () => {
    expect(texte(rendu([ligne("s1", { collection_source: "extension" })]))).toContain("Extension");
    expect(texte(rendu([ligne("s1", { runtime: "react_native" })]))).toContain("Mobile");
    expect(rendu([ligne("s1")])).not.toContain('data-testid="capteur-session"');
  });
});

describe("SessionsTable — Frustration et Rejeu", () => {
  it("lecture en échec : « — » avec sa raison, jamais « 0 » ni « Non », et aucun code de lot", () => {
    const html = rendu([ligne("s1")]);
    expect(html).toContain('title="lecture en échec : valeur inconnue"');
    expect(html).not.toContain("B30");
    expect(texte(html)).toContain("Frustration : —");
    expect(texte(html)).toContain("Rejeu : —");
  });

  it("session mobile : frustration « non collecté », pas « — »", () => {
    const html = rendu([ligne("s1", { runtime: "react_native", rejeu: false })]);
    expect(html).toContain('data-testid="signal-non-collecte"');
    expect(texte(html)).toContain("Frustration : non collecté");
  });

  it("signaux lus : les nombres s'affichent, et « Non » distingue l'absence de rejeu", () => {
    const html = rendu([ligne("s1", { frustration: 0, rejeu: false })]);
    expect(html).not.toContain('data-testid="signal-non-lu"');
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
    // Le cadre de TableDefilante n'apparaît qu'à partir de `sm` ; un `sr-only` vit
    // dans sa zone défilante, qui doit donc être positionnée.
    expect(html).toContain('class="relative overflow-hidden hidden sm:block"');
    expect(html).toMatch(/role="region" aria-label="Sessions"[^>]*class="relative overflow-x-auto[ "]/);
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

describe("SessionsTable — ligne dense et pictogrammes (refonte du 30/09/2026)", () => {
  it("une ligne de 32 px ; les en-têtes courts sont masqués aux lecteurs d'écran, le nom complet lu", () => {
    const html = rendu([ligne("s1")]);
    expect(html).toMatch(/<tr class="h-8 [^"]*"[^>]*data-testid="ligne-session"/);
    expect(html).toContain('<span aria-hidden="true">Erreurs</span><span class="sr-only">Occurrences d&#x27;erreur</span>');
    expect(html).toContain('title="Occurrences d&#x27;erreur"');
  });

  it("appareil, navigateur et système en pictogrammes, leurs noms survolés et lus ; le pays en drapeau", () => {
    const html = rendu([ligne("s1", { browser: "Safari", os: "macOS" })]);
    // Logo Safari (Simple Icons) et pomme pour macOS, l'appareil en tracé simple.
    expect(html).toContain('fill="#006CFF"');
    expect(html).toContain('title="desktop · Safari · macOS"');
    expect(texte(html)).toContain("desktop · Safari · macOS");
    expect(html).toContain("🇫🇷");
    expect(html).toContain('title="Pays estimé : FR · Fuseau horaire du terminal"');
  });

  it("valeur inconnue : un « ? » en pointillé, jamais le logo d'une marque au hasard", () => {
    const html = rendu([ligne("s1", { browser: null, user_agent: null, os: null, geo_country: null, device_type: null })]);
    expect(html).toContain('stroke-dasharray="2 2"');
    expect(html).not.toContain('fill="#4285F4"');
    expect(texte(html)).toContain("Inconnu · Inconnu · Inconnu");
  });

  it("erreurs et frustration non nulles en pastilles teintées ; un zéro reste pâle", () => {
    const avec = rendu([ligne("s1", { err_count: 5, frustration: 2 })]);
    expect(avec).toMatch(/bg-bad\/10 text-bad-ink">5</);
    expect(avec).toMatch(/bg-warn\/15 text-warn-ink">2</);
    const sans = rendu([ligne("s1", { err_count: 0, frustration: 0 })]);
    expect(sans).not.toContain("bg-bad/10");
    expect(sans).toContain('<span class="text-ink-faint">0</span>');
  });

  it("session native : ni logo de navigateur ni « ? », le capteur mobile en pastille", () => {
    const html = rendu([ligne("s1", { runtime: "react_native", browser: null, os: "Android", device_type: "mobile" })]);
    expect(texte(html)).toContain("application native");
    expect(html).toContain('fill="#34A853"');
    expect(html).toContain('data-testid="capteur-session"');
  });
});

describe("Pictos — drapeaux et marques", () => {
  it("« FR » devient 🇫🇷 ; un code qui n'est pas ISO alpha-2 ne rend rien", () => {
    expect(drapeauPays("FR")).toBe("🇫🇷");
    expect(drapeauPays("de")).toBe("🇩🇪");
    expect(drapeauPays("FRA")).toBeNull();
    expect(drapeauPays("")).toBeNull();
    expect(drapeauPays(null)).toBeNull();
  });

  it("les familles de navigateurs et de systèmes à logo ; les autres en monogramme", () => {
    expect(marqueNavigateur("Chrome")).toBe("chrome");
    expect(marqueNavigateur("iOS WebView")).toBe("apple");
    expect(marqueNavigateur("Edge")).toBeNull();
    expect(marqueSysteme("macOS")).toBe("apple");
    expect(marqueSysteme("Windows")).toBeNull();
    const edge = renderToStaticMarkup(<PictoNavigateur nom="Edge" />);
    expect(edge).toContain(">e</text>");
    const windows = renderToStaticMarkup(<PictoSysteme nom="Windows" />);
    expect(windows).toContain(">W</text>");
  });
});

describe("SessionsTable — session ouverte en panneau (F43)", () => {
  const panneaux = { s1: "/sessions?panel=session%3As1", s2: "/sessions?panel=session%3As2" };

  it("la session ouverte est marquée (`aria-current`, `data-ouvert`), et elle seule", () => {
    const html = rendu([ligne("s1"), ligne("s2")], { panelHrefs: panneaux, ouvert: "s2" });
    // La rangée de la table et la carte de 390 px : les deux rendus du même balisage.
    expect(html.match(/data-ouvert="1"/g)).toHaveLength(2);
    expect(html.match(/aria-current="true"/g)).toHaveLength(2);
    for (const lien of html.match(/<a [^>]*aria-current="true"[^>]*>/g) ?? []) {
      expect(lien).toContain('href="/sessions?panel=session%3As2"');
    }
  });

  it("aucun panneau ouvert : aucune ligne marquée", () => {
    const html = rendu([ligne("s1"), ligne("s2")], { panelHrefs: panneaux });
    expect(html).not.toContain("data-ouvert");
    expect(html).not.toContain('aria-current="true"');
  });
});
