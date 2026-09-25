// Lecture d'une section d'écran (F02, § 3.8 et § 4.2 du plan frontend).
//
// POURQUOI CE MODULE. Les lectures « fail-soft » rendaient une valeur de repli
// (`[]`, un objet de zéros) quand la base bronchait : l'écran affichait alors
// « Aucune donnée » ou « 0 » sur une fenêtre où l'on n'avait simplement RIEN LU.
// Un vide réel et une lecture en échec devenaient indiscernables (V3). Désormais
// la lecture lève, et c'est la SECTION qui décide : `lire` transforme l'exception
// en valeur (`{ ok: false }`) pour que la section rende l'état « erreur » — et
// que les autres sections de l'écran, elles, s'affichent normalement (fin du
// `Promise.all` qui faisait tomber tout l'écran pour une lecture).
//
// CE QUE `lire` NE CAPTURE PAS.
//   - Un filtre que la lecture ne sait pas appliquer (`UnsupportedFilterError`) :
//     c'est un refus du contrat, pas une panne. L'écran le rend en refus, jamais
//     en « lecture en échec » qu'on lirait comme passagère (V10).
//   - Les signaux de contrôle de Next (`notFound()`, `redirect()`, rendu dynamique) :
//     les avaler casserait la navigation. `unstable_rethrow` les relance.
import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { forwardLog } from "./log-forward";
import { UnsupportedFilterError } from "./query-compiler";
import { traceFields } from "./server-trace-core";

export type Lecture<T> = { ok: true; data: T } | { ok: false; raison: string };

/**
 * Une section telle qu'un ÉCRAN la lit : lue, ou en échec — sans la raison, qui
 * reste au journal. Une `Lecture` locale comme une `Section` reçue d'un chargeur
 * (`lib/chargeurs/`, sur le fil) s'y rangent : un composant qui n'affiche que le
 * titre d'une section en échec prend ce type, et sert les deux.
 */
export type SectionLue<T> = { readonly ok: true; readonly data: T } | { readonly ok: false };

/**
 * Exécute une lecture et rend son résultat ou sa raison d'échec, sans lever.
 *
 * La raison est le message de l'exception : elle sert aux journaux et aux tests,
 * JAMAIS à l'écran (un message de pilote PostgreSQL peut nommer un hôte ou une
 * table). L'écran n'affiche que le titre de la section en échec.
 *
 * L'échec est journalisé côté serveur, sur le même canal que les erreurs de
 * l'API publique (`lib/log-forward.ts`, page /logs de la console) : une section
 * en erreur sans trace serveur serait une panne que seul l'utilisateur voit.
 */
export async function lire<T>(fn: () => Promise<T>): Promise<Lecture<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UnsupportedFilterError) throw e;
    const raison = e instanceof Error ? e.message : String(e);
    journaliser(e, raison);
    return { ok: false, raison };
  }
}

function journaliser(e: unknown, raison: string): void {
  console.error("[lecture] lecture en échec :", e);
  const pile = e instanceof Error && e.stack ? `\n${e.stack}` : "";
  // Corrélation capturée MAINTENANT : le contexte de trace n'est pas garanti à
  // l'intérieur du rappel différé (même règle que `lib/api/handle.ts`).
  const corr = traceFields();
  const envoyer = () => forwardLog("error", `[lecture] ${raison}${pile}`, corr);
  try {
    // Après la réponse : la journalisation ne retarde jamais l'écran.
    after(envoyer);
  } catch {
    // Hors d'une requête (tests, script) `after` n'existe pas : envoi direct,
    // `forwardLog` ne lève jamais.
    void envoyer();
  }
}
