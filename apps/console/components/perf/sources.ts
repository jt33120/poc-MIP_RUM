// D'où viennent les mesures des écrans de performance (recette du 30/09/2026) : chaque
// case le dit dans sa fenêtre (`source`) et, en une étiquette courte, en pied de case
// (`categorie`). Les MÊMES mots que la Vue d'ensemble (`app/page.tsx`), pour qu'une
// mesure lue sur deux écrans cite la même source.
import type { VitalName } from "@/lib/fmt-ids";

export const SEUILS_WEB_DEV = "Seuils : web.dev (Google), lus au 75ᵉ centile.";

export const SOURCE_VITAL: Record<VitalName, string> = {
  LCP: `Navigateur, bibliothèque web-vitals 5.3 (Largest Contentful Paint, W3C). ${SEUILS_WEB_DEV}`,
  INP: `Navigateur, bibliothèque web-vitals 5.3 (Event Timing, W3C). ${SEUILS_WEB_DEV}`,
  CLS: `Navigateur, bibliothèque web-vitals 5.3 (Layout Instability, W3C). ${SEUILS_WEB_DEV}`,
  FCP: `Navigateur, bibliothèque web-vitals 5.3 (Paint Timing, W3C). ${SEUILS_WEB_DEV}`,
  TTFB: `Navigateur, bibliothèque web-vitals 5.3 (Navigation Timing, W3C) : réseau et temps de réponse du serveur. ${SEUILS_WEB_DEV}`,
};

export const CATEGORIE_VITAL: Record<VitalName, string> = {
  LCP: "Navigateur · Core Web Vitals",
  INP: "Navigateur · Core Web Vitals",
  CLS: "Navigateur · Core Web Vitals",
  FCP: "Navigateur · rendu",
  TTFB: "Réseau et serveur",
};

export const SOURCE_TRAFIC =
  "SDK MIP RUM dans la page : une session par visite, une page vue par chargement ou changement de route.";

export const SOURCE_ERREURS =
  "SDK MIP RUM : événements error et unhandledrejection, échecs réseau et violations CSP ; occurrences regroupées par empreinte (type, message, ligne de code).";

export const SOURCE_FRUSTRATION =
  "SDK MIP RUM et extension navigateur : signaux frustration.rage, frustration.dead et frustration.error, selon les règles de détection du capteur. Le SDK mobile n'en émet pas.";

export const SOURCE_ACTIONS =
  "SDK MIP RUM : actions (clics et actions manuelles) ; erreurs, ressources et appels API rattachés au geste qui les précède.";

export const SOURCE_AVIS =
  "Module d'avis MIP RUM (mip-rum-feedback.js), événement feedback : une note de 1 à 5 et un commentaire facultatif.";

export const SOURCE_MOBILE =
  "SDK React Native MIP RUM (couche JavaScript) : sessions React Native commencées sur la plage.";
