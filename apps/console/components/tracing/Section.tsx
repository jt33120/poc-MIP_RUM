// Encart de section Tracing : titre + sous-titre + carte contenant un tableau.
// Rendu 100 % serveur. Extrait de app/tracing/page.tsx.

/** Bloc de section avec titre, description et carte enveloppante. */
export function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-1 text-base font-semibold tracking-tight">{title}</h2>
      <p className="mb-3 text-xs text-ink-soft">{sub}</p>
      <div className="card overflow-hidden">{children}</div>
    </div>
  );
}
