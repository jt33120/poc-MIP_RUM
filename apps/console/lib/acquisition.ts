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

export interface AcquisitionReport {
  channels: ChannelCount[]; // ordre CHANNELS, comptes >= 0
  referrers: ReferrerCount[]; // top hôtes externes (hors interne/direct), tri desc
  total: number;
}

/**
 * Agrège les entrées de session (referrer + url de la 1re page vue) en report
 * d'acquisition : répartition par canal + top hôtes référents externes.
 */
export function acquisitionReport(
  entries: { referrer: string | null; url: string | null }[],
  topReferrers = 20,
): AcquisitionReport {
  const chan = new Map<Channel, number>(CHANNELS.map((c) => [c, 0]));
  const refs = new Map<string, { channel: Channel; sessions: number }>();
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
  }
  return {
    channels: CHANNELS.map((channel) => ({ channel, sessions: chan.get(channel) ?? 0 })),
    referrers: [...refs.entries()]
      .map(([host, r]) => ({ host, channel: r.channel, sessions: r.sessions }))
      .sort((a, b) => b.sessions - a.sessions || (a.host < b.host ? -1 : 1))
      .slice(0, topReferrers),
    total: entries.length,
  };
}
