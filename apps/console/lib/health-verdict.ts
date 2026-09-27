// LE VERDICT D'ENSEMBLE DE LA SANTÉ INTERNE (`/admin/health`).
//
// POURQUOI. L'écran n'alignait que des compteurs bruts : « 0 lot en attente »
// sans dire si la file est seulement allumée, « Retard : — » sans dire que le
// calcul n'a jamais tourné (recette du 26/09/2026). Un exploitant veut d'abord
// une phrase — tout va bien, ou voici ce qui cloche — puis les chiffres.
//
// LES SEUILS SONT CEUX QUE L'ÉCRAN COLORAIT DÉJÀ (orange ou rouge) : aucun
// n'est inventé ici. Le verdict ne fait que les rassembler en tête, avec un lien
// vers la section qui les détaille. Deux ajouts, qui ne sont pas des seuils mais
// des états : le calcul de la consommation jamais exécuté, et les dégradations
// déjà signalées par des bandeaux (identité métier, actions causales, adresse de
// collecte remise aux clients).
//
// Ce qui N'ENTRE PAS dans le verdict : les volumes collectés (zéro la nuit est
// normal) et les déclenchements d'alertes non acquittés — ils disent l'état des
// applications suivies, pas celui de MIP RUM.
//
// Module pur : la page lui passe l'instantané et les états qu'elle connaît.
import type { HealthSnapshot } from "./metrics-format";

export type NiveauSante = "ok" | "attention" | "incident";

export interface RaisonSante {
  niveau: Exclude<NiveauSante, "ok">;
  texte: string;
  /** Ancre de la section qui détaille (`#file`, `#notifications`…). */
  ancre: string;
}

export interface VerdictSante {
  niveau: NiveauSante;
  titre: string;
  raisons: RaisonSante[];
}

/** Retard du calcul de consommation au-delà duquel l'écran l'écrit en rouge, puis en orange (heures). */
export const RETARD_CONSO_INCIDENT_H = 30;
export const RETARD_CONSO_ATTENTION_H = 26;
/** Lots en attente au-delà desquels la file est signalée. */
export const FILE_ATTENTION = 1000;

const nb = (n: number) => n.toLocaleString("fr-FR");
const heures = (h: number) => `${h.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

export function verdictSante(
  h: HealthSnapshot,
  etats: { identiteDegradee: boolean; causalesDegradees: boolean; collecteAilleurs: boolean },
): VerdictSante {
  const raisons: RaisonSante[] = [];
  const incident = (texte: string, ancre: string) => raisons.push({ niveau: "incident", texte, ancre });
  const attention = (texte: string, ancre: string) => raisons.push({ niveau: "attention", texte, ancre });

  if (h.deliveries_dead > 0) {
    incident(`${nb(h.deliveries_dead)} notification${h.deliveries_dead > 1 ? "s" : ""} d'alerte abandonnée${h.deliveries_dead > 1 ? "s" : ""} après plusieurs échecs.`, "#notifications");
  }
  if (h.ingest_backlog_blocked > 0) {
    const n = h.ingest_backlog_blocked;
    incident(n > 1 ? `${nb(n)} lots de données abandonnés : ils ne seront plus repris.` : "1 lot de données abandonné : il ne sera plus repris.", "#file");
  }
  const retard = h.metering_lag_hours;
  if (retard == null) {
    attention("Le calcul de la consommation n'a jamais été exécuté.", "#consommation");
  } else if (retard > RETARD_CONSO_INCIDENT_H) {
    incident(`Le calcul de la consommation a ${heures(retard)} de retard.`, "#consommation");
  } else if (retard > RETARD_CONSO_ATTENTION_H) {
    attention(`Le calcul de la consommation a ${heures(retard)} de retard.`, "#consommation");
  }
  if (h.deliveries_failed > 0) {
    attention(`${nb(h.deliveries_failed)} notification${h.deliveries_failed > 1 ? "s" : ""} d'alerte en échec, en attente d'un nouvel essai.`, "#notifications");
  }
  if (h.ingest_backlog > FILE_ATTENTION) {
    attention(`${nb(h.ingest_backlog)} lots attendent d'être écrits : l'écriture ne suit pas.`, "#file");
  }
  if (h.apps_route_capped > 0) {
    attention(
      `${nb(h.apps_route_capped)} application${h.apps_route_capped > 1 ? "s ont" : " a"} atteint le plafond de routes : leurs nouvelles routes sont regroupées.`,
      "#routes",
    );
  }
  if (etats.identiteDegradee) attention("L'identité métier est dégradée : les identifiants utilisateur et compte sont omis.", "#degradations");
  if (etats.causalesDegradees) attention("Les actions causales sont indisponibles.", "#degradations");
  if (etats.collecteAilleurs) attention("Le code de suivi remis aux clients envoie ses données vers un autre hôte que cette console.", "#collecte");

  const niveau: NiveauSante = raisons.some((r) => r.niveau === "incident") ? "incident" : raisons.length ? "attention" : "ok";
  const titre =
    niveau === "ok"
      ? "Tout fonctionne : aucun indicateur ne dépasse son seuil."
      : niveau === "incident"
        ? "Incident : une partie des données ou des notifications est perdue ou en retard."
        : `À surveiller : ${raisons.length} point${raisons.length > 1 ? "s" : ""} à vérifier.`;
  // Les incidents d'abord : c'est par eux qu'on commence.
  raisons.sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === "incident" ? -1 : 1));
  return { niveau, titre, raisons };
}
