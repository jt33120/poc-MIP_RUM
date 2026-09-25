// LE CHARGEUR DE L'ÉCRAN « Vues enregistrées » (C6) — `app/explorer/views/page.tsx`.
//
// Les vues du compte (et, pour un administrateur, celles des autres comptes de ses
// apps), et les six analyses de départ de l'Explorer. « Réduire avant d'envoyer » :
// de l'AST d'une vue ne voyagent que ce que l'écran en montre — le lien qui la
// rouvre exécutée, et ce qu'elle mesure en une phrase (`resumeVue`), ou la raison
// pour laquelle elle ne se relit plus.
import { explorerHrefFromAst, resumeVue } from "../explorer-page-params";
import { MODELES_EXPLORER, modelesDeDepart, type ModeleDepart } from "../explorer-modeles";
import { analyserFiltres } from "../filtres-ecran";
import { listSavedViews, savedViewReader } from "../queries-saved-views";
import { paramReader } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { VIEW_CONTEXT_PARAMS } from "../view-state";
import type { Chargeur, ParametresEcran, PrincipalEcran } from "./commun";

/**
 * Les analyses fournies, liées à l'Explorer EXÉCUTÉ sur les filtres de l'URL (ceux
 * de l'Explorer : les liens y mènent). Des filtres refusés ne cachent pas les
 * modèles : chacun est montré sans lien, avec la raison.
 */
async function modelesFournis(principal: PrincipalEcran, sp: ParametresEcran): Promise<ModeleDepart[]> {
  const ecran = await analyserFiltres(principal, sp, "/explorer");
  if (!ecran.ok) {
    return MODELES_EXPLORER.map((m) => ({
      cle: m.cle,
      titre: m.titre,
      question: m.question,
      href: null,
      raison: `filtres de l’adresse refusés : ${ecran.problem.message}`,
    }));
  }
  const reader = paramReader(sp);
  const vue = Object.fromEntries(VIEW_CONTEXT_PARAMS.map((nom) => [nom, reader.get(nom)]));
  return modelesDeDepart(ecran.query, await dimensionSchema(), vue);
}

export const chargerVues = (async (principal, sp) => {
  if (!principal) return { etat: "sans_session" } as const;
  const lecteur = await savedViewReader(principal);
  const [result, modeles] = await Promise.all([listSavedViews(lecteur), modelesFournis(principal, sp)]);
  const vues =
    result.kind === "ok"
      ? {
          kind: "ok" as const,
          value: result.value.map((v) => ({
            id: v.id,
            app_id: v.app_id,
            name: v.name,
            revision: v.revision,
            mine: v.mine,
            owner_email: v.owner_email,
            updated_at: v.updated_at,
            ouvrir: explorerHrefFromAst(v.query),
            resume: resumeVue(v.query),
          })),
        }
      : result.kind === "forbidden"
        ? { kind: "forbidden" as const, error: result.error }
        : { kind: "unavailable" as const };
  return { etat: "ok", demo: principal.demo === true, vues, modeles } as const;
}) satisfies Chargeur<unknown>;
