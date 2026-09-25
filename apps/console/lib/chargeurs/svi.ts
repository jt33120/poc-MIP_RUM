// LES CHARGEURS DE LA « Supervision SVI » (C5) — `app/svi/page.tsx`,
// `app/svi/appels/page.tsx`, `app/svi/appels/[callId]/page.tsx`.
//
// CAPACITÉ FERMÉE (`lib/capacites.ts`) : tant qu'elle l'est, rien n'est lu — ici
// comme dans la page, et donc dans console-api aussi. Un appel d'une autre app que
// celle de l'écran est introuvable, pas « interdit » : on ne révèle pas son existence.
import { estFermee } from "../capacites";
import { analyserFiltres } from "../filtres-ecran";
import { sviCallDetail, sviCalls, sviContainment, sviExitNodes, sviOutcomesByHour, sviSummary } from "../queries-svi";
import { periodLabel, v2FiltersOf } from "../queries-v2";
import type { Chargeur } from "./commun";

export const chargerSvi = (async (principal, sp) => {
  if (estFermee("/svi")) return { etat: "fermee" } as const;
  const ecran = await analyserFiltres(principal, sp, "/svi");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = v2FiltersOf(ecran.query);
  const [sum, cont, sorties] = await Promise.all([sviSummary(f), sviContainment(f), sviExitNodes(f)]);
  return { etat: "ok", periode: periodLabel(f), sum, cont, sorties } as const;
}) satisfies Chargeur<unknown>;

export const chargerSviAppels = (async (principal, sp) => {
  if (estFermee("/svi")) return { etat: "fermee" } as const;
  const ecran = await analyserFiltres(principal, sp, "/svi/appels");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = v2FiltersOf(ecran.query);
  const [rows, sum, parHeure] = await Promise.all([sviCalls(f), sviSummary(f), sviOutcomesByHour(f)]);
  return { etat: "ok", periode: periodLabel(f), rows, sum, parHeure } as const;
}) satisfies Chargeur<unknown>;

export const chargerSviAppel = (async (principal, sp, { callId = "" }) => {
  if (estFermee("/svi")) return { etat: "fermee" } as const;
  const ecran = await analyserFiltres(principal, sp, `/svi/appels/${encodeURIComponent(callId)}`);
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = v2FiltersOf(ecran.query);
  // `f.app` est la portée de l'utilisateur : un appel d'une autre app est introuvable.
  const detail = await sviCallDetail(f.app, callId);
  if (!detail) return { etat: "introuvable" } as const;
  return { etat: "ok", detail } as const;
}) satisfies Chargeur<unknown>;
