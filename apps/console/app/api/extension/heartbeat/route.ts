// POST /api/extension/heartbeat — déclaration d'une installation de l'extension
// navigateur (Ext-D). Alimente l'inventaire de parc (/admin/extension-installs).
//
// PUBLIQUE ET NON AUTHENTIFIÉE, comme /resolve et pour la même raison : le bundle
// d'une extension distribuée est lisible par son utilisateur, donc aucun secret
// ne peut y être embarqué. La conséquence est assumée et bornée : n'importe qui
// peut inventer un install_id et faire apparaître une ligne fantôme. C'est un
// bruit d'inventaire, pas une fuite — la route ne LIT rien et n'écrit que dans
// ses deux tables. Le débit est plafonné par install_id ET globalement, et
// `app_ids` est filtré contre `extension_scope` : un poste ne peut se déclarer
// que sur des applications RÉELLEMENT servies par l'extension, jamais sur une
// application choisie par l'appelant.
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/api/ratelimit";
import { recordInstallBeat } from "@/lib/queries-extension-installs";

export const dynamic = "force-dynamic";

// 4 battements/jour attendus par poste ; 12/h laisse la place aux redémarrages du
// service worker sans ouvrir la porte à une boucle.
const LIMIT = Number(process.env.EXTENSION_HEARTBEAT_RATE_LIMIT ?? 12);
const WINDOW_MS = 60 * 60 * 1000;
const BODY_MAX = 4096; // un battement fait ~200 octets ; au-delà, ce n'en est pas un

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(status: number, message: string, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { ...CORS, ...extra } });
}

export async function OPTIONS(): Promise<NextResponse> {
  // Le préflight est obligatoire ici : POST + content-type: application/json
  // depuis un service worker d'extension n'est pas une requête simple.
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();
  if (raw.length > BODY_MAX) return err(413, "corps trop volumineux");

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return err(400, "JSON invalide");
  }

  // L'identifiant DOIT être un UUID : c'est ce qui borne la clé de rate limiting
  // et empêche une chaîne arbitraire de servir de clé de cardinalité illimitée.
  const installId = String(body.install_id ?? "").trim();
  if (!UUID_RE.test(installId)) return err(400, "install_id invalide");

  const rl = rateLimit(`ext-beat:${installId.toLowerCase()}`, LIMIT, WINDOW_MS, Date.now());
  if (!rl.ok) return err(429, "trop de requêtes", { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) });

  const version = typeof body.version === "string" ? body.version.trim().slice(0, 32) : null;
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;
  const appIds = Array.isArray(body.app_ids)
    ? [...new Set(body.app_ids.filter((a): a is string => typeof a === "string" && a.length > 0 && a.length <= 64))].slice(0, 32)
    : [];

  // L'User-Agent de CETTE requête, pas une donnée envoyée par le client : même
  // information que rum_session.user_agent, une source de moins à faire confiance.
  const ua = req.headers.get("user-agent");

  await recordInstallBeat({ installId: installId.toLowerCase(), label, version, ua, appIds });

  return NextResponse.json({ ok: true }, { headers: CORS });
}
