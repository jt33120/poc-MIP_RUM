// Acquisition — logique PURE et testée (Lot 8a, « channel grouping » à la Matomo).
// À partir du referrer et de l'URL d'entrée d'une session, classe la source en
// CANAL : direct (pas de referrer), interne (même hôte), recherche (moteur),
// social (réseau), sinon referral. Les UTM ne sont PAS disponibles (scrubUrl
// retire la query côté SDK) — la détection de campagne serait un ajout SDK.

export type Channel = "direct" | "internal" | "search" | "social" | "referral";

export const CHANNELS: Channel[] = ["direct", "search", "social", "referral", "internal"];

// Fragments d'hôte reconnus (comparaison par inclusion, hôte sans www).
const SEARCH = ["google.", "bing.", "yahoo.", "duckduckgo.", "qwant.", "ecosia.", "yandex.", "baidu.", "startpage."];
const SOCIAL = [
  "facebook.", "fb.", "instagram.", "twitter.", "x.com", "t.co", "linkedin.", "lnkd.in",
  "youtube.", "youtu.be", "reddit.", "pinterest.", "tiktok.", "mastodon.",
];

/** Hôte normalisé (minuscule, sans www), ou null si illisible/vide. */
export function hostOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const matches = (host: string, needles: string[]) => needles.some((n) => host.includes(n));

/** Classe la source d'entrée d'une session en canal d'acquisition. */
export function classifyChannel(referrer: string | null | undefined, url: string | null | undefined): Channel {
  const ref = hostOf(referrer);
  if (!ref) return "direct";
  const self = hostOf(url);
  if (self && ref === self) return "internal";
  if (matches(ref, SEARCH)) return "search";
  if (matches(ref, SOCIAL)) return "social";
  return "referral";
}

export interface ChannelCount {
  channel: Channel;
  sessions: number;
}
export interface ReferrerCount {
  host: string;
  channel: Channel;
  sessions: number;
}

/** Nombre d'hôtes référents renvoyés : au-delà, la liste est tronquée. */
export const TOP_REFERENTS = 20;

/**
 * Plafond de sessions lues par `acquisition` (lib/queries-acquisition.ts) : les
 * sessions retenues sont les PREMIÈRES par identifiant (`order by p.app_id,
 * p.session_id`), pas les plus récentes. Atteint, il est dit à côté du chiffre (S4).
 */
export const PLAFOND_ACQUISITION = 20_000;

/** Routes d'entrée gardées par la table croisée route × canal (§ 5.16.4, A4). */
export const TOP_ENTREES = 10;

/** Une route d'entrée : ses sessions par canal, zéros compris, et leur somme. */
export interface EntreeParCanal {
  route: string;
  parCanal: Record<Channel, number>;
  /** Somme des cinq cellules : les sessions entrées par cette route. */
  total: number;
}

export interface AcquisitionReport {
  channels: ChannelCount[]; // ordre CHANNELS, comptes >= 0
  referrers: ReferrerCount[]; // top hôtes externes (hors interne/direct), tri desc
  total: number;
  /**
   * B31 : routes d'entrée croisées par canal, les `TOP_ENTREES` plus fréquentes
   * (total décroissant, puis route). Vide si les entrées lues ne portent pas de route.
   */
  entrees: EntreeParCanal[];
  /** Routes d'entrée DISTINCTES lues : au-delà de `entrees.length`, la table est tronquée (S4). */
  routesEntree: number;
}

/** L'entrée d'une session : référent, URL et route de sa 1re vue sur la fenêtre. */
export interface EntreeSession {
  referrer: string | null;
  url: string | null;
  /** Absente chez un appelant qui ne la lit pas : l'entrée ne compte alors dans aucune ligne de la table croisée. */
  route?: string | null;
}

const zeroParCanal = (): Record<Channel, number> =>
  Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<Channel, number>;

/**
 * Agrège les entrées de session (referrer + url de la 1re page vue) en report
 * d'acquisition : répartition par canal, top hôtes référents externes et (B31)
 * routes d'entrée croisées par canal.
 */
export function acquisitionReport(
  entries: EntreeSession[],
  topReferrers = TOP_REFERENTS,
  topEntrees = TOP_ENTREES,
): AcquisitionReport {
  const chan = new Map<Channel, number>(CHANNELS.map((c) => [c, 0]));
  const refs = new Map<string, { channel: Channel; sessions: number }>();
  const routes = new Map<string, Record<Channel, number>>();
  for (const e of entries) {
    const c = classifyChannel(e.referrer, e.url);
    chan.set(c, (chan.get(c) ?? 0) + 1);
    if (c === "referral" || c === "search" || c === "social") {
      const host = hostOf(e.referrer);
      if (host) {
        const r = refs.get(host) ?? { channel: c, sessions: 0 };
        r.sessions++;
        refs.set(host, r);
      }
    }
    if (e.route) {
      const ligne = routes.get(e.route) ?? zeroParCanal();
      ligne[c]++;
      routes.set(e.route, ligne);
    }
  }
  return {
    channels: CHANNELS.map((channel) => ({ channel, sessions: chan.get(channel) ?? 0 })),
    referrers: [...refs.entries()]
      .map(([host, r]) => ({ host, channel: r.channel, sessions: r.sessions }))
      .sort((a, b) => b.sessions - a.sessions || (a.host < b.host ? -1 : 1))
      .slice(0, topReferrers),
    total: entries.length,
    entrees: [...routes.entries()]
      .map(([route, parCanal]) => ({ route, parCanal, total: CHANNELS.reduce((s, c) => s + parCanal[c], 0) }))
      .sort((a, b) => b.total - a.total || (a.route < b.route ? -1 : a.route > b.route ? 1 : 0))
      .slice(0, topEntrees),
    routesEntree: routes.size,
  };
}

/** Un seau de la série « Canaux dans le temps » : sessions entrées par canal (B31, A6). */
export interface PointCanaux {
  /** Début du seau, ISO UTC (grille du contrat, `bucketStarts`). */
  t: string;
  canaux: Record<Channel, number>;
}

/**
 * Série par seau, zéros compris : chaque entrée de session tombe dans le seau de
 * sa 1re vue (`t`, début du seau en ms). La grille est celle du contrat
 * (`debuts`) : un seau sans session vaut 0 session, un vrai zéro puisque la
 * lecture couvre toute la fenêtre. Une entrée hors grille (seau non aligné) n'est
 * rangée dans aucun seau voisin : `horsGrille` la compte.
 */
export function serieCanaux(
  entries: (Pick<EntreeSession, "referrer" | "url"> & { t: number })[],
  debuts: readonly number[],
): { points: PointCanaux[]; horsGrille: number } {
  const index = new Map(debuts.map((t, i) => [t, i]));
  const points: PointCanaux[] = debuts.map((t) => ({ t: new Date(t).toISOString(), canaux: zeroParCanal() }));
  let horsGrille = 0;
  for (const e of entries) {
    const i = index.get(e.t);
    if (i === undefined) {
      horsGrille++;
      continue;
    }
    points[i].canaux[classifyChannel(e.referrer, e.url)]++;
  }
  return { points, horsGrille };
}

// ═══════════════════════ Lecture de l'écran (F48, § 5.16) ═══════════════════════

/**
 * Libellé de chaque canal à l'écran. « Direct » ne veut pas dire « adresse tapée » :
 * il regroupe toute entrée SANS référent reçu, y compris un site d'origine qui
 * retire son adresse (`Referrer-Policy`) — le libellé le dit (CS5).
 */
export const LIBELLE_CANAL: Record<Channel, string> = {
  direct: "Direct ou référent masqué",
  search: "Recherche",
  social: "Réseaux sociaux",
  referral: "Site référent",
  internal: "Interne",
};

export interface LigneCanal {
  channel: Channel;
  sessions: number;
  /** Part de TOUTES les sessions lues ; null sans session (pas de dénominateur, V3). */
  part: number | null;
}

/**
 * Les cinq canaux, TOUJOURS, dans l'ordre fixe de `CHANNELS`, zéros compris :
 * l'absence de recherche est une information, que l'anneau d'avant cachait en
 * filtrant les parts nulles. Un ordre fixe (et non par volume) garde chaque canal
 * à la même place d'une période à l'autre.
 */
export function lignesCanaux(r: AcquisitionReport): LigneCanal[] {
  const parCanal = new Map(r.channels.map((c) => [c.channel, c.sessions]));
  return CHANNELS.map((channel) => {
    const sessions = parCanal.get(channel) ?? 0;
    return { channel, sessions, part: partDuTotal(sessions, r.total) };
  });
}

/**
 * Part des sessions arrivées d'AILLEURS : ni sans référent (direct), ni depuis le
 * site lui-même (interne). `(total − direct − interne) / total` ; null sans session.
 */
export function partHorsDirect(r: AcquisitionReport): number | null {
  const n = (canal: Channel) => r.channels.find((c) => c.channel === canal)?.sessions ?? 0;
  return partDuTotal(r.total - n("direct") - n("internal"), r.total);
}

/** Part d'un compte sur TOUTES les sessions lues (jamais sur un top N) ; null sans session. */
export function partDuTotal(sessions: number, total: number): number | null {
  return total > 0 ? sessions / total : null;
}

/**
 * La liste des référents est-elle tronquée ? `acquisitionReport` n'en garde que
 * `top` : en rendre `top` veut dire « au moins `top` », et l'écran écrit « ≥ 20 ».
 */
export function referentsTronques(r: AcquisitionReport, top = TOP_REFERENTS): boolean {
  return r.referrers.length >= top;
}
