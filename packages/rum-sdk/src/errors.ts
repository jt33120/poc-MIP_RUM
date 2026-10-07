import { currentRoute, scrubUrl } from "./context";
import { makeCap, type PageCap } from "./caps";
import type { ErrorCategory, ErrorCategoryStats } from "./types";

export type AttrValue = string | number | boolean;
/** ts optionnel : timestamp d'origine (epoch ms) pour les rejeux consent/retry. */
export type Emit = (name: string, attrs: Record<string, AttrValue>, ts?: number) => void;

// Plafond et déduplication des erreurs (finding 2.1, l'audit RUM externe).
// Une erreur en boucle (rAF, rendu qui reboucle) passe toujours l'échantillonnage,
// sature la limite de débit de l'ingestion puis se rejoue à chaque page. Une même
// erreur répétée est donc COMPTÉE (`mip.error_count`, que l'ingestion somme pour
// garder des compteurs justes), pas transmise mille fois.

/** Erreurs distinctes transmises par page. Au-delà, on compte sans émettre. */
export const ERREURS_PAR_PAGE = 50;

/**
 * Erreurs distinctes par page, voie par voie : une console bavarde ou des
 * vignettes en échec ne font jamais taire une vraie exception.
 */
export const PLAFONDS_PAR_VOIE: Readonly<Record<ErrorCategory, number>> = {
  uncaught: ERREURS_PAR_PAGE,
  console: 20,
  resources: 20,
  csp: 10,
  network: 20,
  workers: 10,
  websockets: 10,
};

/** Silence entre deux transmissions d'une MÊME empreinte, en millisecondes. */
export const FENETRE_SILENCE_MS = 10_000;

/**
 * Empreinte locale : type + message + première ligne de pile. Plus grossière que
 * celle de l'ingestion (`errorFingerprint`) : elle doit reconnaître la même erreur
 * qui se répète, même si son message porte un compteur ou un horodatage.
 */
export function empreinteLocale(type: string, message: string, stack: string): string {
  const premiere = (stack.split("\n")[1] ?? "").trim().slice(0, 120);
  // Les nombres varient d'une occurrence à l'autre sans changer la nature du bug.
  const msg = message.replace(/\d+/g, "#").slice(0, 200);
  return `${type}|${msg}|${premiere.replace(/\d+/g, "#")}`;
}

export interface Etranglement {
  /** Rend le nombre d'occurrences à annoncer (≥ 1) si le span part, sinon `null`. */
  admettre(empreinte: string, maintenant: number): number | null;
  /**
   * Rend les répétitions tues depuis la dernière transmission et remet leur
   * compteur à zéro, sans rendre de slot au plafond.
   */
  drainer(maintenant: number): Array<{ empreinte: string; occurrences: number }>;
  reset(): void;
}

/**
 * Compteur par empreinte avec fenêtre de silence : une répétition dans la fenêtre
 * est comptée et voyage avec la transmission suivante. Le plafond porte sur les
 * empreintes distinctes (les causes), pas sur les occurrences.
 */
export function creerEtranglement(
  plafond: number = ERREURS_PAR_PAGE,
  fenetreMs: number = FENETRE_SILENCE_MS,
): Etranglement {
  let vues = new Map<string, { accumule: number; dernierEnvoi: number }>();
  const cap: PageCap = makeCap(plafond);
  return {
    admettre(empreinte, maintenant) {
      const e = vues.get(empreinte);
      if (!e) {
        // Empreinte nouvelle : elle consomme un slot du plafond de la page.
        if (!cap.take()) return null;
        vues.set(empreinte, { accumule: 0, dernierEnvoi: maintenant });
        return 1;
      }
      if (maintenant - e.dernierEnvoi >= fenetreMs) {
        const n = e.accumule + 1;
        e.accumule = 0;
        e.dernierEnvoi = maintenant;
        return n;
      }
      e.accumule++;
      return null;
    },
    drainer(maintenant) {
      const restants: Array<{ empreinte: string; occurrences: number }> = [];
      for (const [empreinte, e] of vues) {
        if (!e.accumule) continue;
        restants.push({ empreinte, occurrences: e.accumule });
        e.accumule = 0;
        e.dernierEnvoi = maintenant;
      }
      return restants;
    },
    reset() {
      vues = new Map();
      cap.reset();
    },
  };
}

/** Compteurs d'une voie, en occurrences : ce qui est parti, tu par le plafond, refusé. */
export type CompteursVoie = Pick<ErrorCategoryStats, "emitted" | "capped" | "rejected">;

/** Voie par laquelle un objet d'erreur a été vu pendant la tâche courante. */
export type VoieObjet = "console" | "uncaught" | "manual";

export interface ErrorCollector {
  /**
   * Chemin commun des voies : plafond, silence par empreinte, drain, puis émission.
   * `ts` : horodatage d'origine d'une erreur constatée après coup (réponse réseau).
   */
  report(voie: ErrorCategory, attrs: Record<string, AttrValue>, ts?: number): void;
  /**
   * Vrai si la capture de cet objet est à ignorer ; sinon il est mémorisé jusqu'à
   * la fin de la tâche. Un objet journalisé puis levé est un seul incident : la
   * console ignore un objet déjà vu, une exception non interceptée un objet déjà
   * journalisé ; `addError` émet toujours. La tâche finit au prochain macrotask :
   * un rejet non géré n'est signalé qu'après le vidage des microtasks.
   */
  dejaCapture(objet: unknown, voie: VoieObjet): boolean;
  drainer(maintenant: number): Array<{ empreinte: string; occurrences: number }>;
  reset(): void;
  /** Métriques de drops par voie, cumulées depuis init() (un reset ne les efface pas). */
  compteurs(): Record<ErrorCategory, CompteursVoie>;
}

/**
 * Branche la collecte d'erreurs et rend le collecteur, que le pageview remet à
 * zéro et que rejoignent les voies opt-in (error-capture.ts, apispans.ts).
 * `emit` rend `false` quand l'émission refuse l'erreur (compteur `rejected`).
 */
export function initErrors(
  emit: (name: string, attrs: Record<string, AttrValue>, ts?: number) => unknown,
  horloge: () => number = Date.now,
  action: (at: number) => Record<string, AttrValue> = () => ({}),
): ErrorCollector {
  type Detail = { attrs: Record<string, AttrValue>; ts: number };
  interface Voie {
    etr: Etranglement;
    // Bornées par le plafond : seule une empreinte qui a obtenu un slot y entre,
    // jamais le texte d'une empreinte refusée.
    details: Map<string, Detail>;
    // Première occurrence tue après une émission : c'est son contexte, et non celui
    // d'une navigation ou d'un pagehide ultérieur, qui part avec le lot compacté.
    pendingDetails: Map<string, Detail>;
    compteurs: CompteursVoie;
  }
  const voies = {} as Record<ErrorCategory, Voie>;
  for (const [nom, plafond] of Object.entries(PLAFONDS_PAR_VOIE) as Array<[ErrorCategory, number]>) {
    voies[nom] = {
      etr: creerEtranglement(plafond),
      details: new Map(),
      pendingDetails: new Map(),
      compteurs: { emitted: 0, capped: 0, rejected: 0 },
    };
  }

  const emettre = (voie: Voie, attrs: Record<string, AttrValue>, ts: number, occurrences: number) => {
    if (emit("exception", attrs, ts) === false) voie.compteurs.rejected += occurrences;
    else voie.compteurs.emitted += occurrences;
  };

  const report = (nom: ErrorCategory, attrs: Record<string, AttrValue>, ts: number = horloge()) => {
    const voie = voies[nom];
    const empreinte = empreinteLocale(
      String(attrs["exception.type"] ?? ""),
      String(attrs["exception.message"] ?? ""),
      String(attrs["exception.stacktrace"] ?? ""),
    );
    const detail: Detail = {
      // La route de l'erreur, figée ici : au drain, après une navigation, celle que
      // `realEmit` pose par défaut serait la nouvelle.
      attrs: { ...action(ts), ...attrs, "mip.route": currentRoute() },
      ts,
    };
    const n = voie.etr.admettre(empreinte, ts);
    if (n == null) {
      // `null` : répétition tue (elle a un slot, gardée pour le drain) ou empreinte
      // refusée par le cap (comptée perdue, jamais stockée).
      if (!voie.details.has(empreinte)) voie.compteurs.capped++;
      else if (!voie.pendingDetails.has(empreinte)) voie.pendingDetails.set(empreinte, detail);
      return;
    }
    const original = n > 1 ? (voie.pendingDetails.get(empreinte) ?? detail) : detail;
    voie.pendingDetails.delete(empreinte);
    voie.details.set(empreinte, detail);
    // `mip.error_count` seulement au-delà de 1 : une erreur isolée n'alourdit pas le lot.
    emettre(voie, n > 1 ? { ...original.attrs, "mip.error_count": n } : original.attrs, original.ts, n);
  };

  let objetsVus = new WeakMap<object, VoieObjet>();
  let purgePrevue = false;
  const dejaCapture = (objet: unknown, voie: VoieObjet): boolean => {
    if (objet === null || (typeof objet !== "object" && typeof objet !== "function")) return false;
    const precedente = objetsVus.get(objet);
    if (precedente) return voie === "console" || (voie === "uncaught" && precedente === "console");
    objetsVus.set(objet, voie);
    if (!purgePrevue) {
      purgePrevue = true;
      setTimeout(() => {
        objetsVus = new WeakMap();
        purgePrevue = false;
      }, 0);
    }
    return false;
  };

  addEventListener("error", (e: ErrorEvent) => {
    if (dejaCapture(e.error, "uncaught")) return;
    const type = e.error?.name ?? "Error";
    const message = String(e.message ?? "").slice(0, 1000);
    const stack = String(e.error?.stack ?? "").slice(0, 4000);
    report("uncaught", {
      "mip.error_kind": "error",
      "exception.message": message,
      "exception.type": type,
      "exception.stacktrace": stack,
      "mip.error_source": scrubUrl(String(e.filename ?? "")),
      "mip.error_lineno": e.lineno ?? 0,
      "mip.error_colno": e.colno ?? 0,
    });
  });

  addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    if (dejaCapture(e.reason, "uncaught")) return;
    const reason = e.reason as Error | unknown;
    const isErr = reason instanceof Error;
    const type = isErr ? reason.name : "UnhandledRejection";
    const message = String(isErr ? reason.message : (reason ?? "")).slice(0, 1000);
    const stack = String(isErr ? (reason.stack ?? "") : "").slice(0, 4000);
    report("uncaught", {
      "mip.error_kind": "unhandledrejection",
      "exception.message": message,
      "exception.type": type,
      "exception.stacktrace": stack,
    });
  });

  return {
    report,
    dejaCapture,
    drainer(maintenant) {
      for (const voie of Object.values(voies)) {
        for (const queued of voie.etr.drainer(maintenant)) {
          const detail = voie.pendingDetails.get(queued.empreinte) ?? voie.details.get(queued.empreinte);
          if (!detail) continue;
          emettre(voie, { ...detail.attrs, "mip.error_count": queued.occurrences }, detail.ts, queued.occurrences);
          // Le prochain groupe tu gardera sa propre première occurrence.
          voie.pendingDetails.delete(queued.empreinte);
        }
      }
      return [];
    },
    reset() {
      for (const voie of Object.values(voies)) {
        voie.details.clear();
        voie.pendingDetails.clear();
        voie.etr.reset();
      }
    },
    compteurs() {
      const copie = {} as Record<ErrorCategory, CompteursVoie>;
      for (const [nom, voie] of Object.entries(voies) as Array<[ErrorCategory, Voie]>) copie[nom] = { ...voie.compteurs };
      return copie;
    },
  };
}
