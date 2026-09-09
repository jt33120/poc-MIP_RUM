import { scrubUrl } from "./context";
import { makeCap, type PageCap } from "./caps";

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
    reset() {
      vues = new Map();
      cap.reset();
    },
  };
}

/**
 * Branche la collecte d'erreurs. Rend l'étranglement pour que la boucle de
 * pageview le remette à zéro, exactement comme les autres plafonds.
 */
export function initErrors(emit: Emit, horloge: () => number = Date.now): Etranglement {
  const etr = creerEtranglement();

  const transmettre = (
    empreinte: string,
    attrs: Record<string, AttrValue>,
  ) => {
    const n = etr.admettre(empreinte, horloge());
    if (n == null) return;
    // `mip.error_count` n'est posé que lorsqu'il dépasse 1 : sur le cas courant
    // — une erreur isolée — l'attribut n'existe pas et le payload ne grossit pas.
    emit("exception", n > 1 ? { ...attrs, "mip.error_count": n } : attrs);
  };

  addEventListener("error", (e: ErrorEvent) => {
    const type = e.error?.name ?? "Error";
    const message = String(e.message ?? "").slice(0, 1000);
    const stack = String(e.error?.stack ?? "").slice(0, 4000);
    transmettre(empreinteLocale(type, message, stack), {
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
    const reason = e.reason as Error | unknown;
    const isErr = reason instanceof Error;
    const type = isErr ? reason.name : "UnhandledRejection";
    const message = String(isErr ? reason.message : (reason ?? "")).slice(0, 1000);
    const stack = String(isErr ? (reason.stack ?? "") : "").slice(0, 4000);
    transmettre(empreinteLocale(type, message, stack), {
      "mip.error_kind": "unhandledrejection",
      "exception.message": message,
      "exception.type": type,
      "exception.stacktrace": stack,
    });
  });

  return etr;
}
