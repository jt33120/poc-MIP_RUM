// GET /api/releases — releases observées sur la population et la plage de l'URL,
// pour le sélecteur de comparaison de la barre de filtres (`CompareToggle`, F06).
//
// POURQUOI UNE ROUTE. La barre de filtres est un composant client monté par le
// layout, et un layout Next ne reçoit pas les paramètres d'URL ni n'est re-rendu
// quand ils changent : il ne peut pas lui passer cette liste. Elle la lit donc ici,
// en GET — une lecture, admise pour la session démo comme pour un viewer.
//
// C11 — la lecture est un CHARGEUR (`lib/chargeurs/releases.ts`), comme un écran :
// la route reste sur Vercel (le navigateur l'appelle, console-api n'accepte aucune
// origine de navigateur) et, à la bascule, devient un relais serveur : `lireEcran`
// appelle `screens.releases` au lieu du chargeur. Protégée par le middleware
// (cookie de session) ; le chargeur revérifie le principal, jamais le client.
import { NextResponse } from "next/server";
import { CODES_ERREUR, ECRANS } from "@mip/console-contract";
import { chargerReleases } from "@/lib/chargeurs/releases";
import { lireEcran } from "@/lib/ecran";

export const dynamic = "force-dynamic";

const PRIVE = { "Cache-Control": "private, no-store" };

/** Les paramètres de l'URL, un paramètre répété gardant toutes ses valeurs. */
function parametres(url: URL): Record<string, string | string[]> {
  const sp: Record<string, string | string[]> = {};
  for (const [cle, valeur] of url.searchParams) {
    const avant = sp[cle];
    sp[cle] = avant === undefined ? valeur : Array.isArray(avant) ? [...avant, valeur] : [avant, valeur];
  }
  return sp;
}

export async function GET(req: Request) {
  try {
    const lu = await lireEcran(ECRANS.releases, chargerReleases, parametres(new URL(req.url)));
    if (!lu.ok) {
      // Mode strict : le refus du service, avant le chargeur, en statut HTTP.
      const session = lu.refus.code === "session_requise" || lu.refus.code === "session_invalide";
      return NextResponse.json(
        { releases: null, raison: session ? "authentification requise" : lu.refus.message },
        { status: session ? 401 : (CODES_ERREUR as Record<string, number>)[lu.refus.code] ?? 503, headers: PRIVE },
      );
    }
    const ecran = lu.data;
    if (ecran.etat === "sans_session") {
      return NextResponse.json({ releases: null, raison: "authentification requise" }, { status: 401, headers: PRIVE });
    }
    if (ecran.etat === "refus") return NextResponse.json({ releases: null, raison: ecran.raison }, { status: ecran.statut, headers: PRIVE });
    return NextResponse.json({ releases: ecran.releases, raison: ecran.raison }, { headers: PRIVE });
  } catch (e) {
    console.error("[api/releases]", e);
    return NextResponse.json({ releases: null, raison: "lecture des releases en échec" }, { status: 500, headers: PRIVE });
  }
}
