// Tuile « Heures × route en angle mort » (F13, plan § 5.1.2, zone 6) — rendu serveur.
//
// Le différenciateur IP-Label : là où le robot dit « tout va bien », les vrais
// visiteurs attendaient au-delà de la borne Bon, la MÊME heure, sur la MÊME route.
// Un COMPTE exact (matrice de `correlationConcordance`, F57), jamais la liste
// plafonnée de `blindSpots` (CP13), et aucune comparaison chiffrée robot / réel :
// les deux ne mesurent pas la même chose (DF1) — seuls leurs ÉTATS se comparent.
//
// Neutre (R-S) : un compte d'heures n'a pas de seuil publié, pas de ton `bad`.
import Link from "next/link";
import { KpiTile } from "@/components/charts/KpiTile";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture } from "@/components/states/SectionErreur";
import { formater } from "@/lib/fmt-ids";

export const LIBELLE_ANGLE_MORT = "Heures × route en angle mort";

export type EtatAngleMort =
  | { kind: "echec" }
  /** Un filtre de l'écran que le robot ne porte pas : le compte n'est pas calculable. */
  | { kind: "refus"; raison: string }
  /** Aucun passage du robot sur le périmètre : rien à confronter. */
  | { kind: "sans_robot" }
  | { kind: "ok"; heures: number; pire: { route: string; heures: number; href: string } | null };

export function TuileAngleMort({
  etat,
  href,
  regle,
  plage,
}: {
  etat: EtatAngleMort;
  /** `/correlation#angles-morts`, filtres conservés. */
  href: string;
  /** La règle de CR9, borne importée de `lib/rating.ts`. */
  regle: string;
  plage: string;
}) {
  if (etat.kind === "ok") {
    return (
      <div className="flex min-w-0 flex-col gap-2" data-testid="angle-mort">
        <KpiTile
          label={LIBELLE_ANGLE_MORT}
          valeur={etat.heures}
          format="count"
          sensMeilleur="bas"
          lecture={`${regle} Sur ${plage}.`}
          href={href}
        />
        {/* Un second lien, HORS de la tuile : un lien dans un lien n'est pas du HTML. */}
        {etat.pire && (
          <p className="min-w-0 break-words px-1 text-xs text-ink-soft" data-testid="angle-mort-pire">
            Pire route :{" "}
            <Link href={etat.pire.href} className="font-medium text-perf underline-offset-2 hover:underline">
              {etat.pire.route}
            </Link>
            , {formater("count", etat.pire.heures)} heure(s)
          </p>
        )}
      </div>
    );
  }
  return (
    <section className="card flex min-w-0 flex-col gap-2 p-4" data-testid="angle-mort" data-etat={etat.kind}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{LIBELLE_ANGLE_MORT}</h2>
      {etat.kind === "echec" ? (
        <EchecLecture compact titre={LIBELLE_ANGLE_MORT} />
      ) : etat.kind === "sans_robot" ? (
        <EtatSurface compact etat={{ kind: "non_collecte", manque: "aucune sonde synthétique sur ces routes" }} />
      ) : (
        <EtatSurface compact etat={{ kind: "partiel", raison: `compte non calculable sous ce filtre : ${etat.raison}` }} />
      )}
    </section>
  );
}
