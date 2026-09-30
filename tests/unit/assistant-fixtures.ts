// Ce que la Vue d'ensemble a lu, en petit : les entrées du condensé de l'assistant,
// partagées par ses tests (condensé, réponse par règles, route, volet).
import type { ImpactLigne } from "../../apps/console/components/ImpactTable";
import type { CaseLue, EntreesDigest } from "../../apps/console/lib/assistant/digest";

export const MAINTENANT = Date.parse("2026-09-30T12:00:00Z");
const REFERENCE = "vs 24 h précédentes (29/09 14:00 → 30/09 14:00)";
const complete = { etat: "complete" as const, raison: null };
const intervalle = (bas: number, haut: number) => ({ bas, haut, niveau: 0.95 as const, methode: "quantile_normal" as const });

export const CASES: CaseLue[] = [
  {
    cle: "sessions",
    titre: "Sessions commencées",
    props: { label: "Sessions commencées", valeur: 1240, format: "count", sensMeilleur: "neutre", precedent: 1000, reference: REFERENCE, couverturePrecedente: complete },
  },
  { cle: "pages-vues", titre: "Pages vues", props: { label: "Pages vues", valeur: 5678, format: "count", sensMeilleur: "neutre" } },
  {
    cle: "erreurs",
    titre: "Occurrences d'erreurs pour 100 pages vues",
    props: {
      label: "Occurrences d'erreurs pour 100 pages vues",
      valeur: 3.2,
      format: "pour100",
      sensMeilleur: "bas",
      precedent: 2,
      reference: REFERENCE,
      couverturePrecedente: complete,
      lecture: "erreurs navigateur seulement",
    },
  },
  {
    cle: "LCP",
    titre: "LCP p75",
    props: {
      label: "LCP p75",
      valeur: 4800,
      format: "ms",
      vital: "LCP",
      couverture: { n: 276, unite: "mesures", faibleSous: 100 },
      intervalle: intervalle(3200, 6300),
      precedent: 3900,
      reference: REFERENCE,
      couverturePrecedente: { ...complete, n: 300 },
      ecart: { etabli: true, regle: "intervalles disjoints" },
    },
  },
  {
    cle: "INP",
    titre: "INP p75",
    props: { label: "INP p75", valeur: 80, format: "ms", vital: "INP", couverture: { n: 110, unite: "mesures", faibleSous: 100 }, intervalle: intervalle(72, 104) },
  },
  { cle: "CLS", titre: "CLS p75", echec: true },
  {
    cle: "FCP",
    titre: "FCP p75",
    props: { label: "FCP p75", valeur: 5500, format: "ms", vital: "FCP", couverture: { n: 354, unite: "mesures", faibleSous: 100 }, intervalle: intervalle(4100, 6600) },
  },
  { cle: "TTFB", titre: "TTFB p75", props: { label: "TTFB p75", valeur: null, format: "ms", vital: "TTFB", raisonNull: "aucune mesure TTFB sur 24 h" } },
];

const ligne = (route: string, lcp: number, n: number, ecart: number, faible = false): ImpactLigne => ({
  cle: `v:${route}`,
  libelle: route,
  href: `/pages?route=${route}`,
  description: route,
  pilote: lcp,
  volume: n,
  mesures: [
    { cle: "lcp", valeur: lcp, affichage: `${lcp / 1000} s`, vital: "LCP", n },
    { cle: "inp", valeur: 120, affichage: "120 ms", vital: "INP", n },
    { cle: "cls", valeur: 0.02, affichage: "0,020", vital: "CLS", n },
  ],
  ecart: { valeur: ecart, affichage: `${ecart > 0 ? "+" : "−"}${Math.abs(ecart) / 1000} s vs ensemble` },
  echantillonFaible: faible,
});

/** Tout ce que l'écran peut montrer, bloc par bloc. */
export function entrees(surcharges: Partial<EntreesDigest> = {}): EntreesDigest {
  return {
    app: "boutique",
    periode: "24 h",
    maintenant: MAINTENANT,
    sante: {
      score: 72,
      label: "Dégradé",
      factors: [
        { key: "vitals", label: "Web Vitals", detail: "112/122 mesures bonnes", earned: 24.6, max: 40 },
        { key: "errors", label: "Erreurs navigateur", detail: "3,2 erreurs pour 100 pages vues", earned: 29.1, max: 30 },
        { key: "stability", label: "Stabilité", detail: "0 plantage", earned: 20, max: 20 },
        { key: "anomalies", label: "Anomalies", detail: "", earned: null, max: 10, raisonNull: "non testable" },
      ],
    },
    cases: CASES,
    series: [
      {
        vital: "LCP",
        lu: {
          ok: true,
          data: [
            { bucket: "2026-09-30T10:00:00Z", p75: 3100, n: 40 },
            { bucket: "2026-09-30T11:00:00Z", p75: 5200, n: 52 },
            { bucket: "2026-09-30T12:00:00Z", p75: null, n: 0 },
          ],
        },
      },
      { vital: "INP", lu: { ok: false } },
    ],
    datation: { phrase: "Pas encore assez d'historique pour dater une dégradation : 6 jours valides sur les 10 requis.", datable: false, rupture: null },
    constats: {
      liste: [
        { type: "alerte", titre: "LCP au-dessus de 4 s — déclenchée le 30/09 11:02", regle: "alerte déclenchée et non acquittée", href: "/alerts?evt=4" },
        {
          type: "regression",
          titre: "Erreur réapparue : TypeError pour jean.dupont@example.com (12 occurrences sur la période)",
          regle: "groupe d'erreurs marqué résolu qui réapparaît sur la période",
          href: "/errors",
        },
        { type: "anomalie", titre: "LCP /checkout : 4,8 s à 30/09 11:00 (moyenne 7 j : 2,1 s)", regle: "z-score 3,4 > 3", href: "/pages" },
      ],
      echecs: [],
      detectes: {
        kind: "ok",
        ouverts: 1,
        clos: 0,
        cartes: [
          {
            id: 17,
            titre: "LCP p75 au-dessus de sa plage habituelle depuis 11:00",
            preuve: "5,2 s contre 2,2 s habituellement · +136 %",
            effectif: "52 mesures dans l'heure",
            phrase: null,
            priorite: 0.7,
            niveauPriorite: "haute",
            enCours: true,
            methode: [],
          },
        ],
      },
      affiches: true,
    },
    anomalies: {
      lignes: [{ route: "/checkout", bucket: "2026-09-30T11:00:00Z", p75: 4800, mean_7d: 2100, z_score: 3.4 }],
      filtrees: false,
    },
    segments: {
      dimension: "route",
      vital: "LCP",
      ensemble: 4800,
      groupes: 47,
      lignes: [
        ligne("/checkout", 11500, 30, 6700),
        ligne("/login", 1700, 31, -3100),
        ligne("/installer", 127100, 1, 122300, true),
        ligne("/produit/:id", 6200, 40, 1400),
      ],
    },
    release: {
      a: { release: "2.3.0", sessions: 900, lcp_p75: 3000, inp_p75: 110, sessionsEnErreur: 18 },
      b: { release: "2.4.0", sessions: 340, lcp_p75: 3600, inp_p75: 130, sessionsEnErreur: 17 },
      regle: "dernier déploiement face au précédent",
    },
    historique: [
      { day: "2026-09-29", hour: 14, good_w: 10, total_w: 40 },
      { day: "2026-09-29", hour: 15, good_w: 90, total_w: 100 },
      { day: "2026-09-30", hour: 9, good_w: 1, total_w: 2 },
    ],
    angleMort: { kind: "ok", heures: 3, pire: { route: "/checkout", heures: 2, href: "/correlation" } },
    latence: {
      vital: "LCP",
      bornes: [],
      partMax: 0.4,
      colonnes: [
        { t: "2026-09-30T10:00:00Z", parts: [], n: 40, p75: 3100, faible: false },
        { t: "2026-09-30T11:00:00Z", parts: [], n: 52, p75: 5200, faible: false },
        { t: "2026-09-30T12:00:00Z", parts: [], n: 5, p75: 9000, faible: true },
      ],
    },
    charge: {
      vues: [
        { bucket: "2026-09-30T10:00:00Z", chargements: 100, spa: 20, inconnu: 0 },
        { bucket: "2026-09-30T11:00:00Z", chargements: 300, spa: 40, inconnu: 2 },
      ],
      erreurs: [
        { bucket: "2026-09-30T10:00:00Z", navigateur: 3 },
        { bucket: "2026-09-30T11:00:00Z", navigateur: 9 },
      ],
    },
    sansVisite: null,
    ...surcharges,
  };
}
