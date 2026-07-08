// Form Analytics (Lot 7) — instrumentation des formulaires AU NIVEAU DU CHAMP,
// façon Matomo : ordre de remplissage, temps par champ, champ modifié, dernier
// champ touché (point d'abandon), soumission vs abandon.
//
// CONFIDENTIALITÉ : on ne capte JAMAIS la valeur d'un champ — uniquement un
// identifiant (name/id/type) et des durées/compteurs. Les champs de type password
// sont réduits à "[password]". Le cœur (FormTracker) est PUR et testé ; le câblage
// DOM (initForms) ne fait que traduire les évènements navigateur en appels au cœur.
import type { Emit } from "./errors";

/** Statistique d'un champ, dans l'ordre de première interaction. */
export interface FieldStat {
  name: string;
  order: number; // 1-indexé
  timeMs: number; // temps cumulé focalisé
  changed: boolean; // a reçu au moins une saisie
  refocus: number; // nombre de retours sur le champ (hésitation)
}

export interface FormSummary {
  fields: FieldStat[];
  totalTimeMs: number;
  lastField: string | null; // dernier champ focalisé (point d'abandon)
  changedCount: number;
}

interface FieldState {
  order: number;
  timeMs: number;
  changed: boolean;
  refocus: number;
}

const MAX_FIELDS = 40; // garde-fou anti-formulaire géant

/**
 * Agrège les interactions d'UN formulaire. Piloté par des horodatages fournis
 * (ms) : testable sans DOM ni horloge réelle.
 */
export class FormTracker {
  private fields = new Map<string, FieldState>();
  private order = 0;
  private focused: { key: string; ts: number } | null = null;
  private last: string | null = null;

  /** Entrée dans un champ (focus). Clôt d'abord le champ précédent encore ouvert. */
  focus(key: string, ts: number): void {
    if (this.focused) this.blur(ts);
    let st = this.fields.get(key);
    if (!st) {
      if (this.fields.size >= MAX_FIELDS) return; // cap : on ignore les champs au-delà
      st = { order: ++this.order, timeMs: 0, changed: false, refocus: 0 };
      this.fields.set(key, st);
    } else {
      st.refocus++;
    }
    this.last = key;
    this.focused = { key, ts };
  }

  /** Sortie du champ courant (blur) : cumule le temps passé. */
  blur(ts: number): void {
    if (!this.focused) return;
    const st = this.fields.get(this.focused.key);
    if (st) st.timeMs += Math.max(0, ts - this.focused.ts);
    this.focused = null;
  }

  /** Saisie dans un champ : marque « modifié ». */
  input(key: string): void {
    const st = this.fields.get(key);
    if (st) st.changed = true;
  }

  get touched(): boolean {
    return this.fields.size > 0;
  }

  /** Résumé ordonné (clôt un focus encore ouvert si `ts` fourni). */
  summary(ts?: number): FormSummary {
    if (ts != null) this.blur(ts);
    const fields = [...this.fields.entries()]
      .map(([name, s]) => ({ name, order: s.order, timeMs: Math.round(s.timeMs), changed: s.changed, refocus: s.refocus }))
      .sort((a, b) => a.order - b.order);
    return {
      fields,
      totalTimeMs: fields.reduce((a, f) => a + f.timeMs, 0),
      lastField: this.last,
      changedCount: fields.filter((f) => f.changed).length,
    };
  }
}

// --- Câblage DOM -------------------------------------------------------------

const MAX_FORMS = 20;

/** Identifiant lisible et NON sensible d'un champ (jamais sa valeur). */
export function fieldKey(el: {
  name?: string;
  id?: string;
  type?: string;
  tagName?: string;
}): string {
  const type = (el.type ?? "").toLowerCase();
  if (type === "password") return "[password]";
  return el.name || el.id || `${(el.tagName ?? "field").toLowerCase()}:${type || "text"}`;
}

/** Identifiant d'un formulaire (id/name/action, jamais de contenu). */
function formKey(form: HTMLFormElement, index: number): string {
  const action = form.getAttribute("action");
  return (
    form.getAttribute("id") ||
    form.getAttribute("name") ||
    (action ? action.split("?")[0] : "") ||
    `form#${index}`
  );
}

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const IGNORED_TYPES = new Set(["submit", "button", "reset", "hidden", "file"]);

function isTrackedField(el: Element): el is HTMLElement {
  if (!FIELD_TAGS.has(el.tagName)) return false;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  return !IGNORED_TYPES.has(type);
}

/**
 * Instrumente les formulaires de la page. Émet `track.form.submit` à la soumission
 * et `track.form.abandon` quand la page passe en arrière-plan avec un formulaire
 * entamé mais non soumis. Opt-out via cfg.forms=false (géré par l'appelant).
 */
export function initForms(emit: Emit, now: () => number = () => Date.now()): void {
  const trackers = new Map<string, FormTracker>();

  const trackerFor = (form: HTMLFormElement): FormTracker | null => {
    const forms = Array.from(document.forms);
    const key = formKey(form, forms.indexOf(form));
    let t = trackers.get(key);
    if (!t) {
      if (trackers.size >= MAX_FORMS) return null;
      trackers.set(key, (t = new FormTracker()));
    }
    return t;
  };

  const send = (key: string, kind: "submit" | "abandon", t: FormTracker): void => {
    if (!t.touched) return;
    const s = t.summary(now());
    emit(`track.form.${kind}`, {
      "mip.props": JSON.stringify({
        form: key,
        submitted: kind === "submit",
        fields: s.fields.slice(0, MAX_FIELDS),
        total_time_ms: s.totalTimeMs,
        changed_count: s.changedCount,
        last_field: s.lastField,
      }),
    });
  };

  const fieldOf = (target: EventTarget | null): { form: HTMLFormElement; key: string } | null => {
    const el = target as Element | null;
    if (!el || !isTrackedField(el)) return null;
    const form = (el as HTMLInputElement).form;
    if (!form) return null;
    return { form, key: fieldKey(el as HTMLInputElement) };
  };

  document.addEventListener(
    "focusin",
    (e) => {
      const f = fieldOf(e.target);
      if (f) trackerFor(f.form)?.focus(f.key, now());
    },
    true,
  );
  document.addEventListener(
    "focusout",
    (e) => {
      const f = fieldOf(e.target);
      if (f) trackerFor(f.form)?.blur(now());
    },
    true,
  );
  document.addEventListener(
    "input",
    (e) => {
      const f = fieldOf(e.target);
      if (f) trackerFor(f.form)?.input(f.key);
    },
    true,
  );
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement;
      if (!form || form.tagName !== "FORM") return;
      const forms = Array.from(document.forms);
      const key = formKey(form, forms.indexOf(form));
      const t = trackers.get(key);
      if (t) {
        send(key, "submit", t);
        trackers.delete(key);
      }
    },
    true,
  );

  // Abandon : à la mise en arrière-plan, tout formulaire entamé non soumis.
  const flushAbandons = () => {
    if (document.visibilityState !== "hidden") return;
    for (const [key, t] of trackers) send(key, "abandon", t);
    trackers.clear();
  };
  document.addEventListener("visibilitychange", flushAbandons);
}
