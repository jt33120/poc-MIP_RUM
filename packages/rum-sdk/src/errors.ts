import { currentRoute, scrubUrl } from "./context";
import { makeCap, type PageCap } from "./caps";
import type { ErrorCategory, ErrorCategoryStats } from "./types";

export type AttrValue = string | number | boolean;
/** ts optionnel : timestamp d'origine (epoch ms) pour les rejeux consent/retry. */
export type Emit = (name: string, attrs: Record<string, AttrValue>, ts?: number) => void;

// ══════════════════ Plafond et déduplication des erreurs ══════════════════════
//
// Finding 2.1 de docs/AUDIT_RUM_EXTERNE.md — bloquant, « à faire avant le
// premier client réel ».
//
// CE QUI ÉTAIT EN PLACE. Tous les collecteurs du SDK sont plafonnés par page —
// 20 ressources, 30 tâches longues, 50 fils d'Ariane, 100 appels API — via
// `makeCap`. `initErrors` était LE SEUL sans plafond : deux `addEventListener`
// qui émettaient un span par occurrence, sans compteur, sans déduplication,
// sans fenêtre de silence.
//
// LA BOUCLE D'AMPLIFICATION. Une erreur dans un `requestAnimationFrame`, un
// rendu React qui reboucle ou un `setInterval` produit des centaines
// d'exceptions par seconde. Chacune :
//
//   1. passe l'échantillonnage QUOI QU'IL ARRIVE — `sampler.passes` laisse
//      toujours passer « exception », et la première erreur PROMEUT la session
//      en collecte complète ;
//   2. remplit le tampon de 64 spans, qui déclenche un POST immédiat ;
//   3. si l'ingestion répond 429 — ce qui arrivera, la limite est de 600
//      requêtes/minute/app — le lot part en file de rejeu, pour être rejoué au
//      prochain chargement de page.
//
// Un seul client en boucle sature donc sa propre limite de débit, puis rejoue
// son retard à chaque navigation. Et comme l'écriture est synchrone sur un pool
// partagé par tous les locataires, la limite est par application mais la
// contention est globale.
//
// CE QU'ON FAIT. Un plafond par page comme partout ailleurs, PLUS une
// déduplication par empreinte avec fenêtre de silence : une même erreur répétée
// est COMPTÉE, pas transmise mille fois. Le compte part dans `mip.error_count`,
// et l'ingestion le somme — sans quoi le plafond client fausserait les
// compteurs, ce qui reviendrait à soigner le symptôme en cassant la mesure.

/** Erreurs distinctes transmises par page. Au-delà, on compte sans émettre. */
export const ERREURS_PAR_PAGE = 50;

/**
 * Erreurs distinctes transmises par page, VOIE PAR VOIE (P5.2).
 *
 * Chaque voie opt-in a son propre plafond, distinct de celui des exceptions :
 * une page qui inonde sa console, ou dont vingt vignettes échouent, ne doit
 * jamais faire taire une vraie exception. Le plafond historique reste celui des
 * exceptions non interceptées.
 */
export const PLAFONDS_PAR_VOIE: Readonly<Record<ErrorCategory, number>> = {
  uncaught: ERREURS_PAR_PAGE,
  console: 20,
  resources: 20,
  csp: 10,
  network: 20,
};

/** Silence entre deux transmissions d'une MÊME empreinte, en millisecondes. */
export const FENETRE_SILENCE_MS = 10_000;

/**
 * Empreinte locale d'une erreur : type + message + première ligne de pile.
 *
 * DÉLIBÉRÉMENT PLUS GROSSIÈRE que celle de l'ingestion (`errorFingerprint`).
 * Ici on ne cherche pas à regrouper pour l'affichage, mais à reconnaître « la
 * même erreur qui se répète à l'instant ». Une empreinte trop fine laisserait
 * passer la boucle qu'on veut arrêter — c'est précisément le cas d'une erreur
 * dont le message contient un compteur ou un horodatage.
 */
export function empreinteLocale(type: string, message: string, stack: string): string {
  const premiere = (stack.split("\n")[1] ?? "").trim().slice(0, 120);
  // Les nombres varient d'une occurrence à l'autre sans changer la nature du bug.
  const msg = message.replace(/\d+/g, "#").slice(0, 200);
  return `${type}|${msg}|${premiere.replace(/\d+/g, "#")}`;
}

export interface Etranglement {
  /**
   * Décide du sort d'une occurrence. Rend le nombre d'occurrences à annoncer
   * (≥ 1) si le span doit partir, ou `null` s'il faut se taire.
   */
  admettre(empreinte: string, maintenant: number): number | null;
  /**
   * Rend les répétitions tues depuis la dernière transmission, puis remet leur
   * compteur à zéro. Le plafond reste intact : vider avant pagehide ne donne
   * jamais de nouveaux slots à une page bruyante.
   */
  drainer(maintenant: number): Array<{ empreinte: string; occurrences: number }>;
  reset(): void;
}

/**
 * Compteur par empreinte avec fenêtre de silence.
 *
 * Une occurrence est transmise si son empreinte est nouvelle sur cette page, ou
 * si la dernière transmission remonte à plus de `fenetreMs`. Sinon elle est
 * accumulée, et le compte accumulé voyage avec la PROCHAINE transmission — donc
 * aucune occurrence n'est perdue pour le comptage, seulement pour le détail.
 *
 * LE PLAFOND PORTE SUR LES EMPREINTES DISTINCTES, pas sur les occurrences. Cent
 * répétitions d'un même bug consomment un slot ; cinquante bugs différents les
 * consomment tous. C'est la bonne unité : ce qu'on veut borner, c'est le nombre
 * de causes rapportées, pas la mesure de leur fréquence.
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
   * Chemin commun de toutes les voies : plafond de la voie, silence par
   * empreinte, drain, puis l'émission (sampling, causalité, beforeSend,
   * consentement). `ts` = horodatage d'origine quand l'erreur n'est constatée
   * qu'après coup, comme la réponse d'un appel réseau ; défaut : maintenant.
   */
  report(voie: ErrorCategory, attrs: Record<string, AttrValue>, ts?: number): void;
  /**
   * Vrai si la capture de cet objet doit être ignorée ; sinon il est mémorisé
   * jusqu'à la fin de la tâche courante.
   *
   * UN OBJET, UNE OPÉRATION, UN INCIDENT. `console.error(err)` suivi de
   * `throw err`, ou deux journalisations du même objet dans un même `catch`,
   * décrivent une seule erreur. La première capture gagne : la console ignore un
   * objet déjà vu par n'importe quelle voie, une exception non interceptée
   * ignore un objet déjà journalisé. `addError` marque son objet mais émet
   * toujours — un appel explicite n'est jamais ignoré en silence. Hors console,
   * rien ne change : une même exception relancée deux fois reste deux
   * occurrences, comme avant.
   *
   * La tâche se termine au prochain macrotask (`setTimeout` 0) : un microtask
   * ne suffirait pas, un rejet non géré est signalé après leur vidage.
   */
  dejaCapture(objet: unknown, voie: VoieObjet): boolean;
  drainer(maintenant: number): Array<{ empreinte: string; occurrences: number }>;
  reset(): void;
  /** Métriques de drops par voie, cumulées depuis init() (un reset ne les efface pas). */
  compteurs(): Record<ErrorCategory, CompteursVoie>;
}

/**
 * Branche la collecte d'erreurs. Rend le collecteur pour que la boucle de
 * pageview le remette à zéro, exactement comme les autres plafonds, et pour que
 * les voies opt-in (error-capture.ts, apispans.ts) le rejoignent.
 *
 * `emit` rend `false` quand l'émission refuse l'erreur : c'est ce qui alimente
 * le compteur `rejected`. Toute autre valeur vaut prise en charge.
 */
export function initErrors(
  emit: (name: string, attrs: Record<string, AttrValue>, ts?: number) => unknown,
  horloge: () => number = Date.now,
  action: (at: number) => Record<string, AttrValue> = () => ({}),
): ErrorCollector {
  type Detail = { attrs: Record<string, AttrValue>; ts: number };
  interface Voie {
    etr: Etranglement;
    // Les deux maps restent bornées par le plafond de la voie : on ne mémorise
    // une empreinte que si `admettre` lui a effectivement réservé un slot. En
    // particulier, une nouvelle empreinte refusée par le cap ne peut pas remplir
    // cette mémoire latérale avec du texte tiers.
    details: Map<string, Detail>;
    // Première occurrence tue après une émission : c'est son contexte, et non
    // celui de la destination (navigation SPA/pagehide), qui doit être conservé
    // quand le lot compacté est finalement envoyé.
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
      // `realEmit` apporte aussi la route courante par défaut. La poser ici
      // capture la route de l'erreur, avant toute navigation qui déclenche le
      // drain, et l'attribut explicite a priorité dans le merge.
      attrs: { ...action(ts), ...attrs, "mip.route": currentRoute() },
      ts,
    };
    const n = voie.etr.admettre(empreinte, ts);
    if (n == null) {
      // `null` couvre une répétition silencieuse ET une empreinte nouvelle
      // refusée par le cap. Seule la première possède déjà un slot/document :
      // elle peut avoir besoin d'un drain, la seconde ne doit pas être stockée —
      // elle est seulement comptée comme perdue.
      if (!voie.details.has(empreinte)) voie.compteurs.capped++;
      else if (!voie.pendingDetails.has(empreinte)) voie.pendingDetails.set(empreinte, detail);
      return;
    }
    const original = n > 1 ? (voie.pendingDetails.get(empreinte) ?? detail) : detail;
    voie.pendingDetails.delete(empreinte);
    voie.details.set(empreinte, detail);
    // `mip.error_count` n'est posé que lorsqu'il dépasse 1 : sur le cas courant
    // — une erreur isolée — l'attribut n'existe pas et le payload ne grossit pas.
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
          // Le prochain groupe silencieux doit capturer sa propre première
          // occurrence plutôt que de réutiliser le contexte de ce groupe-ci.
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
