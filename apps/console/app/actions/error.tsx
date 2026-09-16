"use client";

export default function ActionsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="card p-6" role="alert">
      <h1 className="text-xl font-bold text-ink">Actions indisponibles</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">
        Les agrégats causaux n’ont pas pu être chargés. Les données collectées ne sont pas modifiées.
      </p>
      <button
        type="button"
        onClick={reset}
        className="btn-accent mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Réessayer
      </button>
    </section>
  );
}
