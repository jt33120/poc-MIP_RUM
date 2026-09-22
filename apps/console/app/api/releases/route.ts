// GET /api/releases — releases observées sur la population et la plage de l'URL,
// pour le sélecteur de comparaison de la barre de filtres (`CompareToggle`, F06).
//
// POURQUOI UNE ROUTE. La barre de filtres est un composant client monté par le
// layout, et un layout Next ne reçoit pas les paramètres d'URL ni n'est re-rendu
// quand ils changent : il ne peut pas lui passer cette liste. Elle la lit donc ici,
// en GET — une lecture, admise pour la session démo comme pour un viewer.
//
// Même contrat que les écrans : périmètre du principal signé, plage et filtres
// validés, releases DE L'OCCURRENCE (`comparaisonVersions`, lib/queries-deploys.ts),
// triées par sessions. Protégée par le middleware (cookie de session) ; la route
// revérifie le principal, jamais le client.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { releasesComparables } from "@/lib/comparaison";
import { filtersOfQuery } from "@/lib/filters";
import { comparaisonVersions } from "@/lib/queries-deploys";
import { UnsupportedFilterError } from "@/lib/query-compiler";
import { contractErrorStatus, parseAnalyticsQuery } from "@/lib/query-contract";

export const dynamic = "force-dynamic";

const PRIVE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ releases: null, raison: "authentification requise" }, { status: 401, headers: PRIVE });

  const parsed = parseAnalyticsQuery(new URL(req.url).searchParams, { principal: user, nowMs: Date.now() });
  if (!parsed.ok) {
    return NextResponse.json(
      { releases: null, raison: parsed.error.message },
      { status: contractErrorStatus(parsed.error), headers: PRIVE },
    );
  }
  try {
    const { rows } = await comparaisonVersions(filtersOfQuery(parsed.value), 12);
    return NextResponse.json({ releases: releasesComparables(rows), raison: null }, { headers: PRIVE });
  } catch (e) {
    // Un filtre que ces mesures ne portent pas : la liste est indisponible, et dit pourquoi.
    if (e instanceof UnsupportedFilterError) {
      return NextResponse.json({ releases: null, raison: e.message }, { headers: PRIVE });
    }
    console.error("[api/releases]", e);
    return NextResponse.json({ releases: null, raison: "lecture des releases en échec" }, { status: 500, headers: PRIVE });
  }
}
