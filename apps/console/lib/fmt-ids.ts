// Formats d'affichage NOMMÉS (F03, plan § 4.0) — un identifiant en chaîne, jamais
// une fonction.
//
// POURQUOI DES IDENTIFIANTS. Un composant client (`recharts`) reçoit ses props
// sérialisées depuis le serveur : une fonction de format passée en prop fait planter
// la page (« Functions cannot be passed to Client Components » — la panne de
// /forecast, § 5.20.0). Un `FormatId` passe la frontière ; `formater` est appelé
// de chaque côté.
//
// POURQUOI PAS `fmtVital`. Il écrit « 2,70 s » et un CLS « 0.031 » (point
// décimal) : les écrans existants gardent leur rendu, les composants de F03
// écrivent « 2,7 s » et « 0,031 ». Les deux cohabitent jusqu'à la migration des
// écrans, lot par lot.
//
// RÈGLES DE VÉRITÉ (V3). `null` → « — », jamais « 0 » : l'inconnu ne se chiffre
// pas. Un nombre non fini (division par zéro) est un inconnu, pas un infini.
// Un ratio n'est pas une part : `ratio` et `pour100` n'écrivent jamais « % ».

export type FormatId =
  | "ms" // 820 → « 820 ms » ; 2 700 → « 2,7 s »
  | "s-auto" // durée en ms : 372 000 → « 6 min 12 s »
  | "cls" // 0,0312 → « 0,031 »
  | "pct" // part 0..1 : 0,124 → « 12,4 % »
  | "count" // 1240 → « 1 240 »
  | "bytes" // 18 432 → « 18 Ko »
  | "score" // 0..100 → « 72 »
  | "ratio" // 3 → « 3,00 » (deux décimales ; un ratio n'est pas une part)
  | "pour100"; // 150 → « 150 pour 100 » ; 2,43 → « 2,4 pour 100 » ; jamais « % »

export type VitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";

/** Les cinq Web Vitals, dans l'ordre des rangées de tuiles. */
export const VITAUX: readonly VitalName[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];

export function estVital(nom: string): nom is VitalName {
  return (VITAUX as readonly string[]).includes(nom);
}

/** Le format d'un vital : le CLS est sans unité, les autres sont des durées. */
export function formatDuVital(vital: VitalName): FormatId {
  return vital === "CLS" ? "cls" : "ms";
}

// Espace insécable entre un nombre et son unité : « 2,7 » et « s » ne se séparent
// jamais en fin de ligne dans une tuile étroite. Construite par son code plutôt
// qu'écrite littéralement (invisible à la relecture).
const NBSP = String.fromCharCode(0xa0);

function nombre(v: number, min: number, max: number): string {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max });
}

/** Une durée en ms : « 820 ms » sous la seconde, « 2,7 s » au-delà. */
function duree(ms: number): string {
  const arrondi = Math.round(ms);
  if (Math.abs(arrondi) < 1000) return `${arrondi}${NBSP}ms`;
  return `${nombre(ms / 1000, 1, 1)}${NBSP}s`;
}

/** Une durée longue, en unités lisibles : « 45 s », « 6 min 12 s », « 2 h 5 min ». */
function dureeAuto(ms: number): string {
  const signe = ms < 0 ? "−" : "";
  const v = Math.abs(ms);
  if (v < 1000) return `${signe}${Math.round(v)}${NBSP}ms`;
  if (v < 60_000) return `${signe}${nombre(v / 1000, 0, 1)}${NBSP}s`;
  if (v < 3_600_000) {
    const secondes = Math.round(v / 1000);
    const min = Math.floor(secondes / 60);
    const s = secondes % 60;
    return s === 0 ? `${signe}${min}${NBSP}min` : `${signe}${min}${NBSP}min ${s}${NBSP}s`;
  }
  const minutes = Math.round(v / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${signe}${h}${NBSP}h` : `${signe}${h}${NBSP}h ${m}${NBSP}min`;
}

const UNITES_OCTETS = ["Ko", "Mo", "Go", "To"] as const;

/** Octets en base 1 024 : « 512 o », « 1,5 Ko », « 18 Ko », « 2,3 Mo ». */
function octets(v: number): string {
  if (Math.abs(v) < 1024) return `${nombre(v, 0, 0)}${NBSP}o`;
  let x = v / 1024;
  let i = 0;
  while (Math.abs(x) >= 1024 && i < UNITES_OCTETS.length - 1) {
    x /= 1024;
    i++;
  }
  return `${nombre(x, 0, Math.abs(x) < 10 ? 1 : 0)}${NBSP}${UNITES_OCTETS[i]}`;
}

/** Une valeur, dans son format nommé. `null` (ou non fini) → « — ». */
export function formater(id: FormatId, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (id) {
    case "ms":
      return duree(v);
    case "s-auto":
      return dureeAuto(v);
    case "cls":
      return nombre(v, 3, 3);
    case "pct":
      return `${nombre(v * 100, 1, 1)}${NBSP}%`;
    case "count":
      return nombre(v, 0, 0);
    case "bytes":
      return octets(v);
    case "score":
      return nombre(v, 0, 0);
    case "ratio":
      return nombre(v, 2, 2);
    case "pour100":
      return `${nombre(v, 0, 1)}${NBSP}pour${NBSP}100`;
  }
}

/**
 * La référence d'une comparaison, telle qu'elle s'écrit après un delta :
 * « vs 24 h précédentes (…) ». Accepte le texte avec ou sans son « vs » (le plan
 * écrit les deux : `KpiTile.reference` le porte, `DeltaBadge.reference` non) —
 * jamais « vs vs ».
 */
export function libelleReference(reference: string): string {
  const t = reference.trim();
  return /^vs\s/i.test(t) ? t : `vs ${t}`;
}

/** La référence sans son « vs », pour une phrase : « pas de mesure sur 24 h précédentes ». */
export function referenceSansVs(reference: string): string {
  return reference.trim().replace(/^vs\s+/i, "");
}
