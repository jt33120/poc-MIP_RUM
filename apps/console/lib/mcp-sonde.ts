// Le serveur MCP répond-il, là, maintenant ?
//
// POURQUOI LA PAGE LE DEMANDE AU LIEU DE L'AFFIRMER. L'adresse du serveur est
// une constante du dépôt (mcp-public.ts). Si le service tombe, ou si son domaine
// Railway change sans que la constante suive, la page continuerait à distribuer
// une URL morte — et l'utilisateur en conclurait que le produit ne marche pas.
// C'est la même règle que pour la purge de rétention et la latence d'alerte :
// une affirmation qui peut devenir fausse sans qu'on touche au code ne doit pas
// être écrite dans le code.
//
// ÉCHEC DOUX, TOUJOURS. Une sonde qui échoue ne doit pas casser la page : elle
// dit « je n'ai pas pu vérifier », ce qui est vrai, plutôt que de laisser croire
// à une panne du serveur MCP alors que c'est peut-être le réseau sortant de la
// console qui est en cause.
import { MCP_ORIGINE } from "./mcp-public";

export interface EtatMcp {
  /** true = /health a répondu 200 avec le bon service. */
  joignable: boolean;
  version: string | null;
  /** Ce qui a empêché la vérification, quand elle n'a pas abouti. */
  motif: string | null;
}

/** Au-delà, on rend la main : la page ne doit pas attendre le serveur MCP. */
const DELAI_MS = 3000;

export async function sonderMcp(origine = MCP_ORIGINE): Promise<EtatMcp> {
  try {
    const r = await fetch(`${origine}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!r.ok) return { joignable: false, version: null, motif: `HTTP ${r.status}` };
    const j = (await r.json()) as { service?: string; name?: string; version?: string };
    // On vérifie l'identité du service, pas seulement le code 200 : un proxy ou
    // une page d'attente d'hébergeur répond 200 avec tout autre chose.
    if (j?.service !== "mcp")
      return { joignable: false, version: null, motif: "réponse inattendue sur /health" };
    return { joignable: true, version: j.version ?? null, motif: null };
  } catch (e) {
    const nom = (e as Error)?.name;
    return {
      joignable: false,
      version: null,
      motif: nom === "TimeoutError" ? `pas de réponse en ${DELAI_MS / 1000} s` : "injoignable depuis la console",
    };
  }
}
