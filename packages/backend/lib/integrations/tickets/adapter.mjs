// Connecteur de tickets — le contrat commun, indépendant du fournisseur (P8.6).
//
// POURQUOI CE FICHIER EXISTE ALORS QU'UN SEUL FOURNISSEUR EST IMPLÉMENTÉ.
// GitHub Issues a été retenu pour une raison d'opportunité : le dépôt y est
// déjà, l'authentification existe, aucun compte ni coût nouveau, et c'est le
// seul fournisseur éprouvable de bout en bout aujourd'hui. Ce n'est pas la
// destination : la cible reste l'outil ITSM de MIP — ServiceNow, SOUS RÉSERVE
// DE CONFIRMATION (l'information vient du dialogue produit, personne ne l'a
// encore vérifiée). Écrire l'interface maintenant, pendant qu'on n'a qu'un
// fournisseur, est ce qui permettra d'en brancher un second sans refondre la
// file de sortie, le journal, la console et les webhooks.
//
// CE QU'UN ADAPTATEUR DOIT FOURNIR, et rien de plus :
//
//   createIssue({ cible, secret, charge, reference, signal })
//     → { externalId, url, etat }              le ticket a été créé
//     ✗ ErreurTicket                           refus qualifié (cf. CODES)
//
//   getIssue({ cible, secret, externalId, signal })
//     → { externalId, url, etat }              etat ∈ open | closed | unknown
//
//   chercherParReference({ cible, secret, reference, depuis, signal })
//     → { concluante: true, trouve: {...}|null } | { concluante: false, raison }
//     Appelée APRÈS une incertitude de livraison, jamais avant : elle répond à
//     « ce ticket existe-t-il déjà ? », et sa réponse décide entre rejouer et
//     appeler un opérateur. Un adaptateur qui ne peut pas répondre de façon
//     FIABLE doit rendre `concluante: false` — un index de recherche à
//     cohérence différée en fait partie, et mentir ici crée des doublons chez
//     le client.
//
//   validateWebhook({ secret, entetes, corps })
//     → { ok: true, deliveryId, type } | { ok: false, raison }
//     Comparaison à TEMPS CONSTANT, mécanisme OFFICIEL du fournisseur.
//
//   normalizeWebhook({ entetes, corps })
//     → { deliveryId, type, externalId, action, etat }
//     Traduit un corps propriétaire en vocabulaire MIP. Ne décide rien.
//
// CE QUI SORT DE MIP, ET RIEN D'AUTRE. `construireCharge` est l'unique endroit
// où le contenu d'un ticket est composé : message scrubbé, application, release,
// compteur observé, lien console. La pile complète et les identités restent
// dans la console — un ticket est lu par des gens qui n'ont pas les droits RUM.
// L'écran d'administration affiche le résultat de CETTE fonction, et la file de
// sortie fige ce même objet : l'aperçu n'est pas « fidèle », il est identique.
import { scrubText } from "../../../shared/scrub.mjs";

/** Fournisseurs implémentés. Un ajout ici sans choix explicite est un refus du plan. */
export const PROVIDERS = ["github"];

/** Bornes du contenu envoyé. Un fournisseur plus strict borne à son tour. */
export const TITRE_MAX = 200;
export const DESCRIPTION_MAX = 8000;
export const MESSAGE_MAX = 300;

/**
 * La mention affichée partout où un ticket est créé ou montré, et recopiée dans
 * le corps du ticket lui-même. Une seule définition : l'écran d'administration,
 * l'écran d'issue et le ticket distant disent le même texte, et un futur
 * changement de fournisseur se fait ici.
 *
 * La réserve est écrite telle quelle, à dessein : personne n'a confirmé
 * ServiceNow, et une documentation qui affirme plus que ce qu'on sait est un
 * piège pour celui qui la lira dans six mois.
 */
export const MENTION_ETAPE =
  "GitHub Issues est l'implémentation actuelle du connecteur de tickets. " +
  "La cible reste l'outil ITSM de MIP — ServiceNow, sous réserve de confirmation.";

/** Préfixe de la référence MIP portée par le corps du ticket. */
export const REFERENCE_PREFIXE = "MIP-RUM-ISSUE";

/**
 * Référence MIP d'une issue, telle qu'elle est écrite dans le corps du ticket.
 * C'est elle qu'on cherche chez le fournisseur quand une livraison est
 * incertaine : sans elle, on ne saurait pas distinguer « le ticket existe » de
 * « le ticket n'existe pas », et on créerait un doublon.
 */
export function referenceMip(issueId) {
  return `${REFERENCE_PREFIXE}:${issueId}`;
}

/** Codes d'échec. Ils voyagent en base ; aucun ne cite une valeur de donnée. */
export const CODES = {
  /** Jeton absent, révoqué ou sans droit : l'intégration passe en `degraded`. */
  auth: "auth_refusee",
  /** Cible inconnue ou inaccessible (dépôt supprimé, renommé, privé). */
  cible: "cible_introuvable",
  /** Champs refusés par le fournisseur (validation distante). */
  invalide: "charge_refusee",
  /** Débit dépassé : rejouable, avec l'attente demandée par le fournisseur. */
  debit: "debit_depasse",
  /** Panne distante : rejouable. */
  distant: "erreur_distante",
  /** Délai dépassé ou coupure : le ticket a PEUT-ÊTRE été créé. */
  incertain: "livraison_incertaine",
  /** Réponse illisible : ni un succès, ni une preuve d'absence. */
  reponse: "reponse_illisible",
};

/** Échec qualifié d'un adaptateur. `incertain` interdit tout rejeu direct. */
export class ErreurTicket extends Error {
  /**
   * @param {string} code      un des CODES
   * @param {{rejouable?: boolean, incertain?: boolean, degrade?: boolean, attendreSec?: number|null}} [options]
   */
  constructor(code, { rejouable = false, incertain = false, degrade = false, attendreSec = null } = {}) {
    super(code);
    this.name = "ErreurTicket";
    this.code = code;
    this.rejouable = rejouable;
    this.incertain = incertain;
    this.degrade = degrade;
    this.attendreSec = attendreSec;
  }
}

/**
 * Stratégie de rejeu, exposée pour être testée et documentée plutôt que
 * dispersée dans le dispatcher. Reculs de 30 s × 2^tentatives, plafonnés à
 * 30 min, et 6 tentatives au plus.
 *
 * `attendreSec` (Retry-After d'un 429) GAGNE sur le recul calculé, même s'il est
 * plus long : le fournisseur sait mieux que nous quand il acceptera d'être
 * rappelé, et le contredire fait durer le blocage.
 */
export const STRATEGIE = { baseMs: 30_000, plafondMs: 30 * 60_000, tentativesMax: 6 };

/** Instant de la prochaine tentative, en millisecondes epoch. */
export function prochaineTentative(tentatives, { attendreSec = null, maintenant = Date.now() } = {}) {
  const recul = Math.min(STRATEGIE.baseMs * 2 ** Math.max(0, tentatives - 1), STRATEGIE.plafondMs);
  const demande = Number.isFinite(attendreSec) && attendreSec !== null ? Math.max(0, attendreSec) * 1000 : 0;
  return maintenant + Math.max(recul, demande);
}

/** Tronque à `max` points de code, en annonçant la troncature. */
export function tronquer(texte, max) {
  const points = [...texte];
  return points.length <= max ? texte : `${points.slice(0, max - 1).join("")}…`;
}

/**
 * Coupe un message à la première ligne qui ressemble à une TRAME DE PILE.
 *
 * On n'envoie jamais la colonne `stack` — mais un émetteur qui concatène son
 * message et sa pile dans le seul champ `message` la ferait sortir malgré tout.
 * Les deux formes courantes suffisent : `    at Objet.methode (fichier:12:3)`
 * (V8, JavaScriptCore) et `methode@fichier:12:3` (SpiderMonkey). Couper à la
 * PREMIÈRE plutôt que les filtrer une à une : ce qui suit une trame est de la
 * pile, pas du message.
 */
function sansPile(texte) {
  const lignes = texte.split(/\r?\n/);
  const i = lignes.findIndex((l) => /^\s*at\s+\S/.test(l) || /^\s*\S+@\S+:\d+:\d+\s*$/.test(l));
  return (i === -1 ? lignes : lignes.slice(0, i)).join("\n");
}

/**
 * Valeur affichable d'une donnée qui peut manquer. Une inconnue s'écrit
 * « Inconnue », jamais `0` ni une chaîne vide : un lecteur de ticket ne doit pas
 * pouvoir confondre « pas de release » avec « release absente du relevé ».
 */
function ouInconnue(v) {
  const texte = typeof v === "string" ? v.trim() : "";
  return texte ? texte : "Inconnue";
}

/**
 * Le contenu EXACT d'un ticket, à partir de l'état d'une issue.
 *
 * @param {{
 *   issueId: string, appId: string, errorType: string|null, message: string|null,
 *   firstRelease: string|null, lastRelease: string|null,
 *   occurrences: number|null, firstSeen: Date|string|null, lastSeen: Date|string|null
 * }} issue
 * @param {{consoleBase: string}} contexte  origine de la console, pour le lien
 * @returns {{titre: string, description: string, url: string, reference: string}}
 */
export function construireCharge(issue, { consoleBase }) {
  const url = urlConsole(issue, consoleBase);
  const reference = referenceMip(issue.issueId);
  const type = (issue.errorType ?? "").trim() || "Erreur";
  // Le message repasse par le scrub serveur : il a déjà été nettoyé à
  // l'ingestion, mais ce fichier est le dernier point avant une sortie hors de
  // MIP. Nettoyer deux fois coûte un passage de regex ; ne pas le faire coûte
  // une fuite qu'aucune relecture ne rattrape.
  const brut = scrubText(issue.message ?? "") ?? "";
  const message = tronquer(sansPile(brut).replaceAll(" ", "").replace(/\s+/g, " ").trim(), MESSAGE_MAX);
  const titre = tronquer(`[MIP RUM] ${type}${message ? ` — ${message}` : ""}`, TITRE_MAX);

  // `occurrences` est un compteur OBSERVÉ (somme des répétitions reçues), pas une
  // estimation : on le dit, parce qu'un lecteur de ticket le prendrait sinon pour
  // un nombre d'utilisateurs touchés.
  const compteur =
    Number.isFinite(issue.occurrences) && issue.occurrences !== null
      ? `${Number(issue.occurrences).toLocaleString("fr-FR")} (somme des répétitions réellement reçues)`
      : "Inconnu";

  const description = tronquer(
    [
      `Issue MIP RUM \`${issue.issueId}\` — application \`${issue.appId}\`.`,
      "",
      `- **Type** : ${type}`,
      `- **Message (nettoyé)** : ${message || "Inconnu"}`,
      `- **Occurrences observées** : ${compteur}`,
      `- **Release de première vue** : ${ouInconnue(issue.firstRelease)}`,
      `- **Release de dernière vue** : ${ouInconnue(issue.lastRelease)}`,
      `- **Première vue** : ${horodatage(issue.firstSeen)}`,
      `- **Dernière vue** : ${horodatage(issue.lastSeen)}`,
      "",
      `Détail complet dans la console : ${url}`,
      "",
      "La pile d'appels complète et les identités ne sont pas transmises : elles restent dans MIP RUM,",
      "derrière son contrôle d'accès. Ce ticket ne contient que ce qui est nécessaire pour le suivre.",
      "",
      `Référence MIP : \`${reference}\` (ne pas retirer : elle sert à retrouver ce ticket sans en créer un second).`,
      "",
      `_${MENTION_ETAPE}_`,
    ].join("\n"),
    DESCRIPTION_MAX,
  );

  return { titre, description, url, reference };
}

/** Lien console d'une issue, sur l'origine configurée. */
export function urlConsole(issue, consoleBase) {
  const base = String(consoleBase ?? "").replace(/\/+$/, "");
  return `${base}/errors/issues/${encodeURIComponent(issue.issueId)}?app=${encodeURIComponent(issue.appId)}`;
}

function horodatage(v) {
  if (!v) return "Inconnue";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "Inconnue" : `${d.toISOString().replace(".000", "")} (UTC)`;
}

/**
 * Comparaison d'octets à temps constant, sans dépendance au `Buffer` de Node
 * (le même code sert au port Deno). Deux longueurs différentes rendent `false`
 * immédiatement : la longueur d'une signature n'est pas un secret, sa valeur si.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
export function egalTempsConstant(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Octets d'une signature hexadécimale, ou null si la forme n'est pas hexadécimale. */
export function octetsHex(hex) {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Le statut MIP proposé par un événement de fournisseur, selon le mapping
 * EXPLICITEMENT configuré. Pas de mapping, pas de changement : un connecteur qui
 * décide tout seul qu'un ticket fermé résout une issue impose une politique que
 * personne n'a choisie.
 *
 * MIP reste source de vérité pour `ignored` : une issue ignorée l'a été par un
 * humain qui a regardé la donnée, le fournisseur ne sait rien de cette décision.
 *
 * @param {{action: string, etat: string}} evenement
 * @param {{closed?: string|null, reopened?: string|null}} mapping
 * @param {string} statutActuel
 * @returns {{statut: string}|{statut: null, raison: string}}
 */
export function statutPropose(evenement, mapping, statutActuel) {
  if (statutActuel === "ignored") return { statut: null, raison: "mip_source_de_verite" };
  const cle = evenement.action === "reopened" ? "reopened" : evenement.action === "closed" ? "closed" : null;
  if (!cle) return { statut: null, raison: "action_non_suivie" };
  const propose = mapping?.[cle] ?? null;
  if (!propose) return { statut: null, raison: "mapping_absent" };
  if (propose === statutActuel) return { statut: null, raison: "deja_a_cet_etat" };
  return { statut: propose };
}

/** Mapping de statut lu dans la configuration d'une intégration ; jamais deviné. */
export function mappingStatut(config) {
  const brut = config && typeof config === "object" ? config.statusMapping : null;
  const valide = (v) => (v === "open" || v === "for_review" || v === "resolved" ? v : null);
  return {
    closed: valide(brut?.closed),
    reopened: valide(brut?.reopened),
  };
}
