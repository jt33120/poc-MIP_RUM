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
import { hrefWithQuery, type AnalyticsQuery, type RangePreset } from "./query-contract";

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

/**
 * Le seul geste utile devant un vide d'usage : élargir à 7 jours (le canal, le
 * formulaire ou la transition ne sont pas des filtres à retirer). Une plage
 * personnalisée est remplacée, jamais combinée avec `period` (refus
 * `range_conflict`). Déjà sur 7 jours : aucun geste.
 */
export function gesteElargir(pathname: string, query: AnalyticsQuery): { libelle: string; href: string } | undefined {
  if (query.range.preset === "7d") return undefined;
  return { libelle: "Élargir à 7 jours", href: hrefWithQuery(pathname, query, { period: "7d", from: null, to: null }) };
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
