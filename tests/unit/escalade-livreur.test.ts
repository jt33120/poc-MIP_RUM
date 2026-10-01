// L'escalade (migration-v108) côté scheduler et livreur, sans base.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Qu'un envoi d'escalade parte sans dire ce qu'il est : le texte porte « Niveau n »
//     ou « Relance n / niveau n », la charge porte `escalation` ;
//   - qu'un envoi en file parte APRÈS l'acquittement : soldé `skipped`, sans tentative ;
//   - que le livreur, déployé avant sa migration, échoue sur une colonne absente : il
//     lit niveau et rang par `to_jsonb(d)` ;
//   - que le tick appelle une fonction que sa migration n'a pas encore créée.
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { dispatchOnce, payloadOf, selectionSql, texteEscalade } from "../../packages/backend/lib/dispatch-alerts.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { DELAIS_ETAPES_MS, MARGE_CLIENT_MS, travaux } from "../../packages/backend/jobs/planifie.mjs";

const muet = { info: () => {}, warn: () => {}, error: () => {} };

describe("le texte d'un envoi d'escalade", () => {
  it("« Niveau n » au premier envoi, « Relance n / niveau n » ensuite, après le préfixe", () => {
    expect(texteEscalade("[MIP RUM] LCP > 3200.0 (seuil 2500) — app demo", 1, 0)).toBe(
      "[MIP RUM] Niveau 1, non acquittée — LCP > 3200.0 (seuil 2500) — app demo",
    );
    expect(texteEscalade("[MIP RUM] SLO « Paiement » en burn rapide", 3, 2)).toBe(
      "[MIP RUM] Relance 2 / niveau 3, non acquittée — SLO « Paiement » en burn rapide",
    );
    // Un texte sans préfixe (charge d'issue ancienne) le reçoit.
    expect(texteEscalade("nouvelle issue", 2, 0)).toBe("[MIP RUM] Niveau 2, non acquittée — nouvelle issue");
  });

  it("la charge garde son corps, marque son texte et dit niveau et rang ; un envoi nominal est inchangé", () => {
    const regle = { metric: "LCP", app_id: "demo", route: null, value: 3200, threshold: 2500, window_minutes: 15, comparator: ">" };
    const nominal = payloadOf(regle);
    expect(nominal).not.toHaveProperty("escalation");
    expect(nominal.text).toBe("[MIP RUM] LCP > 3200.0 (seuil 2500) — app demo");
    const escalade = payloadOf({ ...regle, escalation_level: 2, escalation_relance: 1 });
    expect(escalade).toMatchObject({ source: "mip-rum", metric: "LCP", value: 3200, escalation: { level: 2, relance: 1 } });
    expect(escalade.text).toBe("[MIP RUM] Relance 1 / niveau 2, non acquittée — LCP > 3200.0 (seuil 2500) — app demo");
    // Une notification d'issue figée par l'outbox : son corps, marqué.
    const issue = payloadOf({ notification: { source: "mip-rum", kind: "new_issue", text: "[MIP RUM] nouvelle issue" }, escalation_level: 1 });
    expect(issue).toEqual({ source: "mip-rum", kind: "new_issue", text: "[MIP RUM] Niveau 1, non acquittée — nouvelle issue", escalation: { level: 1, relance: 0 } });
  });

  it("la sélection lit niveau, rang et acquittement — par to_jsonb, jamais par la colonne", () => {
    for (const v73 of [true, false]) {
      const sql = selectionSql(v73);
      expect(sql).toContain("(to_jsonb(d)->>'escalation_level')::int as escalation_level");
      expect(sql).toContain("(to_jsonb(d)->>'escalation_relance')::int as escalation_relance");
      expect(sql).toContain("e.acknowledged");
      expect(sql).not.toMatch(/\bd\.escalation_level\b/);
    }
  });
});

describe("le livreur et l'acquittement", () => {
  function poolAvec(lignes: Record<string, unknown>[]) {
    const file = [...lignes];
    const misesAJour: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith("update alert_delivery")) misesAJour.push({ sql, params });
        if (sql.includes("from alert_delivery d")) return { rows: file.length ? [file.shift()] : [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    return { misesAJour, query: vi.fn(async () => ({ rows: [{ v73: true }] })), connect: vi.fn(async () => client) };
  }

  it("un envoi d'escalade d'un déclenchement acquitté entre-temps : soldé, jamais posté ; le routage nominal part", async () => {
    const commun = { attempts: 0, message: "m", severity: "warning", target: "https://hooks.exemple.test/x" };
    const pool = poolAvec([
      { id: 1, ...commun, acknowledged: true, escalation_level: 2, escalation_relance: 0 },
      { id: 2, ...commun, acknowledged: true, escalation_level: null, escalation_relance: null },
      { id: 3, ...commun, acknowledged: false, escalation_level: 1, escalation_relance: 0 },
    ]);
    const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, body: null }) as unknown as Response);
    const bilan = await dispatchOnce(pool as never, { fetchImpl });
    expect(bilan).toEqual({ sent: 2, failed: 0, dead: 0, skipped: 1 });
    expect(pool.misesAJour[0].sql).toContain("status = 'skipped'");
    expect(pool.misesAJour[0].sql).not.toContain("attempts = attempts + 1");
    expect(pool.misesAJour[0].params).toEqual(["déclenchement acquitté avant l'envoi : l'escalade s'arrête", 1]);
    // Le nominal (2) et l'escalade d'un déclenchement ouvert (3) sont postés.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const corps = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(corps.text).toBe("[MIP RUM] Niveau 1, non acquittée — m");
  });
});

describe("le tick appelle l'escalade après check_slo_burn, si sa migration est là", () => {
  function poolDuTick(present: boolean) {
    const appels: { text: string; query_timeout?: number }[] = [];
    return {
      appels,
      query: vi.fn(async (q: string | { text: string; query_timeout?: number }, valeurs?: unknown[]) => {
        const a = typeof q === "string" ? { text: q } : q;
        appels.push({ ...a, ...(valeurs ? { valeurs } : {}) } as never);
        if (a.text.includes("to_regprocedure")) {
          const sig = String(valeurs?.[0]);
          return { rows: [{ present: sig.startsWith("escalate_alerts") ? present : true }] };
        }
        if (a.text.includes("uptime_check")) return { rows: [] };
        return [{ rows: [] }, { rows: [{ result: 0 }] }];
      }),
    };
  }

  it("présente : un appel borné à 30 s côté serveur, la signature de v108 vérifiée d'abord", async () => {
    const pool = poolDuTick(true);
    const bilan = await travaux(pool as never, { log: muet }).tick();
    expect(Object.keys(bilan.resultats)).toContain("escalate_alerts");
    expect(DELAIS_ETAPES_MS.escalate_alerts).toBe(30_000);
    const sonde = pool.appels.find((a) => a.text.includes("to_regprocedure") && JSON.stringify(a).includes("escalate_alerts"));
    expect(JSON.stringify(sonde)).toContain("escalate_alerts(timestamp with time zone)");
    const appel = pool.appels.find((a) => a.text.includes("select escalate_alerts() as result"))!;
    expect(appel.text).toBe("select set_config('statement_timeout', '30000', true); select escalate_alerts() as result");
    expect(appel.query_timeout).toBe(30_000 + MARGE_CLIENT_MS);
  });

  it("absente (le code précède sa migration) : l'étape le dit, sans échouer ni appeler", async () => {
    const pool = poolDuTick(false);
    const bilan = await travaux(pool as never, { log: muet }).tick();
    expect(bilan.resultats.escalate_alerts).toMatchObject({ ok: true, result: { absent: "migration-v108 non appliquée" } });
    expect(pool.appels.some((a) => a.text.includes("escalate_alerts() as result"))).toBe(false);
  });
});
