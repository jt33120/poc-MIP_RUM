// Récit de session composé de faits (P*.9) : texte attendu MOT POUR MOT sur une
// chronologie fixée, chaque phrase liée à la ligne qui la fonde, aucun mot qui
// prête une intention ou une cause.
import { describe, expect, it } from "vitest";
import type { TimelineItem } from "@/lib/queries";
import {
  LIMITE_CHRONOLOGIE,
  MOTS_INTERDITS,
  ancreEvenement,
  composerRecit,
  duree,
  mentionRejeu,
} from "@/lib/recit-session";

const T0 = Date.parse("2026-09-20T10:00:00Z");
const APRES = T0 + 24 * 3600_000; // lecture le lendemain : session close

function ligne(kind: TimelineItem["kind"], s: number, p: Partial<TimelineItem> = {}): TimelineItem {
  return {
    kind,
    ts: new Date(T0 + s * 1000),
    title: null,
    detail: null,
    value: null,
    rating: null,
    action_id: null,
    action_name: null,
    ...p,
  };
}

const ACTION = "33333333-4444-4555-8666-777777777777";

const TIMELINE: TimelineItem[] = [
  ligne("pageview", 0, { title: "/", detail: "navigate" }),
  ligne("vital", 1, { title: "LCP", detail: "/", value: 1900, rating: "good" }),
  ligne("pageview", 60, { title: "/catalogue" }),
  ligne("pageview", 180, { title: "/panier" }),
  ligne("vital", 182, { title: "LCP", detail: "/panier", value: 4800, rating: "poor" }),
  // Phase réseau : pas un Core Web Vital, jamais « pire vital ».
  ligne("vital", 182, { title: "DNS", detail: "/panier", value: 9000 }),
  ligne("pageview", 300, { title: "/paiement" }),
  ligne("action", 330, { title: "Payer", detail: "click · /paiement", action_id: ACTION, action_name: "Payer" }),
  ligne("error", 333, { title: "TypeError", detail: "x is undefined", value: 2, action_id: ACTION, action_name: "Payer" }),
  ligne("event", 334, { title: "frustration.rage" }),
  ligne("event", 335, { title: "frustration.rage" }),
  ligne("event", 340, { title: "frustration.dead" }),
  ligne("api", 372, { title: "POST /api/pay", detail: "500", value: 120, rating: "poor" }),
];

const recit = (timeline: TimelineItem[], fin = 372) =>
  composerRecit({ timeline, debut: new Date(T0), fin: new Date(T0 + fin * 1000), nowMs: APRES });

describe("composerRecit", () => {
  it("chronologie fixée → texte attendu mot pour mot, dans l'ordre du plan", () => {
    const r = recit(TIMELINE);
    if (!r.ok) throw new Error(r.raison);
    expect(r.phrases.map((p) => p.texte)).toEqual([
      "4 vues : / → /catalogue → /panier → /paiement.",
      "6 min 12 s entre la première et la dernière observation.",
      "Pire mesure Web Vitals rapportée à son seuil, sur 2 mesures : LCP 4,80 s sur /panier, « Mauvais » (bon ≤ 2,5 s, mauvais au-delà de 4,0 s).",
      "2 occurrences de TypeError sur /paiement, 3 s après le clic “Payer”.",
      "Signaux de frustration reçus : 2 salves de clics, 1 clic sans réaction.",
      "Dernière observation sur /paiement : appel POST /api/pay.",
    ]);
  });

  it("chaque phrase renvoie à la ligne qui la fonde", () => {
    const r = recit(TIMELINE);
    if (!r.ok) throw new Error(r.raison);
    expect(r.phrases.map((p) => p.ancre)).toEqual(["evt-0", "evt-0", "evt-4", "evt-8", "evt-9", "evt-12"]);
    // L'erreur cite aussi l'action qui la précède, avec son propre lien.
    expect(r.phrases[3].action).toEqual({ texte: "le clic “Payer”", ancre: ancreEvenement(7) });
    // Chaque ancre désigne une ligne qui existe.
    for (const p of r.phrases) expect(Number(p.ancre.slice(4))).toBeLessThan(TIMELINE.length);
  });

  it("aucun mot interdit (intention, état d'esprit, cause)", () => {
    const r = recit(TIMELINE);
    if (!r.ok) throw new Error(r.raison);
    const texte = [...r.phrases.map((p) => p.texte), mentionRejeu("absent"), mentionRejeu("masque"), mentionRejeu(null)].join(" ");
    expect(texte).not.toMatch(MOTS_INTERDITS);
    expect(texte).not.toMatch(/cause|responsable/i); // RM5, gabarit du § 7.1
  });

  it("occurrences = 3 sur une ligne → « 3 occurrences », et les lignes d'un groupe se somment", () => {
    const une = recit([ligne("pageview", 0, { title: "/" }), ligne("error", 2, { title: "Error", value: 3 })], 2);
    if (!une.ok) throw new Error(une.raison);
    expect(une.phrases.map((p) => p.texte)).toContain("3 occurrences de Error sur /.");
    const deux = recit(
      [ligne("pageview", 0, { title: "/" }), ligne("error", 2, { title: "Error", value: 3 }), ligne("error", 4, { title: "Error", value: 1 })],
      4,
    );
    if (!deux.ok) throw new Error(deux.raison);
    expect(deux.phrases.map((p) => p.texte)).toContain("4 occurrences de Error sur /.");
  });

  it("erreur horodatée avant son action : aucun délai écrit, l'action reste citée", () => {
    const r = recit(
      [
        ligne("pageview", 0, { title: "/" }),
        ligne("error", 5, { title: "Error", value: 1, action_id: ACTION, action_name: "Payer" }),
        ligne("action", 7, { title: "Payer", detail: "click · /", action_id: ACTION, action_name: "Payer" }),
      ],
      7,
    );
    if (!r.ok) throw new Error(r.raison);
    const erreur = r.phrases.find((p) => p.texte.includes("Error"));
    expect(erreur?.texte).toBe("1 occurrence de Error sur /, action rattachée : le clic “Payer”.");
    expect(erreur?.texte).not.toMatch(/après|moins d'une seconde/);
    expect(erreur?.action).toEqual({ texte: "le clic “Payer”", ancre: ancreEvenement(2) });
  });

  it("occurrences non renvoyées (schéma v66) : on ne compte pas des lignes en « occurrences »", () => {
    const r = recit([ligne("error", 0, { title: "Error" }), ligne("error", 1, { title: "Error" })], 1);
    if (!r.ok) throw new Error(r.raison);
    const erreur = r.phrases.find((p) => p.texte.startsWith("Error"));
    expect(erreur?.texte).toBe("Error sur une route inconnue (nombre d'occurrences non renvoyé).");
    expect(r.phrases.map((p) => p.texte).join(" ")).not.toMatch(/\d+ occurrences?/);
  });

  it("au-delà de trois groupes d'erreurs, le reste tient en une phrase chiffrée", () => {
    const erreurs = ["A", "B", "C", "D", "E"].map((t, i) => ligne("error", i, { title: t, value: 2 }));
    const r = recit(erreurs, 4);
    if (!r.ok) throw new Error(r.raison);
    expect(r.phrases.map((p) => p.texte)).toContain("Et 2 autres groupes d'erreurs (4 occurrences).");
  });

  it("un seul événement suffit ; aucun événement → refus, jamais un récit creux", () => {
    const un = recit([ligne("pageview", 0, { title: "/" })], 0);
    if (!un.ok) throw new Error(un.raison);
    expect(un.phrases.map((p) => p.texte)).toEqual([
      "1 vue : /.",
      "moins d'une seconde entre la première et la dernière observation.",
      "Dernière observation sur / : vue de page.",
    ]);
    const vide = recit([], 0);
    expect(vide).toMatchObject({ ok: false, raison: "aucun événement pour cette session" });
  });

  it("parcours long : début et fin, le milieu est compté", () => {
    const vues = Array.from({ length: 9 }, (_, i) => ligne("pageview", i, { title: `/p${i}` }));
    const r = recit(vues, 8);
    if (!r.ok) throw new Error(r.raison);
    expect(r.phrases[0].texte).toBe("9 vues : /p0 → /p1 → /p2 → … (4 autres) → /p7 → /p8.");
  });

  it("chronologie tronquée à 500 : la fin n'est pas inventée", () => {
    const lignes = Array.from({ length: LIMITE_CHRONOLOGIE }, (_, i) => ligne("breadcrumb", i));
    const r = recit(lignes, 499);
    if (!r.ok) throw new Error(r.raison);
    expect(r.phrases.at(-1)?.texte).toBe(
      "Récit limité aux 500 premiers événements reçus : la suite de la session n'y figure pas.",
    );
  });

  it("session récente : la durée peut encore bouger, et le récit le dit", () => {
    const r = composerRecit({
      timeline: [ligne("pageview", 0, { title: "/" })],
      debut: new Date(T0),
      fin: new Date(T0 + 42_000),
      nowMs: T0 + 60_000,
    });
    if (!r.ok) throw new Error(r.raison);
    expect(r.phrases[1].texte).toBe(
      "42 s entre la première et la dernière observation. Dernier événement reçu il y a moins de 30 min : la session peut encore s'allonger.",
    );
  });
});

describe("duree", () => {
  it("formats", () => {
    expect(duree(400)).toBe("moins d'une seconde");
    expect(duree(3_000)).toBe("3 s");
    expect(duree(372_000)).toBe("6 min 12 s");
    expect(duree(3_900_000)).toBe("1 h 05 min");
  });
});

describe("mentionRejeu", () => {
  it("session sans rejeu → mention ; rejeu présent → rien", () => {
    expect(mentionRejeu("absent")).toBe(
      "Aucun rejeu enregistré pour cette session : le récit ne s'appuie que sur les événements.",
    );
    expect(mentionRejeu("present")).toBeNull();
  });
});
