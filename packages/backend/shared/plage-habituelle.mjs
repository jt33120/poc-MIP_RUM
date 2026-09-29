// LA PLAGE HABITUELLE D'UNE P75 HORAIRE (A2 § 7.1) — logique PURE, sans base.
//
// Partagée par le travail `detections_horaires` du scheduler, qui en tire les
// constats (`signal_detecte`), et par la console, qui dessine la même bande
// autour de la série (`apps/console/lib/chargeurs/vital-horaire.ts`) : une seule
// définition de « habituel », deux lecteurs.
//
// POURQUOI MÉDIANE ET MAD, et pas moyenne et écart-type (ce que fait `v_anomaly`) :
// une seule heure aberrante emporte une moyenne et gonfle un écart-type ; la
// médiane et l'écart absolu médian l'ignorent. Et POURQUOI LE MÊME CRÉNEAU : comparer
// 15:00 à la moyenne de la nuit fabrique une anomalie chaque après-midi.
//
// L'échelle est logarithmique (une p75 de durée est positive et asymétrique) :
// un écart y est relatif, donc symétrique. Le CLS, souvent nul, est décalé de 0,01.
//
// VOCABULAIRE (A2 § 7.0) : « plage habituelle », « écarts robustes », « détecté
// par calcul », « associé à », « depuis ». Jamais un mot de cause, jamais une
// intention prêtée au calcul : `tests/unit/detections-horaires.test.ts` l'impose
// sur chaque phrase produite ici.

/** Facteur de cohérence du MAD avec l'écart-type d'une loi normale. */
export const K_MAD = 1.4826;
/** Plancher de dispersion : une série très stable ne produit pas une plage de largeur nulle. */
export const SIGMA_MIN = Math.log(1.05);
/** Quantile normal à 97,5 %, celui de l'intervalle de la p75 (`lib/stats/incertitude.ts`). */
export const Z95 = 1.96;
/** Largeur de la plage affichée, en écarts robustes. */
export const Z_PLAGE = 3;
/** Un épisode s'ouvre au-delà de ce z… */
export const Z_OUVERTURE = 3;
/** …et se ferme après deux heures consécutives à ce z ou moins (hystérésis). */
export const Z_FERMETURE = 2;
/** Mesures minimales d'une heure évaluée (le minimum d'un intervalle de p75). */
export const MESURES_MIN_HEURE = 13;
/** Au-delà de ce délai sans ingestion, la détection de l'heure est suspendue (A2 § 7.0). */
export const FRAICHEUR_MAX_MS = 15 * 60_000;
/** Budget de bruit : au plus un nouveau constat par entité et par 6 h (A2 § 7.6). */
export const BUDGET_BRUIT_MS = 6 * 3_600_000;
/** Le fuseau des créneaux (celui de l'affichage, `apps/console/lib/fuseau-local.ts`). */
export const FUSEAU_CRENEAUX = "Europe/Paris";

const HEURE_MS = 3_600_000;
const JOUR_MS = 24 * HEURE_MS;

/**
 * LES NIVEAUX DE REPLI, du plus fin au plus grossier. Le premier dont la
 * référence atteint son minimum est retenu, et sa légende est écrite.
 * Simplification assumée : A2 § 7.1 choisit entre hebdomadaire et quotidien par la
 * médiane des |z| sur 7 jours ; ici, l'hebdomadaire l'emporte dès qu'il a ses
 * 9 valeurs (trois semaines d'historique).
 */
export const NIVEAUX = Object.freeze([
  Object.freeze({ nom: "hebdomadaire", minimum: 9, legende: "même heure, même jour, 3 à 6 dernières semaines" }),
  Object.freeze({ nom: "quotidien", minimum: 15, legende: "même heure, 7 à 14 derniers jours" }),
  Object.freeze({ nom: "48h", minimum: 24, legende: "48 dernières heures, sans saisonnalité" }),
]);

/** Médiane d'une liste de nombres (NaN si vide). */
export function mediane(valeurs) {
  if (valeurs.length === 0) return NaN;
  const t = [...valeurs].sort((a, b) => a - b);
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

/** Écart absolu médian, mis à l'échelle d'un écart-type (× 1,4826). */
export function madEchelle(valeurs, centre = mediane(valeurs)) {
  return K_MAD * mediane(valeurs.map((v) => Math.abs(v - centre)));
}

/** L'échelle de calcul d'une p75 : ln(p75), ln(p75 + 0,01) pour le CLS. */
export function transformer(nom, valeur) {
  if (valeur == null || !Number.isFinite(valeur) || valeur < 0) return null;
  const v = nom === "CLS" ? valeur + 0.01 : valeur;
  return v > 0 ? Math.log(v) : null;
}

/** Retour à l'échelle d'origine. */
export function detransformer(nom, y) {
  const v = Math.exp(y);
  return nom === "CLS" ? Math.max(0, v - 0.01) : v;
}

/**
 * Bruit d'échantillonnage de la p75 d'une heure, depuis son intervalle à 95 % :
 * σₑ = (ln U − ln L) / (2 × 1,96). Une heure creuse a une plage plus large.
 * 0 sans intervalle (il n'y en a pas sous 13 mesures, et l'heure n'est alors pas évaluée).
 */
export function sigmaEchantillon(nom, bas, haut) {
  const l = transformer(nom, bas);
  const u = transformer(nom, haut);
  if (l == null || u == null || u < l) return 0;
  return (u - l) / (2 * Z95);
}

/**
 * Centre et dispersion robustes d'une référence (échelle transformée).
 * @param {number[]} reference
 * @returns {{ m: number, sigma: number } | null}
 */
export function centreEtDispersion(reference) {
  if (reference.length === 0) return null;
  const m = mediane(reference);
  return { m, sigma: Math.max(madEchelle(reference, m), SIGMA_MIN) };
}

/**
 * Plage habituelle d'une heure et son écart robuste.
 * @param {{ nom: string, p75: number, p75Bas?: number|null, p75Haut?: number|null }} heure
 * @param {number[]} reference  valeurs transformées de la référence
 */
export function evaluerHeure(heure, reference) {
  const cd = centreEtDispersion(reference);
  const y = transformer(heure.nom, heure.p75);
  if (!cd || y == null) return null;
  const sigmaE = sigmaEchantillon(heure.nom, heure.p75Bas, heure.p75Haut);
  const sigmaTot = Math.sqrt(cd.sigma ** 2 + sigmaE ** 2);
  return {
    y,
    m: cd.m,
    sigma: cd.sigma,
    sigmaTot,
    z: (y - cd.m) / sigmaTot,
    mediane: detransformer(heure.nom, cd.m),
    bas: detransformer(heure.nom, cd.m - Z_PLAGE * sigmaTot),
    haut: detransformer(heure.nom, cd.m + Z_PLAGE * sigmaTot),
    ecartRelatif: Math.exp(y - cd.m) - 1,
  };
}

/** Décalage du fuseau à un instant, en minutes (Europe/Paris : 60 ou 120). */
export function decalageMin(ms, fuseau = FUSEAU_CRENEAUX) {
  const nom = new Intl.DateTimeFormat("en-US", { timeZone: fuseau, timeZoneName: "longOffset" })
    .formatToParts(new Date(ms))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nom ?? "");
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * Le même instant d'horloge LOCALE, `jours` jours plus tôt : à travers un
 * changement d'heure, 168 h en UTC ne tombent pas sur la même heure locale.
 */
export function memeHeureLocale(ms, jours, fuseau = FUSEAU_CRENEAUX) {
  const brut = ms - jours * JOUR_MS;
  return brut + (decalageMin(ms, fuseau) - decalageMin(brut, fuseau)) * 60_000;
}

/**
 * Les instants de référence d'une heure, par niveau (A2 § 7.1) :
 *   hebdomadaire  même créneau, k = 1…6 semaines, ± 1 h ;
 *   quotidien     même heure, k = 1…14 jours, ± 1 h ;
 *   48h           les 48 heures précédentes.
 * @returns {Record<string, number[]>} instants en ms, par nom de niveau
 */
export function instantsReference(heureMs, fuseau = FUSEAU_CRENEAUX) {
  const autour = (centre) => [centre - HEURE_MS, centre, centre + HEURE_MS];
  const hebdomadaire = [];
  for (let k = 1; k <= 6; k++) hebdomadaire.push(...autour(memeHeureLocale(heureMs, 7 * k, fuseau)));
  const quotidien = [];
  for (let k = 1; k <= 14; k++) quotidien.push(...autour(memeHeureLocale(heureMs, k, fuseau)));
  const h48 = [];
  for (let k = 1; k <= 48; k++) h48.push(heureMs - k * HEURE_MS);
  return { hebdomadaire, quotidien, "48h": h48 };
}

/**
 * La référence retenue : le premier niveau dont les heures utilisables (n ≥ 13,
 * hors épisodes passés) atteignent le minimum. `null` : historique insuffisant,
 * aucune plage — jamais une plage « approximative ».
 * @param {number} heureMs
 * @param {(ms: number) => number | null} valeurA  valeur transformée utilisable à l'instant, ou null
 */
export function choisirReference(heureMs, valeurA, fuseau = FUSEAU_CRENEAUX) {
  const instants = instantsReference(heureMs, fuseau);
  for (const niveau of NIVEAUX) {
    const valeurs = instants[niveau.nom].map(valeurA).filter((v) => v != null);
    if (valeurs.length >= niveau.minimum) return { niveau: niveau.nom, legende: niveau.legende, valeurs };
  }
  return null;
}

/**
 * LES ÉPISODES D'UNE FENÊTRE d'heures consécutives (z dans l'ordre chronologique,
 * `null` pour une heure non évaluée). Règle de A2 § 7.1 :
 *   · ouverture : z > 3 deux heures de suite, ou trois heures sur quatre ;
 *   · fermeture : deux heures consécutives à z ≤ 2 (hystérésis : pas de clignotement).
 * Seul le sens défavorable compte (une p75 plus haute est pire pour les cinq
 * vitals) ; une heure non évaluée n'ouvre ni ne ferme rien.
 *
 * @param {(number|null)[]} zs
 * @param {boolean} ouvert  un épisode était-il ouvert avant la fenêtre ?
 * @returns {{ ouvert: boolean, debut: number|null, fin: number|null }}
 *   `debut` / `fin` : indices dans la fenêtre (fin = première heure calme).
 */
export function suivreEpisode(zs, ouvert = false) {
  let etat = ouvert;
  let debut = null;
  let fin = null;
  let calmes = 0;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (etat) {
      if (z != null && z <= Z_FERMETURE) {
        calmes++;
        if (calmes === 2) {
          etat = false;
          fin = i - 1;
        }
      } else if (z != null) {
        calmes = 0;
      }
      continue;
    }
    const haut = (j) => zs[j] != null && zs[j] > Z_OUVERTURE;
    const deuxDeSuite = i >= 1 && haut(i) && haut(i - 1);
    const fenetre4 = i >= 3 ? [i - 3, i - 2, i - 1, i].filter(haut) : [];
    if (deuxDeSuite || fenetre4.length >= 3) {
      etat = true;
      calmes = 0;
      fin = null;
      // Le début : la première heure au-dessus du seuil de la série qui déclenche.
      let d = deuxDeSuite ? i - 1 : fenetre4[0];
      while (d > 0 && haut(d - 1)) d--;
      debut = d;
    }
  }
  return { ouvert: etat, debut, fin };
}

/**
 * GARDE DE FRAÎCHEUR (A2 § 7.0) : une panne de collecte ne doit jamais apparaître
 * comme une amélioration du LCP. Sans ingestion depuis plus de 15 min, la
 * détection est suspendue : aucun constat ouvert, fermé ni mis à jour.
 * @param {number} maintenantMs
 * @param {number|null} derniereIngestionMs
 */
export function gardeFraicheur(maintenantMs, derniereIngestionMs, maxMs = FRAICHEUR_MAX_MS) {
  if (derniereIngestionMs == null) return { suspendue: true, raison: "aucune ingestion récente" };
  const retard = maintenantMs - derniereIngestionMs;
  if (retard > maxMs) {
    return { suspendue: true, raison: `dernière ingestion il y a ${Math.round(retard / 60_000)} min` };
  }
  return { suspendue: false, raison: null };
}

/**
 * Priorité d'un constat (A2 § 7.6) : impact × ampleur × confiance, dans [0 ; 1].
 * impact = part des mesures de l'heure (une route pèse ce qu'elle pèse) ;
 * ampleur = min(1, |écart relatif| / 0,5) ; confiance = min(1, |z| / 6).
 */
export function priorite({ part, ecartRelatif, z }) {
  const borne = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
  return borne(part) * borne(Math.abs(ecartRelatif) / 0.5) * borne(Math.abs(z) / 6);
}

/** Une valeur de vital lisible : « 3,1 s », « 180 ms », « 0,12 ». */
export function formaterVital(nom, v) {
  const fr = (x, d) => x.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (nom === "CLS") return fr(v, 2);
  return v >= 1000 ? `${fr(v / 1000, 1)} s` : `${Math.round(v)} ms`;
}

/** Heure locale « 14:00 » et jour de semaine d'un instant, dans le fuseau des créneaux. */
function heureLocale(ms, fuseau) {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, hour: "2-digit", minute: "2-digit", weekday: "long", hour12: false })
    .formatToParts(new Date(ms));
  const val = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return { hhmm: `${val("hour")}:${val("minute")}`, jour: val("weekday").toLowerCase() };
}

/**
 * LA PHRASE D'UN ÉPISODE, rédigée par règles (pas de modèle de langage) :
 * un fait chiffré, son effectif, la référence et son niveau.
 * « LCP p75 de /checkout à 3,1 s depuis 14:00, contre 2,2 s habituellement le lundi
 * à cette heure (3,4 écarts robustes, 312 mesures). Détecté par calcul ; plage
 * habituelle : même heure, même jour, 3 à 6 dernières semaines. »
 */
export function phraseEpisode({ nom, route, valeur, mediane: habituel, z, n, debutMs, niveau, legende, fuseau = FUSEAU_CRENEAUX }) {
  const { hhmm, jour } = heureLocale(debutMs, fuseau);
  const ou = route ? ` de ${route}` : "";
  const quand =
    niveau === "hebdomadaire" ? ` le ${jour} à cette heure` : niveau === "quotidien" ? " à cette heure" : " sur les 48 dernières heures";
  const ecarts = z.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    `${nom} p75${ou} à ${formaterVital(nom, valeur)} depuis ${hhmm}, contre ${formaterVital(nom, habituel)} habituellement${quand} ` +
    `(${ecarts} écarts robustes, ${n} mesures). Détecté par calcul ; plage habituelle : ${legende}.`
  );
}

/** L'entité d'une série : « vital:LCP » (toutes routes) ou « vital:LCP|route:/checkout ». */
export function entiteSerie(nom, route) {
  return route ? `vital:${nom}|route:${route}` : `vital:${nom}`;
}
