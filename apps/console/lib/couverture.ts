// Le document de couverture (docs/RUM_PARITY_STATUS.md), lisible par le code.
//
// RÈGLE DE LA VITRINE : rien sur le site ne dépasse ce document. Chaque chiffre de
// couverture (nombre de capacités, de déployées, date et SHA du relevé, nombres de
// tests) est CALCULÉ ici depuis l'extraction versionnée, jamais tapé dans un
// `.tsx` : un nouveau relevé met la vitrine à jour au build suivant.
//
// Le JSON est produit par `node scripts/couverture-extraire.mjs`, et
// `tests/unit/couverture-site.test.ts` échoue s'il n'est plus l'extraction du
// document. Même principe que le poids du SDK (lib/sdk-poids.ts) : une valeur
// affichée est remesurée, pas recopiée.
import donnees from "./couverture.generated.json";

/** Les sept verdicts du § 1 du document. `deploye_non_eprouve` est le meilleur. */
export type Verdict =
  | "deploye_non_eprouve"
  | "livre_non_deploye"
  | "livre_avec_defaut_connu"
  | "en_revue"
  | "bloque_acces_externe"
  | "non_retenu"
  | "non_commence";

export const VERDICTS: readonly Verdict[] = [
  "deploye_non_eprouve",
  "livre_non_deploye",
  "livre_avec_defaut_connu",
  "en_revue",
  "bloque_acces_externe",
  "non_retenu",
  "non_commence",
];

/** Libellé affiché d'un verdict : le mot du document, en français courant. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  deploye_non_eprouve: "Déployé, non éprouvé",
  livre_non_deploye: "Livré, non déployé",
  livre_avec_defaut_connu: "Livré avec un défaut connu",
  en_revue: "En revue",
  bloque_acces_externe: "Bloqué par un accès externe",
  non_retenu: "Non retenu",
  non_commence: "Non commencé",
};

export interface Capacite {
  /** Identifiant de la ligne : « A1 » … « F3 ». */
  id: string;
  /** Titre de la sous-section « ### 4.x » qui la porte. */
  famille: string;
  capacite: string;
  verdict: Verdict;
  /** Cellule « Preuve », en Markdown brut. */
  preuve: string;
  /** Cellule « Limite », en Markdown brut. */
  limite: string;
  /** Numéro de ligne dans le document : une source citée par numéro s'y résout. */
  ligne: number;
}

export const DOCUMENT_COUVERTURE: string = donnees.source;
/** Date du relevé, « JJ/MM/AAAA ». */
export const RELEVE: string = donnees.releve;
/** Commit relevé. */
export const SHA: string = donnees.sha;
/** Tests unitaires comptés par le relevé — pas par le dépôt d'aujourd'hui. */
export const TESTS_UNITAIRES: { fichiers: number; tests: number } = donnees.testsUnitaires;
/**
 * Tests SQL comptés par le relevé : le total, et dont ignorés — les deux bancs, qui
 * lisent une base préparée à part (§ 8.2 du document). Un ignoré n'a pas été joué :
 * il n'est pas vert.
 */
export const TESTS_SQL: {
  fichiers: number;
  tests: number;
  ignores: { fichiers: number; tests: number };
} = donnees.testsSql;
/**
 * Tests SQL joués et verts au relevé : le total moins les ignorés, deux nombres LUS
 * dans le document (l'extraction échoue si la suite n'y est pas dite verte).
 */
export const TESTS_SQL_VERTS: number = TESTS_SQL.tests - TESTS_SQL.ignores.tests;

export const CAPACITES: readonly Capacite[] = donnees.capacites as Capacite[];

/** Nombre de capacités portant ce verdict. */
export function compte(verdict: Verdict): number {
  return CAPACITES.filter((c) => c.verdict === verdict).length;
}

/** Les capacités par famille, dans l'ordre du document. */
export function parFamille(): { famille: string; capacites: Capacite[] }[] {
  return donnees.familles.map((famille) => ({
    famille,
    capacites: CAPACITES.filter((c) => c.famille === famille),
  }));
}

export function capaciteParId(id: string): Capacite | undefined {
  return CAPACITES.find((c) => c.id === id);
}
