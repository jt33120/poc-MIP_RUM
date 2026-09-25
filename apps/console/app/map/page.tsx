// Carte d'expérience (F52, plan § 5.10) — « Quelles pages appellent quels services
// back, et lesquels ralentissent ou échouent ? »
//
// CE QUE L'ÉCRAN REFUSE D'AFFIRMER, ET CE QUE F52 CORRIGE.
//   - Une arête inventée : `mapEdges` joignait le navigateur et le serveur sur le
//     SEUL `trace_id`. Depuis E0, tous les appels d'une page vue partagent la trace
//     de la vue : la jointure faisait le produit cartésien des appels et des
//     réponses, et rattachait la réponse d'un appel à la mauvaise vue. Le jumeau
//     serveur est maintenant l'ENFANT de l'appel (`lib/queries-map.ts`), comme F60
//     l'a fait pour le tracing.
//   - Un lien jeté en silence : au-delà de dix routes par colonne, `layoutGraph`
//     supprimait les arêtes dont une extrémité sortait du top-N. Elles arrivent
//     désormais sur un nœud « Autres routes (N) » (`carteAffichee`, lib/map.ts).
//   - Une page effacée par un vide : la carte vide masquait TOUTE la page, y compris
//     « Pages les plus visitées », qui ne dépend pas du tracing. Chaque section a
//     maintenant son état.
//   - Une pastille verte sans mesure : `apiHealth(_, null)` et `pageHealth(null)`
//     rendent `unknown` (F40) ; la santé est ÉCRITE dans le nœud, pas seulement
//     teintée ; le LCP d'une route sans mesure s'écrit « — », jamais « Bon ».
//   - Un classement par volume déguisé en gravité : « Top talkers » devient
//     « Services classés » (`ImpactTable`, tri gravité / volume, garde n < 30).
//   - Un libellé faux : « Pages d'entrée » ne disait pas l'entrée mais les routes
//     les plus mesurées — « Pages les plus visitées ».
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { DetailPanel, type OngletDetail, type PuceDetail } from "@/components/DetailPanel";
import { ExperienceMap } from "@/components/map/ExperienceMap";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { Figure, TableAlternative } from "@/components/charts/Figure";
import { KpiLibelle } from "@/components/charts/KpiLibelle";
import { KpiTile } from "@/components/charts/KpiTile";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { BandeauEchantillonnage } from "@/components/states/BandeauEchantillonnage";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { classerParGravite, SEUIL_ECHANTILLON_FAIBLE } from "@/lib/impact";
import { type SectionLue } from "@/lib/lecture";
import { chargerMap } from "@/lib/chargeurs/map";
import { chargerEcran } from "@/lib/ecran";
import {
  CAP_COLONNE,
  apiHealth,
  atRisk,
  carteAffichee,
  layoutGraph,
  pageHealth,
  texteRegleSanteApi,
  texteSanteNoeud,
  texteTendance,
  trend,
  type GEdge,
  type GNode,
  type Health,
} from "@/lib/map";
import { bucketStarts, hrefWithQuery, paramReader, type AnalyticsQuery } from "@/lib/query-contract";
import { type MapNodeRow } from "@/lib/queries-map";
import { RATING_CLASS, RATING_LABEL, rating2026 } from "@/lib/rating";
import { grilleIso, libelleSeauComplet, type PointSerie } from "@/lib/series";
import { ecrirePanel, gabaritZoom, lireEtatDeVue, ligneIgnoree } from "@/lib/view-state";

export const dynamic = "force-dynamic";

/** Plafond de `mapNodes` : au-delà, la tuile dit « 40 ou plus », jamais un total faux. */
const PLAFOND_NOEUDS = 40;

/** La population de l'écran, nommée dans chaque méta (S1). */
const POPULATION = "appels instrumentés (spans) de la fenêtre";

// Santé inconnue : pastille CREUSE et neutre, pas une quatrième couleur de verdict.
const DOT: Record<Health, string> = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  unknown: "border border-ink-faint bg-transparent",
};
const LIBELLE_SANTE: Record<Health, string> = {
  good: "sain",
  warn: "à surveiller",
  bad: "dégradé",
  unknown: "inconnu",
};

const LIBELLE_TIER = { front: "navigateur", back: "serveur" } as const;

export default async function ExperienceMapPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  // Le chargeur (`lib/chargeurs/map.ts`) lit le graphe, et la série d'un nœud ouvert.
  const ecran = await chargerEcran(ECRANS.map, chargerMap, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Carte d'expérience" problem={ecran.problem} />;
  const query = ecran.query;
  const lecteur = paramReader(sp);
  const { etat: vue, ignores } = lireEtatDeVue("/map", lecteur);
  const tri = vue.tri ?? "gravite";
  // Cet écran n'ouvre QUE des nœuds : un `panel=session:…` n'est pas lu à moitié,
  // il est ignoré et signalé (§ 3.1).
  const panneau = vue.panel?.type === "noeud" ? vue.panel : null;
  const avertissements = [
    ...ignores,
    ...(vue.panel && vue.panel.type !== "noeud"
      ? [ligneIgnoree("panel", ecrirePanel(vue.panel), "cet écran n'ouvre que des panneaux de nœud")]
      : []),
  ];

  // Chaque section a son sort : une lecture en échec n'efface pas les autres (§ 3.8).
  const { noeuds, aretes, pages, couverture, echantillonnage, serieNoeud } = ecran;

  const lignes = noeuds.ok ? noeuds.data : [];
  const parId = new Map(lignes.map((r) => [`${r.tier}:${r.route}`, r] as const));
  const hrefNoeud = (r: Pick<MapNodeRow, "tier" | "route">) =>
    hrefWithQuery("/map", query, { panel: ecrirePanel({ type: "noeud", cote: r.tier, route: r.route }) });

  const enNoeud = (r: MapNodeRow): GNode => {
    const health = apiHealth(r.error_rate ?? 0, r.latency_p75);
    const dir = trend(r.recent, r.older);
    return {
      id: `${r.tier}:${r.route}`,
      tier: r.tier,
      route: r.route,
      calls: r.calls,
      health,
      dir,
      risk: atRisk(dir, health),
      sante: texteSanteNoeud(r.error_rate, r.latency_p75),
      tendance: texteTendance(r.recent, r.older),
      href: hrefNoeud(r),
    };
  };
  const tous = lignes.map(enNoeud);
  const front = tous.filter((n) => n.tier === "front");
  const back = tous.filter((n) => n.tier === "back");
  const gEdges: GEdge[] = (aretes.ok ? aretes.data : []).map((e) => ({
    from: `front:${e.front_route}`,
    to: `back:${e.back_route}`,
    calls: e.calls,
  }));
  // Les routes au-delà du plafond de colonne ne disparaissent plus : elles se
  // regroupent, et leurs arêtes arrivent sur le nœud d'agrégation.
  const affichee = carteAffichee(front, back, gEdges, CAP_COLONNE);
  const layout = layoutGraph(affichee.front, affichee.back, affichee.edges);
  const masquees = affichee.masquees.front + affichee.masquees.back;

  const aRisque = tous.filter((n) => n.risk);
  const plusSollicite = [...back].sort((a, b) => b.calls - a.calls)[0] ?? null;
  const appelsTotal = tous.reduce((s, n) => s + n.calls, 0);
  // Un seul classement, lu par la table ET par le parcours du panneau (↑ / ↓) :
  // deux ordres différents feraient « suivant » sauter une ligne visible.
  const ordre: "gravite" | "volume" = tri === "volume" ? "volume" : "gravite";
  const classement = classerParGravite(lignes, {
    pilote: (r) => r.latency_p75,
    effectif: (r) => r.calls,
    volume: (r) => r.calls,
    tri: ordre,
  });
  // Couverture du graphe (T1) : part des appels navigateur dont le jumeau serveur
  // a été retrouvé. Sans appel lu, la part n'existe pas — `null`, jamais « 0 % » (V3).
  const partCorrelee =
    couverture.ok && couverture.data.total > 0 ? couverture.data.correlated / couverture.data.total : null;

  const plage = ecran.label;
  const zoom = gabaritZoom(hrefWithQuery("/map", query, { period: null, from: "{from}", to: "{to}" }), sp);

  const meta = (extra?: string) => (
    <>
      {extra && <span>{extra}</span>}
      <span>Population : {POPULATION}</span>
      <span>{plage}</span>
    </>
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Carte d'expérience"
        domain="robot"
        help="experienceMap"
        sub="Quelles pages appellent quels services back, et lesquels ralentissent ou échouent ?"
      />

      {avertissements.length > 0 && (
        <div className="mb-4 space-y-1" data-testid="reglages-ignores">
          {avertissements.map((ligne) => (
            <p key={ligne} role="note" className="text-xs text-ink-soft">
              {ligne}
            </p>
          ))}
        </div>
      )}

      {/* M2 — quatre chiffres clés. */}
      <SectionErreur titre="Chiffres clés">
        {noeuds.ok ? (
          <div className="mb-6 grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile
              label="Routes cartographiées"
              valeur={lignes.length}
              format="count"
              lecture={
                lignes.length >= PLAFOND_NOEUDS
                  ? `40 ou plus : la lecture s'arrête aux ${PLAFOND_NOEUDS} routes les plus actives`
                  : "toutes les routes instrumentées de la fenêtre"
              }
            />
            <KpiTile
              label="Appels front avec service corrélé"
              valeur={partCorrelee}
              format="pct"
              raisonNull={
                couverture.ok ? "aucun appel navigateur instrumenté sur la fenêtre" : "lecture de la couverture en échec"
              }
              couverture={{
                n: couverture.ok ? couverture.data.total : null,
                unite: "appels navigateur",
                faibleSous: SEUIL_ECHANTILLON_FAIBLE,
              }}
              lecture="Part des appels navigateur dont la réponse serveur a été retrouvée (span serveur enfant de l'appel)."
              href={hrefWithQuery("/tracing", query)}
            />
            <KpiTile
              label="Services à risque"
              valeur={aRisque.length}
              format="count"
              lecture="volume en hausse ET santé dégradée ; une santé inconnue n'est pas une dégradation observée"
              href="#services-classes"
            />
            <KpiLibelle
              label="Service le plus sollicité"
              texte={
                plusSollicite ? `${plusSollicite.route} · ${formater("count", plusSollicite.calls)} appels` : null
              }
              raisonNull="aucun appel corrélé : aucune route serveur lue sur la fenêtre"
              href={plusSollicite ? hrefNoeud(plusSollicite) : undefined}
            />
          </div>
        ) : (
          <div className="mb-6">
            <EchecLecture titre="Chiffres clés" />
          </div>
        )}
      </SectionErreur>

      {/* M2b — bandeau d'échantillonnage (S7). */}
      <BandeauEchantillonnage lecture={echantillonnage} />

      {/* M3 — le hero : le graphe pages → services. */}
      <div className="mb-6">
        <SectionErreur titre="Pages → services">
          <Figure
            id="carte-graphe"
            titre="Pages → services"
            meta={meta(
              noeuds.ok
                ? `${formater("count", layout.nodes.length)} nœuds · ${formater("count", layout.edges.length)} liens`
                : undefined,
            )}
            etat={
              !noeuds.ok || !aretes.ok
                ? { kind: "erreur", titre: "Pages → services" }
                : lignes.length === 0
                  ? {
                      kind: "vide",
                      population: "paire page → service corrélée",
                      plage,
                      geste: { libelle: "Voir le tracing", href: hrefWithQuery("/tracing", query) },
                    }
                  : undefined
            }
            alternative={
              lignes.length > 0
                ? {
                    legende: `Liens page → service sur ${plage} : origine, destination, appels.`,
                    colonnes: ["Page (navigateur)", "Service (serveur)", "Appels"],
                    lignes: affichee.edges.map((e) => [
                      libelleNoeud(affichee.front, e.from),
                      libelleNoeud(affichee.back, e.to),
                      formater("count", e.calls),
                    ]),
                  }
                : undefined
            }
            lecture={
              <>
                Colonne gauche = les pages vues du navigateur, colonne droite = les routes serveur ; un ruban relie
                une page à l&apos;exécution serveur de SES appels (span serveur enfant de l&apos;appel), épaisseur =
                volume, couleur et texte du nœud = santé. La carte se remplit quand le tracing front → back émet.
                Santé d&apos;un nœud (règle de la console, sans seuil publié de référence, S6) :{" "}
                <span data-testid="regle-sante">{texteRegleSanteApi()}</span>.
              </>
            }
          >
            {lignes.length > 0 && (
              <div>
                <div className="mb-2 hidden gap-x-6 text-[11px] font-semibold uppercase tracking-wider text-ink-faint sm:flex">
                  <span>Navigateur — pages</span>
                  <span>Serveur — routes backend</span>
                </div>
                {/* À 390 px, le graphe est illisible : la table des liens le REMPLACE,
                    et « Voir le graphe » le rouvre pour qui veut le faire défiler. */}
                <div className="sm:hidden" data-testid="carte-liens">
                  <TableLiens carte={affichee} />
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-ink">
                      Voir le graphe
                    </summary>
                    <div className="mt-2">
                      <ExperienceMap layout={layout} />
                    </div>
                  </details>
                </div>
                <div className="hidden sm:block" data-testid="carte-graphe-svg">
                  <ExperienceMap layout={layout} />
                </div>
                {masquees > 0 && (
                  <p className="mt-2 text-xs text-ink-faint" data-testid="carte-autres">
                    {formater("count", masquees)} route(s) moins actives regroupées dans « Autres routes » (top{" "}
                    {CAP_COLONNE} par colonne détaillés) : leurs liens y arrivent, ils ne sont plus jetés.
                  </p>
                )}
                {aRisque.length > 0 && (
                  <p className="mt-2 text-xs text-ink-soft" data-testid="carte-a-risque">
                    <strong className="font-semibold text-ink">
                      {formater("count", aRisque.length)} route(s) en hausse à surveiller
                    </strong>{" "}
                    — volume qui grimpe et santé déjà dégradée : {aRisque.slice(0, 4).map((n) => n.route).join(", ")}
                    {aRisque.length > 4 && "…"}
                  </p>
                )}
              </div>
            )}
          </Figure>
        </SectionErreur>
      </div>

      {/* M4 — Services classés (gravité par défaut). */}
      <SectionErreur titre="Services classés">
        {noeuds.ok ? (
          <ServicesClasses
            classees={classement.lignes}
            faibles={classement.faibles}
            ordre={ordre}
            query={query}
            hrefNoeud={hrefNoeud}
            appelsTotal={appelsTotal}
            groupes={lignes.length}
          />
        ) : (
          <div className="mb-6">
            <EchecLecture titre="Services classés" />
          </div>
        )}
      </SectionErreur>

      {/* M5 — Pages les plus visitées : elle ne dépend PAS du tracing, elle reste. */}
      <SectionErreur titre="Pages les plus visitées">
        <Figure
          id="pages-visitees"
          titre="Pages les plus visitées"
          meta={<span>Top 12 des routes par sessions mesurées · {plage}</span>}
          etat={
            !pages.ok
              ? { kind: "erreur", titre: "Pages les plus visitées" }
              : pages.data.length === 0
                ? { kind: "vide", population: "route mesurée", plage }
                : undefined
          }
          lecture="Les routes les plus MESURÉES de la fenêtre, pas les pages d'entrée (l'entrée se lit sur Acquisition). Verdict posé sur le LCP p75 ; sans mesure, « — », jamais « Bon »."
        >
          {pages.ok && pages.data.length > 0 && <TablePages pages={pages.data} query={query} />}
        </Figure>
      </SectionErreur>

      {/* M6 — panneau du nœud. */}
      {panneau && (
        <PanneauNoeud
          panneau={panneau}
          ligne={parId.get(`${panneau.cote}:${panneau.route}`) ?? null}
          serie={serieNoeud}
          classes={classement.lignes}
          query={query}
          plage={plage}
          seauSecondes={query.range.bucketSeconds}
          bucketLabel={ecran.bucketLabel}
          zoom={zoom}
          hrefNoeud={hrefNoeud}
        />
      )}
    </div>
  );
}

/** Libellé d'un nœud d'après son identifiant (l'agrégat porte déjà son libellé). */
function libelleNoeud(colonne: GNode[], id: string): string {
  return colonne.find((n) => n.id === id)?.route ?? id;
}

/** La table des liens : ce que le graphe dessine, en lignes cliquables (390 px, M3). */
function TableLiens({ carte }: { carte: ReturnType<typeof carteAffichee> }) {
  if (carte.edges.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-ink-soft">
        Aucun lien page → service : les nœuds sont lus, mais aucune réponse serveur n&apos;a été rattachée à un appel.
      </p>
    );
  }
  return (
    <table className="relative w-full text-sm">
      <caption className="sr-only">Liens page → service, du plus au moins appelé</caption>
      <thead className="bg-panel2">
        <tr>
          <th className="th text-left">Page</th>
          <th className="th text-left">Service</th>
          <th className="th text-right">Appels</th>
        </tr>
      </thead>
      <tbody>
        {carte.edges.map((e) => {
          const page = carte.front.find((n) => n.id === e.from);
          const service = carte.back.find((n) => n.id === e.to);
          return (
            <tr key={`${e.from}|${e.to}`} className="border-t border-line/60">
              <td className="px-2 py-2">
                <Cellule noeud={page} />
              </td>
              <td className="px-2 py-2">
                <Cellule noeud={service} />
              </td>
              <td className="px-2 py-2 text-right font-semibold tabular-nums">{formater("count", e.calls)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Cellule({ noeud }: { noeud: GNode | undefined }) {
  if (!noeud) return <span className="text-ink-soft">—</span>;
  const contenu = (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[noeud.health]}`} aria-hidden="true" />
      <span className="min-w-0 break-all font-mono text-xs">{noeud.route}</span>
    </span>
  );
  if (!noeud.href) return contenu;
  return (
    <Link href={noeud.href} scroll={false} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
      {contenu}
    </Link>
  );
}

/** M4 — le classement par gravité, avec sa bascule de tri et sa garde d'échantillon. */
function ServicesClasses({
  classees,
  faibles,
  ordre,
  query,
  hrefNoeud,
  appelsTotal,
  groupes,
}: {
  classees: MapNodeRow[];
  faibles: number;
  ordre: "gravite" | "volume";
  query: AnalyticsQuery;
  hrefNoeud: (r: { tier: "front" | "back"; route: string }) => string;
  appelsTotal: number;
  groupes: number;
}) {
  const impactLignes: ImpactLigne[] = classees.map((r) => ({
    cle: `${r.tier}:${r.route}`,
    libelle: `${LIBELLE_TIER[r.tier]} ${r.route}`,
    href: hrefNoeud(r),
    description: `${LIBELLE_TIER[r.tier]} ${r.route}, ${formater("count", r.calls)} appels, p75 ${formater("ms", r.latency_p75)}`,
    pilote: r.latency_p75,
    volume: r.calls,
    mesures: [
      { cle: "err", valeur: r.error_rate, affichage: formater("pct", r.error_rate) },
      // La tendance est un TEXTE (« +32 % » ou « — ») : elle ne classe rien et ne
      // porte pas de verdict, donc aucune valeur numérique n'est donnée.
      { cle: "tendance", valeur: null, affichage: texteTendance(r.recent, r.older) ?? "—" },
    ],
    echantillonFaible: r.calls < SEUIL_ECHANTILLON_FAIBLE,
  }));
  const href = (valeur: string) => hrefWithQuery("/map", query, { tri: valeur });

  return (
    <div id="services-classes">
      <ImpactTable
        titre="Services classés"
        tri={ordre}
        triHref={{ gravite: href("gravite"), volume: href("volume"), impact: null, fourni: null }}
        // Aucune p75 « tous appels » n'est servie, et une moyenne de p75 est
        // interdite (V5) : la référence ne porte qu'un volume, et aucune colonne
        // d'écart n'est proposée.
        reference={{ libelle: "Tous les services", valeurs: { volume: formater("count", appelsTotal) } }}
        lignes={impactLignes}
        colonnes={["Taux d'erreur", "Tendance"]}
        unitePilote="ms"
        volumeLibelle="Appels"
        groupes={groupes}
        tronque={groupes >= PLAFOND_NOEUDS}
        notice={`Un nœud = un couple (tier, route) de rum_span sur la fenêtre. Classement par latence p75 ; sous ${SEUIL_ECHANTILLON_FAIBLE} appels, la ligne passe en fin de liste (${formater(
          "count",
          faibles,
        )} concernée(s)). Tendance : moitié récente contre moitié ancienne de la plage, rien sous le seuil anti-bruit.`}
      />
    </div>
  );
}

function TablePages({ pages, query }: { pages: { route: string; sessions: number; lcp_p75: number | null }[]; query: AnalyticsQuery }) {
  return (
    // `relative` : la légende `sr-only` (position absolue) d'un tableau dans un
    // conteneur défilant se placerait sinon par rapport à la PAGE et l'élargirait.
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Routes les plus mesurées : sessions et LCP p75</caption>
        <thead className="bg-panel2">
          <tr>
            <th className="th text-left">Page</th>
            <th className="th text-right">Sessions</th>
            <th className="th text-right">LCP p75</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p, i) => {
            const sante = pageHealth(p.lcp_p75);
            const verdict = p.lcp_p75 == null ? null : rating2026("LCP", p.lcp_p75);
            return (
              <tr key={`${p.route}|${i}`} className="border-t border-line/60">
                <td className="px-4 py-2">
                  <Link
                    href={hrefWithQuery("/pages", query, { route: p.route })}
                    className="inline-flex min-w-0 items-center gap-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[sante]}`}
                      title={p.lcp_p75 == null ? "aucune mesure LCP" : `LCP p75 : ${LIBELLE_SANTE[sante]}`}
                    />
                    <span className="min-w-0 break-all font-mono text-xs">{p.route}</span>
                  </Link>
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{formater("count", p.sessions)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {verdict ? (
                    <span className="inline-flex items-center gap-1">
                      <span className={`rounded border px-1 py-px font-medium ${RATING_CLASS[verdict]}`}>
                        {formater("ms", p.lcp_p75)}
                      </span>
                      <span className="text-[10px] text-ink-soft">{RATING_LABEL[verdict]}</span>
                    </span>
                  ) : (
                    <span className="text-ink-soft">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** M6 — le panneau d'un nœud : ses chiffres, sa série (B37), ses suites. */
function PanneauNoeud({
  panneau,
  ligne,
  serie,
  classes,
  query,
  plage,
  seauSecondes,
  bucketLabel,
  zoom,
  hrefNoeud,
}: {
  panneau: { cote: "front" | "back"; route: string };
  ligne: MapNodeRow | null;
  serie: SectionLue<{ t: string; p75: number | null; appels: number }[]> | null;
  classes: MapNodeRow[];
  query: AnalyticsQuery;
  plage: string;
  seauSecondes: number;
  bucketLabel: string;
  zoom?: string;
  hrefNoeud: (r: { tier: "front" | "back"; route: string }) => string;
}) {
  const fermer = hrefWithQuery("/map", query, { panel: null });
  const index = classes.findIndex((n) => n.tier === panneau.cote && n.route === panneau.route);
  const voisin = (pas: number) => {
    const n = index >= 0 ? classes[index + pas] : undefined;
    return n ? hrefNoeud(n) : null;
  };
  const tracing = hrefWithQuery("/tracing", query, { route: panneau.route });
  const pageRoute = hrefWithQuery("/pages", query, { route: panneau.route });
  const pageHref = panneau.cote === "front" ? pageRoute : tracing;

  if (!ligne) {
    return (
      <DetailPanel
        type="noeud"
        titre={`${LIBELLE_TIER[panneau.cote]} ${panneau.route}`}
        fermerHref={fermer}
        pageHref={pageHref}
      >
        <EtatSurface
          etat={{
            kind: "vide",
            population: "mesure de ce nœud",
            plage,
            geste: { libelle: "Voir le tracing", href: tracing },
          }}
        />
      </DetailPanel>
    );
  }

  const sante = apiHealth(ligne.error_rate ?? 0, ligne.latency_p75);
  const puces: PuceDetail[] = [
    { label: "Côté", valeur: LIBELLE_TIER[panneau.cote] },
    { label: "Appels", valeur: formater("count", ligne.calls) },
    { label: "Latence p75", valeur: formater("ms", ligne.latency_p75) },
    { label: "Taux d'erreur", valeur: formater("pct", ligne.error_rate) },
    { label: "Santé", valeur: LIBELLE_SANTE[sante] },
    { label: "Tendance", valeur: texteTendance(ligne.recent, ligne.older) ?? "non conclue (trop peu d'appels)" },
  ];
  const onglets: OngletDetail[] = [];
  const grille = grilleIso(bucketStarts(query.range));
  const points: PointSerie[] =
    serie?.ok === true ? serie.data.map((p) => ({ t: p.t, p75: p.p75, appels: p.appels })) : [];

  return (
    <DetailPanel
      type="noeud"
      titre={`${LIBELLE_TIER[panneau.cote]} ${panneau.route}`}
      puces={puces}
      fermerHref={fermer}
      pageHref={pageHref}
      precedentHref={voisin(-1)}
      suivantHref={voisin(1)}
      onglets={onglets.length > 0 ? onglets : undefined}
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-soft">
          Plage de l&apos;écran : {plage}. Le panneau n&apos;a pas de fenêtre de temps propre.
        </p>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Latence p75 par seau de {bucketLabel}
          </h3>
          {serie == null || !serie.ok ? (
            <EchecLecture titre="Série du nœud" compact />
          ) : points.every((p) => p.appels === 0) ? (
            <EtatSurface etat={{ kind: "vide", population: "mesure sur ce nœud", plage }} compact />
          ) : (
            // F54 (§ 3.9) : la série avait son nom (`role="img"`) mais pas son
            // alternative — hors d'une `Figure`, rien ne la portait. Mêmes lignes que
            // le dessin : un seau de la grille par ligne, zéros d'appels compris.
            <SectionErreur titre="Série du nœud">
              <ThresholdSeries
                grille={grille}
                points={points}
                series={[
                  { cle: "p75", libelle: "Latence p75", role: "principale", effectifCle: "appels" },
                  { cle: "appels", libelle: "Appels", role: "categorie", categorieIndex: 0, forme: "barres", additive: true },
                ]}
                format="ms"
                faibleSous={5}
                seauSecondes={seauSecondes}
                fuseau="UTC"
                zoomHref={zoom}
                hauteur={180}
                ariaLabel={`Latence p75 et volume d'appels de ${panneau.route} par seau de ${bucketLabel}, ${plage}`}
              />
              <TableAlternative
                alternative={{
                  legende: `Latence p75 et appels de ${panneau.route} par seau de ${bucketLabel} (UTC), ${plage}`,
                  colonnes: ["Seau (UTC)", "Latence p75", "Appels"],
                  lignes: serie.data.map((p) => [
                    libelleSeauComplet(p.t, seauSecondes, "UTC"),
                    formater("ms", p.p75),
                    formater("count", p.appels),
                  ]),
                }}
              />
            </SectionErreur>
          )}
        </section>

        <nav aria-label="Suites" className="flex flex-wrap gap-2 text-xs">
          <Link href={tracing} className="rounded-lg border border-line bg-panel px-2.5 py-1 font-medium text-ink-soft hover:bg-panel2 hover:text-ink">
            Traces lentes de ce service
          </Link>
          {panneau.cote === "front" && (
            <Link href={pageRoute} className="rounded-lg border border-line bg-panel px-2.5 py-1 font-medium text-ink-soft hover:bg-panel2 hover:text-ink">
              Page
            </Link>
          )}
        </nav>
      </div>
    </DetailPanel>
  );
}
