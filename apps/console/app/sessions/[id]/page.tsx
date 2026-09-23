// Détail de session (F44, plan § 5.12) : « Que s'est-il passé dans cette session,
// dans quel ordre, et qu'a vu le visiteur ? »
//
// Y1 en-tête (retour, titre, puces de contexte) · « En bref » (P*.9) · Y2 résumé en
// cinq tuiles · Y3 onglets COMPTÉS (Déroulé, Cascade, Erreurs, Appels API, Web
// Vitals, Attributs) · Y4 contenu de l'onglet.
//
// COMPATIBILITÉ. `?tab=replay` et `?tab=timeline` (liens existants, dont
// components/errors/error-view.ts) ouvrent le Déroulé, qui porte le rejeu ET la
// chronologie ; `at` reste lu et positionne le lecteur.
//
// F46 — la Cascade place la même chronologie sur un axe (`cascadeDeSession`) ;
// l'onglet Web Vitals SITUE la pire mesure de chaque vital dans la population de
// sa route, sur une fenêtre ANCRÉE SUR LA SESSION (`fenetreDeSession`, § 3.5) :
// une session ancienne n'est jamais comparée aux « 7 derniers jours ». Ces
// lectures ne partent que sur l'onglet Web Vitals.
//
// F45 — le Déroulé est GROUPÉ PAR VUE (`Deroule`, `lib/deroule.ts`), filtrable
// par `voir=` (§ 3.1). Les liens sortants de la chronologie sont PRÉ-CALCULÉS
// ici, jamais par le composant : seule la page connaît le périmètre d'app.
// Aujourd'hui, un seul est calculable — la route (`/pages?route=`). L'erreur
// groupée et la trace attendent B32 (`sessionTimeline` ne projette ni
// `fingerprint` ni `trace_id`) : la page le DIT, plutôt que de rendre un lien
// mort ou de taire l'absence.
//
// IDENTITÉ. Rien de `select *` n'est passé à un composant client : seules les
// valeurs choisies sont rendues (S5). `user_id_hash`, `account_id_hash` et
// `user_hash` n'apparaissent nulle part ; le visiteur est tronqué à 8 caractères.
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import ReplayPlayer from "@/components/replay/ReplayPlayer";
import { KpiTile } from "@/components/charts/KpiTile";
import { RecitSession } from "@/components/sessions/RecitSession";
import { TabLink } from "@/components/sessions/TabLink";
import { EtatSurface } from "@/components/states/EtatSurface";
import { SectionErreur } from "@/components/states/SectionErreur";
import { Deroule } from "@/components/sessions/Deroule";
import { Cascade, texteDuree } from "@/components/charts/Cascade";
import { DistributionSeuils, alternativeDistribution, bacsDeHistogramme } from "@/components/charts/DistributionSeuils";
import { Figure } from "@/components/charts/Figure";
import {
  LIBELLES_NATURES,
  PARTIEL_CASCADE,
  PISTES_SESSION,
  cascadeDeSession,
  fenetreDeSession,
  jourMoisUtc,
  libelleFenetre,
  vitauxDeSession,
  type PireMesure,
  type VitauxSession,
} from "@/lib/deroule";
import { NATURES_CHRONOLOGIE, ligneIgnoree, lireVoir, type NatureChronologie } from "@/lib/view-state";
import { HISTO_BUCKETS } from "@/lib/distribution";
import { filtersOfQuery } from "@/lib/filters";
import { formatDuVital, formater, type VitalName } from "@/lib/fmt-ids";
import { fmtDate } from "@/lib/format";
import { lire, type Lecture } from "@/lib/lecture";
import { plafondAffichage } from "@/lib/perf-domain";
import {
  sessionMeta,
  sessionTimeline,
  vitalHistogram,
  vitalPercentiles,
  type HistoRow,
  type TimelineItem,
  type VitalPercentiles,
} from "@/lib/queries";
import { retentionDays } from "@/lib/queries-explorer";
import { UnsupportedFilterError } from "@/lib/query-compiler";
import { authorizedAppsOf, paramReader, parseAnalyticsQuery, type ScopePrincipal } from "@/lib/query-contract";
import { RATING_LABEL, rating2026 } from "@/lib/rating";
import { LIMITE_CHRONOLOGIE, ancreEvenement, composerRecit } from "@/lib/recit-session";
import { sessionARejeu } from "@/lib/session-rejeu";
import {
  LECTURE_FRUSTRATION,
  LIBELLES_ONGLETS,
  ONGLETS_SESSION,
  RAISON_FRUSTRATION_MOBILE,
  RAISON_TRONQUEE,
  RUNTIME_MOBILE,
  attributsDeSession,
  dureeObservee,
  encoreActive,
  estWebVital,
  lireInstant,
  lireOnglet,
  occurrencesLisibles,
  pucesDeSession,
  resumeDeSession,
  routeEnCours,
  statutAppel,
  type OngletSession,
  type PuceContexte,
  type ResumeSession,
} from "@/lib/session-detail";

export const dynamic = "force-dynamic";

/** Paramètre répété : la première valeur, comme la porte projet du middleware. */
function premier(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Décalage d'un événement depuis le début de la session : « 12,3 s », « 6 min 12 s ». */
function decalage(ts: Date, t0: number): string {
  return `+${formater("s-auto", Math.max(0, new Date(ts).getTime() - t0))}`;
}

const TABLE = "w-full min-w-[36rem] text-left text-sm";
const TH = "px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft";
const TD = "border-t border-line/60 px-2 py-1.5 align-top";

export default async function SessionDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const meta = await sessionMeta(id);
  if (!meta) notFound();

  // scoping viewer : une session d'une app hors périmètre est invisible (404) ;
  // une liste d'apps vide n'ouvre aucune session.
  const { getUser } = await import("@/lib/auth");
  const utilisateur = await getUser();
  const authorized = authorizedAppsOf(utilisateur);
  if (authorized !== null && !authorized.includes(meta.app_id)) notFound();
  // Un lien qui annonce son app (erreur, trace — P5.1) ne doit jamais ouvrir la
  // session d'une autre : l'identifiant de session est émis par le client, et une
  // erreur forgée peut citer celui d'un autre tenant.
  const app = premier(sp.app);
  if (app && app !== "all" && app !== meta.app_id) notFound();

  // Chronologie lue APRÈS la garde de périmètre, et bornée à l'app de la
  // session : une ligne d'une autre app au même session_id n'y entre pas.
  const timeline = await sessionTimeline(meta.session_id, meta.app_id);
  const nowMs = Date.now();

  // `tab=replay` / `tab=timeline` → Déroulé ; `at` (epoch ms, entier) positionne le
  // rejeu, jamais deviné.
  const { onglet, ignore } = lireOnglet(premier(sp.tab));
  const at = lireInstant(premier(sp.at));

  // `voir=` (F06, § 3.1) : natures de la chronologie. Une valeur illisible est
  // IGNORÉE et signalée — elle ne touche aucun chiffre, donc jamais un refus.
  // Toutes les natures = défaut, donc `null` : la barre de filtres montre « Tout ».
  const voirBrut = premier(sp.voir) ?? null;
  const voirLu = voirBrut === null ? null : lireVoir(voirBrut);
  const ignoreVoir =
    voirBrut !== null && voirLu === null
      ? ligneIgnoree("voir", voirBrut, `natures : ${NATURES_CHRONOLOGIE.join(", ")}`)
      : null;
  const voir = voirLu && voirLu.length < NATURES_CHRONOLOGIE.length ? voirLu : null;

  // Filtres globaux conservés dans les liens ; onglet, instant et filtre de
  // chronologie exclus (propres au détail, et `voir` propre au seul Déroulé).
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => {
      const valeur = premier(v);
      return typeof valeur === "string" && k !== "tab" && k !== "at" && k !== "voir"
        ? [[k, valeur] as [string, string]]
        : [];
    }),
  ).toString();
  const chemin = `/sessions/${encodeURIComponent(meta.session_id)}`;
  const hrefOnglet = (
    o: OngletSession,
    extra: { at?: number | null; ancre?: string; voir?: readonly NatureChronologie[] | null } = {},
  ) => {
    const p = new URLSearchParams(qs);
    if (o !== "deroule") p.set("tab", o);
    if (extra.at != null) p.set("at", String(extra.at));
    if (extra.voir?.length) p.set("voir", extra.voir.join(","));
    const s = p.toString();
    return `${chemin}${s ? `?${s}` : ""}${extra.ancre ? `#${extra.ancre}` : ""}`;
  };
  /** Une page vue mène à la même page pour TOUS les visiteurs — app liée (V7). */
  const lienRoute = (route: string) =>
    `/pages?${new URLSearchParams({ app: meta.app_id, route }).toString()}`;
  const lienRelease = (release: string) => {
    const p = new URLSearchParams({ app: meta.app_id, release });
    return `/errors?${p.toString()}`;
  };

  const t0 = new Date(meta.started_at).getTime();
  const resume = resumeDeSession(timeline, meta.runtime);
  // P*.9 — récit composé des lignes déjà lues ; seule la présence du rejeu est lue,
  // pour pouvoir dire son absence. Une lecture en échec n'efface pas le récit.
  const rejeuLu = await lire(() => sessionARejeu(meta.session_id, meta.app_id));
  // Le lecteur n'est monté que s'il y a (peut-être) quelque chose à lire : une
  // existence lue « absente » laisse toute la largeur à la chronologie.
  const avecRejeu = !rejeuLu.ok || rejeuLu.data;
  const recit = composerRecit({ timeline, debut: meta.started_at, fin: meta.last_seen_at, nowMs });
  const puces = pucesDeSession(meta, lienRelease);

  // Liens sortants de la chronologie, PRÉ-CALCULÉS par rang de ligne. Seule la
  // route est calculable sans B32 ; l'erreur groupée (`fingerprint`) et la trace
  // (`trace_id`) ne sont pas projetées par `sessionTimeline`, donc leurs lignes
  // n'ont pas de lien — et la section le dit, plutôt que de rendre un lien mort.
  const liensChronologie: Record<number, string> = {};
  timeline.forEach((it, i) => {
    if (it.kind === "pageview" && it.title) liensChronologie[i] = lienRoute(it.title);
  });
  const liensSortantsManquants = timeline.some((it) => it.kind === "error" || it.kind === "api");

  const comptes: Record<OngletSession, number | null | undefined> = {
    deroule: undefined,
    cascade: undefined,
    erreurs: resume.erreursLignes,
    api: resume.apiLignes,
    vitals: resume.vitaux,
    attributs: undefined,
  };

  // F46 — Web Vitals situés, lus SEULEMENT sur leur onglet. La population est
  // lue avec le principal de la page : elle ne sort jamais de son périmètre.
  const vitaux = onglet === "vitals" ? vitauxDeSession(timeline) : null;
  const situations =
    vitaux && vitaux.pires.length > 0
      ? await situerPires(vitaux.pires, { app: meta.app_id, principal: utilisateur, debutMs: t0, nowMs })
      : new Map<VitalName, Situation>();

  return (
    <div className="animate-fade-up">
      <Link
        href={`/sessions${qs ? `?${qs}` : ""}`}
        className="rounded text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
      >
        ← Sessions
      </Link>
      <div className="mt-2">
        <PageHeader
          title={
            <>
              Session <span className="font-mono text-lg text-ink-soft">{meta.session_id.slice(0, 8)}…</span>
            </>
          }
          sub="Que s'est-il passé dans cette session, dans quel ordre, et qu'a vu le visiteur ?"
        />
      </div>

      {/* Y1 — puces de contexte : une ligne à 1440 px, repliées « Contexte (N) » à 390 px. */}
      <PucesSession puces={puces} />

      <SectionErreur titre="En bref">
        <RecitSession
          phrases={recit.ok ? recit.phrases : []}
          rejeu={rejeuLu.ok ? (rejeuLu.data ? "present" : "absent") : null}
          // Hors du Déroulé, la chronologie n'est pas sur la page : les ancres y ramènent.
          lienBase={onglet === "deroule" ? "" : hrefOnglet("deroule")}
        />
      </SectionErreur>

      {/* Y2 — résumé chiffré. */}
      <Resume
        resume={resume}
        dureeMs={dureeObservee(meta.started_at, meta.last_seen_at)}
        active={encoreActive(meta.last_seen_at, nowMs)}
        pages={meta.page_count}
        occurrencesParLigne={occurrencesLisibles(timeline)}
        mobile={meta.runtime === RUNTIME_MOBILE}
        hrefs={{
          // Chaque tuile ouvre le Déroulé filtré sur SA nature (§ 5.12.4).
          vues: hrefOnglet("deroule", { ancre: "chronologie", voir: ["vue"] }),
          frustration: hrefOnglet("deroule", { ancre: "chronologie", voir: ["frustration"] }),
          erreurs: hrefOnglet("erreurs"),
          api: hrefOnglet("api"),
        }}
      />

      {/* Y3 — onglets comptés ; un compte inconnu s'écrit « (—) », jamais « (0) ». */}
      {[ignore, ignoreVoir].filter(Boolean).map((ligne) => (
        <p key={ligne} role="note" className="mb-2 text-xs text-ink-soft" data-testid="reglage-ignore">
          {ligne}
        </p>
      ))}
      <nav aria-label="Onglets de la session" className="relative mb-4 flex overflow-x-auto border-b border-line" data-testid="session-tabs">
        {ONGLETS_SESSION.map((o) => (
          <TabLink key={o} href={hrefOnglet(o)} active={onglet === o} compte={comptes[o]}>
            {LIBELLES_ONGLETS[o]}
          </TabLink>
        ))}
      </nav>

      {/* Y4 — contenu de l'onglet. */}
      {onglet === "deroule" && (
        <div className={`grid gap-4 ${avecRejeu ? "xl:grid-cols-5" : ""}`} data-testid="deroule">
          {avecRejeu && (
            <div className="min-w-0 xl:col-span-3">
              <ReplayPlayer sessionId={meta.session_id} atMs={at} />
            </div>
          )}
          <section
            id="chronologie"
            aria-label="Chronologie de la session"
            // `relative` : conteneur défilant (xl) — un `sr-only` d'une ligne y reste borné (piège 16).
            className={`card relative min-w-0 scroll-mt-24 p-4 sm:p-6 ${avecRejeu ? "xl:col-span-2 xl:max-h-[48rem] xl:overflow-y-auto" : ""}`}
          >
            {!avecRejeu && (
              <p className="mb-4 text-xs text-ink-soft" data-testid="deroule-sans-rejeu">
                Aucun rejeu enregistré pour cette session : la chronologie seule.
              </p>
            )}
            <FiltresVoir voir={voir} href={(n) => hrefOnglet("deroule", { ancre: "chronologie", voir: n })} />
            {liensSortantsManquants && (
              <p role="note" className="mb-3 text-xs text-ink-soft" data-testid="liens-sortants-b32">
                Liens sortants non disponibles, raison : la chronologie ne porte encore ni l&apos;empreinte de l&apos;erreur
                ni l&apos;identifiant de trace. Les onglets Erreurs et Appels API listent les mêmes lignes.
              </p>
            )}
            <Deroule items={timeline} t0={t0} voir={voir} liens={liensChronologie} tronque={resume.tronquee} />
          </section>
        </div>
      )}

      {onglet === "erreurs" && (
        <OngletTable
          titre="Erreurs de la session"
          tronquee={resume.tronquee}
          vide={timeline.every((it) => it.kind !== "error") ? "Aucune erreur dans cette session" : null}
        >
          <table className={TABLE} data-testid="table-erreurs">
            <caption className="sr-only">Erreurs de la session, dans l&apos;ordre d&apos;arrivée</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Instant</th>
                <th scope="col" className={TH}>Type</th>
                <th scope="col" className={TH}>Message</th>
                <th scope="col" className={TH}>Vue en cours</th>
                <th scope="col" className={`${TH} text-right`}>Occurrences</th>
                <th scope="col" className={TH}>Action</th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Lien</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((it, i) =>
                it.kind !== "error" ? null : (
                  <tr key={i}>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs tabular-nums text-ink-soft`} title={fmtDate(it.ts)}>
                      {decalage(it.ts, t0)}
                    </td>
                    <td className={`${TD} font-medium text-bad-ink`}>{it.title ?? "—"}</td>
                    <td className={TD}>
                      <span className="block max-w-[28rem] truncate" title={it.detail ?? undefined}>
                        {it.detail ?? "—"}
                      </span>
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{routeEnCours(timeline, i) ?? "—"}</td>
                    <td className={`${TD} text-right tabular-nums`}>{it.value == null ? "—" : formater("count", Number(it.value))}</td>
                    <td className={TD}>{it.action_name ?? "—"}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Link
                        href={hrefOnglet("deroule", { at: new Date(it.ts).getTime(), ancre: ancreEvenement(i) })}
                        className="rounded text-xs text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                      >
                        {avecRejeu ? "Voir au rejeu" : "Voir dans le déroulé"}
                      </Link>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </OngletTable>
      )}

      {onglet === "api" && (
        <OngletTable
          titre="Appels API de la session"
          tronquee={resume.tronquee}
          vide={timeline.every((it) => it.kind !== "api") ? "Aucun appel API dans cette session" : null}
        >
          <table className={TABLE} data-testid="table-api">
            <caption className="sr-only">Appels API de la session, dans l&apos;ordre d&apos;émission</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Instant</th>
                <th scope="col" className={TH}>Appel</th>
                <th scope="col" className={TH}>Statut</th>
                <th scope="col" className={`${TH} text-right`}>Durée navigateur</th>
                <th scope="col" className={TH}>Temps serveur corrélé</th>
                <th scope="col" className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((it, i) => {
                if (it.kind !== "api") return null;
                const { statut, serveur } = statutAppel(it.detail);
                return (
                  <tr key={i}>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs tabular-nums text-ink-soft`} title={fmtDate(it.ts)}>
                      {decalage(it.ts, t0)}
                    </td>
                    <td className={`${TD} font-mono text-xs`}>
                      <span className="block max-w-[24rem] truncate" title={it.title ?? undefined}>
                        {it.title ?? "—"}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap ${it.rating === "poor" ? "font-medium text-bad-ink" : ""}`}>{statut}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formater("ms", it.value == null ? null : Number(it.value))}</td>
                    <td className={TD}>{serveur ?? "— (aucun span serveur corrélé)"}</td>
                    <td className={TD}>{it.action_name ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </OngletTable>
      )}

      {onglet === "cascade" && (
        <OngletCascade
          timeline={timeline}
          t0={t0}
          finMs={new Date(meta.last_seen_at).getTime()}
          liens={liensChronologie}
          tronquee={resume.tronquee}
        />
      )}

      {onglet === "vitals" && vitaux && (
        <OngletVitaux
          timeline={timeline}
          vitaux={vitaux}
          situations={situations}
          t0={t0}
          tronquee={resume.tronquee}
          // `is_bot` vient du `select *` sans être typé : une session de robot est
          // exclue de sa propre population (bots exclus par défaut du contrat).
          robot={(meta as typeof meta & { is_bot?: boolean | null }).is_bot === true}
          debutConservationMs={nowMs - retentionDays() * 86_400_000}
          lienDeroule={(rang) => hrefOnglet("deroule", { ancre: ancreEvenement(rang) })}
        />
      )}

      {onglet === "attributs" && (
        <details className="card p-4 sm:p-6" data-testid="attributs">
          <summary className="cursor-pointer rounded text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
            Attributs techniques ({attributsDeSession(meta).length})
          </summary>
          <p className="mt-2 text-xs text-ink-soft">
            Colonnes non identifiantes de la session. L&apos;identifiant de visiteur n&apos;y figure que tronqué (en-tête) ;
            les empreintes d&apos;identité ne sont jamais affichées.
          </p>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            {attributsDeSession(meta).map((a) => (
              <div key={a.cle} className="contents">
                <dt className="font-mono text-xs text-ink-soft">{a.cle}</dt>
                <dd className="min-w-0 break-all">{a.valeur}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

/**
 * Filtres `voir=` du Déroulé (§ 3.1). Des LIENS, pas des cases : l'état vit dans
 * l'URL, la page reste partageable et le filtre survit sans JavaScript. Chaque
 * lien sélectionne UNE nature ; « Tout » la retire. Le filtre ne change que ce
 * qu'on montre : les tuiles, les comptes d'onglets et le récit restent calculés
 * sur la chronologie entière (règle 1 du § 3.1).
 */
function FiltresVoir({
  voir,
  href,
}: {
  voir: NatureChronologie[] | null;
  href: (natures: readonly NatureChronologie[] | null) => string;
}) {
  const classe = (actif: boolean) =>
    `rounded-full border px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf ${
      actif ? "border-brand bg-brand/10 font-medium text-brand" : "border-line text-ink-soft hover:border-brand/50"
    }`;
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-center gap-1.5" data-testid="deroule-filtres">
      <span className="text-xs text-ink-faint">Voir :</span>
      <Link href={href(null)} aria-current={voir === null ? "true" : undefined} className={classe(voir === null)}>
        Tout
      </Link>
      {NATURES_CHRONOLOGIE.map((n) => {
        const actif = voir?.length === 1 && voir[0] === n;
        return (
          <Link key={n} href={href([n])} aria-current={actif ? "true" : undefined} className={classe(actif)}>
            {LIBELLES_NATURES[n]}
          </Link>
        );
      })}
    </div>
  );
}

/** Puces de contexte (§ 5.12.4) : même rendu que `DetailPanel.puces`, provenance écrite. */
function PucesSession({ puces }: { puces: PuceContexte[] }) {
  const liste = (classe: string) => (
    <dl className={classe}>
      {puces.map((p, i) => (
        <div key={`${p.label}-${i}`} className="flex min-w-0 max-w-full items-baseline gap-1 rounded-md bg-panel2 px-2 py-0.5 text-xs" data-puce={p.label}>
          <dt className="shrink-0 text-ink-soft">{p.label}</dt>
          <dd className="min-w-0 break-words font-medium text-ink">
            {p.href ? (
              <Link href={p.href} className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
                {p.valeur}
              </Link>
            ) : (
              p.valeur
            )}
            {p.provenance && <span className="font-normal text-ink-soft"> (provenance : {p.provenance})</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="mb-6">
      {/* Deux rendus des MÊMES puces : dépliées à partir de 640 px, repliées dessous. */}
      <div className="hidden sm:block" data-testid="puces-session">
        {liste("flex flex-wrap gap-1.5")}
      </div>
      <details className="sm:hidden" data-testid="puces-session-mobile">
        <summary className="cursor-pointer rounded text-sm font-medium text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
          Contexte ({puces.length})
        </summary>
        {liste("mt-2 flex flex-col items-start gap-1.5")}
      </details>
    </div>
  );
}

/** Y2 — cinq tuiles ; un compte qu'on ne peut pas établir vaut « — » et le dit. */
function Resume({
  resume,
  dureeMs,
  active,
  pages,
  occurrencesParLigne,
  mobile,
  hrefs,
}: {
  resume: ResumeSession;
  dureeMs: number;
  active: boolean;
  pages: number;
  occurrencesParLigne: boolean;
  mobile: boolean;
  hrefs: { vues: string; frustration: string; erreurs: string; api: string };
}) {
  // Avant v67, une ligne d'erreur ne porte pas ses occurrences : on compte des lignes, et on le dit.
  const erreursEnLignes = !resume.tronquee && !occurrencesParLigne;
  return (
    <section aria-label="Résumé de la session" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="resume-session">
      <KpiTile
        label="Durée observée"
        valeur={dureeMs}
        format="s-auto"
        lecture={`écart entre la première et la dernière observation, pas du temps actif${active ? " · encore active : elle peut encore augmenter" : ""}.`}
      />
      <KpiTile label="Pages vues" valeur={pages} format="count" href={hrefs.vues} />
      <KpiTile
        label={erreursEnLignes ? "Erreurs (lignes)" : "Occurrences d'erreur"}
        valeur={erreursEnLignes ? resume.erreursLignes : resume.occurrences}
        raisonNull={RAISON_TRONQUEE}
        format="count"
        lecture={erreursEnLignes ? "une ligne peut regrouper plusieurs répétitions." : undefined}
        href={hrefs.erreurs}
      />
      <KpiTile
        label="Signaux de frustration"
        valeur={resume.frustration}
        raisonNull={mobile ? RAISON_FRUSTRATION_MOBILE : RAISON_TRONQUEE}
        format="count"
        lecture={mobile ? undefined : LECTURE_FRUSTRATION}
        href={hrefs.frustration}
      />
      <KpiTile
        label="Appels API en échec"
        valeur={resume.apiEchecs}
        raisonNull={RAISON_TRONQUEE}
        format="count"
        lecture="statut 400 ou plus, ou réseau (statut 0)."
        href={hrefs.api}
      />
    </section>
  );
}

/** Enveloppe d'un onglet en table : état tronqué dit, vide dit, table défilante à 390 px (§ 3.9). */
function OngletTable({
  titre,
  tronquee,
  vide,
  children,
}: {
  titre: string;
  tronquee: boolean;
  vide: string | null;
  children: ReactNode;
}) {
  return (
    <section aria-label={titre} className="card min-w-0 p-4 sm:p-6">
      {tronquee && (
        <div className="mb-3">
          <EtatSurface compact etat={{ kind: "partiel", raison: `chronologie tronquée à ${LIMITE_CHRONOLOGIE} événements : la table n'en montre que le début` }} />
        </div>
      )}
      {/* `relative` OBLIGATOIRE : la légende et l'en-tête « Lien » sont `sr-only`
          (position absolue). Sans ancêtre positionné, ils se plaçaient par rapport à
          la PAGE, à leur position dans la table large, et l'élargissaient (575 px à
          390 px, e2e « aucun débordement »). */}
      {vide ? (
        <p className="py-8 text-center text-sm text-ink-soft">{vide}</p>
      ) : (
        <div className="relative overflow-x-auto">{children}</div>
      )}
    </section>
  );
}

// ═══════════════════════════ F46 — Cascade et Web Vitals situés ═══════════════════════════

/**
 * Cascade de la session (§ 5.12.4) : la chronologie sur un axe — l'ordre et la
 * durée se lisent d'un coup d'œil, ce que la colonne « +N ms » ne permet pas. Même
 * lecture que le déroulé (aucune requête de plus), mêmes liens que la chronologie.
 * La collecte de ressources est volontairement partielle : c'est dit EN TÊTE.
 */
function OngletCascade({
  timeline,
  t0,
  finMs,
  liens,
  tronquee,
}: {
  timeline: TimelineItem[];
  t0: number;
  /** `last_seen_at` : la dernière vue s'étend jusque-là, et le dit. */
  finMs: number;
  liens: Record<number, string>;
  tronquee: boolean;
}) {
  const titre = "Cascade de la session";
  const c = cascadeDeSession(timeline, { t0, finMs, liens, tronquee });
  const assez = c.elements.length >= 2;
  return (
    <SectionErreur titre={titre}>
      <Figure
        titre={titre}
        id="cascade-session"
        meta={
          <>
            <span>{formater("count", c.elements.length)} éléments</span>
            <span>axe de {texteDuree(c.totalMs)}, de l&apos;ouverture à la dernière observation</span>
          </>
        }
        etat={
          assez
            ? undefined
            : { kind: "vide", population: "cascade à dessiner", plage: "cette session : moins de deux éléments à placer sur l'axe" }
        }
        lecture={
          <>
            Une page vue est une barre jusqu&apos;à la vue suivante — la dernière, jusqu&apos;à la dernière observation :
            ce n&apos;est pas un temps de lecture. Actions et erreurs sont des instants ; un effet est rangé sous l&apos;action
            qui l&apos;a déclenché. Repères FCP et LCP : vues chargées seulement, à l&apos;ouverture de la vue plus leur
            valeur. Événements, signaux de frustration et phases réseau restent dans le Déroulé.
          </>
        }
      >
        {tronquee && (
          <div className="mb-3">
            <EtatSurface
              compact
              etat={{ kind: "partiel", raison: `chronologie tronquée à ${LIMITE_CHRONOLOGIE} événements : la cascade n'en montre que le début` }}
            />
          </div>
        )}
        {/* Défilement horizontal INTERNE sous 768 px (§ 5.12.3) : la cascade garde un
            axe lisible. `relative` : un `sr-only` de l'alternative y reste borné (piège 16). */}
        <div className="relative overflow-x-auto" data-testid="cascade-defilement">
          <div className="min-w-[36rem] md:min-w-0">
            <Cascade
              totalMs={c.totalMs}
              pistes={PISTES_SESSION}
              elements={c.elements}
              marqueurs={c.marqueurs}
              partiel={PARTIEL_CASCADE}
            />
          </div>
        </div>
      </Figure>
    </SectionErreur>
  );
}

/** Ce que la page sait de la population d'une pire mesure (§ 5.12.4). */
type Situation =
  | { kind: "sans_route" }
  | { kind: "refus"; code: string }
  | {
      kind: "lue";
      route: string;
      fenetre: { from: string; to: string };
      /** La même population sur `/pages` : même app, même route, même fenêtre. */
      href: string;
      percentiles: VitalPercentiles | null;
      pctsLus: boolean;
      plafond: number;
      plafondLibelle: string | null;
      histo: Lecture<HistoRow[]>;
    };

type Population<T> = { refuse: true; code: string } | { refuse: false; lecture: Lecture<T> };

/**
 * Lecture d'une population : un filtre que la lecture ne porte pas est un REFUS du
 * contrat, rendu avec son code — jamais la page entière en erreur (`lire` le
 * relance, § 3.8). Toute autre panne reste une lecture en échec.
 */
async function lirePopulation<T>(fn: () => Promise<T>): Promise<Population<T>> {
  try {
    return { refuse: false, lecture: await lire(fn) };
  } catch (e) {
    if (e instanceof UnsupportedFilterError) return { refuse: true, code: e.error.code };
    throw e;
  }
}

/**
 * Situe la pire mesure de chaque vital (§ 5.12.4, § 3.5). Le contrat est résolu par
 * `parseAnalyticsQuery` avec l'app de la session, la fenêtre ancrée et la route de
 * la MESURE — rien d'autre : c'est la population de cette route, pas celle des
 * filtres de la liste d'où l'on vient. Percentiles lus une fois par route, puis
 * l'histogramme de chaque vital sous son plafond d'affichage (règle de `/pages`).
 */
async function situerPires(
  pires: VitauxSession["pires"],
  ctx: { app: string; principal: ScopePrincipal | null; debutMs: number; nowMs: number },
): Promise<Map<VitalName, Situation>> {
  const fenetre = fenetreDeSession(ctx.debutMs, ctx.nowMs);
  const routes = [...new Set(pires.flatMap((p) => (p.pire.route ? [p.pire.route] : [])))];
  const contrats = new Map(
    routes.map(
      (route) =>
        [
          route,
          parseAnalyticsQuery(paramReader({ app: ctx.app, from: fenetre.from, to: fenetre.to, route }), {
            principal: ctx.principal,
            nowMs: ctx.nowMs,
          }),
        ] as const,
    ),
  );
  const percentiles = new Map(
    await Promise.all(
      routes.map(async (route) => {
        const contrat = contrats.get(route)!;
        return [route, contrat.ok ? await lirePopulation(() => vitalPercentiles(filtersOfQuery(contrat.value))) : null] as const;
      }),
    ),
  );
  const situations = await Promise.all(
    pires.map(async (p): Promise<[VitalName, Situation]> => {
      const route = p.pire.route;
      if (!route) return [p.vital, { kind: "sans_route" }];
      const contrat = contrats.get(route)!;
      if (!contrat.ok) return [p.vital, { kind: "refus", code: contrat.error.code }];
      const pcts = percentiles.get(route) ?? null;
      if (pcts && pcts.refuse) return [p.vital, { kind: "refus", code: pcts.code }];
      const lecturePcts = pcts && !pcts.refuse ? pcts.lecture : null;
      const ligne = lecturePcts && lecturePcts.ok ? (lecturePcts.data.find((r) => r.name === p.vital) ?? null) : null;
      const { plafond, libelle } = plafondAffichage(
        p.vital,
        ligne ? { p95: ligne.pcts[3] ?? null, p99: ligne.pcts[4] ?? null } : null,
      );
      const f = filtersOfQuery(contrat.value);
      const histo = await lirePopulation(() => vitalHistogram(f, p.vital, plafond, HISTO_BUCKETS));
      if (histo.refuse) return [p.vital, { kind: "refus", code: histo.code }];
      const lien = new URLSearchParams({ app: ctx.app, route, vital: p.vital, from: fenetre.from, to: fenetre.to });
      return [
        p.vital,
        {
          kind: "lue",
          route,
          fenetre,
          href: `/pages?${lien.toString()}`,
          percentiles: ligne,
          pctsLus: lecturePcts?.ok === true,
          plafond,
          plafondLibelle: libelle,
          histo: histo.lecture,
        },
      ];
    }),
  );
  return new Map(situations);
}

/**
 * Web Vitals de la session (§ 5.12.4) : une tuile par vital — sa PIRE vue —, la
 * position de cette mesure dans la distribution de SA route, puis une ligne par
 * vue. Zones de seuil lues dans lib/rating.ts. Les phases réseau (DNS, TCP…) ne
 * sont pas des Web Vitals : elles restent dans le Déroulé.
 */
function OngletVitaux({
  timeline,
  vitaux,
  situations,
  t0,
  tronquee,
  robot,
  debutConservationMs,
  lienDeroule,
}: {
  timeline: TimelineItem[];
  vitaux: VitauxSession;
  situations: Map<VitalName, Situation>;
  t0: number;
  tronquee: boolean;
  robot: boolean;
  /** Plus ancien instant encore conservé (`RETENTION_DAYS`). */
  debutConservationMs: number;
  lienDeroule: (rang: number) => string;
}) {
  const phases = timeline.filter((it) => it.kind === "vital" && !estWebVital(it)).length;
  if (vitaux.vitaux.length === 0) {
    return (
      <OngletTable titre="Web Vitals de la session" tronquee={tronquee} vide="Aucun Web Vital mesuré dans cette session">
        {null}
      </OngletTable>
    );
  }
  return (
    <div className="space-y-4" data-testid="onglet-vitaux">
      {tronquee && (
        <EtatSurface
          compact
          etat={{
            kind: "partiel",
            raison: `chronologie tronquée à ${LIMITE_CHRONOLOGIE} événements : tuiles et table ne portent que sur les événements lus`,
          }}
        />
      )}
      <section
        aria-label="Pire mesure de chaque Web Vital"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
        data-testid="vitaux-tuiles"
      >
        {vitaux.pires.map((p) => {
          const s = situations.get(p.vital);
          return (
            <KpiTile
              key={p.vital}
              label={`${p.vital} · pire vue`}
              valeur={p.pire.valeur}
              format={formatDuVital(p.vital)}
              // Zone de seuil de CETTE mesure (lib/rating.ts) ; la lecture dit que ce
              // n'est pas le verdict d'une page, qui se lit au p75 (R-V).
              vital={p.vital}
              href={s?.kind === "lue" ? s.href : undefined}
              lecture={`${p.n > 1 ? `pire de ${formater("count", p.n)} mesures` : "une mesure"}, à ${decalage(p.pire.ts, t0)} · zone de seuil de la mesure, pas un p75.`}
            />
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {vitaux.pires.map((p) => (
          <SectionErreur key={p.vital} titre={`${p.vital} : où se situe la pire vue`}>
            <FigureSituation
              pire={p}
              situation={situations.get(p.vital) ?? { kind: "sans_route" }}
              robot={robot}
              debutConservationMs={debutConservationMs}
            />
          </SectionErreur>
        ))}
      </div>

      <OngletTable titre="Web Vitals par vue" tronquee={false} vide={null}>
        <table className={TABLE} data-testid="table-vitals">
          <caption className="sr-only">Web Vitals de la session, une ligne par vue ; la pire mesure quand une vue en a plusieurs</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Instant</th>
              <th scope="col" className={TH}>Vue</th>
              {vitaux.vitaux.map((v) => (
                <th key={v} scope="col" className={`${TH} text-right`}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vitaux.lignes.map((l, i) => (
              <tr key={i}>
                <td
                  className={`${TD} whitespace-nowrap font-mono text-xs tabular-nums text-ink-soft`}
                  title={l.vue ? fmtDate(l.vue.ts) : undefined}
                >
                  {l.vue ? decalage(l.vue.ts, t0) : "—"}
                </td>
                <td className={`${TD} font-mono text-xs`}>
                  {l.vue && l.rangVue != null ? (
                    <Link
                      href={lienDeroule(l.rangVue)}
                      className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                    >
                      {l.vue.title ?? "Route inconnue"}
                    </Link>
                  ) : (
                    "Avant la première vue"
                  )}
                </td>
                {vitaux.vitaux.map((v) => {
                  const m = l.mesures[v];
                  const zone = m ? rating2026(v, m.pire.valeur) : null;
                  return (
                    <td key={v} className={`${TD} whitespace-nowrap text-right`}>
                      {m ? (
                        <>
                          <span className="tabular-nums">{formater(formatDuVital(v), m.pire.valeur)}</span>
                          <span className="block text-[11px] text-ink-soft">
                            {zone ? RATING_LABEL[zone] : "—"}
                            {m.n > 1 ? ` · pire de ${m.n}` : ""}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {phases > 0 && (
          <p className="mt-3 text-xs text-ink-soft">
            {formater("count", phases)} phase(s) réseau (DNS, connexion, TLS…) ne sont pas des Web Vitals : elles restent
            dans le Déroulé.
          </p>
        )}
      </OngletTable>
    </div>
  );
}

/**
 * La pire vue d'un vital, située dans la distribution de SA route (§ 5.12.4). La
 * population est NOMMÉE en méta — vital, route, fenêtre datée, ce qui en fait
 * partie ou non — et la mesure y est marquée « cette vue ». Jamais « les 7 derniers
 * jours » : la fenêtre est celle de la session (`fenetreDeSession`).
 */
function FigureSituation({
  pire,
  situation,
  robot,
  debutConservationMs,
}: {
  pire: PireMesure & { vital: VitalName };
  situation: Situation;
  robot: boolean;
  debutConservationMs: number;
}) {
  const { vital } = pire;
  const titre = `${vital} : où se situe la pire vue`;
  const id = `vitaux-${vital.toLowerCase()}`;
  if (situation.kind === "sans_route") {
    return (
      <Figure titre={titre} id={id} etat={{ kind: "partiel", raison: "route de la mesure inconnue : aucune population comparable" }} />
    );
  }
  if (situation.kind === "refus") {
    return (
      <Figure
        titre={titre}
        id={id}
        etat={{ kind: "partiel", raison: `fenêtre refusée par le contrat (${situation.code}) : population non lue` }}
      />
    );
  }
  const { route, fenetre, histo, plafond, plafondLibelle, percentiles, pctsLus } = situation;
  if (!histo.ok) return <Figure titre={titre} id={id} etat={{ kind: "erreur", titre }} />;

  const periode = `${libelleFenetre(fenetre.from, fenetre.to)} (UTC)`;
  const instant = new Date(pire.pire.ts).getTime();
  const inclusion = robot
    ? "session classée robot : ses mesures en sont exclues"
    : instant >= Date.parse(fenetre.from) && instant < Date.parse(fenetre.to)
      ? "cette mesure comprise"
      : "cette mesure hors fenêtre (reçue plus de 24 h après le début de la session)";
  const bacs = bacsDeHistogramme(histo.data, plafond, HISTO_BUCKETS);
  const n = bacs.reduce((s, b) => s + b.n, 0);
  const plafondTexte = plafondLibelle ?? `plafond d'affichage : ${formater(formatDuVital(vital), plafond)} (par défaut)`;
  const p = percentiles?.pcts ?? null;
  const reperes = p ? { p50: p[0] ?? null, p75: p[1] ?? null, p95: p[3] ?? null } : null;
  const alternative = alternativeDistribution({ vital, bacs, plafond, percentiles: reperes, n });

  return (
    <Figure
      titre={titre}
      id={id}
      meta={
        <>
          <span className="min-w-0 break-words" data-testid="vitaux-population">
            mesures {vital} de {route} {periode}, toutes sessions (robots exclus), {inclusion}
          </span>
          <span>{formater("count", n)} mesures</span>
          {n > 0 && <span>{plafondTexte}</span>}
        </>
      }
      lecture={
        n > 0 ? (
          <>
            Trait orange : cette vue ({formater(formatDuVital(vital), pire.pire.valeur)}). Repères p50, p75 et p95 : toute
            la route sur la fenêtre. La fenêtre est ancrée sur la session — 7 jours avant son début, 1 jour après, jamais
            au-delà de maintenant — pour que la comparaison porte sur une population qui la contient.
          </>
        ) : undefined
      }
      alternative={
        n > 0 ? { ...alternative, legende: `${alternative.legende} ${plafondTexte[0].toUpperCase()}${plafondTexte.slice(1)}.` } : undefined
      }
    >
      <div className="space-y-2">
        {Date.parse(fenetre.from) < debutConservationMs && (
          <EtatSurface
            compact
            etat={{ kind: "partiel", raison: `mesures conservées depuis le ${jourMoisUtc(debutConservationMs)} seulement` }}
          />
        )}
        {n > 0 && !pctsLus && (
          <EtatSurface
            compact
            etat={{ kind: "partiel", raison: "percentiles de la route non lus : repères absents, plafond par défaut." }}
          />
        )}
        {n === 0 ? (
          <EtatSurface etat={{ kind: "vide", population: `mesure ${vital} de ${route}`, plage: `la fenêtre ${periode}` }} />
        ) : (
          <DistributionSeuils
            vital={vital}
            bacs={bacs}
            plafond={plafond}
            plafondLibelle={plafondLibelle ?? undefined}
            percentiles={reperes}
            n={n}
            valeurMarquee={{ valeur: pire.pire.valeur, libelle: "cette vue" }}
            alternative={false}
          />
        )}
      </div>
    </Figure>
  );
}
