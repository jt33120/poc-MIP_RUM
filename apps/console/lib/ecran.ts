// UN ÉCRAN, CHARGÉ PAR console-api OU PAR LA CONSOLE ELLE-MÊME (la bascule, après P6b).
//
// La page appelle `chargerEcran(ECRANS.overview, chargerOverview, sp)` : l'OPÉRATION
// du contrat que console-api sert, et le CHARGEUR qu'il embarque pour la servir —
// le même code des deux côtés (`services/console-api/ecrans.mjs`, dont
// `tests/unit/ecrans-operations.test.ts` vérifie qu'il associe chaque opération au
// chargeur que la page nomme). Qui sert est décidé par `lib/aiguillage-console-api.ts`.
//
// SERVI PAR console-api : l'appel porte le jeton de la session (le service relit le
// principal en base), les paramètres de l'URL tels quels (`app` compris : c'est la
// portée) et ceux du chemin. La réponse est la sortie du chargeur passée par JSON.
// SERVI PAR LA CONSOLE : le chargeur, avec le principal de la session, sa sortie
// passée par JSON (`versLeFil`) — la forme exacte que le service rend. Aucune page
// ne change de type d'un chemin à l'autre.
//
// CE QUE DEVIENT UN ÉCHEC DU SERVICE :
//   · un refus de filtre (`filtre_non_supporte`) est relancé tel que le chargeur
//     l'aurait levé (`UnsupportedFilterError`) : l'écran le traite comme avant ;
//   · un échec de TRANSPORT (injoignable, 5xx, échéance) : compté par le
//     disjoncteur ; la console sert elle-même, sauf en mode strict (erreur d'écran) ;
//   · un refus AVANT le chargeur (session, rôle, périmètre, entrée) : la console
//     sert elle-même — le chargeur rend alors sa propre décision, celle que l'écran
//     sait afficher — et le journal le dit : c'est un écart à corriger avant le
//     mode strict. En mode strict, la page suit la porte du middleware : `/login`,
//     l'accueil, `/select`.
//
// Il lit la session : il ne part jamais dans le bundle de console-api (la garde du
// build refuse `lib/auth.ts`).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COQUILLE, type Fil, type Operation, type Section } from "@mip/console-contract";
import { creerAiguillage, type Aiguillage } from "./aiguillage-console-api";
import { getUser, SESSION_COOKIE } from "./auth";
import { backend, type Resultat } from "./backend";
import { PARAM_BLOCS, versLeFil, type Chargeur, type CheminEcran, type ParametresEcran, type PrincipalEcran } from "./chargeurs/commun";
import type { CoquilleChargee } from "./chargeurs/coquille";
import { catalogueDe } from "./dashboard-blocs";
import { createLogger } from "./journal";
import type { Lecture } from "./lecture";
import { pourcentageConsoleApi } from "./platform-flag";
import type { AppItem } from "./queries";
import { UnsupportedFilterError } from "./query-compiler";
import type { ContractErrorCode } from "./query-contract";
import { algorithmeDuJeton, verifierJetonConsoleApi } from "./session-console";

/** L'opération d'un écran, quelle que soit sa famille (`ECRANS`, `ECRANS_ADMIN`, `ECRANS_SESSION`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OperationEcran = Operation<any, any, never, unknown>;

/** Les échecs de TRANSPORT : le service n'a pas parlé (ou a failli), rien à voir avec la demande. */
export const ECHECS_DE_TRANSPORT: ReadonlySet<string> = new Set([
  "non_branche",
  "hote_non_verifie",
  "reseau",
  "indisponible",
  "erreur_interne",
  "echeance_depassee",
]);

/** Un refus du service avant le chargeur (mode strict seulement : sinon, la console sert elle-même). */
export interface RefusEcran {
  readonly code: string;
  readonly message: string;
  readonly requestId: string | null;
}

export type LectureEcran<R> = { readonly ok: true; readonly data: Fil<R> } | { readonly ok: false; readonly refus: RefusEcran };

/** console-api n'a pas pu servir, et la console ne sert pas à sa place (mode strict). */
export class ErreurConsoleApi extends Error {
  constructor(
    readonly code: string,
    readonly requestId: string | null,
    message: string,
  ) {
    super(`console-api : ${message} (${code}${requestId ? `, réf. ${requestId}` : ""})`);
    this.name = "ErreurConsoleApi";
  }
}

/**
 * La coquille telle que le layout la lit : des SECTIONS (la raison d'un échec reste
 * au journal). La forme de `Coquille` au contrat, celle que rend `console.shell`.
 */
export interface CoquilleEcran {
  readonly projets: Section<AppItem[]>;
  readonly schema: Section<string[]>;
  readonly fuseaux: Record<string, string>;
  readonly tickets: Section<boolean> | null;
}

/** La coquille quand ni le service ni la base ne répondent : elle s'affiche et dit « Partiel » (F02). */
export const COQUILLE_DEGRADEE: CoquilleEcran = Object.freeze({
  projets: { ok: false, code: "lecture_en_echec" } as const,
  schema: { ok: false, code: "lecture_en_echec" } as const,
  fuseaux: {},
  tickets: null,
});

function versSection<T>(l: Lecture<T>): Section<T> {
  return l.ok ? { ok: true, data: l.data } : { ok: false, code: "lecture_en_echec" };
}

/** La coquille chargée par la console, sous la forme du fil. */
export function coquilleDuFil(c: CoquilleChargee): CoquilleEcran {
  return { projets: versSection(c.projets), schema: versSection(c.schema), fuseaux: c.fuseaux, tickets: c.tickets && versSection(c.tickets) };
}

type Journal = { warn: (m: string, c?: Record<string, unknown>) => void; error: (m: string, c?: Record<string, unknown>) => void };

/** Le chargement des écrans, ses dépendances injectées (les tests les simulent ; l'instance réelle est plus bas). */
export function creerChargementEcrans(deps: {
  aiguillage: Pick<Aiguillage, "voie" | "echec">;
  appeler: (
    operation: OperationEcran,
    entree: { params?: CheminEcran; requete?: ParametresEcran },
    options: { jeton: string; requestId?: string; signal?: AbortSignal },
  ) => Promise<Resultat<unknown>>;
  jeton: () => Promise<string | null>;
  requestId: () => Promise<string | undefined>;
  principal: () => Promise<PrincipalEcran | null>;
  journal: Journal;
}) {
  const { aiguillage, journal } = deps;

  function suivreEchec(operation: string, r: Extract<Resultat<unknown>, { ok: false }>, strict: boolean): "local" | "refus" {
    const transport = ECHECS_DE_TRANSPORT.has(r.code);
    if (transport) aiguillage.echec("ecrans");
    if (strict) {
      if (transport) throw new ErreurConsoleApi(r.code, r.requestId, r.message);
      return "refus";
    }
    journal.warn(
      transport ? "console-api en échec : la console sert l'écran elle-même" : "console-api refuse ce que la console sert : écart à corriger avant le mode strict",
      { operation, code: r.code, statut: r.statut, request_id: r.requestId },
    );
    return "local";
  }

  async function lireEcran<R>(
    operation: OperationEcran,
    chargeur: Chargeur<R>,
    sp: ParametresEcran,
    chemin: CheminEcran = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<LectureEcran<R>> {
    const local = async (): Promise<LectureEcran<R>> => ({ ok: true, data: versLeFil(await chargeur(await deps.principal(), sp, chemin)) });
    const voie = await aiguillage.voie("ecrans", await deps.jeton());
    if (!voie.distante) {
      // Strict, sans session valable : ce que dirait le service, sans l'appeler.
      if (voie.strict && voie.raison === "sans_session") return { ok: false, refus: { code: "session_requise", message: "session requise", requestId: null } };
      return local();
    }
    const r = await deps.appeler(operation, { params: chemin, requete: sp }, { jeton: voie.jeton, requestId: await deps.requestId(), signal: options.signal });
    if (r.ok) return { ok: true, data: r.data as Fil<R> };
    if (r.code === "filtre_non_supporte") {
      // Le refus que le chargeur a levé côté service : relevé ici, à l'identique.
      const details = r.details as { code?: string } | undefined;
      throw new UnsupportedFilterError({ code: (details?.code ?? "unsupported_filter") as ContractErrorCode, message: r.message });
    }
    if (suivreEchec(operation.id, r, voie.strict) === "local") return local();
    return { ok: false, refus: { code: r.code, message: r.message, requestId: r.requestId } };
  }

  /**
   * La coquille : par console-api, ou par son chargeur LOCAL — passé par l'appelant
   * (`lib/coquille-ecran.ts`), pour que les pages, qui importent ce module, ne
   * tirent pas les lectures de la coquille dans leur graphe d'import.
   */
  async function lireCoquille(locale: () => Promise<CoquilleChargee>): Promise<CoquilleEcran> {
    const local = async () => coquilleDuFil(await locale());
    const voie = await aiguillage.voie("ecrans", await deps.jeton());
    if (!voie.distante) return voie.strict && voie.raison === "sans_session" ? COQUILLE_DEGRADEE : local();
    const r = await deps.appeler(COQUILLE, {}, { jeton: voie.jeton, requestId: await deps.requestId() });
    if (r.ok) return r.data as CoquilleEcran;
    const transport = ECHECS_DE_TRANSPORT.has(r.code);
    if (transport) aiguillage.echec("ecrans");
    if (!voie.strict) {
      journal.warn("console-api n'a pas servi la coquille : la console la sert elle-même", { code: r.code, statut: r.statut, request_id: r.requestId });
      return local();
    }
    // LA COQUILLE NE TOMBE PAS (F02) : sans le service, elle s'affiche et dit « Partiel ».
    journal.error("console-api n'a pas servi la coquille : coquille partielle", { code: r.code, statut: r.statut, request_id: r.requestId });
    return COQUILLE_DEGRADEE;
  }

  return { lireEcran, lireCoquille };
}

// ─── L'instance de la console ────────────────────────────────────────────────

/** Le jeton de la session (cookie), ou `null` — hors requête (tests), aucune session. */
export async function jetonDeSession(): Promise<string | null> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** L'identifiant de la requête de la console (posé par le middleware), s'il y en a une. */
export async function requeteCourante(): Promise<string | undefined> {
  try {
    return (await headers()).get("x-request-id") ?? undefined;
  } catch {
    return undefined;
  }
}

/** L'aiguillage de l'instance : les écrans et les écritures (`lib/commande.ts`) le partagent. */
export const aiguillage = creerAiguillage({
  branche: () => backend().estBranche(),
  algorithme: algorithmeDuJeton,
  verifier: (jeton) => verifierJetonConsoleApi(jeton),
  pourcentage: pourcentageConsoleApi,
});

const ecrans = creerChargementEcrans({
  aiguillage,
  appeler: (operation, entree, options) => backend().appeler(operation, entree, options),
  jeton: jetonDeSession,
  requestId: requeteCourante,
  principal: getUser,
  journal: createLogger("ecran"),
});

/** Un écran lu, ou le refus du service (mode strict) : pour une ROUTE, qui en fait un statut HTTP. */
export const lireEcran = ecrans.lireEcran;

/**
 * Un écran pour une PAGE : sa donnée, ou la porte que suivrait le middleware —
 * `/login` sans session, l'accueil pour un rôle insuffisant, `/select` hors du
 * périmètre. Tout autre refus est une erreur d'écran.
 */
export async function chargerEcran<R>(operation: OperationEcran, chargeur: Chargeur<R>, sp: ParametresEcran, chemin: CheminEcran = {}): Promise<Fil<R>> {
  const l = await ecrans.lireEcran(operation, chargeur, sp, chemin);
  if (l.ok) return l.data;
  if (l.refus.code === "session_requise" || l.refus.code === "session_invalide") redirect("/login");
  if (l.refus.code === "role_insuffisant") redirect("/");
  if (l.refus.code === "hors_perimetre") redirect("/select");
  throw new ErreurConsoleApi(l.refus.code, l.refus.requestId, l.refus.message);
}

/** La coquille du layout, par console-api ou par son chargeur local (`lib/coquille-ecran.ts`). */
export const lireCoquille = ecrans.lireCoquille;

/**
 * Les paramètres d'un écran COMPOSABLE (`/`, `/sessions`, `/slo`), augmentés de sa
 * composition : le cookie du catalogue, passé au chargeur sous `blocs`. Une valeur
 * de l'URL sous ce nom est écartée — la composition est celle du cookie.
 */
export async function avecBlocs(sp: ParametresEcran, href: string): Promise<ParametresEcran> {
  const cat = catalogueDe(href);
  if (!cat) throw new Error(`écran sans catalogue de blocs : ${href}`);
  const { [PARAM_BLOCS]: _ignore, ...reste } = sp;
  const brut = (await cookies()).get(cat.cookie)?.value;
  return brut === undefined ? reste : { ...reste, [PARAM_BLOCS]: brut };
}

/**
 * Un écran d'ADMINISTRATION (C8 → C9) : son chargeur dit `sans_session` ou
 * `interdit` au lieu de rediriger ; la page redirige ici, comme `requireAdmin` —
 * vers la connexion, ou vers l'accueil.
 */
export function accesAdmin<T extends { etat: string }>(ecran: T): Exclude<T, { etat: "sans_session" | "interdit" }> {
  if (ecran.etat === "sans_session") redirect("/login");
  if (ecran.etat === "interdit") redirect("/");
  return ecran as Exclude<T, { etat: "sans_session" | "interdit" }>;
}
