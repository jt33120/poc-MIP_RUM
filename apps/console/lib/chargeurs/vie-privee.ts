// LE CHARGEUR DES DEMANDES RGPD (C10) — `app/admin/privacy/page.tsx`.
//
// Un écran d'ADMINISTRATION : ce que couvrirait une demande (accès ou effacement)
// AVANT qu'on agisse — les lignes par table d'une identité métier (par son HMAC,
// déjà calculé par la commande de recherche) ou d'un identifiant de visiteur,
// l'état réel de la protection durable de l'application, et si la recherche par
// identité est possible (clé de hachage, schéma).
//
// Le périmètre est celui des commandes (`lib/commandes/vie-privee.ts`) : les
// applications de l'administrateur, et « toutes » pour un visiteur à la plateforme
// seule. Une application demandée hors du périmètre n'est pas lue : l'écran
// retombe sur la première du périmètre.
import { isDsarIdentityHash, type DsarIdentityKind } from "../dsar";
import { identityPersistenceHealth } from "../health";
import { listApps } from "../queries";
import { dsarCible, dsarCounts, dsarIdentityCounts, etatBarriere } from "../queries-dsar";
import type { Chargeur } from "./commun";

export const chargerViePrivee = (async (principal, sp) => {
  if (!principal) return { etat: "sans_session" } as const;
  if (principal.role !== "admin" || principal.demo) return { etat: "interdit" } as const;
  const plateforme = principal.apps === null;
  const dans = (a: string) => plateforme || principal.apps!.includes(a);
  const apps = (await listApps()).filter((a) => dans(a.app_id));
  const texte = (nom: string) => (typeof sp[nom] === "string" ? (sp[nom] as string).trim() : "");

  const demandee = texte("app");
  const app = demandee && apps.some((a) => a.app_id === demandee) ? demandee : (apps[0]?.app_id ?? "");
  const kind: DsarIdentityKind = sp.kind === "account" ? "account" : "user";
  const identityHash = isDsarIdentityHash(sp.identity_hash) ? sp.identity_hash : "";

  const visitorId = texte("user");
  const voulue = texte("visitor_app") || (visitorId && demandee ? demandee : "all");
  // « Toutes » : la plateforme seule ; une application hors du périmètre n'est pas lue.
  const visitorApp = voulue === "all" ? (plateforme ? "all" : app) : dans(voulue) ? voulue : app;

  const [sante, protection] = await Promise.all([identityPersistenceHealth(), etatBarriere(app)]);
  const identite = app && identityHash && sante.schema ? await dsarIdentityCounts(app, kind, identityHash) : null;
  const cible = visitorId && visitorApp ? await dsarCible(visitorApp, visitorId) : null;
  const visiteur = cible?.verdict === "execute" ? await dsarCounts(visitorApp, visitorId) : null;
  return {
    etat: "ok",
    apps,
    app,
    kind,
    identityHash,
    visitorId,
    visitorApp,
    toutes: plateforme,
    sante,
    protection,
    identite,
    cible,
    visiteur,
  } as const;
}) satisfies Chargeur<unknown>;
