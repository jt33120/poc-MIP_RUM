export default function EventsLoading() {
  return (
    <div className="animate-pulse" role="status" aria-live="polite">
      <div className="h-8 w-48 rounded bg-panel2" />
      <div className="mt-6 h-28 rounded-xl bg-panel2" />
      <div className="mt-4 h-64 rounded-xl bg-panel2" />
      <span className="sr-only">Chargement de l’Explorer d’événements…</span>
    </div>
  );
}
