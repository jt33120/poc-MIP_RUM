// Panneau de session (F43, plan § 5.11.4 et § 4.3) — rendu SERVEUR, fonction locale
// à `/sessions` : seul `app/sessions/page.tsx` l'importe, aucune prop publique au
// sens du § 4.
//
// QUALIFIER SANS QUITTER LA LISTE. Une ligne de « Toutes les sessions » ouvre
// `panel=session:<id>` (§ 3.3) : puces de contexte, quatre tuiles, la mini-cascade de
// la session et ses quinze premiers événements groupés par vue. Le rejeu, le déroulé
// complet, les erreurs et les appels API restent sur la page de la session : ils
// demandent de la largeur, et le panneau qualifie.
//
// DEUX TEMPS, POUR QUE RIEN NE SOIT LU AVANT LA GARDE.
//   1. `lirePanneauSession` (`lib/chargeurs/panneau-session.ts`, C3) lit la session
//      et applique la garde de sa page : une app que l'écran ne lit pas (périmètre du
//      principal, app demandée) rend « introuvable », sans rien lire de plus — ni
//      chronologie, ni rejeu. Le chargeur de l'écran la lance EN MÊME TEMPS que ses
//      propres lectures.
//   2. `PanneauSession` rend ce qui a été lu. Il ne reçoit jamais une session hors
//      périmètre : l'écran écrit alors « session introuvable ou hors périmètre », et
//      aucun panneau ne s'ouvre.
//
// PAS DE FENÊTRE DE TEMPS (exception déclarée du § 3.5) : une session n'a pas de
// fenêtre de contrat. Ses chiffres portent sur la session ENTIÈRE, et le panneau le
// dit — la plage de l'écran n'a servi qu'à la lister.
//
// GARDE CAPTEUR (R-F) : une session React Native n'émet aucun signal de frustration.
// Sa tuile dit « Non collecté », jamais « 0 » ; une session navigateur (SDK ou
// extension, même bundle, CP16) montre son compte, zéro compris.
//
// IDENTITÉ : rien de `select *` ne sort d'ici. Le seul composant client du panneau
// est l'îlot clavier de `DetailPanel`, qui ne reçoit que des liens.
import Link from "next/link";
import { DetailPanel, type PuceDetail } from "@/components/DetailPanel";
import { Cascade } from "@/components/charts/Cascade";
import { KpiTile } from "@/components/charts/KpiTile";
import { Deroule } from "@/components/sessions/Deroule";
import { EchecLecture } from "@/components/states/SectionErreur";
import { formater } from "@/lib/fmt-ids";
import type { SectionLue } from "@/lib/lecture";
import type { LecturePanneauSession as LecturePanneauSessionBrute } from "@/lib/chargeurs/panneau-session";
import { cascadeDeSession } from "@/lib/deroule";
import { premiersEvenements } from "@/lib/panneau-session";
import type { SessionMeta as SessionMetaBrute } from "@/lib/queries";
import type { Fil } from "@mip/console-contract";
import { LIMITE_CHRONOLOGIE } from "@/lib/recit-session";
import {
  LECTURE_FRUSTRATION,
  RAISON_FRUSTRATION_MOBILE,
  RAISON_TRONQUEE,
  RUNTIME_MOBILE,
  dureeObservee,
  encoreActive,
  occurrencesLisibles,
  pucesDeSession,
  resumeDeSession,
} from "@/lib/session-detail";
import { instantUtc } from "@/lib/sessions-priorite";

/** Ce que le panneau a pu lire, tel que le chargeur de `/sessions` le rend (sur le fil). */
export type LecturePanneauSession = Fil<LecturePanneauSessionBrute>;
type SessionMeta = Fil<SessionMetaBrute>;

/** Les puces du panneau (§ 5.11.4) : qui, sur quoi, où — le visiteur et l'échantillonnage restent à la page. */
const PUCES_DU_PANNEAU = new Set(["Appareil", "Navigateur", "Système", "Pays estimé", "Capteur", "Release à l'ouverture"]);

/**
 * Mêmes puces que la page de session (`pucesDeSession`, § 5.12.4), réduites à celles
 * du panneau. « App » s'y ajoute quand l'écran lit plusieurs apps : ↑ / ↓ peuvent
 * alors passer d'une app à l'autre sans que rien ne le montre. Le lien de la release
 * n'est pas repris : une puce de `DetailPanel` est un texte.
 */
function pucesDuPanneau(meta: SessionMeta, avecApp: boolean): PuceDetail[] {
  return pucesDeSession(meta, () => "")
    .filter((p) => PUCES_DU_PANNEAU.has(p.label) || (avecApp && p.label === "App"))
    .map(({ label, valeur, provenance }) => (provenance ? { label, valeur, provenance } : { label, valeur }));
}

/** `pageHref` + paramètres propres au détail (`tab`, `voir`) + ancre. */
function lienDeLaPage(pageHref: string, extra: Record<string, string>, ancre?: string): string {
  const [chemin, qs = ""] = pageHref.split("?");
  const p = new URLSearchParams(qs);
  for (const [cle, valeur] of Object.entries(extra)) p.set(cle, valeur);
  const texte = p.toString();
  return `${chemin}${texte ? `?${texte}` : ""}${ancre ? `#${ancre}` : ""}`;
}

/** Le titre : un identifiant technique tronqué, comme la table et la page (aucune identité). */
function Titre({ id }: { id: string }) {
  return (
    <>
      Session <span className="font-mono text-ink-soft">{id.slice(0, 8)}…</span>
    </>
  );
}

const RAISON_NON_LUE = "chronologie non lue : compte non établi";

const TITRE_BLOC = "mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft";
const LIEN = "rounded text-xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

/** Le rejeu au premier niveau : présent → ▶ ; absent → dit ; non lu → le lien, et le doute écrit. */
function GesteRejeu({ rejeu, href }: { rejeu: SectionLue<boolean>; href: string }) {
  if (rejeu.ok && !rejeu.data) {
    return (
      <p className="text-xs text-ink-soft" data-testid="panneau-session-sans-rejeu">
        Aucun rejeu enregistré pour cette session.
      </p>
    );
  }
  return (
    <Link
      href={href}
      data-testid="panneau-session-rejeu"
      title={rejeu.ok ? undefined : "existence du rejeu non lue"}
      className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent-ink hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
    >
      <span aria-hidden="true">▶</span>
      {rejeu.ok ? "Rejeu" : "Rejeu (existence non lue)"}
    </Link>
  );
}

export function PanneauSession({
  lecture,
  plage,
  avecApp,
  fermerHref,
  pageHref,
  precedentHref,
  suivantHref,
}: {
  /** Jamais `introuvable` : l'écran ne monte alors aucun panneau. */
  lecture: Exclude<LecturePanneauSession, { etat: "introuvable" }>;
  /** Plage de l'écran (`rangeLabel`), citée pour dire qu'elle ne borne pas la session. */
  plage: string;
  /** L'écran lit plusieurs apps : la puce « App » dit laquelle. */
  avecApp: boolean;
  fermerHref: string;
  /** `/sessions/<id>`, filtres conservés : « Ouvrir en page » et base des liens des tuiles. */
  pageHref: string;
  /** `undefined` : session hors de la page de liste affichée, pas de parcours. */
  precedentHref?: string | null;
  suivantHref?: string | null;
}) {
  const parcours = { fermerHref, pageHref, precedentHref, suivantHref };

  // La session n'a pas pu être lue : le panneau s'ouvre, dit l'échec et propose de
  // réessayer — jamais « introuvable », qui affirmerait une absence non établie.
  if (lecture.etat === "echec") {
    return (
      <DetailPanel type="session" titre={<Titre id={lecture.id} />} {...parcours}>
        <EchecLecture titre="Session" />
      </DetailPanel>
    );
  }

  const { meta, timeline, rejeu } = lecture;
  const items = timeline.ok ? timeline.data : null;
  const resume = items ? resumeDeSession(items, meta.runtime) : null;
  const mobile = meta.runtime === RUNTIME_MOBILE;
  const t0 = new Date(meta.started_at).getTime();
  const active = encoreActive(meta.last_seen_at, Date.now());
  // Avant v67, une ligne d'erreur ne porte pas ses occurrences : on compte des lignes, et on le dit.
  const erreursEnLignes = items !== null && resume !== null && !resume.tronquee && !occurrencesLisibles(items);
  const lien = (extra: Record<string, string>, ancre?: string) => lienDeLaPage(pageHref, extra, ancre);

  const premiers = items ? premiersEvenements(items) : null;
  // Une page vue mène à la même page pour TOUS les visiteurs — app liée (V7), sans
  // la plage de l'écran : la session n'est pas bornée par elle.
  const liensVues: Record<number, string> = {};
  premiers?.items.forEach((it, rang) => {
    if (it.kind === "pageview" && it.title) {
      liensVues[rang] = `/pages?${new URLSearchParams({ app: meta.app_id, route: it.title }).toString()}`;
    }
  });

  return (
    <DetailPanel type="session" titre={<Titre id={meta.session_id} />} puces={pucesDuPanneau(meta, avecApp)} {...parcours}>
      <div className="space-y-5" data-testid="panneau-session">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 basis-full text-xs text-ink-soft sm:basis-auto sm:flex-1" data-testid="panneau-session-portee">
            Session entière, du {instantUtc(meta.started_at)} au {instantUtc(meta.last_seen_at)} (UTC)
            {active ? ", encore active" : ""} : ces chiffres ne dépendent pas de la plage de l&apos;écran ({plage}), qui
            n&apos;a servi qu&apos;à la lister.
          </p>
          <GesteRejeu rejeu={rejeu} href={lien({ tab: "replay" })} />
        </div>

        {/* Quatre tuiles (§ 5.11.4) : deux colonnes dans le demi-écran (≥ 1280 px) et à
            390 px, quatre quand le panneau occupe toute la largeur d'un écran moyen. */}
        <section
          aria-label="Résumé de la session"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-2"
          data-testid="panneau-session-resume"
        >
          <KpiTile
            label="Durée observée"
            valeur={dureeObservee(meta.started_at, meta.last_seen_at)}
            format="s-auto"
            lecture={`écart entre la première et la dernière observation, pas du temps actif${
              active ? " · encore active : elle peut encore augmenter" : ""
            }.`}
          />
          <KpiTile label="Pages vues" valeur={meta.page_count} format="count" href={lien({ voir: "vue" }, "chronologie")} />
          <KpiTile
            label={erreursEnLignes ? "Erreurs (lignes)" : "Occurrences d'erreur"}
            valeur={resume === null ? null : erreursEnLignes ? resume.erreursLignes : resume.occurrences}
            raisonNull={resume === null ? RAISON_NON_LUE : RAISON_TRONQUEE}
            format="count"
            lecture={erreursEnLignes ? "une ligne peut regrouper plusieurs répétitions." : undefined}
            href={lien({ tab: "erreurs" })}
          />
          {/* Garde capteur (R-F) : lue sur la SESSION, elle tient même si la chronologie n'a pas pu l'être. */}
          <KpiTile
            label="Signaux de frustration"
            valeur={mobile ? null : (resume?.frustration ?? null)}
            raisonNull={mobile ? RAISON_FRUSTRATION_MOBILE : resume === null ? RAISON_NON_LUE : RAISON_TRONQUEE}
            format="count"
            lecture={mobile ? undefined : LECTURE_FRUSTRATION}
            href={mobile ? undefined : lien({ voir: "frustration" }, "chronologie")}
          />
        </section>

        <section aria-labelledby="panneau-session-cascade-titre" className="min-w-0" data-testid="panneau-session-cascade">
          <h3 id="panneau-session-cascade-titre" className={TITRE_BLOC}>
            Cascade de la session
          </h3>
          {items ? (
            <>
              <Cascade hauteur="reduite" {...cascadeDeSession(items, meta.started_at, meta.last_seen_at)} />
              <p className="mt-2 text-xs text-ink-soft">
                Aperçu par piste sur la durée observée ; chaque élément, avec son début et sa durée, est dans
                l&apos;alternative textuelle et sur la page de la session.
              </p>
            </>
          ) : (
            <EchecLecture titre="Cascade de la session" compact />
          )}
        </section>

        {/* Le déroulé de la page, sur les quinze premiers événements : même groupement
            par vue, mêmes pastilles de Web Vitals, mêmes phases réseau repliées (F45). */}
        <section aria-labelledby="panneau-session-evenements-titre" className="min-w-0" data-testid="panneau-session-evenements">
          <h3 id="panneau-session-evenements-titre" className={TITRE_BLOC}>
            Premiers événements
          </h3>
          {premiers ? (
            <>
              <Deroule items={premiers.items} t0={t0} voir={null} liens={liensVues} tronque={false} />
              {premiers.total > 0 && (
                <p className="mt-3 text-xs text-ink-soft" data-testid="panneau-session-evenements-compte">
                  {premiers.total > premiers.montres
                    ? `Les ${formater("count", premiers.montres)} premiers événements sur ${formater("count", premiers.total)}${
                        resume?.tronquee ? ` lus (chronologie limitée à ${LIMITE_CHRONOLOGIE} lignes)` : ""
                      }, groupés par page vue ; la suite est sur la page de la session.`
                    : `${formater("count", premiers.total)} événement(s), groupés par page vue.`}
                </p>
              )}
            </>
          ) : (
            <EchecLecture titre="Premiers événements" compact />
          )}
        </section>

        <p className="border-t border-line pt-4 text-xs text-ink-soft">
          Rejeu, déroulé complet, erreurs et appels API sont sur la page de la session.{" "}
          <Link href={lien({}, "chronologie")} className={LIEN} data-testid="panneau-session-deroule">
            Voir le déroulé complet
          </Link>
        </p>
      </div>
    </DetailPanel>
  );
}
