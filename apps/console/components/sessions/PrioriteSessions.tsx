// « À regarder d'abord » (F42, plan § 5.11.4) — hero de `/sessions`, rendu serveur.
//
// UNE LISTE CLASSÉE, PAS UN GRAPHIQUE : on regarde des sessions, pas une forme.
// Chaque ligne porte SA RAISON ÉCRITE (« 3 occurrences de TypeError · 2 clics de
// rage sur « Payer » ») — ce que Datadog ne fait pas : son Sessions Explorer
// affiche des compteurs et laisse l'analyste deviner lequel a fait monter la
// ligne. L'ordre est celui de `ordonnerPrioritaires` (erreurs, frustration,
// appels en échec, récence), écrit dans la méta : un classement dont on ne peut
// pas dire la règle ne se relit pas.
//
// AUCUNE FONCTION EN PROP (§ 0.3) : les liens (panneau, rejeu) sont calculés par
// la page et passés en chaînes — le composant reste sérialisable.
//
// TROIS ÉTATS DU REJEU, JAMAIS CONFONDUS : `true` = rejeu lu et présent (▶) ;
// `false` = lu et absent (rien, pas un bouton mort) ; `null` = NON LU (« ▶ — »
// avec sa raison). Un « pas de rejeu » affirmé sans lecture serait un mensonge
// bon marché.
import Link from "next/link";
import { EtatSurface } from "../states/EtatSurface";
import type { AlternativeTexte } from "../charts/Figure";
import { formater } from "@/lib/fmt-ids";
import { geoSourceLabel } from "@/lib/geo";
import {
  dureeObservee,
  instantUtc,
  navigateurDeSession,
  parcoursResume,
  raisonEcrite,
  valeurOuInconnu,
  type SessionPrioritaire,
} from "@/lib/sessions-priorite";

/** Liens pré-calculés d'une ligne. `rejeu: null` = aucun lien de rejeu à offrir. */
export interface HrefsPriorite {
  panel: string;
  rejeu: string | null;
}

/** Ancre de la table « Toutes les sessions » (Z6), cible du geste de l'état vide. */
export const ANCRE_TOUTES_SESSIONS = "toutes-les-sessions";

/**
 * L'alternative textuelle de la figure (P10) : construite à partir des MÊMES
 * lignes que la liste, jamais d'une seconde lecture.
 */
export function alternativePriorite(lignes: SessionPrioritaire[], plage: string): AlternativeTexte {
  return {
    legende: `Sessions à regarder d'abord, ${plage} — ordre : occurrences d'erreur, signaux de frustration, appels API en échec, dernière activité`,
    colonnes: ["Session", "Début (UTC)", "Durée observée", "Occurrences d'erreur", "Signaux de frustration", "Appels en échec", "Raison"],
    lignes: lignes.map((s) => [
      `${s.session_id.slice(0, 8)}…`,
      instantUtc(s.started_at),
      formater("s-auto", dureeObservee(s)),
      s.err_count,
      s.frustration,
      s.api_echecs,
      raisonEcrite(s.raison).join(" · ") || "aucun détail lu",
    ]),
  };
}

function Puce({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="min-w-0 truncate rounded-full border border-line bg-panel2 px-2 py-0.5 text-xs text-ink-soft">
      {children}
    </span>
  );
}

function Rejeu({ ligne, href }: { ligne: SessionPrioritaire; href: string | null }) {
  // Lu et absent : rien du tout. Un « ▶ » désactivé se lit comme un bouton cassé.
  if (ligne.rejeu === false) return null;
  if (ligne.rejeu === null || href === null) {
    return (
      <span
        data-testid="rejeu-inconnu"
        title={ligne.rejeu === null ? "existence du rejeu non lue" : "aucun instant d'erreur daté : le rejeu ne peut pas être positionné"}
        className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-ink-faint"
      >
        ▶ —
      </span>
    );
  }
  return (
    <Link
      href={href}
      data-testid="rejeu-lien"
      className="shrink-0 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-medium text-accent-ink hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
    >
      ▶ Rejeu
    </Link>
  );
}

function Ligne({ s, hrefs }: { s: SessionPrioritaire; hrefs: HrefsPriorite | undefined }) {
  const parcours = parcoursResume(s.routes);
  const navigateur = navigateurDeSession(s);
  const fragments = raisonEcrite(s.raison);
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line/60 py-2.5 first:border-0 first:pt-0" data-testid="priorite-ligne">
      {/* Sans lien calculé, l'identifiant reste du TEXTE : un lien mort (« # ») se
          présenterait comme un geste possible et ne ferait rien. */}
      {hrefs ? (
        <Link
          href={hrefs.panel}
          data-testid="priorite-session"
          className="shrink-0 rounded font-mono text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
        >
          {s.session_id.slice(0, 8)}…
        </Link>
      ) : (
        <span data-testid="priorite-session" className="shrink-0 font-mono text-xs font-semibold text-ink-soft">
          {s.session_id.slice(0, 8)}…
        </span>
      )}
      <span className="shrink-0 text-xs tabular-nums text-ink-faint">
        {instantUtc(s.started_at)} UTC · {formater("s-auto", dureeObservee(s))}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        <Puce>{valeurOuInconnu(s.device_type)}</Puce>
        <Puce title={navigateur.deduit ? "Navigateur déduit de l'user-agent : la colonne collectée est absente" : undefined}>
          {navigateur.texte}
          {navigateur.deduit ? " (déduit)" : ""}
        </Puce>
        {s.geo_country && <Puce title={`Pays estimé · ${geoSourceLabel(s.geo_source)}`}>{s.geo_country}</Puce>}
      </span>
      <Rejeu ligne={s} href={hrefs?.rejeu ?? null} />
      {parcours && (
        <span className="flex min-w-0 basis-full flex-wrap items-center gap-1 font-mono text-xs text-ink-soft">
          <span className="min-w-0 truncate">{parcours.premiere}</span>
          {parcours.reste > 0 && <span className="shrink-0 text-ink-faint">+{parcours.reste}</span>}
          {parcours.derniere && (
            <>
              <span className="shrink-0 text-accent/70">→</span>
              <span className="min-w-0 truncate">{parcours.derniere}</span>
            </>
          )}
        </span>
      )}
      <p className="min-w-0 basis-full text-xs leading-relaxed text-ink" data-testid="priorite-raison">
        {fragments.length ? fragments.join(" · ") : "Signaux comptés, détail non lu."}
      </p>
    </li>
  );
}

export function PrioriteSessions({
  lignes,
  hrefs,
  plage,
}: {
  /** Déjà classées et bornées par `ordonnerPrioritaires` (B30 les rend dans cet ordre). */
  lignes: SessionPrioritaire[];
  hrefs: Record<string, HrefsPriorite>;
  plage: string;
}) {
  if (lignes.length === 0) {
    return (
      <EtatSurface
        etat={{
          kind: "vide",
          population: "session avec erreur, frustration ou appel en échec",
          plage,
          geste: { libelle: "Voir toutes les sessions", href: `#${ANCRE_TOUTES_SESSIONS}` },
        }}
      />
    );
  }
  return (
    <ol className="min-w-0" data-testid="priorite-sessions">
      {lignes.map((s) => (
        <Ligne key={`${s.app_id}:${s.session_id}`} s={s} hrefs={hrefs[s.session_id]} />
      ))}
    </ol>
  );
}
