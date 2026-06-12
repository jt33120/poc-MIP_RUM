// Logique pure de l'onboarding clients (v0.5) — validations + dérivation du
// statut d'intégration. Aucune I/O ici : tout est testé unitairement.

/** app_id : slug court, minuscule, stable (il finit dans chaque event). */
export function validateAppId(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) ? slug : null;
}

/**
 * "https://app.client.fr, http://localhost:5173" -> origines normalisées (scheme+host+port).
 * Rejette ce qui n'est pas une URL http(s) absolue ; dédoublonne ; [] si rien.
 */
export function parseOrigins(raw: string): { origins: string[]; invalid: string[] } {
  const origins = new Set<string>();
  const invalid: string[] = [];
  for (const part of raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)) {
    try {
      const u = new URL(part);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      origins.add(u.origin);
    } catch {
      invalid.push(part);
    }
  }
  return { origins: [...origins], invalid };
}

/** Clé d'API au format historique mip_<32 hex> (cf. .secrets-v02 : clés v0.2). */
export function formatApiKey(hex32: string): string {
  return `mip_${hex32}`;
}

export interface OnboardingProbe {
  first_metric_at: Date | null;
  last_metric_at: Date | null;
  sessions_24h: number;
  first_front_span_at: Date | null;
  first_back_span_at: Date | null;
  errors_24h: number;
}

export type StepState = "done" | "waiting";

export interface OnboardingStatus {
  snippet: StepState; // des Web Vitals arrivent
  traffic: StepState; // au moins une session sur 24 h
  tracingFront: StepState; // spans front (fetch/XHR instrumentés)
  tracingBack: StepState; // spans back (middleware serveur)
  live: boolean; // snippet posé + trafic récent
}

/** Dérive l'état de la checklist du wizard depuis les compteurs en base. */
export function deriveStatus(p: OnboardingProbe): OnboardingStatus {
  const snippet = p.first_metric_at ? "done" : "waiting";
  const traffic = p.sessions_24h > 0 ? "done" : "waiting";
  return {
    snippet,
    traffic,
    tracingFront: p.first_front_span_at ? "done" : "waiting",
    tracingBack: p.first_back_span_at ? "done" : "waiting",
    live: snippet === "done" && traffic === "done",
  };
}

/** Snippet HTML généré pour le client — la seule source de vérité du wizard. */
export function buildSnippet(opts: {
  sdkUrl: string;
  endpoint: string;
  appId: string;
  clientId: string | null;
  withConsent: boolean;
}): string {
  const init: string[] = [
    `    endpoint: ${JSON.stringify(opts.endpoint)},`,
    `    appId: ${JSON.stringify(opts.appId)},`,
  ];
  if (opts.clientId) init.push(`    clientId: ${JSON.stringify(opts.clientId)},`);
  init.push(`    env: "prod",`);
  init.push(`    apiKey: "COLLE_ICI_LA_CLE_API", // affichée une seule fois à la création`);
  if (opts.withConsent)
    init.push(`    requireConsent: true, // rien ne part avant MIPRum.consent(true)`);
  return [
    `<!-- MIP RUM -->`,
    `<script src=${JSON.stringify(opts.sdkUrl)}></script>`,
    `<script>`,
    `  MIPRum.init({`,
    ...init,
    `  });`,
    `</script>`,
  ].join("\n");
}

// --- v0.6 : injection zéro-touch (poser le RUM sans modifier le code du site) ---

/** Appel MIPRum.init compact (une ligne) pour les configs d'injection. */
function buildInitCall(o: { endpoint: string; appId: string; clientId: string | null }): string {
  const p = [`endpoint:${JSON.stringify(o.endpoint)}`, `appId:${JSON.stringify(o.appId)}`];
  if (o.clientId) p.push(`clientId:${JSON.stringify(o.clientId)}`);
  p.push(`env:"prod"`);
  return `MIPRum.init({${p.join(",")}})`;
}

/**
 * Ajoute des origines à une CSP existante (script-src, connect-src…) en
 * respectant le fallback default-src, sans dupliquer ni élargir un `*` déjà
 * présent. C'est ce que fait l'injection proxy pour autoriser le SDK et
 * l'ingestion sans casser la politique du site. Logique répliquée (en JS) dans
 * le Cloudflare Worker généré ; testée ici.
 */
export function mergeCsp(csp: string, additions: Record<string, string[]>): string {
  const dirs = new Map<string, string[]>();
  const order: string[] = [];
  for (const part of csp.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(" ");
    const name = (i < 0 ? part : part.slice(0, i)).toLowerCase();
    const vals = i < 0 ? [] : part.slice(i + 1).split(/ +/);
    if (!dirs.has(name)) order.push(name);
    dirs.set(name, vals);
  }
  for (const [name, origins] of Object.entries(additions)) {
    let vals = dirs.get(name);
    if (!vals) {
      const fallback = dirs.get("default-src");
      vals = fallback ? [...fallback] : [];
      dirs.set(name, vals);
      order.push(name);
    }
    if (vals.includes("*")) continue;
    for (const o of origins) if (!vals.includes(o)) vals.push(o);
  }
  return order.map((n) => [n, ...dirs.get(n)!].join(" ")).join("; ");
}

export interface InjectionArtifacts {
  scriptOrigin: string; // origine à autoriser en script-src (SDK)
  connectOrigin: string; // origine à autoriser en connect-src (ingestion)
  worker: string; // Cloudflare Worker (injecte + relâche la CSP)
  nginx: string; // snippet ngx_http_sub_module
  gtm: string; // tag « HTML personnalisé » Google Tag Manager
}

/**
 * Génère les trois configs d'injection front préremplies pour un client.
 * Aucune n'embarque la clé d'API (clé front optionnelle, enforcement off) :
 * elles ne font que poser les deux balises <script> du SDK depuis l'infra.
 */
export function buildInjectionArtifacts(opts: {
  sdkUrl: string;
  endpoint: string;
  appId: string;
  clientId: string | null;
}): InjectionArtifacts {
  const scriptOrigin = new URL(opts.sdkUrl).origin;
  const connectOrigin = new URL(opts.endpoint).origin;
  const init = buildInitCall(opts);
  const tags = `<script src="${opts.sdkUrl}"></script><script>${init}</script>`;

  const worker = `// MIP RUM — injection zéro-touch (Cloudflare Worker). Aucune modification du
// code source : injecte le RUM dans le <head> de chaque page HTML servie, et
// relâche la CSP pour autoriser le SDK et l'ingestion.
// Déploiement : Cloudflare > Workers & Pages > Create > coller ce code > Deploy,
// puis Settings > Triggers > Routes : <domaine-du-client>/*
const SCRIPT_ORIGIN = ${JSON.stringify(scriptOrigin)};
const CONNECT_ORIGIN = ${JSON.stringify(connectOrigin)};
const TAGS = ${JSON.stringify(tags)};

class HeadInjector {
  element(el) { el.append(TAGS, { html: true }); }
}

// même logique que mergeCsp côté console : ajoute les origines sans casser la CSP
function relaxCsp(csp) {
  const dirs = new Map();
  const order = [];
  for (const part of csp.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(" ");
    const name = (i < 0 ? part : part.slice(0, i)).toLowerCase();
    const vals = i < 0 ? [] : part.slice(i + 1).split(/ +/);
    if (!dirs.has(name)) order.push(name);
    dirs.set(name, vals);
  }
  const ensure = (name, origin) => {
    let vals = dirs.get(name);
    if (!vals) { const d = dirs.get("default-src"); vals = d ? [...d] : []; dirs.set(name, vals); order.push(name); }
    if (!vals.includes("*") && !vals.includes(origin)) vals.push(origin);
  };
  ensure("script-src", SCRIPT_ORIGIN);
  ensure("connect-src", CONNECT_ORIGIN);
  return order.map((n) => [n, ...dirs.get(n)].join(" ")).join("; ");
}

export default {
  async fetch(request) {
    const res = await fetch(request);
    if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
    const out = new HTMLRewriter().on("head", new HeadInjector()).transform(res);
    const headers = new Headers(out.headers);
    const csp = headers.get("content-security-policy");
    if (csp) headers.set("content-security-policy", relaxCsp(csp));
    return new Response(out.body, { status: out.status, statusText: out.statusText, headers });
  },
};`;

  const nginx = `# MIP RUM — injection zéro-touch (nginx). À placer dans le bloc server{}/location{}
# qui sert le HTML du site. Pré-requis : module ngx_http_sub_module (présent par
# défaut sur la plupart des distributions). Aucune modification du code source.

# 1) Le backend ne doit pas compresser le HTML, sinon sub_filter ne le voit pas :
proxy_set_header Accept-Encoding "";
# 2) Injecter les deux balises juste avant </head> :
sub_filter_once on;
sub_filter_types text/html;
sub_filter '</head>' '${tags}</head>';
# 3) Si le backend renvoie une CSP, autoriser le SDK et l'ingestion (adapter à
#    la CSP existante) :
# add_header Content-Security-Policy "script-src 'self' ${scriptOrigin}; connect-src 'self' ${connectOrigin}" always;`;

  const gtm = `<!-- MIP RUM — tag « HTML personnalisé » dans Google Tag Manager.
     Déclencheur : All Pages (idéalement « Initialization - All Pages »).
     Limites GTM : chargement asynchrone (les toutes premières métriques TTFB/FCP
     peuvent manquer) et NE corrige PAS la CSP — la CSP du site doit déjà autoriser
     ${scriptOrigin} (script-src) et ${connectOrigin} (connect-src).
     Pour une couverture et une CSP complètes, préférer l'injection proxy. -->
<script src="${opts.sdkUrl}"></script>
<script>${init}</script>`;

  return { scriptOrigin, connectOrigin, worker, nginx, gtm };
}
