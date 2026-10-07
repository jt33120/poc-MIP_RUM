// Ce que la console donne au service informatique d'un client pour déployer
// l'extension : son identifiant, son paquet téléchargeable et les deux stratégies
// d'entreprise à coller. Module pur, partagé par `/select/new` (mode extension) et
// `/installer` : l'identifiant et les stratégies vivaient dans la première seule, et
// une seconde copie aurait pu diverger d'un caractère sans que rien ne le voie —
// une stratégie qui vise un autre identifiant n'installe rien, en silence.

/**
 * L'identifiant de l'extension, dérivé de la clé publique de son manifeste
 * (champ `key` de apps/extension/manifest.json) : stable d'un build à
 * l'autre, c'est lui que la stratégie d'entreprise référence.
 */
export const EXTENSION_ID = "gglpcalhlkfhgipfmemfiedjomifefba";

/** Le paquet à charger « non empaqueté », servi par la console (refait par `pnpm --filter ./apps/extension pack`). */
export const ZIP_EXTENSION = "/downloads/mip-rum-extension.zip";

/** La référence de l'empaquetage (sideload, .crx et stratégie d'entreprise), pour le service informatique. */
export const DOC_DEPLOIEMENT_EXTENSION = "https://github.com/jt33120/poc-MIP_RUM/blob/master/apps/extension/README.md";

/** L'adresse du manifeste de mise à jour quand elle n'est pas configurée : un gabarit à remplacer. */
export const UPDATE_URL_GABARIT = "https://<votre-hebergement>/update.xml";

/**
 * La stratégie `ExtensionSettings` : installation forcée, et accès PRÉ-ACCORDÉ aux
 * domaines (`runtime_allowed_hosts`) — l'employé n'a plus le clic d'autorisation à
 * faire. Sans domaine connu, un exemple à remplacer plutôt qu'une liste vide, qui
 * n'accorderait rien.
 */
export function strategieExtension(hotes: readonly string[], updateUrl: string | null): string {
  const autorises = hotes.length ? hotes.map((h) => `*://${h}`) : ["*://app.client.fr"];
  return JSON.stringify(
    {
      [EXTENSION_ID]: {
        installation_mode: "force_installed",
        update_url: updateUrl ?? UPDATE_URL_GABARIT,
        runtime_allowed_hosts: autorises,
      },
    },
    null,
    2,
  );
}

/**
 * La stratégie de NOMMAGE des postes, séparée d'`ExtensionSettings` : Chrome range la
 * configuration destinée à une extension sous `3rdparty`, et elle lui parvient par
 * `chrome.storage.managed` sous la clé `poste` (`apps/extension/managed-schema.json`).
 * MIP ne fabrique jamais ce libellé : sans cette stratégie, l'inventaire reste anonyme.
 */
export function strategieNommage(): string {
  return JSON.stringify({ "3rdparty": { extensions: { [EXTENSION_ID]: { poste: "${machine_name}" } } } }, null, 2);
}
