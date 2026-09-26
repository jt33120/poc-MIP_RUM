import { FUSEAU_AFFICHAGE } from "./fuseau-local";

// Espace insécable (U+00A0) : « 12,4 % » et « 3 mesures » ne se séparent jamais en
// fin de ligne. Construite par son code : écrite telle quelle, elle est invisible à
// la relecture et se perd au premier copier-coller.
const NBSP = String.fromCharCode(0xa0);

/** Durées : 245 -> "245 ms", 2340 -> "2,34 s". CLS (sans unité) : 3 décimales, virgule française. */
export function fmtVital(name: string, value: number | null): string {
  if (value == null) return "—";
  // `toFixed` écrit le séparateur anglais : la recette a relevé « 0.172 » à côté
  // de « 0,172 » sur le même écran.
  if (name === "CLS") return value.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  if (value >= 1000) return (value / 1000).toFixed(2).replace(".", ",") + " s";
  return Math.round(value) + " ms";
}

/**
 * Le mot accordé au nombre : `accord(1, "mesure")` → « mesure »,
 * `accord(3, "mesure")` → « mesures », `accord(2, "travail", "travaux")`.
 *
 * Règle française : le singulier sous 2 (« 0 mesure », « 1,5 mesure »). Un
 * libellé en « (s) » ne se lit pas à voix haute et fait brouillon : la recette l'a
 * relevé sur presque tous les écrans.
 */
export function accord(n: number, singulier: string, pluriel?: string): string {
  return Math.abs(n) < 2 ? singulier : (pluriel ?? `${singulier}s`);
}

/**
 * Un compte suivi de son nom accordé : `pluriel(1, "mesure")` → « 1 mesure »,
 * `pluriel(1240, "session")` → « 1 240 sessions ». Nombre en chiffres français et
 * espace insécable avant le nom.
 */
export function pluriel(n: number, singulier: string, plurielForme?: string): string {
  return `${n.toLocaleString("fr-FR")}${NBSP}${accord(n, singulier, plurielForme)}`;
}

/** Nombre à la française : 0.172 → « 0,172 », 1240 → « 1 240 ». */
export function fmtNombre(v: number | null, maxDecimales = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: maxDecimales });
}

/**
 * Borne d'un Web Vital telle qu'un texte l'écrit : 2 500 → « 2,5 s », 4 000 →
 * « 4,0 s », 200 → « 200 ms », 0,25 → « 0,25 » (CLS, sans unité). Une phrase qui
 * cite un seuil le lit dans `THRESHOLDS` et le formate ici : recopié à la main, un
 * seuil finit par diverger de celui qui colore l'écran — c'est arrivé au LCP.
 */
export function fmtBorne(name: string, value: number): string {
  if (name === "CLS") return value.toLocaleString("fr-FR");
  if (value >= 1000) {
    return `${(value / 1000).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} s`;
  }
  return `${Math.round(value)} ms`;
}

/** Latence en ms : 245 -> "245 ms", 2340 -> "2,34 s". (sans nom de vital) */
export function fmtLatency(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return (v / 1000).toFixed(2).replace(".", ",") + " s";
  return Math.round(v) + " ms";
}

/** Taux 0..1 -> "3,2 %" (espace insécable avant « % »). */
export function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1).replace(".", ",") + NBSP + "%";
}

// ─────────────────────────────── Dates et heures ───────────────────────────────
//
// TOUTES dans le fuseau d'affichage (`FUSEAU_AFFICHAGE`, heure de Paris), nommé
// une fois dans la barre du haut. Sans `timeZone`, `toLocaleString` prend le fuseau
// de la machine qui rend : celui du serveur (UTC sur Vercel) pour une page, celui
// du navigateur pour un composant client — deux heures différentes pour un même
// instant, et aucune des deux n'était dite.

const FORMATEURS_DATE = new Map<string, Intl.DateTimeFormat>();

function formateurDate(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cle = JSON.stringify(options);
  let f = FORMATEURS_DATE.get(cle);
  if (!f) {
    f = new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: FUSEAU_AFFICHAGE, hourCycle: "h23" });
    FORMATEURS_DATE.set(cle, f);
  }
  return f;
}

function instant(d: Date | string | number): number {
  return d instanceof Date ? d.getTime() : typeof d === "number" ? d : Date.parse(d);
}

/** « 26/09 14:03 », heure de Paris. Un instant illisible → « — ». */
export function fmtDate(d: Date | string | number): string {
  const ms = instant(d);
  if (!Number.isFinite(ms)) return "—";
  return formateurDate({ day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms);
}

/**
 * Un instant écrit pour une phrase ou une cellule, heure de Paris : « 26/09 à
 * 14:03 ». Options : `annee` (« 26/09/2026 à 14:03 »), `secondes` (« 14:03:27 »),
 * `sansA` (« 26/09 14:03 », pour une colonne). Jamais d'ISO à l'écran.
 */
export function fmtInstant(
  d: Date | string | number,
  { annee = false, secondes = false, sansA = false }: { annee?: boolean; secondes?: boolean; sansA?: boolean } = {},
): string {
  const ms = instant(d);
  if (!Number.isFinite(ms)) return "—";
  const jour = formateurDate(annee ? { day: "2-digit", month: "2-digit", year: "numeric" } : { day: "2-digit", month: "2-digit" }).format(ms);
  return `${jour}${sansA ? " " : " à "}${fmtHeure(ms, { secondes })}`;
}

/** « 14:03 » (ou « 14:03:27 »), heure de Paris. */
export function fmtHeure(d: Date | string | number, { secondes = false }: { secondes?: boolean } = {}): string {
  const ms = instant(d);
  if (!Number.isFinite(ms)) return "—";
  return formateurDate(
    secondes ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" },
  ).format(ms);
}

/**
 * Une plage d'instants, heure de Paris : « 20/09 14:00 → 21/09 14:00 ». Sans nom de
 * fuseau : il est dit une fois dans la barre du haut. Sert aux références de
 * comparaison (« vs 24 h précédentes (…) »), qui l'écrivaient en UTC.
 */
export function fmtPlage(from: Date | string | number, to: Date | string | number): string {
  return `${fmtDate(from)} → ${fmtDate(to)}`;
}

/** « 26/09 » (ou « 26/09/2026 »), jour de Paris. */
export function fmtJour(d: Date | string | number, { annee = false }: { annee?: boolean } = {}): string {
  const ms = instant(d);
  if (!Number.isFinite(ms)) return "—";
  return formateurDate(annee ? { day: "2-digit", month: "2-digit", year: "numeric" } : { day: "2-digit", month: "2-digit" }).format(ms);
}

/** Détection navigateur grossière pour l'affichage (pas d'analytics fine au POC). */
export function browserFromUA(ua: string | null): string {
  if (!ua) return "—";
  if (/edg\//i.test(ua)) return "Edge";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/chrome|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Autre";
}

/**
 * Version MAJEURE du navigateur — le seul chiffre qui porte une décision
 * (« ce parc est-il au-dessus de Chrome 111, minimum requis par l'injection en
 * MAIN world ? »). Edge se déclare AUSSI « Chrome/… » : son `Edg/` est donc lu
 * en premier, sinon tout Edge serait compté comme Chrome.
 */
export function browserMajorFromUA(ua: string | null): number | null {
  if (!ua) return null;
  for (const re of [/edg\/(\d+)/i, /firefox\/(\d+)/i, /chrome\/(\d+)/i, /version\/(\d+).*safari/i]) {
    const m = re.exec(ua);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Système du poste, lu dans l'User-Agent. Windows 11 est INDISCERNABLE de
 * Windows 10 dans l'UA (les deux annoncent « Windows NT 10.0 ») : on s'arrête donc
 * à « Windows », plutôt que d'afficher une version fausse une fois sur deux.
 */
export function platformFromUA(ua: string | null): string | null {
  if (!ua) return null;
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

/**
 * Une URL de script, découpée pour être LISIBLE dans une colonne étroite.
 *
 * POURQUOI PAS L'URL ENTIÈRE, TRONQUÉE. Une troncature de fin sur
 * `https://app.exemple.fr/static/js/vendor/panier.a1b2c3.js` donne
 * « https://app.… » : le préfixe est identique pour tous les scripts d'un même
 * site, donc la seule partie affichée est la seule qui n'apprend rien. Ce qu'on
 * cherche est à la FIN — le nom du fichier.
 *
 * Rend le nom de fichier d'un côté, l'hôte de l'autre. Une URL qu'on ne sait pas
 * analyser est rendue telle quelle en `fichier`, sans hôte : mieux vaut une
 * chaîne brute qu'une cellule vide.
 */
export function decouperUrlScript(url: string | null): { fichier: string; hote: string | null } {
  if (!url) return { fichier: "(inconnu)", hote: null };
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    return { fichier: segments[segments.length - 1] || u.pathname || "/", hote: u.host };
  } catch {
    return { fichier: url, hote: null };
  }
}

/**
 * Le nom d'une cible entre guillemets français, espaces insécables comprises : la
 * question se lit « Supprimer l'objectif « Inscription » ? » sans que le
 * navigateur ne coupe la ligne entre le guillemet et le nom.
 *
 * ICI, et pas dans `components/ConfirmationDanger.tsx` : une fonction exportée par
 * un module `"use client"` n'est, vue d'un composant serveur, qu'une référence
 * client — l'appeler côté serveur fait tomber la page en 500 (contre-recette du
 * 26/09/2026). Garde : tests/unit/use-client-exports.test.ts.
 */
export const entreGuillemets = (nom: string) => `«\u00a0${nom}\u00a0»`;
