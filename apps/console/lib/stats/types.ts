// Types communs de la statistique explicable (épique P*, § 7.1 du plan).
//
// RÈGLE RM2 — REFUS AVANT VOLUME. Chaque calcul rend soit un résultat, soit un
// refus qui dit ce qui manque, en nombre : l'écran écrit « 7 mesures, 13
// requises », jamais une valeur par défaut, jamais 0. Un intervalle calculé sur
// trop peu de données aurait l'air d'une mesure sans en être une.

/** Ce qui manque pour calculer : combien il en faut, combien on en a, de quoi. */
export interface Manque {
  requis: number;
  observe: number;
  unite: string;
}

export type Refus = { ok: false; raison: string; manque: Manque };

/** Un résultat, ou un refus chiffré. */
export type Resultat<T extends object> = ({ ok: true } & T) | Refus;

export type MethodeIntervalle = "quantile_exact" | "quantile_normal" | "wilson" | "newcombe";

/** Intervalle à 95 %, avec la méthode qui l'a produit (la bulle d'aide la nomme). */
export interface Intervalle {
  bas: number;
  haut: number;
  niveau: 0.95;
  methode: MethodeIntervalle;
}

export function refus(raison: string, manque: Manque): Refus {
  return { ok: false, raison, manque };
}
