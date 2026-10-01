// La NATURE d'une action du journal d'audit, pour teinter sa pastille (refonte du
// 01/10/2026, charte : « action en pastille — création, modification, suppression »).
//
// Déduite du code de l'action (`user_create`, `read_token.revoke`…), jamais du texte
// affiché : un libellé qui change ne change pas la teinte. Un code inconnu reste
// « autre » (neutre) : mieux vaut une pastille grise qu'une couleur qui mentirait.
import { cleAction } from "@/lib/audit-libelles";

export type NatureAction = "creation" | "suppression" | "refus" | "autre";

export function natureAction(action: string): NatureAction {
  const cle = cleAction(action);
  if (/(?:^|_)(?:failed|blocked|refused)(?:_|$)/.test(cle)) return "refus";
  if (/(?:^|_)(?:revoke|delete|forget|erase|purge|remove)(?:_|$)/.test(cle)) return "suppression";
  if (/(?:^|_)(?:create|signup|provision|seeded)(?:_|$)/.test(cle)) return "creation";
  return "autre";
}
