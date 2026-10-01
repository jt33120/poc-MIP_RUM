// Jetons d'accès. Fonctions PURES (hash, fenêtre, validité) + génération.
// Le token en clair n'est JAMAIS stocké : on persiste son sha256 hex ; l'auth
// re-hashe le token présenté et compare par égalité indexée.
import { createHash, randomBytes } from "node:crypto";

/** sha256 hex d'un token (déterministe, testable). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Génère un token opaque URL-safe préfixé (≈256 bits d'entropie). */
export function generateToken(): string {
  return `mrk_${randomBytes(32).toString("base64url")}`;
}

export type SummaryWindow = "24h" | "7d" | "30d";
const WINDOWS: Record<SummaryWindow, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/** Valide ?window (défaut 30d) ; renvoie la clé + l'intervalle Postgres. */
export function parseWindow(raw: string | null | undefined): { key: SummaryWindow; interval: string } {
  const v = (raw ?? "").toLowerCase().replace("7j", "7d");
  const key: SummaryWindow = v === "24h" || v === "7d" || v === "30d" ? v : "30d";
  return { key, interval: WINDOWS[key] };
}

/**
 * Durées de validité proposées à la création d'un jeton d'accès, en jours.
 *
 * POURQUOI UNE ÉCHÉANCE. Un jeton d'accès sans fin reste valable tant que
 * personne ne pense à le révoquer — chez un partenaire qui a changé d'outil, dans
 * un script oublié. Les jetons de CI des source maps en ont une (1 à 90 jours) ;
 * ceux de lecture n'en avaient pas (recette du 26/09/2026).
 */
export const VALIDITES_LECTURE_JOURS = [30, 90, 180, 365] as const;
export const VALIDITE_LECTURE_DEFAUT_JOURS = 90;
export const VALIDITE_LECTURE_MAX_JOURS = 365;

/**
 * La validité demandée, en jours entiers : absente → la durée par défaut ; hors de
 * 1 à 365, ou illisible → null (refus). Jamais « sans échéance » à la création.
 */
export function validiteLecture(raw: string | number | null | undefined): number | null {
  if (raw === undefined || raw === null || raw === "") return VALIDITE_LECTURE_DEFAUT_JOURS;
  const n = typeof raw === "number" ? raw : /^[0-9]{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= VALIDITE_LECTURE_MAX_JOURS ? n : null;
}
