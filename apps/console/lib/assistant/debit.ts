// LE DÉBIT DE L'ASSISTANT — 20 questions par utilisateur et par 10 minutes.
//
// Chaque question peut coûter un appel payant au modèle : une boucle (un onglet
// oublié, un script) ne doit pas vider le quota du fournisseur. Même fenêtre
// glissante en mémoire que l'API v1 (`lib/api/ratelimit.ts`), dans son propre
// magasin : par instance de fonction, une première barrière, pas une garantie
// distribuée — assez pour un outil interne où chaque question est un clic.
import { rateLimit, type RateResult } from "@/lib/api/ratelimit";

export const QUESTIONS_PAR_FENETRE = 20;
export const FENETRE_MS = 10 * 60_000;

const magasin = new Map<string, number[]>();

/** Compte une question de `utilisateur` ; `ok: false` au-delà de 20 sur 10 minutes. */
export function compterQuestion(utilisateur: string, maintenant: number = Date.now()): RateResult {
  return rateLimit(`assistant:${utilisateur.toLowerCase()}`, QUESTIONS_PAR_FENETRE, FENETRE_MS, maintenant, magasin);
}

/** Vide le magasin (tests). */
export function reinitialiserDebit(): void {
  magasin.clear();
}
