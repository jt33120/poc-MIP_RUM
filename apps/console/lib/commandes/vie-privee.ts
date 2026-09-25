// LE RGPD (C10) — les droits d'une personne sur ce qui a été collecté d'elle :
// accès et portabilité (l'export), effacement. Deux façons de la désigner :
//
//   · son IDENTITÉ MÉTIER (utilisateur ou compte), qui n'existe en base que sous
//     un HMAC cloisonné par application. La valeur brute n'entre que dans le
//     CORPS d'une recherche ou d'une confirmation, n'est hachée qu'ici et n'en
//     ressort jamais — ni dans une URL, ni dans l'audit, ni dans une décision.
//     Portée `app` : la même valeur dans une autre application est une autre
//     personne. La clé de hachage est celle du processus qui exécute : la console
//     aujourd'hui, console-api à la bascule (et `IDENTITY_HASH_SECRET` quitte
//     alors Vercel) ;
//   · son identifiant de VISITEUR (historique) : une application, ou toutes. Ce
//     « toutes » est à l'administrateur de la PLATEFORME : pour un administrateur
//     d'une liste, il couvrirait des applications hors de son périmètre.
//
// Chaque demande laisse sa ligne au journal, REFUS COMPRIS : une demande à
// laquelle on n'a pas donné suite doit se prouver. L'audit d'un effacement entre
// dans SA transaction (il n'existe que si l'effacement a eu lieu) ; celui d'un
// refus s'écrit seul, rien d'autre ne s'écrivant. L'export est une lecture, mais
// une commande : divulguer un document de données personnelles s'inscrit au
// journal comme une écriture, et la démonstration ne le fait pas.
import { chaine, MOTIF_APP, objet, parmi } from "@mip/console-contract";
import { hashIdentity } from "@mip/backend/lib/identity-hash.mjs";
import { tx } from "../db";
import { DsarRefus, dsarExportFilename, type DsarIdentityKind } from "../dsar";
import { dsarErase, dsarExport, dsarIdentityErase, dsarIdentityExport } from "../queries-dsar";
import { commande, type PrincipalCommande } from "./commun";

const TYPE = parmi(["user", "account"] as const);
const HMAC = chaine({ max: 64, motif: /^[0-9a-f]{64}$/, description: "HMAC d'identité (64 caractères hexadécimaux)" });
/** Une identité brute : lue une fois, hachée, oubliée. */
const BRUTE = chaine({ min: 0, max: 512 });
const VISITEUR = chaine({ min: 0, max: 200 });
/** Une application, ou `all` (toutes : la plateforme seule). */
const APP_OU_TOUTES = chaine({ max: 128 });

const secret = () => process.env.IDENTITY_HASH_SECRET;
const empreinte = (app: string, kind: DsarIdentityKind, hash: string) => `kind=${kind} app=${app} hash_prefix=${hash.slice(0, 12)}`;
const lignes = (supprime: { deleted: number }[]) => supprime.reduce((n, d) => n + d.deleted, 0);

/** Le périmètre d'une demande par visiteur : `all` à la plateforme, une application à qui l'administre. */
function horsPerimetre(principal: PrincipalCommande, app: string): { etat: "interdit" } | { etat: "invalide" } | null {
  if (app === "all") return principal.apps === null ? null : { etat: "interdit" };
  if (!MOTIF_APP.test(app)) return { etat: "invalide" };
  return principal.apps === null || principal.apps.includes(app) ? null : { etat: "interdit" };
}

// ─── Identité métier ─────────────────────────────────────────────────────────

/** Hache une identité saisie : la décision ne porte que son HMAC, que l'écran utilise ensuite. */
export const rechercherIdentite = commande(
  { regle: { auth: "admin", portee: "app", audit: "privacy.identity_search" }, corps: objet({ kind: TYPE, identity: BRUTE }) },
  async ({ app, corps, auditer }) => {
    const brute = corps.identity.trim();
    if (!brute) return { etat: "vide" } as const;
    const hash = hashIdentity(secret(), app!, corps.kind, brute);
    if (!hash) return { etat: "indisponible" } as const;
    await tx((c) => auditer(c, empreinte(app!, corps.kind, hash)));
    return { etat: "ok", hash } as const;
  },
);

/** Le document de ce qui est lié à une identité (une clé par table), lu dans un même instantané. */
export const exporterIdentite = commande(
  { regle: { auth: "admin", portee: "app", audit: "privacy.identity_export" }, corps: objet({ kind: TYPE, identity_hash: HMAC }) },
  async ({ app, corps, auditer }) => {
    const genereLe = new Date().toISOString();
    const document = await dsarIdentityExport(app!, corps.kind, corps.identity_hash, genereLe);
    // Le document n'est rendu qu'une fois sa divulgation inscrite.
    await tx((c) => auditer(c, empreinte(app!, corps.kind, corps.identity_hash)));
    return { etat: "ok", fichier: dsarExportFilename(corps.identity_hash, genereLe), document } as const;
  },
);

/**
 * Efface ce qui est lié à une identité, sérialisé avec l'ingestion (verrou de
 * l'application, barrières, lots en file : `dsarIdentityErase`). Irréversible :
 * l'identité brute est RESSAISIE, et son HMAC doit être celui qu'on efface.
 */
export const effacerIdentite = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "privacy.identity_erase" },
    corps: objet({ kind: TYPE, identity_hash: HMAC, confirm_identity: BRUTE }),
  },
  async ({ principal, app, corps, auditer }) => {
    const brute = corps.confirm_identity.trim();
    if (!brute) return { etat: "confirmation" } as const;
    const confirme = hashIdentity(secret(), app!, corps.kind, brute);
    if (!confirme) return { etat: "indisponible" } as const;
    if (confirme !== corps.identity_hash) return { etat: "confirmation" } as const;
    const supprime = await dsarIdentityErase(app!, corps.kind, corps.identity_hash, undefined, principal.email, (c, s) =>
      auditer(c, `${empreinte(app!, corps.kind, corps.identity_hash)} rows=${lignes(s)}`),
    );
    return { etat: "efface", lignes: lignes(supprime) } as const;
  },
);

// ─── Identifiant de visiteur (historique) ────────────────────────────────────

/**
 * Le document d'un visiteur. Refusé — et le refus inscrit — quand l'identifiant
 * n'est qu'une ancienne empreinte de terminal : y répondre joindrait les données
 * de personnes qui n'ont rien demandé (`lib/dsar.ts`).
 */
export const exporterVisiteur = commande(
  { regle: { auth: "admin", portee: "globale", audit: "privacy.visitor_export" }, corps: objet({ app: APP_OU_TOUTES, visitor_id: VISITEUR }) },
  async ({ principal, corps, auditer }) => {
    const refus = horsPerimetre(principal, corps.app);
    if (refus) return refus;
    const visiteur = corps.visitor_id.trim();
    if (!visiteur) return { etat: "vide" } as const;
    const ligneApp = corps.app === "all" ? null : corps.app;
    const genereLe = new Date().toISOString();
    try {
      const document = await dsarExport(corps.app, visiteur, genereLe);
      await tx((c) => auditer(c, `app=${corps.app} visitor_id=${visiteur}`, ligneApp));
      return { etat: "ok", fichier: dsarExportFilename(visiteur, genereLe), document } as const;
    } catch (e) {
      if (!(e instanceof DsarRefus)) throw e;
      await tx((c) => auditer(c, `refus=${e.verdict} app=${corps.app} visitor_id=${visiteur}`, ligneApp));
      return { etat: "refus", motif: e.verdict, message: e.message } as const;
    }
  },
);

/** Efface un visiteur ; la confirmation est la ressaisie exacte de son identifiant. */
export const effacerVisiteur = commande(
  {
    regle: { auth: "admin", portee: "globale", audit: "privacy.visitor_erase" },
    corps: objet({ app: APP_OU_TOUTES, visitor_id: VISITEUR, confirm: VISITEUR }),
  },
  async ({ principal, corps, auditer }) => {
    const refus = horsPerimetre(principal, corps.app);
    if (refus) return refus;
    const visiteur = corps.visitor_id.trim();
    if (!visiteur) return { etat: "vide" } as const;
    if (corps.confirm.trim() !== visiteur) return { etat: "confirmation" } as const;
    const ligneApp = corps.app === "all" ? null : corps.app;
    try {
      const supprime = await dsarErase(corps.app, visiteur, principal.email, (c, s) =>
        auditer(c, `app=${corps.app} visitor_id=${visiteur} rows=${lignes(s)} (${s.map((d) => `${d.table}:${d.deleted}`).join(",")})`, ligneApp),
      );
      return { etat: "efface", lignes: lignes(supprime) } as const;
    } catch (e) {
      if (!(e instanceof DsarRefus)) throw e;
      await tx((c) => auditer(c, `refus=${e.verdict} app=${corps.app} visitor_id=${visiteur}`, ligneApp));
      return { etat: "refus", motif: e.verdict } as const;
    }
  },
);
