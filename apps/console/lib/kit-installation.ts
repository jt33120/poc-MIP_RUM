// LE KIT D'INSTALLATION (« À faire » X11) : ce que la page « Installer » écrit pour le
// client au-delà des deux balises du code de suivi — le consentement branché sur son
// outil, le rejeu et son masquage, le filtre de ses données personnelles,
// l'échantillonnage, la version déployée et les source maps, la mention de
// confidentialité, et les jetons à renouveler.
//
// POURQUOI LA CONSOLE ÉCRIT LE CODE. Chacun de ces réglages vit dans le code du
// client (`init-mip-rum.js`, sa chaîne de construction, sa politique de
// confidentialité) : MIP ne peut pas les changer à sa place. Plutôt que de lui faire
// lire la documentation, la page lui rend le fichier complet, à ses valeurs, prêt à
// coller. Module pur : `tests/unit/kit-installation.test.ts` exécute le code produit.
import { REPERE_CLE_API } from "./recettes-agents-otel";

// ─── Les réglages ────────────────────────────────────────────────────────────

export const OUTILS_CONSENTEMENT = ["aucun", "axeptio", "didomi", "tarteaucitron", "autre"] as const;
export type OutilConsentement = (typeof OUTILS_CONSENTEMENT)[number];

export const LIBELLE_OUTIL: Record<OutilConsentement, string> = {
  aucun: "Aucun : la mesure démarre sans bandeau",
  axeptio: "Axeptio",
  didomi: "Didomi",
  tarteaucitron: "tarteaucitron.js",
  autre: "Un autre outil",
};

/** Le nom sous lequel MIP RUM est déclaré dans l'outil, tel que l'outil l'attend. */
export const IDENTIFIANT_OUTIL_DEFAUT: Record<OutilConsentement, string> = {
  aucun: "",
  axeptio: "mip_rum",
  didomi: "c:mip-rum",
  tarteaucitron: "miprum",
  autre: "",
};

/** Les niveaux de `replayMask` du SDK (`packages/rum-sdk/src/types.ts`). */
export const NIVEAUX_MASQUAGE = ["all", "media", "inputs"] as const;
export type NiveauMasquage = (typeof NIVEAUX_MASQUAGE)[number];

export const LIBELLE_MASQUAGE: Record<NiveauMasquage, string> = {
  all: "Tout masqué : texte, saisies et images (recommandé)",
  media: "Texte lisible, saisies et images masquées",
  inputs: "Seules les saisies masquées",
};

export const OUTILS_BUILD = ["vite", "webpack"] as const;
export type OutilBuild = (typeof OUTILS_BUILD)[number];

export interface ReglagesKit {
  /** Part des sessions mesurées, de 0,01 à 1 (`sampleRate`). */
  echantillonnage: number;
  consentement: OutilConsentement;
  /** Le nom de MIP RUM dans l'outil de consentement (fournisseur Axeptio, Didomi…). */
  identifiantOutil: string;
  /** Part des sessions enregistrées en rejeu, de 0 (coupé) à 1. */
  rejeu: number;
  masquage: NiveauMasquage;
  /** Sélecteur CSS des zones montrées en clair (`replayUnmask`) ; vide : aucune. */
  zonesDemasquees: string;
  /** Un `beforeSend` qui retire adresses e-mail et longs numéros avant l'envoi. */
  filtreDonnees: boolean;
  /** La version déployée passée au SDK, écrite au build par le script des source maps. */
  release: boolean;
  outilBuild: OutilBuild;
}

export const REGLAGES_PAR_DEFAUT: ReglagesKit = {
  echantillonnage: 1,
  consentement: "aucun",
  identifiantOutil: "",
  rejeu: 0,
  masquage: "all",
  zonesDemasquees: "",
  filtreDonnees: true,
  release: true,
  outilBuild: "vite",
};

/** Les taux proposés, du plus prudent au plus complet. */
export const TAUX_REJEU = [0, 0.1, 0.25, 0.5, 1] as const;
export const TAUX_ECHANTILLONNAGE = [0.1, 0.25, 0.5, 1] as const;

/** Un taux lisible : 0,1 → « 10 % ». */
export function pourcent(taux: number): string {
  return `${Math.round(taux * 100)} %`;
}

/** Un taux saisi, ramené dans [min, 1] et arrondi au centième. */
export function bornerTaux(x: number, min = 0): number {
  if (!Number.isFinite(x)) return 1;
  return Math.round(Math.min(1, Math.max(min, x)) * 100) / 100;
}

// ─── Le fichier de configuration ─────────────────────────────────────────────

/**
 * La ligne que le script des source maps remplace par `release: "<version>",`.
 * Tant qu'elle n'est pas remplacée (poste de développement), c'est un commentaire.
 */
export const MARQUE_RELEASE = "// mip:release";

/** Le nom du fichier de configuration, servi par le site à côté de ses pages. */
export const FICHIER_INIT = "init-mip-rum.js";

export interface IdentiteApplication {
  endpoint: string;
  appId: string;
  clientId: string | null;
}

/**
 * Le filtre de dernière chance (`beforeSend`) : il ne touche que les attributs qui
 * portent du texte libre — adresses, messages, piles, cibles de clic, propriétés —,
 * jamais un identifiant de trace, de span ou de session, qu'un remplacement de
 * chiffres casserait.
 */
const FILTRE_DONNEES = [
  "    // Dernier filtre, dans le navigateur, avant tout envoi : les adresses e-mail et les",
  "    // longs numéros (téléphone, IBAN, numéro client) que l'application aurait mis dans",
  "    // une adresse, un message d'erreur ou un libellé. L'ingestion de MIP nettoie aussi",
  "    // ce qu'elle reconnaît ; ce filtre agit plus tôt, et peut être complété.",
  "    beforeSend: function (attributs) {",
  "      for (var cle in attributs) {",
  "        var valeur = attributs[cle];",
  "        if (typeof valeur === \"string\" && /(url|full|message|stack|stacktrace|target|props|referrer|title)$/i.test(cle)) {",
  "          attributs[cle] = valeur",
  "            .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g, \"[email]\")",
  "            .replace(/\\d{9,}/g, \"[numéro]\");",
  "        }",
  "      }",
  "      return attributs;",
  "    },",
];

/** Le pont entre l'outil de consentement du site et `MIPRum.consent()`. */
export function pontConsentement(outil: OutilConsentement, identifiant: string): string[] {
  const id = JSON.stringify(identifiant.trim() || IDENTIFIANT_OUTIL_DEFAUT[outil]);
  switch (outil) {
    case "aucun":
      return [];
    case "axeptio":
      return [
        `  // Axeptio : MIP RUM doit être déclaré dans le projet Axeptio sous le nom ${id}.`,
        "  window._axcb = window._axcb || [];",
        "  window._axcb.push(function (axeptio) {",
        "    axeptio.on(\"cookies:complete\", function (choix) {",
        `      MIPRum.consent(!!choix[${id}]);`,
        "    });",
        "  });",
      ];
    case "didomi":
      return [
        `  // Didomi : MIP RUM doit être un fournisseur de la notice, d'identifiant ${id}.`,
        "  window.didomiOnReady = window.didomiOnReady || [];",
        "  window.didomiOnReady.push(function (Didomi) {",
        "    // Sans réponse du visiteur, le fournisseur n'a pas encore de statut : on attend.",
        "    function appliquer(statut) {",
        "      var actif = statut && typeof statut === \"object\" ? statut.enabled : statut;",
        "      if (actif === true) MIPRum.consent(true);",
        "      else if (actif === false) MIPRum.consent(false);",
        "    }",
        `    appliquer((Didomi.getCurrentUserStatus().vendors || {})[${id}]);`,
        `    Didomi.addVendorStatusListener(${id}, appliquer);`,
        "  });",
      ];
    case "tarteaucitron":
      return [
        "  // tarteaucitron.js (chargé avant ce fichier) : MIP RUM déclaré comme un service,",
        "  // puis ajouté à la file. Le refus efface lui-même ce que le SDK a écrit.",
        "  if (window.tarteaucitron) {",
        `    tarteaucitron.services[${id}] = {`,
        `      key: ${id},`,
        "      type: \"analytic\",",
        "      name: \"MIP RUM (mesure de performance)\",",
        "      needConsent: true,",
        "      cookies: [],",
        "      js: function () { MIPRum.consent(true); },",
        "      fallback: function () { MIPRum.consent(false); }",
        "    };",
        `    (tarteaucitron.job = tarteaucitron.job || []).push(${id});`,
        "  }",
      ];
    case "autre":
      return [
        "  // Votre outil de consentement : à chaque page, dès qu'il connaît la réponse du",
        "  // visiteur (enregistrée ou qu'il vient de donner), il appelle l'une des deux :",
        "  //   MIPRum.consent(true);   // accord : ce qui attendait en mémoire part",
        "  //   MIPRum.consent(false);  // refus : tout est jeté, le stockage effacé",
      ];
  }
}

/** Le contenu complet d'`init-mip-rum.js`, aux valeurs de l'application et des réglages. */
export function fichierInit(app: IdentiteApplication, r: ReglagesKit): string {
  const champs: string[] = [
    `    endpoint: ${JSON.stringify(app.endpoint)},`,
    `    appId: ${JSON.stringify(app.appId)},`,
  ];
  if (app.clientId) champs.push(`    clientId: ${JSON.stringify(app.clientId)},`);
  champs.push(`    apiKey: ${JSON.stringify(REPERE_CLE_API)},`, `    env: "production",`);
  if (r.release) champs.push(`    ${MARQUE_RELEASE} — remplacée au build par la version déployée (mip-sourcemaps.mjs)`);
  const echantillon = bornerTaux(r.echantillonnage, 0.01);
  champs.push(`    sampleRate: ${echantillon}, // ${pourcent(echantillon)} des sessions mesurées`);
  if (r.consentement !== "aucun") champs.push("    requireConsent: true, // rien ne part avant MIPRum.consent(true)");
  const rejeu = bornerTaux(r.rejeu);
  if (rejeu > 0) {
    champs.push(`    replay: ${rejeu}, // ${pourcent(rejeu)} des sessions enregistrées en rejeu`);
    champs.push(`    replayMask: ${JSON.stringify(r.masquage)},`);
    const zones = r.zonesDemasquees.trim();
    if (zones && r.masquage !== "inputs") champs.push(`    replayUnmask: ${JSON.stringify(zones)}, // montrées en clair`);
  }
  if (r.filtreDonnees) champs.push(...FILTRE_DONNEES);
  // Pas de virgule après le dernier champ : un vieux moteur la refuserait.
  const dernier = champs.length - 1;
  champs[dernier] = champs[dernier].replace(/,(\s*(\/\/.*)?)$/, "$1");
  const pont = pontConsentement(r.consentement, r.identifiantOutil);
  return [
    `// ${FICHIER_INIT} — écrit par la console MIP RUM (page « Installer ») pour ${app.appId}.`,
    "// Un fichier externe plutôt qu'un script en ligne : il passe une politique de",
    "// sécurité stricte (script-src sans 'unsafe-inline').",
    "(function () {",
    "  if (typeof MIPRum === \"undefined\") return; // script bloqué : le site vit sans mesure",
    "  MIPRum.init({",
    ...champs,
    "  });",
    ...pont,
    "})();",
    "",
  ].join("\n");
}

/** Les deux balises de l'en-tête, avec le fichier de configuration servi par le site. */
export function balisesEnTete(sdkUrl: string): string {
  return [
    "<!-- MIP RUM : en tête du <head>, avant les autres scripts. -->",
    `<script src=${JSON.stringify(sdkUrl)}></script>`,
    `<script src="/${FICHIER_INIT}"></script>`,
  ].join("\n");
}

/** Un exemple de marquage des zones, dans le HTML du site. */
export const EXEMPLE_ZONES = [
  "<!-- Montré en clair dans le rejeu, même sous le masquage « tout masqué » : -->",
  '<nav class="mip-rum-unmask">…le menu…</nav>',
  "",
  "<!-- Jamais enregistré, quel que soit le niveau : -->",
  '<section class="mip-rum-block">…un dossier médical, un RIB…</section>',
].join("\n");

// ─── La version et les source maps ───────────────────────────────────────────

/**
 * Les variables qui portent le commit déployé, par plateforme de construction. Le
 * script prend la première présente ; `MIP_RELEASE` les remplace toutes.
 */
export const VARIABLES_RELEASE = ["MIP_RELEASE", "VERCEL_GIT_COMMIT_SHA", "COMMIT_REF", "GITHUB_SHA", "CI_COMMIT_SHA"] as const;

/** Où se règlent les source maps, par outil de construction. */
export const REGLAGE_SOURCEMAPS: Record<OutilBuild, { fichier: string; code: string; dossier: string }> = {
  vite: {
    fichier: "vite.config.js",
    // `hidden` : les maps sont produites sans le commentaire qui les rendrait publiques.
    code: "export default defineConfig({\n  // …\n  build: { sourcemap: \"hidden\" },\n});",
    dossier: "dist",
  },
  webpack: {
    fichier: "webpack.config.js",
    code: "module.exports = {\n  // …\n  devtool: \"hidden-source-map\",\n};",
    dossier: "dist",
  },
};

/**
 * Le script lancé après la construction : la version écrite dans le fichier de
 * configuration, les maps envoyées à MIP si un jeton est là, puis TOUJOURS retirées
 * des fichiers publics. Il n'échoue jamais la construction. C'est celui d'UTI
 * (05/10/2026), rendu indépendant de la plateforme.
 */
export function scriptSourcemaps(o: { appId: string; urlEnvoi: string; dossier: string }): string {
  return `// scripts/mip-sourcemaps.mjs — écrit par la console MIP RUM pour ${o.appId}.
// Lancé après la construction : node scripts/mip-sourcemaps.mjs
//   1. écrit la version déployée dans ${o.dossier}/${FICHIER_INIT}, à la place de « ${MARQUE_RELEASE} » ;
//   2. envoie les source maps à MIP si MIP_SOURCEMAP_TOKEN est posé (jeton « msu_… ») ;
//   3. retire TOUJOURS les maps de ${o.dossier}/ : le code source ne se sert pas au public.
// N'échoue jamais la construction : la mesure ne doit pas empêcher un déploiement.
import { readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// L'environnement de VOTRE construction (plateforme, CI), pas celui de la console.
const variables = process.env;
const DOSSIER = variables.MIP_DIST ?? ${JSON.stringify(o.dossier)};
const APP_ID = ${JSON.stringify(o.appId)};
const URL_ENVOI = variables.MIP_SOURCEMAP_URL ?? ${JSON.stringify(o.urlEnvoi)};
const release = (${VARIABLES_RELEASE.map((v) => `variables.${v}`).join(" ?? ")} ?? "").slice(0, 120);
const jeton = variables.MIP_SOURCEMAP_TOKEN;

const maps = (dossier) =>
  readdirSync(dossier, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? maps(join(dossier, e.name)) : e.name.endsWith(".js.map") ? [join(dossier, e.name)] : []);

async function principal() {
  const fichiers = existsSync(DOSSIER) ? maps(DOSSIER) : [];

  const init = join(DOSSIER, ${JSON.stringify(FICHIER_INIT)});
  if (release && existsSync(init)) {
    const texte = readFileSync(init, "utf8");
    if (texte.includes(${JSON.stringify(MARQUE_RELEASE)})) {
      writeFileSync(init, texte.replace(/^.*\\/\\/ mip:release.*$/m, \`    release: \${JSON.stringify(release)},\`));
      console.log(\`[mip] release \${release} écrite dans ${FICHIER_INIT}\`);
    }
  }

  if (jeton && release) {
    for (const map of fichiers) {
      const filename = map.split(/[\\\\/]/).pop().replace(/\\.map$/, "");
      try {
        const reponse = await fetch(URL_ENVOI, {
          method: "POST",
          headers: { authorization: \`Bearer \${jeton}\`, "content-type": "application/json" },
          body: JSON.stringify({ appId: APP_ID, release, maps: [{ filename, content: JSON.parse(readFileSync(map, "utf8")) }] }),
        });
        console.log(\`[mip] source map \${filename} : \${reponse.status}\`);
      } catch (e) {
        console.log(\`[mip] source map \${filename} : échec (\${e.message})\`);
      }
    }
  } else {
    console.log(\`[mip] source maps non envoyées (\${!jeton ? "MIP_SOURCEMAP_TOKEN absent" : "version déployée inconnue"})\`);
  }

  for (const map of fichiers) rmSync(map);
  console.log(\`[mip] \${fichiers.length} source map(s) retirée(s) de \${DOSSIER}/\`);
}

try {
  await principal();
} catch (e) {
  console.log(\`[mip] étape source maps ignorée : \${e.message}\`);
}
`;
}

/** La commande de construction, avec le script à la suite. */
export function commandeBuild(outil: OutilBuild): string {
  const avant = outil === "vite" ? "vite build" : "webpack --mode production";
  return `"build": "${avant} && node scripts/mip-sourcemaps.mjs"`;
}

/** Le jeton dans la chaîne de construction, par plateforme. */
export const JETON_PAR_PLATEFORME = [
  {
    id: "vercel",
    titre: "Vercel",
    code: "Settings → Environment Variables → MIP_SOURCEMAP_TOKEN (Production, Sensitive)\nLa version vient seule de VERCEL_GIT_COMMIT_SHA.",
  },
  {
    id: "netlify",
    titre: "Netlify",
    code: "Site configuration → Environment variables → MIP_SOURCEMAP_TOKEN (scope Builds)\nLa version vient seule de COMMIT_REF.",
  },
  {
    id: "github",
    titre: "GitHub Actions",
    code: "- name: Construire (et envoyer les source maps à MIP RUM)\n  run: npm run build\n  env:\n    MIP_SOURCEMAP_TOKEN: ${{ secrets.MIP_SOURCEMAP_TOKEN }}",
  },
  {
    id: "gitlab",
    titre: "GitLab CI",
    code: "build:\n  script:\n    - npm ci\n    - npm run build   # MIP_SOURCEMAP_TOKEN : variable masquée du projet\n  # La version vient seule de CI_COMMIT_SHA.",
  },
] as const;

// ─── L'échantillonnage ───────────────────────────────────────────────────────

/**
 * Un taux conseillé d'après les sessions des dernières 24 h (comptées par la sonde,
 * plafonnées à 1 000). Sous ce plafond, tout mesurer coûte peu et garde des
 * percentiles stables par page ; au-delà, 25 % suffit souvent, à ajuster à la page
 * la moins visitée qu'on veut suivre.
 */
export function echantillonnageConseille(sessions24h: number | null, plafond = 1000): { taux: number; raison: string } {
  if (sessions24h === null) return { taux: 1, raison: "Aucune session encore mesurée : commencer par tout mesurer." };
  if (sessions24h < plafond) {
    return {
      taux: 1,
      raison: `${sessions24h.toLocaleString("fr-FR")} sessions sur 24 h : à ce volume, tout mesurer coûte peu et garde des percentiles stables page par page.`,
    };
  }
  return {
    taux: 0.25,
    raison: `Plus de ${plafond.toLocaleString("fr-FR")} sessions sur 24 h : un quart suffit souvent ; remonter si une page peu visitée manque de mesures.`,
  };
}

// ─── La mention de confidentialité ───────────────────────────────────────────

export interface FaitsMention {
  nomSite: string;
  retentionJours: number;
  reglages: ReglagesKit;
}

/**
 * Le paragraphe à ajouter à la politique de confidentialité du site. Chaque phrase
 * se vérifie dans le produit : aucune adresse IP conservée (le pays seul), un
 * identifiant aléatoire dans le stockage du navigateur, hébergement dans l'Union
 * européenne, la durée de conservation de l'application, le respect de Do Not
 * Track et Global Privacy Control (`honorDNT`, vrai par défaut).
 */
export function mentionConfidentialite(f: FaitsMention): string {
  const r = f.reglages;
  const lignes = [
    "Mesure de la performance et de la qualité du site",
    "",
    `Pour améliorer la rapidité et la fiabilité de ${f.nomSite}, nous mesurons la façon dont ses pages se chargent et réagissent dans votre navigateur : temps d'affichage, erreurs, enchaînement des pages. Cette mesure est réalisée avec l'outil MIP RUM, édité par MIP, qui agit pour notre compte en tant que sous-traitant.`,
  ];
  if (bornerTaux(r.rejeu) > 0) {
    const montre =
      r.masquage === "all"
        ? "sans le texte affiché, sans ce que vous saisissez et sans les images"
        : r.masquage === "media"
          ? "avec le texte affiché, mais sans ce que vous saisissez ni les images"
          : "avec ce qui s'affiche, mais jamais ce que vous saisissez";
    lignes.push(
      "",
      `Une partie des visites est enregistrée sous forme de rejeu : la disposition des pages et vos actions (clics, défilement), ${montre}.`,
    );
  }
  lignes.push(
    "",
    `Aucune adresse IP n'est conservée : elle sert seulement à estimer le pays. Un identifiant aléatoire, sans lien avec votre identité, est gardé dans le stockage de votre navigateur pour regrouper les pages d'une même visite. Les données sont hébergées dans l'Union européenne et conservées ${f.retentionJours} jours.`,
    "",
    r.consentement === "aucun"
      ? "Vous pouvez vous opposer à cette mesure en activant le réglage « Do Not Track » ou « Global Privacy Control » de votre navigateur : elle s'arrête alors complètement."
      : "Cette mesure n'a lieu qu'avec votre accord, que vous pouvez retirer à tout moment depuis le gestionnaire des cookies du site ; elle s'arrête aussi si votre navigateur envoie le signal « Do Not Track » ou « Global Privacy Control ».",
    "",
    "Pour exercer vos droits d'accès, de rectification ou d'effacement : [votre adresse de contact].",
  );
  return lignes.join("\n");
}

// ─── Les jetons à renouveler ─────────────────────────────────────────────────

export interface JetonEcheance {
  nom: string;
  nature: "source maps" | "déploiements" | "lecture";
  expiresAt: Date | string;
  revokedAt: Date | string | null;
}

/** Combien de jours avant l'échéance la console prévient. */
export const PREAVIS_JETON_JOURS = 14;

/**
 * Les jetons actifs qui expirent dans le préavis (ou ont expiré depuis moins d'un
 * préavis : la chaîne de construction échoue en silence), de la plus proche
 * échéance à la plus lointaine. Un jeton révoqué ne se rappelle pas.
 */
export function jetonsARenouveler(
  jetons: readonly JetonEcheance[],
  maintenant: number,
  preavisJours = PREAVIS_JETON_JOURS,
): (JetonEcheance & { joursRestants: number })[] {
  const jour = 86_400_000;
  return jetons
    .filter((j) => !j.revokedAt)
    .map((j) => ({ ...j, joursRestants: Math.ceil((new Date(j.expiresAt).getTime() - maintenant) / jour) }))
    .filter((j) => Number.isFinite(j.joursRestants) && j.joursRestants <= preavisJours && j.joursRestants > -preavisJours)
    .sort((a, b) => a.joursRestants - b.joursRestants);
}
