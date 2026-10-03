// Une identité différente ouvre une session distincte sans changer le visiteur
// (spec rum-browser-context-identity). La marque est persistée avec la session :
// en multipage, `setUser(A)` rappelé à chaque chargement ne doit pas faire tourner
// la session. Ce n'est jamais l'identifiant brut, qui ne quitte pas la mémoire.

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

/** Marque d'une identité, salée par la session ; `null` = aucune identité. */
export function marqueIdentite(sessionId: string, genre: "user" | "account", id: string | null): string | null {
  return id === null ? null : fnv1a32(`${sessionId}\u0000${genre}\u0000${id}`);
}

/**
 * `rattacher` (session anonyme : connexion en cours de visite), `rien` (même identité)
 * ou `rotation` (autre identité, ou déconnexion d'une session identifiée).
 */
export function decisionIdentite(avant: string | null | undefined, apres: string | null): "rien" | "rattacher" | "rotation" {
  if ((avant ?? null) === apres) return "rien";
  if (avant == null) return "rattacher";
  return "rotation";
}
