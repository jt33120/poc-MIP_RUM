// « Copier pour mon IA de code » (30/09/2026) : pour chaque parcours de /installer,
// un prompt prêt à coller dans un assistant de code (Claude Code, Cursor, Copilot…),
// qui lui dit quoi installer, où, avec quelles valeurs, et quoi ne pas toucher.
//
// Réservé à la console, où l'application est connue : le prompt porte ses vraies
// valeurs (identifiant, adresses, domaines). Il ne porte JAMAIS la clé d'API, même
// remise dans l'onglet : coller un prompt, c'est l'envoyer au fournisseur de l'IA. Il
// demande au contraire à l'assistant de lire la clé dans une variable d'environnement
// et de la réclamer à l'utilisateur.
//
// Module pur : les codes viennent des mêmes constructeurs que la page (buildSnippet,
// codeNext*, directivesCsp, recettesAgentsOtel, strategieExtension) — le prompt et
// les blocs à copier ne peuvent pas diverger.
import type { RecetteAgent } from "./recettes-agents-otel";
import { REPERE_CLE_API } from "./recettes-agents-otel";

const bloc = (langage: string, code: string) => `\`\`\`${langage}\n${code}\n\`\`\``;

const CLE = `La clé d'API MIP n'est PAS dans ce prompt. Ne l'écris jamais en dur dans le dépôt : là où le code porte le repère \`${REPERE_CLE_API}\`, lis-la dans une variable d'environnement, ajoute cette variable (vide) au fichier d'exemple d'environnement du projet s'il en existe un, et demande-moi sa valeur à la fin.`;

export interface EntreePromptSdk {
  app: string;
  nom: string;
  origines: readonly string[];
  snippet: string;
  snippetConsent: string;
  codeAppRouter: string;
  codePagesRouter: string;
  csp: { scriptSrc: string; connectSrc: string };
}

export function promptSdk(e: EntreePromptSdk): string {
  return [
    `Installe le SDK navigateur de MIP RUM (Real User Monitoring, au format OpenTelemetry) dans ce projet web, pour l'application MIP « ${e.nom} » (identifiant \`${e.app}\`). Le SDK mesure, dans le navigateur de chaque visiteur, les Web Vitals, les erreurs JavaScript, les sessions et les appels réseau. Il ne demande aucune dépendance npm : c'est un script servi par MIP, plus un appel d'initialisation.`,
    "",
    "## Ce que tu dois faire",
    "1. Détermine la pile du projet en lisant package.json et l'arborescence : HTML statique / Vite / Create React App, Next.js (App Router ou Pages Router), ou autre framework.",
    "2. Ajoute le SDK UNE seule fois, dans le <head> commun à toutes les pages, AVANT tout autre script, avec le code qui correspond à la pile :",
    "",
    "HTML, Vite, Create React App (index.html) :",
    bloc("html", e.snippet),
    "",
    "Next.js, App Router (app/layout.tsx) :",
    bloc("tsx", e.codeAppRouter),
    "",
    "Next.js, Pages Router (pages/_document.tsx) :",
    bloc("tsx", e.codePagesRouter),
    "",
    "Autre framework : place l'équivalent du bloc HTML dans le gabarit HTML commun.",
    "",
    `3. ${CLE} Pour une application construite, utilise la variable publique du bundler (par exemple \`NEXT_PUBLIC_MIP_RUM_API_KEY\` ou \`VITE_MIP_RUM_API_KEY\`) : cette clé finit de toute façon dans la page, elle identifie l'application et ne protège rien.`,
    `4. Si le projet définit une Content-Security-Policy (en-têtes dans la configuration du framework, balise <meta>, middleware ou serveur), ajoute sans rien retirer : \`${e.csp.scriptSrc}\` et \`${e.csp.connectSrc}\`. Le bloc d'initialisation est un script en ligne : si la CSP l'interdit, déplace-le dans un fichier JavaScript du site.`,
    "5. Si le site a une bannière de consentement aux cookies, utilise plutôt cette variante, et appelle `MIPRum.consent(true)` à l'endroit où l'utilisateur accepte :",
    bloc("html", e.snippetConsent),
    "",
    "## Ce que tu ne dois pas faire",
    "- Ne change pas les adresses du script et de la collecte : elles sont celles de MIP.",
    "- N'ajoute aucun paquet, ne modifie rien d'autre que ce qu'il faut pour ces étapes.",
    "",
    "## Pour finir",
    `Résume les fichiers modifiés. Rappelle-moi que seuls les domaines déclarés dans MIP peuvent envoyer des mesures (${e.origines.length ? e.origines.join(", ") : "aucun déclaré pour l'instant : à demander à l'administrateur MIP"}), puis dis-moi de mettre en ligne, d'ouvrir le site et de naviguer : la page Installer de la console MIP passe au vert quand les premières mesures arrivent.`,
  ].join("\n");
}

export interface EntreePromptExtension {
  nom: string;
  zip: string;
  strategie: string;
  nommage: string;
  hotes: readonly string[];
}

export function promptExtension(e: EntreePromptExtension): string {
  return [
    `Aide-moi à déployer l'extension navigateur MIP RUM sur un parc de postes Chrome ou Edge gérés, pour l'application MIP « ${e.nom} ». L'extension mesure, dans le navigateur des postes où elle est installée, ce que vivent les utilisateurs des domaines déclarés (${e.hotes.length ? e.hotes.join(", ") : "aucun domaine enregistré pour l'instant : à demander à l'administrateur MIP"}), sans toucher au code du site. Elle n'embarque aucune clé : c'est l'enregistrement du domaine auprès de MIP qui ouvre la collecte.`,
    "",
    "## Ce que tu dois faire",
    "1. Demande-moi mon outil d'administration du parc (stratégies de groupe Windows, Microsoft Intune, Google Admin, Jamf…) et les navigateurs concernés (Chrome, Edge ou les deux).",
    "2. Traduis pour cet outil la stratégie `ExtensionSettings` ci-dessous : installation forcée, et accès aux domaines accordé d'avance. `update_url` doit viser l'hébergement du paquet signé (.crx) et de son `update.xml` par notre service informatique : demande-moi cette adresse si elle est encore à remplacer.",
    bloc("json", e.strategie),
    "",
    "3. Facultatif : pour nommer les postes dans l'inventaire MIP, traduis aussi cette seconde stratégie, en remplaçant `${machine_name}` par la variable du nom de machine de l'outil (%COMPUTERNAME% pour les GPO et Intune, $COMPUTERNAME pour Jamf). Jamais un nom de personne.",
    bloc("json", e.nommage),
    "",
    `4. Pour un pilote sur quelques postes, sans outil de parc : explique l'installation manuelle depuis ${e.zip} (dézipper dans un dossier stable, chrome://extensions ou edge://extensions, mode développeur, « Charger l'extension non empaquetée »).`,
    "",
    "## Pour finir",
    "Donne-moi les étapes dans l'outil choisi, puis comment vérifier sur un poste : l'icône MIP RUM affiche « MIP RUM observe ce domaine. » sur un site déclaré, et la page Installer de la console MIP passe au vert.",
  ].join("\n");
}

export function promptServeur(r: RecetteAgent, nom: string): string {
  return [
    `Instrumente ce service ${r.titre} avec l'agent OpenTelemetry OFFICIEL (${r.precision}), pour qu'il envoie ses traces et ses journaux à MIP RUM, application « ${nom} ». Aucun code MIP à installer : l'agent standard, réglé par des variables d'environnement \`OTEL_*\`. Il relie chaque appel du navigateur à sa part côté serveur.`,
    "",
    "## La recette (variables, installation de l'agent, lancement)",
    bloc("bash", r.code),
    "",
    "## Ce que tu dois faire",
    "1. Trouve comment ce service démarre vraiment (Dockerfile, Procfile, scripts de package.json, unité systemd, manifeste de déploiement…) et applique-y la recette : installe l'agent comme dépendance du projet, et lance le processus sous l'agent.",
    "2. Mets les variables `OTEL_*` dans la configuration d'environnement du déploiement, pas dans le code. Garde `OTEL_SERVICE_NAME` tel quel, sauf si je te dis autrement : c'est le nom qu'affichera le Tracing de MIP.",
    `3. ${CLE} Côté serveur, elle est secrète : sa place est dans le gestionnaire de secrets du déploiement.`,
    "4. Si l'API est appelée depuis un site d'une autre origine, ajoute `traceparent, tracestate` aux en-têtes autorisés de sa réponse CORS (Access-Control-Allow-Headers).",
    "",
    "## Les pièges connus",
    ...r.pieges.map((p) => `- ${p}`),
    "",
    `Documentation de l'agent : ${r.documentation}`,
    "",
    "## Pour finir",
    "Résume les fichiers modifiés, puis dis-moi de relancer le service et d'ouvrir une page du site qui appelle l'API : la page Installer de la console MIP passe au vert quand les premières traces serveur arrivent.",
  ].join("\n");
}
