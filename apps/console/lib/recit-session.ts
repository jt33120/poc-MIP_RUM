// Récit de session composé de faits (P*.9, § 7.2 du plan frontend).
//
// POURQUOI CE MODULE. Datadog résume une session par un modèle de langage : coût
// et latence par résumé, et une reformulation qu'on ne peut pas vérifier à notre
// échelle. Ici, le récit est DÉTERMINISTE : des gabarits de phrases, dans un ordre
// fixe, remplis par les lignes de `sessionTimeline` et rien d'autre. Chaque phrase
// porte l'ancre de l'événement qui la fonde ; une phrase sans événement n'est pas
// écrite (« aucune vue reçue » n'a pas d'événement à montrer, donc pas de phrase).
//
// CE QUE LE RÉCIT NE FAIT PAS. Il n'interprète pas : aucune phrase ne décrit une
// intention ni un état d'esprit, et aucune ne relie deux faits par un lien de
// cause (RM5). « 3 s après le clic “Payer” » est une durée entre deux instants
// reçus, pas une explication. `MOTS_INTERDITS` est vérifié par test.
//
// Logique pure (RM1) : aucun import de `db`, le type de ligne est importé en type.
import { STILL_ACTIVE_MINUTES } from "./engagement";
import { fmtVital } from "./format";
import type { TimelineItem } from "./queries";
import { CORE_VITALS, RATING_LABEL, THRESHOLDS, rating2026, texteSeuils, type Rating } from "./rating";
import type { Resultat } from "./stats/types";

/** Plafond de `sessionTimeline` (`limit 500`) : au-delà, la fin n'est pas reçue. */
export const LIMITE_CHRONOLOGIE = 500;

/** Groupes d'erreurs écrits un par un ; les suivants tiennent en une phrase. */
export const ERREURS_DETAILLEES = 3;

/** Parcours de plus de N vues : début et fin, le milieu est élidé et compté. */
export const VUES_DETAILLEES = 6;

/**
 * Mots qu'aucun gabarit ne doit produire : ils prêtent une intention ou un
 * état d'esprit au visiteur, ou une cause à une association (RM5).
 */
export const MOTS_INTERDITS = /énerv|abandonn|cause|à cause|responsable|voulu|cherch|frustré|agacé/i;

/** Mention fixe sous le récit (§ 7.2, P*.9 « Affichage »). */
export const MENTION_RECIT =
  "Récit composé à partir des événements reçus, sans interprétation. Les événements non collectés n'y figurent pas.";

export type Rejeu = "present" | "absent" | "masque";

export interface PhraseRecit {
  texte: string;
  /** Identifiant de la ligne de chronologie qui fonde la phrase (`evt-<rang>`). */
  ancre: string;
  /** Second fait cité par la phrase : l'action qui précède une erreur. */
  action?: { texte: string; ancre: string };
}

export type Recit = Resultat<{ phrases: PhraseRecit[] }>;

export interface EntreeRecit {
  /** Lignes de `sessionTimeline(id)`, dans son ordre (le rang fait l'ancre). */
  timeline: readonly TimelineItem[];
  /** `rum_session.started_at` et `last_seen_at`. */
  debut: Date | string;
  fin: Date | string;
  nowMs: number;
}

/** Ancre d'une ligne de chronologie : même rang que la liste rendue. */
export function ancreEvenement(rang: number): string {
  return `evt-${rang}`;
}

const ms = (d: Date | string) => new Date(d).getTime();

/** « 42 s », « 6 min 12 s », « 1 h 05 min » ; sous la seconde, « moins d'une seconde ». */
export function duree(valeurMs: number): string {
  if (valeurMs < 1000) return "moins d'une seconde";
  const s = Math.round(valeurMs / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

function route(r: string | null | undefined): string {
  return r && r.trim() ? r : "une route inconnue";
}

/**
 * Pour chaque ligne, le rang de la dernière vue de page reçue avant elle (ou
 * elle-même) : c'est « la vue pendant laquelle » l'événement a été observé.
 * `null` avant la première vue.
 */
function vuesCourantes(timeline: readonly TimelineItem[]): (number | null)[] {
  let courante: number | null = null;
  return timeline.map((it, i) => {
    if (it.kind === "pageview") courante = i;
    return courante;
  });
}

function phraseParcours(timeline: readonly TimelineItem[]): PhraseRecit | null {
  const vues = timeline.flatMap((it, i) => (it.kind === "pageview" ? [{ it, i }] : []));
  if (!vues.length) return null;
  const routes = vues.map((v) => route(v.it.title));
  const suite =
    routes.length <= VUES_DETAILLEES
      ? routes.join(" → ")
      : [...routes.slice(0, 3), `… (${routes.length - 5} autres)`, ...routes.slice(-2)].join(" → ");
  return { texte: `${pluriel(vues.length, "vue", "vues")} : ${suite}.`, ancre: ancreEvenement(vues[0].i) };
}

function phraseDuree(e: EntreeRecit): PhraseRecit {
  const ecart = Math.max(0, ms(e.fin) - ms(e.debut));
  let texte = `${duree(ecart)} entre la première et la dernière observation.`;
  if (e.nowMs - ms(e.fin) < STILL_ACTIVE_MINUTES * 60_000) {
    texte += ` Dernier événement reçu il y a moins de ${STILL_ACTIVE_MINUTES} min : la session peut encore s'allonger.`;
  }
  return { texte, ancre: ancreEvenement(0) };
}

/** « 4,80 s », « 0,312 » : `fmtVital`, avec la virgule décimale aussi pour le CLS. */
function valeurVital(nom: string, v: number): string {
  return fmtVital(nom, v).replace(".", ",");
}

const RANG_RATING: Record<Rating, number> = { good: 0, "needs-improvement": 1, poor: 2 };

function phrasePireVital(timeline: readonly TimelineItem[], vues: (number | null)[]): PhraseRecit | null {
  const mesures = timeline.flatMap((it, i) => {
    if (it.kind !== "vital" || !it.title || !CORE_VITALS.includes(it.title) || it.value == null) return [];
    const valeur = Number(it.value);
    if (!Number.isFinite(valeur)) return [];
    // Le verdict est celui reçu en base ; à défaut, celui de `rating.ts` (V8).
    const verdict = (it.rating as Rating | null) ?? rating2026(it.title, valeur);
    if (!verdict || !(verdict in RANG_RATING)) return [];
    return [{ it, i, nom: it.title, valeur, verdict, rapport: valeur / THRESHOLDS[it.title][0] }];
  });
  if (!mesures.length) return null;
  // Pire = verdict le plus mauvais, puis la valeur la plus loin de son seuil « bon ».
  const pire = mesures.reduce((a, b) =>
    RANG_RATING[b.verdict] > RANG_RATING[a.verdict] ||
    (RANG_RATING[b.verdict] === RANG_RATING[a.verdict] && b.rapport > a.rapport)
      ? b
      : a,
  );
  const vue = vues[pire.i];
  const r = pire.it.detail || (vue != null ? timeline[vue].title : null);
  return {
    texte:
      `Pire mesure Web Vitals rapportée à son seuil, sur ${pluriel(mesures.length, "mesure", "mesures")} : ` +
      `${pire.nom} ${valeurVital(pire.nom, pire.valeur)} sur ${route(r)}, « ${RATING_LABEL[pire.verdict]} » ` +
      `(${texteSeuils(pire.nom)}).`,
    ancre: ancreEvenement(pire.i),
  };
}

/** « le clic “Payer” » ; type lu dans le détail de la ligne d'action (`type · route`). */
function libelleAction(it: TimelineItem): string {
  const type = (it.detail ?? "").split(" · ")[0];
  const nom = it.title ?? it.action_name ?? "sans nom";
  return type === "click" ? `le clic “${nom}”` : `l'action “${nom}”`;
}

function phrasesErreurs(timeline: readonly TimelineItem[], vues: (number | null)[]): PhraseRecit[] {
  const actions = new Map<string, number>();
  timeline.forEach((it, i) => {
    if (it.kind === "action" && it.action_id && !actions.has(it.action_id)) actions.set(it.action_id, i);
  });
  // Groupe = même type, même vue, même action. L'ordre est celui de la première
  // ligne du groupe ; les occurrences d'un groupe se SOMMENT (V1).
  const groupes = new Map<string, { premier: number; type: string; vue: number | null; action: string | null; occ: number | null }>();
  timeline.forEach((it, i) => {
    if (it.kind !== "error") return;
    const type = it.title ?? "Erreur sans type";
    const cle = `${type}\u0000${vues[i]}\u0000${it.action_id ?? ""}`;
    const occ = it.value == null ? null : Number(it.value);
    const g = groupes.get(cle);
    if (!g) groupes.set(cle, { premier: i, type, vue: vues[i], action: it.action_id, occ });
    else g.occ = g.occ == null || occ == null ? null : g.occ + occ;
  });
  const liste = [...groupes.values()];
  const phrases = liste.slice(0, ERREURS_DETAILLEES).map((g): PhraseRecit => {
    const sur = ` sur ${route(g.vue != null ? timeline[g.vue].title : null)}`;
    // Sans `occurrences` renvoyé (schéma antérieur), on ne compte pas des lignes
    // en les appelant « occurrences » (V1) : on le dit.
    let texte =
      g.occ == null
        ? `${g.type}${sur} (nombre d'occurrences non renvoyé)`
        : `${pluriel(g.occ, "occurrence", "occurrences")} de ${g.type}${sur}`;
    const phrase: PhraseRecit = { texte: "", ancre: ancreEvenement(g.premier) };
    const rangAction = g.action ? actions.get(g.action) : undefined;
    if (rangAction != null) {
      const act = timeline[rangAction];
      const delai = Math.max(0, ms(timeline[g.premier].ts) - ms(act.ts));
      const lib = libelleAction(act);
      texte += `, ${duree(delai)} après ${lib}`;
      phrase.action = { texte: lib, ancre: ancreEvenement(rangAction) };
    } else if (g.action && timeline[g.premier].action_name) {
      texte += `, pendant l'action “${timeline[g.premier].action_name}”`;
    }
    phrase.texte = `${texte}.`;
    return phrase;
  });
  const reste = liste.slice(ERREURS_DETAILLEES);
  if (reste.length) {
    const total = reste.every((g) => g.occ != null) ? reste.reduce((s, g) => s + (g.occ as number), 0) : null;
    phrases.push({
      texte:
        `Et ${pluriel(reste.length, "autre groupe", "autres groupes")} d'erreurs` +
        (total == null ? "." : ` (${pluriel(total, "occurrence", "occurrences")}).`),
      ancre: ancreEvenement(reste[0].premier),
    });
  }
  return phrases;
}

/** Libellés des signaux du SDK (`frustration.<kind>`, `packages/rum-sdk/src/frustration.ts`). */
const SIGNAUX: Record<string, [string, string]> = {
  rage: ["salve de clics", "salves de clics"],
  dead: ["clic sans réaction", "clics sans réaction"],
  error: ["erreur pendant une action", "erreurs pendant une action"],
};

function phraseFrustration(timeline: readonly TimelineItem[]): PhraseRecit | null {
  const comptes = new Map<string, number>();
  let premier: number | null = null;
  timeline.forEach((it, i) => {
    if (it.kind !== "event" || !it.title?.startsWith("frustration.")) return;
    premier ??= i;
    const k = it.title.slice("frustration.".length);
    comptes.set(k, (comptes.get(k) ?? 0) + 1);
  });
  if (premier == null) return null;
  const parties = [...comptes].map(([k, n]) => {
    const [un, plusieurs] = SIGNAUX[k] ?? [`signal “${k}”`, `signaux “${k}”`];
    return pluriel(n, un, plusieurs);
  });
  return { texte: `Signaux de frustration reçus : ${parties.join(", ")}.`, ancre: ancreEvenement(premier) };
}

function libelleEvenement(it: TimelineItem): string {
  switch (it.kind) {
    case "pageview": return "vue de page";
    case "vital": return `mesure ${it.title ?? ""}`.trim();
    case "error": return `erreur ${it.title ?? ""}`.trim();
    case "breadcrumb": return "fil d'Ariane";
    case "longtask": return "tâche longue";
    case "event": return it.title ? `événement “${it.title}”` : "événement";
    case "action": return `action “${it.title ?? "sans nom"}”`;
    case "resource": return "ressource";
    case "api": return it.title ? `appel ${it.title}` : "appel API";
  }
}

function phraseFin(timeline: readonly TimelineItem[], vues: (number | null)[]): PhraseRecit {
  const dernier = timeline.length - 1;
  if (timeline.length >= LIMITE_CHRONOLOGIE) {
    return {
      texte: `Récit limité aux ${LIMITE_CHRONOLOGIE} premiers événements reçus : la suite de la session n'y figure pas.`,
      ancre: ancreEvenement(dernier),
    };
  }
  const vue = vues[dernier];
  const lieu = vue != null ? ` sur ${route(timeline[vue].title)}` : "";
  return {
    texte: `Dernière observation${lieu} : ${libelleEvenement(timeline[dernier])}.`,
    ancre: ancreEvenement(dernier),
  };
}

/**
 * Compose le récit, dans l'ordre fixe du plan : parcours, durée observée, pire
 * vital, erreurs, signaux de frustration, fin. Aucun volume minimal : un seul
 * événement suffit ; aucun événement → refus (état vide), jamais un récit creux.
 */
export function composerRecit(e: EntreeRecit): Recit {
  const { timeline } = e;
  if (!timeline.length) {
    return { ok: false, raison: "aucun événement pour cette session", manque: { requis: 1, observe: 0, unite: "événement" } };
  }
  const vues = vuesCourantes(timeline);
  const phrases: PhraseRecit[] = [];
  const parcours = phraseParcours(timeline);
  if (parcours) phrases.push(parcours);
  phrases.push(phraseDuree(e));
  const vital = phrasePireVital(timeline, vues);
  if (vital) phrases.push(vital);
  phrases.push(...phrasesErreurs(timeline, vues));
  const frustration = phraseFrustration(timeline);
  if (frustration) phrases.push(frustration);
  phrases.push(phraseFin(timeline, vues));
  return { ok: true, phrases };
}

/** Ce que le récit dit du rejeu ; `null` quand il est présent et lisible. */
export function mentionRejeu(rejeu: Rejeu | null): string | null {
  switch (rejeu) {
    case "present": return null;
    case "absent": return "Aucun rejeu enregistré pour cette session : le récit ne s'appuie que sur les événements.";
    case "masque": return "Rejeu enregistré avec masquage : ce qui était masqué à l'enregistrement n'y figure pas.";
    case null: return "Présence d'un rejeu non vérifiée : la lecture a échoué.";
  }
}
