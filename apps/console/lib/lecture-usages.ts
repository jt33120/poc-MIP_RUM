// Écrans d'usage sur le contrat (F53, règles S3 et S4 du plan frontend) — logique
// PURE, sans accès base.
//
// POURQUOI CE MODULE. `/acquisition`, `/paths` et `/forms` lisaient une fenêtre
// glissante à l'heure du serveur : ils écrivaient « 7 derniers jours glissants, lus
// à 14:02 UTC (lecture non migrée…) » pour ne pas se faire passer pour la plage
// `[from, to)` d'un écran voisin (S3, `lib/lecture-historique.ts`, retiré). Depuis
// B31, ils lisent la plage du CONTRAT, comme les autres écrans : la méta écrit son
// libellé (« 24 h », « du 17/09 10:00 au 17/09 12:00 »), et un état vide la cite
// dans une phrase. Reste S4 : tout plafond de lecture atteint est dit à côté du
// chiffre qu'il borne — et, sous `cmp=prev`, il tait l'écart qu'il fausserait.
import type { CouverturePrecedente } from "./comparaison";
import { PRESET_MS, hrefWithQuery, type AnalyticsQuery, type RangePreset } from "./query-contract";

/** La plage d'un preset dans une phrase : « Aucune session sur les dernières 24 h. » */
const PRESET_DANS_PHRASE: Record<RangePreset, string> = {
  "1h": "la dernière heure",
  "24h": "les dernières 24 h",
  "7d": "les 7 derniers jours",
};

/**
 * La plage du contrat dans une phrase. `label` est le libellé de l'écran
 * (`pageFilters(…).label`, dans le fuseau de l'app) : une plage personnalisée
 * s'écrit « la plage du 17/09 10:00 au 17/09 12:00 ».
 */
export function plageDansPhrase(range: { preset: RangePreset | null }, label: string): string {
  return range.preset ? PRESET_DANS_PHRASE[range.preset] : `la plage ${label}`;
}

/** Sept jours, la largeur du geste « Élargir ». */
const SEPT_JOURS_MS = PRESET_MS["7d"];

/**
 * Marge de glissement : « les 7 derniers jours » se relisent AU CLIC, un peu après
 * le rendu. Une plage dont le début frôle la borne de la fenêtre au rendu en
 * sortirait au clic ; elle passe par la fenêtre explicite, qui ne glisse pas.
 */
const MARGE_CLIC_MS = PRESET_MS["1h"];

/**
 * Le seul geste utile devant un vide d'usage : élargir à 7 jours (le canal, le
 * formulaire ou la transition ne sont pas des filtres à retirer).
 *
 * INVARIANT : la fenêtre proposée CONTIENT la plage lue et est plus LONGUE qu'elle.
 * Un « Élargir » qui rétrécit la lecture (plage personnalisée de 26 jours → 7 jours)
 * ou qui la déplace (2 h le 01/09 → les 7 derniers jours, qui ne la contiennent
 * pas) ferait lire autre chose que ce que son nom promet. Donc :
 *   - déjà sur 7 jours, ou plage personnalisée de 7 jours ou plus : aucun geste ;
 *   - preset 1 h / 24 h, ou plage personnalisée comprise dans les 7 derniers jours
 *     (à la marge de glissement près) : `period=7d` — la plage est REMPLACÉE,
 *     jamais combinée avec `period` (refus `range_conflict`) ;
 *   - plage personnalisée plus ancienne : les 7 jours qui finissent à sa fin
 *     (`from = to − 7 j`, `to` gardé), explicites — elle y est contenue, et `to`
 *     reste dans le passé du serveur.
 * `nowMs` : l'instant serveur du rendu.
 */
export function gesteElargir(
  pathname: string,
  query: AnalyticsQuery,
  nowMs: number,
): { libelle: string; href: string } | undefined {
  const { preset } = query.range;
  if (preset === "7d") return undefined;
  const libelle = "Élargir à 7 jours";
  const septDerniersJours = { libelle, href: hrefWithQuery(pathname, query, { period: "7d", from: null, to: null }) };
  // 1 h et 24 h finissent maintenant : les 7 derniers jours les contiennent, au clic aussi.
  if (preset) return septDerniersJours;
  const debut = Date.parse(query.range.from);
  const fin = Date.parse(query.range.to);
  if (fin - debut >= SEPT_JOURS_MS) return undefined;
  if (debut >= nowMs - SEPT_JOURS_MS + MARGE_CLIC_MS) return septDerniersJours;
  return {
    libelle,
    href: hrefWithQuery(pathname, query, { period: null, from: new Date(fin - SEPT_JOURS_MS).toISOString(), to: query.range.to }),
  };
}

/**
 * Un plafond de lecture est-il atteint (S4) ? Une lecture bornée par `limit n`
 * rend au plus n lignes : en rendre n veut dire qu'il pouvait y en avoir plus, et
 * le chiffre porte alors sur une partie seulement de la population. Sous le
 * plafond, rien à dire. Un plafond non positif n'est pas un plafond.
 */
export function plafondAtteint(n: number, plafond: number): boolean {
  return plafond > 0 && n >= plafond;
}

/**
 * Couverture de la période précédente d'une tuile d'usage (`cmp=prev`, F53) : celle
 * de ses sources (rétention, début de collecte, retard d'ingestion — la PREMIÈRE
 * incomplète décide, § 3.2), puis ses plafonds de lecture. Un compte borné par un
 * plafond, d'un côté ou de l'autre, n'est plus un compte de la période : l'écart
 * mesurerait le plafond, pas le site. La tuile se tait alors avec la raison.
 * `undefined` hors `cmp=prev` : ni delta ni raison.
 */
export function couvertureDeTuile(
  sources: readonly CouverturePrecedente[] | undefined,
  plafonds: readonly { atteint: boolean; raison: string }[] = [],
  n: number | null = null,
): CouverturePrecedente | undefined {
  if (!sources) return undefined;
  const incomplete = sources.find((c) => c.etat !== "complete");
  if (incomplete) return { ...incomplete, n };
  const plafond = plafonds.find((p) => p.atteint);
  if (plafond) return { etat: "partielle", raison: plafond.raison, n };
  return { etat: "complete", raison: null, n };
}
