// Squelette sans aucun chiffre : un nombre provisoire serait lu comme un résultat.
export default function ErrorsLoading() {
  return (
    <div className="animate-pulse" role="status" aria-live="polite">
      <div className="h-8 w-48 rounded bg-panel2" />
      <div className="mt-6 h-64 rounded-xl bg-panel2" />
      <div className="mt-4 h-72 rounded-xl bg-panel2" />
      <span className="sr-only">Chargement des erreurs…</span>
    </div>
  );
}
