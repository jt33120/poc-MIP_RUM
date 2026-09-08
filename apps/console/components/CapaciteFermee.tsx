// Écran des capacités annoncées mais fermées (Supervision IA, Supervision SVI).
//
// LE GARDE VIT DANS CHAQUE PAGE, PAS DANS UN LAYOUT. Un layout qui renverrait
// ceci à la place de `children` ne bloquerait rien : Next rend la page en
// parallèle et la passe en children, donc son travail serveur — requêtes SVI,
// appel à la façade xSOM — serait quand même exécuté. Le refus doit précéder
// la première ligne de la page.
import { PageHeader } from "@/components/PageHeader";
import { ICON_PATHS, Icon } from "@/components/icons";
import { CATEGORIES } from "@/components/nav-items";

/** La capacité couvrant ce chemin est-elle fermée ? Même drapeau que la sidebar. */
export function estFermee(href: string): boolean {
  return CATEGORIES.some((c) => c.verrouille && (href === c.href || href.startsWith(`${c.href}/`)));
}

export function CapaciteFermee({ titre, sujet }: { titre: string; sujet: string }) {
  return (
    <div className="animate-fade-up">
      <PageHeader title={titre} sub={`${sujet} Capacité annoncée, accès non ouvert.`} />
      <div className="card flex max-w-2xl flex-col items-start gap-3 p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel2 text-ink-faint">
          <Icon paths={ICON_PATHS.lock} className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <h2 className="text-base font-semibold text-ink">Accès fermé pour le moment</h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          Cet espace n&apos;est pas encore ouvert. Le reste de la console — performance,
          sessions, erreurs, objectifs et alertes — fonctionne normalement.
        </p>
      </div>
    </div>
  );
}
