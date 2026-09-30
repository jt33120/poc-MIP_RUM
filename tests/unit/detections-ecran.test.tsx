// Vague 3b — les détections à l'écran (A2 § 6.1, § 7.6). Ce qui compte :
//   · la bande n'existe que là où le calcul l'a produite — jamais inventée, jamais
//     posée sur une grille non horaire ni sous un filtre de population ;
//   · les cartes de constats : les ouverts seulement, par priorité décroissante, 5 au
//     plus, chacune avec sa preuve chiffrée, son effectif et sa méthode ;
//   · aucune anomalie redite quand un épisode la recouvre ;
//   · le vocabulaire (A2 § 7.0, § 8.8–8.9).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConstatsDetectes } from "@/components/vue-ensemble/ConstatsDetectes";
import {
  anomaliesSansDoublon,
  carteDeConstat,
  cartesConstats,
  episodesSurGrille,
  PHRASE_PLAGE_PAS_CALCULEE,
  phrasePlagesHero,
  plageDuHero,
  raisonSansPlage,
  type PlageHero,
} from "@/lib/detections-ecran";

const H = 3_600_000;
const T0 = Date.parse("2026-09-28T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const GRILLE = Array.from({ length: 6 }, (_, i) => iso(T0 + i * H));

const SANS_FILTRE = { includeBots: false, includeInternal: false, segments: [] };

type Point = {
  heure: string;
  n: number;
  p75: number | null;
  p75Bas: number | null;
  p75Haut: number | null;
  attendu: { mediane: number; bas: number; haut: number; niveau: "hebdomadaire" | "quotidien" | "48h"; legende: string } | null;
  z: number | null;
};
const point = (i: number, attendu: boolean, z: number | null = null): Point => ({
  heure: GRILLE[i],
  n: 40,
  p75: 2400,
  p75Bas: 2200,
  p75Haut: 2600,
  attendu: attendu ? { mediane: 2000, bas: 1600, haut: 2500, niveau: "quotidien", legende: "même heure, 7 à 14 derniers jours" } : null,
  z,
});
const lecture = (points: Point[], bande = true) =>
  ({ ok: true, data: { etat: "ok", app: "a", vital: "LCP", route: "", points, bande } }) as const;

const constat = (o: Partial<Parameters<typeof carteDeConstat>[0]> = {}): Parameters<typeof carteDeConstat>[0] => ({
  id: 1,
  appId: "a",
  detecteur: "plage",
  entite: "vital:LCP",
  debut: GRILLE[2],
  fin: null,
  statut: "ouvert",
  priorite: 0.4,
  phrase: "LCP p75 à 3,1 s depuis 14:00, contre 2,2 s habituellement à cette heure (3,4 écarts robustes, 312 mesures). Détecté par calcul ; plage habituelle : même heure, 7 à 14 derniers jours.",
  methode: {
    nom: "plage habituelle saisonnière (médiane et écart absolu médian, échelle logarithmique)",
    legende: "même heure, 7 à 14 derniers jours",
    references: 21,
    regle: "z > 3 deux heures de suite ou trois heures sur quatre ; fermé après deux heures à z ≤ 2",
    mesures_min_heure: 13,
  },
  preuves: { vital: "LCP", route: "", p75: 3100, mediane_habituelle: 2200, z: 3.4, ecart_relatif: 0.409 },
  impact: { part_mesures: 1, mesures: 312, mesures_total: 312 },
  ...o,
});

describe("raisonSansPlage", () => {
  it("rien à redire sur une grille horaire, sans filtre, hors comparaison de releases", () => {
    expect(raisonSansPlage({ seauSecondes: 3600, filtres: SANS_FILTRE, modeRelease: false })).toBeNull();
  });
  it("une grille non horaire, un filtre de population, une comparaison de releases : pas de bande, et la raison", () => {
    expect(raisonSansPlage({ seauSecondes: 86400, filtres: SANS_FILTRE, modeRelease: false })).toMatch(/une heure seulement/);
    expect(raisonSansPlage({ seauSecondes: 3600, filtres: { ...SANS_FILTRE, device: "mobile" }, modeRelease: false })).toMatch(/filtre de population/);
    expect(raisonSansPlage({ seauSecondes: 3600, filtres: { ...SANS_FILTRE, segments: [{}] }, modeRelease: false })).toMatch(/filtre/);
    expect(raisonSansPlage({ seauSecondes: 3600, filtres: SANS_FILTRE, modeRelease: true })).toMatch(/releases/);
  });
});

describe("plageDuHero — la bande présente", () => {
  it("pose la plage sur les heures qui l'ont, et laisse les autres SANS bande", () => {
    const p = plageDuHero(lecture([point(0, false), point(1, true, 0.8), point(2, true, 3.4)]), GRILLE, 3600, [], "LCP");
    expect(p.etat).toBe("tracee");
    if (p.etat !== "tracee") return;
    expect(Object.keys(p.parInstant)).toEqual([GRILLE[1], GRILLE[2]]);
    expect(p.parInstant[GRILLE[2]]).toEqual({ bas: 1600, haut: 2500, mediane: 2000, z: 3.4 });
    expect(p.parInstant[GRILLE[0]]).toBeUndefined();
    expect(p.legende).toBe("même heure, 7 à 14 derniers jours");
    expect(p.heures).toBe(2);
  });

  it("marque les épisodes de la même série sur la grille, et ignore les autres", () => {
    const p = plageDuHero(
      lecture([point(1, true)]),
      GRILLE,
      3600,
      [constat(), constat({ id: 2, entite: "vital:INP" }), constat({ id: 3, entite: "vital:LCP|route:/checkout" })],
      "LCP",
    );
    expect(p.etat === "tracee" && p.episodes).toEqual([{ x1: GRILLE[2], x2: GRILLE[5], enCours: true }]);
  });
});

describe("plageDuHero — la bande absente", () => {
  it("aucune heure calculée : la phrase « pas encore calculée », jamais une bande", () => {
    const p = plageDuHero(lecture([point(0, false), point(1, false)]), GRILLE, 3600, [], "LCP");
    expect(p).toEqual({ etat: "non_tracee", raison: PHRASE_PLAGE_PAS_CALCULEE });
    expect(PHRASE_PLAGE_PAS_CALCULEE).toMatch(/pas encore calculée \(il faut 2 jours d'historique/);
  });
  it("table absente, app à choisir, plage trop longue, lecture en échec : chacun sa raison", () => {
    expect(plageDuHero({ ok: true, data: { etat: "absent" } }, GRILLE, 3600, [], "LCP")).toMatchObject({ etat: "non_tracee", raison: /pas encore calculée/ });
    expect(plageDuHero({ ok: true, data: { etat: "une_app_requise" } }, GRILLE, 3600, [], "LCP")).toMatchObject({ raison: /choisissez une application/ });
    expect(plageDuHero(lecture([point(1, true)], false), GRILLE, 3600, [], "LCP")).toMatchObject({ raison: /14 jours au plus/ });
    expect(plageDuHero({ ok: false }, GRILLE, 3600, [], "LCP")).toMatchObject({ raison: /lecture en échec/ });
  });
});

describe("episodesSurGrille", () => {
  it("un épisode clos s'arrête au seau qui précède sa fin ; hors de la grille, il est ignoré", () => {
    const clos = constat({ debut: GRILLE[1], fin: GRILLE[3], statut: "clos" });
    expect(episodesSurGrille(GRILLE, 3600, [clos], "LCP")).toEqual([{ x1: GRILLE[1], x2: GRILLE[2], enCours: false }]);
    const avant = constat({ debut: iso(T0 - 10 * H), fin: iso(T0 - 8 * H), statut: "clos" });
    expect(episodesSurGrille(GRILLE, 3600, [avant], "LCP")).toEqual([]);
  });
});

describe("phrasePlagesHero", () => {
  const tracee: PlageHero = { etat: "tracee", parInstant: {}, episodes: [{ x1: GRILLE[0], x2: GRILLE[1], enCours: true }], legende: "même heure, 7 à 14 derniers jours", heures: 3 };
  it("tracée : la référence, les écarts robustes et « détecté par calcul », dits une fois", () => {
    const p = phrasePlagesHero([tracee, tracee, { etat: "non_tracee", raison: PHRASE_PLAGE_PAS_CALCULEE }]);
    expect(p?.etat).toBe("tracee");
    expect(p?.texte).toContain("plage habituelle");
    expect(p?.texte).toContain("écarts robustes");
    expect(p?.texte).toContain("détecté par calcul");
    expect(p?.texte.match(/7 à 14 derniers jours/g)).toHaveLength(1);
  });
  it("non tracée : la raison, une fois pour les trois vitals", () => {
    const n: PlageHero = { etat: "non_tracee", raison: PHRASE_PLAGE_PAS_CALCULEE };
    expect(phrasePlagesHero([n, n, n])).toEqual({ etat: "non_tracee", texte: PHRASE_PLAGE_PAS_CALCULEE });
    expect(phrasePlagesHero([])).toBeNull();
  });
});

describe("cartes de constats", () => {
  it("les ouverts seulement, par priorité décroissante (puis le plus récent), 5 au plus", () => {
    const constats = [
      constat({ id: 1, priorite: 0.1 }),
      constat({ id: 2, priorite: 0.9, statut: "clos", fin: GRILLE[4] }),
      constat({ id: 3, priorite: 0.6 }),
      constat({ id: 4, priorite: 0.6, debut: GRILLE[3] }),
      constat({ id: 5, priorite: 0.3 }),
      constat({ id: 6, priorite: 0.2 }),
      constat({ id: 7, priorite: 0.05 }),
    ];
    const r = cartesConstats({ etat: "ok", constats }, 5, T0 + 6 * H);
    expect(r.cartes.map((c) => c.id)).toEqual([4, 3, 5, 6, 1]);
    expect(r.ouverts).toBe(6);
    expect(r.clos).toBe(1);
    expect(cartesConstats({ etat: "absent" })).toMatchObject({ cartes: [], calcul: false });
  });

  it("une carte porte un fait chiffré, la preuve, l'effectif et la méthode", () => {
    const c = carteDeConstat(constat(), T0 + 6 * H);
    expect(c.titre).toBe("LCP p75 au-dessus de sa plage habituelle depuis 16:00");
    expect(c.preuve).toBe("3,1 s contre 2,2 s habituellement · +41 % · 3,4 écarts robustes");
    expect(c.effectif).toBe("312 mesures dans l'heure");
    expect(c.niveauPriorite).toBe("moyenne");
    expect(c.methode.map((m) => m.libelle)).toEqual(["Méthode", "Référence", "Heures de référence", "Règle", "Mesures minimales par heure", "Priorité", "Origine"]);
    // Une route : la part de l'app est dite.
    const r = carteDeConstat(constat({ preuves: { vital: "INP", route: "/checkout", p75: 300, mediane_habituelle: 150, z: 4, ecart_relatif: 1 }, impact: { part_mesures: 0.04, mesures: 80 } }), T0 + 6 * H);
    expect(r.titre).toContain("INP p75 de /checkout");
    expect(r.effectif).toBe("80 mesures dans l'heure (4 % des mesures de l'app)");
  });

  it("le rendu : la méthode repliée « Afficher la méthode », et un état vide qui ne dit jamais « tout va bien »", () => {
    const carte = carteDeConstat(constat(), T0 + 6 * H);
    const html = renderToStaticMarkup(<ConstatsDetectes etat={{ kind: "ok", cartes: [carte], ouverts: 1, clos: 0 }} />);
    expect(html).toContain("<details");
    expect(html).toContain("Afficher la méthode");
    expect(html).toContain('data-testid="constat-detecte"');
    const vide = renderToStaticMarkup(<ConstatsDetectes etat={{ kind: "ok", cartes: [], ouverts: 0, clos: 2 }} />);
    expect(vide).toMatch(/Aucun épisode ouvert/);
    expect(vide).toMatch(/2 épisodes clos/);
    expect(vide).not.toMatch(/tout va bien/i);
    expect(renderToStaticMarkup(<ConstatsDetectes etat={{ kind: "echec" }} />)).toMatch(/lecture en échec/);
  });

  it("vocabulaire : ni cause, ni « IA », ni certitude, dans les cartes rendues", () => {
    const INTERDITS = [/\bcause/i, /\bcaus[ée]/i, /l['’]IA\b/i, /\bIA\b/, /intelligence artificielle/i, /avec certitude/i, /\bprédi[tc]/i, /\bpense\b/i];
    const cartes = [constat(), constat({ id: 2, detecteur: "rupture", entite: "vital:LCP" })].map((c) => carteDeConstat(c, T0 + 6 * H));
    const html = renderToStaticMarkup(<ConstatsDetectes etat={{ kind: "ok", cartes, ouverts: 2, clos: 0 }} />);
    for (const m of INTERDITS) expect(html).not.toMatch(m);
  });
});

describe("anomaliesSansDoublon", () => {
  it("retire l'anomalie que recouvre un épisode de la même série, garde les autres", () => {
    const anomalies = [
      { route: null, bucket: GRILLE[3] },
      { route: null, bucket: GRILLE[1] },
      { route: "/checkout", bucket: GRILLE[3] },
    ];
    expect(anomaliesSansDoublon(anomalies, [constat()])).toEqual([anomalies[1], anomalies[2]]);
    expect(anomaliesSansDoublon(anomalies, [])).toEqual(anomalies);
  });
});
