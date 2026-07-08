// Signaux navigateur d'opt-out (souveraineté / RGPD — Lot 5) : Do Not Track
// (DNT, historique) et Global Privacy Control (GPC, standard actuel, à valeur
// légale sous CCPA/CPRA et reconnu comme signal de refus RGPD).
//
// Logique PURE et testée : décide, à partir d'un objet navigator/window-like,
// si l'utilisateur a signalé un refus de suivi. Câblée dans init() : si
// `honorDNT` (défaut) et qu'un signal est présent, on ne collecte RIEN (aucun
// listener, aucune requête réseau). Une app qui recueille elle-même un
// consentement affirmatif — susceptible de primer le signal — passe
// `honorDNT: false` et pilote la collecte via MIPRum.consent().

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
 * Lit les signaux depuis l'environnement réel du navigateur en fusionnant les
 * emplacements connus (navigator standard, window.doNotTrack ancien Firefox,
 * navigator.msDoNotTrack IE). Renvoie une source neutre hors navigateur.
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
