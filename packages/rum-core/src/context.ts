/**
 * Contexte d'événement — primitive PURE partagée par le web et React Native.
 *
 * Les cinq couches sont conservées séparément pour rendre la précédence
 * explicite : global < identité < vue < action < local. `snapshot()` reconstruit
 * un objet neuf, borné, puis le fige ; un événement déjà émis ne peut donc pas
 * être modifié par un appel ultérieur à setUser/startView.
 *
 * Le module n'expose PAS de singleton : chaque runtime instancie son propre
 * `EventContextStore`. Un store partagé entre deux runtimes ferait fuir le
 * contexte d'une app dans l'autre le jour où les deux cohabitent (WebView).
 */
export type ContextValue = string | number | boolean | null | ContextValue[] | { [key: string]: ContextValue };
export type EventContext = Record<string, unknown>;

export const CONTEXT_LIMITS = {
  name: 100,
  key: 100,
  string: 500,
  depth: 4,
  keys: 64,
  bytes: 16 * 1024,
} as const;

const RESERVED = new Set([
  "session_id", "trace_id", "span_id", "app_id", "client_id", "sampling",
  "sample_rate", "error_sample_rate", "route", "view_id", "action_id",
]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export interface EventMeta {
  type: "telemetry" | "custom" | "view" | "action" | "timing" | "feature_flag" | "error";
  name: string;
}

export interface IdentityInput extends EventContext {
  id: string;
}

export interface ContextEnvelope {
  context?: string;
  userId?: string;
  accountId?: string;
  viewId?: string;
  viewName?: string;
  actionId?: string;
}

export interface IdentityState {
  id: string;
  context: Readonly<EventContext>;
}

interface ViewState {
  id: string;
  name: string;
  route: string;
  startedAt: number;
  context: Readonly<EventContext>;
  flags: Readonly<EventContext>;
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function cleanKey(raw: string): string | null {
  const key = raw.trim();
  if (key.length > CONTEXT_LIMITS.key) return null;
  if (!key || key.startsWith("mip.") || RESERVED.has(key.toLowerCase()) || DANGEROUS_KEYS.has(key.toLowerCase())) return null;
  return key;
}

function sanitizeValue(value: unknown, depth: number, budget: { keys: number }): ContextValue | undefined {
  if (value == null) return null;
  if (typeof value === "string") return value.length <= CONTEXT_LIMITS.string ? value : undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (depth >= CONTEXT_LIMITS.depth) return undefined;
  if (Array.isArray(value)) {
    const out: ContextValue[] = [];
    for (const item of value) {
      const clean = sanitizeValue(item, depth + 1, budget);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }
  if (typeof value !== "object") return undefined;
  const out: Record<string, ContextValue> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (budget.keys >= CONTEXT_LIMITS.keys) break;
    const key = cleanKey(rawKey);
    if (!key) continue;
    budget.keys++;
    const clean = sanitizeValue(rawValue, depth + 1, budget);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/** Défense client : limites structurelles, valeurs JSON seulement, champs SDK exclus. */
export function sanitizeContext(value: unknown): Readonly<EventContext> {
  const clean = sanitizeValue(value, 0, { keys: 0 });
  if (!clean || Array.isArray(clean) || typeof clean !== "object") return Object.freeze({});
  const entries = Object.entries(clean as EventContext);
  const out: EventContext = {};
  for (const [key, item] of entries) {
    out[key] = item;
    if (byteLength(JSON.stringify(out)) > CONTEXT_LIMITS.bytes) delete out[key];
  }
  return deepFreeze(out);
}

export function boundedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length > CONTEXT_LIMITS.name) return null;
  return name || null;
}

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Les identifiants de vue/action ne sont pas des secrets. Ce repli évite de
  // casser les vieux WebViews dépourvus de Web Crypto tout en gardant une
  // entropie suffisante pour une corrélation locale de télémétrie. Il sert aussi
  // sous Hermes, dont le `crypto` global n'est pas garanti.
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32).padEnd(32, "0");
}

/**
 * Validation d'une identité métier, en trois issues distinctes — et il FAUT
 * qu'elles restent distinctes : `setUser()` doit répondre « refusé » sur une
 * entrée invalide, pas sur une identité simplement identique à la précédente.
 *
 * `undefined` = entrée invalide (refusée) ; `null` = effacement demandé ;
 * sinon l'identité bornée.
 */
export function validateIdentity(input: string | IdentityInput | null): IdentityState | null | undefined {
  return identity(input);
}

function identity(input: string | IdentityInput | null): IdentityState | null | undefined {
  if (input == null) return null;
  if (typeof input !== "string" && (typeof input !== "object" || Array.isArray(input))) return undefined;
  const raw = typeof input === "string" ? input : input.id;
  const id = typeof raw === "string" ? raw.trim() : "";
  if (id.length > CONTEXT_LIMITS.string || !id) return undefined;
  const rest = typeof input === "string" ? {} : Object.fromEntries(Object.entries(input).filter(([k]) => k !== "id"));
  return { id, context: sanitizeContext(rest) };
}

export class EventContextStore {
  private global: Readonly<EventContext> = Object.freeze({});
  private user: IdentityState | null = null;
  private account: IdentityState | null = null;
  private view: ViewState | null = null;

  setGlobal(value: EventContext): void { this.global = sanitizeContext(value); }
  setGlobalProperty(key: string, value: unknown): void {
    this.global = sanitizeContext({ ...this.global, [key]: value });
  }
  removeGlobalProperty(key: string): void {
    const next = { ...this.global };
    delete next[key];
    this.global = sanitizeContext(next);
  }
  getGlobal(): Readonly<EventContext> { return this.global; }
  setUser(value: string | IdentityInput | null): boolean {
    const next = identity(value);
    if (next === undefined) return false;
    const changed = JSON.stringify(next) !== JSON.stringify(this.user);
    this.user = next;
    return changed;
  }
  setAccount(value: string | IdentityInput | null): boolean {
    const next = identity(value);
    if (next === undefined) return false;
    const changed = JSON.stringify(next) !== JSON.stringify(this.account);
    this.account = next;
    return changed;
  }

  startView(name: string, route: string, context: EventContext = {}, now: number = Date.now()): ViewState | null {
    const safeName = boundedName(name);
    if (!safeName || !Number.isFinite(now)) return null;
    this.view = {
      id: randomId(), name: safeName, route, startedAt: now,
      context: sanitizeContext(context), flags: Object.freeze({}),
    };
    return this.view;
  }

  currentView(): Readonly<ViewState> | null { return this.view; }

  addFlag(name: string, value: unknown): boolean {
    const key = boundedName(name);
    if (!key || !(typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value == null)) return false;
    if (typeof value === "number" && !Number.isFinite(value)) return false;
    if (typeof value === "string" && (!value.length || value.length > CONTEXT_LIMITS.string)) return false;
    if (!this.view) return false;
    const flags = sanitizeContext({ ...this.view.flags, [key]: value });
    if (!Object.prototype.hasOwnProperty.call(flags, key)) return false;
    this.view = { ...this.view, flags };
    return true;
  }

  timing(name: string, timestamp: number = Date.now()): number | null {
    if (!boundedName(name) || !this.view || !Number.isFinite(timestamp) || timestamp < this.view.startedAt) return null;
    return timestamp - this.view.startedAt;
  }

  snapshot(action: EventContext = {}, local: EventContext = {}): Readonly<EventContext> {
    const view = this.view
      ? {
          ...this.view.context,
          ...(Object.keys(this.view.flags).length ? { feature_flags: this.view.flags } : {}),
        }
      : {};
    const layers = [
      this.global,
      this.user?.context ?? {},
      this.account?.context ?? {},
      view,
      sanitizeContext(action),
      sanitizeContext(local),
    ];
    const values = Object.assign({}, ...layers);
    // En cas de dépassement des 64 clefs, les couches les plus spécifiques
    // entrent d'abord dans le budget : une clef locale ne disparaît jamais au
    // profit d'une clef globale moins prioritaire.
    const ordered: EventContext = {};
    const seen = new Set<string>();
    for (const layer of [...layers].reverse()) {
      for (const key of Object.keys(layer)) {
        if (seen.has(key)) continue;
        seen.add(key);
        ordered[key] = values[key];
      }
    }
    return sanitizeContext(ordered);
  }

  envelope(action: EventContext = {}, local: EventContext = {}, actionId?: string): ContextEnvelope {
    const snapshot = this.snapshot(action, local);
    return {
      ...(Object.keys(snapshot).length ? { context: JSON.stringify(snapshot) } : {}),
      ...(this.user ? { userId: this.user.id } : {}),
      ...(this.account ? { accountId: this.account.id } : {}),
      ...(this.view ? { viewId: this.view.id, viewName: this.view.name } : {}),
      ...(actionId ? { actionId } : {}),
    };
  }
}

export function newEnvelopeId(): string { return randomId(); }
