// Modèles de tableaux de bord (F35, W-D1, plan § 5.24.5) — logique PURE, testée.
//
// POURQUOI. La liste des tableaux de bord s'ouvrait vide à la première visite :
// l'utilisateur devait deviner quelles cartes surveiller ensemble. Quatre modèles
// prêts à cloner (Datadog « Clone Dashboard ») lui donnent un point de départ.
//
// CHAQUE CARTE EST UN PLAN EXPLORER ORDINAIRE. Elle passe le même registre que
// l'Explorer, l'API et les cartes enregistrées : le test d'aller-retour
// (`serializeLayout` → `normalizeLayout`) la relit comme un tableau de bord relit
// son jsonb. Une carte que le registre refuserait est RETIRÉE du modèle, jamais
// contournée (§ 5.24.5). Aucune mesure ici n'est composable ailleurs sans elle.
//
// UNE HISTOIRE PAR MODÈLE (Grafana). Chaque modèle est écrit en sections titrées
// par une question. Tant que la carte « section » n'existe pas (F37), les cartes
// sont posées dans l'ordre, et le titre court de la section préfixe le titre de sa
// PREMIÈRE carte (« Où ? — LCP p75 par route ») : la question reste lisible sur le
// tableau cloné.
//
// DEUX POPULATIONS, DEUX CARTES (V2). Occurrences et sessions touchées, sessions
// commencées et visiteurs : jamais additionnés, jamais sur une même carte.
import type { ExplorerPlan } from "./analytics-schema";
import { canCreateDashboard, type DashboardPrincipal } from "./dashboard-access";
import { MAX_WIDGETS, WIDGET_META, widgetFromPlan, type AnalyticsWidget, type LegacyWidget, type Widget } from "./dashboards";
import type { AppItem } from "./queries";

export type CleModele = "performance" | "erreurs" | "usages" | "releases";

export interface SectionModele {
  /** Titre court, repris en tête de la première carte tant que F37 n'est pas livré. */
  titre: string;
  /** La question à laquelle la section répond. */
  question: string;
  /** Cartes v2 (plans Explorer) ; une carte v1 quand aucun plan ne l'exprime (« Erreurs principales »). */
  cartes: (AnalyticsWidget | LegacyWidget)[];
}

export interface ModeleTableau {
  cle: CleModele;
  titre: string;
  question: string;
  sections: SectionModele[];
  /** Ce que le modèle ne sait pas dire, et où le lire (carte « Releases »). */
  limite?: { texte: string; libelle: string; href: string };
}

/** Plan Explorer d'une carte : la même forme que `MODELES_EXPLORER` (F31). */
function plan(
  dataset: ExplorerPlan["dataset"],
  field: string,
  aggregation: ExplorerPlan["measure"]["aggregation"],
  visualization: ExplorerPlan["visualization"],
  options: { variant?: string; groupBy?: ExplorerPlan["groupBy"]; limit?: number } = {},
): ExplorerPlan {
  return {
    version: 1,
    dataset,
    measure: { field, aggregation },
    variant: options.variant ?? null,
    groupBy: options.groupBy ?? [],
    visualization,
    // Une série sans groupe n'a qu'une courbe ; un classement en montre dix.
    limit: options.limit ?? (visualization === "toplist" ? 10 : 1),
    cursor: null,
  };
}

const carte = (title: string, p: ExplorerPlan): AnalyticsWidget => widgetFromPlan(p, { title });

const vitalP75 = (vital: string, visualization: ExplorerPlan["visualization"], groupBy: ExplorerPlan["groupBy"] = []) =>
  plan("vitals", "value", "p75", visualization, { variant: vital, groupBy });

/** Les quatre modèles du § 5.24.5, dans l'ordre de la page. */
export const MODELES_TABLEAUX: ModeleTableau[] = [
  {
    cle: "performance",
    titre: "Performance",
    question: "Les pages s'affichent-elles et répondent-elles assez vite, et où ne le font-elles pas ?",
    sections: [
      {
        titre: "Seuils",
        question: "Les vitals tiennent-ils les seuils ?",
        cartes: [
          carte("LCP p75", vitalP75("LCP", "value")),
          carte("INP p75", vitalP75("INP", "value")),
          carte("CLS p75", vitalP75("CLS", "value")),
        ],
      },
      {
        titre: "Depuis quand ?",
        question: "Depuis quand ?",
        cartes: [
          carte("LCP p75 dans le temps", vitalP75("LCP", "timeseries")),
          carte("INP p75 dans le temps", vitalP75("INP", "timeseries")),
        ],
      },
      {
        titre: "Où ?",
        question: "Où ?",
        cartes: [
          carte("LCP p75 par route", vitalP75("LCP", "toplist", ["route"])),
          carte("INP p75 par navigateur", vitalP75("INP", "toplist", ["browser"])),
        ],
      },
    ],
  },
  {
    cle: "erreurs",
    titre: "Erreurs",
    question: "Combien d'erreurs, pour qui, depuis quand, et où ?",
    sections: [
      {
        titre: "Combien",
        question: "Combien, et qui ?",
        cartes: [
          carte("Occurrences", plan("errors", "occurrences", "sum", "value")),
          // Une tuile à part : des sessions ne s'additionnent pas à des occurrences (V2).
          carte("Sessions touchées", plan("errors", "sessions", "distinct", "value")),
        ],
      },
      {
        titre: "Depuis quand ?",
        question: "Depuis quand ?",
        cartes: [carte("Occurrences dans le temps", plan("errors", "occurrences", "sum", "timeseries"))],
      },
      {
        titre: "Où ?",
        question: "Où ?",
        cartes: [
          carte("Occurrences par route", plan("errors", "occurrences", "sum", "toplist", { groupBy: ["route"] })),
          carte("Occurrences par release", plan("errors", "occurrences", "sum", "toplist", { groupBy: ["release"] })),
          // Pas de plan Explorer pour une liste de groupes d'erreurs : la carte v1 existante.
          { kind: "v1", type: "top_errors", title: "Erreurs principales" },
        ],
      },
    ],
  },
  {
    cle: "usages",
    titre: "Usages",
    question: "Combien de sessions, quand, et de qui ?",
    sections: [
      {
        titre: "Combien",
        question: "Combien ?",
        cartes: [
          carte("Sessions commencées", plan("sessions", "started", "count", "value")),
          // Une tuile à part, jamais sommée aux sessions (V2).
          carte("Visiteurs", plan("sessions", "visitors", "distinct", "value")),
        ],
      },
      {
        titre: "Quand ?",
        question: "Quand ?",
        cartes: [carte("Sessions commencées dans le temps", plan("sessions", "started", "count", "timeseries"))],
      },
      {
        titre: "Qui ?",
        question: "Qui ?",
        cartes: [
          carte("Sessions par appareil", plan("sessions", "started", "count", "toplist", { groupBy: ["device"] })),
          carte("Sessions par pays estimé", plan("sessions", "started", "count", "toplist", { groupBy: ["country"] })),
          carte("Actions par route", plan("actions", "rows", "count", "toplist", { groupBy: ["route"] })),
        ],
      },
    ],
  },
  {
    cle: "releases",
    titre: "Releases",
    question: "La dernière release dégrade-t-elle l'expérience ?",
    sections: [
      {
        titre: "Releases",
        question: "La dernière release dégrade-t-elle l'expérience ?",
        cartes: [
          carte("LCP p75 par release", vitalP75("LCP", "toplist", ["release"])),
          carte("INP p75 par release", vitalP75("INP", "toplist", ["release"])),
          carte("Occurrences par release", plan("errors", "occurrences", "sum", "toplist", { groupBy: ["release"] })),
          // Le dénominateur, écrit comme tel : sans lui, des occurrences par release
          // se lisent comme un taux.
          carte("Pages vues par release (dénominateur)", plan("views", "rows", "count", "toplist", { groupBy: ["release"] })),
        ],
      },
    ],
    limite: {
      texte:
        "Un taux d'erreur par release n'est pas exprimable dans l'Explorer (aucune mesure de ratio) : les occurrences et les pages vues sont posées côte à côte, jamais divisées.",
      libelle: "Comparer deux releases sur la Vue d'ensemble",
      href: "/?cmp=release",
    },
  },
];

/** Un modèle par sa clé, ou `null` : une clé inconnue ne clone rien. */
export function modeleTableau(cle: string): ModeleTableau | null {
  return MODELES_TABLEAUX.find((m) => m.cle === cle) ?? null;
}

/**
 * Les cartes d'un modèle, dans l'ordre, telles qu'un clone les écrit. Avant F37, le
 * titre court de chaque section préfixe sa première carte (« Où ? — LCP p75 par
 * route ») ; les titres restent sous 60 caractères (borne de `widgetFromPlan`).
 * Jamais plus de `MAX_WIDGETS` cartes : le test l'exige de chaque modèle.
 */
export function cartesDuModele(modele: ModeleTableau): Widget[] {
  const cartes = modele.sections.flatMap((section) =>
    section.cartes.map((c, rang): Widget => (rang === 0 ? { ...c, title: `${section.titre} — ${c.title}`.slice(0, 60) } : c)),
  );
  return cartes.slice(0, MAX_WIDGETS);
}

/** Libellés des cartes d'une section, pour l'aperçu d'un modèle (`ModeleCarte`). */
export function apercuDuModele(modele: ModeleTableau): { titre: string; cartes: string[] }[] {
  return modele.sections.map((s) => ({ titre: s.question, cartes: s.cartes.map((c) => c.title) }));
}

/**
 * Puce du TYPE d'une carte (W-D2) : ce qu'elle montre, plutôt qu'un nombre de
 * cartes. « Valeur », « Classement », « Série », « Journal » pour une analyse ;
 * « v1 : Trafic »… pour une carte du catalogue historique ; « illisible » sinon.
 */
const REPRESENTATIONS: Record<ExplorerPlan["visualization"], string> = {
  value: "Valeur",
  toplist: "Classement",
  timeseries: "Série",
  table: "Journal",
};
const V1_COURT: Record<LegacyWidget["type"], string> = {
  vital_p75: "Web Vital",
  traffic: "Trafic",
  slow_routes: "Routes lentes",
  top_errors: "Erreurs principales",
  frustration: "Frustration",
  event_count: "Événement",
};
export function puceDeCarte(widget: Widget): string {
  if (widget.kind === "v2") return REPRESENTATIONS[widget.plan.visualization];
  if (widget.kind === "v1") {
    return `v1 : ${widget.type === "vital_p75" && widget.metric ? `${widget.metric} p75` : (V1_COURT[widget.type] ?? WIDGET_META[widget.type].label)}`;
  }
  return "illisible";
}

/** Les puces d'un tableau, regroupées par type dans l'ordre d'apparition : « Valeur × 3 ». */
export function pucesDuTableau(layout: Widget[]): { libelle: string; n: number }[] {
  const comptes = new Map<string, number>();
  for (const w of layout) {
    const p = puceDeCarte(w);
    comptes.set(p, (comptes.get(p) ?? 0) + 1);
  }
  return [...comptes].map(([libelle, n]) => ({ libelle, n }));
}

/**
 * Où la session peut-elle cloner un modèle ? Dans une app NOMMÉE où elle a le droit
 * de créer un tableau (`canCreateDashboard`) — jamais « toutes les apps » : un clone
 * transverse mesurerait une autre population selon son lecteur. Aucune app : pas de
 * bouton (V9), et la raison est écrite à la place.
 */
export function optionsDeClonage(
  user: DashboardPrincipal | null,
  apps: AppItem[],
): { cloner: { apps: { id: string; libelle: string }[] } | null; raison?: string } {
  if (user?.demo) return { cloner: null, raison: "Session de démonstration : lecture seule." };
  const permises = apps.filter((a) => canCreateDashboard(user, a.app_id));
  if (!permises.length) return { cloner: null, raison: "Création réservée aux comptes autorisés sur une app." };
  return { cloner: { apps: permises.map((a) => ({ id: a.app_id, libelle: a.name || a.app_id })) } };
}
