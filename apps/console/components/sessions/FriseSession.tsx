// Frise de la session (refonte du 30/09/2026, charte § 3.8 et captures 07-08) : la
// chronologie GRAPHIQUE, toujours visible en tête du détail, quel que soit l'onglet.
// Un axe du temps depuis l'ouverture, gradué en secondes ou minutes rondes ; une
// piste par nature — pages vues en segments, actions, signaux de frustration,
// erreurs, appels API et tâches longues en points ou en barres. D'un coup d'œil : où
// sont les erreurs, avant ou après quel clic, sur quelle page.
//
// CE QU'ELLE N'EST PAS. Ni la cascade (onglet « Cascade » : une ligne par élément,
// les durées réseau), ni le rejeu (sa barre porte ses propres repères) : un aperçu
// qui renvoie, par chaque point, à la ligne du déroulé qu'il représente (`#evt-N`).
// Aucune piste n'est inventée : une nature sans élément n'est pas dessinée, une
// chronologie tronquée le dit.
//
// ACCESSIBILITÉ. Le dessin est décoratif pour un lecteur d'écran (ses points ne sont
// pas dans l'ordre de tabulation) : chaque élément est une ligne du déroulé, lisible
// et focalisable. Un résumé chiffré le remplace (`sr-only`). Rendu serveur, sans état.
import type { TimelineItem } from "@/lib/queries";
import { formater } from "@/lib/fmt-ids";
import { etiquettesGraduations, graduationsAxe } from "@/lib/graduations";
import { pluriel } from "@/lib/format";
import { estFrustration } from "@/lib/session-detail";
import { KIND_STYLE, libelleEvenement } from "@/lib/timeline-constants";
import { libelleAction } from "@/lib/libelle-action";

/** Les pistes de la frise, dans l'ordre de lecture (du contexte à l'incident). */
export const PISTES_FRISE = ["vues", "actions", "frustration", "erreurs", "api", "taches"] as const;
export type PisteFrise = (typeof PISTES_FRISE)[number];

export const LIBELLES_PISTES: Record<PisteFrise, string> = {
  vues: "Pages",
  actions: "Actions",
  frustration: "Frustration",
  erreurs: "Erreurs",
  api: "Appels API",
  taches: "Tâches longues",
};

/**
 * Teinte de chaque piste : les MÊMES points que les lignes du déroulé (`KIND_STYLE`),
 * pour qu'un point de la frise et sa ligne se reconnaissent ; le rouge réservé aux
 * erreurs, l'ambre aux signaux de frustration (comme les repères du rejeu).
 */
const TEINTE: Record<PisteFrise, string> = {
  vues: `${KIND_STYLE.pageview.dot} opacity-70`,
  actions: KIND_STYLE.action.dot,
  frustration: "bg-warn",
  erreurs: KIND_STYLE.error.dot,
  api: KIND_STYLE.api.dot,
  taches: KIND_STYLE.longtask.dot,
};

export interface ElementFrise {
  /** Rang dans la chronologie LUE : l'ancre `evt-<rang>` du déroulé. */
  rang: number;
  piste: PisteFrise;
  /** Début, en ms depuis l'ouverture de la session. */
  debutMs: number;
  /** Durée dessinée (segment d'une vue, tâche longue) ; `null` : un instant. */
  dureeMs: number | null;
  libelle: string;
  /** Un appel API en échec (statut ≥ 400 ou nul) : cerclé de rouge. */
  echec?: boolean;
}

/**
 * Les éléments de la frise, lus dans la chronologie — logique pure, testée. Une vue
 * s'étend jusqu'à la vue suivante (la dernière, jusqu'à `finMs`) ; les Web Vitals, les
 * ressources et les repères n'y sont pas : leur instant est celui de leur rapport, ou
 * ils relèvent de la cascade.
 */
export function elementsDeFrise(items: readonly TimelineItem[], debutMs: number, finMs: number): ElementFrise[] {
  const t = (it: TimelineItem) => new Date(it.ts).getTime() - debutMs;
  const vues = items.map((it, rang) => ({ it, rang })).filter(({ it }) => it.kind === "pageview");
  const fin = Math.max(0, finMs - debutMs);
  const elements: ElementFrise[] = [];
  vues.forEach(({ it, rang }, i) => {
    const debut = Math.max(0, t(it));
    const suivante = vues[i + 1];
    const jusqua = suivante ? Math.max(debut, t(suivante.it)) : Math.max(debut, fin);
    elements.push({ rang, piste: "vues", debutMs: debut, dureeMs: jusqua - debut, libelle: it.title ?? "Route inconnue" });
  });
  items.forEach((it, rang) => {
    const debut = Math.max(0, t(it));
    if (!Number.isFinite(debut)) return;
    if (it.kind === "action") {
      elements.push({ rang, piste: "actions", debutMs: debut, dureeMs: null, libelle: libelleAction(it.title ?? it.action_name) });
    } else if (it.kind === "error") {
      elements.push({ rang, piste: "erreurs", debutMs: debut, dureeMs: null, libelle: [it.title, it.detail].filter(Boolean).join(" : ") || "Erreur" });
    } else if (it.kind === "api") {
      elements.push({ rang, piste: "api", debutMs: debut, dureeMs: null, libelle: it.title ?? "Appel API", echec: it.rating === "poor" });
    } else if (it.kind === "longtask") {
      const d = it.value == null ? null : Number(it.value);
      elements.push({
        rang,
        piste: "taches",
        debutMs: debut,
        dureeMs: d != null && Number.isFinite(d) && d > 0 ? d : null,
        libelle: `Tâche longue${d != null && Number.isFinite(d) ? ` de ${Math.round(d)} ms` : ""}`,
      });
    } else if (it.kind === "event" && estFrustration(it)) {
      elements.push({ rang, piste: "frustration", debutMs: debut, dureeMs: null, libelle: libelleEvenement(it.title) });
    }
  });
  return elements;
}

export function FriseSession({
  items,
  debut,
  fin,
  hrefDe,
  tronquee,
}: {
  items: readonly TimelineItem[];
  /** Ouverture de la session (epoch ms) : l'origine de l'axe. */
  debut: number;
  /** Dernière observation (epoch ms) : la fin de l'axe, au moins. */
  fin: number;
  /** Rang dans la chronologie lue → lien vers sa ligne du déroulé, pré-calculé par la page. */
  hrefDe: Record<number, string>;
  /** Chronologie tronquée : la frise ne montre que le début lu, et le dit. */
  tronquee: boolean;
}) {
  const elements = elementsDeFrise(items, debut, fin);
  const dernier = Math.max(0, fin - debut, ...elements.map((e) => e.debutMs + (e.dureeMs ?? 0)));
  const { haut, valeurs } = graduationsAxe(dernier || 1_000, "s-auto");
  // Des durées lisibles (« 30 s », « 1 min 30 s ») plutôt que « 0,5 min » : l'axe se lit
  // comme la colonne des décalages du déroulé. Sous la seconde, les graduations de l'axe.
  const etiquettes = haut >= 3_000 ? valeurs.map((v) => (v === 0 ? "0" : formater("s-auto", v))) : etiquettesGraduations(valeurs, "s-auto");
  const x = (ms: number) => Math.min(100, Math.max(0, (ms / haut) * 100));
  const pistes = PISTES_FRISE.filter((p) => p === "vues" || elements.some((e) => e.piste === p));
  const compte = (p: PisteFrise) => elements.filter((e) => e.piste === p).length;
  const resume = pistes
    .map((p) => `${LIBELLES_PISTES[p]} : ${formater("count", compte(p))}`)
    .join(" · ");

  return (
    <section
      className="card flex h-full min-w-0 flex-col px-3 pb-2 pt-2.5"
      aria-labelledby="frise-session-titre"
      data-testid="frise-session"
    >
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id="frise-session-titre" className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          Frise de la session
        </h2>
        <p className="text-[11px] tabular-nums text-ink-faint" title="Source : chronologie de la session reçue du capteur (vues, actions, erreurs, appels, signaux).">
          {pluriel(elements.length, "élément")} sur {formater("s-auto", Math.max(0, fin - debut))}
          {tronquee ? " · chronologie tronquée : début seulement" : ""}
        </p>
      </div>
      <p className="sr-only">
        Frise de la session sur {formater("s-auto", Math.max(0, fin - debut))} — {resume}. Chaque élément est une ligne du
        déroulé.
      </p>
      {/* Les pistes se partagent la hauteur de la rangée (même bord bas que « En bref »). */}
      <div
        aria-hidden="true"
        className="grid min-w-0 flex-1 grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2"
        style={{ gridTemplateRows: `repeat(${pistes.length}, minmax(1rem, 1fr)) auto` }}
      >
        {pistes.map((p) => (
          <div key={p} className="contents">
            <span className="flex items-center justify-between gap-1 truncate py-0.5 text-[10px] text-ink-soft">
              <span className="truncate">{LIBELLES_PISTES[p]}</span>
              <span className="tabular-nums text-ink-faint">{compte(p)}</span>
            </span>
            <div className="relative min-h-4 border-b border-line/50" data-piste={p}>
              {elements
                .filter((e) => e.piste === p)
                .map((e) => {
                  const gauche = x(e.debutMs);
                  const titre = `${e.libelle} · +${formater("s-auto", e.debutMs)}${e.dureeMs != null && p !== "vues" ? ` · ${formater("s-auto", e.dureeMs)}` : ""}`;
                  const href = hrefDe[e.rang];
                  const classe =
                    e.dureeMs != null
                      ? `absolute top-1/2 h-2 -translate-y-1/2 rounded-sm ${TEINTE[p]} ${p === "vues" ? "border-r-2 border-panel" : ""}`
                      : `absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm ${TEINTE[p]} ${e.echec ? "ring-1 ring-bad" : ""}`;
                  const style = e.dureeMs != null ? { left: `${gauche}%`, width: `max(3px, ${x(e.dureeMs)}%)` } : { left: `${gauche}%` };
                  return href ? (
                    <a
                      key={`${e.piste}-${e.rang}`}
                      href={href}
                      tabIndex={-1}
                      title={titre}
                      className={`${classe} hover:ring-2 hover:ring-perf`}
                      style={style}
                      data-rang={e.rang}
                    />
                  ) : (
                    <span key={`${e.piste}-${e.rang}`} title={titre} className={classe} style={style} data-rang={e.rang} />
                  );
                })}
            </div>
          </div>
        ))}
        {/* Axe du temps : graduations rondes depuis l'ouverture (heure relative). */}
        <span className="pt-0.5 text-[10px] text-ink-faint">depuis l&apos;ouverture</span>
        <div className="relative h-4">
          {valeurs.map((v, i) => (
            <span
              key={v}
              className={`absolute top-0.5 text-[10px] tabular-nums text-ink-faint ${
                i === 0 ? "" : i === valeurs.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
              }`}
              style={{ left: `${x(v)}%` }}
            >
              {etiquettes[i]}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
