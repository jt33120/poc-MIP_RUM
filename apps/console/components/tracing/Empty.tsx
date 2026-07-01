// Ligne de tableau vide (message centré) pour les tableaux Tracing.
// Rendu 100 % serveur. Extrait de app/tracing/page.tsx.

/** Ligne « aucune donnée » couvrant l'ensemble des colonnes. */
export function Empty({ cols, msg }: { cols: number; msg: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-sm text-ink-faint">
        {msg}
      </td>
    </tr>
  );
}
