export default function ActionsLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Chargement des actions">
      <div className="mb-6 space-y-2">
        <div className="h-3 w-36 rounded bg-panel2" />
        <div className="h-7 w-28 rounded bg-panel2" />
        <div className="h-4 max-w-2xl rounded bg-panel2" />
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="card h-24" />)}
      </div>
      <div className="card h-80" />
    </div>
  );
}
