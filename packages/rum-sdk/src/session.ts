const STORAGE_KEY = "mip_rum_session";
const INACTIVITY_TTL_MS = 30 * 60 * 1000;

export interface Session {
  sessionId: string;
  userHash: string;
}

/** FNV-1a 32-bit — anonymized fingerprint, no raw PII leaves the browser. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function computeUserHash(): string {
  const parts = [
    navigator.userAgent,
    navigator.language,
    String(screen.width) + "x" + String(screen.height),
    String(new Date().getTimezoneOffset()),
  ].join("|");
  return fnv1a(parts);
}

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Stable session id with 30 min inactivity TTL, persisted in localStorage. */
export function getOrCreateSession(): Session {
  const now = Date.now();
  let stored: { sid: string; last: number } | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    /* storage unavailable or corrupt -> new session */
  }
  const sid =
    stored && now - stored.last < INACTIVITY_TTL_MS ? stored.sid : uuid();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sid, last: now }));
  } catch {
    /* private mode: session lives for the page only */
  }
  return { sessionId: sid, userHash: computeUserHash() };
}

/** Refresh the inactivity window (called on each emitted event). */
export function touchSession(session: Session): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sid: session.sessionId, last: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}
