// ───────────────────── Identité métier et session technique ─────────────────────
//
// L'INTENTION (spec rum-browser-context-identity, 15/09/2026) : « une identité
// DIFFÉRENTE ouvre une session technique distincte sans changer le visiteur » —
// une session ne mélange jamais l'activité de A et celle de B (poste partagé,
// changement de compte).
//
// CE QUI ÉTAIT FAUX (recette du 26/09/2026). L'identité ne vivait qu'en mémoire.
// Dans une application MULTIPAGE, chaque chargement de page repart d'une identité
// vide ; l'application rappelle `setUser(A)` après `init()`, le SDK y voyait un
// changement (rien → A) et ouvrait une NOUVELLE session à chaque page. Une visite
// de cinq pages faisait cinq sessions d'une page.
//
// CE QUI DÉCIDE MAINTENANT : la marque de l'identité, PERSISTÉE avec la session.
//   - session anonyme, identité posée → l'identité s'y RATTACHE (connexion en cours
//     de visite : c'est la même visite) ;
//   - même marque → rien (page suivante de la même personne) ;
//   - marque différente, ou identité effacée (déconnexion) → nouvelle session.
// La marque n'est jamais l'identifiant brut (qui ne quitte pas la mémoire) : une
// empreinte FNV-1a de 32 bits, salée par l'identifiant de session, qui ne sert qu'à
// comparer deux chargements de la MÊME session. Deux identités distinctes n'ont
// qu'une chance sur quatre milliards de la partager.

export interface MarquesIdentite {
  user?: string | null;
  account?: string | null;
}

/** FNV-1a 32 bits, en hexadécimal : une comparaison d'égalité, pas un secret. */
function fnv1a32(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Marque d'une identité pour CETTE session ; `null` = aucune identité. */
export function marqueIdentite(sessionId: string, genre: "user" | "account", id: string | null): string | null {
  return id === null ? null : fnv1a32(`${sessionId}\u0000${genre}\u0000${id}`);
}

/**
 * Ce que fait un changement d'identité, d'après la marque rattachée à la session :
 * `rattacher` (session anonyme), `rien` (même identité) ou `rotation` (autre
 * identité, ou identité effacée alors que la session en portait une).
 */
export function decisionIdentite(avant: string | null | undefined, apres: string | null): "rien" | "rattacher" | "rotation" {
  if ((avant ?? null) === apres) return "rien";
  if (avant == null) return "rattacher";
  return "rotation";
}
