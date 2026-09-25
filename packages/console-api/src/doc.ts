// LA DOC DE console-api, GÉNÉRÉE DEPUIS SA TABLE.
//
// `docs/api/console-api.md` est ce qu'une DSI relit pour savoir qui a le droit
// de quoi. Écrit à la main, il divergerait de la table dès la première PR ;
// généré, il ne le peut pas : `tests/unit/console-api-doc.test.ts` échoue si le
// fichier versionné n'est plus ce que la table rend.
import { CODES_ERREUR } from "@mip/console-contract";
import type { Enregistrement } from "./politique";

const AUTH: Record<string, string> = {
  public: "aucune session",
  session: "session",
  admin: "session administrateur",
  "admin-plateforme": "administrateur de la plateforme",
};
const PORTEE: Record<string, string> = {
  globale: "—",
  app: "`app` de la requête, dans le périmètre (`all` = périmètre effectif)",
  "une-app": "`app` de la requête : UNE application nommée du périmètre (`all` refusé)",
  ressource: "ressource du chemin, résolue dans le périmètre",
};

export function rendreDoc(table: readonly Enregistrement[]): string {
  const L: string[] = [];
  L.push("# `console-api` — la table des opérations");
  L.push("");
  L.push("> **Généré** depuis la table du service (`packages/console-api/src/table.ts`) : `MAJ_DOC_CONSOLE_API=1 pnpm vitest run tests/unit/console-api-doc.test.ts`. Un test échoue si ce fichier n'est plus ce que la table rend : il ne peut pas diverger du code. Contexte : [docs/architecture/console-api/README.md](../architecture/console-api/README.md).");
  L.push("");
  L.push("**Seul client : le serveur de la console** (Vercel). Cette surface n'est publiée ni dans l'OpenAPI de l'API v1, ni sur `/api-docs`. Les machines (partenaires, CI, MCP) passent par le service `api`, en lecture seule.");
  L.push("");
  L.push("## Les gardes, dans l'ordre");
  L.push("");
  L.push("Chaque requête les passe toutes, avant le traitement (`packages/console-api/src/pipeline.ts`) :");
  L.push("");
  L.push("1. identifiant de requête, et échéance `x-mip-deadline-ms` bornée entre 200 et 15 000 ms ;");
  L.push("2. **secret client** `x-mip-client`, comparé en temps constant (deux valeurs pendant une rotation) : absent ou faux, **404 nu**, indiscernable d'un chemin inconnu ;");
  L.push("3. un en-tête `Origin` est refusé (403) : aucun navigateur, et aucun en-tête CORS n'est jamais émis ;");
  L.push("4. la route (404, ou 405 avec `allow`) ;");
  L.push("5. la **session** (`Authorization: Bearer`) : un jeton ES256 qui ne porte qu'un identifiant, vérifié par signature PUIS relu en base (`console_session` jointe au compte) — rôle et périmètre viennent de la base, jamais du jeton ; une session révoquée ou un compte désactivé est refusé en 30 s au plus (cache par réplique) ; base injoignable : 503, pas 401 ;");
  L.push("6. la **démo** (toute écriture refusée), le **rôle**, la **portée** : l'application demandée est confrontée au périmètre AVANT le traitement ;");
  L.push("7. l'**entrée** : paramètres et corps validés, champ inconnu ou répété refusé (400), corps JSON sous plafond (413) ;");
  L.push("8. le **débit** par principal (429 avec `retry-after`) ;");
  L.push("   - 8 bis. la **ressource du chemin** (portée « ressource ») : son application est lue en base et confrontée au périmètre ; absente OU hors périmètre, c'est le même 404 `ressource_inconnue` — un identifiant deviné ne dit pas s'il existe ailleurs ;");
  L.push("9. le **traitement**, sous l'échéance (503 au-delà) ;");
  L.push("10. l'enveloppe `{ meta: { request_id }, data }`, `cache-control: no-store`, signée `x-mip-console-api: 1`. Une panne rend 500 et un message générique ; sa cause reste au journal, avec le `request_id`.");
  L.push("");
  L.push("**Règles vérifiées au démarrage** (`verifierTable`) : toute écriture est refusée à la démo (sauf fermer sa propre session) et déclare son action d'audit, ou une exemption motivée ; seule une lecture publique peut se passer du secret client ; une opération publique n'a pas de portée ; la portée « une application nommée » est celle d'une écriture. Un service dont la table viole une règle ne démarre pas.");
  L.push("");
  L.push("**Les écritures de la console (C6 → C10)** sont des COMMANDES (`apps/console/lib/commandes/`), servies telles quelles : chacune déclare sa règle (authentification, portée, audit), que la console applique aussi tant qu'elle les exécute elle-même (`refusDAcces` du contrat). Une commande rend sa DÉCISION en 200 (créé, introuvable, conflit de révision…) ; un refus d'accès ou d'entrée part avant elle, avec son code. L'action d'audit s'écrit dans la même transaction que l'écriture.");
  L.push("");
  L.push("## Les opérations");
  L.push("");
  L.push("| Opération | Méthode et chemin | Authentification | Portée | Démo | Secret client | Audit |");
  L.push("|---|---|---|---|---|---|---|");
  const tries = [...table].sort((a, b) => a.operation.chemin.localeCompare(b.operation.chemin) || a.operation.methode.localeCompare(b.operation.methode));
  for (const { operation: o, politique: p } of tries) {
    const portee = p.ressource ? `ressource \`{${p.ressource.parametre}}\` de \`${p.ressource.table}\`, dans le périmètre` : PORTEE[p.portee];
    const audit = p.audit === undefined ? "—" : typeof p.audit === "string" ? `\`${p.audit}\`` : `exemptée : ${p.audit.exempt}`;
    L.push(
      `| \`${o.id}\` | \`${o.methode} ${o.chemin}\` | ${AUTH[p.auth]} | ${portee} | ${p.demo === "lecture" ? "lecture" : "**refusée**"} | ${p.secretClient === "aucun" ? "**non exigé**" : "exigé"} | ${audit} |`,
    );
  }
  L.push("");
  L.push("## Les codes d'erreur");
  L.push("");
  L.push("Un code est un contrat : on en ajoute, on n'en renomme pas. Le corps d'un refus est `{ meta: { request_id }, error: { code, message, details? } }`.");
  L.push("");
  L.push("| Code | Statut |");
  L.push("|---|---|");
  for (const [code, statut] of Object.entries(CODES_ERREUR)) L.push(`| \`${code}\` | ${statut} |`);
  L.push("");
  return L.join("\n");
}
