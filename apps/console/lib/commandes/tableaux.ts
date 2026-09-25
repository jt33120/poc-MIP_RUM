// LES TABLEAUX DE BORD (C6) — `app/dashboards/actions.ts`, les écrans `/dashboards`.
//
// Les droits d'un tableau ne tiennent pas dans une portée d'application : un
// tableau transverse (`app_id` nul) n'appartient à aucune, un viewer écrit les
// siens, un administrateur ceux de son périmètre. La règle de ces commandes est
// donc `session` + portée `globale`, et chaque commande résout le tableau et ses
// droits par LA porte unique des tableaux (`lib/dashboard-access.ts`) — celle de
// l'écran, de l'export et de l'API. Une commande refusée n'écrit rien et le dit
// (`interdit`), sans dire si le tableau existe ailleurs.
//
// RÉVISION CITÉE. Toute écriture d'un tableau existant porte la révision que
// l'écran affichait (le `If-Match` de ce contrat) : dépassée, l'écriture est
// refusée (`conflit`) au lieu d'effacer le travail d'un autre onglet.
//
// AUDIT. Ce qui change la PORTÉE d'un tableau s'inscrit au journal, dans la
// transaction de l'écriture : création, clonage, renommage ou déplacement d'app,
// suppression. L'édition de ses cartes (ajouter, retirer, ranger, régler) en est
// exemptée — des gestes fréquents, sans effet sur qui lit quoi.
import { chaine, facultatif, libre, nulle, objet, parmi, MOTIF_APP } from "@mip/console-contract";
import {
  canCreateDashboard,
  dashboardPrincipal,
  getWritableDashboard,
  type DashboardAction,
  type DashboardPrincipal,
} from "../dashboard-access";
import { cartesDuModele, modeleTableau } from "../dashboard-templates";
import {
  WIDGET_META,
  WIDGET_TYPES,
  WIDGET_VITALS,
  defaultTitle,
  layoutPlein,
  normalizeLayout,
  parseRangeOverride,
  sectionDuFormulaire,
  type AnalyticsWidget,
  type Widget,
  type WidgetType,
} from "../dashboards";
import { tx } from "../db";
import { parseSegmentParam } from "../query-contract";
import {
  deleteDashboard,
  insertDashboard,
  updateDashboardMeta,
  updateLayout,
  type DashboardRow,
  type DashboardWrite,
} from "../queries-dashboards";
import { forgetWidgetCache } from "../widget-data";
import { commande, MOTIF_ENTIER, MOTIF_REVISION, type PrincipalCommande } from "./commun";

const EDITION = {
  exempt: "édition des cartes d'un tableau (ajouter, retirer, ranger, régler) : gestes fréquents, sans effet sur qui lit quoi ; la révision du tableau refuse toute écriture fondée sur une lecture dépassée",
} as const;

const NOM = chaine({ max: 200 });
const APP = chaine({ max: 128, motif: MOTIF_APP, description: "identifiant d'application" });
const REVISION = chaine({ max: 19, motif: MOTIF_REVISION, description: "révision entière" });
const CHEMIN_ID = objet({ id: chaine({ max: 18, motif: MOTIF_ENTIER, description: "identifiant entier" }) });
const CHEMIN_CARTE = objet({
  id: chaine({ max: 18, motif: MOTIF_ENTIER, description: "identifiant entier" }),
  index: chaine({ max: 3, motif: /^(0|[1-9][0-9]{0,2})$/, description: "position entière" }),
});
/** Un nom d'événement : 100 caractères au plus, sans caractère de contrôle. */
const CONTROLE = /[\u0000-\u001f\u007f]/;

/** Ce qu'une écriture d'un tableau existant peut décider. */
type Decision =
  | { readonly etat: "ok"; readonly revision: string }
  | { readonly etat: "conflit" | "introuvable" | "interdit" | "plein" | "refus" | "section_refusee" | "invalide" };

async function principalDuTableau(p: PrincipalCommande): Promise<DashboardPrincipal | null> {
  return dashboardPrincipal({ email: p.email, role: p.role, apps: p.apps, ...(p.demo ? { demo: true } : {}) });
}

/** Le tableau `id`, si le principal a le droit d'y faire `action` ; `null` sinon (absent OU interdit : indiscernables). */
async function tableauPermis(p: PrincipalCommande, id: string, action: DashboardAction): Promise<DashboardRow | null> {
  return getWritableDashboard(Number(id), await principalDuTableau(p), action);
}

/** Une écriture de disposition : son verdict, et le cache des cartes oublié quand elle a changé quelque chose. */
function suite(write: DashboardWrite): Decision {
  if (write.kind === "conflict") return { etat: "conflit" };
  if (write.kind === "not_found") return { etat: "introuvable" };
  // La donnée d'une carte vient d'un cache court : après une écriture, elle a changé.
  forgetWidgetCache();
  return { etat: "ok", revision: write.revision };
}

const detail = (d: Record<string, unknown>) => JSON.stringify(d);

// ─── Portée d'un tableau : auditées ──────────────────────────────────────────

export const creerTableau = commande(
  {
    regle: { auth: "session", portee: "globale", audit: "dashboard.create" },
    corps: objet({ name: NOM, app_id: nulle(APP) }),
  },
  async ({ principal, corps, auditer }) => {
    const dp = await principalDuTableau(principal);
    // Un viewer ne crée que dans une app de son scope — jamais en transverse.
    if (!canCreateDashboard(dp, corps.app_id)) return { etat: "refus" } as const;
    const id = await tx(async (c) => {
      const cree = await insertDashboard({ name: corps.name, app_id: corps.app_id, created_by: dp?.email ?? null, owner_id: dp?.accountId ?? null }, c);
      await auditer(c, detail({ id: cree, name: corps.name }), corps.app_id);
      return cree;
    });
    return { etat: "cree", id } as const;
  },
);

/**
 * Clone d'un MODÈLE fourni (F35, W-D1) : un nouveau tableau « <Modèle> — copie »,
 * dont le cloneur est propriétaire, dans une app NOMMÉE où il a le droit de créer
 * — jamais « toutes les apps ». Les cartes viennent du modèle, jamais de l'appel.
 */
export const clonerModele = commande(
  {
    regle: { auth: "session", portee: "globale", audit: "dashboard.clone_template" },
    chemin: objet({ modele: chaine({ max: 40, motif: /^[a-z][a-z0-9-]{0,39}$/, description: "clé de modèle" }) }),
    corps: objet({ app_id: APP }),
  },
  async ({ principal, chemin, corps, auditer }) => {
    const modele = modeleTableau(chemin.modele);
    if (!modele) return { etat: "modele_inconnu" } as const;
    const dp = await principalDuTableau(principal);
    if (!canCreateDashboard(dp, corps.app_id)) return { etat: "refus" } as const;
    const id = await tx(async (c) => {
      const cree = await insertDashboard(
        {
          name: `${modele.titre} — copie`,
          app_id: corps.app_id,
          created_by: dp?.email ?? null,
          owner_id: dp?.accountId ?? null,
          layout: cartesDuModele(modele),
        },
        c,
      );
      await auditer(c, detail({ id: cree, modele: modele.cle }), corps.app_id);
      return cree;
    });
    return { etat: "cree", id, app: corps.app_id } as const;
  },
);

/**
 * Clone : un NOUVEL identifiant, le cloneur pour propriétaire, la MÊME app — celle
 * sur laquelle ses droits ont été vérifiés. Cloner vers une autre app contournerait
 * le périmètre ; les cartes, elles, sont recopiées telles quelles.
 */
export const clonerTableau = commande(
  {
    regle: { auth: "session", portee: "globale", audit: "dashboard.clone" },
    chemin: CHEMIN_ID,
  },
  async ({ principal, chemin, auditer }) => {
    const source = await tableauPermis(principal, chemin.id, "clone");
    if (!source) return { etat: "interdit" } as const;
    const dp = await principalDuTableau(principal);
    const id = await tx(async (c) => {
      const cree = await insertDashboard(
        {
          name: `${source.name} (copie)`.slice(0, 120),
          app_id: source.app_id,
          created_by: dp?.email ?? null,
          owner_id: dp?.accountId ?? null,
          layout: source.layout,
        },
        c,
      );
      await auditer(c, detail({ id: cree, source: source.id }), source.app_id);
      return cree;
    });
    return { etat: "cree", id } as const;
  },
);

/** Renommer, et déplacer vers une autre app — ce qui exige le droit de CRÉER dans l'app visée. */
export const modifierTableau = commande(
  {
    regle: { auth: "session", portee: "globale", audit: "dashboard.update" },
    chemin: CHEMIN_ID,
    corps: objet({ name: NOM, app_id: nulle(APP), revision: REVISION }),
  },
  async ({ principal, chemin, corps, auditer }): Promise<Decision> => {
    const dash = await tableauPermis(principal, chemin.id, "rename");
    if (!dash) return { etat: "interdit" };
    // Déplacer un tableau vers une autre app est un geste distinct du renommage :
    // il exige le droit de CRÉER dans l'app visée, pas seulement d'écrire ici.
    if (corps.app_id !== dash.app_id && !canCreateDashboard(await principalDuTableau(principal), corps.app_id)) return { etat: "interdit" };
    return suite(
      await updateDashboardMeta(dash.id, corps.name, corps.app_id, corps.revision, (c) =>
        auditer(c, detail({ id: dash.id, name: corps.name, app_id: corps.app_id, avant: dash.app_id }), dash.app_id),
      ),
    );
  },
);

export const supprimerTableau = commande(
  {
    regle: { auth: "session", portee: "globale", audit: "dashboard.delete" },
    chemin: CHEMIN_ID,
  },
  async ({ principal, chemin, auditer }) => {
    const dash = await tableauPermis(principal, chemin.id, "delete");
    if (!dash) return { etat: "interdit" } as const;
    await tx(async (c) => {
      await deleteDashboard(dash.id, c);
      await auditer(c, detail({ id: dash.id, name: dash.name }), dash.app_id);
    });
    forgetWidgetCache();
    return { etat: "ok" } as const;
  },
);

// ─── Cartes d'un tableau : exemptées d'audit ─────────────────────────────────

export const ajouterCarte = commande(
  {
    regle: { auth: "session", portee: "globale", audit: EDITION },
    chemin: CHEMIN_ID,
    corps: objet({
      type: parmi(WIDGET_TYPES),
      metric: facultatif(chaine({ max: 16 })),
      event_name: facultatif(chaine({ max: 100 })),
      revision: REVISION,
    }),
  },
  async ({ principal, chemin, corps }): Promise<Decision> => {
    const type = corps.type as WidgetType;
    // La valeur d'une carte se vérifie AVANT ses droits : une valeur inapplicable n'est jamais écrite.
    let metric: string | undefined;
    if (WIDGET_META[type].needsMetric) {
      if (!corps.metric || !(WIDGET_VITALS as readonly string[]).includes(corps.metric)) return { etat: "refus" };
      metric = corps.metric;
    }
    let eventName: string | undefined;
    if (WIDGET_META[type].needsEventName) {
      const nom = corps.event_name?.trim() ?? "";
      if (!nom || nom.length > 100 || CONTROLE.test(nom)) return { etat: "refus" };
      eventName = nom;
    }
    const dash = await tableauPermis(principal, chemin.id, "add_widget");
    if (!dash) return { etat: "interdit" };
    // F37 — 24 éléments, sections comprises : la 25e carte est refusée, et le refus est dit.
    if (layoutPlein(dash.layout)) return { etat: "plein" };
    const widget: Widget = {
      kind: "v1",
      type,
      title: defaultTitle(type, metric, eventName),
      ...(metric ? { metric } : {}),
      ...(eventName ? { eventName } : {}),
    };
    return suite(await updateLayout(dash.id, [...dash.layout, widget], corps.revision));
  },
);

/**
 * Un titre de section (F37, W-B12) : un ÉLÉMENT du layout, donc le même geste que
 * l'ajout d'une carte (`add_widget`) et la même garde. Position : de 0 (avant le
 * premier élément) à la longueur (en fin) ; absente, en fin ; toute autre valeur
 * est refusée — on ne devine pas où l'utilisateur voulait la poser.
 */
export const ajouterSection = commande(
  {
    regle: { auth: "session", portee: "globale", audit: EDITION },
    chemin: CHEMIN_ID,
    corps: objet({
      title: chaine({ min: 0, max: 200 }),
      question: facultatif(chaine({ max: 500 })),
      position: facultatif(chaine({ max: 16 })),
      revision: REVISION,
    }),
  },
  async ({ principal, chemin, corps }): Promise<Decision> => {
    const dash = await tableauPermis(principal, chemin.id, "add_widget");
    if (!dash) return { etat: "interdit" };
    const section = sectionDuFormulaire(corps.title, corps.question ?? null);
    const brut = corps.position?.trim() ?? "";
    const position = brut === "" ? dash.layout.length : /^[0-9]{1,3}$/.test(brut) ? Number(brut) : Number.NaN;
    if (!section.ok || !(position <= dash.layout.length)) return { etat: "section_refusee" };
    if (layoutPlein(dash.layout)) return { etat: "plein" };
    const layout: Widget[] = [...dash.layout.slice(0, position), section.value, ...dash.layout.slice(position)];
    return suite(await updateLayout(dash.id, layout, corps.revision));
  },
);

/**
 * Une analyse de l'Explorer enregistrée comme carte. La configuration reçue
 * retraverse l'adaptateur de lecture (la validation du jsonb stocké) : illisible,
 * rien n'est écrit. « Figer » (`fenetre: "freeze"`) fait de la fenêtre COURANTE de
 * l'écran la fenêtre propre de la carte ; invalide, elle est refusée, jamais
 * rabattue sur une autre.
 */
export const enregistrerAnalyse = commande(
  {
    regle: { auth: "session", portee: "globale", audit: EDITION },
    chemin: CHEMIN_ID,
    corps: objet({
      widget: libre({ octetsMax: 64 * 1024 }),
      title: facultatif(chaine({ max: 200 })),
      fenetre: facultatif(parmi(["freeze"] as const)),
      range_override: facultatif(libre({ octetsMax: 1024 })),
      revision: REVISION,
    }),
  },
  async ({ principal, chemin, corps }): Promise<Decision> => {
    const [widget] = normalizeLayout([corps.widget]);
    if (!widget || widget.kind !== "v2") return { etat: "invalide" };
    const dash = await tableauPermis(principal, chemin.id, "add_widget");
    if (!dash) return { etat: "interdit" };
    // F37 — même garde que l'ajout d'une carte : un tableau de 24 éléments refuse, et le dit.
    if (layoutPlein(dash.layout)) return { etat: "plein" };
    let rangeOverride = widget.rangeOverride;
    if (corps.fenetre === "freeze") {
      const fenetre = parseRangeOverride(corps.range_override ?? null);
      if (!fenetre.ok) return { etat: "invalide" };
      rangeOverride = fenetre.value;
    }
    const titre = corps.title?.trim() ?? "";
    const carte: AnalyticsWidget = { ...widget, ...(titre ? { title: titre.slice(0, 60) } : {}), rangeOverride };
    return suite(await updateLayout(dash.id, [...dash.layout, carte], corps.revision));
  },
);

/**
 * Filtres et fenêtre propres d'une carte analytique. Les filtres s'AJOUTENT à ceux
 * de l'écran, dans la syntaxe du paramètre `seg` des URL ; « keep » garde la
 * fenêtre FIGÉE déjà enregistrée, qu'une liste de presets ne sait pas représenter.
 */
export const configurerCarte = commande(
  {
    regle: { auth: "session", portee: "globale", audit: EDITION },
    chemin: CHEMIN_CARTE,
    corps: objet({ filters: chaine({ min: 0, max: 2048 }), range_preset: chaine({ min: 0, max: 32 }), revision: REVISION }),
  },
  async ({ principal, chemin, corps }): Promise<Decision> => {
    const dash = await tableauPermis(principal, chemin.id, "configure_widget");
    if (!dash) return { etat: "interdit" };
    const index = Number(chemin.index);
    const cible = dash.layout[index];
    if (!cible || cible.kind !== "v2") return { etat: "invalide" };
    const segments = parseSegmentParam(corps.filters.trim() || null);
    if (!segments.ok) return { etat: "refus" };
    const preset = corps.range_preset.trim();
    const fenetre = preset === "keep" ? { ok: true as const, value: cible.rangeOverride } : parseRangeOverride(preset ? { preset } : null);
    if (!fenetre.ok) return { etat: "refus" };
    const layout = [...dash.layout];
    layout[index] = { ...cible, filters: segments.value, rangeOverride: fenetre.value };
    return suite(await updateLayout(dash.id, layout, corps.revision));
  },
);

export const retirerCarte = commande(
  {
    regle: { auth: "session", portee: "globale", audit: EDITION },
    chemin: CHEMIN_CARTE,
    corps: objet({ revision: REVISION }),
  },
  async ({ principal, chemin, corps }): Promise<Decision> => {
    const dash = await tableauPermis(principal, chemin.id, "remove_widget");
    if (!dash) return { etat: "interdit" };
    const index = Number(chemin.index);
    if (index >= dash.layout.length) return { etat: "invalide" };
    return suite(await updateLayout(dash.id, dash.layout.filter((_, i) => i !== index), corps.revision));
  },
);

export const deplacerCarte = commande(
  {
    regle: { auth: "session", portee: "globale", audit: EDITION },
    chemin: CHEMIN_CARTE,
    corps: objet({ dir: parmi(["up", "down"] as const), revision: REVISION }),
  },
  async ({ principal, chemin, corps }): Promise<Decision> => {
    const dash = await tableauPermis(principal, chemin.id, "reorder_widget");
    if (!dash) return { etat: "interdit" };
    const index = Number(chemin.index);
    const cible = corps.dir === "up" ? index - 1 : index + 1;
    if (index >= dash.layout.length || cible < 0 || cible >= dash.layout.length) return { etat: "invalide" };
    const layout = [...dash.layout];
    [layout[index], layout[cible]] = [layout[cible], layout[index]];
    return suite(await updateLayout(dash.id, layout, corps.revision));
  },
);
