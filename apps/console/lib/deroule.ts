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

// ═══════════════════ F46 — cascade de la session et Web Vitals situés ═══════════════════
//
// TROIS FONCTIONS PURES, qui lisent la même chronologie que le déroulé.
//
//   · `cascadeDeSession` place la chronologie sur l'axe de `Cascade` (F07). Une
//     page vue y est une BARRE « jusqu'à la vue suivante », jamais une « durée de
//     vue » : la console ne sait pas combien de temps le visiteur a regardé la
//     page (le temps passé est refusé, `lib/analytics-schema.ts`), elle sait
//     seulement quand la suivante s'est ouverte. La dernière vue s'étend jusqu'à
//     la dernière observation de la session — et le dit, dans le détail de sa
//     barre. Une chronologie tronquée ne connaît pas sa fin : la dernière vue
//     s'arrête alors au dernier événement lu, et le dit aussi.
//   · `vitauxDeSession` rend une ligne par vue et la PIRE mesure de chaque Web
//     Vital : c'est elle qu'on situe dans la population de sa route.
//   · `fenetreDeSession` rend la fenêtre de cette population, ANCRÉE SUR LA
//     SESSION (§ 3.5, exception déclarée) et non sur l'instant de lecture : une
//     session d'il y a trois semaines comparée aux « 7 derniers jours » le serait
//     à une population qui ne la contient pas.
import type { ElementCascade, MarqueurCascade, PisteCascade, TonCascade } from "../components/charts/Cascade";
import type { VitalName } from "./fmt-ids";
import { CORE_VITALS } from "./rating";
import { ancreEvenement } from "./recit-session";
import { isoSansMs } from "./series";
import { statutAppel } from "./session-detail";

const JOUR_MS = 86_400_000;

/**
 * Fenêtre où situer une mesure de la session (§ 3.5) :
 * `[début − 7 j, min(début + 1 j, maintenant))`, en UTC, à la seconde. Le jour qui
 * suit le début est inclus pour qu'une session à cheval sur minuit s'y retrouve ;
 * la borne haute ne dépasse jamais l'heure du serveur (le contrat refuserait
 * `range_in_future`, `lib/query-contract.ts`). Huit jours au plus : sous la
 * limite de 30 jours d'une plage personnalisée.
 */
export function fenetreDeSession(startedAtMs: number, nowMs: number): { from: string; to: string } {
  return {
    from: isoSansMs(startedAtMs - 7 * JOUR_MS),
    to: isoSansMs(Math.min(startedAtMs + JOUR_MS, nowMs)),
  };
}

/** « 03/09 » : jour et mois d'un instant, en UTC. */
export function jourMoisUtc(instant: string | number): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" }).format(new Date(instant));
}

/** « du 03/09 au 11/09 » : les bornes d'une fenêtre, jour et mois en UTC (`to` est exclu). */
export function libelleFenetre(from: string, to: string): string {
  return `du ${jourMoisUtc(from)} au ${jourMoisUtc(to)}`;
}

/**
 * La cascade est PARTIELLE par construction, et le dit en tête (§ 5.12.4) : la
 * chronologie ne lit que les ressources rattachées à une action, et le SDK
 * n'envoie que celles qui dépassent son seuil de lenteur ou bloquent le rendu,
 * au plus vingt par page (`packages/rum-sdk/src/resources.ts`, vérifié par test).
 */
export const PARTIEL_CASCADE =
  "ressources rattachées à une action seulement ; le SDK n'envoie que celles de 300 ms ou plus (seuil par défaut) ou qui bloquent le rendu, 20 par page au plus";

/** Pistes de la cascade d'une session (§ 5.12.4), dans l'ordre du dessin. */
export const PISTES_SESSION: PisteCascade[] = [
  { cle: "vues", libelle: "Pages vues" },
  { cle: "actions", libelle: "Actions" },
  { cle: "api", libelle: "Appels API" },
  { cle: "ressources", libelle: "Ressources liées" },
  { cle: "taches", libelle: "Tâches longues" },
  { cle: "erreurs", libelle: "Erreurs" },
];

/** Ce que mesure la barre d'une vue : l'écart jusqu'à la suivante, pas un temps de lecture. */
export const VUE_JUSQU_A_SUIVANTE = "jusqu'à la vue suivante";
/** La dernière vue s'arrête à la dernière observation de la session. */
export const VUE_JUSQU_A_LA_FIN = "jusqu'à la dernière observation de la session";
/** Chronologie tronquée : la suite n'est pas lue, la fin de la dernière vue non plus. */
export const VUE_FIN_INCONNUE = "fin inconnue : chronologie tronquée, arrêtée au dernier événement lu";

/**
 * Sévérité d'un appel d'après son statut, lu en tête du détail (« 500 · serveur
 * 45 ms ») — la règle du détail de trace (F07) : 5xx = erreur, 4xx = à surveiller,
 * le reste sans alerte. Le statut 0 est un appel qui n'a pas abouti (réseau) : une
 * erreur. Une durée n'a pas de seuil publié : elle ne colore rien (R-S).
 */
export function tonAppel(detail: string | null): TonCascade {
  const tete = (detail ?? "").split(" · ")[0];
  if (!/^\d+$/.test(tete)) return "neutre";
  const statut = Number(tete);
  if (statut === 0 || statut >= 500) return "erreur";
  return statut >= 400 ? "warn" : "neutre";
}

export interface CascadeSession {
  /** Longueur de l'axe : de l'ouverture à la dernière observation. */
  totalMs: number;
  elements: ElementCascade[];
  /** Repères FCP / LCP des vues chargées. */
  marqueurs: MarqueurCascade[];
}

/** Durée lisible d'une ligne (`value`) : un nombre fini et positif, sinon un instant. */
function dureeDe(v: number | null): number | null {
  const n = v == null ? Number.NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Chemin d'une URL de ressource, sans son origine (l'hôte reste dans l'alternative). */
function cheminDe(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\/[^/]+/, "") || url;
}

/**
 * La chronologie sur l'axe de `Cascade` : pistes Pages vues (barres jusqu'à la vue
 * suivante), Actions (instants), Appels API (durée navigateur, ton = statut),
 * Ressources liées, Tâches longues (barres), Erreurs (instants). Un effet est
 * l'ENFANT de son action (`action_id`), comme dans le déroulé ; un effet dont
 * l'action n'a pas été lue reste une racine. Chaque élément garde l'ancre de sa
 * ligne (`evt-<rang>`) et le lien que la chronologie lui donne (`liens`).
 *
 * Repères : le FCP et le LCP d'une vue CHARGÉE, à son ouverture + leur valeur
 * (web-vitals les mesure depuis le début du chargement du document). Une vue
 * « spa » n'a pas de FCP ni de LCP propres : un vital que le groupement lui
 * rattache (même route) appartient au chargement d'origine, il n'est pas placé.
 * Événements, fils d'Ariane, signaux et phases réseau restent dans le déroulé.
 */
export function cascadeDeSession(
  items: readonly TimelineItem[],
  opts: { t0: number; finMs: number; liens?: Record<number, string>; tronquee?: boolean },
): CascadeSession {
  const { t0, finMs, liens = {}, tronquee = false } = opts;
  const instant = (it: TimelineItem) => new Date(it.ts).getTime();
  const debut = (it: TimelineItem) => Math.max(0, instant(it) - t0);
  const actions = new Map<string, string>();
  items.forEach((it, i) => {
    if (it.kind === "action" && it.action_id && !actions.has(it.action_id)) actions.set(it.action_id, ancreEvenement(i));
  });
  const parentDe = (it: TimelineItem) => (it.action_id ? (actions.get(it.action_id) ?? null) : null);
  const vues = items.flatMap((it, i) => (it.kind === "pageview" ? [i] : []));
  const dernierInstant = items.length ? instant(items[items.length - 1]) : t0;

  const elements: ElementCascade[] = [];
  items.forEach((it, i) => {
    const base = { id: ancreEvenement(i), debutMs: debut(it), ...(liens[i] ? { href: liens[i] } : {}) };
    switch (it.kind) {
      case "pageview": {
        const suivante = vues.find((j) => j > i);
        const fin = suivante !== undefined ? instant(items[suivante]) : tronquee ? dernierInstant : finMs;
        const mesure = suivante !== undefined ? VUE_JUSQU_A_SUIVANTE : tronquee ? VUE_FIN_INCONNUE : VUE_JUSQU_A_LA_FIN;
        elements.push({
          ...base,
          piste: "vues",
          libelle: it.title ?? "Route inconnue",
          dureeMs: Math.max(0, fin - instant(it)),
          ton: "neutre",
          detail: [it.detail, mesure].filter(Boolean).join(" · "),
        });
        return;
      }
      case "action": {
        const type = (it.detail ?? "").split(" · ")[0];
        elements.push({
          ...base,
          piste: "actions",
          libelle: it.title ?? it.action_name ?? "Action sans nom",
          dureeMs: null,
          ton: "neutre",
          ...(type ? { detail: type } : {}),
        });
        return;
      }
      case "api": {
        const { statut } = statutAppel(it.detail);
        elements.push({
          ...base,
          piste: "api",
          libelle: it.title ?? "Appel API",
          dureeMs: dureeDe(it.value),
          ton: tonAppel(it.detail),
          parentId: parentDe(it),
          detail: /^\d+$/.test(statut) ? `HTTP ${statut}` : statut === "—" ? "statut inconnu" : statut,
        });
        return;
      }
      case "resource":
        elements.push({
          ...base,
          piste: "ressources",
          libelle: cheminDe(it.detail) ?? it.title ?? "Ressource",
          dureeMs: dureeDe(it.value),
          ton: "neutre",
          parentId: parentDe(it),
          ...(it.title ? { detail: it.title } : {}),
        });
        return;
      case "longtask":
        elements.push({
          ...base,
          piste: "taches",
          libelle: it.title ?? "Tâche longue",
          dureeMs: dureeDe(it.value),
          ton: "neutre",
          parentId: parentDe(it),
        });
        return;
      case "error":
        elements.push({
          ...base,
          piste: "erreurs",
          libelle: it.title ?? "Erreur",
          dureeMs: null,
          ton: "erreur",
          parentId: parentDe(it),
          ...(it.detail ? { detail: it.detail } : {}),
        });
        return;
      default:
        return;
    }
  });

  const marqueurs: MarqueurCascade[] = [];
  for (const g of grouperParVue(items)) {
    if (!g.vue || g.vue.detail === "spa") continue;
    for (const v of g.vitals) {
      if (v.title !== "FCP" && v.title !== "LCP") continue;
      const valeur = dureeDe(v.value);
      if (valeur === null) continue;
      marqueurs.push({
        t: debut(g.vue) + valeur,
        libelle: vues.length > 1 ? `${v.title} ${g.vue.title ?? "route inconnue"}` : v.title,
        vital: v.title,
        valeur,
      });
    }
  }

  return { totalMs: Math.max(0, finMs - t0), elements, marqueurs };
}

/** Une mesure de Web Vital de la session, avec son rang (ancre) et SA route (`rum_metric.route`). */
export interface MesureVital {
  rang: number;
  vital: VitalName;
  valeur: number;
  /** Route de la mesure : celle dont on lit la population. `null` : inconnue. */
  route: string | null;
  ts: Date;
}

/** La pire mesure d'un vital sur un périmètre (une vue, ou la session), et combien il y en a. */
export interface PireMesure {
  pire: MesureVital;
  n: number;
}

/** Une ligne de l'onglet Web Vitals : une vue, et la pire mesure de chaque vital sur elle. */
export interface LigneVitaux {
  /** `null` : mesures reçues avant la première vue. */
  vue: TimelineItem | null;
  rangVue: number | null;
  mesures: Partial<Record<VitalName, PireMesure>>;
}

export interface VitauxSession {
  /** Web Vitals mesurés au moins une fois, dans l'ordre de `CORE_VITALS`. */
  vitaux: VitalName[];
  /** Une ligne par vue (même sans mesure : son absence se lit), plus les mesures sans vue. */
  lignes: LigneVitaux[];
  /** La pire mesure de chaque vital de la session (la plus haute : plus bas vaut mieux). */
  pires: (PireMesure & { vital: VitalName })[];
}

/**
 * Web Vitals de la session, rattachés à leur vue par `grouperParVue` (même route,
 * la plus proche avant). « Pire » = la valeur la plus haute : pour les cinq vitals,
 * plus bas vaut mieux. À égalité, la première reçue. Une mesure sans valeur n'est
 * pas une mesure : elle n'entre ni dans une ligne ni dans un compte.
 */
export function vitauxDeSession(items: readonly TimelineItem[]): VitauxSession {
  const rangs = new Map<TimelineItem, number>();
  items.forEach((it, i) => rangs.set(it, i));
  const garder = (actuel: PireMesure | undefined, m: MesureVital): PireMesure =>
    !actuel ? { pire: m, n: 1 } : { pire: m.valeur > actuel.pire.valeur ? m : actuel.pire, n: actuel.n + 1 };

  const lignes: LigneVitaux[] = [];
  const pires = new Map<VitalName, PireMesure>();
  for (const g of grouperParVue(items)) {
    const ligne: LigneVitaux = { vue: g.vue, rangVue: g.vue ? (rangs.get(g.vue) ?? null) : null, mesures: {} };
    for (const v of g.vitals) {
      const valeur = dureeDe(v.value);
      if (valeur === null || !CORE_VITALS.includes(v.title ?? "")) continue;
      const vital = v.title as VitalName;
      const mesure: MesureVital = { rang: rangs.get(v) ?? -1, vital, valeur, route: v.detail || null, ts: v.ts };
      ligne.mesures[vital] = garder(ligne.mesures[vital], mesure);
      pires.set(vital, garder(pires.get(vital), mesure));
    }
    if (g.vue || Object.keys(ligne.mesures).length > 0) lignes.push(ligne);
  }
  const vitaux = CORE_VITALS.filter((v): v is VitalName => pires.has(v as VitalName));
  return { vitaux, lignes, pires: vitaux.map((vital) => ({ vital, ...pires.get(vital)! })) };
}
