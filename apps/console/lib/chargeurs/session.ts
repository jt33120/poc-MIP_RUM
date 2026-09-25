// LE CHARGEUR DE LA PAGE D'UNE SESSION (C3) — `app/sessions/[id]/page.tsx`.
//
// LA GARDE AVANT TOUT : une session d'une app hors du périmètre du principal est
// INTROUVABLE, exactement comme une session absente (les distinguer dirait qu'elle
// existe ailleurs) ; un lien qui annonce son app (`?app=`) n'ouvre jamais la
// session d'une autre — l'identifiant de session est émis par le client, une
// erreur forgée peut citer celui d'un autre tenant. La chronologie est lue APRÈS
// la garde, bornée à l'app de la session (V7).
//
// Les Web Vitals situés (F46) ne sont lus que sur leur onglet : la population de
// la route de chaque pire mesure, sous le principal de la page.
import type { Section } from "@mip/console-contract";
import { fenetreDeSession, vitauxDeSession, type VitauxSession } from "../deroule";
import { HISTO_BUCKETS } from "../distribution";
import { filtersOfQuery } from "../filters";
import type { VitalName } from "../fmt-ids";
import { plafondAffichage } from "../perf-domain";
import { sessionMeta, sessionTimeline, vitalHistogram, vitalPercentiles, type HistoRow, type VitalPercentiles } from "../queries";
import { UnsupportedFilterError } from "../query-compiler";
import { authorizedAppsOf, paramReader, parseAnalyticsQuery, type ScopePrincipal } from "../query-contract";
import { sessionARejeu } from "../session-rejeu";
import { lireOnglet } from "../session-detail";
import { section, type Chargeur } from "./commun";

/** Paramètre répété : la première valeur, comme la porte projet du middleware. */
export function premier(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Ce que la page sait de la population d'une pire mesure (§ 5.12.4). */
export type Situation =
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
      histo: Section<HistoRow[]>;
    };

type Population<T> = { refuse: true; code: string } | { refuse: false; lecture: Section<T> };

/**
 * Lecture d'une population : un filtre que la lecture ne porte pas est un REFUS du
 * contrat, rendu avec son code — jamais la page entière en erreur (`lire` le
 * relance, § 3.8). Toute autre panne reste une lecture en échec.
 */
async function lirePopulation<T>(fn: () => Promise<T>): Promise<Population<T>> {
  try {
    return { refuse: false, lecture: await section(fn) };
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
): Promise<[VitalName, Situation][]> {
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
  return Promise.all(
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
}

export const chargerSession = (async (principal, sp, { id }) => {
  const meta = await sessionMeta(id ?? "");
  if (!meta) return { etat: "introuvable" } as const;
  // Scoping : une session d'une app hors périmètre est invisible ; une liste d'apps
  // vide n'ouvre aucune session.
  const authorized = authorizedAppsOf(principal);
  if (authorized !== null && !authorized.includes(meta.app_id)) return { etat: "introuvable" } as const;
  const app = premier(sp.app);
  if (app && app !== "all" && app !== meta.app_id) return { etat: "introuvable" } as const;

  // Chronologie lue APRÈS la garde de périmètre, et bornée à l'app de la session.
  const timeline = await sessionTimeline(meta.session_id, meta.app_id);
  const nowMs = Date.now();
  const { onglet } = lireOnglet(premier(sp.tab));
  const t0 = new Date(meta.started_at).getTime();
  // Seule la présence du rejeu est lue, pour pouvoir dire son absence.
  const vitaux = onglet === "vitals" ? vitauxDeSession(timeline) : null;
  const [rejeuLu, situations] = await Promise.all([
    section(() => sessionARejeu(meta.session_id, meta.app_id)),
    vitaux && vitaux.pires.length > 0
      ? situerPires(vitaux.pires, { app: meta.app_id, principal, debutMs: t0, nowMs })
      : Promise.resolve([] as [VitalName, Situation][]),
  ]);
  return { etat: "ok", meta, timeline, nowMs, rejeuLu, situations } as const;
}) satisfies Chargeur<unknown>;
