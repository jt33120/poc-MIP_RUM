import { boundedName, type EventContext } from "./event-context";
import { MIP_UI_ATTR } from "./breadcrumbs";
import type { AttrValue } from "./errors";

/** Fenêtre causale fixe approuvée : les nouveaux effets sortent après 5 s. */
export const ACTION_WINDOW_MS = 5_000;
export const ACTION_NAME_MAX = 100;

const INTERACTIVE =
  "button,a,[role='button'],input:not([type='hidden']),select,textarea,label,summary,[tabindex]:not([tabindex='-1'])";
const INTERNAL_EPOCH = "mip.action_epoch";

export type ActionKind = "click" | "manual";
export type ActionAttrs = Record<string, AttrValue>;

export interface ActionLink {
  id: string;
  name: string;
  kind: ActionKind;
  startedAt: number;
  attrs: ActionAttrs;
}

interface ActionRoot extends ActionLink {
  accepted: boolean;
  replayable: boolean;
  errorSignaled: boolean;
  epoch: number;
  sessionId: string;
  rootAttrs: ActionAttrs;
}

export interface ActionTrackerOptions {
  emitRoot: (attrs: ActionAttrs, ts: number) => boolean | "accepted" | "sampled_out" | "rejected";
  rootSnapshot: (context: EventContext) => ActionAttrs;
  sessionId: () => string;
  newId: () => string;
  now?: () => number;
  windowMs?: number;
}

/**
 * Horloge causale bornée, indépendante de l'enveloppe métier P2.
 *
 * Une racine refusée reste un candidat uniquement pour le rejeu error-biased.
 * Aucun autre effet ne reçoit son identifiant tant que cette racine n'a pas été
 * effectivement prise en charge par sampling/beforeSend/consent.
 */
export class ActionTracker {
  private roots: ActionRoot[] = [];
  private currentRoot: ActionRoot | null = null;
  private consentEpoch = 0;
  private enabled = true;
  private readonly now: () => number;
  private readonly windowMs: number;

  constructor(private readonly options: ActionTrackerOptions) {
    this.now = options.now ?? Date.now;
    this.windowMs = options.windowMs ?? ACTION_WINDOW_MS;
  }

  open(name: string, kind: ActionKind, context: EventContext = {}): boolean {
    if (!this.enabled) return false;
    const safeName = boundedName(name);
    if (!safeName) return false;
    const startedAt = this.now();
    const id = this.options.newId();
    const snapshot = this.options.rootSnapshot(context);
    const sessionId = this.options.sessionId();
    const epoch = this.consentEpoch;
    const linkAttrs: ActionAttrs = {
      ...snapshot,
      "mip.action_id": id,
      "mip.session_id": sessionId,
      [INTERNAL_EPOCH]: epoch,
    };
    const rootAttrs: ActionAttrs = {
      ...linkAttrs,
      "mip.event_type": "action",
      "mip.event_name": safeName,
      "mip.action_type": kind,
    };
    const root: ActionRoot = {
      id,
      name: safeName,
      kind,
      startedAt,
      attrs: linkAttrs,
      rootAttrs,
      sessionId,
      epoch,
      accepted: false,
      replayable: false,
      errorSignaled: false,
    };
    this.currentRoot = root;
    this.roots.push(root);
    this.trim(startedAt);
    const decision = this.options.emitRoot(root.rootAttrs, startedAt);
    root.accepted = decision === true || decision === "accepted";
    root.replayable = decision === "sampled_out";
    return root.accepted;
  }

  /** Dernière racine acceptée pour un nouvel effet, ou null hors fenêtre. */
  current(at: number = this.now()): ActionLink | null {
    const root = this.currentRoot;
    if (!root || !root.accepted || !this.within(root, at)) return null;
    return this.publicLink(root);
  }

  /** Snapshot au départ d'un effet async, candidat error-biased compris. */
  origin(at: number = this.now()): ActionLink | null {
    const root = this.currentRoot;
    if (!root || (!root.accepted && !root.replayable) || !this.within(root, at) || !this.rootStillValid(root)) {
      return null;
    }
    return this.publicLink(root);
  }

  /** Attribution ressource par timestamp de départ (heuristique explicitement bornée). */
  atTimestamp(at: number): ActionLink | null {
    this.trim(at);
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const root = this.roots[i];
      if (root.startedAt > at) continue;
      // Le dernier clic gagne aussi lorsqu'il est rejeté : retomber sur une
      // action plus ancienne attribuerait la même requête différemment entre
      // fetch/XHR (snapshot courant) et ResourceTiming (timestamp de départ).
      if ((!root.accepted && !root.replayable) || !this.within(root, at) || !this.rootStillValid(root)) return null;
      return this.publicLink(root);
    }
    return null;
  }

  /**
   * Première erreur d'une session error-biased : rejoue la racine originale
   * après la promotion du sampler, avant frustration.error puis exception.
   */
  forError(at: number = this.now()): ActionLink | null {
    const root = this.currentRoot;
    if (!root || !root.replayable || !this.within(root, at) || !this.rootStillValid(root)) return null;
    if (!root.accepted) {
      const decision = this.options.emitRoot(root.rootAttrs, root.startedAt);
      root.accepted = decision === true || decision === "accepted";
      root.replayable = false;
    }
    return root.accepted ? this.publicLink(root) : null;
  }

  /** Candidat d'erreur sans effet de bord, pour exécuter beforeSend AVANT tout replay. */
  errorCandidate(at: number = this.now()): ActionLink | null {
    const root = this.currentRoot;
    if (!root || (!root.accepted && !root.replayable) || !this.within(root, at) || !this.rootStillValid(root)) return null;
    return this.publicLink(root);
  }

  markError(actionId: string): boolean {
    const root = this.roots.find((candidate) => candidate.id === actionId);
    if (!root || root.errorSignaled) return false;
    root.errorSignaled = true;
    return true;
  }

  nameOf(actionId: string): string | null {
    return this.roots.find((candidate) => candidate.id === actionId)?.name ?? null;
  }

  /** Navigation ou rotation d'identité : aucun nouvel effet n'hérite de l'action. */
  close(): void {
    this.currentRoot = null;
  }

  /** Le refus purge les candidats; le ré-accord ne ressuscite jamais un clic refusé. */
  consent(granted: boolean): void {
    if (!granted) {
      this.enabled = false;
      this.currentRoot = null;
      this.roots = [];
      this.consentEpoch++;
      return;
    }
    if (!this.enabled) {
      this.enabled = true;
      this.consentEpoch++;
    }
  }

  /**
   * Contrôle tardif des snapshots fetch/XHR/drain. On conserve route/session/
   * contexte d'origine, mais on retire le lien causal si sa racine a été
   * révoquée par consentement ou rotation de session.
   */
  validate(attrs: ActionAttrs, preserveEpoch = false, allowUnaccepted = false): ActionAttrs {
    const out = { ...attrs };
    const id = typeof out["mip.action_id"] === "string" ? out["mip.action_id"] : null;
    const epoch = typeof out[INTERNAL_EPOCH] === "number" ? out[INTERNAL_EPOCH] : null;
    if (!preserveEpoch) delete out[INTERNAL_EPOCH];
    if (!id) return out;
    const root = this.roots.find((candidate) => candidate.id === id);
    const snapshotSession = typeof out["mip.session_id"] === "string" ? out["mip.session_id"] : null;
    if (
      (root != null && !root.accepted && !allowUnaccepted) ||
      (root != null && epoch !== root.epoch) ||
      epoch !== this.consentEpoch ||
      snapshotSession !== this.options.sessionId()
    ) {
      delete out["mip.action_id"];
      if (preserveEpoch) delete out[INTERNAL_EPOCH];
    }
    return out;
  }

  private within(root: ActionRoot, at: number): boolean {
    return at >= root.startedAt && at - root.startedAt <= this.windowMs;
  }

  private rootStillValid(root: ActionRoot): boolean {
    return this.enabled && root.epoch === this.consentEpoch && root.sessionId === this.options.sessionId();
  }

  private trim(_at: number): void {
    // Les attributs asynchrones portent eux-mêmes époque + session : même si le
    // détail d'une vieille racine acceptée sort de ce cache, validate() peut
    // encore vérifier son snapshot sans le réattribuer au clic courant. Une
    // racine refusée reste toutefois une barrière chronologique : la retirer
    // ferait retomber une ResourceTiming lente sur l'action acceptée précédente.
    // Le cap garde cet historique borné; si une barrière en sort, toutes les
    // racines plus anciennes en sont déjà sorties avec elle.
    if (this.roots.length > 200) this.roots = this.roots.slice(-200);
  }

  private publicLink(root: ActionRoot): ActionLink {
    return { id: root.id, name: root.name, kind: root.kind, startedAt: root.startedAt, attrs: { ...root.attrs } };
  }
}

function textOf(value: string | null | undefined): string | null {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, ACTION_NAME_MAX) : null;
}

function labelledBy(el: Element): string | null {
  const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  if (!ids.length || typeof document === "undefined") return null;
  return textOf(ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
}

function associatedLabel(el: Element): string | null {
  const labels = (el as HTMLInputElement).labels;
  if (!labels?.length) return null;
  return textOf(Array.from(labels, (label) => label.textContent ?? "").join(" "));
}

/** Nom accessible sans jamais lire value/checked/selectedOptions d'un champ. */
export function automaticActionName(el: Element): string | null {
  const override = boundedName(el.getAttribute("data-mip-action-name"));
  if (override) return override;
  const tag = el.tagName.toLowerCase();
  const label =
    textOf(el.getAttribute("aria-label")) ??
    labelledBy(el) ??
    associatedLabel(el) ??
    (tag === "button" || tag === "a" || tag === "label" || tag === "summary" || el.getAttribute("role") === "button"
      ? textOf(el.textContent)
      : null);
  const fallback = tag === "input" ? `input:${(el.getAttribute("type") ?? "text").toLowerCase()}` : tag;
  return boundedName(label ? `${fallback} "${label}"` : fallback);
}

export interface AutomaticActionWatch { stop(): void }

/** Clic primaire interactif, phase capture; les clics synthétiques de label sont dédupliqués. */
export function initAutomaticActions(tracker: ActionTracker): AutomaticActionWatch {
  if (typeof document === "undefined") return { stop() {} };
  let forwardedControl: Element | null = null;
  let forwardedAt = 0;
  const listener = (event: MouseEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const el = event.target.closest(INTERACTIVE);
    if (!el || el.closest(`[${MIP_UI_ATTR}]`)) return;
    const now = Date.now();
    if (forwardedControl === el && event.detail === 0 && now - forwardedAt < 1_000) {
      forwardedControl = null;
      return;
    }
    if (el.tagName.toLowerCase() === "label") {
      forwardedControl = (el as HTMLLabelElement).control;
      forwardedAt = now;
    }
    const name = automaticActionName(el);
    if (name) tracker.open(name, "click");
  };
  document.addEventListener("click", listener, { capture: true, passive: true });
  return { stop: () => document.removeEventListener("click", listener, { capture: true }) };
}

export function actionAttrs(link: ActionLink | null): ActionAttrs {
  return link ? { ...link.attrs } : {};
}
