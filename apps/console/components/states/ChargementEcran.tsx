// État « chargement » d'un ÉCRAN : le corps commun des `loading.tsx` de route
// (F02, § 3.8). Rendu serveur, sans lecture.
//
// Le squelette occupe la place des blocs réels (hero, rangée de tuiles, table) :
// une page qui grandit après coup déplace ce que l'utilisateur vient de lire. Un
// SEUL texte pour lecteur d'écran (« Chargement de <écran> ») : les blocs
// décoratifs sont `aria-hidden`, sinon chacun annoncerait son propre chargement.
import { PageHeader } from "@/components/PageHeader";
import { EtatSurface } from "./EtatSurface";

const BLOC = "rounded-lg bg-panel2 motion-safe:animate-pulse";

export function ChargementEcran({ titre }: { titre?: string }) {
  return (
    <div aria-busy="true" data-testid="chargement-ecran">
      {titre ? (
        <PageHeader title={titre} />
      ) : (
        <div aria-hidden="true" className={`mb-6 h-12 w-64 max-w-full ${BLOC}`} />
      )}
      <div className="card mb-6 p-5">
        <EtatSurface etat={{ kind: "chargement", titre: titre ?? "l'écran" }} />
      </div>
      <div aria-hidden="true" className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-20 ${BLOC}`} />
        ))}
      </div>
      <div aria-hidden="true" className={`h-48 ${BLOC}`} />
    </div>
  );
}
