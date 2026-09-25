// `next/server` DANS LE SERVICE `console-api` : ce que les chargeurs de la
// console en utilisent — `after()`, par `lire()` (`lib/lecture.ts`) pour
// journaliser une section en échec après la réponse. Hors de Next, « après la
// réponse » devient « au prochain tour » : la journalisation ne retarde jamais
// la section, et une exception du rappel ne remonte pas.

/** @param {() => unknown} rappel */
export function after(rappel) {
  queueMicrotask(() => {
    Promise.resolve()
      .then(rappel)
      .catch(() => {});
  });
}
