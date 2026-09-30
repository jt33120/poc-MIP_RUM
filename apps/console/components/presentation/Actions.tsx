// Les actions de la présentation : la démo et la connexion côte à côte, ou « Ouvrir la
// console » pour qui est connecté. Sorties de la vitrine archivée le 30/09/2026
// (archive/LandingArchive.tsx) : le dossier technique et l'archive les partagent.
import Link from "next/link";
import { ICON_PATHS, Icon } from "@/components/icons";
import type { SessionUser } from "@/lib/auth";
import { demoConfig } from "@/lib/demo";

const PLEIN =
  "bg-gradient-to-r from-accent via-[#fca62b] to-accent-deep text-navy-950 shadow-[0_8px_22px_-10px_rgba(248,145,1,0.9)] hover:brightness-110 hover:shadow-[0_10px_26px_-8px_rgba(248,145,1,0.95)]";
const CONTOUR = "border border-line bg-panel/70 text-ink backdrop-blur-sm hover:border-accent/50";
const VERROUILLE = "cursor-not-allowed border border-dashed border-line bg-panel/40 text-ink-soft";

/**
 * Les actions de la présentation, dans l'en-tête (`size="sm"`) et sous le titre.
 *
 * Connecté : une seule, ouvrir la console. Visiteur : démo et connexion côte à
 * côte, toujours dans cet ordre ; sans DEMO_USER_APPS, la démo reste affichée mais
 * verrouillée — pas de lien mort, juste une promesse pas encore tenue, avec l'info
 * au survol.
 */
export function Actions({
  size = "md",
  user,
  demoOuverte,
  fin = false,
}: {
  size?: "sm" | "md";
  user: SessionUser | null;
  demoOuverte?: boolean;
  /** Le rappel en bas de page : ses repères de test ne doivent pas doubler ceux du titre. */
  fin?: boolean;
}) {
  const suffixe = fin ? "-fin" : size === "sm" ? "-top" : "";
  if (user) {
    // <a>, PAS <Link>, pour la même raison que /demo plus bas : la vitrine est rendue
    // sans la coquille de la console, et une navigation client ne re-rend pas le
    // layout racine — la console s'afficherait un instant sans sa barre latérale.
    return (
      <a
        href="/"
        data-testid={`presentation-console${suffixe}`}
        className={`btn-accent inline-flex shrink-0 items-center gap-2 ${size === "sm" ? "" : "px-5 py-2.5 text-base"}`}
      >
        Ouvrir la console <span aria-hidden>→</span>
      </a>
    );
  }
  // C1c : la page dit si la démo est ouverte (console-api, `lib/methodes-connexion.ts`) ;
  // sans elle, la variable de Vercel.
  const demo = demoOuverte ?? demoConfig() !== null;
  const pad = size === "sm" ? "px-4 py-2 text-sm" : "px-6 py-3 text-base";
  const base = `inline-flex shrink-0 items-center gap-2 rounded-xl font-semibold transition ${pad}`;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {demo ? (
        // <a>, PAS <Link> : /demo ouvre une session, donc change de coquille (nue ->
        // console). Une navigation client ne re-rend jamais le layout racine : la
        // Vue d'ensemble s'affichait sans sidebar ni en-tête jusqu'au rechargement.
        // Une navigation document re-rend tout, et ne préchargera jamais la route
        // (un prefetch ouvrirait une session démo au simple survol).
        <a href="/demo" data-testid={`presentation-demo${suffixe}`} className={`${base} ${PLEIN}`}>
          Voir la démo <span aria-hidden>→</span>
        </a>
      ) : (
        <span
          aria-disabled="true"
          title="Démo bientôt disponible"
          data-testid={`presentation-demo${suffixe}`}
          className={`${base} ${VERROUILLE}`}
        >
          <Icon paths={ICON_PATHS.lock} className="h-3.5 w-3.5" strokeWidth={2.4} />
          Voir la démo
        </span>
      )}
      <Link
        href="/login"
        data-testid={`presentation-login${suffixe}`}
        className={`${base} ${demo ? CONTOUR : PLEIN}`}
      >
        Se connecter {!demo && <span aria-hidden>→</span>}
      </Link>
    </div>
  );
}
