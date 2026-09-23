// P**.6 — Specs, remonté dans l'annexe de la vitrine (plan § 8.2, PS11).
//
// Le CONTENU des Specs (lib/specs.ts) est tenu par tests/unit/specs.test.ts. Ici, le
// RENDU du composant dans sa nouvelle place, en SSR réel, lectures du planificateur
// simulées (Specs est le seul bloc de la page qui lit la base) :
//   - un bloc h3 sous le h2 « Le détail », sans conteneur de page à lui ;
//   - trois onglets qui sont trois radios d'un même groupe : le clavier les parcourt
//     aux flèches, sans script ni URL (recette e2e TP6) ;
//   - le groupe backend porte son nouveau nom ;
//   - la conclusion ne parle des tâches planifiées que si la LECTURE dit qu'elles
//     sont à relancer ; une lecture en échec n'affirme rien.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LecturePlanifie } from "@/lib/etat-planifie";

const lectures = vi.hoisted(() => ({
  passage: { etat: "illisible" } as LecturePlanifie,
  tick: { etat: "illisible" } as LecturePlanifie,
}));

vi.mock("@/lib/queries-planifie", () => ({
  dernierPassagePlanifie: async () => lectures.passage,
  dernierTickScheduler: async () => lectures.tick,
}));

import { Specs } from "@/components/presentation/Specs";
import { NON_ETABLI_PLANIFIE } from "@/lib/etat-planifie";
import { INFRA } from "@/lib/specs";

/** Texte lisible : balises retirées, entités décodées, espaces normalisées. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

async function rendre(passage: LecturePlanifie, tick: LecturePlanifie = passage): Promise<string> {
  lectures.passage = passage;
  lectures.tick = tick;
  return renderToStaticMarkup(await Specs());
}

const ILLISIBLE: LecturePlanifie = { etat: "illisible" };

afterEach(() => {
  lectures.passage = ILLISIBLE;
  lectures.tick = ILLISIBLE;
});

describe("PS11 — Specs, un bloc de la partie « Le détail »", () => {
  it("un h3 nommé, sans h2 ni conteneur de page ; les titres internes passent en h4", async () => {
    const html = await rendre(ILLISIBLE);
    expect(html).toMatch(/^<section id="specs" aria-labelledby="specs-titre"/);
    expect(html).toMatch(/<h3 id="specs-titre"[^>]*>Specs \/ Capacité technique<\/h3>/);
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("max-w-6xl");
    // Les groupes de l'infrastructure, « Ce qu'on capte », « Ce qu'on ne mesure pas », « Ce qui manque ».
    expect((html.match(/<h4 /g) ?? []).length).toBe(INFRA.length + 3);
    expect((html.match(/<h3 /g) ?? []).length).toBe(1);
  });

  it("le groupe backend porte son nom de la topologie réelle", async () => {
    const t = texte(await rendre(ILLISIBLE));
    expect(t).toContain("Backend — collecteur sur Vercel, travaux planifiés et MCP sur Railway");
    expect(t).not.toContain("trois services autonomes");
  });

  it("le chapeau ne promet un fichier de preuve qu'aux lignes qui décrivent le dépôt", async () => {
    const t = texte(await rendre(ILLISIBLE));
    expect(t).toContain("les lignes qui décrivent le dépôt portent le fichier qui les prouve");
    expect(t).not.toContain("chaque ligne porte le fichier");
  });

  it("trois onglets = trois radios d'un même groupe, la première cochée, chacune étiquetée, chaque panneau repérable", async () => {
    const html = await rendre(ILLISIBLE);
    // Attributs lus un à un : React range `name` et `checked` après `class`.
    const radios = [...html.matchAll(/<input [^>]*>/g)].map(([balise]) => [
      /\bid="([^"]+)"/.exec(balise)?.[1],
      /\btype="([^"]+)"/.exec(balise)?.[1],
      /\bname="([^"]+)"/.exec(balise)?.[1],
      /\bchecked=""/.test(balise),
    ]);
    expect(radios).toEqual([
      ["specs-infra", "radio", "specs-onglet", true],
      ["specs-mesures", "radio", "specs-onglet", false],
      ["specs-ecart", "radio", "specs-onglet", false],
    ]);
    for (const id of ["specs-infra", "specs-mesures", "specs-ecart"]) expect(html).toContain(`<label for="${id}"`);
    const panneaux = [...html.matchAll(/data-testid="specs-panneau" data-onglet="([a-z]+)"/g)].map((m) => m[1]);
    expect(panneaux).toEqual(["infra", "mesures", "ecart"]);
    // Ni lien ni formulaire : l'onglet choisi ne passe jamais par l'URL.
    expect(html).not.toMatch(/<a |<form/);
  });

  it("petits textes en ink-soft, pas ink-faint (§ 8.2)", async () => {
    expect(await rendre(ILLISIBLE)).not.toContain("text-ink-faint");
  });
});

describe("PS11 — la conclusion suit la lecture du planificateur", () => {
  it("lecture en échec : « Non établi », et rien à relancer — une inconnue n'est pas un manque", async () => {
    const t = texte(await rendre(ILLISIBLE));
    expect(t).toContain(NON_ETABLI_PLANIFIE);
    expect(t).not.toContain("Tâches planifiées à relancer");
    expect(t).not.toContain("relancer les tâches planifiées");
    expect(t).not.toContain("brancher le déclencheur");
    expect(t).toContain("il faut au moins fermer l'ingestion par défaut");
  });

  it("lu, jamais exécuté : la liste et la conclusion disent toutes deux qu'il faut les relancer", async () => {
    const t = texte(await rendre({ etat: "lu", date: null }));
    expect(t).toContain("Tâches planifiées à relancer");
    expect(t).toContain("il faut au moins relancer les tâches planifiées, fermer l'ingestion par défaut");
  });

  it("revue de fin de vague 7 : l'écart au marché ne dit rien que le document de couverture refuse", async () => {
    const t = texte(await rendre(ILLISIBLE));
    // Le pays est estimé (RUM_PARITY_STATUS.md:319-320), et le visiteur est un
    // pseudonyme, « pas une donnée anonyme » (:266).
    expect(t).toContain("Pays estimé, scrub PII côté client et serveur");
    expect(t).not.toMatch(/géolocalisation|anonym/i);
    // Tous les manques ne sont pas d'exploitation (C3, § 10) : la conclusion renvoie à
    // la partie qui les reprend, au lieu de les ranger sous un seul mot.
    expect(t).not.toContain("relève de l'exploitation");
    expect(t).toContain("Ce n'est pas tout : « Ce qui reste » reprend, point par point, ce qui manque encore");
  });

  it("lu, passage récent : ni la liste ni la conclusion n'en parlent", async () => {
    const t = texte(await rendre({ etat: "lu", date: new Date() }));
    expect(t).toContain("Purge par client active");
    expect(t).not.toContain("Tâches planifiées à relancer");
    expect(t).not.toContain("relancer les tâches planifiées");
    expect(t).not.toContain("brancher le déclencheur");
    expect(t).toContain("il faut au moins fermer l'ingestion par défaut");
  });
});
