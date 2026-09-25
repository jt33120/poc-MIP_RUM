// LES CHARGEURS DES ÉCRANS D'ADMINISTRATION (C9) — `app/admin/*/page.tsx`.
//
// Des écrans d'ADMINISTRATION (`ECRANS_ADMIN` du contrat) : un administrateur, sans
// portée d'application. Deux familles, les mêmes que les commandes :
//   · ce que gère l'administrateur de la PLATEFORME seul (comptes, santé interne,
//     postes de l'extension) : pour un administrateur d'une liste, `interdit` ;
//   · ce que gère l'administrateur d'une APPLICATION (clients, jetons, domaines,
//     source maps, connecteurs, consommation, audit) : la liste est restreinte à
//     son périmètre — il n'en lit pas plus qu'il n'en administre.
// Hors administrateur (ou en démonstration), le chargeur le dit (`interdit`) ; sans
// session, `sans_session`. La page redirige, comme le faisait `requireAdmin`.
//
// Ce que la page tient de SA requête (l'hôte, pour les URL du SDK et de
// l'ingestion d'un snippet) reste à la page : un chargeur ne lit aucun en-tête.
import { causalActionsHealth, identityPersistenceHealth } from "../health";
import { listApps, registeredApps, type AppItem } from "../queries";
import { getCustomer, listCustomers, probeOnboarding } from "../queries-customers";
import { listInstalls } from "../queries-extension-installs";
import { listExtensionScopes } from "../queries-extension-scope";
import { internalHealth } from "../queries-health";
import { listReadTokens } from "../queries-read-tokens";
import { listSourcemapReleases, releaseManifest, schemaSourcemapAbsent, type ReleaseManifest, type SourcemapRelease } from "../queries-sourcemap";
import { listSourcemapTokens, type SourcemapToken } from "../queries-sourcemap-tokens";
import { listTicketIntegrations, surfaceTicketsOuverte, ticketSchemaDisponible, type TicketIntegration } from "../queries-ticket-integrations";
import { monthlyUsage } from "../queries-usage";
import { q } from "../db";
import { section, type Chargeur, type ParametresEcran, type PrincipalEcran } from "./commun";

/** Qui entre : un administrateur hors démonstration ; `plateforme` s'il n'a pas de liste. */
type Garde = { etat: "sans_session" } | { etat: "interdit" } | { etat: "admin"; plateforme: boolean; dans: (app: string) => boolean };

function garde(principal: PrincipalEcran | null): Garde {
  if (!principal) return { etat: "sans_session" };
  if (principal.role !== "admin" || principal.demo) return { etat: "interdit" };
  const apps = principal.apps;
  return { etat: "admin", plateforme: apps === null, dans: (app) => apps === null || apps.includes(app) };
}

const param = (sp: ParametresEcran, nom: string): string | null => {
  const v = sp[nom];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** Les applications d'un administrateur : toutes, ou celles de sa liste. */
const siennes = (g: Extract<Garde, { etat: "admin" }>, apps: AppItem[]) => apps.filter((a) => g.dans(a.app_id));

// ─── Réservés à l'administrateur de la plateforme ────────────────────────────

/** Les comptes de la console (`/admin/users`). */
export const chargerComptes = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  if (!g.plateforme) return { etat: "interdit" } as const;
  const comptes = await q<{ email: string; role: "admin" | "viewer"; apps: string[] | null; active: boolean; created_at: Date | string; last_login_at: Date | string | null }>(
    `select email, role, apps, active, created_at, last_login_at from console_user order by email`,
  );
  return { etat: "ok", comptes } as const;
}) satisfies Chargeur<unknown>;

/** La santé interne de MIP RUM (`/admin/health`) : ingestion, alertes, métrage. */
export const chargerSante = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  if (!g.plateforme) return { etat: "interdit" } as const;
  // Lecture en échec : les tuiles ne sont PAS rendues à zéro (F02).
  const [sante, identite, causales] = await Promise.all([section(internalHealth), identityPersistenceHealth(), causalActionsHealth()]);
  return { etat: "ok", sante, identite, causales } as const;
}) satisfies Chargeur<unknown>;

/** L'inventaire des postes de l'extension (`/admin/extension-installs`) : un poste observe plusieurs applications. */
export const chargerPostes = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  if (!g.plateforme) return { etat: "interdit" } as const;
  return { etat: "ok", postes: await listInstalls() } as const;
}) satisfies Chargeur<unknown>;

// ─── Restreints au périmètre de l'administrateur ─────────────────────────────

/** Les 100 dernières actions du journal d'audit (`/admin/audit`) : celles de ses applications pour un administrateur d'une liste. */
export const chargerAudit = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  const apps = principal!.apps;
  // `audit_log.app_id` vient de migration-v90 : sans elle, rien ne rattache une ligne à
  // une application — un administrateur d'une liste n'en lit alors aucune.
  const [{ v90 }] = await q<{ v90: boolean }>(
    `select exists(select 1 from information_schema.columns where table_name = 'audit_log' and column_name = 'app_id') as v90`,
  );
  if (apps !== null && !v90) return { etat: "ok", lignes: [], restreint: true } as const;
  const lignes = await q<{ id: number; user_email: string | null; action: string; detail: string | null; ts: Date | string }>(
    `select id, user_email, action, detail, ts from audit_log
      where ${apps === null ? "true" : "app_id = any($1::text[])"}
      order by ts desc, id desc limit 100`,
    apps === null ? [] : [apps],
  );
  return { etat: "ok", lignes, restreint: apps !== null } as const;
}) satisfies Chargeur<unknown>;

/** La consommation du mois par client (`/admin/usage`). */
export const chargerConsommation = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  return { etat: "ok", lignes: (await monthlyUsage()).filter((r) => g.dans(r.app_id)) } as const;
}) satisfies Chargeur<unknown>;

/** Les applications clientes (`/admin/customers`) ; créer n'est proposé qu'à la plateforme. */
export const chargerClients = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  return { etat: "ok", clients: (await listCustomers()).filter((c) => g.dans(c.app_id)), creation: g.plateforme } as const;
}) satisfies Chargeur<unknown>;

/** Une application cliente et son intégration (`/admin/customers/[appId]`) : hors périmètre, introuvable, comme absente. */
export const chargerClient = (async (principal, _sp, chemin) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  const app = chemin.appId ?? "";
  if (!g.dans(app)) return { etat: "introuvable" } as const;
  const client = await getCustomer(app);
  if (!client) return { etat: "introuvable" } as const;
  return { etat: "ok", client, sonde: await probeOnboarding(app) } as const;
}) satisfies Chargeur<unknown>;

/** Les jetons de lecture (`/admin/read-tokens`) et les applications où en créer. */
export const chargerJetonsLecture = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  const [apps, jetons] = await Promise.all([listApps(), listReadTokens()]);
  return { etat: "ok", apps: siennes(g, apps), jetons: jetons.filter((t) => g.dans(t.app_id)) } as const;
}) satisfies Chargeur<unknown>;

/** Les domaines de l'extension (`/admin/extension-scope`) et les applications où en rattacher. */
export const chargerDomaines = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  const [apps, domaines] = await Promise.all([listApps(), listExtensionScopes()]);
  return { etat: "ok", apps: siennes(g, apps), domaines: domaines.filter((d) => g.dans(d.app_id)) } as const;
}) satisfies Chargeur<unknown>;

/**
 * Les source maps d'une application (`/admin/sourcemaps?app=&release=`) : ses
 * releases, le manifeste d'une release, ses jetons de CI — l'application demandée
 * si elle est dans le périmètre, sinon la première du périmètre. Ni contenu de map,
 * ni secret hors création.
 */
export const chargerSourcemaps = (async (principal, sp) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  const demandee = param(sp, "app");
  const release = param(sp, "release");
  let apps: AppItem[];
  try {
    apps = siennes(g, await registeredApps());
  } catch {
    return { etat: "echec", app: demandee } as const;
  }
  const app = apps.find((a) => a.app_id === demandee)?.app_id ?? apps[0]?.app_id ?? null;
  if (!app) {
    return { etat: "ok", apps, app, releases: [] as SourcemapRelease[], manifeste: null as ReleaseManifest | null, jetons: [] as SourcemapToken[] } as const;
  }
  try {
    const [releases, manifeste, jetons] = await Promise.all([
      listSourcemapReleases(app),
      release ? releaseManifest(app, release) : null,
      listSourcemapTokens(app),
    ]);
    return { etat: "ok", apps, app, releases, manifeste, jetons } as const;
  } catch (err) {
    if (schemaSourcemapAbsent(err)) return { etat: "schema", apps, app } as const;
    console.error("[admin/sourcemaps]", err);
    return { etat: "echec", app } as const;
  }
}) satisfies Chargeur<unknown>;

/**
 * Les connecteurs de tickets (`/admin/ticket-integrations`). La surface est FERMÉE
 * tant qu'aucune recette réelle n'a été jouée (ou que `TICKET_INTEGRATIONS` ne
 * l'ouvre pas) : le chargeur le dit (`fermee`), la page rend 404 comme avant.
 */
export const chargerConnecteurs = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  if (!(await surfaceTicketsOuverte())) return { etat: "fermee" } as const;
  const migre = await ticketSchemaDisponible();
  const [apps, connecteurs] = await Promise.all([listApps(), migre ? listTicketIntegrations(null) : Promise.resolve([] as TicketIntegration[])]);
  return { etat: "ok", migre, apps: siennes(g, apps), connecteurs: connecteurs.filter((c) => g.dans(c.app_id)) } as const;
}) satisfies Chargeur<unknown>;
