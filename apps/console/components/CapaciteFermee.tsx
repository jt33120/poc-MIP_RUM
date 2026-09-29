// Écran des capacités annoncées mais fermées (Logs, Supervision IA).
//
// LE GARDE VIT DANS CHAQUE PAGE, PAS DANS UN LAYOUT. Un layout qui renverrait
// ceci à la place de `children` ne bloquerait rien : Next rend la page en
// parallèle et la passe en children, donc son travail serveur — requêtes de
// journaux, appel à la façade xSOM — serait quand même exécuté. Le refus doit précéder
// la première ligne de la page.
//
// État « fermé » du vocabulaire commun (§ 3.8), rendu dans le cadre des états
// (`CadreEtat`, teinte neutre, rôle `note`).
//
// CE QUE L'ÉCRAN DIT (recette du 26/09/2026). « Accès fermé pour le moment » et
// « Capacité annoncée, accès non ouvert » ne disaient ni ce que l'écran
// apporterait, ni comment l'obtenir. L'écran dit désormais les deux. La barre de
// filtres et la pastille « LIVE » sont masquées sur ces chemins (`GlobalFilters`,
// `AutoRefresh`), et le surtitre suit la sidebar (`surtitreDe`).
import { PageHeader } from "@/components/PageHeader";
import { ICON_PATHS, Icon } from "@/components/icons";
import { CadreEtat } from "@/components/states/EtatSurface";

/** La capacité couvrant ce chemin est-elle fermée ? Même liste que la sidebar et les chargeurs (`lib/capacites.ts`). */
export { estFermee } from "@/lib/capacites";

/** Ce que chaque capacité fermée apportera, en une phrase d'utilisateur. */
const APPORTS: Record<string, string> = {
  "Logs":
    "Les journaux de vos serveurs — erreurs et avertissements — rattachés aux sessions et aux traces : partir d'une erreur vue par un visiteur et retrouver la ligne de journal qui l'explique.",
  "Supervision IA":
    "La supervision de vos agents et modèles d'IA en production : volumes, temps de réponse, erreurs et dérives.",
};

export function CapaciteFermee({
  titre,
  sujet,
}: {
  titre: string;
  /** Une phrase qui situe l'écran (sous-titre). */
  sujet: string;
}) {
  const apport = APPORTS[titre];
  return (
    <div className="animate-fade-up">
      <PageHeader title={titre} sub={sujet} />
      <CadreEtat ton="neutre" role="note" etat="ferme" className="flex max-w-2xl flex-col items-start gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel2 text-ink-faint">
          <Icon paths={ICON_PATHS.lock} className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <h2 className="text-base font-semibold text-ink">Cet espace n&apos;est pas encore ouvert sur votre projet</h2>
        {apport && (
          <p className="text-sm leading-relaxed text-ink-soft">
            <span className="font-medium text-ink">Ce qu&apos;il apportera : </span>
            {apport}
          </p>
        )}
        <p className="text-sm leading-relaxed text-ink-soft">
          <span className="font-medium text-ink">Pour l&apos;ouvrir : </span>
          demandez-le à votre interlocuteur MIP. En attendant, le reste de la console — performance, sessions, erreurs,
          objectifs et alertes — fonctionne normalement.
        </p>
      </CadreEtat>
    </div>
  );
}
