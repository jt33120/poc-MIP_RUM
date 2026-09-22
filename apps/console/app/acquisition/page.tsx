// Acquisition (F48, plan § 5.16) — « D'où arrivent les sessions, et par quelles
// pages entrent-elles ? »
//
// CE QUE L'ÉCRAN REFUSE D'AFFIRMER.
//   - Une part cachée : l'anneau d'avant filtrait les canaux à 0 (`Donut`), et
//     l'absence de recherche disparaissait. Les CINQ canaux sont toujours rendus,
//     dans un ordre fixe, zéros compris, avec leur part de TOUTES les sessions lues.
//   - Une fenêtre qui n'est pas la sienne : la lecture est historique
//     (`now() - interval`, CS1) ; la fenêtre réellement lue et l'heure de lecture
//     sont écrites sous l'en-tête et dans la méta de chaque figure (S3).
//   - Un plafond muet : au-delà de 20 000 sessions, les canaux portent sur les
//     20 000 PREMIÈRES par identifiant ; c'est dit à côté du chiffre (S4).
//   - Une figure vide dessinée pour un patch absent : la table croisée et la série
//     attendent B31, et le disent (§ 0.5), sans axe ni zéro.
import { PageHeader } from "@/components/PageHeader";
import { HeroReading } from "@/components/SupervisionHero";
import { Figure } from "@/components/charts/Figure";
import { KpiLibelle } from "@/components/charts/KpiLibelle";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import {
  LIBELLE_CANAL,
  PLAFOND_ACQUISITION,
  TOP_REFERENTS,
  lignesCanaux,
  partDuTotal,
  partHorsDirect,
  referentsTronques,
  type AcquisitionReport,
  type Channel,
} from "@/lib/acquisition";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { lire } from "@/lib/lecture";
import { fenetreDansPhrase, fenetreLue, noteLectureHistorique, plafondAtteint } from "@/lib/lecture-historique";
import { categorie } from "@/lib/palette";
import { pageFilters } from "@/lib/page-filters";
import { hrefWithQuery } from "@/lib/query-contract";
import { acquisition } from "@/lib/queries-acquisition";
import { samplingSessionsHistorique } from "@/lib/queries-sessions";

export const dynamic = "force-dynamic";

// Un canal est une catégorie, pas un verdict : couleurs de CATEGORIELLE, dans
// l'ordre fixe des canaux (le « Site référent » n'est pas « bon », l'« Interne »
// pas « à surveiller »).
const COULEUR_CANAL: Record<Channel, string> = {
  direct: categorie(4),
  search: categorie(0),
  social: categorie(2),
  referral: categorie(1),
  internal: categorie(6),
};

/** La population de l'écran, nommée dans chaque méta (S1, R-P). */
const POPULATION = "sessions ayant au moins une vue sur la fenêtre";

/** Pourquoi une barre de canal ne mène nulle part (title, alternative, lecture). */
const NON_CLIQUABLE = "barres non cliquables : le canal d'entrée n'est pas un filtre de la console";

const TEXTE_PLAFOND = `plafond de ${formater("count", PLAFOND_ACQUISITION)} sessions atteint : les canaux portent sur les ${formater(
  "count",
  PLAFOND_ACQUISITION,
)} premières sessions par identifiant, pas les plus récentes`;

/** « 1 session lue », « 20 000 sessions lues ». */
const compte = (n: number, un: string, plusieurs: string) => `${formater("count", n)} ${n > 1 ? plusieurs : un}`;

/** « 540 · 62,1 % » : le compte et sa part de toutes les sessions lues. */
const compteEtPart = (sessions: number, total: number) =>
  `${formater("count", sessions)} · ${formater("pct", partDuTotal(sessions, total))}`;

export default async function Acquisition({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ecran = await pageFilters(await searchParams, "/acquisition");
  if (!ecran.ok) return <FilterProblemNotice title="Acquisition" problem={ecran.problem} />;
  const f = ecran.filters;
  // S7 : même population que la lecture (sessions ayant une vue sur la fenêtre
  // glissante), lue à part : son échec ne masque pas les canaux, il est dit.
  const [lecture, echantillonnage] = await Promise.all([
    lire(() => acquisition(f)),
    lire(() => samplingSessionsHistorique(f, { lecture: "vues" })),
  ]);
  // Heure de la lecture : la fenêtre glissante finit ici, pas à la borne `to`.
  const luA = new Date();
  const fenetre = fenetreLue(f.period, luA);
  const dansPhrase = fenetreDansPhrase(f.period);
  const meta = (extra?: string) => (
    <>
      {extra && <span>{extra}</span>}
      <span>Population : {POPULATION}</span>
      <span>{fenetre}</span>
      <span>lecture non migrée</span>
    </>
  );
  // Élargir la fenêtre est le seul geste utile devant un vide (le canal n'est pas un filtre).
  const elargir =
    f.period === "7d" ? undefined : { libelle: "Élargir à 7 jours", href: hrefWithQuery("/acquisition", ecran.query, { period: "7d" }) };

  return (
    <div className="animate-fade-up">
      <PageHeader title="Acquisition" domain="usages" sub="D'où arrivent les sessions, et par quelles pages entrent-elles ?" />

      <p className="-mt-3 mb-6 text-xs text-ink-soft" data-testid="lecture-non-migree">
        {noteLectureHistorique(f.period, luA)}
      </p>

      <SectionErreur titre="Chiffres clés">
        {lecture.ok ? (
          <RangeeKpi rep={lecture.data} />
        ) : (
          <div className="mb-6">
            <EchecLecture titre="Chiffres clés" />
          </div>
        )}
      </SectionErreur>

      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* A3 — le hero (7 colonnes) et ce que « direct » recouvre (5 colonnes). */}
      <div className="mb-6 grid min-w-0 gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <SectionErreur titre="Sessions par canal d'entrée">
            <Figure
              id="acquisition-canaux"
              titre="Sessions par canal d'entrée"
              meta={meta(lecture.ok ? compte(lecture.data.total, "session lue", "sessions lues") : undefined)}
              etat={
                !lecture.ok
                  ? { kind: "erreur", titre: "Sessions par canal d'entrée" }
                  : lecture.data.total === 0
                    ? { kind: "vide", population: "session", plage: dansPhrase, geste: elargir }
                    : undefined
              }
              lecture="Longueur = part de toutes les sessions lues ; ordre fixe des canaux, zéros compris. Barres non cliquables : le canal d'entrée n'est pas un filtre de la console."
            >
              {lecture.ok && <BarresCanaux rep={lecture.data} fenetre={fenetre} />}
            </Figure>
          </SectionErreur>
        </div>
        <section
          className="card flex min-w-0 flex-col p-4 sm:p-5 lg:col-span-5"
          data-testid="acquisition-direct"
          aria-labelledby="acquisition-direct-titre"
        >
          <h2 id="acquisition-direct-titre" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Ce que « direct » recouvre
          </h2>
          <ul className="mb-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-soft">
            <li>
              <strong className="font-semibold text-ink">Direct ou référent masqué</strong> : pas de référent reçu : saisie de
              l&apos;adresse, favori, application, ou site d&apos;origine qui retire son adresse (politique{" "}
              <code className="font-mono">Referrer-Policy</code>).
            </li>
            <li>
              <strong className="font-semibold text-ink">Interne</strong> : le référent est le site lui-même (même hôte que la
              page d&apos;entrée).
            </li>
            <li>
              <strong className="font-semibold text-ink">Recherche</strong> et <strong className="font-semibold text-ink">réseaux sociaux</strong> :
              hôte référent reconnu dans une liste de moteurs et de réseaux ; tout autre hôte est un{" "}
              <strong className="font-semibold text-ink">site référent</strong>.
            </li>
            <li>
              <strong className="font-semibold text-ink">Campagnes</strong> : paramètres de campagne (UTM) non captés : l&apos;URL est
              nettoyée par le SDK. Une campagne arrive donc sous le canal de son référent.
            </li>
          </ul>
          <HeroReading>
            Un « direct » élevé ne prouve pas un trafic fidèle : il peut venir de sites qui masquent leur adresse.{" "}
            {f.includeBots ? "Les robots sont inclus : la barre de filtres le demande." : "Les robots sont exclus."}
          </HeroReading>
        </section>
      </div>

      {/* A4 — attend B31 : la lecture ne sélectionne pas la route d'entrée. */}
      <div className="mb-6">
        <Figure
          id="acquisition-entrees"
          titre="Pages d'entrée par canal"
          meta={meta()}
          etat={{ kind: "partiel", raison: "route d'entrée non lue par cette lecture (à créer)" }}
        />
      </div>

      <div className="mb-6">
        <SectionErreur titre="Sites référents">
          <Figure
            id="acquisition-referents"
            titre="Sites référents"
            meta={
              meta(lecture.ok ? `${compte(lecture.data.referrers.length, "hôte affiché", "hôtes affichés")}, ${TOP_REFERENTS} au plus` : undefined)
            }
            etat={!lecture.ok ? { kind: "erreur", titre: "Sites référents" } : undefined}
            lecture="Part calculée sur toutes les sessions lues, pas sur les hôtes affichés ; longueur relative au premier hôte. Non cliquables : le référent n'est pas un filtre de la console."
          >
            {lecture.ok && <BarresReferents rep={lecture.data} dansPhrase={dansPhrase} fenetre={fenetre} />}
          </Figure>
        </SectionErreur>
      </div>

      {/* A6 — attend B31 : la lecture n'a pas d'horodatage par session. */}
      <Figure
        id="acquisition-serie"
        titre="Canaux dans le temps"
        meta={meta()}
        etat={{ kind: "partiel", raison: "série à créer : la lecture actuelle n'a pas d'horodatage (B31)" }}
      />
    </div>
  );
}

/** A2 — trois tuiles, une population (sessions lues) ; puis le plafond, s'il est atteint (S4). */
function RangeeKpi({ rep }: { rep: AcquisitionReport }) {
  const tronques = referentsTronques(rep);
  const horsDirect = partHorsDirect(rep);
  return (
    <div className="mb-6">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          label="Sessions lues"
          valeur={rep.total}
          format="count"
          lecture={`Première vue de chaque session sur la fenêtre ; ${formater("count", PLAFOND_ACQUISITION)} au plus.`}
        />
        <KpiTile
          label="Part hors direct"
          valeur={horsDirect}
          format="pct"
          raisonNull="aucune session lue sur la fenêtre : pas de part à calculer"
          lecture="Ni direct, ni interne : recherche, réseaux sociaux et sites référents."
        />
        {tronques ? (
          // « 20 » serait faux : la lecture n'en renvoie que 20, il peut y en avoir plus.
          <KpiLibelle
            label="Référents externes distincts"
            texte={`≥ ${TOP_REFERENTS}`}
            lecture={`Seuls les ${TOP_REFERENTS} premiers hôtes sont renvoyés par la lecture.`}
          />
        ) : (
          <KpiTile
            label="Référents externes distincts"
            valeur={rep.referrers.length}
            format="count"
            lecture="Hôtes externes distincts (recherche, réseaux sociaux, sites référents)."
          />
        )}
      </div>
      {plafondAtteint(rep.total, PLAFOND_ACQUISITION) && (
        <div className="mt-3" data-testid="acquisition-plafond">
          <EtatSurface etat={{ kind: "partiel", raison: TEXTE_PLAFOND }} />
        </div>
      )}
    </div>
  );
}

/** Le hero : les cinq canaux, zéros compris. Un segment unique par barre : un 0 n'a AUCUNE largeur. */
function BarresCanaux({ rep, fenetre }: { rep: AcquisitionReport; fenetre: string }) {
  const data: RankDatum[] = lignesCanaux(rep).map((l) => {
    const libelle = LIBELLE_CANAL[l.channel];
    return {
      label: libelle,
      value: l.sessions,
      segments: [{ value: l.sessions, color: COULEUR_CANAL[l.channel], label: libelle }],
      display: compteEtPart(l.sessions, rep.total),
      title: `${libelle} : ${formater("count", l.sessions)} sessions, ${formater("pct", l.part)} des sessions lues — ${NON_CLIQUABLE}`,
    };
  });
  return (
    <RankBar
      data={data}
      max={rep.total}
      labelWidth="12rem"
      legende={`Sessions par canal d'entrée (compte · part des sessions lues), ${fenetre} — ${NON_CLIQUABLE}`}
    />
  );
}

/** A5 — les hôtes référents externes, avec leur canal en badge et leur part de TOUTES les sessions. */
function BarresReferents({ rep, dansPhrase, fenetre }: { rep: AcquisitionReport; dansPhrase: string; fenetre: string }) {
  const data: RankDatum[] = rep.referrers.map((r) => ({
    label: r.host,
    value: r.sessions,
    color: COULEUR_CANAL[r.channel],
    display: compteEtPart(r.sessions, rep.total),
    sub: (
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: COULEUR_CANAL[r.channel] }} />
        {LIBELLE_CANAL[r.channel]}
      </span>
    ),
    title: `${r.host} (${LIBELLE_CANAL[r.channel]}) : ${formater("count", r.sessions)} sessions, ${formater(
      "pct",
      partDuTotal(r.sessions, rep.total),
    )} des sessions lues`,
  }));
  return (
    <RankBar
      data={data}
      labelWidth="14rem"
      emptyLabel={`Aucun site référent externe sur ${dansPhrase} (trafic direct ou interne).`}
      legende={`Sites référents (compte · part des sessions lues ; canal), ${fenetre}`}
    />
  );
}
