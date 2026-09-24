// La rétention et le déclencheur périodique de la vitrine, DÉDUITS d'une preuve.
//
// La rétention et le déclencheur périodique sont les deux seuls points dont
// l'état CHANGE sans qu'on touche au code : il suffit que le secret du
// planificateur soit posé côté hébergeur. Ils sont donc lus en base — la dernière
// exécution aboutie — plutôt qu'écrits en dur. C'est exactement là que la version
// précédente de cette section a menti : elle affirmait « jamais déclenchée » bien
// après que le secret ait été posé.
//
// UNE LECTURE EN ÉCHEC N'EST PAS UN « JAMAIS ». Les lectures rendaient `null` sur
// une panne de base, et la vitrine l'affichait « aucune exécution constatée en
// production » : une inconnue présentée comme un fait. Elles distinguent
// désormais « lu, jamais exécuté » (`{ etat: "lu", date: null }`) de « illisible ».
//
// Logique PURE — ni base, ni horloge implicite : `maintenant` est un paramètre.
import { ligneLatence } from "./etat-latence";
import { fmtDate } from "./format";
import type { LecturePlanifie } from "@mip/console-contract";
import type { Statut } from "./specs";

/**
 * Résultat d'une lecture de l'état du planificateur. `cadenceMin` : la cadence
 * EFFECTIVE du tick, publiée par le scheduler (`platform_flag.scheduler_tick_min`) ;
 * absente avant sa première publication. Défini dans le contrat de console-api,
 * qui la lit (C0b) ; la console l'affiche.
 */
export type { LecturePlanifie };

export type Gravite = "bloquant" | "limite";

/** Ce que la vitrine écrit quand la lecture a échoué : ni succès, ni absence. */
export const NON_ETABLI_PLANIFIE = "Non établi : la lecture de l'état du planificateur a échoué";

export interface Volatiles {
  retention: { c: string; cible: string; reel: string; s: Statut };
  planif: { t: string; d: string; g: Gravite } | null;
}

const RETENTION = { c: "Rétention", cible: "Purge à 30 jours, réglable par client" } as const;

export function volatiles(lecture: LecturePlanifie, maintenant: number = Date.now()): Volatiles {
  // Une panne de lecture ne dit rien de la purge : pas de verdict, et rien
  // n'est ajouté à « Ce qui manque » sur la foi d'une inconnue.
  if (lecture.etat === "illisible") {
    return { retention: { ...RETENTION, reel: NON_ETABLI_PLANIFIE, s: "non-mesure" }, planif: null };
  }

  const dernier = lecture.date;
  const frais = dernier != null && maintenant - dernier.getTime() < 48 * 3600 * 1000;

  if (frais) {
    return {
      retention: { ...RETENTION, reel: `Purge par client active — dernier passage le ${fmtDate(dernier!)}`, s: "atteint" },
      planif: null, // plus un manque : le bloc s'exécute
    };
  }

  const jamais = dernier == null;
  return {
    retention: {
      ...RETENTION,
      reel: jamais
        ? "Codée et testée ; aucune exécution constatée en production"
        : `Codée et testée ; dernier passage le ${fmtDate(dernier!)}, plus de 48 h`,
      s: jamais ? "manque" : "partiel",
    },
    planif: {
      t: "Tâches planifiées à relancer",
      g: "bloquant",
      d: jamais
        ? "Évaluation des alertes, SLO, sondes uptime, purge de rétention et comptage du volume par client partagent le même déclencheur périodique. Tout ce bloc est écrit et testé ; aucune exécution n'a encore abouti en production."
        : "Le déclencheur périodique existe et a déjà abouti, mais pas depuis plus de 48 h — alertes, SLO, sondes uptime, purge et comptage du volume sont donc à l'arrêt.",
    },
  };
}

/**
 * La ligne « Latence d'alerte », depuis la lecture du battement de cœur du
 * scheduler. Même règle que la rétention : une lecture en échec est « non
 * établie », jamais « aucun passage constaté ».
 */
export function latenceDepuis(lecture: LecturePlanifie, maintenant: number): { reel: string; s: Statut } {
  if (lecture.etat === "illisible") return { reel: NON_ETABLI_PLANIFIE, s: "non-mesure" };
  const { reel, s } = ligneLatence(lecture.date, maintenant, lecture.cadenceMin ?? undefined);
  return { reel, s };
}
