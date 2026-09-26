// Ce qui distingue deux groupes d'erreurs de même titre — logique PURE, testée
// (tests/unit/erreurs-distinction.test.ts), sans accès base.
//
// POURQUOI (recette du 26/09/2026). Neuf groupes s'intitulaient « Uncaught Error:
// Erreur de démo MIP RUM » : seule une empreinte hexadécimale les séparait, sans
// dire pourquoi ils étaient distincts ni lequel traiter. L'empreinte d'un groupe
// tient au type, au message ET à la première ligne de pile applicative : c'est donc
// cette ligne (fonction · fichier:ligne) qui les distingue, et la route où le groupe
// survient le plus aide à le situer. La liste les écrit sous le titre.

/** Ce que la lecture rend pour un groupe (`distinctionsDesGroupes`, lib/queries-errors.ts). */
export interface DistinctionLue {
  /** Pile du dernier exemplaire qui en porte une ; `null` sans pile. */
  pile: string | null;
  /** Fichier, ligne et colonne déclarés par le navigateur (sans pile). */
  fichier: string | null;
  ligne: number | null;
  /** Route la plus fréquente du groupe sur la fenêtre (Σ occurrences) ; `null` : aucune route déclarée. */
  route: string | null;
  /** Part des occurrences de cette route, entre 0 et 1. */
  partRoute: number | null;
}

const FRAME_V8 = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):\d+\)?\s*$/;
const FRAME_GECKO_JSC = /^\s*(?:([^@]*)@)?(.+?):(\d+)(?::\d+)?\s*$/;
const FRAME_PYTHON = /^\s*File "(.+)", line (\d+)(?:, in (.+?))?\s*$/;

/** Dernier segment d'un chemin ou d'une URL, sans requête ni ancre : « app.js ». */
export function nomDeFichier(chemin: string): string {
  const sansRequete = chemin.split(/[?#]/)[0];
  const segments = sansRequete.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : sansRequete;
}

const SCRIPT = /\.(?:m?js|cjs|jsx|mts|cts|tsx?|vue|svelte|py|css|html?)$/i;

/**
 * Où se trouve une ligne de pile, dit pour un lecteur : le nom du script
 * (« app.js:42 ») ; pour un script INTÉGRÉ à une page, le « fichier » de la pile
 * est l'adresse de la page — on écrit alors son chemin, sans requête (« page
 * /partners/108, ligne 79 »). Dans la recette du 26/09/2026, c'était précisément ce
 * qui séparait les groupes au même titre.
 */
export function lieuDeLigne(fichier: string, ligne: number | string | null): string {
  let url: URL | null = null;
  try {
    url = new URL(fichier);
  } catch {
    url = null;
  }
  const nom = nomDeFichier(url ? url.pathname : fichier);
  if (url && /^https?:$/.test(url.protocol) && !SCRIPT.test(nom)) {
    return `page ${url.pathname || "/"}${ligne != null ? `, ligne ${ligne}` : ""}`;
  }
  return `${nom || fichier}${ligne != null ? `:${ligne}` : ""}`;
}

/**
 * Première ligne de pile lisible : « fonction · fichier:ligne », ou « fichier:ligne »
 * sans nom de fonction. `null` quand aucune ligne de la pile n'a la forme d'un appel
 * (message seul, pile tronquée) — rien n'est deviné.
 */
export function premiereLigneDePile(pile: string | null | undefined): string | null {
  if (!pile) return null;
  for (const brute of pile.split("\n").slice(0, 50)) {
    const ligne = brute.trim();
    if (!ligne) continue;
    const py = FRAME_PYTHON.exec(ligne);
    if (py) return formater(py[3], py[1], py[2]);
    const v8 = FRAME_V8.exec(ligne);
    if (v8) return formater(v8[1], v8[2], v8[3]);
    // Gecko/JSC : `fn@url:ligne:col`. Une ligne d'en-tête (« TypeError: … ») n'a pas d'`@`
    // ni de `:<chiffres>` final : elle ne passe pas.
    if (ligne.includes("@") || /^[a-z]+:\/\//i.test(ligne)) {
      const gecko = FRAME_GECKO_JSC.exec(ligne);
      if (gecko) return formater(gecko[1], gecko[2], gecko[3]);
    }
  }
  return null;
}

function formater(fonction: string | undefined, fichier: string, ligne: string): string {
  const nom = fonction?.trim().replace(/^async\s+/, "");
  const lieu = lieuDeLigne(fichier, ligne);
  // « HTMLButtonElement.<anonymous> » ou « Object.<anonymous> » : une fonction sans
  // nom, qui n'apprend rien au lecteur.
  return nom && !nom.endsWith("<anonymous>") ? `${nom} · ${lieu}` : lieu;
}

/**
 * La phrase sous le titre d'un groupe : sa ligne de pile (ou, à défaut, le fichier
 * et la ligne déclarés), puis sa route principale. `null` quand rien n'est connu.
 */
export function texteDistinction(d: DistinctionLue | undefined): { lieu: string | null; route: string | null } | null {
  if (!d) return null;
  const lieu = premiereLigneDePile(d.pile) ?? (d.fichier ? lieuDeLigne(d.fichier, d.ligne) : null);
  const route =
    d.route === null
      ? null
      : d.partRoute !== null && d.partRoute >= 0.995
        ? `toujours sur ${d.route}`
        : d.partRoute !== null
          ? `surtout sur ${d.route} (${Math.round(d.partRoute * 100).toLocaleString("fr-FR")}\u00a0%)`
          : `sur ${d.route}`;
  return lieu || route ? { lieu, route } : null;
}

/** Clé d'un groupe dans le dictionnaire des distinctions : app et empreinte. */
export function cleGroupe(g: { app_id: string; fingerprint: string }): string {
  return `${g.app_id}\u0000${g.fingerprint}`;
}
