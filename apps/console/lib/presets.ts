// Vues préréglées (F08, plan § 3.6, P13) et choix des releases comparées (§ 3.2) —
// logique PURE, testée, sans accès base.
//
// Une vue préréglée est une question déjà posée, en un clic : « Mobile »,
// « Dernière release », « Mobile • Chrome • /checkout ». Trois règles la tiennent :
//
//   1. UNE VUE NE CHANGE QUE LA POPULATION. Ses paramètres sont ceux du contrat
//      (`CONTRACT_PARAMS`), `cmp` et son couple `rel_a` / `rel_b`, rien d'autre : « Mobile » pose
//      `device=mobile` et laisse la plage, l'app, le segment et la comparaison tels
//      quels. Un paramètre hors de cette liste est une faute de programmation : il
//      lève (`verifierParams`), il n'est pas filtré en silence.
//   2. UNE VUE INCALCULABLE EST DITE, PAS CACHÉE. « Dernière release » sans release
//      sur la fenêtre est affichée désactivée, avec sa raison.
//   3. LE NOM EST LA SOMME DES FACETTES, jointes par « • » (IP-Label « EU • Mobile •
//      Checkout ») : le nom d'une vue dit ce qu'elle filtre.
//
// Les vues mobiles (`p:ios`, `p:android`, `p:mobile-derniere-release`) sont
// ajoutées par F38 ; ce module n'en pose pas.
import {
  CONTRACT_PARAMS,
  DIMENSION_LABELS,
  PARAM_DIMENSIONS,
  parseSegmentParam,
  serializeSegments,
  type FilterCondition,
  type ParamReader,
  type SavedSegment,
} from "./query-contract";
// Types seulement depuis queries-deploys (effacés à la compilation) : ce module est
// chargé par un composant client, il ne doit pas tirer `pg` dans le navigateur.
import type { DeployRow, VersionRow } from "./queries-deploys";
import { classerParGravite, SEUIL_ECHANTILLON_FAIBLE } from "./impact";
import { SANS_RELEASE } from "./releases";

// ─────────────────────────────── Type d'une vue ───────────────────────────────

export interface VuePrereglee {
  /** `p:<clé>` (vue produit) ou `u:<index>` (vue personnelle) — forme de `lireVue`. */
  id: string;
  /** Facettes jointes par « • ». */
  libelle: string;
  origine: "produit" | "personnelle";
  /** Seuls `CONTRACT_PARAMS`, `cmp`, `rel_a`, `rel_b` ; `null` retire le paramètre de l'URL. */
  params: Record<string, string | null>;
  /** Raison : la vue est affichée désactivée. */
  indisponible?: string;
}

/**
 * Paramètres qu'une vue a le droit de poser (P13) : le contrat et la comparaison.
 * `rel_a` / `rel_b` voyagent avec `cmp` (`VIEW_CONTEXT_PARAMS`) : une vue qui règle
 * `cmp` doit pouvoir les poser ou les retirer, sinon un couple hérité d'un lien
 * d'annotation survivrait à la vue.
 */
export const PARAMS_DE_VUE: readonly string[] = [...CONTRACT_PARAMS, "cmp", "rel_a", "rel_b"];

/**
 * Paramètres d'une page de résultats : changer la population les invalide (même
 * règle que `SegmentBar`). Ce ne sont pas des filtres : les retirer ne change pas la
 * population, et garder un curseur d'une autre population sauterait des lignes.
 */
export const PARAMS_DE_PAGINATION = ["cursor", "offset"] as const;

/** Lève si une vue pose un paramètre hors du contrat : c'est une faute, pas une donnée. */
export function verifierParams(params: Record<string, string | null>): void {
  for (const cle of Object.keys(params)) {
    if (!PARAMS_DE_VUE.includes(cle)) {
      throw new Error(`vue préréglée : paramètre « ${cle} » hors du contrat (seuls CONTRACT_PARAMS, cmp, rel_a et rel_b)`);
    }
  }
}

// ─────────────────────────────── Nommage ───────────────────────────────

export const SEPARATEUR_FACETTES = " • ";

/** « Mobile • Chrome • /checkout » : facettes non vides, jointes par « • ». */
export function nommerVue(facettes: readonly (string | null | undefined)[]): string {
  return facettes
    .map((f) => f?.trim())
    .filter((f): f is string => !!f)
    .join(SEPARATEUR_FACETTES);
}

const APPAREILS: Record<string, string> = { mobile: "Mobile", desktop: "Desktop", tablet: "Tablette" };

/**
 * Facette d'une condition : la VALEUR seule pour une égalité (« Mobile », « Chrome »,
 * « /checkout »), la dimension nommée sinon (« Navigateur ≠ Chrome », « Pays estimé
 * inconnu ») — une exclusion écrite comme une valeur se lirait à l'envers.
 */
export function facette(condition: FilterCondition): string {
  const dimension = DIMENSION_LABELS[condition.dimension];
  if (condition.operator === "is_null") return `${dimension} inconnu`;
  const valeur = condition.dimension === "device" ? (APPAREILS[condition.value ?? ""] ?? condition.value) : condition.value;
  return condition.operator === "eq" ? String(valeur) : `${dimension} ≠ ${valeur}`;
}

/**
 * Population courante de l'URL, en conditions : paramètres dédiés (`device`,
 * `browser`…) puis conditions du segment. Un segment illisible rend `null` : on
 * n'enregistre pas une vue qu'on ne sait pas relire.
 */
export function conditionsDeLUrl(sp: ParamReader): FilterCondition[] | null {
  const segment = parseSegmentParam(sp.get("seg"));
  if (!segment.ok) return null;
  const dediees: FilterCondition[] = [];
  const device = sp.get("device");
  if (device) dediees.push({ dimension: "device", operator: "eq", value: device });
  for (const dimension of PARAM_DIMENSIONS) {
    const valeur = sp.get(dimension);
    if (valeur) dediees.push({ dimension, operator: "eq", value: valeur });
  }
  const cle = (c: FilterCondition) => `${c.dimension}:${c.operator}:${c.value}`;
  const vues = new Set(dediees.map(cle));
  return [...dediees, ...segment.value.filter((c) => !vues.has(cle(c)))];
}

/**
 * La vue actuelle, prête à enregistrer : un segment v2 (le magasin des segments
 * enregistrés ne connaît que `seg`, `SAVED_SEGMENTS_KEY`) et son nom par défaut.
 * `null` : rien à enregistrer (aucune condition, ou segment illisible).
 */
export function vueActuelle(sp: ParamReader): { seg: string; nom: string } | null {
  const conditions = conditionsDeLUrl(sp);
  if (!conditions || conditions.length === 0) return null;
  return { seg: serializeSegments(conditions), nom: nommerVue(conditions.map(facette)).slice(0, 100) };
}

// ─────────────────────────────── Vues personnelles ───────────────────────────────

/**
 * Segments enregistrés du navigateur → vues `u:<index>`. Appliquer une vue
 * personnelle pose son segment et RETIRE les paramètres dédiés : ses conditions y
 * sont déjà (`vueActuelle` les y a recopiées), les garder les appliquerait deux fois
 * — ou, pire, ajouterait à la vue un filtre qu'elle ne porte pas.
 */
export function vuesPersonnelles(items: readonly SavedSegment[]): VuePrereglee[] {
  const retirer: Record<string, null> = { device: null };
  for (const dimension of PARAM_DIMENSIONS) retirer[dimension] = null;
  return items.map((item, index) => ({
    id: `u:${index}`,
    libelle: item.name,
    origine: "personnelle",
    params: { ...retirer, seg: item.seg },
  }));
}

// ─────────────────────────────── Application d'une vue ───────────────────────────────

/**
 * URL de l'écran courant avec la vue appliquée : ses paramètres posés (ou retirés
 * s'ils valent `null`), la pagination retirée, tout le reste tel quel — plage, app,
 * réglages d'affichage. Le paramètre `vue` n'est PAS écrit : P13 veut qu'un clic ne
 * change que des paramètres du contrat (+ `cmp`), et la vue active se reconnaît à
 * l'URL (`vueCorrespond`).
 */
export function hrefDeVue(pathname: string, courants: URLSearchParams, vue: Pick<VuePrereglee, "params">): string {
  verifierParams(vue.params);
  const next = new URLSearchParams(courants.toString());
  for (const [cle, valeur] of Object.entries(vue.params)) {
    if (valeur === null) next.delete(cle);
    else next.set(cle, valeur);
  }
  for (const cle of PARAMS_DE_PAGINATION) next.delete(cle);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** La vue est active tant que l'URL porte exactement ses paramètres (`null` = absent). */
export function vueCorrespond(courants: ParamReader, vue: Pick<VuePrereglee, "params">): boolean {
  return Object.entries(vue.params).every(([cle, valeur]) => (courants.get(cle) ?? null) === valeur);
}

// ─────────────────────────────── Choix des releases (§ 3.2) ───────────────────────────────

export interface ChoixReleases {
  /** Release candidate (B) ; `null` : aucune release sur la fenêtre. */
  relB: string | null;
  /** Référence (A) ; `null` : moins de deux releases. */
  relA: string | null;
  /** Règle appliquée, écrite sous le titre de la comparaison. */
  regle: string;
  /** Pourquoi la comparaison n'est pas possible (moins de deux releases). */
  indisponible?: string;
}

export const RAISON_MOINS_DE_DEUX_RELEASES = "moins de deux releases sur la fenêtre";

/**
 * Releases comparées par défaut (CP3 : `comparaisonVersions` trie par sessions, pas
 * par date — la « deuxième ligne » n'est donc pas « la précédente »).
 *
 *   - B = version du DERNIER marqueur de déploiement (`deploys[0]`, du plus récent au
 *     plus ancien comme `listDeploys`) si elle a des mesures sur la fenêtre, sinon la
 *     release de plus grand volume ;
 *   - A = quand B vient du marqueur : la version du marqueur précédent (autre que B)
 *     qui a des mesures ; sinon, ou à défaut, la deuxième release par volume.
 *
 * Le groupe « (non renseignée) » n'est pas une release : jamais choisi.
 */
export function choisirReleases(
  deploys: readonly Pick<DeployRow, "version">[],
  versions: readonly Pick<VersionRow, "version" | "sessions">[],
): ChoixReleases {
  const parVolume = [...versions]
    .filter((v) => v.version !== SANS_RELEASE && v.version.trim() !== "")
    .sort((a, b) => b.sessions - a.sessions)
    .map((v) => v.version);
  const presentes = new Set(parVolume);
  if (parVolume.length === 0) {
    return { relB: null, relA: null, regle: "aucune release déclarée sur la fenêtre", indisponible: RAISON_MOINS_DE_DEUX_RELEASES };
  }

  const dernier = deploys[0]?.version ?? null;
  const depuisMarqueur = dernier !== null && presentes.has(dernier);
  const relB = depuisMarqueur ? dernier : parVolume[0];
  const regleB = depuisMarqueur
    ? `${relB} : dernier déploiement déclaré`
    : dernier !== null
      ? // `versions` vient d'une lecture PLAFONNÉE (`comparaisonVersions(f, 12)`) : une release
        // absente peut n'avoir aucune mesure, ou n'être simplement pas parmi les plus vues.
        `${relB} : release de plus grand volume (le dernier déploiement déclaré, ${dernier}, n'est pas parmi les releases lues sur la fenêtre : aucune mesure, ou hors des releases les plus vues)`
      : `${relB} : release de plus grand volume (aucun déploiement déclaré)`;

  let relA: string | null = null;
  let regleA = "";
  if (depuisMarqueur) {
    const precedent = deploys.slice(1).find((d) => d.version !== null && d.version !== relB && presentes.has(d.version));
    if (precedent?.version) {
      relA = precedent.version;
      regleA = `${relA} : déploiement précédent`;
    }
  }
  if (relA === null) {
    relA = parVolume.find((v) => v !== relB) ?? null;
    if (relA !== null) regleA = `${relA} : ${relB === parVolume[0] ? "deuxième" : "première"} release par volume`;
  }

  if (relA === null) return { relB, relA: null, regle: regleB, indisponible: RAISON_MOINS_DE_DEUX_RELEASES };
  return { relB, relA, regle: `${regleB} ; ${regleA}` };
}

// ─────────────────────────────── Vues produit (§ 3.6) ───────────────────────────────

/** Une entrée lue, ou la raison de son absence (lecture en échec, colonne absente…). */
export type Entree<T> = { valeur: T } | { indisponible: string };

export interface LigneNavigateur {
  valeur: string | null;
  lcp_p75: number | null;
  lcp_n: number | null;
}

export interface LignePays {
  valeur: string | null;
  /** Volume de la ligne (mesures, sessions) : le premier pays est le plus volumineux. */
  volume: number | null;
}

export interface EntreesVuesProduit {
  releases: Entree<ChoixReleases>;
  /** Découpage par navigateur (`vitalsBreakdown(f, "browser")`) : pire au tri gravité LCP. */
  navigateurs: Entree<readonly LigneNavigateur[]>;
  /** Découpage par pays estimé : premier en volume. */
  pays: Entree<readonly LignePays[]>;
  /**
   * Vue « Capteur extension » (`/sessions` seulement) : le segment courant, auquel la
   * condition `source = extension` est AJOUTÉE (remplacer le segment perdrait les
   * conditions déjà posées). Absent : la vue n'est pas proposée.
   */
  extension?: { segActuel: string | null };
}

/** Vue produit désactivée, avec sa raison. */
function indisponible(id: string, libelle: string, raison: string): VuePrereglee {
  return { id, libelle, origine: "produit", params: {}, indisponible: raison };
}

function produit(id: string, libelle: string, params: Record<string, string | null>): VuePrereglee {
  verifierParams(params);
  return { id, libelle, origine: "produit", params };
}

/**
 * Vues produit d'un écran, dans l'ordre d'affichage. Les données sont LUES par
 * l'appelant (serveur) ; ici, seulement la règle de chaque vue.
 */
export function vuesProduit(entrees: EntreesVuesProduit): VuePrereglee[] {
  const vues: VuePrereglee[] = [produit("p:mobile", "Mobile", { device: "mobile" }), produit("p:desktop", "Desktop", { device: "desktop" })];

  // Dernière release et comparaison : la règle du § 3.2, une seule fois.
  if ("indisponible" in entrees.releases) {
    vues.push(indisponible("p:derniere-release", "Dernière release", entrees.releases.indisponible));
    vues.push(indisponible("p:release-vs-precedente", "Nouvelle release vs précédente", entrees.releases.indisponible));
  } else {
    const choix = entrees.releases.valeur;
    // Les deux vues s'excluent (§ 3.2) : filtrer sur UNE release et comparer deux
    // releases « même fenêtre » ne vont pas ensemble — sous `release=B`, la référence
    // A n'a aucune session. Chaque vue retire donc ce que l'autre pose.
    //   - « Dernière release » : filtre sur B, retire la comparaison de releases
    //     (`cmp` revient au défaut de l'écran, `rel_a` / `rel_b` partent) ;
    //   - « Nouvelle release vs précédente » : retire le filtre `release` et écrit le
    //     couple choisi, qui écrase un couple hérité (lien d'annotation, sélecteur).
    // `choisirReleases` doit être calculé par l'appelant SANS le filtre `release` de
    // l'URL : sous ce filtre, la lecture des versions ne verrait qu'une release.
    vues.push(
      choix.relB === null
        ? indisponible("p:derniere-release", "Dernière release", "aucune release déclarée sur la fenêtre")
        : produit("p:derniere-release", nommerVue(["Dernière release", choix.relB]), {
            release: choix.relB,
            cmp: null,
            rel_a: null,
            rel_b: null,
          }),
    );
    vues.push(
      choix.indisponible || choix.relA === null || choix.relB === null
        ? indisponible(
            "p:release-vs-precedente",
            "Nouvelle release vs précédente",
            choix.indisponible ?? RAISON_MOINS_DE_DEUX_RELEASES,
          )
        : produit("p:release-vs-precedente", "Nouvelle release vs précédente", {
            cmp: "release",
            release: null,
            rel_a: choix.relA,
            rel_b: choix.relB,
          }),
    );
  }

  // Pire navigateur : en tête du tri gravité LCP, parmi les navigateurs mesurés au
  // moins 30 fois — un p75 sur 12 mesures ne désigne pas « le pire ».
  if ("indisponible" in entrees.navigateurs) {
    vues.push(indisponible("p:pire-navigateur", "Pire navigateur", entrees.navigateurs.indisponible));
  } else {
    const connus = entrees.navigateurs.valeur.filter((l) => l.valeur !== null && (l.lcp_n ?? 0) >= SEUIL_ECHANTILLON_FAIBLE);
    const pire = classerParGravite(connus, { pilote: (l) => l.lcp_p75, effectif: (l) => l.lcp_n, tri: "gravite" }).lignes[0];
    vues.push(
      pire?.valeur && pire.lcp_p75 !== null
        ? produit("p:pire-navigateur", nommerVue(["Pire navigateur", pire.valeur]), { browser: pire.valeur })
        : indisponible(
            "p:pire-navigateur",
            "Pire navigateur",
            `aucun navigateur avec au moins ${SEUIL_ECHANTILLON_FAIBLE} mesures LCP sur la fenêtre`,
          ),
    );
  }

  if ("indisponible" in entrees.pays) {
    vues.push(indisponible("p:premier-pays", "Pays estimé", entrees.pays.indisponible));
  } else {
    const premier = [...entrees.pays.valeur]
      .filter((l) => l.valeur !== null && (l.volume ?? 0) > 0)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
    vues.push(
      premier?.valeur
        ? produit("p:premier-pays", `Pays estimé : ${premier.valeur}`, { country: premier.valeur })
        : indisponible("p:premier-pays", "Pays estimé", "aucun pays estimé sur la fenêtre"),
    );
  }

  if (entrees.extension) {
    const courant = parseSegmentParam(entrees.extension.segActuel);
    if (!courant.ok) {
      vues.push(indisponible("p:extension", "Capteur extension", "segment courant illisible"));
    } else {
      const sansSource = courant.value.filter((c) => c.dimension !== "source");
      const seg = serializeSegments([...sansSource, { dimension: "source", operator: "eq", value: "extension" }]);
      vues.push(produit("p:extension", "Capteur extension", { seg }));
    }
  }
  return vues;
}
