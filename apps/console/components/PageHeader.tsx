// En-tête de page standard : titre + sous-titre descriptif + zone d'actions à droite.
import { GlossaryTip } from "./GlossaryTip";
import { SurtitreDomaine, type PageDomain } from "./SurtitreDomaine";
import type { GlossaryId } from "@/lib/glossary";

export type { PageDomain };

export function PageHeader({
  title,
  sub,
  help,
  domain,
  children,
}: {
  title: React.ReactNode;
  /** Question à laquelle l'écran répond (P1). Attendu sur tout écran du périmètre :
   *  il reste optionnel au typage tant que chaque écran n'est pas repris par son lot. */
  sub?: React.ReactNode;
  /** Clé de glossaire : ajoute une bulle d'aide « ? » à côté du titre. */
  help?: GlossaryId;
  /** Catégorie de navigation (surtitre et couleur, § 2.4) : `perf`, `robot`,
   *  `usages`, `fiabilite`, `explorer` ou `ai`. Absent : celle qui range la route
   *  courante dans la navigation, « perf » à défaut. */
  domain?: PageDomain;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-3">
      <div className="min-w-0">
        <SurtitreDomaine domain={domain} />
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">
          {title}
          {help && <GlossaryTip id={help} />}
        </h1>
        {sub && <p className="mt-1 text-sm text-ink-soft">{sub}</p>}
      </div>
      {/* Les actions PASSENT À LA LIGNE plutôt que de déborder. `shrink-0` les
          gardait sur une seule ligne : une quatrième action (« Dupliquer », P6.5)
          poussait l'en-tête au-delà de 390 px de large. Wrapper n'enlève rien aux
          en-têtes qui tiennent déjà ; il évite qu'une action de plus ne casse la
          page la plus étroite. */}
      {children && (
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{children}</div>
      )}
    </div>
  );
}
