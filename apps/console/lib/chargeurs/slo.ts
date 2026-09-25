// LE CHARGEUR DE L'ÉCRAN « SLO et budget d'erreur » (C8) — `app/slo/page.tsx`.
//
// Écran COMPOSABLE : sa composition (blocs `budget`, `liste`, `creation`) arrive en
// paramètre (`blocs`, `lib/ecran-local.ts`), et un bloc éteint ne lance pas sa
// lecture. Chaque lecture est une section (F02). Les applications où créer un SLO
// ne sont lues que pour un administrateur, et ce sont celles de son périmètre
// d'écriture (C8).
import { analyserFiltres } from "../filtres-ecran";
import type { AppItem } from "../queries";
import { listSlo, sloStatus, type SloRaw, type SloStatusRow } from "../queries-alerting";
import { alertFirings } from "../queries-v2";
import { appsEcrivables, droitsDEcriture } from "./alertes";
import { blocsDe, section, sansSection, type Chargeur } from "./commun";

/** Fenêtre de la colonne « Alertes sur 7 j » : jours calendaires UTC, jour en cours compris. */
export const JOURS_ALERTES_SLO = 7;

export const chargerSlo = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/slo");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const blocs = blocsDe(sp, "/slo");
  const { admin } = droitsDEcriture(principal);
  const [statuts, slos, apps, declenchements] = await Promise.all([
    blocs.budget || blocs.liste ? section(() => sloStatus(f)) : sansSection<SloStatusRow[]>([]),
    blocs.liste || blocs.creation ? section(() => listSlo(f)) : sansSection<SloRaw[]>([]),
    blocs.creation && admin ? section(() => appsEcrivables(principal!)) : sansSection<AppItem[]>([]),
    blocs.liste ? section(() => alertFirings(f, JOURS_ALERTES_SLO)) : sansSection(null),
  ]);
  return {
    etat: "ok",
    notApplied: ecran.notApplied,
    appFiltre: f.app,
    blocs,
    admin,
    statuts,
    slos,
    apps,
    declenchements,
    luA: new Date().toISOString().slice(11, 19),
  } as const;
}) satisfies Chargeur<unknown>;
