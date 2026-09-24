// L'ENVELOPPE DE TOUTE RÉPONSE DE console-api, succès comme refus.
//
// Même forme que l'API v1 (`{ meta, data }` / `{ error }`), plus le `request_id`
// PARTOUT : c'est lui que l'écran d'erreur affiche (« réf. … »), que le journal
// du service porte, et qu'`audit_log.request_id` retiendra (C0c). Un refus dit un
// CODE stable et un message pour un humain ; jamais une raison technique (un
// message de pilote PostgreSQL peut nommer un hôte ou une table).

/** Chaque code d'erreur, et le statut HTTP qui l'accompagne. Un code est un contrat : on en ajoute, on n'en renomme pas. */
export const CODES_ERREUR = Object.freeze({
  entree_invalide: 400,
  filtre_non_supporte: 400,
  session_requise: 401,
  session_invalide: 401,
  origine_refusee: 403,
  demo_refusee: 403,
  role_insuffisant: 403,
  hors_perimetre: 403,
  route_inconnue: 404,
  ressource_inconnue: 404,
  methode_refusee: 405,
  conflit: 409,
  corps_trop_grand: 413,
  debit_depasse: 429,
  erreur_interne: 500,
  indisponible: 503,
  echeance_depassee: 503,
} as const);

export type CodeErreur = keyof typeof CODES_ERREUR;

export interface Meta {
  readonly request_id: string;
}

export interface Succes<T> {
  readonly meta: Meta;
  readonly data: T;
}

export interface Probleme {
  readonly meta: Meta;
  readonly error: {
    readonly code: CodeErreur;
    readonly message: string;
    readonly details?: unknown;
  };
}

/** En-tête qui signe toute réponse du service : la console distingue ainsi console-api du routeur Railway devant lui. */
export const ENTETE_SERVICE = "x-mip-console-api";
/** Le secret client, qu'envoie le serveur de la console (jamais un navigateur). */
export const ENTETE_CLIENT = "x-mip-client";
/** Le budget restant de l'appelant, en millisecondes. */
export const ENTETE_ECHEANCE = "x-mip-deadline-ms";
export const ENTETE_REQUETE = "x-request-id";
