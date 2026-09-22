// Déroulé d'une session groupé PAR VUE (F45, plan § 5.12.4) — logique PURE,
// testée (tests/unit/deroule.test.ts), sans accès base.
//
// CE QUE CE MODULE EXISTE POUR CORRIGER. La chronologie de F44 est une liste
// plate : une ligne par événement, dans l'ordre du temps. Sur une session de
// deux pages, cela donne dix-huit lignes dont neuf portent l'étiquette
// « Vital » — et six de ces neuf sont des PHASES RÉSEAU (DNS, TCP, TLS, RTT,
// REQUEST, RESPONSE), qui n'ont aucun seuil publié et ne sont donc pas des Web
// Vitals (`CORE_VITALS`, lib/rating.ts). Un lecteur y cherche « qu'a vu le
// visiteur, et dans quel ordre » et lit à la place le journal d'un navigateur.
//
// LE GROUPEMENT DIT TROIS CHOSES QUE LA LISTE PLATE TAISAIT :
//   1. sur QUELLE page un événement est arrivé — la vue devient un titre, pas
//      une ligne de plus ;
//   2. quel Web Vital qualifie CETTE vue — porté par la vue (pastille), au lieu
//      de flotter entre deux erreurs ;
//   3. ce qu'une action a DÉCLENCHÉ — les effets (`action_id`) sont imbriqués
//      sous leur action, au lieu d'être signalés par un badge « ↳ » qu'il faut
//      relier de l'œil à une ligne plus haut.
//
// CE QU'IL NE DEVINE PAS. Un vital est rattaché à la vue de MÊME ROUTE la plus
// proche avant lui (`rum_metric.route`, projetée dans `detail`), jamais à « la
// vue précédente » : une navigation SPA peut ouvrir /b avant que le LCP de /a
// ne soit rapporté, et l'attribuer à /b ferait mentir la page. Sans route
// connue, le vital reste dans le groupe courant. Un effet dont l'action n'est
// pas dans la chronologie (action tronquée, ou table `rum_action` absente avant
// v67) n'est PAS inventé : il reste une ligne de premier niveau, avec le badge
// causal de `TimelineRow`.
import type { TimelineItem } from "./queries";
import { estFrustration, estWebVital } from "./session-detail";
import { NATURES_CHRONOLOGIE, type NatureChronologie } from "./view-state";

/** Une action et ce qu'elle a déclenché (lignes portant le même `action_id`). */
export interface ActionEtEffets {
  action: TimelineItem;
  effets: TimelineItem[];
}

/**
 * Une section du déroulé : une page vue et tout ce qui s'y est passé.
 * `vue: null` = les événements arrivés AVANT la première page vue (ou tous les
 * événements d'une chronologie filtrée qui ne montre plus les vues).
 */
export interface GroupeVue {
  vue: TimelineItem | null;
  /** Web Vitals de la vue (LCP, INP, CLS, FCP, TTFB) — rendus en pastilles. */
  vitals: TimelineItem[];
  /** Phases réseau (DNS, TCP, TLS, RTT…) : pas de seuil, donc repliées. */
  phases: TimelineItem[];
  actions: ActionEtEffets[];
  /** Erreurs, appels API, événements, tâches longues… sans action déclenchante. */
  autres: TimelineItem[];
}

function groupeVide(vue: TimelineItem | null): GroupeVue {
  return { vue, vitals: [], phases: [], actions: [], autres: [] };
}

/**
 * Groupe une chronologie par page vue. L'ordre d'arrivée est conservé dans
 * chaque tiroir ; aucun élément n'est perdu ni dupliqué (test unitaire).
 */
export function grouperParVue(items: readonly TimelineItem[]): GroupeVue[] {
  const groupes: GroupeVue[] = [];
  const parAction = new Map<string, ActionEtEffets>();
  const courant = (): GroupeVue => {
    if (groupes.length === 0) groupes.push(groupeVide(null));
    return groupes[groupes.length - 1];
  };

  for (const item of items) {
    if (item.kind === "pageview") {
      groupes.push(groupeVide(item));
      continue;
    }
    if (item.kind === "vital") {
      // Vue de MÊME ROUTE la plus proche avant lui ; à défaut, la vue courante.
      let cible = courant();
      if (item.detail) {
        for (let i = groupes.length - 1; i >= 0; i--) {
          if (groupes[i].vue?.title === item.detail) {
            cible = groupes[i];
            break;
          }
        }
      }
      (estWebVital(item) ? cible.vitals : cible.phases).push(item);
      continue;
    }
    if (item.kind === "action") {
      const entree: ActionEtEffets = { action: item, effets: [] };
      courant().actions.push(entree);
      if (item.action_id) parAction.set(item.action_id, entree);
      continue;
    }
    const cause = item.action_id ? parAction.get(item.action_id) : undefined;
    if (cause) cause.effets.push(item);
    else courant().autres.push(item);
  }
  return groupes;
}

/** Élément de premier niveau d'un groupe : une action (avec ses effets) ou une ligne seule. */
export type ElementGroupe =
  | { type: "action"; entree: ActionEtEffets }
  | { type: "ligne"; item: TimelineItem };

/**
 * Actions et lignes seules d'un groupe, REMISES dans l'ordre du temps — même
 * ordre que la lecture SQL (`order by ts, action d'abord au même instant`), pour
 * qu'une action et l'erreur qu'elle précède d'une milliseconde ne s'inversent pas.
 */
export function elementsDuGroupe(g: GroupeVue): ElementGroupe[] {
  const elements: ElementGroupe[] = [
    ...g.actions.map((entree): ElementGroupe => ({ type: "action", entree })),
    ...g.autres.map((item): ElementGroupe => ({ type: "ligne", item })),
  ];
  const instant = (e: ElementGroupe) =>
    new Date(e.type === "action" ? e.entree.action.ts : e.item.ts).getTime();
  return elements
    .map((e, rang) => ({ e, rang }))
    .sort((a, b) => {
      const dt = instant(a.e) - instant(b.e);
      if (dt !== 0) return dt;
      const prio = (x: ElementGroupe) => (x.type === "action" ? 0 : 1);
      return prio(a.e) - prio(b.e) || a.rang - b.rang;
    })
    .map(({ e }) => e);
}

/**
 * Nature d'une ligne, au sens du paramètre `voir` (§ 3.1, `NATURES_CHRONOLOGIE`).
 *
 * UN VITAL EST UNE « VUE ». Il n'a pas de nature à lui : il est RENDU sur la
 * ligne de sa vue (pastille) ou dans le tiroir des phases réseau. Lui donner sa
 * propre nature obligerait à cocher deux cases pour voir une vue complète, et
 * `voir=vue` afficherait des vues sans leur LCP. Un fil d'Ariane (`breadcrumb`)
 * est rangé avec les événements : c'est ce qu'il est, une trace applicative.
 */
export function natureDe(item: Pick<TimelineItem, "kind" | "title">): NatureChronologie {
  switch (item.kind) {
    case "pageview":
    case "vital":
      return "vue";
    case "action":
      return "action";
    case "error":
      return "erreur";
    case "api":
      return "api";
    case "resource":
      return "ressource";
    case "longtask":
      return "tache";
    default:
      return estFrustration(item) ? "frustration" : "evenement";
  }
}

/** `voir` absent ou complet = tout ; sinon, seules les natures demandées. */
export function filtrerParNature(
  items: readonly TimelineItem[],
  voir: readonly NatureChronologie[] | null,
): TimelineItem[] {
  if (voir === null || voir.length === 0 || voir.length === NATURES_CHRONOLOGIE.length) return [...items];
  return items.filter((it) => voir.includes(natureDe(it)));
}

/** Libellés des natures, pour la barre de filtres du Déroulé. */
export const LIBELLES_NATURES: Record<NatureChronologie, string> = {
  vue: "Pages vues",
  action: "Actions",
  erreur: "Erreurs",
  api: "Appels API",
  frustration: "Frustration",
  ressource: "Ressources",
  tache: "Tâches longues",
  evenement: "Événements",
};
