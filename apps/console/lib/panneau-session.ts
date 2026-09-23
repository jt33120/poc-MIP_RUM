// Panneau de session de `/sessions` (F43, plan § 5.11.4 et § 4.3) — logique PURE,
// testée (tests/unit/panneau-session.test.ts), sans accès base.
//
// CE QUE CE MODULE DÉCIDE, ET QUE LE RENDU NE DOIT PAS REDÉCIDER :
//   - le PÉRIMÈTRE : une session s'ouvre en panneau si son app est lue par
//     l'écran (`effectiveApps`, qui porte déjà le périmètre du principal ET
//     l'app demandée) — la même garde que la page de session. Hors périmètre, le
//     panneau ne dit rien de plus qu'une session absente : ni son app, ni son
//     existence ;
//   - PRÉCÉDENT / SUIVANT dans la page de liste AFFICHÉE, et nulle part
//     ailleurs : une session hors de cette page (lien partagé, hero) s'ouvre sans
//     parcours, plutôt qu'avec des voisins inventés ;
//   - les 15 PREMIERS ÉVÉNEMENTS : une mesure (Web Vital, phase réseau) n'est pas
//     un événement — le déroulé la porte en pastille ou en repli sur SA vue ;
//   - la mini-CASCADE : où est passé le temps, piste par piste, sur l'axe de la
//     session (du début à la dernière observation) — la conversion de
//     `lib/deroule.ts`, partagée avec l'onglet Cascade de la page (F46).
import { grouperParVue } from "./deroule";
import type { TimelineItem } from "./queries";

// ─────────────────────────────── Périmètre ───────────────────────────────────

/**
 * La session appartient-elle à ce que l'écran lit ? `null` = toutes les apps (admin
 * transverse) ; une liste = ces apps seulement ; `[]` = aucune (jamais « toutes »).
 */
export function sessionDansLePerimetre(appId: string, effectiveApps: readonly string[] | null): boolean {
  return effectiveApps === null || effectiveApps.includes(appId);
}

/** Ce que l'écran écrit quand un panneau demandé ne s'ouvre pas (plan § 5.11.4). */
export const SESSION_INTROUVABLE = "Session introuvable ou hors périmètre : le panneau ne s'ouvre pas.";

// ─────────────────────────────── Parcours ────────────────────────────────────

/**
 * Voisins d'une session dans la page de liste affichée (ordre de la table). `null`
 * quand la session n'y est pas : pas de liste à parcourir, donc ni « Précédent »
 * ni « Suivant ». En bout de page, le voisin manquant vaut `null` (bouton éteint).
 */
export function voisinsDansLaListe(
  ids: readonly string[],
  id: string,
): { precedent: string | null; suivant: string | null } | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return { precedent: i > 0 ? ids[i - 1] : null, suivant: i < ids.length - 1 ? ids[i + 1] : null };
}

// ─────────────────────────── Premiers événements ─────────────────────────────

/** Événements montrés par le panneau (§ 5.11.4) ; la suite est sur la page de la session. */
export const EVENEMENTS_DU_PANNEAU = 15;

/**
 * Les `n` premiers ÉVÉNEMENTS de la chronologie, et les mesures de LEURS vues.
 *
 * UNE MESURE N'EST PAS UN ÉVÉNEMENT. Un Web Vital est une pastille sur la ligne de
 * sa vue, une phase réseau un repli (« Phases réseau (8) ») : ni l'un ni l'autre
 * n'est une ligne du déroulé. Les compter parmi les quinze laisserait, sur un
 * premier chargement, neuf mesures et six événements.
 *
 * LES MESURES SUIVENT LEUR VUE, PAS L'HORLOGE. Un LCP est souvent rapporté quand
 * l'onglet se masque, bien après les premiers clics : couper au quinzième
 * événement le ferait disparaître de la vue qu'il qualifie. Une vue retenue garde
 * donc toutes ses mesures, rattachées comme au déroulé (`grouperParVue` : vue de
 * même route la plus proche avant la mesure).
 *
 * Rend les lignes retenues DANS L'ORDRE DE LA CHRONOLOGIE (le déroulé les regroupe),
 * le nombre d'événements montrés et le nombre d'événements lus.
 */
export function premiersEvenements(
  items: readonly TimelineItem[],
  n = EVENEMENTS_DU_PANNEAU,
): { items: TimelineItem[]; montres: number; total: number } {
  const evenements = items.filter((it) => it.kind !== "vital");
  const retenus = new Set<TimelineItem>(evenements.slice(0, Math.max(0, n)));
  for (const g of grouperParVue(items)) {
    // Le groupe sans vue (avant la première page vue) ouvre la chronologie : ses
    // mesures précèdent tout événement retenu.
    if (g.vue === null || retenus.has(g.vue)) for (const m of [...g.vitals, ...g.phases]) retenus.add(m);
  }
  return {
    items: items.filter((it) => retenus.has(it)),
    montres: Math.min(evenements.length, Math.max(0, n)),
    total: evenements.length,
  };
}

// ─────────────────────────────── Mini-cascade ────────────────────────────────
//
// UNE SEULE CONVERSION de la chronologie vers `Cascade`, celle de `lib/deroule.ts`
// (F46, plan § 4.4) : le panneau et l'onglet Cascade de la page de session placent
// les mêmes lignes de la même façon. Réexportée ici pour les appelants du panneau.
export {
  PARTIEL_RESSOURCES,
  PISTES_SESSION,
  cascadeDeSession,
  type CascadeDeSession,
} from "./deroule";
