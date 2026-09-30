// LES ROUTES DE L'API v1 SERVIES PAR LE SERVICE `api` SEUL — la console les TRANSMET.
//
// POURQUOI. Les routes historiques de l'API v1 vivent dans la console et gardent un
// chemin local (la console lit la base quand le relais ne répond pas). Une route
// NOUVELLE ne peut plus en avoir : le cliquet de la console sans base
// (`tests/unit/inventaire-console.test.ts`) refuse qu'une route de plus atteigne
// la base, et la cible est une console qui ne fait que l'interface. Ces routes-là
// naissent donc dans l'état final des autres : calculées par le service `api`
// (table `ROUTES_SERVICE_SEUL` de `services/api/routeur.mjs`, implémentations dans
// `lib/api/service/`), et la console ne fait que transmettre — sans pourcentage,
// sans drapeau, sans repli local : il n'y a rien à quoi se replier.
//
// CE QUI EST TRANSMIS : une lecture au JETON (`Authorization: Bearer …`), en GET ou
// HEAD, avec les seuls en-têtes de `ENTETES_TRANSMIS` (ni cookie, ni adresse). Une
// session de la console n'est pas transmise — le service ne vérifie pas les
// sessions — : elle reçoit 401, avec la raison. Une réponse non signée
// (`x-mip-api`), un 5xx, un délai dépassé : 503, que le client rejoue.
//
// PUR côté base : ni `lib/db.ts`, ni le drapeau du relais (`lib/api-relay-commun.ts`).
import { corsHeaders } from "./cors";
import { DELAIS, ENTETE_API, ENTETES_TRANSMIS, NON_RECOPIES, lireUrlRelaisApi } from "../api-relay-commun";

/** Ce que le module lit du monde : injectable pour les tests. */
export interface DependancesTransmission {
  env?: () => Record<string, string | undefined>;
  fetch?: typeof fetch;
}

function refus(req: Request, status: number, error: string, code: string, entetes: Record<string, string> = {}): Response {
  return Response.json({ error, code }, { status, headers: { ...corsHeaders(req.headers.get("origin")), ...entetes } });
}

/**
 * Le gestionnaire GET (et HEAD) d'une route servie par le service seul.
 */
export function creerTransmission(deps: DependancesTransmission = {}) {
  const env = deps.env ?? (() => process.env);
  const fetcher = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  return async function transmettre(req: Request): Promise<Response> {
    if (!/^Bearer\s+\S/i.test(req.headers.get("authorization") ?? "")) {
      return refus(
        req,
        401,
        "route servie par le service de lecture, au jeton seulement (en-tête Authorization: Bearer <token>) : une session de la console n'y est pas transmise",
        "jeton_requis",
      );
    }
    const base = lireUrlRelaisApi(env());
    if (!base) {
      return refus(req, 503, "service de lecture non joignable depuis cette console", "service_indisponible", { "retry-after": "5" });
    }

    const url = new URL(req.url);
    const entetes = new Headers();
    for (const nom of ENTETES_TRANSMIS) {
      const v = req.headers.get(nom);
      if (v !== null) entetes.set(nom, v);
    }
    let res: Response;
    try {
      res = await fetcher(`${base}${url.pathname}${url.search}`, {
        method: req.method,
        headers: entetes,
        redirect: "manual",
        signal: AbortSignal.timeout(DELAIS.reponseMs),
      });
    } catch {
      return refus(req, 503, "service de lecture indisponible, réessayer", "service_indisponible", { "retry-after": "5" });
    }
    // Une réponse non signée vient du routeur de l'hébergeur, pas du service : elle
    // ne dit rien de la route. Un 5xx du service, pareil — le client rejoue.
    if (res.headers.get(ENTETE_API) !== "1" || res.status >= 500) {
      await res.body?.cancel().catch(() => {});
      return refus(req, 503, "service de lecture indisponible, réessayer", "service_indisponible", { "retry-after": "5" });
    }
    const sortie = new Headers();
    for (const [nom, valeur] of res.headers) if (!NON_RECOPIES.has(nom)) sortie.append(nom, valeur);
    return new Response(req.method.toUpperCase() === "HEAD" ? null : res.body, { status: res.status, headers: sortie });
  };
}

/** La transmission de l'instance : `export const GET = transmettreAuService` dans la route. */
export const transmettreAuService = creerTransmission();
