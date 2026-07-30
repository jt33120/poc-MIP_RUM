// Relais e-mail des alertes. La base ne sait pas envoyer d'e-mail ; elle relaie
// vers la console (POST /api/alerts/email), qui détient le fournisseur et sa clé.
// Ce fichier ne contient QUE des fonctions pures + l'appel HTTP au fournisseur :
// l'authentification et le routage vivent dans la route.

/** Corps envoyé par `route_alert` (migration-v49). */
export type RelayBody = {
  to?: unknown;
  severity?: unknown;
  text?: unknown;
  payload?: unknown;
};

export type AlertMail = { to: string; subject: string; text: string };

const SEVERITIES = ["info", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

// Volontairement permissif sur la forme exacte, strict sur la présence d'un @ et
// l'absence d'espaces : le but est d'écarter une valeur manifestement fausse, pas
// de rejouer la RFC 5322 (dont l'implémentation naïve rejette des adresses valides).
const RE_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valide et met en forme le message. Retourne `null` si l'entrée est inexploitable
 * — l'appelant répond alors 400, ce qui fera passer la livraison en `failed` après
 * réconciliation. On préfère un échec visible à un e-mail vide envoyé pour rien.
 */
export function buildAlertMail(body: RelayBody): AlertMail | null {
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!RE_MAIL.test(to)) return null;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return null;

  const severity: Severity = SEVERITIES.includes(body.severity as Severity)
    ? (body.severity as Severity)
    : "warning";

  // Le sujet porte la sévérité et l'essentiel : une alerte se lit dans la liste
  // des messages, pas seulement une fois ouverte.
  const subject = `[MIP RUM ${severity.toUpperCase()}] ${firstLine(text, 120)}`;

  return { to, subject, text: renderBody(severity, text, body.payload) };
}

function firstLine(s: string, max: number): string {
  const line = s.split("\n", 1)[0] ?? s;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function renderBody(severity: Severity, text: string, payload: unknown): string {
  const lines = [text, "", `Sévérité : ${severity}`];
  if (payload && typeof payload === "object") {
    lines.push("", "Détail :", JSON.stringify(payload, null, 2));
  }
  lines.push("", "— MIP RUM, supervision automatique.");
  return lines.join("\n");
}

export type MailerConfig = { apiKey: string; from: string };

/** Lit la configuration du fournisseur. `null` si absente : jamais de valeur par défaut. */
export function mailerConfig(env: NodeJS.ProcessEnv = process.env): MailerConfig | null {
  const apiKey = env.ALERT_EMAIL_API_KEY?.trim();
  const from = env.ALERT_EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export type SendResult = { ok: boolean; status: number; detail: string };

/**
 * Envoie via l'API HTTP de Resend (palier gratuit suffisant pour de l'alerting).
 * Retourne le résultat plutôt que de lever : l'appelant doit pouvoir répondre un
 * code HTTP fidèle, puisque c'est LUI qui détermine le statut de livraison
 * enregistré en base après réconciliation.
 */
export async function sendAlertMail(
  mail: AlertMail,
  cfg: MailerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: res.ok, status: res.status, detail };
  } catch (e) {
    // Panne réseau / expiration : 502, pour que la livraison soit enregistrée
    // en échec et réessayée, plutôt que silencieusement perdue.
    return { ok: false, status: 502, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Comparaison à temps constant du jeton de relais. `timingSafeEqual` exige des
 * longueurs égales : on compare d'abord les longueurs, ce qui fuite la longueur
 * du jeton et rien d'autre.
 */
export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
