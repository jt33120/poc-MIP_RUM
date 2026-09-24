// QUI A LE DROIT DE QUOI : une politique par opération, déclarée avec son traitement.
//
// La table (`table.ts`) est ce qu'une DSI relit : chaque ligne dit l'authentification
// exigée, la portée vérifiée AVANT le traitement, le sort d'une session de démo,
// et l'action d'audit d'une écriture. La matrice d'autorisations
// (`tests/contract/console-api-authz.test.ts`) et la doc (`docs/api/console-api.md`)
// en sont GÉNÉRÉES : elles ne peuvent pas diverger d'elle.
//
// Les règles de `verifierTable` sont vérifiées AU DÉMARRAGE : un service dont la
// table viole une règle ne démarre pas. Une écriture sans audit (ni exemption
// motivée), ou ouverte à la démo, ne peut donc pas partir en production.
import type { Operation, Validateur } from "@mip/console-contract";
import type { Contexte } from "./contexte";

export type Authentification =
  /** Sans session. Le secret client reste exigé, sauf `secretClient: "aucun"`. */
  | "public"
  /** Une session valide, de n'importe quel rôle. */
  | "session"
  /** Une session administrateur ; pour une portée `app`, l'app doit être dans son périmètre. */
  | "admin"
  /** Administrateur de la plateforme : rôle admin ET périmètre non restreint (`apps` nul). */
  | "admin-plateforme";

export type Portee =
  /** Aucune application en jeu (ou toutes, pour un administrateur de plateforme). */
  | "globale"
  /** Le paramètre `app` de la requête : vérifié contre le périmètre de la session AVANT le traitement ; `all` vaut le périmètre effectif. */
  | "app"
  /** Une ressource identifiée dans le chemin, résolue DANS l'application du principal (404 si elle est ailleurs). */
  | "ressource";

export interface Politique {
  readonly auth: Authentification;
  readonly portee: Portee;
  /** Une session de démo peut-elle appeler ? Toute écriture est `refus`. */
  readonly demo: "lecture" | "refus";
  /** Écriture : l'action inscrite dans `audit_log`, ou une exemption MOTIVÉE. */
  readonly audit?: string | { readonly exempt: string };
  /**
   * `aucun` : l'opération répond SANS secret client. Réservé à la poignée de main
   * et aux clés publiques : ce que la console lit AVANT de faire confiance à l'hôte.
   */
  readonly secretClient?: "exige" | "aucun";
  /** Plafond du corps, en octets (défaut du service sinon). */
  readonly corpsMax?: number;
  readonly entree?: {
    readonly requete?: Validateur<unknown>;
    readonly corps?: Validateur<unknown>;
  };
}

export type Traitement = (ctx: Contexte) => Promise<unknown>;

export interface Enregistrement {
  readonly operation: Operation<unknown, unknown, unknown, unknown>;
  readonly politique: Politique;
  readonly traitement: Traitement;
}

/**
 * Enregistre une opération avec sa politique et son traitement. Le traitement est
 * typé par le descripteur : il reçoit les paramètres et l'entrée de l'opération,
 * et doit rendre sa réponse (ou une `Response` brute, pour un format imposé comme JWKS).
 */
export function servir<P, Q, B, R>(
  operation: Operation<P, Q, B, R>,
  politique: Politique,
  traitement: (ctx: Contexte<P, Q, B>) => Promise<R | Response>,
): Enregistrement {
  return Object.freeze({
    operation: operation as Operation<unknown, unknown, unknown, unknown>,
    politique: Object.freeze({ ...politique }),
    traitement: traitement as Traitement,
  });
}

/** Les seules écritures qu'une session de démo peut faire : fermer sa propre session. */
export const ECRITURES_DE_DEMO = Object.freeze(["auth.logout"]);

const ACTION_AUDIT = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

/** Les règles de la table. Rend la liste des violations : vide, le service peut démarrer. */
export function verifierTable(table: readonly Enregistrement[]): string[] {
  const fautes: string[] = [];
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const { operation: o, politique: p } of table) {
    const nom = `${o.id} (${o.methode} ${o.chemin})`;
    if (ids.has(o.id)) fautes.push(`${nom} : identifiant en double`);
    ids.add(o.id);
    const cle = `${o.methode} ${o.chemin.replace(/\{[^}]+\}/g, "{}")}`;
    if (routes.has(cle)) fautes.push(`${nom} : méthode et chemin déjà servis`);
    routes.add(cle);

    const ecriture = o.methode !== "GET";
    if (ecriture && p.demo !== "refus" && !ECRITURES_DE_DEMO.includes(o.id)) {
      fautes.push(`${nom} : une écriture est refusée à la démo (demo: "refus")`);
    }
    if (ecriture) {
      const a = p.audit;
      if (a === undefined) fautes.push(`${nom} : une écriture déclare son action d'audit, ou une exemption motivée`);
      else if (typeof a === "string" && !ACTION_AUDIT.test(a)) fautes.push(`${nom} : action d'audit « ${a} » mal formée (domaine.action)`);
      else if (typeof a === "object" && a.exempt.trim().length < 12) fautes.push(`${nom} : exemption d'audit sans motif`);
    } else if (p.audit !== undefined && typeof p.audit === "object") {
      fautes.push(`${nom} : une lecture n'a pas d'exemption d'audit à déclarer`);
    }
    if (p.secretClient === "aucun" && (ecriture || p.auth !== "public")) {
      fautes.push(`${nom} : seule une lecture publique peut se passer du secret client`);
    }
    if (p.auth === "public" && p.portee !== "globale") fautes.push(`${nom} : une opération publique n'a pas de portée`);
    if (p.portee === "ressource" && !/\{[^}]+\}/.test(o.chemin)) fautes.push(`${nom} : portée « ressource » sans identifiant dans le chemin`);
  }
  return fautes;
}
