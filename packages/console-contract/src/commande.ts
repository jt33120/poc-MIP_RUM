// UNE ÉCRITURE DE LA CONSOLE (C6 → C9) : sa règle d'accès, lue des DEUX côtés.
//
// Une écriture est une COMMANDE (`apps/console/lib/commandes/`) : la console
// l'exécute aujourd'hui elle-même, console-api l'embarque telle quelle et la
// servira après la bascule — comme les chargeurs d'écrans. Sa règle d'accès est
// déclarée AVEC elle (qui, quelle portée, quel audit), et appliquée :
//   · par le pipeline de console-api, qui en fait la politique de l'opération
//     (`@mip/console-api`, `operationsCommandes`) ;
//   · par la console, AVANT la commande, par `refusDAcces` ci-dessous.
// Deux codes pour une même règle : un test les confronte, profil par profil et
// application par application (`tests/unit/console-api-commandes.test.ts`). Une
// divergence — la console qui laisse passer ce que le service refuse — rougit.
//
// Toute commande est une écriture : une session de démonstration n'en passe
// aucune, et le pipeline le vérifie au démarrage (`verifierTable`).

/** Qui peut écrire. */
export type AuthCommande =
  /** Toute session (hors démo). Les droits fins — propriétaire, périmètre de la ressource — sont ceux de la commande. */
  | "session"
  /** Un administrateur ; sous portée `app`, l'application doit être dans son périmètre. */
  | "admin"
  /** Administrateur de la plateforme : rôle admin ET périmètre non restreint (`apps` nul). */
  | "admin-plateforme";

/**
 * Sur quoi porte l'écriture.
 *   · `app` : UNE application NOMMÉE (`?app=`), dans le périmètre du principal —
 *     jamais `all`, qui n'est pas une application. La commande filtre chaque ligne
 *     par elle (`where id = $1 and app_id = $2`) : une ligne d'une autre
 *     application est introuvable, comme absente ;
 *   · `globale` : aucune application en paramètre. Soit l'écriture n'en vise pas
 *     (administration de la plateforme), soit la commande résout elle-même la
 *     ressource et ses droits (un tableau de bord, une vue : propriétaire et
 *     périmètre, `lib/dashboard-access.ts`, `lib/saved-views.ts`).
 */
export type PorteeCommande = "globale" | "app";

export interface RegleCommande {
  readonly auth: AuthCommande;
  readonly portee: PorteeCommande;
  /** L'action inscrite dans `audit_log` (`domaine.action`), ou une exemption MOTIVÉE. */
  readonly audit: string | { readonly exempt: string };
}

/** Ce que la règle regarde du principal : rôle, périmètre, démo. `null` : aucune session. */
export interface PrincipalRegle {
  readonly role: "admin" | "viewer";
  /** `null` = toutes les applications ; `[]` = aucune. */
  readonly apps: readonly string[] | null;
  readonly demo?: boolean;
}

/** Les refus d'accès d'une commande : les mêmes codes, dans le même ordre, que le pipeline. */
export type CodeRefusCommande = "session_requise" | "demo_refusee" | "role_insuffisant" | "hors_perimetre" | "entree_invalide";

export interface RefusCommande {
  readonly code: CodeRefusCommande;
  readonly message: string;
  /** Le champ en cause, pour `entree_invalide`. */
  readonly champ?: string;
}

/** Le motif d'un identifiant d'application : celui du pipeline. */
export const MOTIF_APP = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * La règle appliquée à un principal et à l'application demandée : `null` si
 * l'écriture peut partir, le refus sinon. Même ordre que le pipeline — session,
 * démo, rôle, puis application : c'est ce qui rend les deux côtés comparables
 * refus par refus.
 */
export function refusDAcces(regle: RegleCommande, principal: PrincipalRegle | null, app: string | null): RefusCommande | null {
  if (!principal) return { code: "session_requise", message: "session requise" };
  if (principal.demo) return { code: "demo_refusee", message: "action refusée en démonstration" };
  if ((regle.auth === "admin" || regle.auth === "admin-plateforme") && principal.role !== "admin") {
    return { code: "role_insuffisant", message: "réservé aux administrateurs" };
  }
  if (regle.auth === "admin-plateforme" && principal.apps !== null) {
    return { code: "role_insuffisant", message: "réservé aux administrateurs de la plateforme" };
  }
  if (regle.portee === "globale") {
    if (app !== null) return { code: "entree_invalide", message: "paramètre « app » inconnu", champ: "app" };
    return null;
  }
  if (!app || !MOTIF_APP.test(app)) return { code: "entree_invalide", message: "paramètre « app » requis", champ: "app" };
  if (app === "all") return { code: "entree_invalide", message: "une écriture vise une application nommée, pas « all »", champ: "app" };
  const perimetre = principal.apps;
  if (perimetre !== null && perimetre.length === 0) return { code: "hors_perimetre", message: "aucune application dans votre périmètre" };
  if (perimetre !== null && !perimetre.includes(app)) return { code: "hors_perimetre", message: "application hors de votre périmètre" };
  return null;
}

/**
 * Ce que rend une commande à qui l'appelle : sa DÉCISION (`data` — créé,
 * introuvable, conflit de révision…), ou le refus d'accès ou d'entrée qui l'a
 * arrêtée avant qu'elle ne lise quoi que ce soit.
 */
export type ResultatCommande<R> = { readonly ok: true; readonly data: R } | ({ readonly ok: false } & RefusCommande);
