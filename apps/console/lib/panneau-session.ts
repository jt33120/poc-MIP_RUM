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
//     session (du début à la dernière observation).
import type { ElementCascade, PisteCascade, TonCascade } from "@/components/charts/Cascade";
import { grouperParVue } from "./deroule";
import type { TimelineItem } from "./queries";
import { LIMITE_CHRONOLOGIE } from "./recit-session";
import { statutAppel } from "./session-detail";

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

/** Pistes de la cascade d'une session (§ 5.12.4), dans l'ordre d'affichage. */
export const PISTES_SESSION: PisteCascade[] = [
  { cle: "vues", libelle: "Pages vues" },
  { cle: "actions", libelle: "Actions" },
  { cle: "api", libelle: "Appels API" },
  { cle: "ressources", libelle: "Ressources liées" },
  { cle: "taches", libelle: "Tâches longues" },
  { cle: "erreurs", libelle: "Erreurs" },
];

/**
 * La collecte des ressources est VOLONTAIREMENT partielle, et la cascade le dit en
 * tête : la chronologie ne lit que celles rattachées à une action (`sessionTimeline`,
 * lib/queries.ts), et le SDK n'émet que les lentes (300 ms par défaut,
 * `DEFAULT_SLOW_RESOURCE_MS`) ou bloquant le rendu, 20 par page au plus
 * (`RESOURCE_CAP_PER_PAGE`, packages/rum-sdk/src/resources.ts).
 */
export const PARTIEL_RESSOURCES =
  "ressources rattachées à une action seulement, lentes (300 ms et plus par défaut) ou bloquant le rendu, 20 par vue au plus";

export interface CascadeDeSession {
  totalMs: number;
  pistes: PisteCascade[];
  elements: ElementCascade[];
  partiel: string;
}

const ms = (d: Date | string) => new Date(d).getTime();

/** Une durée lue en base (float, parfois `numeric` rendu en chaîne) ; illisible ou négative → `null`. */
function duree(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Chronologie → éléments de la cascade de la session, sur l'axe [début ; dernière
 * observation]. Les pages vues sont des BARRES « jusqu'à la vue suivante » (la
 * dernière, jusqu'à la dernière observation) — pas une « durée de vue », que le
 * schéma refuse de calculer ; actions et erreurs sont des INSTANTS. Les mesures
 * (vitals, phases), les événements métier et le fil d'Ariane ne sont pas placés :
 * le déroulé les porte.
 *
 * LA COULEUR DIT LA SÉVÉRITÉ, PAS LA NATURE : une erreur et un appel en échec
 * (statut 400 ou plus, ou réseau) sont « erreur » ; tout le reste est neutre —
 * aucune tâche longue ni ressource n'a de seuil publié qui la rendrait « mauvaise ».
 */
export function cascadeDeSession(
  items: readonly TimelineItem[],
  debut: Date | string,
  fin: Date | string,
  tronquee = items.length >= LIMITE_CHRONOLOGIE,
): CascadeDeSession {
  const t0 = ms(debut);
  const tFin = ms(fin);
  const decale = (ts: Date) => ms(ts) - t0;
  const vues = items.filter((it) => it.kind === "pageview");
  const elements: ElementCascade[] = [];

  items.forEach((it, i) => {
    const id = `${it.kind}-${i}`;
    const debutMs = decale(it.ts);
    const element = (piste: string, libelle: string, dureeMs: number | null, ton: TonCascade, detail?: string) =>
      elements.push({ id, piste, libelle, debutMs, dureeMs, ton, ...(detail ? { detail } : {}) });

    switch (it.kind) {
      case "pageview": {
        const rang = vues.indexOf(it);
        const suivante = vues[rang + 1];
        const jusque = suivante ? ms(suivante.ts) : tFin;
        element(
          "vues",
          it.title ?? "Route inconnue",
          Math.max(0, jusque - ms(it.ts)),
          "neutre",
          suivante ? "jusqu'à la vue suivante" : "jusqu'à la dernière observation",
        );
        break;
      }
      case "action":
        element("actions", it.title ?? "Action", null, "neutre", it.detail ?? undefined);
        break;
      case "api": {
        const d = duree(it.value);
        const { statut } = statutAppel(it.detail);
        element(
          "api",
          it.title ?? "Appel",
          d,
          it.rating === "poor" ? "erreur" : "neutre",
          d === null ? `${statut} · durée non mesurée` : statut,
        );
        break;
      }
      case "resource":
        element("ressources", it.detail ?? it.title ?? "Ressource", duree(it.value), "neutre", it.title ?? undefined);
        break;
      case "longtask":
        element("taches", it.title ?? "Tâche longue", duree(it.value), "neutre", it.detail || undefined);
        break;
      case "error": {
        const occurrences = duree(it.value);
        element(
          "erreurs",
          it.title ?? "Erreur",
          null,
          "erreur",
          occurrences !== null && occurrences > 1 ? `${occurrences.toLocaleString("fr-FR")} occurrences` : undefined,
        );
        break;
      }
      default:
        break;
    }
  });

  return {
    totalMs: Math.max(0, tFin - t0),
    pistes: PISTES_SESSION,
    elements,
    partiel: tronquee
      ? `${PARTIEL_RESSOURCES} ; chronologie lue limitée à ${LIMITE_CHRONOLOGIE} événements : la suite de la session n'est pas placée`
      : PARTIEL_RESSOURCES,
  };
}
