// LE CHARGEUR DE L'ÉCRAN « Alertes » (C8) — `app/alerts/page.tsx`.
//
// Chaque section lit indépendamment (F02, § 3.8) : règles, flux d'événements, non
// acquittées, canaux, déclenchements par jour et frise des 30 jours. Ce qui ne sert
// qu'à écrire — les applications où créer une règle, la détection du mode release —
// n'est lu que pour un administrateur, décidé par le principal du chargeur.
//
// L'ESCALADE (migration-v108) ajoute quatre sections : les étapes de la politique,
// le délai médian d'acquittement (MTTA) sur 30 jours, le suivi des déclenchements
// LUS (heure d'acquittement, niveau atteint — lu après eux, par leurs identifiants :
// la portée est déjà appliquée) et la cadence publiée du planificateur, qui est le
// grain de l'escalade. Sur une base sans v108, chacune le dit sans échouer.
//
// LE PÉRIMÈTRE D'ÉCRITURE (C8). Un administrateur d'une LISTE d'applications ne
// crée une règle, un SLO ou un canal que dans celles-ci : le sélecteur d'application
// ne propose qu'elles, et seul l'administrateur de la PLATEFORME voit « Évaluer
// maintenant » et le canal global — ce que les commandes refuseraient n'est pas proposé.
import { analyserFiltres } from "../filtres-ecran";
import { registeredApps, type AppItem } from "../queries";
import { listChannels } from "../queries-alerting";
import { listEtapesEscalade, mttaAlertes, suiviDesDeclenchements, type SuiviDeclenchementRow } from "../queries-escalade";
import { cadenceTickPubliee } from "../queries-planifie";
import {
  alertEvents,
  alertEventsByDay,
  alertFirings,
  alertRules,
  releaseRegressionDisponible,
  unackedAlertCount,
} from "../queries-v2";
import { JOURS_DECLENCHEMENTS, PLAFOND_DECLENCHEMENTS } from "../alerting";
import { sectionFenetresCollecteRecentes } from "./collecte";
import { section, sansSection, type Chargeur, type PrincipalEcran } from "./commun";

/** Les applications où le principal peut écrire (règle, SLO, canal, sonde) : toutes, ou sa liste. */
export async function appsEcrivables(principal: PrincipalEcran): Promise<AppItem[]> {
  const apps = await registeredApps();
  return principal.apps === null ? apps : apps.filter((a) => principal.apps!.includes(a.app_id));
}

/** Administrateur hors démonstration ; de la plateforme s'il n'a pas de liste. */
export function droitsDEcriture(principal: PrincipalEcran | null): { admin: boolean; plateforme: boolean } {
  const admin = principal?.role === "admin" && !principal.demo;
  return { admin, plateforme: admin && principal!.apps === null };
}

export const chargerAlertes = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/alerts");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const f = ecran.filters;
  const { admin, plateforme } = droitsDEcriture(principal);
  const lectureEvenements = section(() => alertEvents(f));
  const lectureSuivi = lectureEvenements.then((s) =>
    s.ok ? section(() => suiviDesDeclenchements(s.data.map((e) => e.id))) : sansSection<SuiviDeclenchementRow[]>([]),
  );
  // Lancées avec les autres : un seul aller-retour d'attente pour tout l'écran.
  const lecturesEscalade = Promise.all([
    section(() => listEtapesEscalade(f)),
    section(() => mttaAlertes(f, JOURS_DECLENCHEMENTS)),
    lectureSuivi,
    section(() => cadenceTickPubliee()),
  ]);
  const [regles, evenements, nonAcquittees, apps, canaux, parJour, declenchements, releaseDetectee, fenetresCollecte] = await Promise.all([
    section(() => alertRules(f)),
    lectureEvenements,
    section(() => unackedAlertCount(f)),
    admin ? section(() => appsEcrivables(principal!)) : sansSection<AppItem[]>([]),
    section(() => listChannels(f)),
    section(() => alertEventsByDay(f, JOURS_DECLENCHEMENTS)),
    section(() => alertFirings(f, JOURS_DECLENCHEMENTS, PLAFOND_DECLENCHEMENTS)),
    // F68 : le formulaire n'existe que pour un administrateur ; lui seul a besoin de
    // savoir si l'évaluateur connaît le mode release (B52, migration-v86).
    admin ? section(() => releaseRegressionDisponible()) : sansSection(false),
    // Les hachures « non mesuré » des déclenchements par jour : les trente jours de
    // l'axe, pas la plage de l'écran (qui ne s'y applique pas).
    sectionFenetresCollecteRecentes(ecran.query, JOURS_DECLENCHEMENTS * 86_400_000),
  ]);
  const [escaladeLue, mtta, suiviLu, cadenceTick] = await lecturesEscalade;
  // L'auteur d'une étape et celui d'un acquittement sont des adresses de compte :
  // elles ne quittent le chargeur que pour un administrateur — ni un lecteur ni une
  // session de démonstration ne les reçoit, pas même dans la charge de la page.
  const escalade =
    admin || !escaladeLue.ok
      ? escaladeLue
      : { ...escaladeLue, data: { ...escaladeLue.data, etapes: escaladeLue.data.etapes.map((e) => ({ ...e, created_by: null })) } };
  const suivi = admin || !suiviLu.ok ? suiviLu : { ...suiviLu, data: suiviLu.data.map((s) => ({ ...s, acknowledged_by: null })) };
  return {
    etat: "ok",
    query: ecran.query,
    notApplied: ecran.notApplied,
    appFiltre: f.app,
    admin,
    plateforme,
    regles,
    evenements,
    nonAcquittees,
    apps,
    canaux,
    parJour,
    declenchements,
    releaseDetectee,
    fenetresCollecte,
    escalade,
    mtta,
    suivi,
    cadenceTick,
  } as const;
}) satisfies Chargeur<unknown>;
