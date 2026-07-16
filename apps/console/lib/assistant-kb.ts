// Base de connaissances de l'assistant IA — corpus d'ARCHITECTURE (fonctionnement
// du produit), source UNIQUE à la fois pour :
//   1) la page /help/architecture qui l'AFFICHE (texte lisible, ancré par id) ;
//   2) l'assistant IA qui la CITE (chaque carte = une source cliquable
//      /help/architecture#<id>).
// Conséquence directe : ce que l'IA affirme est LITTÉRALEMENT écrit sur la page
// vers laquelle pointe la citation — preuve de non-hallucination.
//
// Le corpus mêle des faits d'architecture natifs (rédigés ici, ancrés dans le
// dépôt réel) et le GLOSSARY existant (métriques/vocabulaire, déjà affiché en
// InfoTip) réexposé en cartes. Aucune I/O : module pur, testable.
import { GLOSSARY } from "./glossary";

export interface KbCard {
  /** Ancre stable (id HTML sur /help/architecture, et #id dans l'URL de citation). */
  id: string;
  /** Titre lisible affiché en tête de la carte. */
  title: string;
  /** Groupe d'affichage (section de la page). */
  group: KbGroup;
  /** Corps factuel — sert de texte de la page ET de contenu de la source LLM. */
  body: string;
}

export type KbGroup =
  | "Vue d'ensemble"
  | "Frontend & SDK"
  | "Ingestion & protocole"
  | "Base de données & souveraineté"
  | "Backend & tracing distribué"
  | "Sécurité, IA & conformité"
  | "Vocabulaire & métriques";

/** URL de citation canonique d'une carte (ancre sur la page de référence). */
export function cardUrl(id: string): string {
  return `/help/architecture#${id}`;
}

// --- Faits d'architecture natifs (ancrés dans le dépôt réel) -----------------
// Rédigés à partir du code : packages/rum-sdk, apps/console, apps/ingest (edge
// functions Deno), integrations/fastapi (middleware ASGI stdlib), packages/
// agent-node. Ne rien affirmer ici qui ne soit vrai dans le dépôt.
const ARCHITECTURE: KbCard[] = [
  {
    id: "produit",
    title: "Ce qu'est MIP RUM",
    group: "Vue d'ensemble",
    body: "MIP RUM est une solution de Real User Monitoring (supervision de la performance et des erreurs vécues par les vrais utilisateurs) souveraine et OpenTelemetry-native. Chaîne : SDK navigateur → OTLP → Postgres (UE) → console Next.js. Pas de format propriétaire, donc pas d'enfermement fournisseur.",
  },
  {
    id: "stack-console",
    title: "Console (l'interface)",
    group: "Frontend & SDK",
    body: "La console est une application Next.js 15.5 (App Router) en React 19 et TypeScript 5.9, stylée avec Tailwind. Elle interroge Postgres directement via le pilote `pg`. Graphiques : recharts ; rejeu de session : rrweb-player.",
  },
  {
    id: "sdk-web",
    title: "SDK web (navigateur)",
    group: "Frontend & SDK",
    body: "Le SDK web (`@mip/rum-sdk`) est écrit en TypeScript et compilé par esbuild en un bundle IIFE (global `MIPRum`), cœur ≤ 35 Ko gzip, servi en `/mip-rum.js` (auto-hébergeable). Il capture les Core Web Vitals, les erreurs JS, les sessions, les traces (fetch/XHR) et, en option, le session replay.",
  },
  {
    id: "extension",
    title: "Extension navigateur",
    group: "Frontend & SDK",
    body: "Une extension Manifest V3 (Chrome/Edge ≥ 111) injecte le SDK en zéro-code sur les domaines autorisés, sans toucher au code du site. Les sessions captées par ce canal portent la source de collecte 'extension'. Utile pour équiper des postes sans modifier le site.",
  },
  {
    id: "ingestion",
    title: "Ingestion",
    group: "Ingestion & protocole",
    body: "L'ingestion repose sur des Edge Functions Supabase exécutées en Deno : `v1-traces` (métriques, erreurs, spans), `v1-logs` (journaux), `v1-replay` (rejeu). Elles reçoivent du OTLP/HTTP JSON, l'aplatissent et l'écrivent en Postgres. Auth par clé d'API optionnelle (hachée en SHA-256) et limitation de débit.",
  },
  {
    id: "protocole",
    title: "Protocole (OTLP + W3C Trace Context)",
    group: "Ingestion & protocole",
    body: "Tout transite en OpenTelemetry standard (OTLP/HTTP JSON). La corrélation front→back utilise l'en-tête W3C `traceparent` (00-<trace 32hex>-<span 16hex>-01) ; la session web voyage dans `tracestate: mip=s:<session_id>`. Standards ouverts, donc compatibles avec l'écosystème observabilité existant.",
  },
  {
    id: "database",
    title: "Base de données & souveraineté",
    group: "Base de données & souveraineté",
    body: "Les données sont stockées dans Postgres (v17) hébergé par Supabase en région eu-west-3 (Paris) — résidence des données dans l'Union européenne. La sécurité en base repose sur le Row Level Security (RLS) activé et des fonctions au `search_path` épinglé.",
  },
  {
    id: "backend-python",
    title: "Middleware backend Python",
    group: "Backend & tracing distribué",
    body: "Le middleware de tracing backend Python (`mip_rum_middleware.py`, pour FastAPI/Starlette) est écrit en un seul fichier n'utilisant QUE la bibliothèque standard : urllib.request, json, asyncio, re, secrets, time, os — AUCUNE dépendance externe. Il lit `traceparent`, chronomètre la requête et émet un span OTLP `http.server`. Sans variables d'environnement, il est en passthrough total (aucun effet).",
  },
  {
    id: "backend-node",
    title: "Agent backend Node",
    group: "Backend & tracing distribué",
    body: "Pour les backends Node.js, l'agent `@mip/agent-node` (zéro dépendance) auto-instrumente les requêtes HTTP serveur sans changement de code, via préchargement : `node -r @mip/agent-node/register`. Il émet lui aussi des spans `http.server` OTLP.",
  },
  {
    id: "codeless-otel",
    title: "Codeless (agent OpenTelemetry standard)",
    group: "Backend & tracing distribué",
    body: "Toute stack disposant d'un agent OpenTelemetry standard peut alimenter MIP RUM sans notre middleware : lancer l'app sous auto-instrumentation OTel vers un Collector qui filtre les spans serveur, injecte l'app_id et exporte en otlphttp encoding json vers l'ingestion. L'ingestion accepte nativement les spans serveur OTel (semconv http.route / http.request.method / http.response.status_code).",
  },
  {
    id: "ia-souveraine",
    title: "IA souveraine (synthèses)",
    group: "Sécurité, IA & conformité",
    body: "Les synthèses en langage naturel (briefing d'accueil, cet assistant) sont générées via Mistral (fournisseur français, prioritaire), avec repli Anthropic, et un repli déterministe toujours disponible si aucune clé n'est configurée. Aucune donnée personnelle n'est envoyée au modèle : uniquement des agrégats.",
  },
  {
    id: "privacy",
    title: "Vie privée & RGPD",
    group: "Sécurité, IA & conformité",
    body: "Aucune adresse IP n'est stockée ; le pays est déduit de la timezone. Les saisies sont masquées à l'enregistrement du replay (maskAllInputs), le contenu est scrubbé des données personnelles, une durée de rétention (TTL) s'applique, et un DPA encadre le traitement. Signaux DNT/GPC respectés.",
  },
];

// --- Glossaire (métriques & vocabulaire) réexposé en cartes ------------------
// Réutilise le GLOSSARY (déjà la source des InfoTip UI) : title = label,
// body = définition technique + d'où vient la mesure. id = clé de glossaire.
const GLOSSARY_CARDS: KbCard[] = Object.entries(GLOSSARY).map(([id, e]) => ({
  id: `g-${id}`,
  title: e.label,
  group: "Vocabulaire & métriques" as const,
  body: `${e.term} ${e.stack}`,
}));

/** Corpus complet (architecture + vocabulaire), ordre d'affichage stable. */
export function knowledgeCards(): KbCard[] {
  return [...ARCHITECTURE, ...GLOSSARY_CARDS];
}

export const KB_GROUPS: KbGroup[] = [
  "Vue d'ensemble",
  "Frontend & SDK",
  "Ingestion & protocole",
  "Base de données & souveraineté",
  "Backend & tracing distribué",
  "Sécurité, IA & conformité",
  "Vocabulaire & métriques",
];

/** Cartes d'un groupe, dans l'ordre du corpus. */
export function cardsInGroup(group: KbGroup): KbCard[] {
  return knowledgeCards().filter((c) => c.group === group);
}
