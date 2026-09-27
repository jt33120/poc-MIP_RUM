// PS5 — Les écrans de la console (plan § 8.2) : une carte par catégorie de la
// navigation, la liste de ses écrans, puis les méthodes d'analyse. Rendu serveur.
//
// UNE SEULE LISTE D'ÉCRANS. Catégories, libellés et adresses viennent de
// `CATEGORIES` (components/nav-items.tsx), celle que lit la barre latérale ; rien
// n'est recopié ici. Les écrans rendus sont ceux que la navigation rend
// (`sousOnglets` : l'onglet interne « Actions » reste dans « Interactions »).
//
// CE QUI N'EST PAS MONTRÉ : les catégories `verrouille` (Logs, Supervision SVI,
// Supervision IA). La console les annonce fermées ; la vitrine ne les présente pas
// comme des écrans qui existent.
//
// Visiteur : du texte — ces routes demandent une session —, et, si la démo est
// ouverte, une invitation à les voir en lecture seule. Connecté : des liens, en <a>
// et non en <Link> (même raison que « Ouvrir la console », Landing.tsx : la page est
// hors coquille, une navigation client ne re-rendrait pas le layout).
//
// UN LIBELLÉ PAR ÉCRAN (recette du 26/09/2026). Une catégorie sans sous-onglets
// (« API et MCP ») se répétait sous son propre titre, et « Explorer » listait un écran
// « Explorer » : le titre de la catégorie porte désormais son écran d'arrivée, et la
// liste ne reprend que les autres.
import { ICON_PATHS, Icon } from "@/components/icons";
import { CATEGORIES, sousOnglets, type NavCategory, type NavLink } from "@/components/nav-items";
import { SousPartie } from "@/components/presentation/SousPartie";
import type { SessionUser } from "@/lib/auth";
import { RELEVE } from "@/lib/couverture";

/**
 * Les catégories ouvertes, et pour chacune les écrans que la navigation rend, sauf
 * celui qui porte le nom de la catégorie : c'est son titre qui y mène.
 */
export function categoriesMontrees(): { categorie: NavCategory; ecrans: NavLink[] }[] {
  return CATEGORIES.filter((c) => !c.verrouille).map((categorie) => ({
    categorie,
    ecrans: categorie.children ? sousOnglets(categorie).filter((e) => e.label !== categorie.label) : [],
  }));
}

const LIEN = "rounded font-medium text-perf underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

export function EcransConsole({ user, demoOuverte = false }: { user: SessionUser | null; demoOuverte?: boolean }) {
  return (
    <SousPartie
      id="contient-ecrans"
      titre="Les écrans de la console"
      chapeau={
        <>
          Les écrans qui existent dans la console. Ils ont été construits et testés sur des jeux de
          démonstration ; aucun n&apos;a encore été relu sur le trafic d&apos;une vraie application.
        </>
      }
    >
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="ecrans-console">
        {categoriesMontrees().map(({ categorie, ecrans }) => (
          <li key={categorie.href} className="card min-w-0 p-4 sm:p-5" data-testid="ecrans-categorie">
            <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
              <Icon paths={ICON_PATHS[categorie.icon]} className="h-4 w-4 shrink-0 text-perf" />
              <span className="min-w-0 break-words">
                {user ? (
                  <a href={categorie.href} className={LIEN}>
                    {categorie.label}
                  </a>
                ) : (
                  categorie.label
                )}
              </span>
            </h4>
            {ecrans.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
                {ecrans.map((e) => (
                  <li key={e.href} className="min-w-0 break-words">
                    {user ? (
                      <a href={e.href} className={LIEN}>
                        {e.label}
                      </a>
                    ) : (
                      e.label
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {!user && demoOuverte && (
        <p className="mt-4 text-sm text-ink-soft" data-testid="ecrans-demo">
          Tous ces écrans s&apos;ouvrent dans la démo, en lecture seule :{" "}
          {/* Navigation document : /demo ouvre une session (voir Actions, Landing.tsx). */}
          <a href="/demo" className={LIEN}>
            voir la démo
          </a>
          .
        </p>
      )}

      {/* Méthodes d'analyse. Le plan écrivait « Trois analyses automatiques » : les lots
          P* en ont ajouté depuis (intervalles, sur-représentation, datation de rupture,
          concordance ; lib/stats/). Un compte exact vieillirait au prochain lot :
          « notamment ». Sources : lib/glossary.ts (health, anomaly, forecast),
          components/health/HealthBanner.tsx (FORMULE_SANTE, la pondération affichée) ;
          le relevé ne couvre que P5 à P8 (RUM_PARITY_STATUS.md:1). */}
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-soft" data-testid="methodes-analyse">
        Les analyses automatiques sont des méthodes statistiques lisibles, sans modèle entraîné :
        notamment un score de santé dont la pondération est affichée, une détection d&apos;anomalies par
        écart à la moyenne, calculée en base, et une tendance par régression sur les séries
        journalières. Le relevé du {RELEVE} ne couvre ni le score de santé, ni les anomalies, ni les
        tendances.
      </p>
    </SousPartie>
  );
}
