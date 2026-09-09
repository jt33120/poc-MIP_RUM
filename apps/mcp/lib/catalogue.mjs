// Le catalogue des outils MCP : ce que l'IA peut demander, et comment ça se
// traduit en requête HTTP vers l'API v1 de la console.
//
// TOUT EST DONNÉE, RIEN N'EST CODE. Un outil est un objet — nom, description,
// paramètres acceptés, chemin d'API. La construction de l'URL est UNE fonction
// pour les onze outils. C'est ce qui empêche la dérive : le dépôt a déjà connu
// TROIS implémentations de l'ingestion qui avaient silencieusement divergé (le
// dev-server acceptait une app sans clé là où la production la rejetait).
// Onze petits handlers écrits à la main referaient exactement ça.
//
// Ce module est PUR : ni réseau, ni horloge, ni variable d'environnement. Il se
// teste en comparant des chaînes.

/** Filtres acceptés par la quasi-totalité des endpoints de l'API v1. */
const FILTRES = ["app", "period", "device"];
/** Pagination des endpoints de liste. */
const PAGE = ["limit", "offset"];

/**
 * Vocabulaire commun, écrit UNE fois. Ces phrases finissent dans le schéma que
 * lit l'IA : elles doivent dire ce que l'API fait vraiment, y compris ce qu'elle
 * ne fait pas.
 */
export const PARAMS = {
  app: "Slug de l'app à interroger (voir mip_rum_list_apps). Omis ou 'all' = toutes les apps autorisées. Un jeton scopé à une app voit sa demande RAMENÉE à son périmètre sans erreur : vérifier `meta.app` dans la réponse.",
  period: "Fenêtre d'observation : '1h', '24h' (défaut) ou '7d'. L'API n'en accepte AUCUNE autre ; une valeur inconnue retombe silencieusement sur '24h'.",
  device:
    "Type d'appareil : 'mobile', 'desktop', 'tablet' ou 'all' (défaut). Attention : les endpoints historiques (overview, vitals, pages, tracing, health-grid) ne distinguent que mobile/desktop — 'tablet' y est traité comme 'tous'.",
  limit: "Nombre d'éléments par page (1 à 200).",
  offset: "Décalage de pagination, à partir de 0.",
  series:
    "Vitals à détailler en série temporelle : liste séparée par des virgules ('LCP,INP') ou 'all'. Par défaut aucune série n'est renvoyée, seulement les p75.",
  fingerprint: "Signature du groupe d'erreurs, telle que renvoyée par mip_rum_list_errors.",
  session_id: "Identifiant de session, tel que renvoyé par mip_rum_list_sessions.",
  format:
    "Forme de la réponse : 'json' (défaut — la réponse de l'API telle quelle, sans transformation) ou 'markdown' (tableaux lisibles, aucune donnée retirée).",
};

/**
 * Les outils. `chemin` peut contenir `{param}` : le paramètre est alors injecté
 * dans le chemin (encodé) au lieu d'aller dans la query string.
 *
 * `lecture: true` partout — l'API v1 exposée ici est en lecture seule, et c'est
 * délibéré : `POST /api/v1/deploys` existe mais n'est PAS exposé en outil.
 * Donner à un agent conversationnel de quoi écrire dans la base de production
 * n'est pas un oubli qu'on comble, c'est une décision qui se prend à froid.
 */
export const OUTILS = [
  {
    nom: "mip_rum_list_apps",
    titre: "Applications supervisées",
    resume: "Catalogue des applications visibles par le jeton, avec leur volume récent.",
    description:
      "Liste les applications web supervisées par MIP RUM que le jeton courant a le droit de lire. " +
      "À APPELER EN PREMIER : tous les autres outils prennent un paramètre `app`, et leurs slugs viennent d'ici. " +
      "Un jeton partenaire ne voit que ses propres apps ; la liste est donc déjà le périmètre réel, pas le catalogue complet.",
    chemin: "/apps",
    params: [],
  },
  {
    nom: "mip_rum_get_overview",
    titre: "Vue d'ensemble",
    resume: "Score de santé, Core Web Vitals p75 et compteurs, avec la période précédente.",
    description:
      "Vue d'ensemble d'une application : score de santé (avec ses facteurs et les anomalies détectées), " +
      "Core Web Vitals au 75e percentile, et compteurs de trafic. " +
      "Renvoie AUSSI les mêmes mesures sur la période précédente (`previous`), ce qui permet de calculer une évolution " +
      "sans second appel. C'est le bon point de départ pour « comment va cette app ? ».",
    chemin: "/overview",
    params: FILTRES,
  },
  {
    nom: "mip_rum_get_vitals",
    titre: "Core Web Vitals",
    resume: "p75 par vital, et séries temporelles à la demande.",
    description:
      "Core Web Vitals au 75e percentile (LCP, INP, CLS, FCP, TTFB) sur la période. " +
      "Avec `series`, ajoute la série temporelle des vitals demandés — nécessaire pour répondre à « est-ce que ça se dégrade ? », " +
      "à laquelle un p75 unique ne répond pas. Sans `series`, seuls les p75 sont renvoyés (réponse beaucoup plus courte).",
    chemin: "/vitals",
    params: [...FILTRES, "series"],
  },
  {
    nom: "mip_rum_list_slow_pages",
    titre: "Pages les plus lentes",
    resume: "Routes classées par lenteur (p75 LCP/INP), avec leur volume.",
    description:
      "Routes de l'application classées par lenteur, avec leur p75 LCP/INP et leur volume de pages vues. " +
      "Sert à répondre à « qu'est-ce qui est lent, et est-ce que ça concerne du monde ? » : une route très lente vue " +
      "deux fois par jour ne pèse pas le même poids qu'une route moyennement lente sur tout le trafic.",
    chemin: "/pages",
    params: FILTRES,
  },
  {
    nom: "mip_rum_list_errors",
    titre: "Groupes d'erreurs JS",
    resume: "Erreurs JavaScript regroupées par signature, paginées.",
    description:
      "Erreurs JavaScript regroupées par signature (`fingerprint`), avec leur nombre d'occurrences et de sessions touchées. " +
      "Renvoie aussi `unfingerprinted` : le nombre d'erreurs que le regroupement n'a PAS su rattacher à un groupe — " +
      "un compteur à ne pas oublier, il n'apparaît dans aucun groupe. " +
      "Paginé : utiliser `limit`/`offset`. L'API ne renvoie pas de total ; une page pleine signifie qu'il y a probablement une suite.",
    chemin: "/errors",
    params: [...FILTRES, ...PAGE],
  },
  {
    nom: "mip_rum_get_error_group",
    titre: "Détail d'un groupe d'erreurs",
    resume: "Occurrences, navigateurs et routes touchés par une signature d'erreur.",
    description:
      "Détail d'un groupe d'erreurs identifié par sa signature : occurrences dans le temps, navigateurs et routes concernés, " +
      "derniers exemples. Le `fingerprint` s'obtient avec mip_rum_list_errors. " +
      "Renvoie une erreur explicite si la signature est inconnue sur la période demandée — élargir `period` avant de conclure qu'elle n'existe pas.",
    chemin: "/errors/{fingerprint}",
    params: [...FILTRES, "fingerprint"],
  },
  {
    nom: "mip_rum_list_sessions",
    titre: "Sessions récentes",
    resume: "Sessions utilisateur récentes, paginées.",
    description:
      "Sessions utilisateur récentes, de la plus récente à la plus ancienne, avec durée, pages vues, appareil et signaux de frustration. " +
      "Paginé : utiliser `limit`/`offset`. L'API ne renvoie pas de total. " +
      "Aucune donnée personnelle : les identifiants utilisateur sont des empreintes, pas des emails.",
    chemin: "/sessions",
    params: [...FILTRES, ...PAGE],
  },
  {
    nom: "mip_rum_get_session",
    titre: "Détail d'une session",
    resume: "Métadonnées et chronologie complète d'une session.",
    description:
      "Métadonnées d'une session (appareil, navigateur, pays, durée) et sa CHRONOLOGIE : pages vues, erreurs, " +
      "signaux de frustration et mesures, dans l'ordre. C'est l'outil qui répond à « qu'est-ce qui s'est passé pour cet utilisateur ? ». " +
      "L'identifiant s'obtient avec mip_rum_list_sessions.",
    chemin: "/sessions/{session_id}",
    params: ["session_id"],
  },
  {
    nom: "mip_rum_get_tracing",
    titre: "Tracing front → back",
    resume: "Couverture du tracing, appels d'API et routes backend vues depuis le navigateur.",
    description:
      "Ce que le navigateur voit du backend : taux de couverture du tracing distribué, appels d'API les plus lents ou les plus en erreur, " +
      "et routes backend correspondantes. " +
      "Un taux de couverture bas ne veut PAS dire que le backend va bien — il veut dire qu'on ne le mesure pas. Le lire avant d'interpréter le reste.",
    chemin: "/tracing",
    params: FILTRES,
  },
  {
    nom: "mip_rum_get_correlation",
    titre: "Corrélation robot ↔ réel",
    resume: "Écart entre la supervision synthétique et le vécu réel, et angles morts.",
    description:
      "Compare ce que mesure la supervision synthétique (robot) à ce que vivent les utilisateurs réels (RUM), " +
      "et liste les ANGLES MORTS : les parcours qu'un robot ne couvre pas. " +
      "Sert à répondre à « pourquoi le monitoring est au vert alors que les utilisateurs se plaignent ? ».",
    chemin: "/correlation",
    params: FILTRES,
  },
  {
    nom: "mip_rum_get_health_grid",
    titre: "Heatmap de santé",
    resume: "Santé par jour × heure, et trafic quotidien.",
    description:
      "Grille de santé jour × heure (168 cases sur une semaine) et trafic quotidien. " +
      "Sert à répondre aux questions de RÉGULARITÉ : « est-ce que c'est toujours mauvais le lundi matin ? », " +
      "« la dégradation est-elle continue ou par à-coups ? » — questions auxquelles un agrégat sur la période ne répond pas.",
    chemin: "/health-grid",
    params: FILTRES,
  },
];

/** Un chemin contient-il un segment dynamique `{nom}` ? */
function segments(chemin) {
  return [...chemin.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/**
 * Traduit un appel d'outil en chemin d'API relatif (`/overview?app=x&period=7d`).
 *
 * Les paramètres non déclarés par l'outil sont IGNORÉS et non pas transmis :
 * l'API les ignorerait de toute façon, mais les laisser passer donnerait à
 * l'IA l'illusion d'un filtre qui n'existe pas. Les valeurs vides sont
 * omises, pour que `?app=` ne soit pas confondu avec « app nommée chaîne vide ».
 *
 * @param {object} outil  une entrée de OUTILS
 * @param {object} args   arguments validés par le schéma d'entrée
 * @returns {string} chemin relatif à la base `/api/v1`
 */
export function construireChemin(outil, args = {}) {
  const dyn = segments(outil.chemin);
  let chemin = outil.chemin;
  for (const nom of dyn) {
    const v = args[nom];
    if (v == null || v === "") throw new Error(`paramètre requis manquant : ${nom}`);
    chemin = chemin.replace(`{${nom}}`, encodeURIComponent(String(v)));
  }

  const qs = new URLSearchParams();
  for (const nom of outil.params) {
    if (dyn.includes(nom)) continue; // déjà dans le chemin
    const v = args[nom];
    if (v == null || v === "") continue;
    qs.set(nom, String(v));
  }
  const q = qs.toString();
  return q ? `${chemin}?${q}` : chemin;
}

/** L'outil portant ce nom, ou undefined. */
export function outilParNom(nom) {
  return OUTILS.find((o) => o.nom === nom);
}
