// Mise en forme des réponses pour l'IA.
//
// DEUX CHOIX QUI VONT À L'ENCONTRE DE L'USAGE, ET POURQUOI.
//
// 1. Le défaut est JSON, pas markdown. La convention MCP recommande l'inverse,
//    parce qu'un rendu markdown est plus lisible. Ici le lecteur est un modèle,
//    et la valeur du produit est l'exactitude d'un chiffre : un p75 de LCP,
//    un nombre de sessions touchées. Toute mise en forme est une occasion de
//    perdre un champ en silence, et un champ perdu se lit comme un zéro.
//
// 2. Le rendu markdown est GÉNÉRIQUE — une fonction pour tous les outils, pas
//    un gabarit par outil. Un gabarit par endpoint serait plus joli et afficherait
//    exactement les colonnes utiles ; il faudrait aussi le corriger à chaque
//    champ ajouté à l'API, et un gabarit oublié n'échoue pas : il affiche
//    l'ancienne colonne comme si elle était toute la vérité. Le rendu générique
//    ne peut pas mentir par omission — il ne sait rien omettre.
//
// Module PUR : aucune entrée/sortie, aucune horloge.

/** Au-delà, la valeur est tronquée dans un tableau (le JSON, lui, reste entier). */
const MAX_CELLULE = 120;

function estObjetPlat(v) {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v).every((x) => x == null || typeof x !== "object");
}

function cellule(v) {
  if (v == null) return "—";
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return `\`${s.length > MAX_CELLULE ? `${s.slice(0, MAX_CELLULE)}…` : s}\``;
  }
  const s = String(v);
  // Le pipe casserait la colonne : il est échappé, jamais supprimé.
  const e = s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return e.length > MAX_CELLULE ? `${e.slice(0, MAX_CELLULE)}…` : e;
}

/** Tableau markdown d'un tableau d'objets plats. Colonnes = union des clés. */
function tableau(lignes) {
  const colonnes = [];
  for (const l of lignes) for (const k of Object.keys(l)) if (!colonnes.includes(k)) colonnes.push(k);
  if (!colonnes.length) return "_(aucune colonne)_";
  const tete = `| ${colonnes.join(" | ")} |`;
  const sep = `| ${colonnes.map(() => "---").join(" | ")} |`;
  const corps = lignes.map((l) => `| ${colonnes.map((c) => cellule(l[c])).join(" | ")} |`);
  return [tete, sep, ...corps].join("\n");
}

/**
 * Rend une valeur quelconque. Les listes d'objets plats deviennent des tableaux,
 * les objets deviennent des sections, le reste tombe en JSON indenté — jamais
 * supprimé.
 */
function valeur(v, titre, niveau) {
  const h = "#".repeat(Math.min(niveau, 6));
  if (v == null) return `${h} ${titre}\n\n_(vide)_`;

  if (Array.isArray(v)) {
    if (!v.length) return `${h} ${titre}\n\n_(liste vide)_`;
    if (v.every(estObjetPlat)) return `${h} ${titre} — ${v.length} ligne(s)\n\n${tableau(v)}`;
    // Liste hétérogène ou imbriquée : JSON, intégral.
    return `${h} ${titre} — ${v.length} élément(s)\n\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``;
  }

  if (typeof v === "object") {
    if (estObjetPlat(v)) {
      const lignes = Object.entries(v).map(([k, x]) => `- **${k}** : ${cellule(x)}`);
      return `${h} ${titre}\n\n${lignes.join("\n")}`;
    }
    const morceaux = Object.entries(v).map(([k, x]) => valeur(x, k, niveau + 1));
    return `${h} ${titre}\n\n${morceaux.join("\n\n")}`;
  }

  return `${h} ${titre}\n\n${cellule(v)}`;
}

/**
 * Depuis P6.2, une app hors périmètre est REFUSÉE (403) : l'API ne ramène plus
 * silencieusement la demande au jeton. Il reste un cas où `meta.app` diffère de
 * l'app demandée, et il est légitime : le détail d'un groupe d'erreurs ou d'une
 * issue porte l'app de la RESSOURCE — son identifiant fait foi. Sans cette note,
 * l'IA croirait avoir obtenu les chiffres de l'app qu'elle a nommée. C'est le mode
 * de défaillance le plus grave possible ici : une réponse fausse, présentée comme
 * juste. (Elle protège aussi d'une console antérieure à P6.2, qui rabattait.)
 *
 * @returns {string|null} l'avertissement, ou null si rien à signaler
 */
export function avertissementPerimetre(demande, meta) {
  if (!demande || demande === "all") return null;
  const obtenue = meta?.app;
  if (!obtenue || obtenue === demande) return null;
  return (
    `⚠️ Périmètre : l'app « ${demande} » a été demandée, mais la réponse porte sur « ${obtenue} » ` +
    `(l'identifiant de la ressource fait foi, ou le jeton n'a pas accès à l'app demandée). ` +
    `Ces chiffres ne concernent PAS l'app demandée. Utiliser mip_rum_list_apps pour connaître le périmètre réel.`
  );
}

/**
 * Rend l'enveloppe `{ meta, data }` en markdown.
 * @param {string} titre  titre de l'outil
 * @param {object} corps  l'enveloppe renvoyée par l'API
 */
export function enMarkdown(titre, corps) {
  const { meta, data } = corps ?? {};
  const entete = meta
    ? `_app : ${meta.app ?? "?"} · période : ${meta.period ?? "?"} · appareil : ${meta.device ?? "?"} · généré le ${meta.generatedAt ?? "?"}_`
    : "_(métadonnées absentes)_";
  const corpsRendu =
    data == null
      ? "_(aucune donnée)_"
      : estObjetPlat(data) || Array.isArray(data) || typeof data !== "object"
        ? valeur(data, "Données", 2)
        : Object.entries(data)
            .map(([k, v]) => valeur(v, k, 2))
            .join("\n\n");
  return `# ${titre}\n\n${entete}\n\n${corpsRendu}`;
}

/**
 * Indices de pagination. Seuls certains endpoints renvoient un total (groupes
 * d'erreurs, Explorer d'événements) : ailleurs on ne peut pas dire combien
 * d'éléments existent, seulement qu'une page pleine en laisse probablement
 * d'autres. Le dire ainsi, plutôt que d'inventer un `total`.
 *
 * Une page par curseur (détail d'un groupe d'erreurs : `{ limit, next_cursor }`)
 * n'a pas d'offset. En inventer un enverrait l'IA vers un paramètre que l'outil
 * n'accepte pas : elle relirait la même page en croyant avancer.
 *
 * Les issues (P5.5) paginent par `data.next_cursor` SANS objet `page` : la limite
 * appliquée n'est pas renvoyée, donc elle reste null plutôt que devinée, et seule
 * la présence d'un curseur annonce une suite.
 */
export function indicesPage(data) {
  const page = data?.page;
  const curseurSeul = !page && data != null && typeof data === "object" && "next_cursor" in data;
  if (!curseurSeul && (!page || typeof page.limit !== "number")) return null;
  // `rows` en tête : la réponse de l'Explorer porte AUSSI `groups` et `series`,
  // qui ne sont pas paginés. Compter les groupes d'une série pour annoncer une
  // page de journal enverrait l'IA chercher une suite qui n'existe pas.
  const liste = data.rows ?? data.events ?? data.sessions ?? data.groups ?? data.actions ?? data.issues ??
    data.occurrences ?? Object.values(data).find(Array.isArray);
  if (!Array.isArray(liste)) return null;
  const recus = liste.length;
  const brut = page?.next_cursor ?? data.next_cursor;
  const cursorSuivant = typeof brut === "string" && brut ? brut : null;
  const limit = curseurSeul ? null : page.limit;
  const suite = cursorSuivant != null || (limit != null && recus >= limit);
  const offset = typeof page?.offset === "number" ? page.offset : null;
  return {
    limit,
    offset,
    recus,
    peut_avoir_suite: suite,
    offset_suivant: suite && offset != null ? offset + limit : null,
    cursor_suivant: cursorSuivant,
    total: typeof data.total === "number" ? data.total : null,
  };
}
