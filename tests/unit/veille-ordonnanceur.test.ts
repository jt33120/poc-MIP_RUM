// La veille de l'ordonnanceur — le notifier alerte quand les travaux planifiés se
// taisent (`packages/backend/jobs/veille-ordonnanceur.mjs`). Sans base : la décision
// est pure, la veille et la passe tournent sur un pool factice.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Une fausse alerte au premier tick manqué : un redéploiement du scheduler, un
//     bail tenu par l'instance sortante, des migrations au pré-déploiement en font
//     sauter un sans que rien ne soit cassé. Deux de suite, si.
//   - Une alerte par passe pendant tout l'épisode, au lieu d'une seule.
//   - Une fenêtre jamais refermée au retour du tick, ou refermée pendant un tick
//     encore en cours (rien n'est encore prouvé).
//   - Une cadence inventée : non publiée, la veille suppose celle d'un déploiement
//     sans réglage, et le DIT dans l'alerte.
//   - Une alerte mise en file APRÈS la livraison de la passe : elle attendrait la
//     suivante, 15 min plus tard sur la grille de la base provisoire.
//   - Une veille en échec qui ferait échouer la livraison, ou réveillerait la base
//     à chaque passe de 15 s.
import { describe, expect, it, vi } from "vitest";
import { libelleEtage } from "../../apps/console/lib/chaine-mesure";
import { TICK_DEFAUT_MIN } from "../../packages/backend/jobs/cadence.mjs";
import { creerLivreur } from "../../packages/backend/jobs/livreur.mjs";
import {
  ETAGE_VEILLE,
  MARGE_SILENCE_MIN,
  SEVERITE_VEILLE,
  SQL_ETAT_VEILLE,
  VEILLE_MIN_MS,
  cadenceDuDrapeau,
  creerVeilleOrdonnanceur,
  decisionVeille,
  seuilSilenceMin,
  textesVeille,
} from "../../packages/backend/jobs/veille-ordonnanceur.mjs";
import { createMetrics } from "../../packages/service-kit/metrics.mjs";

const muet = { debug() {}, info() {}, warn() {}, error() {} };
const a = (iso: string) => new Date(iso);
const minutes = (n: number) => n * 60_000;

describe("veille de l'ordonnanceur — la règle", () => {
  it("le seuil est celui du reste de la plateforme : 2 × cadence + 5 min", () => {
    expect(MARGE_SILENCE_MIN).toBe(5);
    expect(seuilSilenceMin(15)).toBe(35);
    expect(seuilSilenceMin(5)).toBe(15);
    expect(seuilSilenceMin(30)).toBe(65);
  });

  it("la cadence publiée n'est retenue que sur la grille du scheduler", () => {
    expect(cadenceDuDrapeau("15")).toBe(15);
    expect(cadenceDuDrapeau(" 5 ")).toBe(5);
    for (const v of [null, undefined, "", "0", "7", "abc", "60"]) expect(cadenceDuDrapeau(v), String(v)).toBeNull();
  });
});

describe("veille de l'ordonnanceur — la décision", () => {
  const maintenant = a("2026-10-01T09:00:00Z");
  const bail = (ilYaMin: number) => ({ expiresAt: new Date(maintenant.getTime() - minutes(ilYaMin)) });
  const base = { maintenant, cadenceMin: 15, ouverte: null };

  it("aucune ligne de bail : rien — un tick jamais abouti n'a pas de début à dater", () => {
    expect(decisionVeille({ ...base, bail: null })).toMatchObject({ action: "rien", raison: "aucun tick abouti en base", silenceMin: null });
  });

  it("une échéance future est un tick en cours : rien, même fenêtre ouverte (rien n'est encore prouvé)", () => {
    const enCours = { expiresAt: new Date(maintenant.getTime() + minutes(9)) };
    expect(decisionVeille({ ...base, bail: enCours })).toMatchObject({ action: "rien", raison: "tick en cours" });
    expect(decisionVeille({ ...base, bail: enCours, ouverte: { id: 1, debut: "x", alerte: 7 } })).toMatchObject({ action: "rien" });
  });

  it("un tick manqué ne suffit pas ; au-delà du seuil, la fenêtre s'ouvre, datée du dernier tick abouti", () => {
    expect(decisionVeille({ ...base, bail: bail(31) })).toMatchObject({ action: "rien", silenceMin: 31, seuilMin: 35 });
    expect(decisionVeille({ ...base, bail: bail(35) })).toMatchObject({ action: "rien" });
    const d = decisionVeille({ ...base, bail: { expiresAt: new Date(maintenant.getTime() - minutes(35) - 1_000) } });
    expect(d).toMatchObject({ action: "ouvrir", silenceMin: 35, seuilMin: 35, cadenceMin: 15, cadencePubliee: true });
    expect(d.dernierTick?.toISOString()).toBe("2026-10-01T08:24:59.000Z");
  });

  it("une alerte par épisode : fenêtre ouverte et alertée, rien ; ouverte sans alerte (passe interrompue), alerter", () => {
    expect(decisionVeille({ ...base, bail: bail(50), ouverte: { id: 3, debut: "x", alerte: 12 } })).toMatchObject({
      action: "rien",
      raison: "épisode en cours",
    });
    expect(decisionVeille({ ...base, bail: bail(50), ouverte: { id: 3, debut: "x", alerte: null } })).toMatchObject({ action: "alerter" });
  });

  it("le tick revenu ferme la fenêtre, datée de lui", () => {
    const d = decisionVeille({ ...base, bail: bail(1), ouverte: { id: 3, debut: "2026-10-01T07:00:00Z", alerte: 12 } });
    expect(d).toMatchObject({ action: "fermer", silenceMin: 1 });
    expect(d.dernierTick?.toISOString()).toBe("2026-10-01T08:59:00.000Z");
  });

  it("cadence non publiée : celle d'un déploiement sans réglage, et c'est dit", () => {
    const d = decisionVeille({ ...base, cadenceMin: null, bail: bail(40) });
    expect(TICK_DEFAUT_MIN).toBe(15);
    expect(d).toMatchObject({ action: "ouvrir", cadenceMin: 15, cadencePubliee: false, seuilMin: 35 });
    expect(textesVeille(d).message).toContain("supposé (cadence non publiée)");
  });

  it("à 5 min (une offre payante) : 15 min de silence suffisent", () => {
    expect(decisionVeille({ ...base, cadenceMin: 5, bail: bail(14) }).action).toBe("rien");
    expect(decisionVeille({ ...base, cadenceMin: 5, bail: bail(16) }).action).toBe("ouvrir");
  });

  it("sur la grille de 15 min, passes 45 s après le tick : l'alerte part au DEUXIÈME tick manqué, pas au premier", () => {
    // Le dernier tick abouti finit à 08:00:20 ; le scheduler s'arrête.
    const bailFige = { expiresAt: a("2026-10-01T08:00:20Z") };
    const passes = ["08:15:45", "08:30:45", "08:45:45", "09:00:45"].map((h) => a(`2026-10-01T${h}Z`));
    let ouverte: { id: number; debut: string; alerte: number | null } | null = null;
    const actions: string[] = [];
    for (const p of passes) {
      const d = decisionVeille({ maintenant: p, bail: bailFige, cadenceMin: 15, ouverte });
      actions.push(d.action);
      if (d.action === "ouvrir") ouverte = { id: 1, debut: bailFige.expiresAt.toISOString(), alerte: 99 };
    }
    expect(actions).toEqual(["rien", "rien", "ouvrir", "rien"]);
    // Le tick revient à 09:15 : la passe de 09:15:45 ferme.
    const retour = decisionVeille({ maintenant: a("2026-10-01T09:15:45Z"), bail: { expiresAt: a("2026-10-01T09:15:18Z") }, cadenceMin: 15, ouverte });
    expect(retour.action).toBe("fermer");
  });
});

describe("veille de l'ordonnanceur — les textes", () => {
  it("bornés comme la table (cause ≤ 120, preuve ≤ 300), dates en UTC, au format des documents", () => {
    const d = decisionVeille({ maintenant: a("2026-10-01T09:00:00Z"), bail: { expiresAt: a("2026-10-01T08:12:00Z") }, cadenceMin: 15, ouverte: null });
    const t = textesVeille(d);
    expect(t.cause.length).toBeLessThanOrEqual(120);
    expect(t.preuve.length).toBeLessThanOrEqual(300);
    expect(t.message).toBe(
      "Travaux planifiés muets : aucun tick abouti depuis 48 min (dernier le 01/10/2026 08:12 UTC, tick de 15 min, seuil 35 min). " +
        "Alertes, SLO, sondes de disponibilité et canari ne sont plus évalués.",
    );
    expect(t.preuve).toContain("seuil 2 × 15 + 5 = 35 min");
    expect(t.preuve).toContain("constaté par le notifier");
  });
});

/** Un pool qui joue la base : l'état lu, puis chaque écriture de la veille, gardée. */
function poolVeille({
  tick = new Date("2026-10-01T08:00:20Z") as Date | null,
  maintenant = new Date("2026-10-01T08:45:45Z"),
  cadence = "15" as string | null,
  ouverte = null as { id: number; debut: string; alerte: number | null } | null,
  insereRien = false,
  erreur = null as null | { code: string; message: string },
} = {}) {
  const requetes: { text: string; values?: unknown[] }[] = [];
  return {
    requetes,
    query: vi.fn(async (q: string | { text: string; values?: unknown[] }) => {
      const r = typeof q === "string" ? { text: q } : q;
      requetes.push(r);
      if (erreur) throw Object.assign(new Error(erreur.message), { code: erreur.code });
      if (r.text === SQL_ETAT_VEILLE) return { rows: [{ maintenant, tick, cadence, ouverte }] };
      if (r.text.startsWith("insert into collecte_fenetre")) return { rows: insereRien ? [] : [{ id: "41" }] };
      if (r.text.startsWith("select id from collecte_fenetre")) return { rows: [{ id: "40" }] };
      if (r.text.includes("sonde_alerter")) return { rows: [{ id: "77" }] };
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe("veille de l'ordonnanceur — sur un pool factice", () => {
  it("silence au-delà du seuil : UNE lecture, la fenêtre de l'étage « ordonnanceur », puis l'alerte critique sans application", async () => {
    const pool = poolVeille();
    const bilan = await creerVeilleOrdonnanceur({ pool: pool as never, log: muet }).veiller();
    expect(bilan).toMatchObject({ action: "ouvrir", fenetre_id: 41, alerte_id: 77, silence_min: 45, seuil_min: 35, cadence_publiee: true });
    expect(pool.requetes.map((r) => r.text.split("\n")[0].slice(0, 40))).toEqual([
      "select now() as maintenant,",
      "insert into collecte_fenetre (portee, et",
      "select sonde_alerter($1, null::text, 'cr",
    ]);
    const [, ouvrir, alerter] = pool.requetes;
    expect(ouvrir.text).toContain(`'*', '${ETAGE_VEILLE}', 'interrompue'`);
    expect(ouvrir.text).toContain("on conflict (portee, etage) where fin is null do nothing");
    expect((ouvrir.values?.[0] as Date).toISOString()).toBe("2026-10-01T08:00:20.000Z");
    expect(SEVERITE_VEILLE).toBe("critical");
    expect(alerter.values?.[0]).toBe("41");
    expect(JSON.parse(String(alerter.values?.[2]))).toMatchObject({ kind: "ordonnanceur_muet", silence_min: 45, seuil_min: 35 });
  });

  it("la fenêtre déjà ouverte par un autre notifier : on reprend la sienne, sonde_alerter n'alertera qu'une fois", async () => {
    const pool = poolVeille({ insereRien: true });
    const bilan = await creerVeilleOrdonnanceur({ pool: pool as never, log: muet }).veiller();
    expect(bilan).toMatchObject({ action: "ouvrir", fenetre_id: 40 });
    expect(pool.requetes[3].values?.[0]).toBe("40");
  });

  it("épisode en cours : la lecture seule, aucune écriture", async () => {
    const pool = poolVeille({ ouverte: { id: 41, debut: "2026-10-01T08:00:20Z", alerte: 77 } });
    expect(await creerVeilleOrdonnanceur({ pool: pool as never, log: muet }).veiller()).toMatchObject({ action: "rien", raison: "épisode en cours" });
    expect(pool.requetes).toHaveLength(1);
  });

  it("le tick revenu : la fenêtre se ferme, datée de lui", async () => {
    const pool = poolVeille({ tick: new Date("2026-10-01T09:15:18Z"), maintenant: new Date("2026-10-01T09:15:45Z"), ouverte: { id: 41, debut: "x", alerte: 77 } });
    const infos: unknown[] = [];
    const bilan = await creerVeilleOrdonnanceur({ pool: pool as never, log: { ...muet, info: (...x: unknown[]) => infos.push(x) } }).veiller();
    expect(bilan).toMatchObject({ action: "fermer", fenetre_id: null });
    expect(pool.requetes[1].text).toMatch(/^update collecte_fenetre\s+set fin = greatest\(\$2::timestamptz/);
    expect(pool.requetes[1].values).toEqual([41, new Date("2026-10-01T09:15:18Z")]);
    expect(infos).toHaveLength(1);
  });

  it("au plus une veille par minute : une passe toutes les 15 s n'interroge la base qu'une fois sur quatre", async () => {
    const pool = poolVeille({ ouverte: { id: 41, debut: "x", alerte: 77 } });
    let t = 0;
    const veille = creerVeilleOrdonnanceur({ pool: pool as never, log: muet, maintenant: () => t });
    const bilans = [];
    for (let k = 0; k < 8; k++) {
      bilans.push(await veille.veiller());
      t += 15_000;
    }
    expect(VEILLE_MIN_MS).toBe(60_000);
    expect(pool.requetes).toHaveLength(2);
    expect(bilans.filter(Boolean)).toHaveLength(2);
  });

  it("un schéma incomplet ou une base injoignable : jamais d'exception, un avertissement, compté", async () => {
    const metrics = createMetrics();
    const avertis: unknown[][] = [];
    const log = { ...muet, warn: (...x: unknown[]) => avertis.push(x) };
    const absent = poolVeille({ erreur: { code: "42P01", message: 'relation "collecte_fenetre" does not exist' } });
    const veille = creerVeilleOrdonnanceur({ pool: absent as never, log, metrics });
    await expect(veille.veiller()).resolves.toMatchObject({ action: "erreur", code: "42P01" });
    expect(String(avertis[0][0])).toMatch(/en attente du schéma/);
    expect(veille.etat()).toMatchObject({ action: "erreur" });
    expect(await metrics.render()).toContain('notifier_scheduler_watch_total{action="erreur"} 1');
  });
});

describe("veille de l'ordonnanceur — dans la passe du notifier", () => {
  /** Le pool d'une passe : la veille voit un tick muet depuis 45 min ; les étapes répondent 0. */
  function poolPasse({ veilleEchoue = false } = {}) {
    const veille = poolVeille();
    const textes: string[] = [];
    return {
      textes,
      query: vi.fn(async (q: string | { text: string; values?: unknown[] }) => {
        const r = typeof q === "string" ? { text: q } : q;
        textes.push(r.text);
        if (r.text === SQL_ETAT_VEILLE && veilleEchoue) throw new Error("connexion coupée");
        if (r.text === SQL_ETAT_VEILLE || r.text.includes("collecte_fenetre") || r.text.includes("sonde_alerter")) return veille.query(q);
        if (r.text.includes("to_regprocedure")) return { rows: [{ present: true }] };
        if (r.text.includes("from alert_delivery where status = 'queued'")) return { rows: [{ en_attente: 0, plus_ancienne_s: null }] };
        return { rows: [{ result: 0 }] };
      }),
      connect: vi.fn(),
    };
  }

  it("la veille passe AVANT la livraison : l'alerte qu'elle met en file part dans la même passe", async () => {
    const pool = poolPasse();
    const ordre: string[] = [];
    const dispatch = vi.fn(async () => {
      ordre.push("dispatch");
      return {};
    });
    const livreur = creerLivreur({ pool: pool as never, log: muet, dispatch, maintenant: () => 0 });
    const bilan = await livreur.passe();
    expect(bilan.ok).toBe(true);
    const iAlerte = pool.textes.findIndex((t) => t.includes("sonde_alerter"));
    const iRoute = pool.textes.findIndex((t) => t.includes("route_error_issue_notifications"));
    expect(iAlerte).toBeGreaterThan(-1);
    expect(iAlerte).toBeLessThan(iRoute);
    expect(dispatch).toHaveBeenCalledTimes(1);
    // /ready la montre, sans qu'elle décide du verdict.
    const e = await livreur.etat();
    expect(e.ok).toBe(true);
    expect(e.veille_ordonnanceur).toMatchObject({ action: "ouvrir", alerte_id: 77 });
  });

  it("une veille en échec ne fait pas échouer la passe : la livraison et le battement ont lieu", async () => {
    const pool = poolPasse({ veilleEchoue: true });
    const bilan = await creerLivreur({ pool: pool as never, log: muet, dispatch: vi.fn(async () => ({})), maintenant: () => 0 }).passe();
    expect(bilan.ok).toBe(true);
    expect(pool.textes.some((t) => t.includes("sonde_battement"))).toBe(true);
  });

  it("veille: false (tests, passage manuel) : la passe ne lit pas le bail du tick", async () => {
    const pool = poolPasse();
    const livreur = creerLivreur({ pool: pool as never, log: muet, dispatch: vi.fn(async () => ({})), veille: false, maintenant: () => 0 });
    await livreur.passe();
    expect(pool.textes).not.toContain(SQL_ETAT_VEILLE);
    expect((await livreur.etat()).veille_ordonnanceur).toBeNull();
  });
});

describe("veille de l'ordonnanceur — à l'écran", () => {
  it("la carte de /admin/health nomme l'étage : « travaux planifiés », les autres tels quels", () => {
    expect(libelleEtage(ETAGE_VEILLE)).toBe("travaux planifiés");
    expect(libelleEtage("silence")).toBe("silence");
  });
});
