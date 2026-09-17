// Comptes internes de la console (`console_user`) — la seule résolution
// « session → compte » du produit.
//
// POURQUOI UNE CLÉ ET PAS UNE ADRESSE. Les propriétés (tableaux de bord P6.5,
// vues enregistrées, assignation d'issue P5.6) pointent vers `console_user.id`.
// Une adresse ne suffit pas : renommer un compte, ou en recréer un homonyme,
// réattribuerait silencieusement le travail de quelqu'un d'autre. L'adresse reste
// une trace d'audit (`dashboard.created_by`), jamais un lien.
import { q } from "./db";

/** Compte interne ACTIF portant cette adresse, ou null. */
export async function accountIdOf(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const [row] = await q<{ id: string }>("select id::text as id from console_user where email = $1 and active", [email]);
  return row?.id ?? null;
}
