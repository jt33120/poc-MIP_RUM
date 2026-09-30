// L'état du serveur MCP, demandé à chaque affichage plutôt qu'affirmé : si le
// service tombe ou change d'adresse sans que la constante suive, la page ne doit
// pas distribuer une adresse morte en la disant en ligne (`lib/mcp-sonde.ts`).
//
// ÉCHEC DOUX. Une sonde qui n'aboutit pas dit « non vérifié » et pourquoi : la
// cause peut être le réseau sortant de la console, pas le serveur MCP.
import { sonderMcp, type EtatMcp as Etat } from "@/lib/mcp-sonde";

const PASTILLE = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";

/** La pastille, d'après un état de sonde (rendu pur, testé). */
export function PastilleMcp({ etat }: { etat: Etat }) {
  if (etat.joignable) {
    return (
      <span className={`${PASTILLE} border-good/40 bg-good/10 text-good-ink`} data-testid="mcp-etat" data-etat="en-ligne">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-good" />
        En ligne{etat.version ? <span className="font-mono text-ink-faint">v{etat.version}</span> : null}
      </span>
    );
  }
  return (
    <span
      className={`${PASTILLE} border-warn/40 bg-warn/10 text-warn-ink`}
      data-testid="mcp-etat"
      data-etat="non-verifie"
      title={etat.motif ? `Vérification impossible : ${etat.motif}` : undefined}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />
      Non vérifié
      {etat.motif && <span className="sr-only"> : {etat.motif}</span>}
    </span>
  );
}

/** Pendant la sonde (3 s au plus) : la page s'affiche, la pastille suit. */
export function PastilleMcpAttente() {
  return (
    <span className={`${PASTILLE} border-line bg-panel2 text-ink-faint`} data-testid="mcp-etat" data-etat="attente">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink-faint" />
      Vérification…
    </span>
  );
}

export async function EtatMcp() {
  return <PastilleMcp etat={await sonderMcp()} />;
}
