// Case « Heures × route en angle mort » (F13, plan § 5.1.2, zone 6) — rendu serveur.
//
// Le différenciateur IP-Label : là où le robot dit « tout va bien », les vrais
// visiteurs attendaient au-delà de la borne Bon, la MÊME heure, sur la MÊME route.
// Un COMPTE exact (matrice de `correlationConcordance`, F57), jamais la liste
// plafonnée de `blindSpots` (CP13), et aucune comparaison chiffrée robot / réel :
// les deux ne mesurent pas la même chose (DF1) — seuls leurs ÉTATS se comparent.
//
// Neutre (R-S) : un compte d'heures n'a pas de seuil publié, pas de ton `bad`.
//
// UNE CASE, PAS UNE COLONNE (recette du 30/09/2026 : « une colonne de 4/12 vide »). La
// case montre le compte et la pire route ; un clic ouvre sa fenêtre : la règle, la
// pire route en lien, le lien vers la corrélation. Sans robot ou sous un filtre qu'il
// ne porte pas : une ligne, jamais un « 0 ».
import Link from "next/link";
import { FicheMesure } from "@/components/charts/FicheMesure";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture } from "@/components/states/SectionErreur";
import { formater } from "@/lib/fmt-ids";
import { pluriel } from "@/lib/format";
import { EnteteVignette, LigneSansCase } from "./Vignette";

export const LIBELLE_ANGLE_MORT = "Heures × route en angle mort";

export type EtatAngleMort =
  | { kind: "echec" }
  /** Un filtre de l'écran que le robot ne porte pas : le compte n'est pas calculable. */
  | { kind: "refus"; raison: string }
  /** Aucun passage du robot sur le périmètre : rien à confronter. */
  | { kind: "sans_robot" }
  | { kind: "ok"; heures: number; pire: { route: string; heures: number; href: string } | null };

const SOURCE =
  "Robot synthétique MIP (sondes planifiées) et mesures LCP des vrais visiteurs (SDK MIP RUM), confrontés heure par heure et route par route.";

export function TuileAngleMort({
  etat,
  href,
  regle,
  plage,
  enLigne = false,
}: {
  etat: EtatAngleMort;
  /** `/correlation#angles-morts`, filtres conservés. */
  href: string;
  /** La règle de CR9, borne importée de `lib/rating.ts` : la méthode de la case. */
  regle: string;
  plage: string;
  /** Sans compte à montrer, un élément de la ligne des états de l'écran (et non une carte). */
  enLigne?: boolean;
}) {
  if (etat.kind === "ok") {
    return (
      <div className="flex h-full min-w-0 flex-col [&>button]:grow" data-testid="angle-mort">
        <FicheMesure
          titre={LIBELLE_ANGLE_MORT}
          ariaLabel={`${LIBELLE_ANGLE_MORT} : ${formater("count", etat.heures)} sur ${plage}${
            etat.pire ? `, pire route ${etat.pire.route} (${pluriel(etat.pire.heures, "heure")})` : ""
          } — ouvrir le détail`}
          testId="vignette-angle-mort"
          case={
            <>
              <EnteteVignette titre="Angle mort robot / réel" meta={plage} />
              <span className="flex items-baseline gap-1.5 tabular-nums tracking-tight">
                <span className="text-[26px] font-semibold leading-8 text-ink" data-testid="kpi-valeur">
                  {formater("count", etat.heures)}
                </span>
                <span className="text-xs font-medium text-ink-soft">heures × route</span>
              </span>
              {etat.pire ? (
                <span className="flex min-w-0 items-baseline gap-1 text-[11px] text-ink-soft">
                  <span className="shrink-0">pire</span>
                  <span className="min-w-0 truncate font-mono text-ink" title={etat.pire.route}>
                    {etat.pire.route}
                  </span>
                  <span className="shrink-0 tabular-nums">· {formater("count", etat.pire.heures)} h</span>
                </span>
              ) : (
                <span className="text-[11px] text-ink-faint">aucune route en angle mort</span>
              )}
              <span className="truncate text-[10px] text-ink-faint">Synthétique × RUM</span>
            </>
          }
        >
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <span className="text-4xl font-semibold tabular-nums">{formater("count", etat.heures)}</span>
            <span className="text-sm text-ink-soft">heures × route sur {plage}</span>
          </div>
          <dl className="mt-4 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs leading-snug">
            <dt className="text-ink-faint">Règle</dt>
            <dd className="min-w-0 text-ink-soft [overflow-wrap:anywhere]" data-testid="kpi-methode">
              {regle}
            </dd>
            <dt className="text-ink-faint">Lecture</dt>
            <dd className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">
              Un compte d&apos;heures × route, sans seuil publié : il reste neutre. Les valeurs du robot et des visiteurs ne se
              comparent pas (ils ne mesurent pas la même chose) ; seuls leurs états se confrontent.
            </dd>
            <dt className="text-ink-faint">Source</dt>
            <dd className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">{SOURCE}</dd>
          </dl>
          {etat.pire && (
            <p className="mt-3 min-w-0 break-words text-sm text-ink-soft" data-testid="angle-mort-pire">
              Pire route :{" "}
              <Link href={etat.pire.href} className="font-medium text-perf underline-offset-2 hover:underline">
                {etat.pire.route}
              </Link>
              , {pluriel(etat.pire.heures, "heure")}
            </p>
          )}
          <Link
            href={href}
            data-testid="angle-mort-lien"
            className="mt-4 inline-flex text-sm font-medium text-perf underline-offset-2 hover:underline"
          >
            Écran détaillé →
          </Link>
        </FicheMesure>
      </div>
    );
  }
  // Rien à compter (pas de robot, filtre qu'il ne porte pas) : une ligne dans la bande
  // des états de l'écran, pas une case vide.
  if (enLigne && etat.kind !== "echec") {
    return (
      <LigneSansCase
        titre={LIBELLE_ANGLE_MORT}
        testId="angle-mort"
        etat={etat.kind}
        texte={
          etat.kind === "sans_robot"
            ? "Non collecté : aucune sonde synthétique sur ces routes"
            : `Partiel : compte non calculable sous ce filtre : ${etat.raison}`
        }
      />
    );
  }
  return (
    <section
      className="card flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
      data-testid="angle-mort"
      data-etat={etat.kind}
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{LIBELLE_ANGLE_MORT}</h2>
      <div className="min-w-0 sm:ml-auto">
        {etat.kind === "echec" ? (
          <EchecLecture compact titre={LIBELLE_ANGLE_MORT} />
        ) : etat.kind === "sans_robot" ? (
          <EtatSurface compact enLigne etat={{ kind: "non_collecte", manque: "aucune sonde synthétique sur ces routes" }} />
        ) : (
          <EtatSurface compact etat={{ kind: "partiel", raison: `compte non calculable sous ce filtre : ${etat.raison}` }} />
        )}
      </div>
    </section>
  );
}
