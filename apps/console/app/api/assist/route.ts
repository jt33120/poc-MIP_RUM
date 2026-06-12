// Assistant IA d'intégration (v0.5) — admin only, activé par MISTRAL_API_KEY
// (souverain 🇫🇷, prioritaire) ou ANTHROPIC_API_KEY. Sans clé : 501, l'UI affiche
// un encart « désactivé » et le wizard déterministe reste le chemin nominal.
// Appels API directs en fetch, zéro dépendance npm.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyJwt } from "@/lib/auth";

export const dynamic = "force-dynamic";

// garde-fou : 10 requêtes/min par process (l'assistant n'est pas un chat public)
let hits: number[] = [];
function rateLimited(): boolean {
  const now = Date.now();
  hits = hits.filter((t) => t > now - 60_000);
  if (hits.length >= 10) return true;
  hits.push(now);
  return false;
}

const SYSTEM = `Tu es l'assistant d'intégration MIP RUM (RUM souverain + tracing distribué).
Tu aides un agent MIP à instrumenter le site/backend d'un client. Réponds en français, court et actionnable, avec du code prêt à coller.

CONTRAT TECHNIQUE (référence) :
- Front : 2 balises <script> dans le <head> — src="/mip-rum.js" (servi par la console, auto-hébergeable) puis MIPRum.init({endpoint, appId, clientId, env, apiKey, requireConsent?}). SPA et MPA supportés. CSP : script-src (origine du SDK) + connect-src (origine de l'ingestion).
- Tracing backend : lire le header W3C "traceparent" (00-<trace32hex>-<span16hex>-01) et "tracestate" (mip=s:<session_id>) ; chronométrer la requête ; émettre un span OTLP/HTTP JSON name="http.server", kind=2, attributs mip.trace_id, mip.span_id, mip.route (template type /partners/:id), http.url, http.method, http.status_code, http.duration_ms, mip.parent_span_id?, mip.session_id? ; resource.attributes mip.app_id (+ mip.api_key) ; POST en batch (flush 5 s ou 20 spans, file bornée 1000, timeout 3 s, best effort, JAMAIS d'exception vers l'app hôte ; ignorer OPTIONS et /health).
- Implémentations de référence : middleware ASGI Python (FastAPI/Starlette, stdlib pure, prouvé en prod) et middleware Express/Connect (Node>=18, fetch natif) — téléchargeables sur la page du client.

INJECTION ZÉRO-TOUCH (poser le RUM sans modifier le code du client — sites COTS/legacy/tiers) :
- Front, 3 points d'injection : (a) Cloudflare Worker (HTMLRewriter) — injecte les 2 balises dans le <head> ET réécrit la CSP (ajoute l'origine du SDK en script-src, l'origine de l'ingestion en connect-src) ; c'est le seul à corriger la CSP ; (b) nginx ngx_http_sub_module — sub_filter '</head>' '<balises></head>' + proxy_set_header Accept-Encoding "" (sinon le HTML gzip n'est pas réécrit) ; (c) tag « HTML personnalisé » GTM déclenché All Pages — self-service mais chargé async (premières métriques TTFB/FCP parfois partielles) et NE corrige PAS la CSP. SPA statique (Vercel/Netlify/S3) : pas de proxy HTML dans la chaîne → Cloudflare devant le domaine, ou injection au build, ou snippet en dur. Penser à ajouter l'origine du site aux domaines autorisés de l'app (CORS).
- Backend codeless (toute stack avec un agent OTel) : lancer l'app sous l'auto-instrumentation OpenTelemetry (ex. opentelemetry-instrument uvicorn main:app) pointée vers un Collector qui (1) filtre les spans serveur (kind=SERVER), (2) injecte mip.app_id + mip.api_key via le processor resource, (3) exporte en otlphttp encoding:json vers l'endpoint. L'ingestion MIP accepte nativement les spans serveur OpenTelemetry standard (attributs semconv http.route / http.request.method / http.response.status_code, trace/span/parent au niveau du span, session via tracestate mip=s:<id>) EN PLUS de notre middleware. Fichier otel-collector.yaml téléchargeable sur la page du client.

PIÈGES CONNUS (vécus) :
- FastAPI + pydantic-settings : le .env est chargé dans Settings SANS export os.environ → passer endpoint/app_id/api_key explicitement à add_middleware via settings, pas via os.environ.
- Proxy/CDN devant le backend (Vercel rewrites, nginx) : vérifier que les headers traceparent/tracestate sont transmis.
- sudo systemctl en SSH non interactif : exige un TTY (ssh -t).
- Snippet : TOUJOURS dans le <head>, avant les autres scripts, sinon les premières métriques (TTFB/FCP) peuvent manquer.
- CORS : l'origine du site client doit être dans les origines autorisées de l'app (configurable à chaud dans la console, prise en compte ≤ 60 s).

RÈGLES : ne jamais inventer d'URL d'ingestion ou de clé (l'agent les a dans la page) ; pour une stack non couverte, générer le middleware complet en suivant le contrat ; rester dans le périmètre données (route+méthode+statut+durée, jamais de corps/PII).`;

export async function POST(req: NextRequest) {
  // admin only (cookie JWT de la console)
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyJwt(token) : null;
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "admin requis" }, { status: 403 });

  const mistralKey = process.env.MISTRAL_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!mistralKey && !anthropicKey)
    return NextResponse.json(
      { disabled: true, error: "Assistant désactivé (MISTRAL_API_KEY ou ANTHROPIC_API_KEY absente)" },
      { status: 501 },
    );
  if (rateLimited())
    return NextResponse.json({ error: "trop de requêtes, réessaie dans 1 min" }, { status: 429 });

  let body: { appId?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const question = (body.question ?? "").trim().slice(0, 4000);
  if (!question) return NextResponse.json({ error: "question vide" }, { status: 400 });
  const userContent = `App concernée : ${body.appId ?? "?"}\n\n${question}`;

  let answer: string;
  if (mistralKey) {
    // Mistral (souverain) — API chat completions
    const model = process.env.ASSIST_MODEL ?? "mistral-large-latest";
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${mistralKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[assist] mistral error", res.status, detail.slice(0, 300));
      return NextResponse.json({ error: `API Mistral : ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    answer = data.choices?.[0]?.message?.content ?? "";
  } else {
    const model = process.env.ASSIST_MODEL ?? "claude-sonnet-4-6";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[assist] anthropic error", res.status, detail.slice(0, 300));
      return NextResponse.json({ error: `API Anthropic : ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    answer = (data.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n");
  }
  return NextResponse.json({ answer });
}
