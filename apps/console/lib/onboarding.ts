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
