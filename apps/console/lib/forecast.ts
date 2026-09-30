// L'axe des jours des « Tendances », côté console.
//
// Le calcul (droite, bruit, échéance, datation) vit dans `@mip/stats` : la console,
// le service `api` et console-api le compilent tel quel. Reste ici ce qui tient à
// la CONSOLE — la façon dont node-postgres rend un jour, et l'axe de repli calculé
// dans le fuseau de l'app quand aucune lecture n'a répondu.
import { jourDecale } from "@mip/stats/tendance";

/**
 * Clé « AAAA-MM-JJ » d'un jour rendu par PostgreSQL. node-postgres rend un
 * `date` (et un `timestamp` sans fuseau) comme un `Date` à minuit LOCAL :
 * `String(date).slice(0, 10)` donnait « Tue Sep 22 », et l'axe affichait
 * « undefined/undefined ». On lit donc les composantes locales, qui sont
 * justement celles que le pilote a posées.
 */
export function cleJour(v: unknown): string {
  if (v instanceof Date) {
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const jj = String(v.getDate()).padStart(2, "0");
    return `${v.getFullYear()}-${mm}-${jj}`;
  }
  return String(v).slice(0, 10);
}

/** « AAAA-MM-JJ » d'un instant dans un fuseau ; un fuseau inconnu retombe sur UTC plutôt que de planter. */
function jourDansFuseau(ms: number, tz: string): string {
  const options = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: tz });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
  }
  const parts = f.formatToParts(ms);
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/**
 * Les `n` jours COMPLETS de la fenêtre des Tendances dans le fuseau `tz` : de J−n
 * à J−1, J = aujourd'hui dans ce fuseau. La journée en cours n'y est jamais : un
 * jour entamé n'a qu'une partie de son trafic, sa p75 et ses comptes ne se
 * comparent pas aux autres. Axe de repli quand aucune lecture n'a répondu.
 */
export function joursComplets(tz: string, maintenantMs: number, n = 14): string[] {
  const aujourdhui = jourDansFuseau(maintenantMs, tz);
  return Array.from({ length: n }, (_v, i) => jourDecale(aujourdhui, i - n));
}
