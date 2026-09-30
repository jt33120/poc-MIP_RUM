// L'ASSISTANT NE TRANSMET AUCUNE DONNÉE PERSONNELLE — la dernière barrière, en texte.
//
// Le condensé du tableau de bord ne porte que des agrégats et des routes normalisées
// par le capteur : aucun identifiant de visiteur, aucune adresse IP n'y entre par
// construction (`digest.ts`). Mais deux de ses textes viennent de l'extérieur : le
// message d'une erreur réapparue et le nom d'une alerte. Un message d'exception peut
// porter une adresse e-mail ou un identifiant que le nettoyage de l'ingestion n'a pas
// reconnu. Avant qu'un texte parte vers un fournisseur de modèle, ou même vers le
// navigateur, ces motifs sont donc remplacés par leur nature — deux fois : à la
// construction du condensé (serveur), puis à sa réception par la route, puisque le
// condensé revient du navigateur.
//
// Des faux positifs sont possibles (une version en quatre nombres ressemble à une
// adresse IPv4) : masquer un numéro de version est le moindre des deux défauts. Une
// heure (« 14:03:27 ») n'est PAS prise pour une adresse IPv6 : celle-ci n'est reconnue
// qu'en entier (huit groupes) ou compressée (« :: »).

const MOTIFS: readonly [RegExp, string][] = [
  // Valeur d'un paramètre d'URL sensible (« ?token=… », « &email=… »), avant tout le reste.
  [/([?&](?:token|access_token|id_token|key|apikey|api_key|password|pwd|secret|session|sid|auth|code|email)=)[^&\s#]+/gi, "$1[masqué]"],
  // Jeton JWT (trois segments base64url, le premier commence par « eyJ »).
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[jeton masqué]"],
  // Adresse e-mail.
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, "[adresse masquée]"],
  // UUID (identifiant de session, de visiteur, de compte).
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[identifiant masqué]"],
  // Adresse IPv6 : compressée (« fe80::1 »), ou entière (huit groupes).
  [/\b(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?![0-9a-f:])|\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi, "[IP masquée]"],
  // Adresse IPv4.
  [/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, "[IP masquée]"],
  // Jeton ou empreinte : 16 caractères hexadécimaux et plus, d'un seul tenant.
  [/\b[0-9a-f]{16,}\b/gi, "[identifiant masqué]"],
  // Numéro long (téléphone, carte, identifiant numérique) : 9 chiffres et plus accolés.
  [/(?<![\d,.])\d{9,}(?![\d,.])/g, "[numéro masqué]"],
];

/** Le texte, ses adresses, identifiants et numéros longs remplacés par leur nature. */
export function masquerDonneesPersonnelles(texte: string): string {
  let sortie = texte;
  for (const [motif, remplacement] of MOTIFS) sortie = sortie.replace(motif, remplacement);
  return sortie;
}

/**
 * Tronqué à `max` caractères, avec « … » : un texte venu d'ailleurs n'est jamais sans
 * borne. Les blancs ordinaires sont resserrés ; les espaces insécables (« 2,7 s »,
 * « 1 234 ») sont gardés, pour qu'un nombre ne se sépare pas de son unité.
 */
export function borner(texte: string, max: number): string {
  const t = texte.replace(/[ \t\n\r\f\v]+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Les deux à la fois : ce qu'un texte du condensé subit avant de sortir. */
export function texteSur(texte: string, max: number): string {
  return borner(masquerDonneesPersonnelles(texte), max);
}
