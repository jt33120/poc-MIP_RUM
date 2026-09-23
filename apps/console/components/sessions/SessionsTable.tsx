// « Toutes les sessions » (F42, plan § 5.11.4, Z6) — table dense, rendu serveur.
//
// POURQUOI UNE TABLE. Les cartes empilées demandaient 2 600 px pour 28 sessions ;
// une table en montre 50 sur un écran, avec des colonnes comparables d'une ligne
// à l'autre. À 390 px elle redevient des cartes de trois lignes : une table de
// treize colonnes n'y est pas lisible, et la faire défiler à la main l'est encore
// moins (§ 5.11.3).
//
// ORDRE FIXE `(last_seen_at, session_id) desc`, JAMAIS TRIABLE : un tri par
// signaux exigerait une pagination par décalage, instable dès qu'une session
// arrive entre deux pages. La priorité est portée par le hero, borné à 10 lignes
// et dit comme tel (§ 5.11.6).
//
// FRUSTRATION ET REJEU AVANT B30 : « — » avec sa raison en infobulle. Jamais
// « 0 », qui affirmerait une absence de signal qu'aucune lecture n'a établie (V3).
//
// AUCUNE FONCTION EN PROP : tous les liens sont calculés par la page et passés en
// dictionnaires indexés par identifiant (ou par route).
import Link from "next/link";
import { formater } from "@/lib/fmt-ids";
import { geoSourceLabel } from "@/lib/geo";
import {
  SIGNAUX_A_CREER,
  dureeObservee,
  instantUtc,
  navigateurDeSession,
  parcoursResume,
  valeurOuInconnu,
  type LigneSessions,
} from "@/lib/sessions-priorite";

const TH = "th whitespace-nowrap";
const TD = "px-3 py-2 align-top text-xs";

export interface SessionsTableProps {
  lignes: LigneSessions[];
  /** `panel=session:<id>` par ligne (F43). Sans entrée pour une ligne, elle mène à la page de session. */
  panelHrefs: Record<string, string>;
  /**
   * Session ouverte en panneau (F43, ajout au § 4.3) : sa ligne est marquée
   * (`aria-current`, fond) — à 1280 px et plus, la liste reste lisible à gauche du
   * panneau, et ↑ / ↓ la parcourent : on doit y voir où l'on est.
   */
  ouvert?: string | null;
  /** `/sessions/<id>`, filtres conservés. */
  pageHrefs: Record<string, string>;
  /** `breakdownDrillHref` d'une route du parcours (§ 3.3). */
  routeHrefs?: Record<string, string>;
  /** `/sessions/<id>?tab=replay` quand l'existence du rejeu est LUE et vraie. */
  rejeuHrefs?: Record<string, string>;
  /** Page suivante par curseur ; `null` = dernière page. */
  suivantHref: string | null;
  /** Retour à la première page quand un curseur est actif (hors § 4.3, voir la PR). */
  debutHref?: string | null;
  /** Phrase rendue quand aucune ligne n'est lue — jamais « 0 session » dessiné. */
  vide: string;
}

/** Capteur de la session : « SDK » par défaut, « Extension » pour l'extension navigateur (CP16). */
function capteur(v: string | null): string {
  if (v === "extension") return "Extension";
  if (!v || v === "sdk") return "SDK";
  return v;
}

function Pays({ pays, source }: { pays: string | null; source: string | null | undefined }) {
  if (!pays) return <span className="text-ink-faint">Inconnu</span>;
  return (
    <span title={`Pays estimé · ${geoSourceLabel(source)}`}>
      {pays}
      <span className="sr-only"> — pays estimé, provenance : {geoSourceLabel(source)}</span>
    </span>
  );
}

/** Une valeur non lue : « — » et sa raison, jamais un zéro (V3). */
function NonLu({ raison }: { raison: string }) {
  return (
    <span data-testid="signal-non-lu" title={raison} className="text-ink-faint">
      —
    </span>
  );
}

function Frustration({ n }: { n: number | null }) {
  return n === null ? <NonLu raison={SIGNAUX_A_CREER} /> : <>{formater("count", n)}</>;
}

function Rejeu({ present, href }: { present: boolean | null; href: string | undefined }) {
  if (present === null) return <NonLu raison={SIGNAUX_A_CREER} />;
  if (present === false) return <span className="text-ink-faint">Non</span>;
  return href ? (
    <Link href={href} className="text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
      ▶ Rejeu
    </Link>
  ) : (
    <span>Oui</span>
  );
}

function Parcours({ routes, hrefs }: { routes: string[] | null; hrefs: Record<string, string> }) {
  const p = parcoursResume(routes);
  if (!p) return <span className="text-ink-faint">—</span>;
  // `truncate` ne coupe qu'un élément `block` : le lien l'est, sans quoi une route
  // longue élargirait la carte à 390 px au lieu d'être rognée.
  const COUPE = "block max-w-[11rem] truncate";
  const lien = (route: string) =>
    hrefs[route] ? (
      <Link
        href={hrefs[route]}
        title={route}
        aria-label={`Route ${route} — ouvrir les mesures de cette route`}
        className={`chip-mono rounded ${COUPE} hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
      >
        {route}
      </Link>
    ) : (
      <span title={route} className={`chip-mono ${COUPE}`}>
        {route}
      </span>
    );
  return (
    <span className="flex max-w-[16rem] min-w-0 flex-wrap items-center gap-1 font-mono">
      {lien(p.premiere)}
      {p.reste > 0 && <span className="text-ink-faint">+{p.reste}</span>}
      {p.derniere && (
        <>
          <span className="text-accent/70">→</span>
          {lien(p.derniere)}
        </>
      )}
    </span>
  );
}

function LienSession({
  s,
  panelHrefs,
  pageHrefs,
  ouvert,
}: {
  s: LigneSessions;
  panelHrefs: Record<string, string>;
  pageHrefs: Record<string, string>;
  ouvert: boolean;
}) {
  const panneau = panelHrefs[s.session_id];
  // Le panneau (F43) s'ouvre SANS remonter en haut de l'écran : la liste reste où
  // elle était, et « Fermer » y ramène. Sans href de panneau, la ligne mène à la
  // page de session plutôt qu'à une URL qui n'ouvrirait rien.
  return (
    <Link
      href={panneau ?? pageHrefs[s.session_id] ?? "#"}
      scroll={panneau ? false : undefined}
      aria-current={ouvert ? "true" : undefined}
      data-testid="session-link"
      className="rounded font-mono text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
    >
      {s.session_id.slice(0, 8)}…
    </Link>
  );
}

function Rangee(props: SessionsTableProps & { s: LigneSessions }) {
  const { s, panelHrefs, pageHrefs, routeHrefs = {}, rejeuHrefs = {}, ouvert = null } = props;
  const navigateur = navigateurDeSession(s);
  const estOuverte = ouvert !== null && ouvert === s.session_id;
  return (
    <tr
      className={`border-t border-line/60 ${estOuverte ? "bg-accent/5" : ""}`}
      data-testid="ligne-session"
      data-ouvert={estOuverte ? "1" : undefined}
    >
      <th scope="row" className="px-3 py-2 text-left align-top font-normal">
        <LienSession s={s} panelHrefs={panelHrefs} pageHrefs={pageHrefs} ouvert={estOuverte} />
      </th>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>{instantUtc(s.last_seen_at)}</td>
      <td className={`${TD} whitespace-nowrap tabular-nums text-ink-soft`}>{instantUtc(s.started_at)}</td>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>{formater("s-auto", dureeObservee(s))}</td>
      <td className={TD}>{valeurOuInconnu(s.device_type)}</td>
      <td className={TD} title={navigateur.deduit ? "Navigateur déduit de l'user-agent : la colonne collectée est absente" : undefined}>
        {navigateur.texte}
        {navigateur.deduit ? " *" : ""}
      </td>
      <td className={TD}>{valeurOuInconnu(s.os)}</td>
      <td className={TD}>
        <Pays pays={s.geo_country} source={s.geo_source} />
      </td>
      <td className={TD}>{capteur(s.collection_source)}</td>
      <td className={`${TD} tabular-nums`}>{formater("count", s.page_count)}</td>
      <td className={TD}>
        <Parcours routes={s.routes} hrefs={routeHrefs} />
      </td>
      <td className={`${TD} tabular-nums`}>{formater("count", s.err_count)}</td>
      <td className={`${TD} tabular-nums`}>
        <Frustration n={s.frustration} />
      </td>
      <td className={TD}>
        <Rejeu present={s.rejeu} href={rejeuHrefs[s.session_id]} />
      </td>
    </tr>
  );
}

/** Carte compacte (390 px) : trois lignes par session, les mêmes valeurs que la table. */
function Carte(props: SessionsTableProps & { s: LigneSessions }) {
  const { s, panelHrefs, pageHrefs, routeHrefs = {}, rejeuHrefs = {}, ouvert = null } = props;
  const navigateur = navigateurDeSession(s);
  const estOuverte = ouvert !== null && ouvert === s.session_id;
  return (
    <li
      className="min-w-0 border-t border-line/60 py-2.5 first:border-0 first:pt-0"
      data-testid="carte-session"
      data-ouvert={estOuverte ? "1" : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <LienSession s={s} panelHrefs={panelHrefs} pageHrefs={pageHrefs} ouvert={estOuverte} />
        <span className="text-xs tabular-nums text-ink-faint">
          {instantUtc(s.last_seen_at)} UTC · {formater("s-auto", dureeObservee(s))}
        </span>
        <span className="ml-auto text-xs text-ink-soft">{capteur(s.collection_source)}</span>
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
        <span>{valeurOuInconnu(s.device_type)}</span>
        <span>·</span>
        <span>{navigateur.texte}</span>
        <span>·</span>
        <span>{valeurOuInconnu(s.os)}</span>
        <span>·</span>
        <Pays pays={s.geo_country} source={s.geo_source} />
        <span>·</span>
        <span className="tabular-nums">{formater("count", s.page_count)} page(s)</span>
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Parcours routes={s.routes} hrefs={routeHrefs} />
        <span className="tabular-nums text-ink-soft">
          {formater("count", s.err_count)} occurrence(s) d&apos;erreur
        </span>
        <span className="tabular-nums text-ink-soft">
          Frustration : <Frustration n={s.frustration} />
        </span>
        <span className="text-ink-soft">
          Rejeu : <Rejeu present={s.rejeu} href={rejeuHrefs[s.session_id]} />
        </span>
      </div>
    </li>
  );
}

const COLONNES = [
  "Session",
  "Dernière activité (UTC)",
  "Début (UTC)",
  "Durée observée",
  "Appareil",
  "Navigateur",
  "Système",
  "Pays estimé",
  "Capteur",
  "Pages vues",
  "Parcours",
  "Occurrences d'erreur",
  "Frustration",
  "Rejeu",
];

export function SessionsTable(props: SessionsTableProps) {
  const { lignes, suivantHref, debutHref = null, vide } = props;
  const deduits = lignes.some((s) => navigateurDeSession(s).deduit);
  if (lignes.length === 0) {
    return (
      <p className="py-8 text-center text-ink-faint" data-testid="sessions-vide">
        {vide}
      </p>
    );
  }
  return (
    <div className="min-w-0">
      {/* Table à partir de `sm` ; le conteneur défilant porte `relative` — un
          `sr-only` (position absolue) sans ancêtre positionné se placerait par
          rapport à la PAGE et l'élargirait (vécu en vague 5). */}
      <div className="relative hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm" data-testid="sessions-table">
          <thead className="bg-panel2">
            <tr>
              {COLONNES.map((c) => (
                <th key={c} scope="col" className={TH}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((s) => (
              <Rangee key={`${s.app_id}:${s.session_id}`} {...props} s={s} />
            ))}
          </tbody>
        </table>
      </div>

      {/* 390 px : cartes de trois lignes, pas de table défilante à treize colonnes. */}
      <ul className="min-w-0 sm:hidden" data-testid="sessions-cartes">
        {lignes.map((s) => (
          <Carte key={`${s.app_id}:${s.session_id}`} {...props} s={s} />
        ))}
      </ul>

      {deduits && (
        <p className="mt-2 text-xs text-ink-faint" data-testid="note-navigateur-deduit">
          « * » : navigateur déduit de l&apos;user-agent, la colonne collectée étant absente sur ces sessions — il ne
          vient pas de la même source que le découpage « Qui sont ces sessions ».
        </p>
      )}

      <nav className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination des sessions">
        <span className="min-w-0 text-xs text-ink-faint">
          {formater("count", lignes.length)} session(s) affichée(s) · pagination par clé stable (dernière activité,
          identifiant) : aucune ligne n&apos;est répétée ni sautée entre deux pages.
        </span>
        <span className="flex gap-4">
          {debutHref && (
            <Link href={debutHref} className="text-brand hover:underline">
              Retour au début
            </Link>
          )}
          {suivantHref && (
            <Link href={suivantHref} data-testid="sessions-suivantes" className="text-brand hover:underline">
              Sessions suivantes
            </Link>
          )}
        </span>
      </nav>
    </div>
  );
}
