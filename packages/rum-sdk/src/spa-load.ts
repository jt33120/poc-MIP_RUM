// Durée d'un changement d'écran SPA, méthode « loading time » de Datadog : du
// pushState/popstate à la dernière activité (mutation du DOM, requête fetch/XHR)
// suivie de 100 ms de calme. Le pageview SPA est instantané : sans cette mesure,
// un écran qui met 4 s à se remplir passe pour immédiat.
import type { Emit } from "./errors";

/** Calme qui clôt la mesure : ni mutation ni requête pendant ce temps. */
export const SPA_CALME_MS = 100;
/** Au-delà, l'écran ne s'est jamais posé (sondage, animation) : rien n'est émis. */
export const SPA_PLAFOND_MS = 10_000;

export interface SpaLoad {
  /** Mesure la vue SPA qui commence ; `null` (autre navigation) abandonne la mesure en cours. */
  nouvelleVue(vue: { route: string; id: string; debut: number } | null): void;
}

interface Mesure {
  route: string;
  id: string;
  debut: number;
  derniere: number;
  enCours: number;
}

type XhrSuivi = XMLHttpRequest & { __mipSpaUrl?: string };

export function initSpaLoad(
  emit: Emit,
  opts: { denyOrigins: readonly string[]; maintenant?: () => number },
): SpaLoad | null {
  if (typeof MutationObserver !== "function" || typeof document === "undefined") return null;
  const maintenant = opts.maintenant ?? (() => performance.now());
  let mesure: Mesure | null = null;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  let plafond: ReturnType<typeof setTimeout> | undefined;

  const arreter = () => {
    mesure = null;
    clearTimeout(minuteur);
    clearTimeout(plafond);
    observateur.disconnect();
  };

  const verifier = () => {
    const m = mesure;
    // Une requête en cours réarmera à sa fin.
    if (!m || m.enCours > 0) return;
    const calme = maintenant() - m.derniere;
    if (calme < SPA_CALME_MS) return armer(SPA_CALME_MS - calme);
    arreter();
    const duree = m.derniere - m.debut;
    if (duree > SPA_PLAFOND_MS) return;
    emit("webvital.SPA_LOAD", {
      "webvital.name": "SPA_LOAD",
      "webvital.value": Math.round(duree),
      "webvital.id": m.id,
      "mip.route": m.route,
    });
  };

  const armer = (delai: number = SPA_CALME_MS) => {
    clearTimeout(minuteur);
    minuteur = setTimeout(verifier, delai);
  };

  const activite = () => {
    if (!mesure) return;
    mesure.derniere = maintenant();
    armer();
  };

  const observateur = new MutationObserver(activite);

  /** Ouvre le suivi d'une requête partie pendant la mesure ; rend sa fin, ou null. */
  const suivre = (url: unknown): (() => void) | null => {
    const m = mesure;
    if (!m) return null;
    try {
      // Les exports MIP partent en continu : ils ne disent rien de l'écran.
      if (opts.denyOrigins.includes(new URL(String(url), location.href).origin)) return null;
    } catch {
      return null;
    }
    m.enCours++;
    activite();
    let fini = false;
    return () => {
      if (fini) return;
      fini = true;
      if (mesure !== m) return;
      m.enCours--;
      activite();
    };
  };

  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    const orig = window.fetch;
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const fin = mesure
        ? suivre(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request)?.url)
        : null;
      let reponse: Promise<Response>;
      try {
        reponse = orig.call(this, input as RequestInfo, init);
      } catch (e) {
        fin?.();
        throw e;
      }
      // Promesse dérivée, rejet absorbé : l'app garde la sienne, intacte.
      if (fin) reponse.then(fin, fin);
      return reponse;
    } as typeof fetch;
  }

  if (typeof XMLHttpRequest === "function") {
    const proto = XMLHttpRequest.prototype;
    const open = proto.open;
    const send = proto.send;
    proto.open = function (this: XhrSuivi, ...args: unknown[]) {
      this.__mipSpaUrl = String(args[1]);
      return (open as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.open;
    proto.send = function (this: XhrSuivi, body?: Document | XMLHttpRequestBodyInit | null) {
      const fin = mesure ? suivre(this.__mipSpaUrl) : null;
      if (fin) this.addEventListener("loadend", fin, { once: true });
      try {
        return send.call(this, body);
      } catch (e) {
        fin?.();
        throw e;
      }
    };
  }

  // Un clic ou une touche pendant le chargement : l'utilisateur agit déjà, la fin
  // mesurée ne serait plus celle de l'écran. En capture, avant le gestionnaire de
  // l'app ; l'horodatage écarte le clic qui a déclenché la navigation.
  const interaction = (event: Event) => {
    if (mesure && (typeof event.timeStamp === "number" ? event.timeStamp : maintenant()) >= mesure.debut) arreter();
  };
  if (typeof addEventListener === "function") {
    addEventListener("click", interaction, { capture: true });
    addEventListener("keydown", interaction, { capture: true });
  }

  return {
    nouvelleVue(vue) {
      if (mesure) arreter();
      if (!vue) return;
      mesure = { ...vue, derniere: vue.debut, enCours: 0 };
      try {
        observateur.observe(document.documentElement ?? document, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
      } catch {
        mesure = null;
        return;
      }
      armer();
      plafond = setTimeout(() => {
        const m = mesure;
        if (m && m.enCours === 0 && maintenant() - m.derniere >= SPA_CALME_MS) verifier();
        else arreter();
      }, SPA_PLAFOND_MS + SPA_CALME_MS);
    },
  };
}
