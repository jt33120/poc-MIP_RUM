// Détail de session (F44, plan § 5.12) : « Que s'est-il passé dans cette session,
// dans quel ordre, et qu'a vu le visiteur ? »
//
// Y1 en-tête (retour, titre, puces de contexte) · « En bref » (P*.9) · Y2 résumé en
// cinq tuiles · Y3 onglets COMPTÉS (Déroulé, Erreurs, Appels API, Web Vitals,
// Attributs) · Y4 contenu de l'onglet.
//
// COMPATIBILITÉ. `?tab=replay` et `?tab=timeline` (liens existants, dont
// components/errors/error-view.ts) ouvrent le Déroulé, qui porte le rejeu ET la
// chronologie ; `at` reste lu et positionne le lecteur. Groupement par vue (F45),
// cascade et distributions (F46), synchronisation du rejeu (F47) viennent ensuite.
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
import { TimelineRow } from "@/components/sessions/Timeline";
import { formater } from "@/lib/fmt-ids";
import { fmtDate, fmtVital } from "@/lib/format";
import { lire } from "@/lib/lecture";
import { sessionMeta, sessionTimeline, type TimelineItem } from "@/lib/queries";
import { authorizedAppsOf } from "@/lib/query-contract";
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
  const authorized = authorizedAppsOf(await getUser());
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

  // Filtres globaux conservés dans les liens ; onglet et instant exclus (propres au détail).
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => {
      const valeur = premier(v);
      return typeof valeur === "string" && k !== "tab" && k !== "at" ? [[k, valeur] as [string, string]] : [];
    }),
  ).toString();
  const chemin = `/sessions/${encodeURIComponent(meta.session_id)}`;
  const hrefOnglet = (o: OngletSession, extra: { at?: number | null; ancre?: string } = {}) => {
    const p = new URLSearchParams(qs);
    if (o !== "deroule") p.set("tab", o);
    if (extra.at != null) p.set("at", String(extra.at));
    const s = p.toString();
    return `${chemin}${s ? `?${s}` : ""}${extra.ancre ? `#${extra.ancre}` : ""}`;
  };
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

  const comptes: Record<OngletSession, number | null | undefined> = {
    deroule: undefined,
    erreurs: resume.erreursLignes,
    api: resume.apiLignes,
    vitals: resume.vitaux,
    attributs: undefined,
  };

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
          deroule: hrefOnglet("deroule", { ancre: "chronologie" }),
          erreurs: hrefOnglet("erreurs"),
          api: hrefOnglet("api"),
        }}
      />

      {/* Y3 — onglets comptés ; un compte inconnu s'écrit « (—) », jamais « (0) ». */}
      {ignore && (
        <p role="note" className="mb-2 text-xs text-ink-soft" data-testid="reglage-ignore">
          {ignore}
        </p>
      )}
      <nav aria-label="Onglets de la session" className="mb-4 flex overflow-x-auto border-b border-line" data-testid="session-tabs">
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
            className={`card min-w-0 scroll-mt-24 p-4 sm:p-6 ${avecRejeu ? "xl:col-span-2 xl:max-h-[48rem] xl:overflow-y-auto" : ""}`}
          >
            {!avecRejeu && (
              <p className="mb-4 text-xs text-ink-soft" data-testid="deroule-sans-rejeu">
                Aucun rejeu enregistré pour cette session : la chronologie seule.
              </p>
            )}
            {resume.tronquee && (
              <div className="mb-4">
                <EtatSurface compact etat={{ kind: "partiel", raison: `chronologie tronquée à ${LIMITE_CHRONOLOGIE} événements` }} />
              </div>
            )}
            {timeline.length ? (
              <ol className="relative ml-2 border-l-2 border-line" data-testid="timeline">
                {timeline.map((it, i) => (
                  <TimelineRow key={i} id={ancreEvenement(i)} item={it} t0={t0} />
                ))}
              </ol>
            ) : (
              <p className="py-8 text-center text-sm text-ink-soft">Aucun événement enregistré pour cette session</p>
            )}
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

      {onglet === "vitals" && <OngletVitaux timeline={timeline} t0={t0} tronquee={resume.tronquee} />}

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
  hrefs: { deroule: string; erreurs: string; api: string };
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
      <KpiTile label="Pages vues" valeur={pages} format="count" href={hrefs.deroule} />
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
        href={hrefs.deroule}
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
      {vide ? <p className="py-8 text-center text-sm text-ink-soft">{vide}</p> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}

/**
 * Web Vitals de la session : une ligne par mesure, verdict par `rating2026` (seuils
 * de lib/rating.ts). Les phases réseau (DNS, TCP…) ne sont pas des Web Vitals :
 * elles restent dans le Déroulé. La position dans la distribution de la route
 * (fenêtre ancrée sur la session) vient avec F46.
 */
function OngletVitaux({ timeline, t0, tronquee }: { timeline: TimelineItem[]; t0: number; tronquee: boolean }) {
  const lignes = timeline.filter(estWebVital);
  const phases = timeline.filter((it) => it.kind === "vital" && !estWebVital(it)).length;
  return (
    <OngletTable
      titre="Web Vitals de la session"
      tronquee={tronquee}
      vide={lignes.length === 0 ? "Aucun Web Vital mesuré dans cette session" : null}
    >
      <table className={TABLE} data-testid="table-vitals">
        <caption className="sr-only">Web Vitals de la session, une ligne par mesure</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>Instant</th>
            <th scope="col" className={TH}>Vital</th>
            <th scope="col" className={`${TH} text-right`}>Valeur</th>
            <th scope="col" className={TH}>Verdict</th>
            <th scope="col" className={TH}>Route</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((it, i) => {
            const valeur = it.value == null ? null : Number(it.value);
            const verdict = valeur == null || it.title == null ? null : rating2026(it.title, valeur);
            return (
              <tr key={i}>
                <td className={`${TD} whitespace-nowrap font-mono text-xs tabular-nums text-ink-soft`} title={fmtDate(it.ts)}>
                  {decalage(it.ts, t0)}
                </td>
                <td className={`${TD} font-medium`}>{it.title}</td>
                <td className={`${TD} text-right tabular-nums`}>{fmtVital(it.title ?? "", valeur)}</td>
                <td className={TD}>{verdict ? RATING_LABEL[verdict] : "—"}</td>
                <td className={`${TD} font-mono text-xs`}>{it.detail ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {phases > 0 && (
        <p className="mt-3 text-xs text-ink-soft">
          {formater("count", phases)} phase(s) réseau (DNS, connexion, TLS…) ne sont pas des Web Vitals : elles restent dans
          le Déroulé.
        </p>
      )}
    </OngletTable>
  );
}
