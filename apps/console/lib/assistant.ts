// Assistant IA — logique PURE (aucune I/O), testée. Construit le prompt à partir
// de SOURCES numérotées (données live + architecture), et surtout SANITISE les
// citations renvoyées par le modèle : seul un marqueur [n] pointant vers une
// source RÉELLEMENT fournie est conservé. C'est le cœur anti-hallucination —
// toute URL cliquable vient de nous, jamais du modèle.
import type { BriefingSignals } from "./briefing";
import { cardUrl, knowledgeCards } from "./assistant-kb";

/** Une source citable : un fait rattaché à une page console vérifiable. */
export interface Source {
  /** Numéro 1..N présenté au modèle et rendu en exposant cliquable. */
  n: number;
  /** Titre court affiché dans la liste des sources. */
  title: string;
  /** URL de vérification (page console live pour les données, ancre d'archi sinon). */
  url: string;
  /** "data" = chiffre live de l'app ; "archi" = fait de fonctionnement produit. */
  kind: "data" | "archi";
  /** Corps envoyé au modèle (pas renvoyé au client). */
  body: string;
}

/** Source telle que renvoyée au client (sans le corps). */
export type ClientSource = Omit<Source, "body">;

const fr = (v: number): string => v.toLocaleString("fr-FR");

/** Faits DONNÉES (live) déduits des signaux agrégés de l'app — chacun rattaché à
 *  la page console qui l'affiche (source vérifiable). Pur : ne fait pas d'I/O. */
export function dataFactsFromSignals(
  signals: BriefingSignals,
): Array<{ title: string; url: string; body: string }> {
  const s = signals;
  const facts: Array<{ title: string; url: string; body: string }> = [];
  const win = s.windowLabel || "la période récente";

  facts.push({
    title: "Sessions",
    url: "/sessions",
    body: `${fr(s.sessions)} session(s) sur ${win} (trafic robot exclu).`,
  });
  facts.push({
    title: "Pages vues",
    url: "/pages",
    body: `${fr(s.pageviews)} page(s) vue(s) sur ${win}.`,
  });
  facts.push({
    title: "Erreurs",
    url: "/errors",
    body:
      `${fr(s.errors)} erreur(s) sur ${win}` +
      (s.newErrorGroups > 0 ? `, dont ${fr(s.newErrorGroups)} nouveau(x) groupe(s) d'erreur (régressions).` : ".") +
      (s.topErrors.length ? ` Types fréquents : ${s.topErrors.map((e) => `${e.type} (${fr(e.count)}×)`).join(", ")}.` : ""),
  });
  if (s.healthScore != null) {
    facts.push({
      title: "Score de santé",
      url: "/",
      body:
        `Score de santé actuel : ${s.healthScore}/100` +
        (s.worstVital ? `, vital le plus dégradé : ${s.worstVital.name} au p75 = ${fr(s.worstVital.p75)}.` : "."),
    });
  }
  facts.push({
    title: "Alertes",
    url: "/alerts",
    body: `${fr(s.alerts)} alerte(s) déclenchée(s) sur ${win}, dont ${fr(s.criticalAlerts)} critique(s).`,
  });
  if (s.sloBreached > 0) {
    facts.push({
      title: "SLO",
      url: "/slo",
      body: `${fr(s.sloBreached)} SLO en dépassement de budget d'erreur.`,
    });
  }
  if (s.reliable === false) {
    facts.push({
      title: "Fiabilité de l'échantillon",
      url: "/",
      body: `Trafic faible (${fr(s.sessions)} session(s), ${fr(s.measures ?? 0)} mesure(s)) : les indicateurs de performance ne sont pas statistiquement fiables sur cette fenêtre.`,
    });
  }
  return facts;
}

/** Construit la liste numérotée de sources : données live d'abord (numéros bas,
 *  plus spécifiques), puis le corpus d'architecture. `app` = null → pas de
 *  données (architecture seule, ex. compte sans app sélectionnée). */
export function buildSources(signals: BriefingSignals | null): Source[] {
  const out: Source[] = [];
  let n = 1;
  if (signals) {
    for (const f of dataFactsFromSignals(signals)) {
      out.push({ n: n++, title: f.title, url: f.url, kind: "data", body: f.body });
    }
  }
  for (const c of knowledgeCards()) {
    out.push({ n: n++, title: c.title, url: cardUrl(c.id), kind: "archi", body: c.body });
  }
  return out;
}

export const ASSISTANT_SYSTEM = `Tu es l'assistant IA de MIP RUM, une solution de Real User Monitoring (supervision) souveraine. Tu réponds à un utilisateur de la console sur DEUX sujets :
1) les DONNÉES de son application (ce que montrent ses tableaux de bord) ;
2) l'ARCHITECTURE et le fonctionnement du produit (stack technique, ingestion, sécurité, protocole…).

On te fournit une liste de SOURCES numérotées — et RIEN d'autre ne fait foi. Règles absolues :
- Réponds en français, clair, concret et bref.
- Appuie CHAQUE affirmation factuelle sur une ou plusieurs sources en insérant le(s) marqueur(s) [n] juste après l'affirmation (n = numéro exact de la source utilisée).
- N'utilise QUE les numéros de sources fournis. N'invente JAMAIS un numéro, une URL, un chiffre, une version ou un fait absent des sources.
- Si les sources ne permettent pas de répondre, dis-le franchement (« Je n'ai pas cette information dans mes sources. ») au lieu de deviner.
- Aucune donnée personnelle.
- N'ajoute pas de liste de sources à la fin : les marqueurs [n] en ligne suffisent.`;

/** Prompt utilisateur : la question + le bloc de sources numérotées. */
export function buildUserPrompt(question: string, sources: Source[]): string {
  const lines = sources.map((s) => `[${s.n}] ${s.title} — ${s.body}`);
  return `Question de l'utilisateur :\n${question}\n\nSOURCES (cite uniquement ces numéros) :\n${lines.join("\n")}`;
}

const CITATION_RE = /\[(\d+)\]/g;

/** Retire tout marqueur [n] dont le numéro ne correspond à AUCUNE source fournie
 *  (garde-fou anti-hallucination), et renvoie la liste des sources RÉELLEMENT
 *  citées, dans l'ordre de première apparition — c'est-à-dire les seules dont on
 *  exposera le lien cliquable. */
export function sanitizeCitations(
  answer: string,
  sources: Source[],
): { answer: string; used: ClientSource[] } {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const usedOrder: number[] = [];
  const cleaned = answer.replace(CITATION_RE, (match, digits: string) => {
    const n = Number(digits);
    if (!byN.has(n)) return ""; // numéro inventé → on efface le marqueur
    if (!usedOrder.includes(n)) usedOrder.push(n);
    return match; // marqueur valide conservé pour le rendu cliquable
  });
  const used: ClientSource[] = usedOrder.map((n) => {
    const s = byN.get(n)!;
    return { n: s.n, title: s.title, url: s.url, kind: s.kind };
  });
  // espaces doubles laissés par un marqueur effacé
  return { answer: cleaned.replace(/ {2,}/g, " ").replace(/ +([.,;:])/g, "$1"), used };
}
