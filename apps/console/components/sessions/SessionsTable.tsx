// « Toutes les sessions » (F42, plan § 5.11.4, Z6) — table dense, rendu serveur.
//
// UNE SESSION = UNE LIGNE DE 32 PX (refonte du 30/09/2026, charte § 3.5). Ce que la
// ligne écrivait en toutes lettres (« desktop · Chrome · Windows », « FR ») devient
// des pictogrammes : appareil, logo du navigateur et du système, drapeau du pays.
// Les nombres sont alignés à droite en chiffres tabulaires ; erreurs et signaux de
// frustration non nuls sont des PASTILLES teintées, un zéro reste pâle. Le nom
// complet de chaque pictogramme reste lu (`sr-only`) et survolable (`title`) : une
// image ne porte jamais seule une valeur. À 390 px, une carte de deux lignes.
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
// DIX COLONNES (même recette : 1 704 px dans une carte de 1 086 px, Parcours,
// Erreurs, Frustration et Rejeu hors champ). « Capteur » (toujours « SDK ») est une
// pastille à côté de l'identifiant, seulement quand il n'est pas le SDK web ;
// « Début » se lit de la dernière activité et de la durée ; appareil, navigateur et
// système tiennent dans une colonne de trois pictogrammes. Les en-têtes sont courts
// à l'écran, complets pour les lecteurs d'écran.
//
// AUCUNE FONCTION EN PROP : tous les liens sont calculés par la page et passés en
// dictionnaires indexés par identifiant (ou par route).
import Link from "next/link";
import { TableDefilante } from "@/components/TableDefilante";
import { PictoAppareil, PictoCapteur, PictoNavigateur, PictoPays, PictoSysteme } from "@/components/sessions/Pictos";
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

/** En-tête de colonne : 11 px, capitales grises (charte § 3.5). */
const TH = "whitespace-nowrap px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft";
/** Cellule d'une ligne de 32 px : une seule ligne de texte, centrée verticalement. */
const TD = "whitespace-nowrap px-2 py-1 align-middle text-xs";
const NOMBRE = `${TD} text-right tabular-nums`;

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
 * Colonnes, dans l'ordre de la recette du 26/09/2026 : erreurs, rejeu et frustration
 * juste après la durée. `court` s'affiche, `complet` est lu et survolé.
 */
export const COLONNES_SESSIONS: { court: string; complet: string; nombre?: boolean }[] = [
  { court: "Session", complet: "Session" },
  { court: "Dernière activité", complet: "Dernière activité" },
  { court: "Durée", complet: "Durée observée", nombre: true },
  { court: "Erreurs", complet: "Occurrences d'erreur", nombre: true },
  { court: "Rejeu", complet: "Rejeu" },
  { court: "Frustr.", complet: "Frustration", nombre: true },
  { court: "Terminal", complet: "Appareil · navigateur · système" },
  { court: "Pays", complet: "Pays estimé" },
  { court: "Pages", complet: "Pages vues", nombre: true },
  { court: "Parcours", complet: "Parcours" },
];

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
    <span
      className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-line bg-panel2 px-1.5 text-[10px] font-medium leading-4 text-ink-soft"
      data-testid="capteur-session"
      title={`Capteur : ${nom}`}
    >
      <PictoCapteur source={nom === "Mobile" ? "mobile" : s.collection_source} />
      {nom}
    </span>
  );
}

/** Drapeau et code du pays estimé ; la provenance de l'estimation est survolée et lue. */
function Pays({ pays, source }: { pays: string | null; source: string | null | undefined }) {
  if (!pays) {
    return (
      <span className="inline-flex items-center gap-1 text-ink-faint" title="Pays inconnu">
        <PictoPays code={null} />
        <span className="sr-only">Inconnu</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" title={`Pays estimé : ${pays} · ${geoSourceLabel(source)}`}>
      <PictoPays code={pays} />
      <span className="text-[11px] text-ink-soft">{pays}</span>
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

/**
 * Un compte en pastille : teinté quand il est non nul (erreur : rouge, frustration :
 * ambre), pâle à zéro. La teinte double le nombre, elle ne le remplace pas.
 */
function Pastille({ n, ton }: { n: number; ton: "bad" | "warn" }) {
  if (n === 0) return <span className="text-ink-faint">0</span>;
  const classe = ton === "bad" ? "bg-bad/10 text-bad-ink" : "bg-warn/15 text-warn-ink";
  return <span className={`inline-block min-w-[1.5rem] rounded px-1 text-center font-semibold ${classe}`}>{formater("count", n)}</span>;
}

function Frustration({ s }: { s: LigneSessions }) {
  if (s.frustration !== null) return <Pastille n={s.frustration} ton="warn" />;
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
    <Link
      href={href}
      className="inline-flex items-center rounded bg-accent/10 px-1.5 text-[11px] font-medium leading-5 text-accent-ink hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
    >
      ▶ Rejeu
    </Link>
  ) : (
    <span>Oui</span>
  );
}

/** Appareil, navigateur et système : trois pictogrammes, les noms lus et survolés. */
function Terminal({ s }: { s: LigneSessions }) {
  const navigateur = navigateurDeSession(s);
  const texte = `${valeurOuInconnu(s.device_type)} · ${navigateur.texte}${navigateur.deduit ? " *" : ""} · ${valeurOuInconnu(s.os)}`;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={navigateur.deduit ? `${texte} — navigateur déduit de l'user-agent : la colonne collectée est absente` : texte}
    >
      <PictoAppareil classe={s.device_type} />
      {/* Une application native n'a pas de navigateur : aucun logo plutôt qu'un « ? »
          qui se lirait « navigateur inconnu ». */}
      {!sessionMobile(s) && <PictoNavigateur nom={navigateur.texte} />}
      <PictoSysteme nom={s.os} />
      {navigateur.deduit && (
        <span aria-hidden="true" className="-ml-1 text-[10px] text-ink-faint">
          *
        </span>
      )}
      <span className="sr-only">{texte}</span>
    </span>
  );
}

function Parcours({ routes, hrefs }: { routes: string[] | null; hrefs: Record<string, string> }) {
  const p = parcoursResume(routes);
  if (!p) return <span className="text-ink-faint">—</span>;
  // `truncate` ne coupe qu'un élément `block` : le lien l'est, sans quoi une route
  // longue élargirait la ligne au lieu d'être rognée.
  const COUPE = "block max-w-[9rem] truncate";
  const lien = (route: string) =>
    hrefs[route] ? (
      <Link
        href={hrefs[route]}
        title={route}
        aria-label={`Route ${route} — ouvrir les mesures de cette route`}
        className={`rounded ${COUPE} text-ink hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
      >
        {route}
      </Link>
    ) : (
      <span title={route} className={COUPE}>
        {route}
      </span>
    );
  return (
    <span className="flex max-w-[20rem] min-w-0 items-center gap-1 font-mono text-[11px]">
      {lien(p.premiere)}
      {p.derniere && (
        <>
          <span aria-hidden="true" className="text-ink-faint">
            →
          </span>
          {lien(p.derniere)}
        </>
      )}
      {p.reste > 0 && (
        <span className="shrink-0 text-ink-faint" title={`${pluriel(p.reste, "vue intermédiaire", "vues intermédiaires")}`}>
          +{p.reste}
        </span>
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
  const estOuverte = ouvert !== null && ouvert === s.session_id;
  return (
    <tr
      className={`h-8 border-t border-line/60 transition hover:bg-panel2/60 ${estOuverte ? "bg-accent/5" : ""}`}
      data-testid="ligne-session"
      data-ouvert={estOuverte ? "1" : undefined}
    >
      <th scope="row" className="whitespace-nowrap px-2 py-1 text-left align-middle font-normal">
        <LienSession s={s} panelHrefs={panelHrefs} pageHrefs={pageHrefs} ouvert={estOuverte} />
        <PastilleCapteur s={s} />
      </th>
      <td className={`${TD} tabular-nums text-ink-soft`}>{instantUtc(s.last_seen_at)}</td>
      <td className={NOMBRE}>{formater("s-auto", dureeObservee(s))}</td>
      <td className={NOMBRE} data-colonne="erreurs">
        <Pastille n={s.err_count} ton="bad" />
      </td>
      <td className={TD} data-colonne="rejeu">
        <Rejeu present={s.rejeu} href={rejeuHrefs[s.session_id]} />
      </td>
      <td className={NOMBRE} data-colonne="frustration">
        <Frustration s={s} />
      </td>
      <td className={TD}>
        <Terminal s={s} />
      </td>
      <td className={TD}>
        <Pays pays={s.geo_country} source={s.geo_source} />
      </td>
      <td className={NOMBRE}>{formater("count", s.page_count)}</td>
      <td className={`${TD} w-full max-w-0`}>
        <Parcours routes={s.routes} hrefs={routeHrefs} />
      </td>
    </tr>
  );
}

/** Carte compacte (390 px) : deux lignes par session, les mêmes valeurs que la table. */
function Carte(props: SessionsTableProps & { s: LigneSessions }) {
  const { s, panelHrefs, pageHrefs, routeHrefs = {}, rejeuHrefs = {}, ouvert = null } = props;
  const estOuverte = ouvert !== null && ouvert === s.session_id;
  return (
    <li
      className={`min-w-0 border-t border-line/60 px-1 py-2 first:border-0 ${estOuverte ? "bg-accent/5" : ""}`}
      data-testid="carte-session"
      data-ouvert={estOuverte ? "1" : undefined}
    >
      <div className="flex min-w-0 items-center gap-x-2">
        <LienSession s={s} panelHrefs={panelHrefs} pageHrefs={pageHrefs} ouvert={estOuverte} />
        <span className="truncate text-[11px] tabular-nums text-ink-faint">
          {instantUtc(s.last_seen_at)} · {formater("s-auto", dureeObservee(s))}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <PastilleCapteur s={s} />
          <Terminal s={s} />
          <Pays pays={s.geo_country} source={s.geo_source} />
        </span>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-x-2.5 text-xs text-ink-soft">
        <span className="shrink-0 tabular-nums" title="Pages vues">
          {pluriel(s.page_count, "page")}
        </span>
        <span className="shrink-0 tabular-nums">
          <span className="sr-only">Occurrences d&apos;erreur : </span>
          <span aria-hidden="true">Err. </span>
          <Pastille n={s.err_count} ton="bad" />
        </span>
        <span className="shrink-0 tabular-nums">
          Frustration : <Frustration s={s} />
        </span>
        <span className="shrink-0">
          Rejeu : <Rejeu present={s.rejeu} href={rejeuHrefs[s.session_id]} />
        </span>
        <span className="min-w-0 flex-1">
          <Parcours routes={s.routes} hrefs={routeHrefs} />
        </span>
      </div>
    </li>
  );
}

export function SessionsTable(props: SessionsTableProps) {
  const { lignes, suivantHref, debutHref = null, vide } = props;
  const deduits = lignes.some((s) => navigateurDeSession(s).deduit);
  if (lignes.length === 0) {
    return (
      <p className="py-3 text-center text-sm text-ink-faint" data-testid="sessions-vide">
        <span aria-hidden="true" className="mr-1.5">
          ⊘
        </span>
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
          <thead className="border-b border-line bg-panel2/60">
            <tr>
              {COLONNES_SESSIONS.map((c) => (
                <th key={c.complet} scope="col" className={`${TH} ${c.nombre ? "text-right" : ""}`} title={c.complet}>
                  {c.court === c.complet ? (
                    c.complet
                  ) : (
                    <>
                      <span aria-hidden="true">{c.court}</span>
                      <span className="sr-only">{c.complet}</span>
                    </>
                  )}
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

      {/* 390 px : cartes de deux lignes, pas de table défilante à dix colonnes. */}
      <ul className="min-w-0 sm:hidden" data-testid="sessions-cartes">
        {lignes.map((s) => (
          <Carte key={`${s.app_id}:${s.session_id}`} {...props} s={s} />
        ))}
      </ul>

      <nav className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs" aria-label="Pagination des sessions">
        <span className="min-w-0 text-ink-faint">
          {pluriel(lignes.length, "session", "sessions")} · de la plus récente à la plus ancienne
          {/* Le « * » d'un navigateur déduit : une vérité de source, dite une fois, en pied. */}
          {deduits && (
            <span data-testid="note-navigateur-deduit" title="La colonne collectée est absente sur ces sessions : le navigateur ne vient pas de la même source que le découpage « Qui sont ces sessions ».">
              {" "}
              · * navigateur déduit de l&apos;user-agent
            </span>
          )}
        </span>
        <span className="flex gap-4">
          {debutHref && (
            <Link href={debutHref} className="text-brand hover:underline">
              Retour au début
            </Link>
          )}
          {suivantHref && (
            <Link href={suivantHref} data-testid="sessions-suivantes" className="font-medium text-brand hover:underline">
              Sessions suivantes →
            </Link>
          )}
        </span>
      </nav>
    </div>
  );
}
