// La réponse par règles de l'assistant (`lib/assistant/resume.ts`) : sans modèle, en CI
// comme en démonstration, l'assistant répond — court, chiffré, sourcé.
//
// CE QUE CES TESTS EMPÊCHENT.
//   - Une affirmation chiffrée sans citation, ou une citation d'un fait inexistant.
//   - Un résumé qui ne suit plus l'ordre de priorité (santé, verdicts mauvais, constats
//     et alertes, erreurs, trafic, pages lentes) ou qui dépasse huit phrases.
//   - « La page la plus lente » dite d'une route plus rapide que l'ensemble.
//   - Une question reconnue de travers (les quatre questions suggérées).
import { describe, expect, it } from "vitest";
import { construireDigestVueEnsemble, type Digest } from "../../apps/console/lib/assistant/digest";
import {
  citationsDe,
  filtrerCitations,
  intentionDe,
  QUESTIONS_SUGGEREES,
  repondreParRegles,
  resumerEtat,
  segmenterCitations,
} from "../../apps/console/lib/assistant/resume";
import { entrees } from "./assistant-fixtures";

const digest = construireDigestVueEnsemble(entrees());
const ids = new Set(digest.faits.map((f) => f.id));
const cleDe = (d: Digest, id: string) => d.faits.find((f) => f.id === id)?.cle;
const CITATION = /\[F\d+\]/;

describe("citations", () => {
  it("relève les identifiants cités, dans l'ordre et sans doublon, groupes compris", () => {
    expect(citationsDe("A [F3]. B [F1][F3]. C [F2, F5 ; F1].")).toEqual(["F3", "F1", "F2", "F5"]);
    expect(citationsDe("aucune citation")).toEqual([]);
  });

  it("écarte une citation inconnue, réécrit les groupes, et nettoie l'espace laissé", () => {
    const r = filtrerCitations("Santé 72 [F1]. Pic [F99]. Deux [F1, F42, F2].", new Set(["F1", "F2"]));
    expect(r.texte).toBe("Santé 72 [F1]. Pic. Deux [F1][F2].");
    expect(r.citations).toEqual(["F1", "F2"]);
    expect(r.inconnues).toEqual(["F99", "F42"]);
  });

  it("découpe une ligne en texte et en groupes de pastilles", () => {
    expect(segmenterCitations("LCP 4,8 s [F3][F4], INP [F5].")).toEqual([
      { texte: "LCP 4,8 s " },
      { ids: ["F3", "F4"] },
      { texte: ", INP " },
      { ids: ["F5"] },
      { texte: "." },
    ]);
  });
});

describe("intention d'une question", () => {
  it("reconnaît les quatre questions suggérées", () => {
    expect(QUESTIONS_SUGGEREES.map(intentionDe)).toEqual(["resume", "lenteur", "erreurs", "changements"]);
  });

  it("reconnaît des formulations libres, et le dit quand elle ne reconnaît rien", () => {
    expect(intentionDe("Pourquoi le LCP est-il si haut ?")).toBe("lenteur");
    expect(intentionDe("Des alertes ce matin ?")).toBe("erreurs");
    expect(intentionDe("Qu'a changé la dernière release ?")).toBe("changements");
    expect(intentionDe("Fais-moi un bilan")).toBe("resume");
    expect(intentionDe("Résume les erreurs")).toBe("erreurs");
    expect(intentionDe("Quelle heure est-il à Tokyo ?")).toBe("autre");
  });
});

describe("« Résume l'état de mon application aujourd'hui »", () => {
  const r = resumerEtat(digest);
  const lignes = r.texte.split("\n");

  it("5 à 8 phrases courtes, en mode règles", () => {
    expect(r.mode).toBe("regles");
    expect(r.intention).toBe("resume");
    expect(lignes.length).toBeGreaterThanOrEqual(5);
    expect(lignes.length).toBeLessThanOrEqual(8);
    for (const l of lignes) expect(l.length, l).toBeLessThan(260);
  });

  it("chaque phrase cite au moins un fait, et seulement des faits du condensé", () => {
    for (const l of lignes) expect(l, l).toMatch(CITATION);
    expect(r.citations.length).toBeGreaterThan(0);
    for (const id of r.citations) expect(ids.has(id), id).toBe(true);
    expect(r.citations).toEqual(citationsDe(r.texte));
  });

  it("dans l'ordre de priorité : santé, verdicts mauvais, constats, erreurs, trafic, pages lentes", () => {
    const ordre = ["sante", "tuile:FCP", "constats", "tuile:erreurs", "tuile:sessions", "segment:route:1"];
    const rangs = ordre.map((cle) => lignes.findIndex((l) => citationsDe(l).some((id) => cleDe(digest, id) === cle)));
    for (const [i, rang] of rangs.entries()) expect(rang, ordre[i]).toBeGreaterThanOrEqual(0);
    expect([...rangs].sort((a, b) => a - b)).toEqual(rangs);
  });

  it("chiffré : la santé, les Web Vitals hors du vert (LCP incertain compris), l'alerte, les erreurs, le trafic, la page la plus lente", () => {
    expect(lignes[0]).toMatch(/^Santé 72\s\/\s100, Dégradé \(24 h\) \[F1\]\.$/);
    expect(r.texte).toMatch(/Le plus gros retrait vient de la composante « Web Vitals » : 24,6/);
    expect(r.texte).toMatch(/2 Web Vitals hors du vert : FCP p75 5,5\ss \(Mauvais\) \[F\d+\], LCP p75 4,8\ss \(À améliorer ou Mauvais, incertain\)/);
    expect(r.texte).toMatch(/4\sconstats en cours ; le plus grave : alerte, « LCP au-dessus de 4 s/);
    expect(r.texte).toMatch(/Erreurs : 3,2\s% des pages vues \(\+60\s% vs 24 h précédentes/);
    expect(r.texte).toMatch(/Trafic : 1\s240\ssessions \(\+24\s% vs 24 h précédentes/);
    expect(r.texte).toMatch(/Page la plus lente : « \/checkout », LCP p75 11,5\ss \(\+6\.7 s vs ensemble\)/);
  });

  it("une page plus rapide que l'ensemble n'est jamais « la plus lente »", () => {
    const d = construireDigestVueEnsemble(
      entrees({
        segments: {
          dimension: "route",
          vital: "LCP",
          ensemble: 4800,
          groupes: 2,
          lignes: [
            {
              cle: "v:/login",
              libelle: "/login",
              href: null,
              description: "/login",
              pilote: 1700,
              volume: 31,
              mesures: [{ cle: "lcp", valeur: 1700, affichage: "1,7 s", vital: "LCP", n: 31 }],
              ecart: { valeur: -3100, affichage: "−3,1 s vs ensemble" },
              echantillonFaible: false,
            },
          ],
        },
      }),
    );
    const texte = resumerEtat(d).texte;
    expect(texte).not.toMatch(/Page la plus lente/);
    expect(texte).toMatch(/Aucune page assez mesurée n'est plus lente que l'ensemble ; en tête : « \/login »/);
  });
});

describe("les trois autres questions", () => {
  it("pages lentes : les pages plus lentes que l'ensemble, puis les échantillons faibles à part", () => {
    const r = repondreParRegles(QUESTIONS_SUGGEREES[1], digest);
    const lignes = r.texte.split("\n");
    expect(r.intention).toBe("lenteur");
    expect(lignes[0]).toMatch(/^2 pages assez mesurées sont plus lentes que l'ensemble du site \(LCP p75 4,8\ss\)/);
    expect(r.texte).toMatch(/« \/checkout » : 11,5\ss \(\+6\.7 s vs ensemble, Mauvais\)/);
    expect(r.texte).not.toMatch(/« \/login » :/);
    expect(r.texte).toMatch(/Sur trop peu de mesures pour conclure : « \/installer » 127,1\ss \[F\d+\]/);
    expect(r.texte).toMatch(/Anomalie LCP · \/checkout : 4,8\ss, le 30\/09 à 13:00/);
    expect(r.texte).toMatch(/Heure la plus lente : LCP p75 5,2\ss, le 30\/09 à 13:00/);
    for (const id of r.citations) expect(ids.has(id)).toBe(true);
  });

  it("erreurs et alertes : l'alerte d'abord, puis le taux, l'erreur réapparue, le pic", () => {
    const r = repondreParRegles(QUESTIONS_SUGGEREES[2], digest);
    const lignes = r.texte.split("\n");
    expect(r.intention).toBe("erreurs");
    expect(lignes[0]).toMatch(/^Une alerte en cours \[F\d+\]\[F\d+\]\.$/);
    expect(r.texte).toMatch(/Erreurs : 3,2\s% des pages vues/);
    expect(r.texte).toMatch(/Régression : « Erreur réapparue : TypeError pour \[adresse masquée\]/);
    expect(r.texte).toMatch(/Pic d'erreurs navigateur : 9\soccurrences, le 30\/09 à 13:00/);
    expect(r.texte).toMatch(/Composante « Erreurs navigateur » de la santé : 29,1/);
  });

  it("changements : les variations, la plus défavorable d'abord, puis la release et les écarts détectés", () => {
    const r = repondreParRegles(QUESTIONS_SUGGEREES[3], digest);
    const lignes = r.texte.split("\n");
    expect(r.intention).toBe("changements");
    expect(lignes[0]).toMatch(/^3 mesures ont bougé, dont 2 dans le mauvais sens ; la plus forte : Occurrences d'erreurs pour 100 pages vues \(\+60\s%/);
    expect(r.texte).toMatch(/Release 2\.4\.0 face à 2\.3\.0 : LCP p75 3,6\ss contre 3,0\ss \(LCP p75 \+20\s% vs 2\.3\.0\)/);
    expect(r.texte).toMatch(/Rupture du LCP p75 sur 14 jours : non datable/);
    expect(r.texte).toMatch(/Écart détecté : « LCP p75 au-dessus de sa plage habituelle depuis 11:00 »/);
  });

  it("sans variation affichée, la raison de la case est dite", () => {
    const d = construireDigestVueEnsemble(
      entrees({
        cases: [
          {
            cle: "LCP",
            titre: "LCP p75",
            props: { label: "LCP p75", valeur: 4800, format: "ms", vital: "LCP", precedent: null, reference: "vs 24 h précédentes" },
          },
        ],
        release: null,
        datation: null,
        constats: null,
      }),
    );
    const r = repondreParRegles("Qu'est-ce qui a changé ?", d);
    expect(r.texte.split("\n")[0]).toMatch(/^Aucune variation affichée : pas de mesure sur 24 h précédentes \[F\d+\]\.$/);
  });

  it("une question hors de portée reçoit le résumé, précédé de ce que l'assistant sait faire sans modèle", () => {
    const r = repondreParRegles("Quel temps fera-t-il demain ?", digest);
    expect(r.intention).toBe("autre");
    expect(r.texte.split("\n")[0]).toMatch(/^Sans modèle d'IA, l'assistant répond aux questions de ce tableau de bord/);
    expect(r.texte.split("\n")[1]).toMatch(/^Santé 72/);
  });

  it("sans aucun fait, il ne dit rien de chiffré", () => {
    const vide: Digest = { ...digest, faits: [] };
    const r = resumerEtat(vide);
    expect(r.texte).toBe("Aucun chiffre n'est lisible sur ce tableau de bord : rien à résumer.");
    expect(r.citations).toEqual([]);
  });
});
