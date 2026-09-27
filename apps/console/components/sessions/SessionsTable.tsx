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
// FRUSTRATION ET REJEU : lus pour les lignes de la page (recette du 26/09/2026).
// Une lecture en échec rend « — » avec sa raison en infobulle ; une session mobile,
// dont le capteur n'émet aucun signal de frustration, « non collecté ». Jamais « 0 »,
// qui affirmerait une absence de signal qu'aucune lecture n'a établie (V3).
//
// DIX COLONNES, PLUS QUATORZE (même recette : 1 704 px dans une carte de 1 086 px,
// Parcours, Erreurs, Frustration et Rejeu hors champ). « Capteur » (toujours « SDK »)
// devient une pastille à côté de l'identifiant, seulement quand il n'est pas le SDK
// web ; « Début » se lit de la dernière activité et de la durée ; appareil,
// navigateur et système tiennent dans une colonne ; erreurs, rejeu et frustration
// remontent juste après la durée.
//
// AUCUNE FONCTION EN PROP : tous les liens sont calculés par la page et passés en
// dictionnaires indexés par identifiant (ou par route).
import Link from "next/link";
import { TableDefilante } from "@/components/TableDefilante";
import { formater } from "@/lib/fmt-ids";
import { geoSourceLabel } from "@/lib/geo";
import { pluriel } from "@/lib/format";
import {
  FRUSTRATION_NON_COLLECTEE,
  SIGNAL_NON_LU,
  dureeObservee,
  instantUtc,
  navigateurDeSession,
  parcoursResume,
  sessionMobile,
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

/**
 * Capteur de la session, nommé seulement quand il n'est pas le SDK web (le cas de
 * presque toutes les lignes) : « Extension » (CP16), « Mobile », ou la valeur telle
 * quelle. `null` : rien à signaler.
 */
function capteur(s: Pick<LigneSessions, "collection_source" | "runtime">): string | null {
  if (sessionMobile(s)) return "Mobile";
  const v = s.collection_source;
  if (v === "extension") return "Extension";
  if (!v || v === "sdk") return null;
  return v;
}

function PastilleCapteur({ s }: { s: LigneSessions }) {
  const nom = capteur(s);
  if (!nom) return null;
  return (
    <span className="ml-1.5 rounded-full border border-line bg-panel2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft" data-testid="capteur-session">
      {nom}
    </span>
  );
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

function Frustration({ s }: { s: LigneSessions }) {
  if (s.frustration !== null) return <>{formater("count", s.frustration)}</>;
  // Une session mobile : non collecté, dit en toutes lettres (et pas « — », qui se
  // lirait comme une lecture manquée).
  if (sessionMobile(s)) {
    return (
      <span data-testid="signal-non-collecte" title={FRUSTRATION_NON_COLLECTEE} className="text-ink-faint">
        non collecté
      </span>
    );
  }
  return <NonLu raison={SIGNAL_NON_LU} />;
}

function Rejeu({ present, href }: { present: boolean | null; href: string | undefined }) {
  if (present === null) return <NonLu raison={SIGNAL_NON_LU} />;
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
      <th scope="row" className="whitespace-nowrap px-3 py-2 text-left align-top font-normal">
        <LienSession s={s} panelHrefs={panelHrefs} pageHrefs={pageHrefs} ouvert={estOuverte} />
        <PastilleCapteur s={s} />
      </th>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>{instantUtc(s.last_seen_at)}</td>
      <td className={`${TD} whitespace-nowrap tabular-nums`}>{formater("s-auto", dureeObservee(s))}</td>
      <td className={`${TD} tabular-nums`} data-colonne="erreurs">
        {formater("count", s.err_count)}
      </td>
      <td className={`${TD} whitespace-nowrap`} data-colonne="rejeu">
        <Rejeu present={s.rejeu} href={rejeuHrefs[s.session_id]} />
      </td>
      <td className={`${TD} tabular-nums`} data-colonne="frustration">
        <Frustration s={s} />
      </td>
      <td
        className={TD}
        title={navigateur.deduit ? "Navigateur déduit de l'user-agent : la colonne collectée est absente" : undefined}
      >
        {valeurOuInconnu(s.device_type)} · {navigateur.texte}
        {navigateur.deduit ? " *" : ""} · {valeurOuInconnu(s.os)}
      </td>
      <td className={TD}>
        <Pays pays={s.geo_country} source={s.geo_source} />
      </td>
      <td className={`${TD} tabular-nums`}>{formater("count", s.page_count)}</td>
      <td className={TD}>
        <Parcours routes={s.routes} hrefs={routeHrefs} />
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
          {instantUtc(s.last_seen_at)} · {formater("s-auto", dureeObservee(s))}
        </span>
        <span className="ml-auto">
          <PastilleCapteur s={s} />
        </span>
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
        <span className="tabular-nums">{pluriel(s.page_count, "page")}</span>
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Parcours routes={s.routes} hrefs={routeHrefs} />
        <span className="tabular-nums text-ink-soft">
          {pluriel(s.err_count, "occurrence")} d&apos;erreur
        </span>
        <span className="tabular-nums text-ink-soft">
          Frustration : <Frustration s={s} />
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
  "Dernière activité",
  "Durée observée",
  "Occurrences d'erreur",
  "Rejeu",
  "Frustration",
  "Appareil · navigateur · système",
  "Pays estimé",
  "Pages vues",
  "Parcours",
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
      {/* Table à partir de `sm`, dans une zone défilante SIGNALÉE (recette 26/09 :
          à 1 440 px, Parcours, Erreurs, Frustration et Rejeu étaient hors champ sans
          barre visible). La zone porte `relative` — un `sr-only` (position absolue)
          sans ancêtre positionné se placerait par rapport à la PAGE et l'élargirait
          (vécu en vague 5). */}
      <TableDefilante className="hidden sm:block" label="Sessions">
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
      </TableDefilante>

      {/* 390 px : cartes de trois lignes, pas de table défilante à dix colonnes. */}
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
          {pluriel(lignes.length, "session affichée", "sessions affichées")}, de la plus récemment active à la plus ancienne
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
