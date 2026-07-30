// POST /api/alerts/email?token=… — relais e-mail des alertes (migration-v49).
//
// Appelé par `route_alert()` via pg_net. La base ne détient aucune clé de
// fournisseur : elle ne connaît que l'URL de ce relais, jeton compris — même
// modèle de confiance qu'une URL de webhook Slack.
//
// Le code HTTP rendu ici DÉTERMINE le statut de livraison enregistré en base
// après réconciliation. D'où une règle stricte : ne jamais répondre 2xx sans
// qu'un e-mail soit réellement parti. Un relais non configuré répond 503 — la
// livraison est alors `failed`, visible, plutôt que faussement verte.
import { type NextRequest, NextResponse } from "next/server";
import { buildAlertMail, mailerConfig, sendAlertMail, tokenMatches } from "@/lib/alert-email";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!tokenMatches(req.nextUrl.searchParams.get("token"), process.env.ALERT_RELAY_TOKEN))
    return NextResponse.json({ error: "jeton de relais invalide" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const mail = buildAlertMail(body as Record<string, unknown>);
  if (!mail)
    return NextResponse.json(
      { error: "destinataire ou texte d'alerte manquant/invalide" },
      { status: 400 },
    );

  const cfg = mailerConfig();
  if (!cfg)
    return NextResponse.json(
      {
        error:
          "relais e-mail non configuré : ALERT_EMAIL_API_KEY et ALERT_EMAIL_FROM sont requis",
      },
      { status: 503 },
    );

  const sent = await sendAlertMail(mail, cfg);
  if (!sent.ok)
    return NextResponse.json(
      { error: "le fournisseur a refusé l'envoi", status: sent.status, detail: sent.detail },
      { status: sent.status >= 500 ? 502 : 400 },
    );

  return NextResponse.json({ ok: true, to: mail.to });
}
