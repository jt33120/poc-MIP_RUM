// LA RÉPONSE PAR RÈGLES — l'assistant sans modèle d'IA (30/09/2026).
//
// Tant qu'aucune clé de modèle n'est posée (la CI, les postes de développement, la
// production avant que le responsable ne l'ajoute), et chaque fois que le modèle ne
// répond pas, l'assistant répond quand même : par règles, à partir du condensé du
// tableau de bord (`digest.ts`). Quatre questions sont reconnues — l'état du jour, les
// pages lentes, les erreurs et alertes, ce qui a changé — et toute autre reçoit le
// résumé, précédé de ce que l'assistant sait faire sans modèle.
//
// MÊMES RÈGLES QUE LE MODÈLE. Des phrases courtes et chiffrées ; chaque affirmation se
// termine par la citation de ses faits (« [F3] ») ; pas de fait, pas d'affirmation.
// La réponse est une fonction PURE : elle tourne sur le serveur (route sans clé) comme
// dans le navigateur (session de démonstration, route injoignable).
import type { Digest, FaitDigest } from "./digest";

export type ModeReponse = "regles" | "modele";
export type Intention = "resume" | "lenteur" | "erreurs" | "changements" | "autre";

export interface ReponseAssistant {
  mode: ModeReponse;
  intention?: Intention;
  /** Des lignes séparées par « \n » ; la première est la phrase-verdict. Citations écrites entre crochets. */
  texte: string;
  /** Identifiants des faits cités, dans l'ordre de leur première apparition. */
  citations: string[];
  /** Ce que la réponse doit dire d'elle-même : mode de repli, citations écartées… */
  avertissement?: string;
  /** Le modèle qui a répondu, en mode « modele ». */
  modele?: string;
}

/** Les questions proposées à l'ouverture du volet (charte § 5.2 : trois ou quatre, propres à l'écran). */
export const QUESTIONS_SUGGEREES = [
  "Résume l'état de mon application aujourd'hui",
  "Quelles pages sont les plus lentes ?",
  "Y a-t-il des erreurs ou des alertes en cours ?",
  "Qu'est-ce qui a changé depuis la période précédente ?",
] as const;

/** Au plus huit phrases : le volet se lit d'un coup d'œil, le détail est sur la page. */
const MAX_PHRASES = 8;

// ─────────────────────────────────── Citations ───────────────────────────────────

/** Une citation, seule ou groupée : « [F3] », « [F3, F5] », « [F3 ; F5] ». */
const CITATION = /\[\s*(F\d{1,3}(?:\s*[,;]\s*F\d{1,3})*)\s*\]/g;

/** Les identifiants cités par un texte, dans l'ordre de leur première apparition. */
export function citationsDe(texte: string): string[] {
  const vus: string[] = [];
  for (const m of texte.matchAll(CITATION)) {
    for (const id of m[1].split(/\s*[,;]\s*/)) if (!vus.includes(id)) vus.push(id);
  }
  return vus;
}

/**
 * Le texte d'une réponse, ses citations INCONNUES retirées (un modèle qui cite un fait
 * qui n'existe pas n'a pas de source : la citation tombe, et la réponse le dit). Les
 * groupes (« [F3, F5] ») sont réécrits en citations simples (« [F3][F5] »).
 */
export function filtrerCitations(texte: string, connus: ReadonlySet<string>): { texte: string; citations: string[]; inconnues: string[] } {
  const inconnues: string[] = [];
  const sortie = texte.replace(CITATION, (_m, groupe: string) => {
    const ids = groupe.split(/\s*[,;]\s*/);
    const gardes = ids.filter((id) => connus.has(id));
    for (const id of ids) if (!connus.has(id) && !inconnues.includes(id)) inconnues.push(id);
    return gardes.map((id) => `[${id}]`).join("");
  });
  const propre = sortie
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,])/g, "$1").trimEnd())
    .join("\n")
    .trim();
  return { texte: propre, citations: citationsDe(propre), inconnues };
}

export type Segment = { texte: string } | { ids: string[] };

/** Une ligne découpée en texte et en citations, pour que le volet dessine des pastilles. */
export function segmenterCitations(ligne: string): Segment[] {
  const segments: Segment[] = [];
  let depuis = 0;
  for (const m of ligne.matchAll(CITATION)) {
    const i = m.index ?? 0;
    if (i > depuis) segments.push({ texte: ligne.slice(depuis, i) });
    const ids = m[1].split(/\s*[,;]\s*/);
    const precedent = segments[segments.length - 1];
    // Deux citations accolées (« [F3][F5] ») forment un seul groupe de pastilles.
    if (precedent && "ids" in precedent && i === depuis) precedent.ids.push(...ids.filter((id) => !precedent.ids.includes(id)));
    else segments.push({ ids });
    depuis = i + m[0].length;
  }
  if (depuis < ligne.length) segments.push({ texte: ligne.slice(depuis) });
  return segments;
}

// ─────────────────────────────────── Intention ───────────────────────────────────

/** Minuscules, sans accents : « Qu'est-ce qui a changé » → « qu'est-ce qui a change ». */
function normaliser(question: string): string {
  return question.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const MOTS: readonly [Intention, RegExp][] = [
  ["erreurs", /erreur|alerte|incident|bug|plant|crash|exception|panne|regress/],
  ["lenteur", /\blent|lenteur|rapide|vitesse|temps de chargement|\blcp\b|\binp\b|\bfcp\b|\bttfb\b|\bcls\b|vital|perf/],
  ["changements", /chang|evolu|precedent|hier|avant|depuis|release|deploi|version|tendance|progress|compar|hausse|baisse/],
  ["resume", /resum|etat|synthese|bilan|comment va|aujourd|situation|ensemble|point|sante/],
];

/** Ce que demande la question, par mots-clés ; « autre » quand rien ne la reconnaît. */
export function intentionDe(question: string): Intention {
  const q = normaliser(question);
  // La demande explicite d'un résumé l'emporte : « Résume les erreurs » reste un résumé… des erreurs.
  if (/^\s*(resume|synthetise)/.test(q)) {
    for (const [intention, motif] of MOTS.slice(0, 3)) if (motif.test(q.replace(/^\s*\S+/, ""))) return intention;
    return "resume";
  }
  for (const [intention, motif] of MOTS) if (motif.test(q)) return intention;
  return "autre";
}

// ─────────────────────────────── Outils de phrase ───────────────────────────────

const cite = (...faits: (FaitDigest | undefined)[]) =>
  faits
    .filter((f): f is FaitDigest => f !== undefined)
    .map((f) => `[${f.id}]`)
    .join("");

/** Une phrase et ses sources : « Corps [F3]. » — jamais de phrase chiffrée sans source. */
const phrase = (corps: string, ...faits: (FaitDigest | undefined)[]) => {
  const sources = cite(...faits);
  return `${corps}${sources ? ` ${sources}` : ""}.`;
};

const fait = (d: Digest, cle: string) => d.faits.find((f) => f.cle === cle);
const faits = (d: Digest, prefixe: string) => d.faits.filter((f) => f.cle.startsWith(prefixe));
const connue = (f: FaitDigest | undefined): f is FaitDigest => f !== undefined && f.valeur !== "—";

const VITAUX = ["LCP", "INP", "CLS", "FCP", "TTFB"];
const GRAVITE: Record<string, number> = { mauvais: 0, moyen: 1, neutre: 2, bon: 3 };
const VERDICT: Record<string, string> = { bon: "Bon", moyen: "À améliorer", mauvais: "Mauvais" };

/** Le premier segment du détail : le mot du verdict de la santé (« Bon », « Dégradé »…). */
const premierSegment = (f: FaitDigest) => f.detail?.split(" · ")[0] ?? "";
/** Le nom d'un segment classé, tel que la table l'écrit : « /checkout », « Safari ». */
const nomSegment = (f: FaitDigest) => /«\s*(.+?)\s*»/.exec(f.libelle)?.[1] ?? f.libelle.split(" · ")[0];
const variation = (f: FaitDigest) => (f.variation ? ` (${f.variation})` : "");
const motVerdict = (f: FaitDigest) => f.verdict ?? (f.ton ? VERDICT[f.ton] : undefined);
/** « (Mauvais) », « (À améliorer ou Mauvais, incertain) » : le verdict écrit par la case. */
const verdictEntre = (f: FaitDigest) => {
  const mot = motVerdict(f);
  return mot ? ` (${mot})` : "";
};
/** « (+6,1 s vs ensemble, Mauvais) » : la variation et le verdict, dans UNE parenthèse. */
const precisions = (f: FaitDigest) => {
  const parts = [f.variation, motVerdict(f)].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
};
/** Le premier segment du détail qui commence par « le » : l'instant d'un pic, d'une anomalie. */
const instant = (f: FaitDigest) => f.detail?.split(" · ").find((x) => x.startsWith("le ")) ?? null;
const avecInstant = (corps: string, f: FaitDigest) => {
  const quand = instant(f);
  return quand ? `${corps}, ${quand}` : corps;
};

function casesVitales(d: Digest): FaitDigest[] {
  return VITAUX.map((v) => fait(d, `tuile:${v}`)).filter(connue);
}

/** Le classement affiché : sa dimension, son vital, et la case du vital pour l'ensemble du site. */
function classement(d: Digest) {
  const resume = faits(d, "segments:")[0];
  if (!resume) return null;
  const [, dimension = "", vital = "LCP"] = resume.cle.split(":");
  return { resume, parPage: dimension === "route", ensemble: fait(d, `tuile:${vital}`) };
}

// ──────────────────────────────── Les quatre réponses ────────────────────────────────

function phraseSante(d: Digest): string[] {
  const s = fait(d, "sante");
  if (!s) return [];
  if (s.valeur === "—") return [phrase(`Santé non calculable sur la période (${s.detail ?? "données insuffisantes"})`, s)];
  const lignes = [phrase(`Santé ${s.valeur}, ${premierSegment(s)} (${d.periode})`, s)];
  const retrait = faits(d, "sante:")
    .filter((f) => (f.poids ?? 0) >= 1)
    .sort((a, b) => (b.poids ?? 0) - (a.poids ?? 0))[0];
  if (retrait) lignes.push(phrase(`Le plus gros retrait vient de la composante « ${retrait.libelle.replace(/^Santé · /, "")} » : ${retrait.valeur}`, retrait));
  return lignes;
}

function phraseVitaux(d: Digest): string[] {
  const cases = casesVitales(d);
  const horsVert = cases.filter((f) => f.ton === "mauvais" || f.ton === "moyen").sort((a, b) => GRAVITE[a.ton!] - GRAVITE[b.ton!]);
  if (horsVert.length) {
    const liste = horsVert.map((f) => `${f.libelle} ${f.valeur}${verdictEntre(f)} ${cite(f)}`).join(", ");
    return [`${horsVert.length} ${horsVert.length > 1 ? "Web Vitals hors du vert" : "Web Vital hors du vert"} : ${liste}.`];
  }
  const bons = cases.filter((f) => f.ton === "bon");
  if (bons.length) return [`Web Vitals au vert au 75ᵉ centile : ${bons.slice(0, 3).map((f) => `${f.libelle} ${f.valeur} ${cite(f)}`).join(", ")}.`];
  return [];
}

/** Le constat le plus grave : alerte, régression ou erreur nouvelle, puis écart de priorité haute, puis le reste. */
function constatPrincipal(d: Digest): FaitDigest | undefined {
  const liste = [...faits(d, "constat:"), ...faits(d, "detecte:")];
  return liste.sort((a, b) => GRAVITE[a.ton ?? "neutre"] - GRAVITE[b.ton ?? "neutre"])[0];
}

function phraseConstats(d: Digest): string[] {
  const c = fait(d, "constats");
  if (!c) return [];
  const principal = constatPrincipal(d);
  if (!principal) return [phrase(`Aucun constat automatique ni alerte en cours`, c)];
  return [phrase(`${c.valeur} en cours ; le plus grave : ${principal.libelle.toLowerCase()}, « ${principal.valeur} »`, c, principal)];
}

function phraseErreurs(d: Digest): string[] {
  const e = fait(d, "tuile:erreurs");
  if (!connue(e)) return [];
  return [phrase(`Erreurs : ${e.valeur} des pages vues${variation(e)}`, e)];
}

function phraseTrafic(d: Digest): string[] {
  const sessions = fait(d, "tuile:sessions");
  const vues = fait(d, "tuile:pages-vues");
  const parts = [
    connue(sessions) ? `${sessions.valeur}${variation(sessions)} ${cite(sessions)}` : null,
    connue(vues) ? `${vues.valeur}${variation(vues)} ${cite(vues)}` : null,
  ].filter(Boolean);
  return parts.length ? [`Trafic : ${parts.join(" et ")}.`] : [];
}

function phrasePlusLent(d: Digest): string[] {
  const c = classement(d);
  const premier = faits(d, "segment:")[0];
  if (!c || !premier) return [];
  const vital = premier.libelle.split(" · ")[1] ?? "";
  const nom = `« ${nomSegment(premier)} », ${vital} ${premier.valeur}${variation(premier)}`;
  if (premier.degradation === false) {
    // La plus lente des pages assez mesurées est PLUS RAPIDE que l'ensemble : le dire.
    return [phrase(`${c.parPage ? "Aucune page assez mesurée n'est plus lente" : "Aucun segment assez mesuré n'est plus lent"} que l'ensemble ; en tête : ${nom}`, premier)];
  }
  return [phrase(`${c.parPage ? "Page la plus lente" : "Segment le plus lent"} : ${nom}`, premier)];
}

function phraseRelease(d: Digest): string[] {
  const r = fait(d, "release");
  return r ? [phrase(`${r.libelle} : ${r.valeur}`, r)] : [];
}

function lignesResume(d: Digest): string[] {
  const sansVisite = fait(d, "sans-visite");
  return [
    ...(sansVisite ? [phrase(`Aucune visite sur la période : rien n'a été mesuré`, sansVisite)] : []),
    ...phraseSante(d),
    ...phraseVitaux(d),
    ...phraseConstats(d),
    ...phraseErreurs(d),
    ...phraseTrafic(d),
    ...phrasePlusLent(d),
    ...phraseRelease(d),
  ];
}

function lignesLenteur(d: Digest): string[] {
  const lignes: string[] = [];
  const c = classement(d);
  const fiables = faits(d, "segment:");
  const faibles = faits(d, "segment-faible:");
  if (c && (fiables.length || faibles.length)) {
    const plusLents = fiables.filter((f) => f.degradation === true);
    const reference = c.ensemble ? ` (${c.ensemble.libelle} ${c.ensemble.valeur})` : "";
    if (!c.parPage) lignes.push(phrase(`Le classement affiché est ${c.resume.libelle.replace(/^Segments classés /, "")}, pas par page`, c.resume));
    const n = plusLents.length;
    lignes.push(
      phrase(
        c.parPage
          ? n === 0
            ? `Aucune page assez mesurée n'est plus lente que l'ensemble du site${reference}`
            : `${n > 1 ? `${n} pages assez mesurées sont plus lentes` : "Une page assez mesurée est plus lente"} que l'ensemble du site${reference}`
          : n === 0
            ? `Aucun segment assez mesuré n'est plus lent que l'ensemble${reference}`
            : `${n > 1 ? `${n} segments assez mesurés sont plus lents` : "Un segment assez mesuré est plus lent"} que l'ensemble${reference}`,
        c.resume,
        c.ensemble,
      ),
    );
    for (const f of n ? plusLents : fiables.slice(0, 3)) lignes.push(phrase(`« ${nomSegment(f)} » : ${f.valeur}${precisions(f)}`, f));
    if (faibles.length) {
      lignes.push(`Sur trop peu de mesures pour conclure : ${faibles.map((f) => `« ${nomSegment(f)} » ${f.valeur} ${cite(f)}`).join(", ")}.`);
    }
  } else {
    const lcp = fait(d, "tuile:LCP");
    if (connue(lcp)) lignes.push(phrase(`Ensemble du site : ${lcp.libelle} ${lcp.valeur}${verdictEntre(lcp)}`, lcp));
  }
  for (const a of faits(d, "anomalie:").slice(0, 2)) lignes.push(phrase(avecInstant(`${a.libelle} : ${a.valeur}`, a), a));
  const latence = fait(d, "latence");
  if (latence) lignes.push(phrase(avecInstant(`Heure la plus lente : ${latence.libelle.replace(/ horaire le plus haut$/, "")} ${latence.valeur}`, latence), latence));
  if (!lignes.length) return ["Les chiffres de ce tableau de bord ne classent pas les pages sur cette période."];
  return lignes;
}

function lignesErreurs(d: Digest): string[] {
  const lignes: string[] = [];
  const c = fait(d, "constats");
  const alertes = faits(d, "constat:alerte:");
  const reapparues = [...faits(d, "constat:regression:"), ...faits(d, "constat:erreur_nouvelle:")];
  if (alertes.length) lignes.push(phrase(alertes.length > 1 ? `${alertes.length} alertes en cours` : "Une alerte en cours", c, ...alertes.slice(0, 1)));
  else if (c) lignes.push(phrase(`Aucune alerte non acquittée en cours`, c));
  const e = fait(d, "tuile:erreurs");
  if (connue(e)) lignes.push(phrase(`Erreurs : ${e.valeur} des pages vues${variation(e)}`, e));
  for (const a of alertes.slice(0, 3)) lignes.push(phrase(`Alerte : « ${a.valeur} »`, a));
  for (const r of reapparues.slice(0, 3)) lignes.push(phrase(`${r.libelle} : « ${r.valeur} »`, r));
  const pic = fait(d, "charge:erreurs");
  if (pic) lignes.push(phrase(avecInstant(`Pic d'erreurs navigateur : ${pic.valeur}`, pic), pic));
  const composante = fait(d, "sante:errors");
  if (connue(composante)) lignes.push(phrase(`Composante « ${composante.libelle.replace(/^Santé · /, "")} » de la santé : ${composante.valeur}`, composante));
  if (!lignes.length) return ["Les chiffres de ce tableau de bord ne disent rien des erreurs ni des alertes sur cette période."];
  return lignes;
}

const RAISON_SANS_VARIATION = /variation non affichée : ([^·]+)/;

function lignesChangements(d: Digest): string[] {
  const lignes: string[] = [];
  const variations = d.faits
    .filter((f) => f.cle.startsWith("tuile:") && f.ecartPct !== undefined && Math.abs(Math.round(f.ecartPct)) >= 2)
    .sort((a, b) => Number(b.degradation === true) - Number(a.degradation === true) || Math.abs(b.ecartPct!) - Math.abs(a.ecartPct!));
  const defavorables = variations.filter((f) => f.degradation === true).length;
  if (variations.length) {
    const tete = variations[0];
    const combien = variations.length > 1 ? `${variations.length} mesures ont bougé` : "Une mesure a bougé";
    lignes.push(phrase(`${combien}, dont ${defavorables} dans le mauvais sens ; la plus forte : ${tete.libelle}${variation(tete)}`, tete));
    for (const f of variations.slice(1, 5)) lignes.push(phrase(`${f.libelle} : ${f.valeur}${variation(f)}`, f));
  } else {
    // Aucune variation : la raison est écrite par la case (période incomplète, pas de mesure…).
    const raison = d.faits.find((f) => f.cle.startsWith("tuile:") && RAISON_SANS_VARIATION.test(f.detail ?? ""));
    if (raison) lignes.push(phrase(`Aucune variation affichée : ${RAISON_SANS_VARIATION.exec(raison.detail!)![1].trim()}`, raison));
    else lignes.push("Le tableau de bord ne compare pas cette période à une autre : aucune variation n'est affichée.");
  }
  const deploiement = fait(d, "deploiement");
  if (connue(deploiement)) lignes.push(phrase(`Dernier déploiement : ${deploiement.valeur}${deploiement.detail ? `, ${deploiement.detail}` : ""}`, deploiement));
  const release = fait(d, "release");
  if (release) lignes.push(phrase(`${release.libelle} : ${release.valeur}${variation(release)}`, release));
  const datation = fait(d, "datation");
  if (datation) lignes.push(phrase(`${datation.libelle} : ${datation.valeur}`, datation));
  for (const x of faits(d, "detecte:").slice(0, 2)) lignes.push(phrase(`Écart détecté : « ${x.valeur} »`, x));
  const regression = faits(d, "constat:regression:").find((f) => /^Déploiement/.test(f.valeur));
  if (regression) lignes.push(phrase(`« ${regression.valeur} »`, regression));
  return lignes;
}

/** Qu'y a-t-il à dire sans aucun fait ? Rien — et la réponse le dit, sans rien affirmer. */
const SANS_FAIT = "Aucun chiffre n'est lisible sur ce tableau de bord : rien à résumer.";

/** La réponse par règles à une question, sur le condensé du tableau de bord. */
export function repondreParRegles(question: string, digest: Digest): ReponseAssistant {
  const intention = intentionDe(question);
  let lignes: string[];
  if (digest.faits.length === 0) lignes = [SANS_FAIT];
  else if (intention === "lenteur") lignes = lignesLenteur(digest);
  else if (intention === "erreurs") lignes = lignesErreurs(digest);
  else if (intention === "changements") lignes = lignesChangements(digest);
  else if (intention === "resume") lignes = lignesResume(digest);
  else
    lignes = [
      "Sans modèle d'IA, l'assistant répond aux questions de ce tableau de bord : l'état du jour, les pages lentes, les erreurs et alertes, ce qui a changé. Voici le résumé.",
      ...lignesResume(digest),
    ];
  const texte = lignes.slice(0, intention === "autre" ? MAX_PHRASES + 1 : MAX_PHRASES).join("\n");
  return { mode: "regles", intention, texte, citations: citationsDe(texte) };
}

/** Le résumé de l'état du tableau de bord : la réponse à la première question suggérée. */
export function resumerEtat(digest: Digest): ReponseAssistant {
  return repondreParRegles(QUESTIONS_SUGGEREES[0], digest);
}
