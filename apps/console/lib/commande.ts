// UNE ÉCRITURE, EXÉCUTÉE PAR console-api OU PAR LA CONSOLE ELLE-MÊME (la bascule, après P6b).
//
// La server action appelle sa commande PAR SA CLÉ (`executerCommande("creerObjectif",
// { app, corps })`) et reçoit la DÉCISION de la commande passée par JSON, ou le
// refus qui l'a arrêtée avant. Qui exécute est décidé par
// `lib/aiguillage-console-api.ts` (famille `commandes`, montée APRÈS les écrans).
//
// PAR console-api : l'opération du contrat (`COMMANDES[cle]`), avec le jeton de la
// session, `?app=` pour une commande de portée `app`, les paramètres du chemin et
// le corps. Le service rejoue les mêmes gardes que la console, dans le même ordre —
// ses refus sont ceux de `refusDAcces` et du validateur de la commande, et la server
// action les traite sans savoir qui a répondu.
//
// UNE ÉCRITURE NE SE REJOUE PAS. Seul un échec où RIEN n'est parti (service non
// branché, hôte non vérifié par la poignée de main) laisse la console écrire à sa
// place, hors mode strict. Tout autre échec — réseau, 5xx, échéance — a une issue
// INCONNUE : la commande a peut-être écrit. L'action lève (écran d'erreur, avec la
// référence de la requête) ; jamais une seconde écriture par la console.
//
// PAR LA CONSOLE : se rejouent, dans l'ordre du pipeline du service, les gardes qui
// précèdent une commande — la session (`getUser`), la RÈGLE (`refusDAcces`, le même
// code que confronte `tests/unit/console-api-commandes.test.ts` au pipeline),
// l'ENTRÉE (corps passé par JSON puis validé, paramètres du chemin) — puis la
// commande. Les server actions n'importent AUCUNE commande, seulement cette fonction
// et des types. Il lit la session : il ne part jamais dans le bundle de console-api
// (la garde du build refuse `lib/auth.ts`).
import {
  COMMANDES,
  refusDAcces,
  type CleCommande,
  type CodeRefusCommande,
  type Fil,
  type Operation,
  type RefusCommande,
  type ResultatCommande,
} from "@mip/console-contract";
import type { Aiguillage } from "./aiguillage-console-api";
import { getUser } from "./auth";
import { backend, type Resultat } from "./backend";
import { versLeFil } from "./chargeurs/commun";
import { COMMANDES_CONSOLE } from "./commandes";
import type { Commande, CommandeQuelconque } from "./commandes/commun";
import { aiguillage as aiguillageConsole, ECHECS_DE_TRANSPORT, ErreurConsoleApi, jetonDeSession, requeteCourante } from "./ecran";
import { createLogger } from "./journal";

type Registre = typeof COMMANDES_CONSOLE;

/** La décision d'une commande, telle que la server action la reçoit : passée par JSON. */
export type SortieDe<K extends CleCommande> = Registre[K] extends Commande<infer _P, infer _B, infer R> ? Fil<R> : never;

export interface AppelCommande {
  /** L'application visée, pour une commande de portée `app` ; absente sinon. */
  readonly app?: string | null;
  /** Les paramètres du chemin de l'opération (`{ id: "12" }`), en chaînes comme dans une URL. */
  readonly chemin?: Readonly<Record<string, string>>;
  /** Le corps, tel que le fil le porterait : validé par la commande (ou par le service). */
  readonly corps?: unknown;
}

/** Les refus qu'une server action sait lire : ceux de `refusDAcces` et des validateurs. */
const REFUS_DE_COMMANDE: ReadonlySet<string> = new Set<CodeRefusCommande>(["session_requise", "demo_refusee", "role_insuffisant", "hors_perimetre", "entree_invalide"]);

/** Le refus du service, sous la forme d'un refus de commande ; `null` s'il n'en est pas un. */
export function refusDuService(r: Extract<Resultat<unknown>, { ok: false }>): RefusCommande | null {
  // Une session révoquée est, pour l'action, une session absente : on se reconnecte.
  if (r.code === "session_invalide") return { code: "session_requise", message: r.message };
  if (!REFUS_DE_COMMANDE.has(r.code)) return null;
  const champ = (r.details as { champ?: unknown } | undefined)?.champ;
  return { code: r.code as CodeRefusCommande, message: r.message, ...(typeof champ === "string" ? { champ } : {}) };
}

/** Les paramètres du chemin d'une opération qui manquent (`/v1/goals/{id}` sans `id`). */
function cheminIncomplet(gabarit: string, chemin: Readonly<Record<string, string>>): string | null {
  for (const [, nom] of gabarit.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) if (!chemin[nom]) return nom;
  return null;
}

type Journal = { warn: (m: string, c?: Record<string, unknown>) => void };

/** L'exécution des commandes, ses dépendances injectées (les tests les simulent ; l'instance réelle est plus bas). */
export function creerExecutionCommandes(deps: {
  aiguillage: Pick<Aiguillage, "voie" | "echec">;
  appeler: (
    operation: (typeof COMMANDES)[CleCommande],
    // `app` n'est pas au type de l'opération : c'est sa PORTÉE, que le pipeline lit dans `?app=`.
    entree: { params?: Readonly<Record<string, string>>; requete?: Readonly<Record<string, string>>; corps?: unknown },
    options: { jeton: string; requestId?: string },
  ) => Promise<Resultat<unknown>>;
  jeton: () => Promise<string | null>;
  requestId: () => Promise<string | undefined>;
  locale: <K extends CleCommande>(cle: K, appel: AppelCommande, requestId: string | null) => Promise<ResultatCommande<SortieDe<K>>>;
  journal: Journal;
}) {
  return async function executerCommande<K extends CleCommande>(cle: K, appel: AppelCommande = {}): Promise<ResultatCommande<SortieDe<K>>> {
    const voie = await deps.aiguillage.voie("commandes", await deps.jeton());
    const requestId = await deps.requestId();
    if (!voie.distante) {
      if (voie.strict && voie.raison === "sans_session") return { ok: false, code: "session_requise", message: "session requise" };
      return deps.locale(cle, appel, requestId ?? null);
    }

    const operation = COMMANDES[cle];
    const chemin = appel.chemin ?? {};
    // Ce que refuserait le validateur du chemin, sans appel : l'URL ne se construit pas.
    const manquant = cheminIncomplet(operation.chemin, chemin);
    if (manquant) return { ok: false, code: "entree_invalide", message: `paramètre « ${manquant} » manquant`, champ: manquant };

    const r = await deps.appeler(
      operation,
      { params: chemin, ...(appel.app == null ? {} : { requete: { app: appel.app } }), ...(appel.corps === undefined ? {} : { corps: appel.corps }) },
      { jeton: voie.jeton, requestId },
    );
    if (r.ok) return { ok: true, data: r.data as SortieDe<K> };
    const refus = refusDuService(r);
    if (refus) return { ok: false, ...refus };

    if (ECHECS_DE_TRANSPORT.has(r.code)) deps.aiguillage.echec("commandes");
    const rienNestParti = r.code === "non_branche" || r.code === "hote_non_verifie";
    if (rienNestParti && !voie.strict) {
      deps.journal.warn("console-api n'a rien reçu : la console écrit elle-même", { commande: cle, code: r.code });
      return deps.locale(cle, appel, requestId ?? null);
    }
    // Issue inconnue (ou refus inattendu) : jamais rejouée par la console.
    throw new ErreurConsoleApi(r.code, r.requestId, r.message);
  };
}

/** La commande exécutée par la console : les gardes du pipeline, dans son ordre, puis la commande. */
export async function executerLocalement<K extends CleCommande>(
  cle: K,
  appel: AppelCommande,
  requestId: string | null,
): Promise<ResultatCommande<SortieDe<K>>> {
  const commande: CommandeQuelconque = COMMANDES_CONSOLE[cle];
  const principal = await getUser();
  const app = appel.app ?? null;
  const refus = refusDAcces(commande.regle, principal, app);
  if (refus) return { ok: false, ...refus };

  // Ce que le fil ferait du corps : une `Date` devient une chaîne, un `undefined` disparaît.
  const brut = appel.corps === undefined ? undefined : (JSON.parse(JSON.stringify(appel.corps)) as unknown);
  let corps: unknown = undefined;
  if (commande.corps) {
    const v = commande.corps(brut, "corps");
    if (!v.ok) return { ok: false, code: "entree_invalide", message: v.error.message, champ: v.error.champ };
    corps = v.value;
  } else if (brut !== undefined) {
    return { ok: false, code: "entree_invalide", message: "cette opération ne prend pas de corps" };
  }
  let chemin: unknown = appel.chemin ?? {};
  if (commande.chemin) {
    const v = commande.chemin(chemin, "chemin");
    if (!v.ok) return { ok: false, code: "entree_invalide", message: v.error.message, champ: v.error.champ };
    chemin = v.value;
  }

  const data = await commande.executer({
    // `refusDAcces` a écarté l'absence de session.
    principal: principal!,
    app,
    chemin,
    corps,
    requestId,
  });
  return { ok: true, data: versLeFil(data) as SortieDe<K> };
}

export const executerCommande = creerExecutionCommandes({
  aiguillage: aiguillageConsole,
  appeler: (operation, entree, options) =>
    backend().appeler(operation as Operation<Readonly<Record<string, string>>, Readonly<Record<string, string>>, unknown, unknown>, entree, options),
  jeton: jetonDeSession,
  requestId: requeteCourante,
  locale: executerLocalement,
  journal: createLogger("commande"),
});
