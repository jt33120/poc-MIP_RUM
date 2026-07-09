// Tokens de lecture (livrable UTI). Fonctions PURES (hash, fenêtre) + génération.
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
