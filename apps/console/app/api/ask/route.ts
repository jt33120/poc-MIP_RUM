// POST /api/ask — Assistant IA utilisateur (toute personne connectée). Répond sur
// (1) les DONNÉES de l'app et (2) l'ARCHITECTURE du produit, en CITANT ses sources
// (marqueurs [n] renvoyant vers une page console vérifiable). LLM souverain-first
// (Mistral 🇫🇷, repli Anthropic) ; 501 si aucune clé. Zéro PII : seuls des
// agrégats et des faits d'architecture publics sont envoyés au modèle.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyJwt } from "@/lib/auth";
import { gatherBriefingSignals } from "@/lib/queries-briefing";
import type { BriefingSignals } from "@/lib/briefing";
import {
  ASSISTANT_SYSTEM,
  buildSources,
  buildUserPrompt,
  sanitizeCitations,
} from "@/lib/assistant";

export const dynamic = "force-dynamic";

// Garde-fou : 20 requêtes/min par process (l'assistant n'est pas un chat public).
let hits: number[] = [];
function rateLimited(): boolean {
  const now = Date.now();
  hits = hits.filter((t) => t > now - 60_000);
  if (hits.length >= 20) return true;
  hits.push(now);
  return false;
}

/** Fenêtre de données de l'assistant : 7 jours glissants (indépendante du login). */
function windowStart(): Date {
  return new Date(Date.now() - 7 * 86_400_000);
}

/** Appel LLM souverain-first ; renvoie le texte brut ou null (désactivé/erreur). */
async function callLLM(system: string, user: string): Promise<string | null> {
  const mistral = process.env.MISTRAL_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  try {
    if (mistral) {
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${mistral}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.ASSIST_MODEL ?? "mistral-large-latest",
          max_tokens: 1200,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        console.error("[ask] mistral error", res.status, (await res.text().catch(() => "")).slice(0, 200));
        return null;
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? null;
    }
    if (anthropic) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropic,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ASSIST_MODEL ?? "claude-sonnet-4-6",
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) {
        console.error("[ask] anthropic error", res.status, (await res.text().catch(() => "")).slice(0, 200));
        return null;
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      return (data.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n") || null;
    }
  } catch (err) {
    console.error("[ask] llm exception", String(err));
    return null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyJwt(token) : null;
  if (!user) return NextResponse.json({ error: "non authentifié" }, { status: 401 });

  if (!process.env.MISTRAL_API_KEY && !process.env.ANTHROPIC_API_KEY)
    return NextResponse.json(
      { disabled: true, error: "Assistant désactivé (MISTRAL_API_KEY ou ANTHROPIC_API_KEY absente)" },
      { status: 501 },
    );
  if (rateLimited())
    return NextResponse.json({ error: "trop de requêtes, réessaie dans 1 min" }, { status: 429 });

  let body: { app?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const question = (body.question ?? "").trim().slice(0, 2000);
  if (!question) return NextResponse.json({ error: "question vide" }, { status: 400 });

  // RBAC : un viewer scopé ne peut demander les DONNÉES que de ses apps.
  const app = (body.app ?? "").trim();
  let signals: BriefingSignals | null = null;
  if (app) {
    if (user.apps && !user.apps.includes(app)) {
      return NextResponse.json({ error: "hors périmètre" }, { status: 403 });
    }
    try {
      signals = await gatherBriefingSignals(app, windowStart(), "les 7 derniers jours");
    } catch (err) {
      // fail-soft : sans les données, l'architecture reste répondable.
      console.error("[ask] gather signals failed", String(err));
      signals = null;
    }
  }

  const sources = buildSources(signals);
  const raw = await callLLM(ASSISTANT_SYSTEM, buildUserPrompt(question, sources));
  if (raw == null)
    return NextResponse.json({ error: "le modèle n'a pas répondu, réessaie" }, { status: 502 });

  const { answer, used } = sanitizeCitations(raw, sources);
  return NextResponse.json({ answer, sources: used });
}
