// État de CHARGEMENT de `/mobile`. Il tient la place exacte des cartes réelles :
// une page qui grandit après coup déplace ce que l'utilisateur vient de lire.
import { PageHeader } from "@/components/PageHeader";

export default function MobileLoading() {
  return (
    <div className="animate-fade-up" aria-busy="true">
      <PageHeader title="Mobile" sub="Lecture des signaux React Native observés…" />
      <p role="status" className="sr-only">Chargement des mesures mobiles.</p>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-4">
            <div className="h-3 w-28 animate-pulse rounded bg-panel2" />
            <div className="mt-3 h-8 w-20 animate-pulse rounded bg-panel2" />
            <div className="mt-3 h-3 w-full animate-pulse rounded bg-panel2" />
          </div>
        ))}
      </div>
      <div className="card mb-6 p-4">
        <div className="h-3 w-56 animate-pulse rounded bg-panel2" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-6 w-full animate-pulse rounded bg-panel2" />
          ))}
        </div>
      </div>
    </div>
  );
}
