// `GET /api/v1/errors/{fingerprint}/overrepresentation` — la réponse, construite à
// partir des effectifs lus. PURE : ni base, ni next/* (testé par
// tests/unit/api-v1-statistiques.test.ts).
//
// LE TEST EST CELUI DU PAQUET. `analyserSurrepresentation` (`@mip/stats`) : test exact
// de Fisher unilatéral par valeur, correction de Benjamini-Hochberg sur TOUTES les
// valeurs testées de la réponse, trois volumes minimaux — et un refus chiffré en
// dessous (« 7 sessions touchées, 10 requises »), jamais une liste vide qui se
// lirait comme « rien de particulier ».
//
// RM5 — la réserve d'interprétation est écrite ICI, par qui affiche : le module de
// calcul ne parle jamais de cause (un test de gabarit le lui interdit).
import {
  UNITES_SESSIONS,
  analyserSurrepresentation,
  phraseSurrepresentation,
  type AnalyseRetenue,
  type TestValeur,
} from "@mip/stats/surrepresentation";
import type { Refus } from "@mip/stats/types";
import { formater } from "../fmt-ids";
import type { EffectifsGroupe } from "../queries-surrepresentation";

export const RESERVE_ASSOCIATION = "Association observée, pas une cause établie.";

export const POPULATION_SURREPRESENTATION =
  "sessions de l'application actives sur la période (dernière activité dans la fenêtre), sous les filtres du contrat, " +
  "robots exclus par défaut ; touchées = celles qui portent au moins une occurrence du groupe sur la même période. " +
  "Une occurrence sans session n'y entre pas : elle n'a pas de valeur de session.";

export interface ValeurApi {
  valeur: string;
  nTouches: number;
  nBase: number;
  /** Le test de la valeur ; `null` : non testée (« Inconnu », moins de 3 sessions touchées, ou analyse refusée). */
  test: TestValeur | null;
}

export interface SurrepresentationApi {
  groupe: { app: string; fingerprint: string };
  population: string;
  totaux: { touches: number; base: number };
  dimensions: { cle: string; libelle: string; valeurs: ValeurApi[] }[];
  /** Les valeurs retenues et la règle, ou le refus chiffré (`manque`). */
  analyse:
    | { ok: true; testees: number; regle: string; retenues: (AnalyseRetenue & { phrase: string })[] }
    | Refus;
}

/** La réponse, depuis les effectifs d'un groupe résolu. */
export function surrepresentationDuGroupe(
  groupe: { app_id: string; fingerprint: string },
  effectifs: EffectifsGroupe,
): SurrepresentationApi {
  const { totaux } = effectifs;
  const analyse = analyserSurrepresentation(effectifs.dimensions, totaux, UNITES_SESSIONS);
  const tests = new Map(analyse.ok ? analyse.dimensions.map((d) => [d.cle, d.tests]) : []);
  const pct = (v: number) => formater("pct", v);
  return {
    groupe: { app: groupe.app_id, fingerprint: groupe.fingerprint },
    population: POPULATION_SURREPRESENTATION,
    totaux,
    dimensions: effectifs.dimensions.map((d) => ({
      cle: d.cle,
      libelle: d.libelle,
      valeurs: d.valeurs.map((v) => ({ ...v, test: tests.get(d.cle)?.[v.valeur] ?? null })),
    })),
    analyse: analyse.ok
      ? {
          ok: true,
          testees: analyse.testees,
          regle: analyse.regle,
          retenues: analyse.retenues.map((r) => ({
            ...r,
            phrase: `${phraseSurrepresentation(r, totaux, analyse.testees, pct)} ${RESERVE_ASSOCIATION}`,
          })),
        }
      : analyse,
  };
}
