// État de vue porté par l'URL (F06, plan § 3.1) — logique PURE, testée, sans accès
// base. Partagée par le serveur (lecture d'un écran) et par les composants client
// (barre de filtres, navigation) : ce module ne doit importer que du code client-sûr.
//
// DEUX FAMILLES DE PARAMÈTRES, ET UNE SEULE FRONTIÈRE ENTRE ELLES.
//   · Les paramètres du CONTRAT (`CONTRACT_PARAMS`, lib/query-contract.ts) changent
//     la population : ils sont validés, refusés s'ils sont illisibles, et entrent
//     dans `queryFingerprint`.
//   · Les paramètres de VUE déclarés ici (comparaison, tri, vital piloté, panneau,
//     vue préréglée…) changent ce qu'on MONTRE, jamais ce qu'on COMPTE. Ils ne
//     passent donc jamais par le contrat ni par l'empreinte (un test le prouve), et
//     une valeur illisible n'est pas refusée : elle est ignorée et SIGNALÉE par une
//     ligne « Réglage d'affichage ignoré : … », puisqu'elle ne touche aucun chiffre.
//
// Seuls `cmp`, `rel_a` et `rel_b` suivent la navigation (`VIEW_CONTEXT_PARAMS`) :
// une comparaison choisie vaut pour toute la console, un tri ou un panneau ouvert
// n'a de sens que sur l'écran qui l'a posé.
import { CONTRACT_PARAMS, VALUE_MAX, contextSearchParams, isSafeText, type ParamReader } from "./query-contract";
import { CORE_VITALS } from "./rating";

// ─────────────────────────────── Comparaison ─────────────────────────────────

export const MODES_COMPARAISON = ["prev", "release", "none"] as const;
export type ModeComparaison = (typeof MODES_COMPARAISON)[number];

/** Paramètres de vue reportés d'un écran à l'autre, avec ceux du contrat. */
export const VIEW_CONTEXT_PARAMS = ["cmp", "rel_a", "rel_b"] as const;

/**
 * Écrans de la catégorie Performance (plan § 2.2 et § 2.4, clé `perf`), où la
 * comparaison à la période précédente est le défaut. Écrite ICI plutôt que lue
 * dans `components/nav-items.tsx` : la navigation est redécoupée par F09, et le
 * défaut d'une comparaison ne doit pas changer au gré du rangement d'un menu.
 * Une entrée terminée par `/` est un préfixe (détails d'erreur, d'issue).
 */
export const ECRANS_PERFORMANCE = ["/", "/pages", "/errors", "/errors/", "/ux", "/actions", "/experience", "/mobile"] as const;

export interface EtatComparaison {
  mode: ModeComparaison;
  /** Release de référence (A) ; `null` hors `cmp=release` ou non choisie (règle du § 3.2). */
  relA: string | null;
  /** Release comparée (B). */
  relB: string | null;
}

// ─────────────────────────────────── Tri ─────────────────────────────────────

export type TriId = "gravite" | "volume" | "impact" | "statut" | "sessions" | "recent";

/** Une valeur de `tri` n'est acceptée que si l'écran la déclare (P3). */
export const TRIS_PAR_ECRAN = {
  "/": { valeurs: ["gravite", "volume", "impact"], defaut: "gravite" },
  "/pages": { valeurs: ["gravite", "volume", "impact"], defaut: "gravite" },
  "/errors": { valeurs: ["statut", "sessions", "recent"], defaut: "statut" }, // ordre SQL nommé (CP9)
  "/ux": { valeurs: ["gravite", "volume"], defaut: "gravite" },
  "/experience": { valeurs: ["gravite", "volume"], defaut: "gravite" },
  "/mobile": { valeurs: ["gravite", "volume"], defaut: "gravite" },
  "/map": { valeurs: ["gravite", "volume"], defaut: "gravite" },
  "/explorer": { valeurs: ["gravite", "volume"], defaut: "gravite" },
} as const satisfies Record<string, { valeurs: readonly TriId[]; defaut: TriId }>;

/**
 * Tris déclarés mais pas encore calculables, avec leur raison. `impact` classe par
 * nombre de mesures « Mauvais » d'un groupe, que `vitalsBreakdown` ne rend pas
 * encore (backend B2) : l'accepter trierait sur une colonne absente, donc au
 * hasard. Retirer la ligne quand B2 est livré.
 */
export const TRIS_INDISPONIBLES: Partial<Record<TriId, string>> = {
  impact: "le classement par impact attend le nombre de mesures « Mauvais » par groupe, pas encore lu",
};

// ───────────────────────────── Autres paramètres ─────────────────────────────

export const TYPES_PANNEAU = ["route", "error", "issue", "session", "trace", "event", "action", "noeud"] as const;
export type TypePanneau = (typeof TYPES_PANNEAU)[number];

/** Panneau latéral ouvert (§ 3.5). Un nœud de carte existe côté front ET côté back. */
export type Panneau =
  | { type: Exclude<TypePanneau, "noeud">; id: string }
  | { type: "noeud"; cote: "front" | "back"; route: string };

/** Vue préréglée appliquée (§ 3.6) : produit (`p:<clé>`) ou personnelle (`u:<index>`). */
export type VueActive = { origine: "produit"; cle: string } | { origine: "personnelle"; index: number };

/** Appel HTTP ciblé sur `/tracing` : `<méthode> <chemin>`, chemin sans origine. */
export interface Appel {
  methode: string;
  chemin: string;
}

export const METHODES_HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** Pré-remplissage du formulaire « Nouvelle règle » de `/alerts`. */
export interface RegleProposee {
  metrique: string | null;
  route: string | null;
  seuil: number | null;
}

export const AVEC_SESSIONS = ["erreurs", "frustration", "rejeu"] as const;
export type AvecSessions = (typeof AVEC_SESSIONS)[number];

/** Natures de la chronologie d'une session, dans l'ordre canonique d'écriture. */
export const NATURES_CHRONOLOGIE = ["vue", "action", "erreur", "api", "frustration", "ressource", "tache", "evenement"] as const;
export type NatureChronologie = (typeof NATURES_CHRONOLOGIE)[number];

export const TYPES_FRUSTRATION = ["rage", "dead", "error"] as const;
export type TypeFrustration = (typeof TYPES_FRUSTRATION)[number];

export const STATUTS_ERREUR = ["open", "resolved", "ignored", "regressed"] as const;
export type StatutErreur = (typeof STATUTS_ERREUR)[number];

/** Tout l'état de vue d'un écran, défauts appliqués. `null` = sans objet sur cet écran. */
export interface EtatDeVue {
  cmp: ModeComparaison;
  relA: string | null;
  relB: string | null;
  tri: TriId | null;
  /** Vital qui pilote un classement ou une distribution (`/`, `/pages`, `/ux`). */
  vital: string | null;
  panel: Panneau | null;
  vue: VueActive | null;
  evt: number | null;
  regle: RegleProposee;
  appel: Appel | null;
  avec: AvecSessions | null;
  /** Natures affichées dans la chronologie ; toutes par défaut. */
  voir: NatureChronologie[];
  depuis: string | null;
  type: TypeFrustration | null;
  nouveaux: boolean;
  statut: StatutErreur | null;
}

export type ParametreVue =
  | (typeof VIEW_CONTEXT_PARAMS)[number]
  | "tri"
  | "vital"
  | "panel"
  | "vue"
  | "evt"
  | "regle_metrique"
  | "regle_route"
  | "regle_seuil"
  | "appel"
  | "avec"
  | "voir"
  | "depuis"
  | "type"
  | "nouveaux"
  | "statut";

/**
 * Écrans qui lisent chaque paramètre (colonne « Écran(s) » du § 3.1). Hors de ces
 * écrans, le paramètre n'est pas un réglage de l'écran : s'il est présent, il est
 * ignoré et signalé — jamais lu à moitié. Une entrée terminée par `/` (sauf `/`)
 * est un préfixe.
 */
export const ECRANS_PAR_PARAMETRE: Record<ParametreVue, readonly string[] | "tous"> = {
  cmp: "tous",
  rel_a: "tous",
  rel_b: "tous",
  tri: Object.keys(TRIS_PAR_ECRAN),
  vital: ["/", "/pages", "/ux"],
  // « Écrans à liste » : chacun déclare les types qu'il sait ouvrir dans son lot.
  panel: "tous",
  vue: ["/", "/pages", "/errors", "/ux", "/actions", "/sessions", "/mobile"],
  evt: ["/alerts"],
  regle_metrique: ["/alerts"],
  regle_route: ["/alerts"],
  regle_seuil: ["/alerts"],
  appel: ["/tracing"],
  avec: ["/sessions"],
  voir: ["/sessions/"],
  depuis: ["/paths"],
  type: ["/ux"],
  nouveaux: ["/errors"],
  statut: ["/errors"],
};

// ───────────────────────────────── Outils ────────────────────────────────────

function correspond(ecran: string, pathname: string): boolean {
  return ecran !== "/" && ecran.endsWith("/") ? pathname.startsWith(ecran) : pathname === ecran;
}

/** Le paramètre est-il un réglage de cet écran ? */
export function parametreDeLEcran(parametre: ParametreVue, pathname: string): boolean {
  const ecrans = ECRANS_PAR_PARAMETRE[parametre];
  return ecrans === "tous" || ecrans.some((ecran) => correspond(ecran, pathname));
}

/** Défaut de `cmp` : période précédente sur les écrans Performance, aucune ailleurs. */
export function comparaisonParDefaut(pathname: string): ModeComparaison {
  return ECRANS_PERFORMANCE.some((ecran) => correspond(ecran, pathname)) ? "prev" : "none";
}

/** Valeur citée dans une ligne d'avertissement : bornée, une URL peut porter n'importe quoi. */
function citer(valeur: string): string {
  return valeur.length > 40 ? `${valeur.slice(0, 40)}…` : valeur;
}

/** Ligne affichée sous la barre ou l'écran (`role="note"`). */
export function ligneIgnoree(parametre: string, valeur: string, raison: string): string {
  return `Réglage d'affichage ignoré : ${parametre}=${citer(valeur)} (${raison}).`;
}

/** Valeur brute d'un paramètre : absent ou vide = non posé. */
function brut(sp: ParamReader, nom: string): string | null {
  const valeur = sp.get(nom);
  return valeur === null || valeur === "" ? null : valeur;
}

function parmi<T extends string>(liste: readonly T[], valeur: string): valeur is T {
  return (liste as readonly string[]).includes(valeur);
}

// ─────────────────────────────── Lecteurs ────────────────────────────────────

/**
 * `cmp`, `rel_a`, `rel_b`. Les releases ne sont lues qu'en `cmp=release` ; deux
 * releases identiques ne se comparent pas (ignorées, signalées). Une release absente
 * reste `null` : l'écran applique la règle du § 3.2 (`choisirReleases`, F08).
 */
export function lireComparaison(pathname: string, sp: ParamReader): { valeur: EtatComparaison; ignores: string[] } {
  const ignores: string[] = [];
  const defaut = comparaisonParDefaut(pathname);
  const cmp = brut(sp, "cmp");
  let mode: ModeComparaison = defaut;
  if (cmp !== null) {
    if (parmi(MODES_COMPARAISON, cmp)) mode = cmp;
    else ignores.push(ligneIgnoree("cmp", cmp, `valeurs acceptées : ${MODES_COMPARAISON.join(", ")}`));
  }
  if (mode !== "release") return { valeur: { mode, relA: null, relB: null }, ignores };

  const release = (nom: "rel_a" | "rel_b"): string | null => {
    const valeur = brut(sp, nom);
    if (valeur === null) return null;
    if (isSafeText(valeur, VALUE_MAX)) return valeur;
    ignores.push(ligneIgnoree(nom, valeur, `libellé de release de 1 à ${VALUE_MAX} caractères, sans caractère de contrôle`));
    return null;
  };
  let relA = release("rel_a");
  let relB = release("rel_b");
  if (relA !== null && relA === relB) {
    ignores.push(ligneIgnoree("rel_a", relA, "rel_a et rel_b désignent la même release"));
    relA = null;
    relB = null;
  }
  return { valeur: { mode, relA, relB }, ignores };
}

/**
 * `tri` d'un écran de `TRIS_PAR_ECRAN`. Valeur inconnue, non déclarée pour l'écran
 * ou pas encore calculable (`TRIS_INDISPONIBLES`) : défaut de l'écran, et la ligne
 * d'avertissement. Sur un écran sans tri, `gravite` et l'avertissement si `tri` est posé.
 */
export function lireTri(pathname: string, sp: ParamReader): { tri: TriId; ignore: string | null } {
  const ecran = (TRIS_PAR_ECRAN as Record<string, { valeurs: readonly TriId[]; defaut: TriId }>)[pathname];
  const valeur = brut(sp, "tri");
  if (!ecran) return { tri: "gravite", ignore: valeur === null ? null : ligneIgnoree("tri", valeur, "cet écran ne propose pas de tri") };
  if (valeur === null) return { tri: ecran.defaut, ignore: null };
  if (!parmi(ecran.valeurs, valeur)) {
    return { tri: ecran.defaut, ignore: ligneIgnoree("tri", valeur, `tris de cet écran : ${ecran.valeurs.join(", ")}`) };
  }
  const indisponible = TRIS_INDISPONIBLES[valeur];
  if (indisponible) return { tri: ecran.defaut, ignore: ligneIgnoree("tri", valeur, indisponible) };
  return { tri: valeur, ignore: null };
}

/** `panel=<type>:<identifiant encodé>` ; `noeud:<front|back>:<route encodée>`. */
export function lirePanel(valeur: string): Panneau | null {
  const sep = valeur.indexOf(":");
  if (sep <= 0) return null;
  const type = valeur.slice(0, sep);
  const reste = valeur.slice(sep + 1);
  const decode = (texte: string): string | null => {
    try {
      const clair = decodeURIComponent(texte);
      return isSafeText(clair, VALUE_MAX) ? clair : null;
    } catch {
      return null;
    }
  };
  if (!parmi(TYPES_PANNEAU, type)) return null;
  if (type === "noeud") {
    const sep2 = reste.indexOf(":");
    const cote = reste.slice(0, sep2);
    if (sep2 <= 0 || (cote !== "front" && cote !== "back")) return null;
    const route = decode(reste.slice(sep2 + 1));
    return route === null ? null : { type, cote, route };
  }
  const id = decode(reste);
  return id === null ? null : { type, id };
}

export function ecrirePanel(panneau: Panneau): string {
  return panneau.type === "noeud"
    ? `noeud:${panneau.cote}:${encodeURIComponent(panneau.route)}`
    : `${panneau.type}:${encodeURIComponent(panneau.id)}`;
}

const CLE_VUE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** `vue=p:<clé>` (vue produit) ou `vue=u:<index>` (vue personnelle). */
export function lireVue(valeur: string): VueActive | null {
  if (valeur.startsWith("p:")) {
    const cle = valeur.slice(2);
    return CLE_VUE.test(cle) ? { origine: "produit", cle } : null;
  }
  if (valeur.startsWith("u:")) {
    const index = valeur.slice(2);
    return /^(0|[1-9]\d{0,3})$/.test(index) ? { origine: "personnelle", index: Number(index) } : null;
  }
  return null;
}

export function ecrireVue(vue: VueActive): string {
  return vue.origine === "produit" ? `p:${vue.cle}` : `u:${vue.index}`;
}

/** Identifiant d'`alert_event` : un entier strictement positif. `fired` n'en est JAMAIS un (§ 3.1). */
export function lireEvt(valeur: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(valeur)) return null;
  const n = Number(valeur);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * `appel=<MÉTHODE> <chemin>` : une espace, chemin absolu sans origine ni blanc.
 * Forme seule ; l'écran `/tracing` la lit par `lireAppel` (lib/tracing-ancres.ts,
 * F59), qui peut déléguer ici plutôt que réécrire la forme.
 */
export function analyserAppel(valeur: string): Appel | null {
  const m = /^([A-Z]+) (\/\S*)$/.exec(valeur);
  if (!m || !parmi(METHODES_HTTP, m[1])) return null;
  const chemin = m[2];
  if (chemin.length > VALUE_MAX || chemin.startsWith("//") || !isSafeText(chemin, VALUE_MAX)) return null;
  return { methode: m[1], chemin };
}

export function ecrireAppel(appel: Appel): string {
  return `${appel.methode} ${appel.chemin}`;
}

/** Forme d'une métrique d'alerte : clé nommée, `event:<nom>` ou `issue:<uuid>`. */
const FORME_METRIQUE = /^(?:[A-Za-z][A-Za-z0-9_]{0,39}|event:[^\s:]{1,100}|issue:[0-9a-f-]{36})$/;

/**
 * `regle_metrique`, `regle_route`, `regle_seuil`. Ce module reste client-sûr : il
 * vérifie la FORME de la métrique ; l'écran des alertes passe `estMetrique`
 * (`isAlertMetric`, lib/queries-v2.ts) pour la vérifier contre `ALERT_METRICS`.
 */
export function lireRegle(
  sp: ParamReader,
  estMetrique: (metrique: string) => boolean = () => true,
): { valeur: RegleProposee; ignores: string[] } {
  const ignores: string[] = [];
  const valeur: RegleProposee = { metrique: null, route: null, seuil: null };
  const metrique = brut(sp, "regle_metrique");
  if (metrique !== null) {
    if (FORME_METRIQUE.test(metrique) && estMetrique(metrique)) valeur.metrique = metrique;
    else ignores.push(ligneIgnoree("regle_metrique", metrique, "métrique d'alerte inconnue"));
  }
  const route = brut(sp, "regle_route");
  if (route !== null) {
    if (isSafeText(route, VALUE_MAX)) valeur.route = route;
    else ignores.push(ligneIgnoree("regle_route", route, `route de 1 à ${VALUE_MAX} caractères`));
  }
  const seuil = brut(sp, "regle_seuil");
  if (seuil !== null) {
    const n = /^-?\d+(?:\.\d+)?$/.test(seuil) ? Number(seuil) : Number.NaN;
    if (Number.isFinite(n)) valeur.seuil = n;
    else ignores.push(ligneIgnoree("regle_seuil", seuil, "un nombre est attendu"));
  }
  return { valeur, ignores };
}

/** `voir=vue,erreur` : natures connues seulement ; une seule inconnue invalide la liste. */
export function lireVoir(valeur: string): NatureChronologie[] | null {
  const natures = valeur.split(",").map((n) => n.trim());
  if (natures.some((n) => !parmi(NATURES_CHRONOLOGIE, n))) return null;
  return NATURES_CHRONOLOGIE.filter((n) => natures.includes(n));
}

/** Ordre canonique ; toutes les natures = défaut, non écrit (`null`). */
export function ecrireVoir(natures: readonly NatureChronologie[]): string | null {
  const canon = NATURES_CHRONOLOGIE.filter((n) => natures.includes(n));
  return canon.length === NATURES_CHRONOLOGIE.length || canon.length === 0 ? null : canon.join(",");
}

// ───────────────────────────── État complet ──────────────────────────────────

/**
 * État de vue d'un écran, défauts appliqués, et les lignes « Réglage d'affichage
 * ignoré » à afficher. Un paramètre qui n'appartient pas à l'écran est signalé
 * s'il est posé ; il n'est jamais appliqué.
 */
export function lireEtatDeVue(
  pathname: string,
  sp: ParamReader,
  options: { estMetriqueAlerte?: (metrique: string) => boolean } = {},
): { etat: EtatDeVue; ignores: string[] } {
  const ignores: string[] = [];
  const ici = (parametre: ParametreVue) => parametreDeLEcran(parametre, pathname);
  const hors = (parametre: ParametreVue) => {
    const valeur = brut(sp, parametre);
    if (valeur !== null) ignores.push(ligneIgnoree(parametre, valeur, "ce réglage ne s'applique pas à cet écran"));
  };
  /** Lit un paramètre de l'écran avec son analyseur ; illisible → ignoré et signalé. */
  function lire<T>(parametre: ParametreVue, analyser: (valeur: string) => T | null, attendu: string): T | null {
    if (!ici(parametre)) {
      hors(parametre);
      return null;
    }
    const valeur = brut(sp, parametre);
    if (valeur === null) return null;
    const lu = analyser(valeur);
    if (lu === null) ignores.push(ligneIgnoree(parametre, valeur, attendu));
    return lu;
  }
  const dans = <T extends string>(liste: readonly T[]) => (valeur: string) => (parmi(liste, valeur) ? valeur : null);

  const comparaison = lireComparaison(pathname, sp);
  ignores.push(...comparaison.ignores);

  let tri: TriId | null = null;
  if (ici("tri")) {
    const lu = lireTri(pathname, sp);
    tri = lu.tri;
    if (lu.ignore) ignores.push(lu.ignore);
  } else hors("tri");

  const vital = ici("vital")
    ? (lire("vital", dans(CORE_VITALS), `vitals : ${CORE_VITALS.join(", ")}`) ?? "LCP")
    : (hors("vital"), null);

  const panel = lire("panel", lirePanel, `forme attendue <type>:<identifiant>, type parmi ${TYPES_PANNEAU.join(", ")}`);
  const vue = lire("vue", lireVue, "forme attendue p:<clé> ou u:<index>");
  const evt = lire("evt", lireEvt, "identifiant entier d'un déclenchement attendu");

  let regle: RegleProposee = { metrique: null, route: null, seuil: null };
  if (ici("regle_metrique")) {
    const lu = lireRegle(sp, options.estMetriqueAlerte);
    regle = lu.valeur;
    ignores.push(...lu.ignores);
  } else {
    hors("regle_metrique");
    hors("regle_route");
    hors("regle_seuil");
  }

  const appel = lire("appel", analyserAppel,`forme attendue « <méthode> <chemin> », méthode parmi ${METHODES_HTTP.join(", ")}`);
  const avec = lire("avec", dans(AVEC_SESSIONS), `valeurs : ${AVEC_SESSIONS.join(", ")}`);
  const voir = lire("voir", lireVoir, `natures : ${NATURES_CHRONOLOGIE.join(", ")}`) ?? [...NATURES_CHRONOLOGIE];
  const depuis = lire("depuis", (v) => (isSafeText(v, VALUE_MAX) ? v : null), `route de 1 à ${VALUE_MAX} caractères`);
  const type = lire("type", dans(TYPES_FRUSTRATION), `types : ${TYPES_FRUSTRATION.join(", ")}`);
  const nouveaux = lire("nouveaux", (v) => (v === "1" ? true : null), "seule la valeur 1 est acceptée") ?? false;
  const statut = lire("statut", dans(STATUTS_ERREUR), `statuts : ${STATUTS_ERREUR.join(", ")}`);

  return {
    etat: {
      cmp: comparaison.valeur.mode,
      relA: comparaison.valeur.relA,
      relB: comparaison.valeur.relB,
      tri,
      vital,
      panel,
      vue,
      evt,
      regle,
      appel,
      avec,
      voir,
      depuis,
      type,
      nouveaux,
      statut,
    },
    ignores,
  };
}

/** Les lignes « Réglage d'affichage ignoré » d'une URL, pour cet écran. */
export function ignores(pathname: string, sp: ParamReader): string[] {
  return lireEtatDeVue(pathname, sp).ignores;
}

/**
 * Paramètres d'URL d'un état de vue (partiel), prêts pour `hrefWithQuery(…, extra)` :
 * une clé à `null` RETIRE le paramètre. Les défauts de l'écran ne s'écrivent pas —
 * une URL canonique par état.
 *
 * SAUF `cmp`, écrit dès qu'il est choisi. Il suit la navigation
 * (`VIEW_CONTEXT_PARAMS`) et son défaut change d'un écran à l'autre (`prev` sur
 * les écrans Performance, `none` ailleurs) : élidé au défaut de l'écran COURANT,
 * le choix se perdait sur l'écran SUIVANT (`/sessions?cmp=prev` → « Aucune »
 * retirait `cmp`, et `/` revenait à `prev`).
 */
export function ecrireEtatDeVue(pathname: string, etat: Partial<EtatDeVue>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (etat.cmp !== undefined) {
    out.cmp = etat.cmp;
    // Les releases n'ont de sens qu'en comparaison de releases : hors de ce mode, elles partent.
    out.rel_a = etat.cmp === "release" ? (etat.relA ?? null) : null;
    out.rel_b = etat.cmp === "release" ? (etat.relB ?? null) : null;
  }
  if (etat.tri !== undefined) {
    const ecran = (TRIS_PAR_ECRAN as Record<string, { defaut: TriId }>)[pathname];
    out.tri = etat.tri === null || etat.tri === ecran?.defaut ? null : etat.tri;
  }
  if (etat.vital !== undefined) out.vital = etat.vital === null || etat.vital === "LCP" ? null : etat.vital;
  if (etat.panel !== undefined) out.panel = etat.panel ? ecrirePanel(etat.panel) : null;
  if (etat.vue !== undefined) out.vue = etat.vue ? ecrireVue(etat.vue) : null;
  if (etat.evt !== undefined) out.evt = etat.evt === null ? null : String(etat.evt);
  if (etat.regle !== undefined) {
    out.regle_metrique = etat.regle.metrique;
    out.regle_route = etat.regle.route;
    out.regle_seuil = etat.regle.seuil === null ? null : String(etat.regle.seuil);
  }
  if (etat.appel !== undefined) out.appel = etat.appel ? ecrireAppel(etat.appel) : null;
  if (etat.avec !== undefined) out.avec = etat.avec;
  if (etat.voir !== undefined) out.voir = ecrireVoir(etat.voir);
  if (etat.depuis !== undefined) out.depuis = etat.depuis;
  if (etat.type !== undefined) out.type = etat.type;
  if (etat.nouveaux !== undefined) out.nouveaux = etat.nouveaux ? "1" : null;
  if (etat.statut !== undefined) out.statut = etat.statut;
  return out;
}

// ─────────────────────────────── Navigation ──────────────────────────────────

/**
 * Lien vers un autre écran qui garde le contexte : paramètres du contrat
 * (population, plage) + comparaison (`VIEW_CONTEXT_PARAMS`), tels quels, sans les
 * valider — l'écran d'arrivée le fait. Tri, panneau, vue et les autres réglages
 * propres à l'écran quitté restent derrière.
 */
export function contextHref(pathname: string, sp: ParamReader): string {
  const out = contextSearchParams(sp);
  for (const name of VIEW_CONTEXT_PARAMS) for (const value of sp.getAll(name)) out.append(name, value);
  const qs = out.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Laissés derrière par un zoom : la plage elle-même, et ce qui ne vaut que pour elle. */
const HORS_ZOOM: ReadonlySet<string> = new Set(["cursor", "panel"]);

/**
 * Gabarit d'un zoom sur le MÊME écran (§ 3.3, revue de vague 3) : un clic sur une case
 * ou un seau change la plage, et RIEN d'autre. `hrefContrat` porte les paramètres du
 * contrat déjà canoniques (population, `from={from}`, `to={to}`, sans `period`) ; on y
 * rajoute tels quels les réglages de la vue lus dans l'URL brute — comparaison,
 * releases, tri, découpage, heures ouvrées… Avant, la case de la heatmap perdait
 * `cmp`/`rel_a`/`rel_b` et le tri, le seau du hero perdait `tri` et `hours`.
 */
export function gabaritZoom(hrefContrat: string, brut: Record<string, string | string[] | undefined>): string {
  const [chemin, qs = ""] = hrefContrat.split("?");
  const out = new URLSearchParams(qs);
  const contrat: ReadonlySet<string> = new Set(CONTRACT_PARAMS);
  for (const [nom, valeur] of Object.entries(brut)) {
    if (valeur === undefined || contrat.has(nom) || HORS_ZOOM.has(nom) || out.has(nom)) continue;
    for (const v of Array.isArray(valeur) ? valeur : [valeur]) out.append(nom, v);
  }
  const texte = out.toString();
  return texte ? `${chemin}?${texte}` : chemin;
}
