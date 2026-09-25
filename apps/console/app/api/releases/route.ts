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
// origine de navigateur) et, à la bascule, devient un relais serveur — sans changer
// d'une ligne, puisque c'est `chargerEcran` qui change. Protégée par le middleware
// (cookie de session) ; le chargeur revérifie le principal, jamais le client.
import { NextResponse } from "next/server";
import { chargerReleases } from "@/lib/chargeurs/releases";
import { chargerEcran } from "@/lib/ecran-local";

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
    const ecran = await chargerEcran(chargerReleases, parametres(new URL(req.url)));
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
