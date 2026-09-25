// UNE ÉCRITURE, EXÉCUTÉE PAR LA CONSOLE ELLE-MÊME (jusqu'à la bascule vers console-api).
//
// La server action appelle sa commande PAR SA CLÉ (`executerCommande("creerObjectif",
// { app, corps })`) et reçoit ce que console-api rendrait : la décision de la
// commande passée par JSON, ou le refus qui l'a arrêtée avant. Ici se rejouent, dans
// l'ordre du pipeline du service, les gardes qui précèdent une commande :
//   1. la session (`getUser`) ;
//   2. la RÈGLE de la commande — démo, rôle, application (`refusDAcces`, le même
//      code que confronte `tests/unit/console-api-commandes.test.ts` au pipeline) ;
//   3. l'ENTRÉE : le corps passé par JSON (ce que le fil en ferait), puis son
//      validateur, et les paramètres du chemin — ceux de la commande, les mêmes
//      que le service applique.
//
// C'est le point unique de la bascule (après P6b) : ce module appellera alors
// l'opération (`COMMANDES` du contrat) au lieu de la commande, et les server
// actions — qui n'importent AUCUNE commande, seulement cette fonction et des types —
// cesseront d'atteindre la base sans changer d'une ligne. Il lit la session : il ne
// part jamais dans le bundle de console-api (la garde du build refuse `lib/auth.ts`).
import { headers } from "next/headers";
import { refusDAcces, type CleCommande, type Fil, type ResultatCommande } from "@mip/console-contract";
import { getUser } from "./auth";
import { versLeFil } from "./chargeurs/commun";
import { COMMANDES_CONSOLE } from "./commandes";
import type { Commande, CommandeQuelconque } from "./commandes/commun";

type Registre = typeof COMMANDES_CONSOLE;

/** La décision d'une commande, telle que la server action la reçoit : passée par JSON. */
export type SortieDe<K extends CleCommande> = Registre[K] extends Commande<infer _P, infer _B, infer R> ? Fil<R> : never;

export interface AppelCommande {
  /** L'application visée, pour une commande de portée `app` ; absente sinon. */
  readonly app?: string | null;
  /** Les paramètres du chemin de l'opération (`{ id: "12" }`), en chaînes comme dans une URL. */
  readonly chemin?: Readonly<Record<string, string>>;
  /** Le corps, tel que le fil le porterait : validé ici par la commande. */
  readonly corps?: unknown;
}

/** L'identifiant de la requête de la console (posé par le middleware), s'il y en a une. */
async function requeteCourante(): Promise<string | null> {
  try {
    return (await headers()).get("x-request-id");
  } catch {
    // Hors requête (tests d'une server action) : pas d'identifiant, l'audit s'écrit sans.
    return null;
  }
}

export async function executerCommande<K extends CleCommande>(cle: K, appel: AppelCommande = {}): Promise<ResultatCommande<SortieDe<K>>> {
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
    requestId: await requeteCourante(),
  });
  return { ok: true, data: versLeFil(data) as SortieDe<K> };
}
