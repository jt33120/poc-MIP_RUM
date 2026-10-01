// LES CHARGEURS DES ÉCRANS D'ADMINISTRATION (C9) — `app/admin/*/page.tsx`.
//
// Des écrans d'ADMINISTRATION (`ECRANS_ADMIN` du contrat) : un administrateur, sans
// portée d'application. Deux familles, les mêmes que les commandes :
//   · ce que gère l'administrateur de la PLATEFORME seul (comptes, santé interne,
//     postes de l'extension) : pour un administrateur d'une liste, `interdit` ;
//   · ce que gère l'administrateur d'une APPLICATION (clients, jetons, domaines,
//     source maps, consommation, audit) : la liste est restreinte à
//     son périmètre — il n'en lit pas plus qu'il n'en administre.
// Hors administrateur (ou en démonstration), le chargeur le dit (`interdit`) ; sans
// session, `sans_session`. La page redirige, comme le faisait `requireAdmin`.
//
// Ce que la page tient de SA requête (l'hôte, pour les URL du SDK et de
// l'ingestion d'un snippet) reste à la page : un chargeur ne lit aucun en-tête.
import { familleAudit, motifFamille } from "../audit-libelles";
import { causalActionsHealth, identityPersistenceHealth } from "../health";
import { listApps, registeredApps, type AppItem } from "../queries";
import { getCustomer, listCustomers, probeOnboarding } from "../queries-customers";
import { listInstalls } from "../queries-extension-installs";
import { listExtensionScopes } from "../queries-extension-scope";
import { lireSanteChaine } from "../queries-chaine";
import { internalHealth } from "../queries-health";
import { cadenceTickPubliee } from "../queries-planifie";
import { echeanceLectureDisponible, listReadTokens } from "../queries-read-tokens";
import { listSourcemapReleases, releaseManifest, releasesDeployees, schemaSourcemapAbsent, type ReleaseManifest, type SourcemapRelease } from "../queries-sourcemap";
import { listSourcemapTokens, type SourcemapToken } from "../queries-sourcemap-tokens";
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

/**
 * Les comptes de la console (`/admin/users`), et les applications actives parmi
 * lesquelles en limiter un : la liste des applications autorisées se choisit
 * (recette du 26/09/2026) — un champ libre créait, sur une faute de frappe, un
 * compte sans aucun accès.
 */
export const chargerComptes = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  if (!g.plateforme) return { etat: "interdit" } as const;
  const [comptes, apps] = await Promise.all([
    q<{ email: string; role: "admin" | "viewer"; apps: string[] | null; active: boolean; created_at: Date | string; last_login_at: Date | string | null }>(
      `select email, role, apps, active, created_at, last_login_at from console_user order by email`,
    ),
    registeredApps(),
  ]);
  return { etat: "ok", comptes, apps } as const;
}) satisfies Chargeur<unknown>;

/** La santé interne de MIP RUM (`/admin/health`) : ingestion, alertes, métrage. */
export const chargerSante = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  if (!g.plateforme) return { etat: "interdit" } as const;
  // Lecture en échec : les tuiles ne sont PAS rendues à zéro (F02). La chaîne de
  // mesure (canari, registre des fenêtres) est une section à part : son échec ne
  // cache pas le reste de la page.
  const [sante, identite, causales, chaine] = await Promise.all([
    section(internalHealth),
    identityPersistenceHealth(),
    causalActionsHealth(),
    section(async () => {
      const [brute, cadenceMin] = await Promise.all([lireSanteChaine(), cadenceTickPubliee()]);
      return { brute, cadenceMin };
    }),
  ]);
  return { etat: "ok", sante, identite, causales, chaine } as const;
}) satisfies Chargeur<unknown>;

/** L'inventaire des postes de l'extension (`/admin/extension-installs`) : un poste observe plusieurs applications. */
export const chargerPostes = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  if (!g.plateforme) return { etat: "interdit" } as const;
  return { etat: "ok", postes: await listInstalls() } as const;
}) satisfies Chargeur<unknown>;

// ─── Restreints au périmètre de l'administrateur ─────────────────────────────

/**
 * Les 100 dernières actions du journal d'audit (`/admin/audit?type=&user=`) : celles
 * de ses applications pour un administrateur d'une liste. Deux filtres simples
 * (recette du 26/09/2026) : une famille d'actions (`lib/audit-libelles.ts`, motif
 * construit depuis ses constantes, jamais depuis l'URL) et un utilisateur, choisi
 * parmi ceux que le journal connaît sur ce périmètre.
 */
export const chargerAudit = (async (principal, sp) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  const apps = principal!.apps;
  const famille = familleAudit(param(sp, "type"));
  const utilisateur = param(sp, "user");
  const filtres = { type: famille?.cle ?? null, user: utilisateur };
  // `audit_log.app_id` vient de migration-v90 : sans elle, rien ne rattache une ligne à
  // une application — un administrateur d'une liste n'en lit alors aucune.
  const [{ v90 }] = await q<{ v90: boolean }>(
    `select exists(select 1 from information_schema.columns where table_name = 'audit_log' and column_name = 'app_id') as v90`,
  );
  if (apps !== null && !v90) return { etat: "ok", lignes: [], restreint: true, utilisateurs: [] as string[], filtres } as const;
  const valeurs: unknown[] = [];
  const conditions: string[] = [];
  if (apps !== null) {
    valeurs.push(apps);
    conditions.push(`app_id = any($${valeurs.length}::text[])`);
  }
  // La liste des utilisateurs est lue AVANT les deux filtres : elle doit proposer
  // tous ceux du périmètre, pas seulement ceux de la sélection courante.
  const perimetre = conditions.length ? conditions.join(" and ") : "true";
  const valeursPerimetre = [...valeurs];
  if (famille) {
    valeurs.push(motifFamille(famille));
    conditions.push(`action ~ $${valeurs.length}`);
  }
  if (utilisateur) {
    valeurs.push(utilisateur);
    conditions.push(`user_email = $${valeurs.length}`);
  }
  const [lignes, utilisateurs] = await Promise.all([
    q<{ id: number; user_email: string | null; action: string; detail: string | null; ts: Date | string }>(
      `select id, user_email, action, detail, ts from audit_log
        where ${conditions.length ? conditions.join(" and ") : "true"}
        order by ts desc, id desc limit 100`,
      valeurs,
    ),
    q<{ email: string }>(
      `select distinct user_email as email from audit_log
        where user_email is not null and ${perimetre}
        order by 1 limit 200`,
      valeursPerimetre,
    ),
  ]);
  return { etat: "ok", lignes, restreint: apps !== null, utilisateurs: utilisateurs.map((u) => u.email), filtres } as const;
}) satisfies Chargeur<unknown>;

/** La consommation du mois par client (`/admin/usage`). */
export const chargerConsommation = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  const conso = await monthlyUsage();
  return { etat: "ok", lignes: conso.lignes.filter((r) => g.dans(r.app_id)), comptage: conso.comptage } as const;
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

/**
 * Les jetons d'accès (`/admin/read-tokens`), les applications où en créer, et
 * si la base porte leur échéance : l'écran ne propose une durée de validité que si
 * elle sera tenue.
 */
export const chargerJetonsLecture = (async (principal) => {
  const g = garde(principal);
  if (g.etat !== "admin") return g;
  const [apps, jetons, echeance] = await Promise.all([listApps(), listReadTokens(), echeanceLectureDisponible()]);
  return { etat: "ok", apps: siennes(g, apps), jetons: jetons.filter((t) => g.dans(t.app_id)), echeance } as const;
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
    return { etat: "ok", apps, app, releases: [] as SourcemapRelease[], manifeste: null as ReleaseManifest | null, jetons: [] as SourcemapToken[], deployees: [] as string[] } as const;
  }
  try {
    const [releases, manifeste, jetons, deployees] = await Promise.all([
      listSourcemapReleases(app),
      release ? releaseManifest(app, release) : null,
      listSourcemapTokens(app),
      // Une suggestion : sa lecture en échec ne prive pas l'écran du reste.
      releasesDeployees(app).catch(() => [] as string[]),
    ]);
    return { etat: "ok", apps, app, releases, manifeste, jetons, deployees } as const;
  } catch (err) {
    if (schemaSourcemapAbsent(err)) return { etat: "schema", apps, app } as const;
    console.error("[admin/sourcemaps]", err);
    return { etat: "echec", app } as const;
  }
}) satisfies Chargeur<unknown>;

