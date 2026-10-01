// L'escalade des alertes à l'écran (/alerts, migration-v108) : ce que la page et la
// section « Escalade » tirent des lectures, SANS la base. Module pur, testé
// (tests/unit/escalade-ecran.test.ts) ; la commande y lit aussi ses bornes, pour
// que le formulaire et le refus disent les mêmes nombres.
//
// CE QUE L'ÉCRAN N'AFFIRME PAS.
//   - Un délai d'étape n'est pas une promesse à la minute : l'escalade se décide au
//     passage du planificateur. Un délai de 5 min part au passage qui suit son
//     échéance — jusqu'à une cadence plus tard. L'écran écrit la cadence lue.
//   - Une relance n'est active que sur le DERNIER niveau qui s'applique à un
//     déclenchement : une étape plus haute dans la même portée la fait taire.
//   - Le délai d'acquittement d'un déclenchement né avant l'horodatage n'existe pas :
//     « acquittée », sans heure, plutôt qu'une heure inventée.
import { fmtHeure, fmtJour, pluriel } from "./format";

/** Les bornes d'une étape, communes au formulaire, à la commande et aux contraintes de la base. */
export const BORNES_ESCALADE = Object.freeze({
  niveau: Object.freeze({ min: 1, max: 9 }),
  /** Sept jours : au-delà, un déclenchement ouvert n'escalade plus. */
  delai: Object.freeze({ min: 0, max: 10_080 }),
  relance: Object.freeze({ min: 5, max: 1_440 }),
  plafond: Object.freeze({ min: 1, max: 48 }),
});

/** Cadence du planificateur quand la base ne la publie pas : celle de la production. */
export const CADENCE_TICK_DEFAUT_MIN = 15;

/** Une durée en minutes, écrite pour un humain : « 5 min », « 1 h 30 », « 2 j ». */
export function dureeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    const reste = m % 60;
    return reste === 0 ? `${h} h` : `${h} h ${String(reste).padStart(2, "0")}`;
  }
  const j = Math.floor(m / 1440);
  const h = Math.round((m % 1440) / 60);
  return h === 0 ? `${j} j` : `${j} j ${h} h`;
}

/** Ce qu'une étape fait, en une phrase de grain : « contrôlée à chaque passage, toutes les 15 min ». */
export function grainDuTick(cadenceMin: number | null): string {
  const c = cadenceMin ?? CADENCE_TICK_DEFAUT_MIN;
  return `vérifiée à chaque passage du planificateur, toutes les ${c} min : un délai plus court part au passage suivant`;
}

/** L'étape, telle que la section la lit (la ligne de `listEtapesEscalade`, après le fil JSON). */
export interface EtapeAffichee {
  id: number;
  app_id: string | null;
  severity_min: string;
  level: number;
  delay_minutes: number;
  repeat_minutes: number | null;
  repeat_max: number | null;
}

/**
 * La relance d'une étape, en mots. Elle ne joue que si l'étape est le DERNIER niveau
 * qui s'applique au déclenchement (`escalate_alerts`) : une étape de niveau plus haut
 * dans une portée qui recouvre la sienne la fait taire — toujours pour une étape
 * d'application, pour les applications concernées seulement quand l'étape est
 * globale. La sévérité n'est pas prise en compte ici : la phrase dit « peut ».
 */
export function relanceDeLEtape(
  e: EtapeAffichee,
  etapes: readonly EtapeAffichee[],
): { texte: string; etat: "aucune" | "active" | "inactive" | "partielle" } {
  if (e.repeat_minutes == null || e.repeat_max == null) return { texte: "sans relance", etat: "aucune" };
  // « à 1 h d'intervalle » : « toutes les 1 h » ne se dit pas.
  const cadence = `à ${dureeMinutes(e.repeat_minutes)} d'intervalle, ${pluriel(e.repeat_max, "fois", "fois")} au plus`;
  const plusHautes = etapes.filter(
    (o) => o.id !== e.id && o.level > e.level && (o.app_id === null || e.app_id === null || o.app_id === e.app_id),
  );
  if (plusHautes.length === 0) return { texte: `relance ${cadence}`, etat: "active" };
  const memePortee = plusHautes.filter((o) => o.app_id === e.app_id || o.app_id === null);
  if (memePortee.length > 0) {
    const niveau = Math.max(...memePortee.map((o) => o.level));
    return { texte: `relance ${cadence}, muette : le niveau ${niveau} peut passer après`, etat: "inactive" };
  }
  const apps = [...new Set(plusHautes.map((o) => o.app_id!))].sort();
  return {
    texte: `relance ${cadence}, sauf pour ${apps.length === 1 ? "l'application" : "les applications"} ${apps.join(", ")} (niveau plus haut)`,
    etat: "partielle",
  };
}

/** Regroupe les étapes par portée : la portée globale d'abord, puis les applications, par niveau et délai. */
export function etapesParPortee<T extends EtapeAffichee>(etapes: readonly T[]): { app: string | null; etapes: T[] }[] {
  const parApp = new Map<string | null, T[]>();
  for (const e of etapes) parApp.set(e.app_id, [...(parApp.get(e.app_id) ?? []), e]);
  return [...parApp.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b, "fr")))
    .map(([app, liste]) => ({
      app,
      etapes: [...liste].sort((x, y) => x.level - y.level || x.delay_minutes - y.delay_minutes || x.id - y.id),
    }));
}

/**
 * La ligne d'acquittement d'un déclenchement : « acquittée à 14:32, après 12 min » ;
 * la date s'ajoute quand l'acquittement n'est pas du même jour que le déclenchement
 * (« acquittée le 30/09 à 09:05, après 1 j 2 h »). Sans heure (acquitté avant
 * l'horodatage), `null` : la page écrit « acquittée », seule.
 */
export function ligneAcquittement(firedAt: Date | string, ackAt: Date | string | null | undefined): string | null {
  if (ackAt == null) return null;
  const debut = new Date(firedAt).getTime();
  const fin = new Date(ackAt).getTime();
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return null;
  const memeJour = fmtJour(debut) === fmtJour(fin);
  const quand = memeJour ? `à ${fmtHeure(fin)}` : `le ${fmtJour(fin)} à ${fmtHeure(fin)}`;
  // Une horloge en retard ne rend pas un délai négatif : « après 0 min ».
  return `acquittée ${quand}, après ${dureeMinutes(Math.max(0, (fin - debut) / 60_000))}`;
}

/** Le niveau atteint par un déclenchement ouvert : « niveau 2 · relance 1 », ou `null` sans escalade. */
export function ligneNiveau(niveau: number | null | undefined, relance: number | null | undefined): string | null {
  if (niveau == null) return null;
  return relance != null && relance > 0 ? `niveau ${niveau} · relance ${relance}` : `niveau ${niveau}`;
}

/** Ce que la tuile du délai médian d'acquittement lit. */
export interface MttaAffiche {
  disponible: boolean;
  mediane_ms: number | null;
  n: number;
  declenches: number;
}

/**
 * La tuile MTTA : sa valeur, sa raison quand elle n'en a pas, et la phrase dessous.
 * Jamais un 0 pour « aucun acquittement » : le délai n'existe pas, il ne vaut pas rien.
 */
export function tuileMtta(m: MttaAffiche | null, jours: number): { valeur: number | null; raisonNull: string; lecture: string | undefined } {
  if (m === null) return { valeur: null, raisonNull: "lecture en échec", lecture: undefined };
  if (!m.disponible) {
    return { valeur: null, raisonNull: "heure d'acquittement pas encore enregistrée par la base", lecture: undefined };
  }
  if (m.n === 0) {
    return {
      valeur: null,
      raisonNull:
        m.declenches === 0 ? `aucun déclenchement depuis l'horodatage, sur ${jours} j` : `aucun acquittement horodaté sur ${jours} j`,
      lecture:
        m.declenches > 0 ? `${pluriel(m.declenches, "déclenchement")} depuis l'horodatage, aucun acquittement horodaté` : undefined,
    };
  }
  return {
    valeur: m.mediane_ms,
    raisonNull: "lecture en échec",
    lecture: `médiane de ${pluriel(m.n, "acquittement")} sur ${pluriel(m.declenches, "déclenchement")} nés après l'horodatage`,
  };
}
