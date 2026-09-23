// F47 — rejeu synchronisé (`lib/replay-synchro.ts`, plan § 4.3 et § 5.12.4).
//
// CE QUE CES TESTS TIENNENT, ET QUI NE SE VOIT PAS À LA LECTURE DU CODE :
//   - la correspondance temps → ligne active est une recherche DICHOTOMIQUE qui rend
//     exactement ce qu'un balayage rendrait (dernière ligne commencée à ou avant t),
//     égalités comprises ;
//   - l'en-tête du lecteur ne peut pas dire autre chose que le SDK : 2 minutes et
//     1 Mo sont ses constantes, et « texte et médias masqués » n'est jamais écrit
//     sans dire que c'est le réglage PAR DÉFAUT (une application peut démasquer) ;
//   - « à l'instant de l'erreur » n'est écrit que si une erreur tombe à cet instant ;
//   - les mesures (Web Vitals) ne sont ni des repères ni des lignes : leur instant est
//     celui de leur rapport, pas de ce qu'elles mesurent.
import { describe, expect, it } from "vitest";
import { REPLAY_MAX_COMPRESSED_BYTES, REPLAY_MAX_MS } from "../../packages/rum-sdk/src/replay";
import type { TimelineItem } from "@/lib/queries";
import {
  REJEU_MAX_MS,
  REJEU_MAX_OCTETS,
  TEXTE_COUVERTURE,
  VITESSES,
  ligneActive,
  lignesSynchro,
  lireIgnores,
  marqueursDeSession,
  messagePosition,
  positionSurBarre,
  texteIgnores,
  type Marqueur,
} from "@/lib/replay-synchro";
import { reperesHorsBarre, textesReperesHorsBarre } from "@/lib/replay-synchro";

const T0 = Date.parse("2026-09-22T10:00:00Z");

function item(kind: TimelineItem["kind"], s: number, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    kind,
    ts: new Date(T0 + s * 1000),
    title: null,
    detail: null,
    value: null,
    rating: null,
    action_id: null,
    action_name: null,
    ...extra,
  };
}

describe("F47 — ligneActive : recherche dichotomique", () => {
  const lignes = [10, 20, 20, 35, 50].map((t) => ({ t }));

  it("avant la première ligne : aucune ligne (-1) ; après la dernière : la dernière", () => {
    expect(ligneActive(lignes, 5)).toBe(-1);
    expect(ligneActive(lignes, 99)).toBe(4);
    expect(ligneActive([], 10)).toBe(-1);
  });

  it("la dernière ligne commencée à ou avant l'instant, égalités comprises", () => {
    expect(ligneActive(lignes, 10)).toBe(0);
    expect(ligneActive(lignes, 19)).toBe(0);
    expect(ligneActive(lignes, 20)).toBe(2); // deux lignes au même instant : la seconde
    expect(ligneActive(lignes, 34)).toBe(2);
    expect(ligneActive(lignes, 35)).toBe(3);
  });

  it("rend exactement ce qu'un balayage rendrait, sur 500 lignes tirées au hasard", () => {
    let graine = 7;
    const hasard = () => (graine = (graine * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const longues = Array.from({ length: 500 }, () => ({ t: Math.floor(hasard() * 120_000) })).sort((a, b) => a.t - b.t);
    const balayage = (t: number) => longues.reduce((dernier, l, i) => (l.t <= t ? i : dernier), -1);
    for (let k = 0; k < 400; k++) {
      const t = Math.floor(hasard() * 130_000) - 5_000;
      expect(ligneActive(longues, t)).toBe(balayage(t));
    }
  });
});

describe("F47 — lignes et repères lus dans la chronologie", () => {
  const CHRONOLOGIE: TimelineItem[] = [
    item("pageview", 0, { title: "/" }),
    item("vital", 1, { title: "LCP", detail: "/", value: 2100 }),
    item("action", 20, { title: "Payer", action_id: "a1" }),
    item("error", 21, { title: "TypeError", value: 3, action_id: "a1" }),
    item("event", 22, { title: "frustration.rage" }),
    item("event", 23, { title: "panier.vu" }),
    item("api", 24, { title: "POST /api/paiement", detail: "500" }),
  ];

  it("repères : erreurs, signaux, vues, actions — jamais une mesure, un appel ni un événement métier", () => {
    expect(marqueursDeSession(CHRONOLOGIE)).toEqual([
      { t: T0, ton: "vue", libelle: "/" },
      { t: T0 + 20_000, ton: "action", libelle: "Payer" },
      { t: T0 + 21_000, ton: "erreur", libelle: "TypeError" },
      { t: T0 + 22_000, ton: "frustration", libelle: "Salve de clics" },
    ]);
  });

  it("lignes : le rang de la chronologie LUE fait l'ancre ; les mesures et les lignes masquées n'y sont pas", () => {
    const lignes = lignesSynchro(CHRONOLOGIE, (rang) => `evt-${rang}`);
    expect(lignes.map((l) => l.ancre)).toEqual(["evt-0", "evt-2", "evt-3", "evt-4", "evt-5", "evt-6"]);
    expect(lignes[1]).toEqual({ id: "2", t: T0 + 20_000, ancre: "evt-2" });
    const erreurs = lignesSynchro(CHRONOLOGIE, (rang) => `evt-${rang}`, (it) => it.kind === "error");
    expect(erreurs).toEqual([{ id: "3", t: T0 + 21_000, ancre: "evt-3" }]);
  });
});

describe("F47 — barre, annonces, segments ignorés", () => {
  it("position sur la barre en % de l'enregistrement ; hors de lui : aucune", () => {
    expect(positionSurBarre(1500, 1000, 3000)).toBe(25);
    expect(positionSurBarre(1000, 1000, 3000)).toBe(0);
    expect(positionSurBarre(3000, 1000, 3000)).toBe(100);
    expect(positionSurBarre(999, 1000, 3000)).toBeNull();
    expect(positionSurBarre(3001, 1000, 3000)).toBeNull();
    expect(positionSurBarre(1000, 1000, 1000)).toBe(0);
  });

  it("« à l'instant de l'erreur » seulement si une erreur tombe à cet instant (à la seconde près)", () => {
    const reperes = [{ t: 5_000, ton: "erreur" as const, libelle: "TypeError" }];
    expect(messagePosition("url", 5_400, reperes, 0)).toBe("Replay positionné à l'instant de l'erreur");
    // Un lien venu d'une trace n'est pas une erreur.
    expect(messagePosition("url", 9_000, reperes, 0)).toMatch(/^Replay positionné à l'instant demandé \(\+9/);
    expect(messagePosition("ligne", 9_000, reperes, 0)).toMatch(/^Replay positionné sur la ligne choisie \(\+9/);
    expect(messagePosition("marqueur", 5_000, reperes, 0)).toMatch(/^Replay positionné sur le repère choisi/);
  });

  it("`ignores` : un entier positif, sinon 0 ; le texte s'accorde", () => {
    expect(lireIgnores(3)).toBe(3);
    expect(lireIgnores(undefined)).toBe(0);
    expect(lireIgnores("2")).toBe(0);
    expect(lireIgnores(-1)).toBe(0);
    expect(lireIgnores(1.5)).toBe(0);
    expect(texteIgnores(1)).toBe("1 segment illisible ignoré");
    expect(texteIgnores(3)).toBe("3 segments illisibles ignorés");
  });

  it("vitesses 1×, 2×, 4×", () => {
    expect([...VITESSES]).toEqual([1, 2, 4]);
  });
});

describe("F47 — l'en-tête du lecteur dit ce que le SDK fait, rien de plus", () => {
  it("2 minutes et 1 Mo sont les bornes du SDK, pas des chiffres recopiés à la main", () => {
    expect(REJEU_MAX_MS).toBe(REPLAY_MAX_MS);
    expect(REJEU_MAX_OCTETS).toBe(REPLAY_MAX_COMPRESSED_BYTES);
    expect(TEXTE_COUVERTURE).toContain(`${REPLAY_MAX_MS / 60_000} premières minutes`);
    expect(TEXTE_COUVERTURE).toContain(`${REPLAY_MAX_COMPRESSED_BYTES / (1024 * 1024)} Mo compressé`);
    expect(TEXTE_COUVERTURE).toContain("conservé 30 jours");
  });

  it("le masquage du texte et des médias est dit comme un RÉGLAGE PAR DÉFAUT, démasquable", () => {
    expect(TEXTE_COUVERTURE).toContain("Saisies toujours masquées");
    expect(TEXTE_COUVERTURE).toMatch(/texte et médias aussi, au réglage par défaut du SDK/);
    expect(TEXTE_COUVERTURE).toContain("une application peut les démasquer");
  });
});

// Revue de fin de vague 7 (F47) — le lecteur disait « N repère(s) après
// l'enregistrement » de TOUT repère hors de la barre. Or le SDK émet la page vue
// initiale dès son init et charge le module de rejeu à part : sur une vraie session,
// la première vue précède presque toujours le début de l'enregistrement. Avant et
// après se comptent à part, chacun avec sa phrase.
describe("Revue v7 — repères hors de la barre : avant le début, après la fin", () => {
  // Enregistrement de T0 + 5 s à T0 + 65 s : la vue initiale (T0) le précède.
  const DEBUT = T0 + 5_000;
  const FIN = T0 + 65_000;
  const repere = (s: number, ton: Marqueur["ton"] = "vue"): Marqueur => ({ t: T0 + s * 1000, ton, libelle: `à ${s} s` });

  it("la vue initiale émise avant le chargement du module de rejeu : AVANT, jamais « après »", () => {
    const compte = reperesHorsBarre([repere(0), repere(20, "action"), repere(21, "erreur")], DEBUT, FIN);
    expect(compte).toEqual({ avant: 1, apres: 0 });
    const textes = textesReperesHorsBarre(compte);
    expect(textes).toEqual([
      "1 repère avant le début de l'enregistrement : il démarre une fois le module de rejeu chargé, souvent après la première page vue",
    ]);
    expect(textes.join(" ")).not.toMatch(/après la fin|premières minutes/);
  });

  it("au-delà de la fin : APRÈS, avec les bornes du SDK (2 minutes, 1 Mo compressé)", () => {
    const compte = reperesHorsBarre([repere(30), repere(66, "erreur"), repere(200, "frustration")], DEBUT, FIN);
    expect(compte).toEqual({ avant: 0, apres: 2 });
    expect(textesReperesHorsBarre(compte)).toEqual([
      `2 repères après la fin de l'enregistrement, limité aux ${REPLAY_MAX_MS / 60_000} premières minutes ou à ` +
        `${REPLAY_MAX_COMPRESSED_BYTES / (1024 * 1024)} Mo compressé`,
    ]);
  });

  it("cas mixte : deux phrases, AVANT d'abord ; les bornes elles-mêmes sont sur la barre", () => {
    const marqueurs = [repere(0), repere(2, "action"), repere(5), repere(65, "erreur"), repere(70), repere(90, "action")];
    const compte = reperesHorsBarre(marqueurs, DEBUT, FIN);
    expect(compte).toEqual({ avant: 2, apres: 2 });
    // Chaque repère est compté une fois : sur la barre, avant, ou après.
    const surLaBarre = marqueurs.filter((m) => positionSurBarre(m.t, DEBUT, FIN) !== null).length;
    expect(surLaBarre + compte.avant + compte.apres).toBe(marqueurs.length);
    const textes = textesReperesHorsBarre(compte);
    expect(textes).toHaveLength(2);
    expect(textes[0]).toMatch(/^2 repères avant le début de l'enregistrement/);
    expect(textes[1]).toMatch(/^2 repères après la fin de l'enregistrement/);
  });

  it("tout tient sur la barre : aucune phrase ; un enregistrement d'un instant garde ses deux côtés", () => {
    expect(textesReperesHorsBarre(reperesHorsBarre([repere(10), repere(60)], DEBUT, FIN))).toEqual([]);
    // Début = fin : l'instant même est placé, le reste se range de part et d'autre.
    expect(reperesHorsBarre([repere(4), repere(5), repere(6)], DEBUT, DEBUT)).toEqual({ avant: 1, apres: 1 });
  });
});
