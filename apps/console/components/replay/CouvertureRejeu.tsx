// La couverture d'un rejeu, en pastilles (refonte du 30/09/2026) : ce qui est masqué,
// combien de temps c'est gardé, ce que l'enregistrement couvre. La phrase entière
// (`TEXTE_COUVERTURE`, § 5.12.4) reste dans la page — lue par les lecteurs d'écran et
// survolée —, écrite dans TOUS les états du lecteur comme avant ; seules trois
// pastilles la montrent. Rendu serveur comme client, sans état.
import {
  REJEU_CONSERVATION_JOURS,
  REJEU_MAX_MS,
  REJEU_MAX_OCTETS,
  TEXTE_COUVERTURE,
} from "@/lib/replay-synchro";

const PASTILLE = "inline-flex items-center gap-1 rounded-full bg-panel2 px-2 py-0.5";

export function CouvertureRejeu() {
  return (
    <p
      className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-ink-soft"
      data-testid="replay-couverture"
      title={TEXTE_COUVERTURE}
    >
      <span aria-hidden="true" className={PASTILLE}>
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        Saisies masquées
      </span>
      <span aria-hidden="true" className={`${PASTILLE} tabular-nums`}>
        ≤ {REJEU_MAX_MS / 60_000} min · ≤ {REJEU_MAX_OCTETS / (1024 * 1024)} Mo
      </span>
      <span aria-hidden="true" className={`${PASTILLE} tabular-nums`}>
        conservé {REJEU_CONSERVATION_JOURS} j
      </span>
      <span className="sr-only">{TEXTE_COUVERTURE}</span>
    </p>
  );
}
