// LE JOURNAL D'AUDIT, LISIBLE — libellés des actions, familles de filtre et mise
// en forme du détail (`/admin/audit`).
//
// POURQUOI. Le journal affichait les codes bruts (`app.create`,
// `dashboard.clone_template`, `demo_session`, `seed_admin`) et un détail tel
// qu'écrit en base : du JSON (`{"ip":"::1","apps":["demo-app"]}`), des paires
// `clé=valeur`, ou « via /select · mode sdk » (recette du 26/09/2026). Un
// administrateur lit une phrase, pas un code : les codes restent en base — c'est
// leur rôle de clé stable —, et sont traduits ici, à l'affichage seulement.
//
// DEUX GÉNÉRATIONS DE CODES coexistent en base : les anciens en soulignés
// (`app_create`, `dsar_erase`) et ceux des commandes en points (`app.create`,
// `privacy.visitor_erase`). Ils sont ramenés à une même clé (`.` → `_`) avant
// traduction : une ligne de 2025 se lit comme une ligne d'aujourd'hui.
//
// Module pur (aucune lecture) : la page et le chargeur l'importent tous deux.

/** Un code d'action, ramené à sa forme soulignée (`app.create` → `app_create`). */
export function cleAction(action: string): string {
  return action.trim().toLowerCase().replace(/\./g, "_");
}

/** Libellés des actions connues, par clé soulignée. */
const LIBELLES: Record<string, string> = {
  // Connexions
  login: "Connexion",
  auth_login: "Connexion",
  auth_oidc: "Connexion par authentification unique",
  auth_oidc_refused: "Connexion par authentification unique refusée",
  login_failed: "Échec de connexion",
  login_blocked: "Connexion bloquée (trop de tentatives)",
  logout: "Déconnexion",
  auth_logout: "Déconnexion",
  demo_session: "Ouverture d'une démonstration",
  auth_demo: "Ouverture d'une démonstration",
  auth_signup: "Inscription en libre-service",
  demo_refused: "Démonstration refusée",
  demo_user_seeded: "Compte de démonstration préparé",
  seed_admin: "Compte administrateur initialisé",
  // Comptes
  user_create: "Compte créé",
  user_update: "Compte modifié",
  user_set_active: "Compte activé ou désactivé",
  user_reset_password: "Mot de passe réinitialisé",
  // Applications
  app_create: "Application créée",
  app_update: "Application modifiée",
  app_set_active: "Application activée ou désactivée",
  app_rotate_key: "Nouvelle clé d'API générée",
  app_provision_key: "Clé d'API attribuée",
  app_update_origins: "Domaines autorisés modifiés",
  extension_scope_create: "Domaine de l'extension enregistré",
  extension_scope_set_active: "Domaine de l'extension activé ou désactivé",
  extension_scope_toggle: "Domaine de l'extension activé ou désactivé",
  extension_install_forget: "Poste retiré de l'inventaire",
  mobile_capability_verify: "Capacité mobile vérifiée",
  // Jetons et raccordements. « Jeton d'accès » depuis le 30/09/2026 (ex-« jeton de
  // lecture ») : le nom de l'écran ; l'action enregistrée garde sa clé.
  read_token_create: "Jeton d'accès créé",
  read_token_revoke: "Jeton d'accès révoqué",
  sourcemap_token_create: "Jeton de CI créé",
  sourcemap_token_revoke: "Jeton de CI révoqué",
  sourcemap_replace: "Source map remplacée",
  // Tickets : fonctionnalité retirée le 29/09/2026. Les libellés restent pour les
  // lignes que le journal en garde.
  ticket_integration_create: "Connecteur de tickets créé",
  ticket_integration_update: "Connecteur de tickets modifié",
  ticket_integration_patch: "Connecteur de tickets modifié",
  ticket_request: "Ticket demandé",
  issue_request_ticket: "Ticket demandé",
  // Vie privée
  privacy_identity_search: "Recherche RGPD par identité",
  dsar_identity_search: "Recherche RGPD par identité",
  privacy_identity_export: "Export RGPD par identité",
  privacy_identity_erase: "Effacement RGPD par identité",
  dsar_identity_erase: "Effacement RGPD par identité",
  privacy_visitor_export: "Export RGPD d'un visiteur",
  dsar_export: "Export RGPD d'un visiteur",
  privacy_visitor_erase: "Effacement RGPD d'un visiteur",
  dsar_erase: "Effacement RGPD d'un visiteur",
  dsar_erase_refuse: "Effacement RGPD refusé",
  // Alertes, SLO, sondes
  alert_rule_create: "Règle d'alerte créée",
  alert_rule_update: "Règle d'alerte modifiée",
  alert_rule_set_active: "Règle d'alerte activée ou désactivée",
  alert_event_acknowledge: "Déclenchement d'alerte acquitté",
  alert_evaluate: "Évaluation des alertes lancée",
  slo_create: "SLO créé",
  slo_set_active: "SLO activé ou désactivé",
  slo_delete: "SLO supprimé",
  notify_channel_create: "Canal de notification créé",
  notify_channel_set_active: "Canal de notification activé ou désactivé",
  notify_channel_delete: "Canal de notification supprimé",
  uptime_check_create: "Sonde de disponibilité créée",
  uptime_check_set_enabled: "Sonde de disponibilité activée ou désactivée",
  uptime_check_toggle: "Sonde de disponibilité activée ou désactivée",
  uptime_check_delete: "Sonde de disponibilité supprimée",
  // Analyse
  dashboard_create: "Tableau de bord créé",
  dashboard_clone_template: "Tableau de bord créé depuis un modèle",
  dashboard_clone: "Tableau de bord dupliqué",
  dashboard_update: "Tableau de bord modifié",
  dashboard_delete: "Tableau de bord supprimé",
  goal_create: "Objectif de conversion créé",
  goal_update: "Objectif de conversion modifié",
  goal_delete: "Objectif de conversion supprimé",
  issue_triage: "Issue triée",
  error_issue_triage: "Issue triée",
  issue_comment: "Issue commentée",
  error_issue_comment: "Issue commentée",
  issue_link: "Issue liée à un ticket",
  error_issue_link: "Issue liée à un ticket",
  error_set_status: "Statut d'une erreur modifié",
  error_status_set: "Statut d'une erreur modifié",
};

/**
 * Les actions « activer ou désactiver » : le détail dit dans quel sens (`active=`,
 * `enabled=`), le libellé le dit aussi plutôt que « activé ou désactivé ».
 */
const BASCULES: Record<string, readonly [active: string, inactive: string]> = {
  user_set_active: ["Compte réactivé", "Compte désactivé"],
  user_update: ["Compte réactivé", "Compte désactivé"],
  app_set_active: ["Application réactivée", "Application désactivée"],
  extension_scope_set_active: ["Domaine de l'extension réactivé", "Domaine de l'extension désactivé"],
  extension_scope_toggle: ["Domaine de l'extension réactivé", "Domaine de l'extension désactivé"],
  alert_rule_set_active: ["Règle d'alerte activée", "Règle d'alerte désactivée"],
  slo_set_active: ["SLO activé", "SLO désactivé"],
  notify_channel_set_active: ["Canal de notification activé", "Canal de notification désactivé"],
  uptime_check_set_enabled: ["Sonde de disponibilité activée", "Sonde de disponibilité désactivée"],
  uptime_check_toggle: ["Sonde de disponibilité activée", "Sonde de disponibilité désactivée"],
};

/** Les familles du filtre « Type d'action » : clé d'URL, libellé, préfixes de clé. */
export const FAMILLES_AUDIT = [
  { cle: "connexions", libelle: "Connexions", prefixes: ["login", "logout", "auth_", "demo_", "seed_"] },
  { cle: "comptes", libelle: "Comptes", prefixes: ["user_"] },
  { cle: "applications", libelle: "Applications et extension", prefixes: ["app_", "extension_", "mobile_"] },
  { cle: "jetons", libelle: "Jetons et raccordements", prefixes: ["read_token", "sourcemap_", "ticket_integration"] },
  { cle: "vie-privee", libelle: "Vie privée (RGPD)", prefixes: ["privacy_", "dsar_"] },
  { cle: "alertes", libelle: "Alertes, SLO et sondes", prefixes: ["alert_", "slo_", "notify_", "uptime_"] },
  { cle: "analyse", libelle: "Tableaux de bord, objectifs et issues", prefixes: ["dashboard_", "goal_", "issue_", "error_", "ticket_request"] },
] as const;

/** La famille d'une clé d'URL, ou null (« toutes » ou valeur inconnue). */
export function familleAudit(cle: unknown): (typeof FAMILLES_AUDIT)[number] | null {
  return FAMILLES_AUDIT.find((f) => f.cle === cle) ?? null;
}

/**
 * Le motif SQL (`~`) d'une famille, sur la colonne `action` brute : chaque préfixe
 * y est écrit sous ses deux formes (`app_` et `app.`). Construit depuis les
 * constantes ci-dessus, jamais depuis l'URL : la clé d'URL ne fait que choisir une
 * famille existante.
 */
export function motifFamille(f: (typeof FAMILLES_AUDIT)[number]): string {
  const formes = f.prefixes.map((p) => p.replace(/_/g, "[._]"));
  return `^(${formes.join("|")})`;
}

/** Une valeur du détail, telle qu'une cellule l'écrit. */
function valeurLisible(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (Array.isArray(v)) return v.length ? v.map(valeurLisible).join(", ") : "aucune";
  if (typeof v === "object") {
    // Un changement d'état (`{"from":"open","to":"ignored"}`) se lit comme une flèche.
    const o = v as Record<string, unknown>;
    if ("from" in o && "to" in o) return `${valeurLisible(o.from)} → ${valeurLisible(o.to)}`;
    return JSON.stringify(v);
  }
  return String(v);
}

/** Les champs connus du détail, en français ; un champ inconnu garde son nom. */
const CHAMPS: Record<string, string> = {
  ip: "Adresse IP",
  apps: "Applications",
  app: "Application",
  app_id: "Application",
  method: "Méthode",
  provider: "Fournisseur",
  fournisseur: "Fournisseur",
  raison: "Raison",
  id: "Identifiant",
  name: "Nom",
  metric: "Mesure",
  mode: "Mode",
  webhook: "Webhook",
  active: "Actif",
  enabled: "Active",
  avant: "Avant",
  apres: "Après",
  release: "Version",
  filename: "Fichier",
  issue_id: "Issue",
  ticket_id: "Ticket",
  activity_id: "Activité",
  modele: "Modèle",
  source: "Source",
  kind: "Type",
  severity_min: "Gravité minimale",
  objective: "Objectif",
  regles: "Règles",
  slo: "SLO",
  runtime: "Environnement",
  capability: "Capacité",
  role: "Rôle",
  origins: "Domaines",
  sessions_revoquees: "Sessions révoquées",
  rows: "Lignes effacées",
  refus: "Refus",
  visitor_id: "Visiteur",
  validite: "Validité",
  status: "Statut",
};

/** Des valeurs codées, en mots. */
function valeurDeChamp(cle: string, brute: string): string {
  if (cle === "role") return brute === "admin" ? "administrateur" : brute === "viewer" ? "lecture seule" : brute;
  if (cle === "apps" || cle === "origins") return brute === "toutes" ? "toutes" : brute.split("|").filter(Boolean).join(", ") || "aucune";
  if (cle === "app" && brute === "all") return "toutes";
  if (cle === "active" || cle === "enabled") return brute === "true" ? "oui" : brute === "false" ? "non" : brute;
  if (cle === "refus") return brute === "refus_empreinte" ? "ancienne empreinte d'appareil" : brute === "inconnu" ? "identifiant inconnu" : brute;
  if (cle === "mode") return brute === "sdk" ? "SDK" : brute === "extension" ? "extension" : brute;
  if (cle === "method") return brute === "sso" ? "authentification unique" : brute;
  if (cle === "validite") return brute.replace(/^(\d+)j$/, "$1 jours");
  return brute;
}

export interface DetailAudit {
  /** Ce qui reste du texte libre, une fois les champs reconnus retirés. */
  texte: string | null;
  champs: { libelle: string; valeur: string }[];
  /** Valeur d'un champ d'activation lu dans le détail (`active=`, `enabled=`), s'il y en a un. */
  actif: boolean | null;
}

/**
 * Le détail d'une ligne, mis en forme : un objet JSON devient une liste de
 * champs ; un texte perd ses `clé=valeur` (rangés en champs) et son « via
 * /select » (chemin interne de l'ajout de site).
 */
export function detailAudit(detail: string | null | undefined): DetailAudit {
  const brut = (detail ?? "").trim();
  if (!brut) return { texte: null, champs: [], actif: null };
  let actif: boolean | null = null;
  const lire = (cle: string, valeur: string) => {
    if ((cle === "active" || cle === "enabled") && (valeur === "true" || valeur === "false")) actif = valeur === "true";
  };

  if (brut.startsWith("{")) {
    try {
      const objet = JSON.parse(brut) as Record<string, unknown>;
      if (objet && typeof objet === "object" && !Array.isArray(objet)) {
        const champs = Object.entries(objet).map(([cle, v]) => {
          if (typeof v === "boolean") lire(cle, String(v));
          const valeur = typeof v === "string" ? valeurDeChamp(cle, v) : valeurLisible(v);
          return { libelle: CHAMPS[cle] ?? cle, valeur };
        });
        return { texte: null, champs, actif };
      }
    } catch {
      /* pas du JSON : lu comme un texte */
    }
  }

  const champs: DetailAudit["champs"] = [];
  const texte = brut
    // L'ajout de site passe par `/select` : un chemin interne, pas une information.
    .replace(/\s*via \/select\b/g, " — ajout de site")
    .replace(/\s*·\s*mode (\w+)/g, (_m, mode: string) => {
      champs.push({ libelle: "Mode", valeur: valeurDeChamp("mode", mode) });
      return "";
    })
    .replace(/\s*·\s*domaine (\S+)/g, (_m, domaine: string) => {
      champs.push({ libelle: "Domaine", valeur: domaine });
      return "";
    })
    .replace(/(?:^|\s)([a-z_]+)=(\S+)/g, (_m, cle: string, valeur: string) => {
      lire(cle, valeur);
      champs.push({ libelle: CHAMPS[cle] ?? cle, valeur: valeurDeChamp(cle, valeur) });
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { texte: texte || null, champs, actif };
}

/**
 * Le libellé d'une action. Un code que ce module ne connaît pas garde sa forme,
 * lisible (`isolation.test` → « isolation test ») : mieux vaut un mot technique
 * qu'une ligne muette dans un journal d'audit.
 */
export function libelleAction(action: string, actif: boolean | null = null): string {
  const cle = cleAction(action);
  const bascule = BASCULES[cle];
  if (bascule && actif !== null) return actif ? bascule[0] : bascule[1];
  return LIBELLES[cle] ?? action.replace(/[._]+/g, " ").trim();
}

/** L'action est-elle connue de ce module ? (les tests vérifient que toutes les règles le sont) */
export function actionConnue(action: string): boolean {
  return cleAction(action) in LIBELLES;
}
