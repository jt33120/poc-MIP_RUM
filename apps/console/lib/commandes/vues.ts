// LES VUES ENREGISTRÉES DE L'EXPLORER (C6) — `app/explorer/actions.ts`, l'écran `/explorer/views`.
//
// Une vue est PERSONNELLE : son propriétaire seul l'écrit, dans une application
// NOMMÉE de son périmètre, et elle ne donne aucun droit — son AST est rejoué dans
// le périmètre de qui l'ouvre. Les règles vivent dans `lib/saved-views.ts` (pur) et
// `lib/queries-saved-views.ts`, qui confronte la ligne au principal APRÈS l'avoir
// lue (un identifiant deviné hors périmètre est introuvable, comme absent) : ces
// commandes les appliquent telles quelles, avec le même analyseur que
// `POST /api/v1/explorer/views`.
//
// Exemptées d'audit : le journal trace ce qui change qui lit quoi ; une vue ne le
// change pas.
import { chaine, libre, objet } from "@mip/console-contract";
import { createSavedView, deleteSavedView, savedViewReader, updateSavedView } from "../queries-saved-views";
import { parseSavedViewCreate, parseSavedViewPatch, SAVED_VIEW_MAX_BYTES } from "../saved-views";
import { commande, type PrincipalCommande } from "./commun";

const PERSONNELLE = {
  exempt: "vue personnelle : son propriétaire seul la lit et l'écrit, et elle ne donne aucun droit (son AST est rejoué dans le périmètre de qui l'ouvre)",
} as const;
const CHEMIN_UUID = objet({
  id: chaine({ max: 36, motif: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, description: "identifiant de vue" }),
});
/** Le corps entier, borné : son sens est vérifié par l'analyseur des vues (le registre de l'Explorer). */
const CORPS = libre({ octetsMax: SAVED_VIEW_MAX_BYTES + 4096 });

const options = (p: PrincipalCommande) => ({ principal: { role: p.role, apps: p.apps }, nowMs: Date.now() });
const lecteur = (p: PrincipalCommande) => savedViewReader({ email: p.email, role: p.role, apps: p.apps, demo: p.demo === true });

/** `{ name, query }` : l'application vient de l'AST, jamais d'un champ à part. */
export const creerVue = commande(
  {
    regle: { auth: "session", portee: "globale", audit: PERSONNELLE },
    corps: CORPS,
  },
  async ({ principal, corps }) => {
    const demande = parseSavedViewCreate(corps, options(principal));
    if (!demande.ok) return { kind: "invalid", error: demande.error } as const;
    return createSavedView(await lecteur(principal), demande.value);
  },
);

/** `{ name?, query?, expectedRevision }` : la révision lue, toujours. */
export const modifierVue = commande(
  {
    regle: { auth: "session", portee: "globale", audit: PERSONNELLE },
    chemin: CHEMIN_UUID,
    corps: CORPS,
  },
  async ({ principal, chemin, corps }) => {
    const demande = parseSavedViewPatch(corps, options(principal));
    if (!demande.ok) return { kind: "invalid", error: demande.error } as const;
    return updateSavedView(await lecteur(principal), chemin.id, demande.value);
  },
);

export const supprimerVue = commande(
  {
    regle: { auth: "session", portee: "globale", audit: PERSONNELLE },
    chemin: CHEMIN_UUID,
  },
  async ({ principal, chemin }) => {
    return deleteSavedView(await lecteur(principal), chemin.id);
  },
);
