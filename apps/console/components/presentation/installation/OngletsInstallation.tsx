// Les sous-onglets des pages publiques d'Installation (/presentation/installation/…).
// Ces pages présentent (le schéma, l'essentiel, un tutoriel animé) ; la check-list
// détaillée vit dans la console, sur /installer, aux valeurs de l'application.
import Link from "next/link";
import { CARTES_PARCOURS } from "@/components/installer/ChoixParcours";
import { LIBELLE_PARCOURS, PARCOURS, type Parcours } from "@/lib/installer";
import { CHEMIN_INSTALLATION, cheminParcours } from "@/lib/vitrine-navigation";

/**
 * Les sous-onglets de la page Installation : la vue d'ensemble, puis les trois
 * parcours. Une barre à plat, collée sous la barre de navigation, et non plus des
 * cartes : on change de parcours comme on change d'onglet, sans relire leur résumé
 * (le schéma de la vue d'ensemble le donne). La page courante porte le trait orange.
 */
export function OngletsInstallation({ courant }: { courant: Parcours | "apercu" }) {
  const onglets = [
    { cle: "apercu" as const, href: CHEMIN_INSTALLATION, libelle: "Vue d'ensemble", badge: null },
    ...PARCOURS.map((p) => ({ cle: p, href: cheminParcours(p), libelle: LIBELLE_PARCOURS[p], badge: CARTES_PARCOURS[p].badge })),
  ];
  return (
    <nav aria-label="Installation" className="sticky top-16 z-30 border-y border-white/10 bg-[#040a1c]/85 backdrop-blur-md">
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6" data-testid="onglets-installation">
        {onglets.map((o, i) => {
          const actif = o.cle === courant;
          return (
            <li key={o.cle} className="shrink-0">
              <Link
                href={o.href}
                aria-current={actif ? "page" : undefined}
                data-testid={`onglet-${o.cle}`}
                className={`onglet-installation group relative flex items-center gap-2 whitespace-nowrap px-3 py-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#f89101] ${
                  actif ? "text-white" : "text-white/60 hover:text-white"
                }`}
              >
                {i > 0 && (
                  <span className={`font-mono text-[11px] font-bold ${actif ? "text-[#f89101]" : "text-white/35 group-hover:text-[#fbbc64]"}`}>
                    {String(i).padStart(2, "0")}
                  </span>
                )}
                {o.libelle}
                {o.badge && (
                  <span className="hidden rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-white/55 md:inline">{o.badge}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
