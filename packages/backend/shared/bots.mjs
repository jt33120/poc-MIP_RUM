// Détection de bots à l'ingestion — classifieur PUR (regex sur l'user-agent).
//
// Objectif « Real User » : ne pas polluer les métriques avec du trafic NON humain
// qui exécute quand même du JS et émet donc des spans — headless (CI, audits
// Lighthouse), moniteurs synthétiques (Pingdom, UptimeRobot), crawlers JS,
// clients non-navigateur. On FLAGue (is_bot) plutôt qu'on ne DROPpe : le trafic
// reste auditable, mais exclu par défaut des agrégats côté console.
//
// Volontairement simple et transparent (une regex, pas de base UA externe) —
// on peut expliquer chaque classification. Sous-ensemble ciblé, pas exhaustif :
// les bots qui n'exécutent pas de JS n'atteignent de toute façon jamais l'ingest.

const BOT_RE = new RegExp(
  [
    // robots / crawlers génériques
    "bot\\b", "crawl", "spider", "slurp",
    // moteurs & aperçus réseaux sociaux
    "googlebot", "bingbot", "yandex", "baidu", "duckduck", "applebot",
    "facebookexternalhit", "twitterbot", "discordbot", "slackbot", "linkedinbot",
    "whatsapp", "telegrambot", "pinterest", "redditbot", "embedly",
    // SEO / audit
    "semrush", "ahrefs", "mj12", "dotbot", "petalbot",
    // navigateurs automatisés / synthétique / monitoring
    "headlesschrome", "phantomjs", "puppeteer", "playwright", "selenium",
    "webdriver", "lighthouse", "gtmetrix", "pingdom", "uptimerobot", "statuscake",
    // clients non-navigateur
    "python-requests", "curl/", "wget", "go-http-client", "okhttp", "java/",
    "node-fetch", "axios", "apache-httpclient",
  ].join("|"),
  "i",
);

/**
 * true si l'user-agent (ou un signal `webdriver` remonté par le SDK) trahit un
 * trafic non humain. UA absent/non-string -> false (on ne suppose pas un bot).
 */
export function isBot(ua, webdriver = false) {
  if (webdriver === true || webdriver === "true") return true;
  if (!ua || typeof ua !== "string") return false;
  return BOT_RE.test(ua);
}
