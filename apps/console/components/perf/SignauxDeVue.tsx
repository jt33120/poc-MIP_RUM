// Les quatre sections des signaux de vue de l'écran /pages (SDK web ≥ 0.6, 04/10/2026) :
// engagement, changements d'écran, poids des vues, repères du développeur.
//
// Rendu pur (SSR) : les lectures viennent du chargeur (`lib/chargeurs/pages.ts`,
// `lib/queries-engagement.ts`). Une valeur sous l'effectif requis arrive `null` avec
// ce qui manque (« 7 vues, 13 requises ») : elle s'écrit « — » et la raison suit,
// jamais 0. Une section sans aucune mesure le dit, avec la version du SDK qui les émet.
import type { ReactNode } from "react";
import { TableDefilante } from "@/components/TableDefilante";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture } from "@/components/states/SectionErreur";
import { formater } from "@/lib/fmt-ids";
import type { SectionLue } from "@/lib/lecture";
import { noteAffichee, texteNote } from "@/lib/notes-mip";
import type { ChargementSpaRoute, EngagementRoute, ParRoute, PoidsVueRoute, Reperes } from "@/lib/queries-engagement";
import { texteSeuilsMip } from "@/lib/seuils";
import { LIBELLE_SOURCE_REPERE, SENS_VALEUR_REPERE, SEUIL_DEFILEMENT_PROFOND, TEXTE_SANS_SIGNAL_VUE } from "@/lib/signaux-vue";
import { SOURCE_DEFILEMENT, SOURCE_POIDS_VUE, SOURCE_REPERES, SOURCE_SPA_LOAD, SOURCE_TEMPS_PASSE } from "./sources";

const CATEGORIE = "Navigateur · SDK web ≥ 0.6";
const pct100 = (v: number | null) => (v == null ? null : v / 100);
const joindre = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(" · ");

/** Une section de l'écran : titre, ancre du sommaire, repère de test. */
function Bloc({ id, titre, children }: { id: string; titre: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="mb-4 min-w-0 scroll-mt-4" data-testid={id}>
      <h2 id={`${id}-titre`} className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        {titre}
      </h2>
      {children}
    </section>
  );
}

/** Aucune mesure sur la fenêtre : la phrase dit aussi d'où elles viennent. */
function Vide({ id, population, plage }: { id: string; population: string; plage: string }) {
  return (
    <div className="card px-4 py-3" data-testid={`${id}-vide`}>
      <EtatSurface etat={{ kind: "vide", population, plage, borne: TEXTE_SANS_SIGNAL_VUE }} enLigne />
    </div>
  );
}

/** Les lignes classées : valeur décroissante, valeurs non calculées en dernier, puis volume. */
function classer<L>(lignes: L[], valeur: (l: L) => number | null, volume: (l: L) => number): L[] {
  return [...lignes].sort((a, b) => {
    const va = valeur(a);
    const vb = valeur(b);
    if (va == null && vb == null) return volume(b) - volume(a);
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va || volume(b) - volume(a);
  });
}

/** Ce que porte l'en-tête d'un classement : combien de routes, la plage, l'effectif requis. */
function metaRoutes(lu: ParRoute<unknown>, plage: string, unite: string, extra?: string): ReactNode {
  return (
    <>
      <span>
        {formater("count", lu.routes.length)} routes{lu.tronque ? ` sur ${formater("count", lu.routesTotal)}` : ""}
      </span>
      {extra && <span>{extra}</span>}
      <span>{plage}</span>
      <span>
        sous {lu.requis} {unite} : non calculé
      </span>
    </>
  );
}

// ─────────────────────────────────── Engagement ───────────────────────────────────

export function SectionEngagement({
  lecture,
  plage,
  lienRoute,
}: {
  lecture: SectionLue<ParRoute<EngagementRoute>>;
  plage: string;
  /** Le clic sur une route ouvre son panneau. */
  lienRoute?: (route: string) => string;
}) {
  const id = "engagement";
  if (!lecture.ok) {
    return (
      <Bloc id={id} titre="Engagement">
        <EchecLecture titre="Engagement" />
      </Bloc>
    );
  }
  const lu = lecture.data;
  const e = lu.ensemble;
  if (e.vues === 0 && e.defilement_n === 0) {
    return (
      <Bloc id={id} titre="Engagement">
        <Vide id={id} population="mesure de temps passé ni de défilement" plage={plage} />
      </Bloc>
    );
  }
  const routes = classer(lu.routes, (r) => r.temps_p50_ms, (r) => r.vues);
  const data: RankDatum[] = routes.map((r) => ({
    label: r.route ?? "(sans route)",
    href: r.route && lienRoute ? lienRoute(r.route) : undefined,
    value: r.temps_p50_ms,
    display: formater("s-auto", r.temps_p50_ms),
    sub: joindre([
      `${formater("count", r.vues)} vues`,
      r.manque ?? `p75 ${formater("s-auto", r.temps_p75_ms)}`,
      r.defilement_p50_pct != null && `défilement p50 ${formater("pct", pct100(r.defilement_p50_pct))}`,
      r.part_defilement_profond != null &&
        `≥ ${SEUIL_DEFILEMENT_PROFOND} % : ${formater("pct", r.part_defilement_profond)}`,
    ]),
    title: joindre([
      r.route,
      `temps passé p50 ${formater("s-auto", r.temps_p50_ms)}, p75 ${formater("s-auto", r.temps_p75_ms)}`,
      r.manque,
      `${formater("count", r.defilement_n)} vues avec défilement`,
      r.manque_defilement,
    ]),
  }));
  return (
    <Bloc id={id} titre="Engagement">
      <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <div data-testid="engagement-temps">
          <KpiTile
            label="Temps passé p50"
            valeur={e.temps_p50_ms}
            format="s-auto"
            raisonNull={e.manque ?? "aucune mesure"}
            sensMeilleur="neutre"
            couverture={{ n: e.vues, unite: "vues" }}
            lecture={`p75 ${formater("s-auto", e.temps_p75_ms)}`}
            source={SOURCE_TEMPS_PASSE}
            categorie={CATEGORIE}
          />
        </div>
        <div data-testid="engagement-defilement">
          <KpiTile
            label="Défilement p50"
            valeur={pct100(e.defilement_p50_pct)}
            format="pct"
            raisonNull={e.manque_defilement ?? "aucune mesure"}
            sensMeilleur="neutre"
            couverture={{ n: e.defilement_n, unite: "vues" }}
            source={SOURCE_DEFILEMENT}
            categorie={CATEGORIE}
          />
        </div>
        <div data-testid="engagement-profond">
          <KpiTile
            label={`Vues défilées à ${SEUIL_DEFILEMENT_PROFOND} % ou plus`}
            libelleCase={`Défilées ≥ ${SEUIL_DEFILEMENT_PROFOND} %`}
            valeur={e.part_defilement_profond}
            format="pct"
            raisonNull={e.manque_defilement ?? "aucune mesure"}
            sensMeilleur="neutre"
            couverture={{ n: e.defilement_n, unite: "vues" }}
            source={SOURCE_DEFILEMENT}
            categorie={CATEGORIE}
          />
        </div>
      </div>
      <Figure
        titre="Temps passé par route"
        id="engagement-routes"
        meta={metaRoutes(lu, plage, "vues", "p50 du temps visible")}
        lecture={`${SOURCE_TEMPS_PASSE} ${SOURCE_DEFILEMENT}`}
        alternative={{
          legende: `Temps passé et défilement par route sur ${plage}`,
          colonnes: ["Route", "Vues", "Temps p50", "Temps p75", "Défilement p50", `Part ≥ ${SEUIL_DEFILEMENT_PROFOND} %`],
          lignes: routes.map((r) => [
            r.route,
            r.vues,
            formater("s-auto", r.temps_p50_ms),
            formater("s-auto", r.temps_p75_ms),
            formater("pct", pct100(r.defilement_p50_pct)),
            formater("pct", r.part_defilement_profond),
          ]),
        }}
      >
        <RankBar data={data} labelWidth="10rem" alternative={false} legende="Temps passé p50 par route" />
      </Figure>
    </Bloc>
  );
}

// ─────────────────────────────── Changements d'écran ───────────────────────────────

export function SectionChangementsEcran({
  lecture,
  plage,
  lienRoute,
}: {
  lecture: SectionLue<ParRoute<ChargementSpaRoute>>;
  plage: string;
  lienRoute?: (route: string) => string;
}) {
  const id = "changements-ecran";
  const titre = "Changements d'écran";
  if (!lecture.ok) {
    return (
      <Bloc id={id} titre={titre}>
        <EchecLecture titre={titre} />
      </Bloc>
    );
  }
  const lu = lecture.data;
  const e = lu.ensemble;
  if (e.n === 0) {
    return (
      <Bloc id={id} titre={titre}>
        <Vide id={id} population="mesure de changement d'écran" plage={plage} />
      </Bloc>
    );
  }
  const routes = classer(lu.routes, (r) => r.p75_ms, (r) => r.n);
  const data: RankDatum[] = routes.map((r) => {
    const note = noteAffichee("SPA_LOAD", r.p75_ms);
    return {
      label: r.route ?? "(sans route)",
      href: r.route && lienRoute ? lienRoute(r.route) : undefined,
      value: r.p75_ms,
      display: <span data-note={note?.note ?? ""}>{texteNote(note, formater("ms", r.p75_ms))}</span>,
      color: note?.jeton,
      sub: joindre([`n = ${formater("count", r.n)}`, r.manque ?? `p50 ${formater("ms", r.p50_ms)}`]),
      title: joindre([
        r.route,
        `p75 ${formater("ms", r.p75_ms)}${note ? ` (${note.libelle}, ${note.regle})` : ""}`,
        `${formater("count", r.n)} changements d'écran`,
        r.manque,
      ]),
    };
  });
  return (
    <Bloc id={id} titre={titre}>
      <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <div data-testid="spa-p75">
          <KpiTile
            label="Changement d'écran p75"
            valeur={e.p75_ms}
            format="ms"
            raisonNull={e.manque ?? "aucune mesure"}
            sensMeilleur="bas"
            couverture={{ n: e.n, unite: "changements d'écran" }}
            lecture={`p50 ${formater("ms", e.p50_ms)}`}
            noteMip={{ mesure: "SPA_LOAD", valeur: e.p75_ms, texte: `p75 ${formater("ms", e.p75_ms)}` }}
            source={SOURCE_SPA_LOAD}
            categorie={CATEGORIE}
          />
        </div>
        <div data-testid="spa-nombre">
          <KpiTile
            label="Changements d'écran mesurés"
            libelleCase="Changements mesurés"
            valeur={e.n}
            format="count"
            sensMeilleur="neutre"
            source={SOURCE_SPA_LOAD}
            categorie={CATEGORIE}
          />
        </div>
      </div>
      <Figure
        titre="Changements d'écran par route d'arrivée"
        id="changements-ecran-routes"
        meta={metaRoutes(lu, plage, "changements", `p75 · ${texteSeuilsMip("SPA_LOAD")}`)}
        lecture={SOURCE_SPA_LOAD}
        alternative={{
          legende: `Changements d'écran SPA par route d'arrivée sur ${plage}`,
          colonnes: ["Route", "Changements", "p50", "p75", "Note"],
          lignes: routes.map((r) => [
            r.route,
            r.n,
            formater("ms", r.p50_ms),
            formater("ms", r.p75_ms),
            noteAffichee("SPA_LOAD", r.p75_ms)?.libelle ?? r.manque,
          ]),
        }}
      >
        <RankBar data={data} labelWidth="10rem" alternative={false} legende="Changement d'écran p75 par route" />
      </Figure>
    </Bloc>
  );
}

// ─────────────────────────────────── Poids des vues ───────────────────────────────────

export function SectionPoidsVues({
  lecture,
  plage,
  lienRoute,
}: {
  lecture: SectionLue<ParRoute<PoidsVueRoute>>;
  plage: string;
  lienRoute?: (route: string) => string;
}) {
  const id = "poids-vues";
  const titre = "Poids des vues";
  if (!lecture.ok) {
    return (
      <Bloc id={id} titre={titre}>
        <EchecLecture titre={titre} />
      </Bloc>
    );
  }
  const lu = lecture.data;
  const e = lu.ensemble;
  if (e.vues === 0 && e.octets_n === 0) {
    return (
      <Bloc id={id} titre={titre}>
        <Vide id={id} population="mesure du poids des vues" plage={plage} />
      </Bloc>
    );
  }
  const routes = classer(lu.routes, (r) => r.octets_p75, (r) => r.vues);
  const data: RankDatum[] = routes.map((r) => ({
    label: r.route ?? "(sans route)",
    href: r.route && lienRoute ? lienRoute(r.route) : undefined,
    value: r.octets_p75,
    display: formater("bytes", r.octets_p75),
    sub: joindre([
      `${formater("count", r.vues)} vues`,
      r.manque ?? `${formater("count", r.ressources_p50)} ressources p50`,
    ]),
    title: joindre([
      r.route,
      `octets par vue p75 ${formater("bytes", r.octets_p75)}`,
      `ressources par vue p50 ${formater("count", r.ressources_p50)}`,
      r.manque_octets,
    ]),
  }));
  return (
    <Bloc id={id} titre={titre}>
      <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <div data-testid="poids-ressources">
          <KpiTile
            label="Ressources par vue p50"
            valeur={e.ressources_p50}
            format="count"
            raisonNull={e.manque ?? "aucune mesure"}
            sensMeilleur="neutre"
            couverture={{ n: e.vues, unite: "vues" }}
            source={SOURCE_POIDS_VUE}
            categorie={CATEGORIE}
          />
        </div>
        <div data-testid="poids-octets">
          <KpiTile
            label="Octets par vue p75"
            valeur={e.octets_p75}
            format="bytes"
            raisonNull={e.manque_octets ?? "aucune mesure"}
            sensMeilleur="bas"
            couverture={{ n: e.octets_n, unite: "vues" }}
            source={SOURCE_POIDS_VUE}
            categorie={CATEGORIE}
          />
        </div>
      </div>
      <Figure
        titre="Poids des vues par route"
        id="poids-vues-routes"
        meta={metaRoutes(lu, plage, "vues", "octets transférés par vue, p75")}
        lecture={SOURCE_POIDS_VUE}
        alternative={{
          legende: `Ressources et octets transférés par vue, par route, sur ${plage}`,
          colonnes: ["Route", "Vues", "Ressources p50", "Octets p75"],
          lignes: routes.map((r) => [r.route, r.vues, formater("count", r.ressources_p50), formater("bytes", r.octets_p75)]),
        }}
      >
        <RankBar data={data} labelWidth="10rem" alternative={false} legende="Octets transférés par vue, p75, par route" />
      </Figure>
    </Bloc>
  );
}

// ─────────────────────────────── Repères du développeur ───────────────────────────────

export function SectionReperes({ lecture, plage }: { lecture: SectionLue<Reperes>; plage: string }) {
  const id = "reperes";
  const titre = "Repères du développeur";
  if (!lecture.ok) {
    return (
      <Bloc id={id} titre={titre}>
        <EchecLecture titre={titre} />
      </Bloc>
    );
  }
  const lu = lecture.data;
  if (lu.reperes.length === 0) {
    return (
      <Bloc id={id} titre={titre}>
        <Vide id={id} population="mesure de repère (performance.mark, performance.measure, addTiming)" plage={plage} />
      </Bloc>
    );
  }
  return (
    <Bloc id={id} titre={titre}>
      <p className="mb-1 flex flex-wrap gap-x-3 text-[11px] text-ink-faint" data-testid="reperes-meta">
        <span>
          {formater("count", lu.reperes.length)} noms{lu.tronque ? ` sur ${formater("count", lu.total)}` : ""}
        </span>
        <span>{plage}</span>
        <span>sous {lu.requis} mesures : non calculé</span>
        <span title={SOURCE_REPERES}>mark : instant depuis le début de la vue · measure : durée</span>
      </p>
      <TableDefilante className="card" testId="reperes-table" label="Repères du développeur">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Repères du développeur par nom sur {plage} : source, nombre de mesures, p50 et p75 en millisecondes
          </caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th px-3 text-left text-ink-soft">
                Nom
              </th>
              <th scope="col" className="th px-3 text-left text-ink-soft">
                Source
              </th>
              <th scope="col" className="th px-3 text-right text-ink-soft">
                Mesures
              </th>
              <th scope="col" className="th px-3 text-right text-ink-soft">
                p50
              </th>
              <th scope="col" className="th px-3 text-right text-ink-soft">
                p75
              </th>
            </tr>
          </thead>
          <tbody>
            {lu.reperes.map((r) => (
              <tr key={r.nom} className="border-t border-line/60" data-testid="repere-ligne" data-nom={r.nom} data-source={r.source}>
                <th scope="row" className="max-w-[16rem] px-3 py-1.5 text-left font-mono text-xs font-medium text-ink [overflow-wrap:anywhere]">
                  {r.nom}
                </th>
                <td className="px-3 py-1.5 text-xs text-ink-soft" title={SENS_VALEUR_REPERE[r.source]}>
                  {LIBELLE_SOURCE_REPERE[r.source]}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formater("count", r.n)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums" title={r.manque ?? undefined}>
                  {formater("ms", r.p50_ms)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums" title={r.manque ?? undefined}>
                  {formater("ms", r.p75_ms)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableDefilante>
    </Bloc>
  );
}
