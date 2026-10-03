// Signaux d'opt-out du navigateur : Do Not Track (historique) et Global Privacy
// Control (valeur légale sous CCPA/CPRA, reconnu comme refus RGPD). Avec
// `honorDNT` (défaut), un signal coupe toute collecte ; une app qui recueille son
// propre consentement passe `honorDNT: false` et pilote `MIPRum.consent()`.

/** Sous-ensemble de Navigator/Window qu'on lit — testable avec un mock. */
export interface PrivacySignalSource {
  /** navigator.doNotTrack | window.doNotTrack : "1" | "0" | "yes" | "unspecified" | null */
  doNotTrack?: string | null;
  /** navigator.msDoNotTrack (IE / anciens Edge) : "1" | "0" */
  msDoNotTrack?: string | null;
  /** navigator.globalPrivacyControl (GPC) : true = opt-out */
  globalPrivacyControl?: boolean;
}

/** DNT actif ? "1" (standard) ou "yes" (anciens Firefox/Safari via window.doNotTrack). */
export function dntEnabled(src: PrivacySignalSource): boolean {
  const v = src.doNotTrack ?? src.msDoNotTrack;
  return v === "1" || v === "yes";
}

/** GPC actif ? navigator.globalPrivacyControl === true. */
export function gpcEnabled(src: PrivacySignalSource): boolean {
  return src.globalPrivacyControl === true;
}

/** Refus de suivi signalé par le navigateur (DNT OU GPC). */
export function signalsOptOut(src: PrivacySignalSource): boolean {
  return dntEnabled(src) || gpcEnabled(src);
}

/**
 * Lit les signaux à leurs emplacements connus (navigator, window.doNotTrack de
 * l'ancien Firefox, msDoNotTrack d'IE) ; source neutre hors navigateur.
 */
export function readPrivacySignals(
  nav: Navigator | undefined,
  win: Window | undefined,
): PrivacySignalSource {
  if (!nav) return {};
  const n = nav as Navigator & {
    msDoNotTrack?: string | null;
    globalPrivacyControl?: boolean;
  };
  const w = win as (Window & { doNotTrack?: string | null }) | undefined;
  return {
    doNotTrack: n.doNotTrack ?? w?.doNotTrack ?? null,
    msDoNotTrack: n.msDoNotTrack ?? null,
    globalPrivacyControl: n.globalPrivacyControl,
  };
}
