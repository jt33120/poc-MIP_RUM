// P**.3 — La partie 1 de la vitrine, « Ce qu'il contient » (plan § 8.2, PS2 à PS6),
// en rendu SSR réel (`renderToStaticMarkup`).
//
// Ce que ces tests tiennent :
//   - la hiérarchie : la partie porte le seul `h2`, ses blocs des `h3`, dans l'ordre
//     du plan ; les capteurs ne sont plus un `h2` ;
//   - les textes exacts du plan, et ceux qu'il a fallu réécrire parce que le relevé
//     du 23/09/2026 les avait rendus faux, avec des valeurs CALCULÉES ;
//   - la topologie : `role="img"`, libellé, alternative textuelle (TP7, côté SSR) ;
//   - l'hébergement : une ligne par hébergeur de lib/legal.ts, et la phrase du plan ;
//   - les écrans : la liste de la navigation, du texte pour un visiteur, des liens
//     pour un connecté, rien des catégories fermées ;
//   - le carrousel : connecté seulement, bouton d'administration pour un admin seulement.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CATEGORIES, sousOnglets } from "@/components/nav-items";
import { Capteurs } from "@/components/presentation/Capteurs";
import { Contient } from "@/components/presentation/Contient";
import { EcransConsole, categoriesMontrees } from "@/components/presentation/EcransConsole";
import { Topologie } from "@/components/presentation/Topologie";
import type { SessionUser } from "@/lib/auth";
import { RELEVE, TESTS_SQL, TESTS_SQL_VERTS, TESTS_UNITAIRES } from "@/lib/couverture";
import { FAMILLES_API_V1, OUTILS_MCP, RESERVES_CHAINE } from "@/lib/presentation-contient";
import { ARIA_TOPOLOGIE, HEBERGEMENT, PIECES } from "@/lib/presentation-topologie";
import { REPLAY_GZIP_KO, SDK_POIDS_TEXTE, koTexte } from "@/lib/sdk-poids";
import { EXT_VERSION } from "@/lib/specs";
import { RN_VERSION } from "@/lib/versions";

/**
 * Texte lisible : balises retirées (sans espace, comme presentation-ossature : un
 * `<code>` au milieu d'une phrase ne la coupe pas), entités et espaces insécables
 * normalisés. Deux blocs voisins se collent : on lit donc une cellule par cellule.
 */
const lisible = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

/** Les cellules d'une rangée de tableau, une par une. */
const cellules = (rangee: string) => [...rangee.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gs)].map((m) => lisible(m[1]).trim());

/** Un nombre tel que la page l'écrit, espaces fines normalisées. */
const nombre = (n: number) => n.toLocaleString("fr-FR").replace(/[\u00a0\u202f]/g, " ");

const ADMIN: SessionUser = { email: "a@mip.test", role: "admin", apps: null };
const VIEWER: SessionUser = { ...ADMIN, role: "viewer" };

const visiteur = renderToStaticMarkup(<Contient user={null} />);
const connecte = renderToStaticMarkup(<Contient user={ADMIN} />);

/** Les titres `hN` d'un rendu, dans l'ordre : [niveau, texte]. */
function titres(html: string): [number, string][] {
  return [...html.matchAll(/<h([2-5])[^>]*>(.*?)<\/h\1>/g)].map((m) => [Number(m[1]), lisible(m[2]).trim()]);
}

describe("la partie : un h2, ses blocs en h3, dans l'ordre du plan", () => {
  it("visiteur : capteurs, chemin, hébergement, écrans, état de la chaîne", () => {
    const t = titres(visiteur);
    expect(t.filter(([n]) => n === 2)).toEqual([[2, "Ce qu'il contient"]]);
    expect(t.filter(([n]) => n === 3).map(([, x]) => x)).toEqual([
      "Extension navigateur ou SDK embarqué",
      "Le chemin de la mesure",
      "Où sont les données, et sous quel droit",
      "Les écrans de la console",
      "Autour de la console, et l'état de la chaîne",
    ]);
  });

  it("connecté : « Brancher une application » sous les écrans, avant l'état de la chaîne", () => {
    const h3 = titres(connecte)
      .filter(([n]) => n === 3)
      .map(([, x]) => x);
    expect(h3.slice(3, 6)).toEqual([
      "Les écrans de la console",
      "Brancher une application",
      "Autour de la console, et l'état de la chaîne",
    ]);
  });

  it("chaque bloc est une section nommée par son titre", () => {
    for (const id of ["contient-capteurs", "contient-topologie", "contient-hebergement", "contient-ecrans", "contient-chaine"]) {
      expect(visiteur, id).toContain(`<section id="${id}" aria-labelledby="${id}-titre"`);
      expect(visiteur, id).toMatch(new RegExp(`<h3 id="${id}-titre"`));
    }
  });
});

describe("PS2 — les capteurs", () => {
  const html = renderToStaticMarkup(<Capteurs />);
  const texte = lisible(html);

  it("le titre passe en h3 ; les cartes en h4, leurs rubriques en h5", () => {
    expect(html).not.toContain("<h2");
    expect(titres(html)).toEqual([
      [3, "Extension navigateur ou SDK embarqué"],
      [4, "Extension navigateur"],
      [5, "Spécifications"],
      [5, "À qui ça s'adresse"],
      [4, "SDK embarqué"],
      [5, "Spécifications"],
      [5, "À qui ça s'adresse"],
    ]);
    expect(html).toContain('<section id="contient-capteurs" aria-labelledby="contient-capteurs-titre"');
  });

  it("la limite du SDK, texte exact du plan, version lue dans lib/versions.ts", () => {
    expect(texte).toContain(
      `Demande une mise en production côté client. Web ; React Native en paquet privé (v${RN_VERSION}), jamais exécuté sur un appareil ni un simulateur ; pas de SDK iOS ou Android natif.`,
    );
  });

  it("la version de l'extension, lue dans lib/specs.ts, et sa non-publication", () => {
    const version = /<dt[^>]*>Version<\/dt><dd[^>]*>(.*?)<\/dd>/.exec(html)?.[1] ?? "";
    expect(lisible(version)).toBe(`${EXT_VERSION}, non publiée au Chrome Web Store`);
  });

  it("sous les cartes, les agents côté serveur (texte exact du plan)", () => {
    expect(texte).toContain(
      "Côté serveur : un agent Node (packages/agent-node) et un middleware FastAPI (integrations/fastapi) relient un appel du navigateur à son exécution serveur, sur un seul saut.",
    );
  });

  it("les flèches gardent la classe que coupe le mouvement réduit (TP12)", () => {
    expect(html).toContain("mip-fleche");
  });

  it("aucun texte en ink-faint (§ 3.9), aucun libellé d'écran périmé", () => {
    expect(html).not.toContain("text-ink-faint");
    expect(texte).not.toContain("pages lentes");
  });
});

describe("PS3 — le chemin de la mesure (TP7, côté SSR)", () => {
  const html = renderToStaticMarkup(<Topologie />);
  const texte = lisible(html);

  it("le dessin est une image nommée, sans animation", () => {
    const svg = /<svg [^>]*role="img"[^>]*>/.exec(html)?.[0] ?? "";
    expect(svg).toContain(`aria-label="${ARIA_TOPOLOGIE.replace(/'/g, "&#x27;")}"`);
    expect(html).not.toMatch(/animate|mip-fleche|<animate/);
  });

  it("chaque pièce est dessinée, avec ses lignes", () => {
    const dessin = /<svg [^>]*role="img".*?<\/svg>/s.exec(html)?.[0] ?? "";
    for (const p of PIECES) {
      expect(lisible(dessin)).toContain(p.titre);
      for (const l of p.lignes) expect(lisible(dessin)).toContain(l);
    }
  });

  it("l'alternative textuelle : légende, en-têtes de colonne, une ligne par pièce", () => {
    expect(html).toContain('data-testid="alternative"');
    expect(html).toContain("<caption");
    const entetes = [...html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => lisible(m[1]).trim());
    expect(entetes).toEqual(["Pièce", "Hébergeur", "Région", "Rôle"]);
    const lignes = [...html.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g)].map((m) => lisible(m[1]).trim());
    expect(lignes).toEqual(PIECES.map((p) => p.titre));
    const alternative = lisible(/<details.*?<\/details>/s.exec(html)?.[0] ?? "");
    for (const mot of ["Vercel", "fra1", "Neon", "Railway"]) expect(alternative).toContain(mot);
  });

  it("la légende dit où passe le trafic, et date chaque fait d'exploitation", () => {
    expect(texte).toContain("Le collecteur est une route de la console : c'est l'adresse que visent les SDK.");
    expect(texte).toContain(
      "en production, il ne tourne nulle part : le service Railway ingest, qui l'exécutait sans domaine public, a été supprimé le 21/09/2026.",
    );
    expect(texte).toContain(
      "Le scheduler applique les migrations au pré-déploiement : constaté le 18/09/2026 dans les journaux du déploiement 03850b30.",
    );
    expect(texte).toContain("Topologie relevée par les API Railway et Vercel le 18/09/2026, puis par l'API Railway le 23/09/2026.");
  });
});

describe("PS4 — où sont les données, et sous quel droit", () => {
  const texte = lisible(visiteur);

  it("une ligne par hébergeur, lue dans lib/legal.ts", () => {
    const table = /<table aria-labelledby="contient-hebergement-titre".*?<\/table>/s.exec(visiteur)?.[0] ?? "";
    const [entete, ...lignes] = [...table.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((m) => cellules(m[1]));
    expect(entete).toEqual(["Pièce", "Hébergeur", "Région", "Droit de l'hébergeur"]);
    expect(lignes).toEqual(HEBERGEMENT.map((l) => [l.piece, l.hebergeur, l.lieu, l.droit]));
  });

  it("la phrase sous la table, texte exact du plan", () => {
    expect(texte).toContain(
      "La donnée et le calcul sont en Union européenne ; les trois hébergeurs relèvent d'un droit tiers. Ce POC n'est pas une offre souveraine. Aucune adresse IP n'est stockée, sous aucune forme.",
    );
  });

  it("la table défile dans un conteneur positionné, jamais la page", () => {
    expect(visiteur).toMatch(/<div class="card relative [^"]*overflow-x-auto"><table aria-labelledby="contient-hebergement-titre"/);
  });
});

describe("PS5 — les écrans de la console", () => {
  const liste = (html: string) => /<ul [^>]*data-testid="ecrans-console".*?<\/ul><\/li><\/ul>/s.exec(html)?.[0] ?? "";

  it("la liste de la navigation, sans rien recopier ni les catégories fermées", () => {
    const montrees = categoriesMontrees();
    expect(montrees.map((m) => m.categorie.label)).toEqual(CATEGORIES.filter((c) => !c.verrouille).map((c) => c.label));
    for (const ferme of CATEGORIES.filter((c) => c.verrouille)) {
      expect(lisible(liste(visiteur))).not.toContain(ferme.label);
    }
    // L'onglet interne « Actions » (sousOnglet: false) reste dans « Interactions ».
    const performance = montrees.find((m) => m.categorie.href === "/")!;
    expect(performance.ecrans).toEqual(sousOnglets(performance.categorie));
    expect(performance.ecrans.some((e) => e.href === "/actions")).toBe(false);
  });

  it("visiteur : du texte, aucun lien (ces écrans demandent une session)", () => {
    const html = renderToStaticMarkup(<EcransConsole user={null} />);
    expect(liste(html)).not.toContain("<a ");
    for (const { ecrans } of categoriesMontrees()) {
      for (const e of ecrans) expect(lisible(liste(html))).toContain(e.label);
    }
  });

  it("connecté : chaque écran est un lien vers sa route, en navigation document", () => {
    const html = renderToStaticMarkup(<EcransConsole user={VIEWER} />);
    const liens = [...liste(html).matchAll(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => [m[1], lisible(m[2]).trim()]);
    expect(liens).toEqual(categoriesMontrees().flatMap(({ ecrans }) => ecrans.map((e) => [e.href, e.label])));
  });

  it("chapeau exact ; méthodes d'analyse datées par le relevé, sans compte figé", () => {
    const texte = lisible(visiteur);
    expect(texte).toContain(
      "Les écrans qui existent dans la console. Ils ont été construits et testés sur des jeux de démonstration ; aucun n'a encore été relu sur le trafic d'une vraie application.",
    );
    expect(texte).toContain(`Le relevé du ${RELEVE} ne couvre ni le score de santé, ni les anomalies, ni les tendances.`);
    expect(texte).not.toMatch(/Trois analyses|AIOps|prédictif/);
  });
});

describe("« Brancher une application » : connecté seulement", () => {
  it("absent pour un visiteur", () => {
    expect(visiteur).not.toContain("Tutoriel : ajouter un client");
    expect(lisible(visiteur)).not.toContain("Brancher une application");
  });

  it("admin : le tutoriel et le lien vers l'écran Clients, en navigation document", () => {
    expect(connecte).toContain('aria-label="Tutoriel : ajouter un client"');
    expect(connecte).toMatch(/<a href="\/admin\/customers"/);
  });

  it("viewer (et session démo) : le tutoriel, sans bouton d'administration", () => {
    const html = renderToStaticMarkup(<Contient user={VIEWER} />);
    expect(html).toContain('aria-label="Tutoriel : ajouter un client"');
    expect(html).not.toContain("/admin/customers");
    expect(lisible(html)).toContain("Demandez à un administrateur de créer le client.");
  });
});

describe("PS6 — autour de la console, et l'état de la chaîne", () => {
  const texte = lisible(visiteur);

  it("accès programmatiques : les nombres de E1 et E2", () => {
    expect(texte).toContain(
      `Une API publique en lecture (${FAMILLES_API_V1} familles de routes, description OpenAPI servie sur /api-docs) et un serveur MCP en lecture seule (${OUTILS_MCP} outils). Les jetons d'API ne donnent aucun droit d'écriture.`,
    );
  });

  it("l'état de la chaîne : daté du relevé, décomptes du document, poids mesurés", () => {
    expect(texte).toContain(`L'état de la chaîne, relevé le ${RELEVE}`);
    expect(texte).toContain(
      `Sur un poste de développement : ${nombre(TESTS_UNITAIRES.tests)} tests unitaires verts (${nombre(TESTS_UNITAIRES.fichiers)} fichiers) ; ${nombre(TESTS_SQL.tests)} tests SQL (${nombre(TESTS_SQL.fichiers)} fichiers), dont ${nombre(TESTS_SQL_VERTS)} verts et ${nombre(TESTS_SQL.ignores.tests)} ignorés (les deux bancs de mesure, qui lisent une base préparée à part).`,
    );
    expect(texte).toContain(
      `SDK cœur : ${SDK_POIDS_TEXTE} ; le module de rejeu (${koTexte(REPLAY_GZIP_KO)} ko gzip) n'est chargé que si le rejeu est activé.`,
    );
  });

  it("revue de fin de vague 7 : les tests SQL ignorés ne sont pas comptés verts", () => {
    // Le fait, tel que le document l'écrit (§ 2) : le total, dont 2 fichiers et 13
    // tests ignorés — les deux bancs. Les nombres affichés sont LUS dans l'extraction.
    expect(TESTS_SQL.ignores).toEqual({ fichiers: 2, tests: 13 });
    expect(TESTS_SQL_VERTS).toBe(TESTS_SQL.tests - TESTS_SQL.ignores.tests);
    // « les deux bancs » : deux fichiers ignorés, et pas un de plus.
    expect(TESTS_SQL.ignores.fichiers).toBe(2);
    // Le total n'est plus présenté comme vert.
    expect(texte).not.toContain(`${nombre(TESTS_SQL.tests)} tests SQL (${nombre(TESTS_SQL.fichiers)} fichiers), verts`);
    expect(texte).toContain(`dont ${nombre(TESTS_SQL_VERTS)} verts et ${nombre(TESTS_SQL.ignores.tests)} ignorés`);
  });

  it("ce que ces chiffres ne disent pas : les réserves de F1 à F3, et plus celles du 18/09", () => {
    expect(texte).toContain(
      `Ce que ces chiffres ne disent pas : ${RESERVES_CHAINE.map((r) => r.texte).join(" ; ")}. Tester sur un poste ne dit rien du comportement sur du trafic réel.`,
    );
    // Faux depuis le relevé du 23/09 : la CI type la console et les paquets publiés,
    // et la fenêtre v82→v83 y tourne.
    expect(texte).not.toContain("la CI ne vérifie pas les types,");
    expect(texte).not.toContain("un test SQL échoue");
  });

  it("le banc ClickHouse, daté et situé", () => {
    expect(texte).toContain(
      "Pour les gros volumes, un chemin ClickHouse a été mesuré en local le 11/06/2026 : mêmes p75 à la milliseconde près, stockage 15 fois plus compact à données identiques. Ce banc n'a pas été rejoué depuis la migration vers Neon.",
    );
  });
});
