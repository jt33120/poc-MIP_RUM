// Voies d'erreur opt-in (`captureErrors`) : console, ressources, CSP (la voie réseau
// vit dans apispans.ts). Opt-in parce qu'elles changent le volume d'une app du jour
// au lendemain. Toutes passent par `ErrorCollector.report`, jamais par le réseau.
import { MIP_UI_ATTR } from "./breadcrumbs";
import { boundedName } from "./event-context";
import type { ErrorCollector } from "./errors";

/** Longueur d'un chemin d'URL recopié dans un message ou une source. */
const CHEMIN_MAX = 500;

/**
 * URL sans query, fragment ni `user:pass@` : `source` (origine + chemin) et `cible`
 * (hôte + chemin, pour le message). Hors http(s), seul le schéma reste (une URL
 * `data:` porte le contenu). La cible est sans schéma car l'empreinte serveur
 * remplace toute URL absolue d'un message par « # ».
 */
export function urlNettoyee(brute: string): { source: string; cible: string } | null {
  try {
    const u = new URL(brute, location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { source: u.protocol, cible: u.protocol };
    const chemin = u.pathname.slice(0, CHEMIN_MAX);
    return { source: u.origin + chemin, cible: u.host + chemin };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════ Console ══════════════════════════════════

/** Longueur d'un message console : celle d'une exception non interceptée. */
export const CONSOLE_MESSAGE_MAX = 1000;
/** Au-delà de cette profondeur, un objet est résumé en `[Object]` / `[Array]`. */
export const CONSOLE_PROFONDEUR_MAX = 3;
/** Entrées sérialisées par objet ou tableau ; la suite devient `…`. */
export const CONSOLE_ENTREES_MAX = 20;
/** Clés dont la valeur ne quitte jamais le navigateur (filtre des props, plus cookie/session). */
const CLE_SENSIBLE =
  /pass(?:word|wd)?|pwd|secret|token|api[_-]?key|auth|bearer|cookie|session|email|e[_-]?mail|phone|ssn|credit|card|cvv|iban/i;

/** Error de ce document ou d'un autre (iframe) : `instanceof` seul ne voit pas le second. */
function estErreur(valeur: unknown): valeur is Error {
  return valeur instanceof Error || Object.prototype.toString.call(valeur) === "[object Error]";
}

/**
 * Arguments de `console.error` → message borné : Error en « Nom: message », objet
 * en JSON borné (`[Circular]`, `[NOM]` pour un nœud DOM, `[?]` pour un getter qui
 * jette), clés sensibles masquées. Le budget se vérifie pendant le parcours.
 */
export function formaterConsole(args: readonly unknown[]): string {
  let out = "";
  const pile: object[] = [];

  /** Un getter ou un Proxy qui jette ne coûte que sa propre valeur. */
  const valeur = (lire: () => unknown, profondeur: number) => {
    try {
      ecrire(lire(), profondeur);
    } catch {
      out += "[?]";
    }
  };

  const ecrire = (v: unknown, profondeur: number): void => {
    if (out.length >= CONSOLE_MESSAGE_MAX) return;
    if (typeof v === "string") {
      const texte = v.slice(0, CONSOLE_MESSAGE_MAX);
      out += profondeur ? JSON.stringify(texte) : texte;
    } else if (typeof v === "function") {
      out += "[Function]";
    } else if (v === null || typeof v !== "object") {
      out += String(v);
    } else if (estErreur(v)) {
      out += `${String(v.name)}: ${String(v.message).slice(0, CONSOLE_MESSAGE_MAX)}`;
    } else if (typeof (v as { nodeType?: unknown }).nodeType === "number") {
      out += `[${String((v as { nodeName?: unknown }).nodeName)}]`;
    } else if (pile.includes(v)) {
      out += "[Circular]";
    } else if (profondeur >= CONSOLE_PROFONDEUR_MAX || ArrayBuffer.isView(v)) {
      out += Array.isArray(v) ? "[Array]" : "[Object]";
    } else {
      pile.push(v);
      try {
        if (Array.isArray(v)) {
          out += "[";
          for (let i = 0; i < v.length && out.length < CONSOLE_MESSAGE_MAX; i++) {
            if (i === CONSOLE_ENTREES_MAX) {
              out += ",…";
              break;
            }
            if (i) out += ",";
            valeur(() => v[i], profondeur + 1);
          }
          out += "]";
        } else {
          out += "{";
          let n = 0;
          for (const cle in v) {
            if (out.length >= CONSOLE_MESSAGE_MAX) break;
            if (!Object.prototype.hasOwnProperty.call(v, cle)) continue;
            if (n === CONSOLE_ENTREES_MAX) {
              out += ",…";
              break;
            }
            out += `${n++ ? "," : ""}${JSON.stringify(cle.slice(0, 100))}:`;
            if (CLE_SENSIBLE.test(cle)) out += '"[redacted]"';
            else valeur(() => (v as Record<string, unknown>)[cle], profondeur + 1);
          }
          out += "}";
        }
      } finally {
        pile.pop();
      }
    }
  };

  for (let i = 0; i < args.length && out.length < CONSOLE_MESSAGE_MAX; i++) {
    if (i) out += " ";
    valeur(() => args[i], 0);
  }
  return out.slice(0, CONSOLE_MESSAGE_MAX);
}

function capturerConsole(errors: ErrorCollector, args: readonly unknown[]): void {
  const erreur = args.find(estErreur);
  if (erreur && errors.dejaCapture(erreur, "console")) return;
  const message = formaterConsole(args);
  if (!message) return;
  errors.report("console", {
    "mip.error_kind": "console",
    // Journalisée par l'app, l'erreur n'a pas atteint le gestionnaire global.
    "mip.error_handled": true,
    "exception.type": (erreur && boundedName(erreur.name)) || "console.error",
    "exception.message": message,
    "exception.stacktrace": erreur?.stack ? String(erreur.stack).slice(0, 4000) : "",
  });
}

/**
 * Enveloppe `console.error` ; rend les API absentes. L'original est appelé une
 * fois par appel, quoi qu'il arrive à la capture ; un appel émis pendant la
 * capture (beforeSend qui journalise) n'est pas capturé, pour ne jamais boucler.
 */
export function initConsoleErrors(errors: ErrorCollector): string[] {
  if (typeof console === "undefined" || typeof console.error !== "function") return ["console.error"];
  const original = console.error;
  let enCours = false;
  console.error = function (this: unknown, ...args: unknown[]): void {
    if (enCours) return original.apply(this, args);
    enCours = true;
    try {
      try {
        capturerConsole(errors, args);
      } catch {
        /* la capture ne casse jamais la journalisation de l'application */
      }
      return original.apply(this, args);
    } finally {
      enCours = false;
    }
  };
  return [];
}

// ════════════════════════════════ Ressources ══════════════════════════════════

type ElementRessource = Element & { currentSrc?: unknown; src?: unknown; href?: unknown; data?: unknown };

/**
 * Échecs de chargement (img, script, link, média…) → erreur `resource`. Ils ne
 * remontent pas : seul un écouteur en capture sur window les voit, et les
 * exceptions JS, sans `tagName`, en sont écartées. Aucun statut HTTP : l'événement
 * n'en porte pas (échec DNS, blocage CSP et 404 se confondent).
 */
export function initResourceErrors(errors: ErrorCollector): void {
  addEventListener(
    "error",
    (event: Event) => {
      const el = event.target as ElementRessource | null;
      if (!el || typeof el.tagName !== "string") return;
      // L'instrument ne se mesure pas lui-même : scripts et widgets de MIP RUM.
      if (typeof el.closest === "function" && el.closest(`[${MIP_UI_ATTR}]`)) return;
      const brute = [el.currentSrc, el.src, el.href, el.data]
        // `href` d'un élément SVG est un SVGAnimatedString.
        .map((v) => (v && typeof v === "object" ? (v as { baseVal?: unknown }).baseVal : v))
        .find((v): v is string => typeof v === "string" && v !== "");
      const url = brute ? urlNettoyee(brute) : null;
      if (!url) return;
      errors.report("resources", {
        "mip.error_kind": "resource",
        "exception.type": "ResourceError",
        "exception.message": `Échec de chargement ${el.tagName.toLowerCase().slice(0, 40)} ${url.cible}`,
        "mip.error_source": url.source,
      });
    },
    true,
  );
}

// ══════════════════════════════════════ CSP ═══════════════════════════════════

/** Clés d'appariement mémorisées par canal : au-delà, un doublon redevient possible, une fuite jamais. */
export const CSP_APPARIEMENTS_MAX = 100;
const DIRECTIVE = /^[a-z-]{1,40}$/;

/**
 * Champs communs à `SecurityPolicyViolationEvent` et au corps d'un rapport
 * `csp-violation` : seul le nom de la ressource bloquée diffère (URI / URL).
 */
interface ViolationCsp {
  effectiveDirective?: unknown;
  violatedDirective?: unknown;
  blockedURI?: unknown;
  blockedURL?: unknown;
  sourceFile?: unknown;
  lineNumber?: unknown;
  columnNumber?: unknown;
  disposition?: unknown;
}

/** Ce qui a été bloqué : hôte d'une URL, mot-clé (`inline`, `eval`…) ou schéma seul. */
function origineBloquee(brute: unknown): { origin: string | null; libelle: string } {
  if (typeof brute !== "string" || !brute) return { origin: null, libelle: "inconnue" };
  if (/^[a-z][a-z-]*$/i.test(brute)) return { origin: null, libelle: brute.toLowerCase() };
  try {
    const u = new URL(brute);
    return u.host ? { origin: u.origin, libelle: u.host } : { origin: null, libelle: u.protocol.slice(0, -1) };
  } catch {
    return { origin: null, libelle: "inconnue" };
  }
}

const entierPositif = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;

/**
 * Violations CSP → erreur `csp`, sans l'extrait (`sample`) ni le texte de la
 * politique ; rend les API absentes. Chromium signale une violation par l'événement
 * ET par ReportingObserver (qui rattrape aussi celles d'avant le SDK) : chaque canal
 * consomme d'abord ce que l'autre a déjà signalé sous la même clé. Le blocage de
 * l'ingestion MIP est ignoré, sinon il se reproduirait à chaque envoi.
 */
export function initCspErrors(errors: ErrorCollector, denyOrigins: readonly string[]): string[] {
  const nonSupportees: string[] = [];
  const vus = { event: new Map<string, number>(), report: new Map<string, number>() };

  const signaler = (canal: keyof typeof vus, v: ViolationCsp) => {
    const brute = v.effectiveDirective || v.violatedDirective;
    const directive = typeof brute === "string" && DIRECTIVE.test(brute) ? brute : "inconnue";
    const bloque = origineBloquee(v.blockedURL ?? v.blockedURI);
    if (bloque.origin && denyOrigins.includes(bloque.origin)) return;
    const fichier = typeof v.sourceFile === "string" && v.sourceFile ? (urlNettoyee(v.sourceFile)?.source ?? "") : "";
    const ligne = entierPositif(v.lineNumber);
    const colonne = entierPositif(v.columnNumber);
    const rapportSeul = v.disposition === "report";
    const cle = `${directive}|${bloque.libelle}|${fichier}|${ligne}|${colonne}|${rapportSeul}`;
    const autre = vus[canal === "event" ? "report" : "event"];
    const dejaSignale = autre.get(cle) ?? 0;
    if (dejaSignale) {
      if (dejaSignale > 1) autre.set(cle, dejaSignale - 1);
      else autre.delete(cle);
      return;
    }
    const mien = vus[canal];
    if (mien.has(cle) || mien.size < CSP_APPARIEMENTS_MAX) mien.set(cle, (mien.get(cle) ?? 0) + 1);
    errors.report("csp", {
      "mip.error_kind": "csp",
      "exception.type": "CSPViolation",
      "exception.message": `Violation CSP ${directive}${rapportSeul ? " (report-only)" : ""} : ${bloque.libelle}`,
      ...(fichier ? { "mip.error_source": fichier } : {}),
      ...(ligne != null ? { "mip.error_lineno": ligne } : {}),
      ...(colonne != null ? { "mip.error_colno": colonne } : {}),
    });
  };

  if (typeof SecurityPolicyViolationEvent === "function" && typeof document !== "undefined") {
    document.addEventListener("securitypolicyviolation", (e) => signaler("event", e));
  } else {
    nonSupportees.push("securitypolicyviolation");
  }

  if (typeof ReportingObserver === "function") {
    try {
      new ReportingObserver(
        (reports) => {
          for (const report of reports) {
            if (report.type === "csp-violation" && report.body) signaler("report", report.body as ViolationCsp);
          }
        },
        { types: ["csp-violation"], buffered: true },
      ).observe();
    } catch {
      nonSupportees.push("ReportingObserver");
    }
  } else {
    nonSupportees.push("ReportingObserver");
  }
  return nonSupportees;
}
