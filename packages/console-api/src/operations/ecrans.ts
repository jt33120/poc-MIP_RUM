// LES ÉCRANS DE LA CONSOLE (C2 → C5) : un chargeur par écran, servi tel quel.
//
// Les chargeurs vivent dans la console (`apps/console/lib/chargeurs/`) : c'est le
// code que ses écrans exécutent aujourd'hui. Le service les reçoit par INJECTION
// (`services/console-api/server.mjs` les embarque dans son bundle) — ce paquet
// n'importe rien de la console et se vérifie seul. Ici : la politique de chaque
// opération, et la traduction d'une lecture en SECTION sur le fil — la raison
// d'un échec part au journal, avec le `request_id`, jamais dans la réponse.
//
// LES ÉCRANS (C3 → C5) ont une seule politique, la même pour tous : une session,
// la portée `app` (confrontée au périmètre relu en base AVANT le chargeur, `all`
// résolu), la démo en lecture, les paramètres d'URL bornés. Le chargeur reçoit le
// principal, l'app demandée et les paramètres, exactement ce que reçoit la page ;
// ses sections sont déjà sur le fil (la console les forme par `section()`).
import {
  COQUILLE,
  ECRANS,
  ECRANS_ADMIN,
  ECRANS_SESSION,
  PARAMETRES_ECRAN,
  type CleEcran,
  type CleEcranAdmin,
  type CleEcranSession,
  type Coquille,
  type Operation,
  type ParametresEcran,
  type Section,
} from "@mip/console-contract";
import type { Journal } from "../contexte";
import { ErreurContrat } from "../erreurs";
import { servir, type Enregistrement } from "../politique";

/** Une lecture de section, telle que la console la rend (`lire()`, `lib/lecture.ts`). */
export type Lecture<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly raison: string };

/** Le principal tel qu'un chargeur le reçoit : rôle et périmètre (relus en base par la session). */
export interface PrincipalChargeur {
  readonly email: string;
  readonly role: "admin" | "viewer";
  readonly apps: readonly string[] | null;
  readonly demo: boolean;
}

/**
 * Le chargeur d'un écran : le principal, les paramètres de la page (`app` compris,
 * tel que demandé), les paramètres du chemin (l'identifiant d'une page de détail),
 * et l'identifiant de requête pour le journal. Il rend ce que la page affiche.
 */
export type ChargeurEcran = (
  principal: PrincipalChargeur,
  parametres: ParametresEcran,
  chemin: Readonly<Record<string, string>>,
  requestId: string,
) => Promise<unknown>;

/** Une erreur de filtre du contrat de requête : ce que la console refuse d'appliquer. */
export interface RefusDeFiltre {
  readonly code: string;
  readonly message: string;
}

export interface ChargeursEcrans {
  readonly coquille: (p: PrincipalChargeur) => Promise<{
    readonly projets: Lecture<readonly { app_id: string; name: string }[]>;
    readonly schema: Lecture<readonly string[]>;
    readonly fuseaux: Readonly<Record<string, string>>;
    readonly tickets: Lecture<boolean> | null;
  }>;
  /** C3 → C6 — un chargeur par écran du contrat (`ECRANS`), sans exception : le type l'exige. */
  readonly pages: { readonly [K in CleEcran]: ChargeurEcran };
  /** C8 → C9 — les écrans d'administration (`ECRANS_ADMIN`) : un administrateur, sans portée d'application. */
  readonly administration: { readonly [K in CleEcranAdmin]: ChargeurEcran };
  /** C9 — les écrans de session sans portée (`ECRANS_SESSION`) : le choix du projet. */
  readonly session: { readonly [K in CleEcranSession]: ChargeurEcran };
  /**
   * Reconnaît un REFUS de filtre (`UnsupportedFilterError` de la console) : un
   * écran qui ne sait pas appliquer un filtre le refuse, ce n'est pas une panne.
   * Il part en 400 `filtre_non_supporte`, avec l'erreur du contrat de requête.
   */
  readonly refusDeFiltre: (e: unknown) => RefusDeFiltre | null;
}

/** La politique commune des écrans. */
const POLITIQUE_ECRAN = { auth: "session", portee: "app", demo: "lecture", entree: { requete: PARAMETRES_ECRAN } } as const;
/**
 * La politique des écrans d'administration : un administrateur (une démo est un
 * viewer, donc refusée), sans portée — le chargeur restreint ce qu'il liste au
 * périmètre du principal relu en base.
 */
const POLITIQUE_ECRAN_ADMIN = { auth: "admin", portee: "globale", demo: "lecture", entree: { requete: PARAMETRES_ECRAN } } as const;
/** La politique des écrans de session sans portée : toute session, le chargeur ne lit que son périmètre. */
const POLITIQUE_ECRAN_SESSION = { auth: "session", portee: "globale", demo: "lecture", entree: { requete: PARAMETRES_ECRAN } } as const;

/** Une lecture → une section du fil : la raison reste au journal. */
export function versSection<T>(l: Lecture<T>, contexte: { journal: Journal; requestId: string; section: string }): Section<T> {
  if (l.ok) return { ok: true, data: l.data };
  contexte.journal.warn("section en échec", { section: contexte.section, request_id: contexte.requestId, raison: l.raison });
  return { ok: false, code: "lecture_en_echec" };
}

export function operationsEcrans(c: ChargeursEcrans): Enregistrement[] {
  return [
    servir(COQUILLE, { auth: "session", portee: "globale", demo: "lecture" }, async ({ principal, requestId, journal }) => {
      if (principal.kind !== "session") throw new ErreurContrat("session_requise", "session requise");
      const l = await c.coquille({ email: principal.email, role: principal.role, apps: principal.apps, demo: principal.demo });
      const ctx = { journal, requestId };
      const reponse: Coquille = {
        projets: versSection(l.projets, { ...ctx, section: "projets" }),
        schema: versSection(l.schema, { ...ctx, section: "schema" }),
        fuseaux: l.fuseaux,
        tickets: l.tickets === null ? null : versSection(l.tickets, { ...ctx, section: "tickets" }),
      };
      return reponse;
    }),
    ...(Object.keys(ECRANS) as CleEcran[]).map((cle) =>
      // Chaque écran a ses paramètres de chemin (aucun, `{id}`…) : le traitement les
      // reçoit tous sous la même forme, un dictionnaire de chaînes.
      servir(ECRANS[cle] as Operation<Readonly<Record<string, string>>, ParametresEcran, never, unknown>, POLITIQUE_ECRAN, async ({ principal, requete, params, appDemandee, requestId }) => {
        if (principal.kind !== "session") throw new ErreurContrat("session_requise", "session requise");
        const qui: PrincipalChargeur = { email: principal.email, role: principal.role, apps: principal.apps, demo: principal.demo };
        // `app` retiré par le pipeline (c'est la portée) : rendu au chargeur tel que demandé.
        const parametres: ParametresEcran = { ...(requete as ParametresEcran), app: appDemandee ?? "" };
        try {
          return await c.pages[cle](qui, parametres, (params ?? {}) as Readonly<Record<string, string>>, requestId);
        } catch (e) {
          const refus = c.refusDeFiltre(e);
          if (refus) throw new ErreurContrat("filtre_non_supporte", refus.message, { details: { code: refus.code } });
          throw e;
        }
      }),
    ),
    ...(Object.keys(ECRANS_ADMIN) as CleEcranAdmin[]).map((cle) =>
      servir(
        ECRANS_ADMIN[cle] as Operation<Readonly<Record<string, string>>, ParametresEcran, never, unknown>,
        POLITIQUE_ECRAN_ADMIN,
        async ({ principal, requete, params, requestId }) => {
          if (principal.kind !== "session") throw new ErreurContrat("session_requise", "session requise");
          const qui: PrincipalChargeur = { email: principal.email, role: principal.role, apps: principal.apps, demo: principal.demo };
          return c.administration[cle](qui, { ...(requete as ParametresEcran) }, (params ?? {}) as Readonly<Record<string, string>>, requestId);
        },
      ),
    ),
    ...(Object.keys(ECRANS_SESSION) as CleEcranSession[]).map((cle) =>
      servir(
        ECRANS_SESSION[cle] as Operation<Readonly<Record<string, string>>, ParametresEcran, never, unknown>,
        POLITIQUE_ECRAN_SESSION,
        async ({ principal, requete, params, requestId }) => {
          if (principal.kind !== "session") throw new ErreurContrat("session_requise", "session requise");
          const qui: PrincipalChargeur = { email: principal.email, role: principal.role, apps: principal.apps, demo: principal.demo };
          return c.session[cle](qui, { ...(requete as ParametresEcran) }, (params ?? {}) as Readonly<Record<string, string>>, requestId);
        },
      ),
    ),
  ];
}
