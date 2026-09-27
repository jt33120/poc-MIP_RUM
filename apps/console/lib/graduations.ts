// Graduations d'axe : des pas RONDS, une seule unité par axe (recette du 26/09/2026).
// Logique pure, sans React ni base : importable des deux côtés de la frontière client.
//
// POURQUOI. Les axes étaient gradués par recharts sur un domaine « maximum × 1,1 » :
// 0-70-140-278, 0-1 312, 41,6 %… La dernière graduation était le maximum lui-même,
// pas un pas régulier, et l'œil ne pouvait rien interpoler. Un axe de durée
// mêlait les unités (« 2,8 s / 1,4 s / 700 ms / 0 ms ») : chaque graduation était
// formatée seule. Ici, le haut de l'axe est arrondi VERS LE HAUT à un multiple d'un
// pas rond (1, 2, 2,5 ou 5 × 10ⁿ), l'axe part toujours de 0, et toutes les
// graduations d'un axe partagent la même unité et le même nombre de décimales.
import { formater, type FormatId } from "./fmt-ids";

const NBSP = String.fromCharCode(0xa0);

/** Multiplicateurs « ronds » d'une puissance de dix. */
const RONDS = [1, 2, 2.5, 5] as const;

/**
 * Pas ronds d'une DURÉE longue (format `s-auto`) : une graduation tombe sur une
 * seconde, une minute, une heure ronde — pas sur « 100 000 ms ».
 */
const PAS_DUREE_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000,
  7_200_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000,
] as const;

export interface Graduations {
  /** Haut de l'axe : un multiple du pas, ≥ au maximum reçu. */
  haut: number;
  /** De 0 à `haut`, au pas régulier. */
  valeurs: number[];
}

/** Supprime le bruit de la virgule flottante (0,1 × 3 = 0,30000000000000004). */
function net(v: number): number {
  return Number(v.toPrecision(12));
}

function suite(pas: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_v, i) => net(i * pas));
}

/**
 * Graduations rondes de 0 au maximum. Retient, parmi les pas ronds qui donnent
 * entre 3 et 5 intervalles, celui dont le haut d'axe est le plus bas (le moins
 * d'espace perdu) ; à haut égal, le moins de graduations. `entier` : un compte ne
 * se gradue pas en demi-unités (« 0, 1, 2, 3 », jamais « 0, 0,5, 1 »).
 *
 * Exemples : 278 → 0-100-200-300 ; 1 312 → 0-500-1 000-1 500 ; 0,416 → 0-0,1-…-0,5 ;
 * 3 (compte) → 0-1-2-3 ; 2 750 → 0-1 000-2 000-3 000.
 */
export function graduationsY(
  maxBrut: number,
  { entier = false, pas: pasImposes }: { entier?: boolean; pas?: readonly number[] } = {},
): Graduations {
  if (!Number.isFinite(maxBrut) || maxBrut <= 0) {
    return entier ? { haut: 1, valeurs: [0, 1] } : { haut: 1, valeurs: [0, 0.5, 1] };
  }
  // Un petit compte se gradue unité par unité : « 0, 1, 2, 3 », sans trou.
  if (entier && maxBrut <= 5) {
    const haut = Math.max(1, Math.ceil(maxBrut - 1e-9));
    return { haut, valeurs: suite(1, haut) };
  }
  const candidats: number[] = pasImposes ? [...pasImposes] : [];
  if (!pasImposes || maxBrut < pasImposes[0] * 3) {
    const e = Math.floor(Math.log10(maxBrut / 5));
    for (let k = e - 1; k <= e + 2; k++) for (const r of RONDS) candidats.push(net(r * 10 ** k));
  }
  let meilleur: { pas: number; n: number; haut: number; decimales: number } | null = null;
  for (const pas of candidats) {
    if (entier && (pas < 1 || !Number.isInteger(pas))) continue;
    const n = Math.max(1, Math.ceil(maxBrut / pas - 1e-9));
    if (n < 3 || n > 5) continue;
    const haut = net(n * pas);
    // À haut égal : le pas qui n'ajoute pas de décimale (0-2-4-6-8-10 plutôt que
    // 0-2,5-5-7,5-10), puis le moins de graduations.
    const decimales = decimalesCommunes([pas], 6);
    const mieux =
      !meilleur ||
      haut < meilleur.haut - 1e-12 ||
      (Math.abs(haut - meilleur.haut) <= 1e-12 &&
        (decimales < meilleur.decimales || (decimales === meilleur.decimales && n < meilleur.n)));
    if (mieux) meilleur = { pas, n, haut, decimales };
  }
  if (!meilleur) {
    // Filet : le plus petit pas rond qui tient en 5 intervalles.
    const pas = candidats.filter((p) => !entier || (p >= 1 && Number.isInteger(p))).sort((a, b) => a - b).find((p) => maxBrut / p <= 5) ?? maxBrut;
    const n = Math.max(1, Math.ceil(maxBrut / pas - 1e-9));
    meilleur = { pas, n, haut: net(n * pas), decimales: 0 };
  }
  return { haut: meilleur.haut, valeurs: suite(meilleur.pas, meilleur.n) };
}

/** Les graduations d'un axe dans un format nommé : un compte est entier, une durée longue tombe sur des minutes rondes. */
export function graduationsAxe(maxBrut: number, format: FormatId): Graduations {
  if (format === "count") return graduationsY(maxBrut, { entier: true });
  if (format === "s-auto" && maxBrut >= 3_000) return graduationsY(maxBrut, { pas: PAS_DUREE_MS });
  return graduationsY(maxBrut);
}

/**
 * Le moins de décimales qui écrit EXACTEMENT chaque valeur (au plus `max`) : 0-1-2-3
 * n'en prend aucune, 0-0,5-1-1,5 une, pour toutes les graduations de l'axe.
 */
export function decimalesCommunes(valeurs: readonly number[], max: number): number {
  for (let d = 0; d < max; d++) {
    const f = 10 ** d;
    if (valeurs.every((v) => Math.abs(v * f - Math.round(v * f)) < 1e-6)) return d;
  }
  return max;
}

function nombre(v: number, d: number): string {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/**
 * Les étiquettes d'un axe, TOUTES dans la même unité et avec la même précision.
 *
 *   - durée (`ms`) : en secondes dès que l'axe atteint 1 s (« 0 s, 1 s, 2 s, 3 s »,
 *     « 0,0 s, 0,5 s, 1,0 s »), en millisecondes sinon ;
 *   - durée longue (`s-auto`) : l'unité du haut de l'axe (s, min ou h) ;
 *   - part (`pct`) : « 0 %, 10 %, 20 % » ;
 *   - compte : en milliers (« k ») pour tout l'axe dès 10 000 ;
 *   - CLS, ratio, pour 100, score : nombre à la française, décimales communes.
 */
export function etiquettesGraduations(valeurs: readonly number[], format: FormatId): string[] {
  if (valeurs.length === 0) return [];
  const max = Math.max(...valeurs.map((v) => Math.abs(v)));
  const avecUnite = (diviseur: number, unite: string, maxDecimales: number) => {
    const d = decimalesCommunes(
      valeurs.map((v) => v / diviseur),
      maxDecimales,
    );
    return valeurs.map((v) => `${nombre(v / diviseur, d)}${unite ? `${NBSP}${unite}` : ""}`);
  };
  switch (format) {
    case "ms":
      return max >= 1000 ? avecUnite(1000, "s", 2) : avecUnite(1, "ms", 1);
    case "s-auto":
      if (max >= 3_600_000) return avecUnite(3_600_000, "h", 1);
      if (max >= 60_000) return avecUnite(60_000, "min", 1);
      if (max >= 1000) return avecUnite(1000, "s", 1);
      return avecUnite(1, "ms", 0);
    case "pct":
      return avecUnite(0.01, "%", 1);
    case "count":
      return max >= 10_000 ? avecUnite(1000, "k", 1) : avecUnite(1, "", 0);
    case "cls":
      return avecUnite(1, "", 3);
    case "ratio":
    case "pour100":
    case "score":
      return avecUnite(1, "", 2);
    case "bytes":
      return valeurs.map((v) => formater("bytes", v));
  }
}
