// POST /api/briefing — briefing d'accueil : état de l'app DEPUIS LA DERNIÈRE
// CONNEXION (bugs, erreurs, alertes, ou « tout va bien »). Généré au login puis
// MIS EN CACHE (table ai_briefing) : ~1 appel LLM par (app, utilisateur, login).
// Enrichissement LLM souverain (Mistral 🇫🇷 prioritaire, sinon Anthropic) avec
// repli déterministe TOUJOURS disponible. Zéro PII : uniquement des agrégats.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyJwt } from "@/lib/auth";
import {
  BRIEFING_SYSTEM,
  briefingUserPrompt,
  deterministicBriefing,
  parseBriefing,
  type BriefingResult,
} from "@/lib/briefing";
import {
  gatherBriefingSignals,
  gatherPortalSignals,
  getCachedBriefing,
  putCachedBriefing,
  PORTAL_APP,
} from "@/lib/queries-briefing";

export const dynamic = "force-dynamic";

/** Début du jour courant (UTC) — fenêtre de repli stable (cache tient la journée). */
function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Libellé humain de l'ancienneté de la fenêtre. */
function windowLabel(start: Date, fromLogin: boolean): string {
  const days = Math.floor((Date.now() - start.getTime()) / 86_400_000);
  const ago = days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} j`;
  return fromLogin ? `depuis votre dernière connexion (${ago})` : `aujourd'hui`;
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
          max_tokens: 700,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) return null;
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
          max_tokens: 700,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      return (data.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n") || null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyJwt(token) : null;
  if (!user) return NextResponse.json({ error: "non authentifié" }, { status: 401 });

  let body: { app?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const app = (body.app ?? "").trim();
  // app vide => briefing PORTAIL (toutes les apps). Réservé aux comptes non scopés :
  // un viewer restreint à certaines apps n'a pas de vue transverse.
  const portal = app === "";
  if (portal) {
    if (user.apps && user.apps.length) {
      return NextResponse.json({ error: "portail indisponible pour un compte scopé" }, { status: 403 });
    }
  } else if (user.apps && !user.apps.includes(app)) {
    // RBAC : un viewer scopé ne peut demander que ses apps.
    return NextResponse.json({ error: "hors périmètre" }, { status: 403 });
  }
  const cacheKey = portal ? PORTAL_APP : app;

  // Fenêtre : cookie de connexion précédente (posé au login), sinon début de journée.
  const prev = req.cookies.get("mip-prev-login")?.value;
  const prevDate = prev ? new Date(prev) : null;
  const fromLogin = !!prevDate && !Number.isNaN(prevDate.getTime());
  const windowStart = fromLogin ? prevDate! : startOfToday();

  // Cache : réutilise tant que la fenêtre (login) n'a pas changé.
  const cached = await getCachedBriefing(cacheKey, user.email);
  if (cached && new Date(cached.window_start).getTime() === windowStart.getTime()) {
    return NextResponse.json({ briefing: cached.payload, cached: true });
  }

  const label = windowLabel(windowStart, fromLogin);
  const signals = portal
    ? await gatherPortalSignals(windowStart, label)
    : await gatherBriefingSignals(app, windowStart, label);
  let result: BriefingResult = deterministicBriefing(signals);

  // Enrichissement LLM (best effort) : ne remplace le repli QUE si le parse réussit.
  const raw = await callLLM(BRIEFING_SYSTEM, briefingUserPrompt(signals));
  if (raw) {
    const ai = parseBriefing(raw);
    if (ai) result = ai;
  }

  await putCachedBriefing(cacheKey, user.email, windowStart, result);
  return NextResponse.json({ briefing: result, cached: false });
}
