// Dimensions normalisées d'un signal RUM (P6.1). JS pur, sans dépendance :
// importé tel quel par le receveur Node, les routes de la console et le runtime
// Deno historique, à travers otlp.mjs.
//
// DEUX FRONTIÈRES, DEUX DURÉES DE VIE.
//
//   • Dimensions CLIENT — navigateur, système, classe d'appareil. Déduites de
//     l'user-agent que les SDK envoient déjà (`mip.user_agent`) : aucune collecte
//     nouvelle, aucune Client Hint haute entropie, aucune empreinte. Elles
//     décrivent un terminal, donc une SESSION.
//   • Dimensions DÉCLARÉES — environnement, service, release. Posées par
//     l'émetteur sur sa resource OTLP, elles peuvent changer au cours d'une même
//     session (mise en production pendant la visite) : elles sont recopiées sur
//     CHAQUE événement, jamais relues sur une session qu'un lot ultérieur modifie.
//
// RÈGLE COMMUNE : ce qui n'est pas reconnu reste NULL, affiché « Inconnu ». Une
// valeur devinée créerait une catégorie de filtre qu'aucun émetteur n'a déclarée.
// Aucune valeur n'est tronquée : coupée, elle deviendrait un autre identifiant.
import { isBot } from "./bots.mjs";
import { scrubText } from "./scrub.mjs";

/** Bornes des colonnes de dimension, reprises par les contraintes de migration-v75. */
export const DIMENSION_BOUNDS = Object.freeze({ family: 80, version: 120, declared: 120 });

/**
 * Contrôle, format et séparateurs Unicode. `[[:cntrl:]]` de PostgreSQL ne couvre
 * que C0/C1 avec une locale libc, mais aussi les caractères de format et les
 * séparateurs de ligne avec ICU : refuser la classe la plus large garantit qu'une
 * valeur écrite ici passe tous les contrôles `!~ '[[:cntrl:]]'` de la base
 * (release et env de migration-v74), quel que soit le fournisseur de locale.
 */
const CONTROLE_OU_FORMAT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Dimension courte déclarée par l'émetteur (env, service), ou null.
 *
 * Scrubbée comme tout texte venu du client. Trop longue, elle est REFUSÉE et non
 * tronquée. Un caractère de contrôle ou de format trahit une valeur qui n'est pas
 * un nom.
 */
export function boundedDimension(value, max = DIMENSION_BOUNDS.declared) {
  if (typeof value !== "string") return null;
  const clean = (scrubText(value) ?? "").trim();
  if (!clean || CONTROLE_OU_FORMAT.test(clean) || clean.length > max) return null;
  return clean;
}

/**
 * Release déclarée (`mip.release`, `service.version` d'un backend), ou null.
 *
 * Même borne que env et service — 1 à 120 caractères, espaces de bord retirés,
 * sans caractère de contrôle ni de format —, mais JAMAIS scrubbée. Une release est
 * un identifiant de build comparé À L'OCTET PRÈS aux source maps téléversées, aux
 * marqueurs de déploiement et aux régressions d'issue : le scrub réécrirait une
 * version à quatre nombres (`4.8.0.1`) en « [ip] » et un numéro de build CI
 * (`build-17654321098`) en « build-[number] », qui ne correspondraient plus à
 * rien. Au-delà de la borne, la release est inconnue : non bornée, elle faisait
 * échouer l'index (app_id, release) et, avec lui, tout le lot.
 */
export function boundedRelease(value) {
  if (typeof value !== "string") return null;
  const release = value.trim();
  if (!release || CONTROLE_OU_FORMAT.test(release) || release.length > DIMENSION_BOUNDS.declared) return null;
  return release;
}

// ─────────────────────────── Dimensions client ───────────────────────────────
//
// Parseur ciblé plutôt qu'une bibliothèque : ce module doit rester sans
// dépendance (runtime Deno historique), et ne classe que ce qu'il sait nommer.
// Taxonomie FERMÉE : chaque famille est une constante de ce fichier, jamais un
// jeton recopié de l'user-agent.
//
// VERSIONS MAJEURES SEULEMENT. C'est le chiffre qui porte une décision (« ce parc
// est-il au-dessus de Safari 16 ? ») et les navigateurs figent déjà le reste :
// Chrome réduit sa version à `139.0.0.0`.
//
// VERSIONS FIGÉES = INCONNUES. Plusieurs navigateurs déclarent désormais une
// version de système qui n'est plus la vraie, pour tout le monde :
//   Windows NT 10.0       Windows 10 ET Windows 11 ;
//   Mac OS X 10_15_7      tout macOS depuis Big Sur (Safari, Chrome, Firefox) ;
//   Android 10; K         tout Android dans l'user-agent réduit de Chrome ;
//   iPhone OS 18_6        tout iOS depuis iOS 26 (Safari 26 fige le système).
// Rendre ces valeurs ferait afficher une version fausse à la majorité : elles
// deviennent NULL. Safari sur iOS garde une vérité — sa propre version suit celle
// du système —, reprise quand le système déclaré est 18.6 : elle départage un
// vrai iOS 18.6 d'un iOS 26 figé.
//
// LIMITE ASSUMÉE : un iPad sous iPadOS 13+ se présente en Macintosh et reste
// compté « desktop » ; le distinguer exigerait une détection tactile côté SDK.

/** Au-delà, ce n'est pas un user-agent : aucun navigateur n'en émet de si long. */
const UA_MAX = 1024;

/** Première règle qui correspond : les Chromium maquillés avant Chrome. */
const NAVIGATEURS = [
  ["Edge", /\b(?:Edg|EdgA|EdgiOS|Edge)\/(\d{1,5})/],
  ["Opera", /\b(?:OPR|OPT|OPiOS)\/(\d{1,5})/],
  ["Samsung Internet", /\bSamsungBrowser\/(\d{1,5})/],
  ["Yandex Browser", /\bYaBrowser\/(\d{1,5})/],
  ["UC Browser", /\bUCBrowser\/(\d{1,5})/],
  ["Vivaldi", /\bVivaldi\/(\d{1,5})/],
  ["Silk", /\bSilk\/(\d{1,5})/],
  ["Firefox", /\b(?:Firefox|FxiOS)\/(\d{1,5})/],
  // WebView Android : le système ajoute « ; wv) » au jeton de plateforme.
  ["Android WebView", /; wv\).*?\bChrome\/(\d{1,5})/],
  ["Chrome", /\b(?:Chrome|CriOS)\/(\d{1,5})/],
  ["Internet Explorer", /\bMSIE (\d{1,5})|\bTrident\/.*?\brv:(\d{1,5})/],
];

const APPLE_MOBILE = /\b(?:iPhone|iPad|iPod)\b/;
/** Safari se reconnaît à `Version/…` suivi de `Safari/`, sur une plateforme Apple. */
const SAFARI = /\bVersion\/(\d{1,5})(?:\.\d+)*.*?\bSafari\//;
/** WebView iOS (WKWebView, navigateurs intégrés) : WebKit mobile Apple sans `Version/`. */
const WEBVIEW_IOS = /\bAppleWebKit\/[\d.]+.*?\bMobile\/\w+/;
/** User-agent synthétique du SDK React Native MIP : `MIP-RN/0.1 (ios 17.4)`. */
const REACT_NATIVE_MIP = /^MIP-RN\/[\w.-]{1,20} \(([A-Za-z]{1,20})(?: (\d{1,5})(?:\.\d+)*)?\)$/;
/** Téléviseurs et boîtiers (Android TV, Fire TV, Chromecast…) : aucune des trois classes. */
const TELEVISION = /\b(?:SmartTV|SMART-TV|Smart-TV|Smart TV|GoogleTV|Android TV|AppleTV|BRAVIA|CrKey|Tizen|Web0S|WebOS|AFT[A-Z0-9]{1,6})\b/;
const WINDOWS_NT = new Map([["6.3", "8.1"], ["6.2", "8"], ["6.1", "7"], ["6.0", "Vista"], ["5.2", "XP"], ["5.1", "XP"]]);
/** Indice `mip.device_type` d'un SDK : classe connue, ou plateforme mobile du SDK React Native. */
const CLASSES_APPAREIL = new Set(["desktop", "mobile", "tablet"]);
const PLATEFORMES_MOBILES = new Map([["ios", "iOS"], ["android", "Android"]]);

const AUCUNE = Object.freeze({ browser: null, browser_version: null, os: null, os_version: null, device_type: null });

function navigateur(ua, os) {
  for (const [famille, motif] of NAVIGATEURS) {
    const m = motif.exec(ua);
    if (m) return { browser: famille, browser_version: m[1] ?? m[2] };
  }
  const safari = SAFARI.exec(ua);
  if (safari && (os === "iOS" || os === "macOS")) return { browser: "Safari", browser_version: safari[1] };
  if (os === "iOS" && WEBVIEW_IOS.test(ua) && !/\bVersion\//.test(ua)) return { browser: "iOS WebView", browser_version: null };
  return { browser: null, browser_version: null };
}

function systeme(ua) {
  if (APPLE_MOBILE.test(ua)) {
    const m = /\bOS (\d{1,5})[_.](\d{1,5})/.exec(ua);
    if (!m) return { os: "iOS", os_version: null };
    if (m[1] !== "18" || m[2] !== "6") return { os: "iOS", os_version: m[1] };
    return { os: "iOS", os_version: SAFARI.exec(ua)?.[1] ?? null };
  }
  if (/\bAndroid\b/.test(ua)) {
    const m = /\bAndroid (\d{1,5})/.exec(ua);
    return { os: "Android", os_version: m && !/\bAndroid 10; K\)/.test(ua) ? m[1] : null };
  }
  if (/\bWindows\b/.test(ua)) {
    const m = /\bWindows NT (\d{1,2}\.\d)/.exec(ua);
    return { os: "Windows", os_version: m ? (WINDOWS_NT.get(m[1]) ?? null) : null };
  }
  if (/\bCrOS\b/.test(ua)) return { os: "ChromeOS", os_version: null };
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) {
    const m = /\bMac OS X (\d{1,2})[_.](\d{1,2})/.exec(ua);
    const figee = !m || (m[1] === "10" && m[2] === "15");
    return { os: "macOS", os_version: figee ? null : m[1] === "10" ? `10.${m[2]}` : m[1] };
  }
  if (/\b(?:Linux|X11)\b/.test(ua)) return { os: "Linux", os_version: null };
  return { os: null, os_version: null };
}

function classeAppareil(ua, os) {
  if (TELEVISION.test(ua)) return null;
  if (/\biPad\b|\bKindle\b|\bSilk\//.test(ua)) return "tablet";
  if (/\b(?:iPhone|iPod)\b/.test(ua)) return "mobile";
  // Android sans « Mobile » : c'est la convention des tablettes (Chrome, Samsung
  // Internet), et Firefox l'écrit en toutes lettres (« Android 14; Tablet »).
  if (os === "Android") return /\bMobile\b/.test(ua) ? "mobile" : "tablet";
  if (os === "Windows" || os === "macOS" || os === "ChromeOS" || os === "Linux") return "desktop";
  return /\bMobi(?:le)?\b/.test(ua) ? "mobile" : null;
}

function parserUserAgent(ua) {
  const rn = REACT_NATIVE_MIP.exec(ua);
  if (rn) {
    const os = PLATEFORMES_MOBILES.get(rn[1].toLowerCase()) ?? null;
    return { browser: null, browser_version: null, os, os_version: os ? (rn[2] ?? null) : null, device_type: "mobile" };
  }
  const { os, os_version } = systeme(ua);
  return { ...navigateur(ua, os), os, os_version, device_type: classeAppareil(ua, os) };
}

/**
 * Navigateur, système et classe d'appareil d'une session, chacun ou null.
 *
 * L'user-agent est lu UNE fois (il est commun à la resource) ; la fonction rendue
 * y joint l'indice `mip.device_type`, propre à chaque span.
 *
 * L'user-agent PRIME sur cet indice : le SDK web le déduit du même user-agent
 * avec une règle plus grossière, qui range les tablettes Android en « desktop »
 * et les iPad en « mobile ». L'indice ne sert que quand l'user-agent ne dit
 * rien — et « ios »/« android » du SDK React Native y deviennent « mobile », la
 * plateforme restant portée par `os`. Toute autre valeur d'indice est ignorée.
 *
 * Un ROBOT n'a ni navigateur, ni système, ni classe d'appareil : `is_bot` le dit
 * déjà, et lui prêter « Chrome / Linux / desktop » gonflerait ces valeurs dès que
 * les robots sont inclus dans une analyse. L'indice est alors ignoré aussi.
 * Aucun user-agent n'est exigé : une session sans lui ni indice reste inconnue.
 *
 * @param {unknown} userAgent `mip.user_agent` de la resource.
 * @returns {(deviceHint?: unknown) => { browser: string|null, browser_version: string|null,
 *   os: string|null, os_version: string|null, device_type: "desktop"|"mobile"|"tablet"|null }}
 */
export function clientDimensions(userAgent) {
  const ua = typeof userAgent === "string" && userAgent.length <= UA_MAX ? userAgent.trim() : "";
  if (ua && isBot(ua)) return () => AUCUNE;
  const lu = ua ? parserUserAgent(ua) : AUCUNE;
  return (deviceHint) => {
    const indice = typeof deviceHint === "string" ? deviceHint.trim().toLowerCase() : "";
    const plateforme = PLATEFORMES_MOBILES.get(indice) ?? null;
    return {
      browser: lu.browser,
      browser_version: lu.browser_version,
      os: lu.os ?? plateforme,
      os_version: lu.os_version,
      device_type: lu.device_type ?? (CLASSES_APPAREIL.has(indice) ? indice : plateforme ? "mobile" : null),
    };
  };
}
