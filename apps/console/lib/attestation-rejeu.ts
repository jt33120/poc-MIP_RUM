// « À faire » X10 — la base légale du rejeu de session, attestée par le gestionnaire
// de l'application (commande `attesterRejeu`, lue par `derniereAttestationRejeu`).
// Module pur : la page « Installer » (composant client) et la commande s'y retrouvent.

/** Les bases légales du RGPD (art. 6) qu'un gestionnaire peut invoquer pour le rejeu. */
export const BASES_LEGALES_REJEU = ["consentement", "interet_legitime", "contrat", "autre"] as const;
export type BaseLegaleRejeu = (typeof BASES_LEGALES_REJEU)[number];

export const LIBELLE_BASE_LEGALE: Record<BaseLegaleRejeu, string> = {
  consentement: "Le consentement des visiteurs, recueilli par notre outil",
  interet_legitime: "Notre intérêt légitime, documenté dans notre registre",
  contrat: "L'exécution d'un contrat avec nos utilisateurs",
  autre: "Une autre base, précisée en note",
};

/** La dernière attestation d'une application, telle que la page la montre. */
export interface AttestationRejeu {
  par: string | null;
  le: Date | string;
  base: BaseLegaleRejeu | null;
  taux: string | null;
  masquage: string | null;
  note: string | null;
}

/** Le détail d'une ligne du journal, relu sans jamais lever (une ligne ancienne ou abîmée rend `null`). */
export function lireDetailAttestation(detail: string | null): Pick<AttestationRejeu, "base" | "taux" | "masquage" | "note"> | null {
  try {
    const d = JSON.parse(detail ?? "") as Record<string, unknown>;
    const base = (BASES_LEGALES_REJEU as readonly unknown[]).includes(d.base) ? (d.base as BaseLegaleRejeu) : null;
    const texte = (v: unknown) => (typeof v === "string" ? v : null);
    return { base, taux: texte(d.taux), masquage: texte(d.masquage), note: texte(d.note) };
  } catch {
    return null;
  }
}

/**
 * Le motif `like` des lignes d'UNE application : le détail commence par
 * `{"app":"<app>",` (`JSON.stringify` de la commande, `app` en premier). Un `like`
 * plutôt qu'un cast `::jsonb` : les autres actions du journal portent du texte libre,
 * qu'un cast ferait échouer.
 */
export function motifAttestation(app: string): string {
  return `${JSON.stringify({ app }).slice(0, -1).replace(/[\\%_]/g, (c) => `\\${c}`)},%`;
}
