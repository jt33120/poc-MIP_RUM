// Le calcul des jours et heures LOCAUX d'un fuseau, SANS la base.
//
// Séparé de `fuseau.ts` le 24/09/2026 (ré-inventaire C-R de la piste C) : un
// composant qui ne fait que découper des heures — la heatmap, une série de jours,
// un libellé de plage — n'a pas à importer le pool de la console. Tant qu'il
// passait par `fuseau.ts`, son graphe d'import atteignait `lib/db.ts`, et il
// comptait parmi ce que la console doit encore sortir de la base
// (docs/architecture/console-api/cliquet.json). La lecture du fuseau d'une
// application, elle, reste dans `fuseau.ts` (`fuseauDe`).

/** Fuseau retenu quand l'application est inconnue, ou quand on regarde « toutes ». */
export const FUSEAU_DEFAUT = "Europe/Paris";

/**
 * Le fuseau est-il connu de Node (ICU) ? Postgres en accepte que la bibliothèque de
 * dates de Node ignore : `Intl.DateTimeFormat` lèverait alors hors de toute lecture,
 * et `/` planterait dès qu'une plage personnalisée s'afficherait (revue de vague 3).
 */
export function fuseauConnu(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ─────────────── Jours et heures LOCAUX → instants UTC (F05, règle R-T) ───────────────
//
// Trois lectures découpent jours et heures dans le fuseau de l'application (la
// heatmap, le trafic et le LCP quotidiens). Les fenêtres du contrat, elles, sont
// en UTC. Quand une case ou un jour local devient un lien, ses bornes locales sont
// donc converties ICI, côté serveur, en instants UTC — et nulle part ailleurs : un
// lien construit en ajoutant « 9 h » à minuit UTC ouvrirait, l'été à Paris, le
// trafic de 11 h.
//
// Fonctions PURES (Intl seulement, aucune lecture) : testées dans
// tests/unit/fuseau.test.ts, jours de changement d'heure compris.

const HEURE_MS = 3_600_000;
const JOUR_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// Un formateur par fuseau : la heatmap convertit 336 cases par rendu, et construire
// un `Intl.DateTimeFormat` coûte bien plus que s'en servir.
const formateurs = new Map<string, Intl.DateTimeFormat>();

function formateur(tz: string): Intl.DateTimeFormat {
  let f = formateurs.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      // Filet : un fuseau inconnu ne fait pas planter l'écran (fuseauDe le filtre déjà).
      timeZone: fuseauConnu(tz) ? tz : FUSEAU_DEFAUT,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formateurs.set(tz, f);
  }
  return f;
}

/** Heure MURALE d'un instant dans un fuseau, codée comme un instant UTC (ms). */
function murale(instantMs: number, tz: string): number {
  const parts = formateur(tz).formatToParts(new Date(instantMs));
  const val = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(val("year"), val("month") - 1, val("day"), val("hour"), val("minute"), val("second"));
}

/** « AAAA-MM-JJ » → [année, mois (1-12), jour] ; refuse une date qui n'existe pas. */
function lireJour(jour: string): [number, number, number] {
  const m = JOUR_ISO.exec(jour);
  const [a, mo, j] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [NaN, NaN, NaN];
  const d = new Date(Date.UTC(a, mo - 1, j));
  if (!m || d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) {
    throw new RangeError(`jour invalide : ${jour} (attendu AAAA-MM-JJ)`);
  }
  return [a, mo, j];
}

/**
 * Premier instant dont l'heure murale atteint `mur`. Autour d'un changement
 * d'heure, deux décalages coexistent ; chacun donne un candidat :
 *   - heure ambiguë (recul d'automne, 02:00 existe deux fois) : la PREMIÈRE
 *     occurrence — la case « 2 h » du 25/10 couvre donc ses deux heures réelles ;
 *   - heure inexistante (saut de printemps) : l'instant du saut.
 */
function premierInstant(mur: number, tz: string): number {
  const decalages = new Set([mur - 12 * HEURE_MS, mur, mur + 12 * HEURE_MS].map((i) => murale(i, tz) - i));
  const candidats = [...decalages].map((d) => mur - d).filter((i) => murale(i, tz) >= mur);
  return Math.min(...candidats);
}

/** Instant ISO UTC sans millisecondes : « 2026-09-10T07:00:00Z ». */
function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Bornes UTC `[from, to)` de l'heure LOCALE `heure` (0-23) du jour local `jour`.
 * Paris, un jour d'été : 9 h → `from = …T07:00:00Z`, `to = …T08:00:00Z`. L'heure
 * répétée d'un jour de recul dure deux heures réelles ; l'heure sautée d'un jour
 * d'avance n'existe pas : `from === to`, plage vide (aucune mesure n'y tombe).
 */
export function bornesHeureLocale(jour: string, heure: number, tz: string): { from: string; to: string } {
  if (!Number.isInteger(heure) || heure < 0 || heure > 23) throw new RangeError(`heure invalide : ${heure} (0 à 23)`);
  const [a, mo, j] = lireJour(jour);
  return {
    from: iso(premierInstant(Date.UTC(a, mo - 1, j, heure), tz)),
    to: iso(premierInstant(Date.UTC(a, mo - 1, j, heure + 1), tz)),
  };
}

/**
 * Bornes UTC `[from, to)` du jour LOCAL `jour` : de son minuit local au minuit
 * local du lendemain. Le 10/09 à Paris → `2026-09-09T22:00:00Z` →
 * `2026-09-10T22:00:00Z` ; un jour de changement d'heure dure 23 ou 25 heures.
 */
export function bornesJourLocal(jour: string, tz: string): { from: string; to: string } {
  const [a, mo, j] = lireJour(jour);
  return {
    from: iso(premierInstant(Date.UTC(a, mo - 1, j), tz)),
    to: iso(premierInstant(Date.UTC(a, mo - 1, j + 1), tz)),
  };
}

const deux = (n: number) => String(n).padStart(2, "0");
const jourMois = (mur: number) => `${deux(new Date(mur).getUTCDate())}/${deux(new Date(mur).getUTCMonth() + 1)}`;
const heureMinute = (mur: number) => `${deux(new Date(mur).getUTCHours())}:${deux(new Date(mur).getUTCMinutes())}`;
const clef = (mur: number) => new Date(mur).toISOString().slice(0, 10);

/**
 * Une plage `[debut, fin)` d'heures murales : « 10/09 09:00-10:00 » sur un même
 * jour, « 10/09 00:00-24:00 » quand elle finit au minuit suivant, sinon les deux
 * dates. `sansDate` retire la date quand l'appelant l'a déjà écrite.
 */
function plageMurale(debut: number, fin: number, sansDate = false): string {
  const tete = sansDate ? "" : `${jourMois(debut)} `;
  if (clef(debut) === clef(fin)) return `${tete}${heureMinute(debut)}-${heureMinute(fin)}`;
  const minuitSuivant = heureMinute(fin) === "00:00" && clef(fin) === clef(debut + 24 * HEURE_MS);
  if (minuitSuivant) return `${tete}${heureMinute(debut)}-24:00`;
  return `${jourMois(debut)} ${heureMinute(debut)} - ${jourMois(fin)} ${heureMinute(fin)}`;
}

/**
 * Une plage UTC écrite dans les DEUX fuseaux, pour l'écran d'arrivée d'un lien :
 * « 10/09 09:00-10:00 Europe/Paris (07:00-08:00 UTC) » ;
 * « 10/09 00:00-24:00 Europe/Paris (09/09 22:00 - 10/09 22:00 UTC) ».
 * La date UTC n'est répétée que si elle diffère de la date locale.
 */
export function libelleDeuxFuseaux(from: string, to: string, tz: string): string {
  const debut = Date.parse(from);
  const fin = Date.parse(to);
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) throw new RangeError(`plage illisible : ${from} → ${to}`);
  const local = plageMurale(murale(debut, tz), murale(fin, tz));
  if (tz === "UTC" || tz === "Etc/UTC") return `${local} UTC`;
  const memeDate = clef(debut) === clef(murale(debut, tz));
  return `${local} ${tz} (${plageMurale(debut, fin, memeDate)} UTC)`;
}

/**
 * Les `n` derniers jours LOCAUX, du plus ancien au plus récent, aujourd'hui (dans
 * `tz`) compris : l'axe de la heatmap, construit dans le MÊME repère que ses cases.
 * L'ancien axe prenait les jours UTC : à Paris entre minuit et 2 h, la rangée du
 * jour manquait, et chaque case glissait d'une rangée.
 */
export function joursLocaux(n: number, tz: string, maintenantMs: number = Date.now()): string[] {
  const aujourdhui = new Date(murale(maintenantMs, tz));
  return Array.from({ length: n }, (_v, i) =>
    clef(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth(), aujourdhui.getUTCDate() - (n - 1 - i))),
  );
}
