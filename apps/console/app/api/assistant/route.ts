// POST /api/assistant — l'assistant du tableau de bord (30/09/2026).
//
// Reçoit `{ question, digest }` : la question de l'utilisateur et le condensé des
// chiffres que la Vue d'ensemble lui a déjà montrés (`lib/assistant/digest.ts`).
// Rend `{ mode, texte, citations, avertissement? }` : la réponse du modèle quand il
// est configuré (Mistral AI, `lib/assistant/mistral.ts`), sinon la réponse par
// règles (`lib/assistant/resume.ts`) — jamais une page d'erreur pour une question.
//
// CE QUE LA ROUTE REFUSE, dans l'ordre :
//   · sans session : 401 (le middleware redirige déjà vers /login ; la route revérifie
//     le principal elle-même, comme toute action) ;
//   · une session de démonstration : 403 (lecture seule, et ouverte à l'internet
//     entier : elle ne dépense pas le quota du modèle ; le volet répond par règles
//     dans le navigateur) ;
//   · un corps qui n'est pas du JSON : 415 (un formulaire d'un autre site ne peut pas
//     poster du JSON sans une requête préalable, que cette route n'autorise pas) ;
//   · au-delà de 20 questions en 10 minutes pour le même utilisateur : 429 ;
//   · un corps de plus de 32 Kio : 413 ;
//   · une question ou un condensé mal formés : 400.
//
// ELLE NE LIT PAS LA BASE (cliquet « console sans base ») : tout ce qu'elle dit vient
// du condensé, vérifié et masqué (`lib/assistant/validation.ts`).
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { compterQuestion } from "@/lib/assistant/debit";
import { repondre } from "@/lib/assistant/mistral";
import { validerDemande } from "@/lib/assistant/validation";

export const dynamic = "force-dynamic";

/** 32 Kio : un condensé complet en pèse moins de 24 (`MAX_OCTETS_DIGEST`). */
const LIMITE_OCTETS = 32 * 1024;
const PRIVE = { "Cache-Control": "private, no-store" };

const refus = (statut: number, raison: string, entetes: Record<string, string> = {}) =>
  NextResponse.json({ raison }, { status: statut, headers: { ...PRIVE, ...entetes } });

/** Le corps, lu morceau par morceau et abandonné dès qu'il dépasse la limite ; `null` : trop gros. */
async function lireCorps(req: Request, limite: number): Promise<string | null> {
  const annonce = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(annonce) && annonce > limite) return null;
  if (!req.body) return "";
  const lecteur = req.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await lecteur.cancel().catch(() => undefined);
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(total);
  let decalage = 0;
  for (const m of morceaux) {
    tout.set(m, decalage);
    decalage += m.byteLength;
  }
  return new TextDecoder().decode(tout);
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return refus(401, "authentification requise");
  if (user.demo) return refus(403, "compte de démonstration : l'assistant répond par règles, sans modèle");
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return refus(415, "corps JSON attendu");

  const debit = compterQuestion(user.email);
  if (!debit.ok) {
    return refus(429, "limite de 20 questions par 10 minutes atteinte", { "Retry-After": String(Math.max(1, Math.ceil(debit.resetMs / 1000))) });
  }

  const brut = await lireCorps(req, LIMITE_OCTETS);
  if (brut === null) return refus(413, "demande de plus de 32 Kio");
  let corps: unknown;
  try {
    corps = JSON.parse(brut);
  } catch {
    return refus(400, "corps JSON illisible");
  }
  const demande = validerDemande(corps);
  if (!demande.ok) return refus(400, demande.raison);

  const reponse = await repondre(demande.valeur.question, demande.valeur.digest);
  return NextResponse.json(reponse, { headers: PRIVE });
}
