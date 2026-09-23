// Manifeste des captures de la vitrine (plan § 8.3, lot P**.7) : pour chaque image
// de public/portail/, la route capturée, le thème, les dimensions, le jour de la
// prise, le commit et le jeu de données.
//
// UN SEUL AUTEUR. scripts/captures-portail.mjs l'écrit en même temps que les images,
// et seulement quand toutes ont passé ses garde-fous : un manifeste présent date donc
// des images réellement prises ensemble. Tant qu'il n'existe pas, la date des
// captures en place n'est pas établie, et la légende de la vitrine (PS0) n'en
// affiche aucune plutôt que d'en inventer une.
//
// LU SUR LE DISQUE, À CHAQUE REQUÊTE. La vitrine est `force-dynamic` ; le fichier est
// petit. Le chemin est relatif au répertoire de la console (process.cwd() de
// `next start`), et next.config.mjs l'ajoute au traçage de la route /presentation
// pour qu'il accompagne la fonction déployée. Absent, illisible ou mal formé : `null`
// — une date douteuse ne s'affiche pas. Le test tests/unit/portail-visuels.test.ts
// refuse, lui, un manifeste versionné mal formé : la page n'a pas à le signaler.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Chemin du manifeste, relatif au répertoire de la console. */
export const CHEMIN_MANIFESTE_PORTAIL = "public/portail/manifest.json";

/** Les deux captures de la vue d'ensemble (V-A), une par thème, que montre l'en-tête. */
export const CAPTURES_VUE_ENSEMBLE = ["overview-light.png", "overview-dark.png"] as const;

/** Une entrée du manifeste : une image de public/portail/. */
export interface CapturePortail {
  /** Nom du fichier dans public/portail/. */
  fichier: string;
  /** Route capturée, requête comprise (`/?app=demo-app`). */
  route: string;
  theme: "light" | "dark";
  /** Dimensions réelles de l'image, en pixels, lues dans son en-tête PNG. */
  largeur: number;
  hauteur: number;
  /** Jour de la prise, AAAA-MM-JJ (Europe/Paris). */
  date: string;
  /** Commit du dépôt au moment de la prise ; suffixe `-dirty` si des fichiers suivis étaient modifiés. */
  sha: string;
  /** Script qui a produit le trafic capturé. */
  jeu: string;
}

const FICHIER = /^[a-z0-9-]+\.png$/;
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHA = /^[0-9a-f]{7,40}(-dirty)?$/;

/** Un jour AAAA-MM-JJ qui existe au calendrier (pas de 31/02). */
function jourValide(date: string): boolean {
  const m = DATE_ISO.exec(date);
  if (!m) return false;
  const [a, mois, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mois - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mois - 1 && d.getUTCDate() === j;
}

const entier = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const texte = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";

/**
 * Le manifeste tel que le script l'écrit, ou `null` s'il ne l'est pas : tableau non
 * vide, chaque entrée complète et bien typée, aucun fichier deux fois. Une seule
 * entrée fautive rejette le tout — on ne date pas une image sur un manifeste abîmé.
 */
export function analyserManifestePortail(brut: unknown): CapturePortail[] | null {
  if (!Array.isArray(brut) || brut.length === 0) return null;
  const vus = new Set<string>();
  const sortie: CapturePortail[] = [];
  for (const e of brut) {
    if (typeof e !== "object" || e === null) return null;
    const { fichier, route, theme, largeur, hauteur, date, sha, jeu } = e as Record<string, unknown>;
    if (typeof fichier !== "string" || !FICHIER.test(fichier) || vus.has(fichier)) return null;
    if (typeof route !== "string" || !route.startsWith("/")) return null;
    if (theme !== "light" && theme !== "dark") return null;
    if (!entier(largeur) || !entier(hauteur)) return null;
    if (typeof date !== "string" || !jourValide(date)) return null;
    if (typeof sha !== "string" || !SHA.test(sha)) return null;
    if (!texte(jeu)) return null;
    vus.add(fichier);
    sortie.push({ fichier, route, theme, largeur, hauteur, date, sha, jeu });
  }
  return sortie;
}

/** Le manifeste de `racine/public/portail/`, ou `null` s'il manque ou ne se lit pas. */
export function lireManifestePortail(racine: string = process.cwd()): CapturePortail[] | null {
  try {
    return analyserManifestePortail(JSON.parse(readFileSync(join(racine, CHEMIN_MANIFESTE_PORTAIL), "utf8")));
  } catch {
    return null;
  }
}

/**
 * Le jour de prise (AAAA-MM-JJ) commun à `fichiers`, ou `null` : sans manifeste,
 * quand l'un d'eux n'y figure pas (son image est une ancienne, de date inconnue), ou
 * quand ils n'ont pas été pris le même jour. La légende d'une image montrée en clair
 * ET en sombre ne vaut que pour les deux.
 */
export function dateDesCaptures(manifeste: readonly CapturePortail[] | null, fichiers: readonly string[]): string | null {
  if (!manifeste || fichiers.length === 0) return null;
  const dates = new Set<string>();
  for (const f of fichiers) {
    const e = manifeste.find((c) => c.fichier === f);
    if (!e) return null;
    dates.add(e.date);
  }
  return dates.size === 1 ? [...dates][0] : null;
}

/** AAAA-MM-JJ → JJ/MM/AAAA, la forme des dates de la vitrine (celle du relevé). */
export function dateAffichee(iso: string): string {
  const m = DATE_ISO.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
