// LECTURES DES DÉTECTIONS HORAIRES (migration-v101, refonte du monitoring, vague 3).
//
// Deux tables écrites par le travail `detections_horaires` du scheduler :
// `signal_detecte` (les constats) et `vital_horaire` (les p75 horaires). La console
// ne CALCULE rien ici de lourd : elle lit des agrégats, et la bande attendue se
// déduit des mêmes agrégats par la même logique pure que le scheduler
// (`@mip/backend/shared/plage-habituelle.mjs`) — une seule définition de
// « habituel ».
//
// TABLE ABSENTE (42P01) : la console peut être déployée avant que le scheduler
// n'applique v101. La lecture rend alors `{ etat: "absent" }`, un état vide
// propre, et non une erreur de section.
import {
  bandeAttendue,
  choisirReference,
  entiteSerie,
  evaluerHeure,
  instantsReference,
  MESURES_MIN_HEURE,
  transformer,
} from "@mip/backend/shared/plage-habituelle.mjs";
import { q } from "./db";
import { binder, compileScope } from "./query-compiler";
import type { AnalyticsQuery } from "./query-contract";

const HEURE_MS = 3_600_000;
/** Au-delà, la série est rendue sans bande (la lecture des références grandirait avec la plage). */
export const PLAGE_BANDE_MAX_MS = 14 * 24 * HEURE_MS;
/** Au-delà, la série est tronquée aux heures les plus récentes. */
export const HEURES_SERIE_MAX = 31 * 24;

/** Vrai pour « relation inexistante » : la migration v101 n'est pas encore appliquée. */
export function estTableAbsente(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "42P01";
}

export type DetecteurConstat = "plage" | "rupture" | "release" | "surrep" | "segment_lent" | "prevision" | "erreur" | "trafic";

/** Un constat, tel que la console le lit (dates en ISO UTC : ce qui traverse JSON). */
export interface Constat {
  id: number;
  appId: string;
  detecteur: DetecteurConstat;
  /** « vital:LCP » ou « vital:LCP|route:/checkout ». */
  entite: string;
  debut: string;
  /** `null` : épisode en cours. */
  fin: string | null;
  statut: "ouvert" | "clos";
  /** impact × ampleur × confiance, dans [0 ; 1] (A2 § 7.6). */
  priorite: number;
  /** Le fait chiffré, rédigé par règles au calcul (jamais par un modèle de langage). */
  phrase: string | null;
  methode: Record<string, unknown>;
  preuves: Record<string, unknown>;
  impact: Record<string, unknown>;
}

export type LectureConstats = { etat: "absent" } | { etat: "ok"; constats: Constat[] };

interface LigneConstat {
  id: string | number;
  app_id: string;
  detecteur: DetecteurConstat;
  entite: string;
  debut: Date | string;
  fin: Date | string | null;
  statut: "ouvert" | "clos";
  priorite: number;
  methode: Record<string, unknown>;
  preuves: Record<string, unknown>;
  impact: Record<string, unknown>;
}

const enIso = (d: Date | string) => new Date(d).toISOString();

/**
 * Les constats de la PÉRIODE : ceux dont l'intervalle la recoupe, masqués exclus,
 * triés par priorité décroissante (puis le plus récent d'abord). Périmètre : les
 * apps effectives de la requête commune.
 */
export async function constatsDeLaPeriode(query: AnalyticsQuery, limite = 20): Promise<LectureConstats> {
  const { params, bind } = binder();
  const de = bind(query.range.from);
  const a = bind(query.range.to);
  try {
    const lignes = await q<LigneConstat>(
      `select s.id, s.app_id, s.detecteur, s.entite, s.debut, s.fin, s.statut, s.priorite,
              s.methode, s.preuves, s.impact
         from signal_detecte s
        where s.statut <> 'masque'
          and s.debut < ${a}::timestamptz
          and coalesce(s.fin, 'infinity'::timestamptz) > ${de}::timestamptz${compileScope(query, "s.app_id", bind)}
        order by s.priorite desc, s.debut desc
        limit ${Math.max(1, Math.min(100, Math.trunc(limite)))}`,
      params,
    );
    return {
      etat: "ok",
      constats: lignes.map((l) => ({
        id: Number(l.id),
        appId: l.app_id,
        detecteur: l.detecteur,
        entite: l.entite,
        debut: enIso(l.debut),
        fin: l.fin == null ? null : enIso(l.fin),
        statut: l.statut,
        priorite: Number(l.priorite),
        phrase: typeof l.preuves?.phrase === "string" ? l.preuves.phrase : null,
        methode: l.methode,
        preuves: l.preuves,
        impact: l.impact,
      })),
    };
  } catch (err) {
    if (estTableAbsente(err)) return { etat: "absent" };
    throw err;
  }
}

/** La bande attendue d'une heure : la plage habituelle, et le niveau de repli retenu. */
export interface Attendu {
  mediane: number;
  bas: number;
  haut: number;
  niveau: "hebdomadaire" | "quotidien" | "48h";
  legende: string;
}

export interface PointVitalHoraire {
  /** Début de l'heure, ISO UTC. */
  heure: string;
  n: number;
  /** `null` : aucune mesure, ou heure creuse sans p75 lue. Jamais 0 pour un manque. */
  p75: number | null;
  p75Bas: number | null;
  p75Haut: number | null;
  /** `null` : historique insuffisant pour une plage (aucune bande « en attendant »). */
  attendu: Attendu | null;
  /** Écart robuste à la plage (n ≥ 13 et plage disponible), sinon `null`. */
  z: number | null;
}

export type LectureVitalHoraire =
  | { etat: "absent" }
  | { etat: "une_app_requise" }
  | {
      etat: "ok";
      app: string;
      vital: string;
      route: string;
      points: PointVitalHoraire[];
      /** Faux au-delà de 14 jours : la série est rendue, la bande non. */
      bande: boolean;
    };

interface LigneHoraire {
  hour: Date | string;
  n: number;
  p75: number | null;
  p75_bas: number | null;
  p75_haut: number | null;
}

/** L'app de la série : celle demandée, ou la seule du périmètre. Une p75 ne se moyenne pas entre apps. */
export function appDeLaSerie(query: AnalyticsQuery): string | null {
  if (query.scope.requestedApp) return query.scope.requestedApp;
  const apps = query.scope.effectiveApps;
  return apps && apps.length === 1 ? apps[0] : null;
}

/**
 * La série horaire d'une p75 (une app, un vital, une route — '' = toutes) sur la
 * période, avec la bande attendue de chaque heure. La bande se calcule sur les
 * heures de référence lues dans `vital_horaire` (même créneau des semaines
 * passées, repli quotidien puis 48 h), hors épisodes passés — exactement comme
 * le scheduler.
 */
export async function serieVitalHoraire(query: AnalyticsQuery, vital: string, route = ""): Promise<LectureVitalHoraire> {
  const app = appDeLaSerie(query);
  if (!app) return { etat: "une_app_requise" };
  const debut = Math.ceil(Date.parse(query.range.from) / HEURE_MS) * HEURE_MS;
  const fin = Date.parse(query.range.to);
  const heures: number[] = [];
  for (let h = Math.max(debut, fin - HEURES_SERIE_MAX * HEURE_MS); h + HEURE_MS <= fin; h += HEURE_MS) heures.push(h);
  const bande = fin - debut <= PLAGE_BANDE_MAX_MS;
  const instants = new Set(heures);
  if (bande) for (const h of heures) for (const l of Object.values(instantsReference(h))) for (const ms of l) instants.add(ms);

  try {
    const [lignes, episodes] = await Promise.all([
      q<LigneHoraire>(
        `select hour, n, p75, p75_bas, p75_haut from vital_horaire
          where app_id = $1 and route = $2 and name = $3 and hour = any($4::timestamptz[])`,
        [app, route, vital, [...instants].map((ms) => new Date(ms).toISOString())],
      ),
      q<{ debut: Date | string; fin: Date | string | null }>(
        `select debut, fin from signal_detecte
          where app_id = $1 and detecteur = 'plage' and entite = $2`,
        [app, entiteSerie(vital, route)],
      ),
    ]);
    const parHeure = new Map(lignes.map((l) => [new Date(l.hour).getTime(), l]));
    const passes = episodes.map((e) => ({ de: new Date(e.debut).getTime(), a: e.fin == null ? Infinity : new Date(e.fin).getTime() }));
    const valeurA = (ms: number): number | null => {
      const l = parHeure.get(ms);
      if (!l || Number(l.n) < MESURES_MIN_HEURE || l.p75 == null) return null;
      if (passes.some((p) => ms >= p.de && ms < p.a)) return null;
      return transformer(vital, Number(l.p75));
    };
    const points = heures.map((h): PointVitalHoraire => {
      const l = parHeure.get(h);
      const n = l ? Number(l.n) : 0;
      const p75 = l?.p75 == null ? null : Number(l.p75);
      const p75Bas = l?.p75_bas == null ? null : Number(l.p75_bas);
      const p75Haut = l?.p75_haut == null ? null : Number(l.p75_haut);
      const ref = bande ? choisirReference(h, valeurA) : null;
      let attendu: Attendu | null = null;
      let z: number | null = null;
      if (ref) {
        const niveau = ref.niveau as Attendu["niveau"];
        const e = p75 != null && n >= MESURES_MIN_HEURE ? evaluerHeure({ nom: vital, p75, p75Bas, p75Haut }, ref.valeurs) : null;
        if (e) {
          attendu = { mediane: e.mediane, bas: e.bas, haut: e.haut, niveau, legende: ref.legende };
          z = Math.round(e.z * 100) / 100;
        } else {
          const b = bandeAttendue(vital, ref.valeurs);
          if (b) attendu = { ...b, niveau, legende: ref.legende };
        }
      }
      return { heure: new Date(h).toISOString(), n, p75, p75Bas, p75Haut, attendu, z };
    });
    return { etat: "ok", app, vital, route, points, bande };
  } catch (err) {
    if (estTableAbsente(err)) return { etat: "absent" };
    throw err;
  }
}
