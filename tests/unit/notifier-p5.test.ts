// P5 — le notifier : livreur unique, e-mail Resend en mode test, webhooks signés.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Un faux succès : une livraison `delivered` sans que Resend ait accepté le
//     message (le défaut que v49 corrigeait déjà côté console).
//   - Un double envoi : une réponse perdue fait rejouer la livraison ; la clé
//     d'idempotence doit être la MÊME d'un essai à l'autre, et le corps aussi.
//   - Un rejeu inutile : un 4xx de Resend (clé révoquée, adresse refusée) est
//     terminal, pas cinq tentatives du même refus.
//   - Un e-mail hors de la liste de test pendant que le domaine n'est pas vérifié.
//   - Une signature que le destinataire ne saurait pas vérifier, ou qui laisserait
//     rejouer un corps capturé avec un horodatage frais.
//   - Un scheduler qui continue de livrer après la bascule : il n'a pas la clé
//     Resend et solderait les e-mails `skipped`.
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { dispatchOnce } from "../../packages/backend/lib/dispatch-alerts.mjs";
import {
  configEmail,
  construireMail,
  envoyerMail,
  erreursConfigEmail,
  estAdresseMail,
  issueResend,
  refusDestinataire,
  RESEND_URL,
} from "../../packages/backend/lib/net/resend.mjs";
import {
  entetesDeLivraison,
  secretsDeSignature,
  verifierSignature,
} from "../../packages/backend/lib/net/signature-webhook.mjs";
import { creerLivreur, INTERVALLE_DEFAUT_MS } from "../../packages/backend/jobs/livreur.mjs";
import { travaux } from "../../packages/backend/jobs/planifie.mjs";
import { createMetrics } from "../../packages/service-kit/metrics.mjs";

const muet = { debug() {}, info() {}, warn() {}, error() {} };
const texteDe = (q: string | { text: string }) => (typeof q === "string" ? q : q.text);

/** Une réponse de Resend, telle que `envoyerMail` la lit. */
const reponse = (status: number, corps: unknown) =>
  ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(corps) }) as unknown as Response;

describe("resend — le message", () => {
  it("sévérité et première ligne au sujet, sans répéter « [MIP RUM] »", () => {
    const m = construireMail({ to: "ops@example.com", severity: "critical", text: "[MIP RUM] SLO « LCP » en burn rapide\ndétail" });
    expect(m?.subject).toBe("[MIP RUM CRITICAL] SLO « LCP » en burn rapide");
    expect(m?.text).toContain("détail");
    expect(m?.text).toContain("Sévérité : critical");
  });

  it("tronque un sujet trop long, retombe sur warning, joint le détail sans répéter le texte", () => {
    const long = construireMail({ to: "a@b.co", text: "x".repeat(300) });
    expect(long!.subject.length).toBeLessThanOrEqual(140);
    expect(long!.subject.endsWith("…")).toBe(true);
    expect(construireMail({ to: "a@b.co", text: "x", severity: "bogus" })?.subject).toContain("WARNING");
    const m = construireMail({ to: "a@b.co", text: "[MIP RUM] alerte", payload: { app_id: "gip", value: 42, text: "[MIP RUM] alerte" } });
    expect(m?.text).toContain('"app_id": "gip"');
    expect(m?.text.match(/\[MIP RUM\] alerte/g)).toHaveLength(1);
  });

  it("REFUSE une entrée inexploitable plutôt qu'un e-mail vide", () => {
    expect(construireMail({ to: "pas-une-adresse", text: "x" })).toBeNull();
    expect(construireMail({ to: "a b@c.co", text: "x" })).toBeNull();
    expect(construireMail({ to: "a@b.co", text: "   " })).toBeNull();
    expect(construireMail({})).toBeNull();
  });

  it("le même message pour la même ligne : rien qui dépende de l'heure (idempotence Resend)", () => {
    const entree = { to: "a@b.co", severity: "warning", text: "t", payload: { a: 1 } };
    expect(construireMail(entree)).toEqual(construireMail(entree));
  });

  it("reconnaît une adresse e-mail, pas une URL", () => {
    expect(estAdresseMail("ops@example.com")).toBe(true);
    expect(estAdresseMail("https://hooks.slack.com/x")).toBe(false);
    expect(estAdresseMail("https://user@hook.example.com/x")).toBe(false);
  });
});

describe("resend — configuration et mode test", () => {
  it("null sans clé ou sans expéditeur, jamais de défaut ; la liste de test en minuscules", () => {
    expect(configEmail({})).toBeNull();
    expect(configEmail({ RESEND_API_KEY: "k" })).toBeNull();
    expect(configEmail({ ALERT_EMAIL_FROM: "a@b.co" })).toBeNull();
    const cfg = configEmail({ RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "onboarding@resend.dev", ALERT_EMAIL_TEST_RECIPIENTS: " Julian@Exemple.org , b@c.co" });
    expect(cfg).toMatchObject({ apiKey: "k", from: "onboarding@resend.dev" });
    expect([...cfg!.destinatairesTest!]).toEqual(["julian@exemple.org", "b@c.co"]);
    expect(configEmail({ RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "alertes@mip.fr" })!.destinatairesTest).toBeNull();
  });

  it("les règles croisées nomment la variable à corriger", () => {
    expect(erreursConfigEmail({})).toEqual([]);
    expect(erreursConfigEmail({ RESEND_API_KEY: "k" })).toEqual([{ variable: "RESEND_API_KEY", erreur: expect.stringContaining("ALERT_EMAIL_FROM") }]);
    expect(erreursConfigEmail({ ALERT_EMAIL_FROM: "a@b.co" })).toEqual([{ variable: "ALERT_EMAIL_FROM", erreur: expect.stringContaining("RESEND_API_KEY") }]);
    // L'expéditeur de test de Resend n'écrit qu'au titulaire du compte.
    expect(erreursConfigEmail({ RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "onboarding@resend.dev" })).toEqual([
      { variable: "ALERT_EMAIL_FROM", erreur: expect.stringContaining("ALERT_EMAIL_TEST_RECIPIENTS") },
    ]);
    expect(erreursConfigEmail({ RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "onboarding@resend.dev", ALERT_EMAIL_TEST_RECIPIENTS: "a@b.co" })).toEqual([]);
    // Jamais la valeur d'un secret dans un message.
    expect(JSON.stringify(erreursConfigEmail({ RESEND_API_KEY: "re_secret_123" }))).not.toContain("re_secret_123");
  });

  it("hors liste de test : refus avec la raison, avant tout appel", () => {
    const cfg = configEmail({ RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "onboarding@resend.dev", ALERT_EMAIL_TEST_RECIPIENTS: "a@b.co" })!;
    expect(refusDestinataire("A@B.co", cfg)).toBeNull();
    expect(refusDestinataire("autre@b.co", cfg)).toMatch(/domaine d'envoi non vérifié/);
    expect(refusDestinataire("autre@b.co", { destinatairesTest: null })).toBeNull();
  });
});

describe("resend — l'envoi et ce qu'il vaut", () => {
  const mail = { to: "a@b.co", subject: "s", text: "t" };
  const cfg = { apiKey: "re_cle", from: "onboarding@resend.dev" };

  it("2xx : livré, avec l'identifiant Resend ; clé d'idempotence et clé d'API transmises", async () => {
    const fetchImpl = vi.fn(async () => reponse(200, { id: "49a3999c" }));
    const r = await envoyerMail(mail, cfg, { cleIdempotence: "mip-delivery-7", fetchImpl });
    expect(r).toEqual({ issue: "livre", reponse: "resend 49a3999c" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { timeoutMs: number }];
    expect(url).toBe(RESEND_URL);
    expect(init.headers).toMatchObject({ authorization: "Bearer re_cle", "idempotency-key": "mip-delivery-7" });
    expect(JSON.parse(String(init.body))).toEqual({ from: cfg.from, to: ["a@b.co"], subject: "s", text: "t" });
    expect(init.timeoutMs).toBeGreaterThan(0);
  });

  it("4xx terminal, sauf 429 et 409 concurrent ; 5xx et panne réseau rejouables", async () => {
    expect(issueResend(422, "validation_error")).toBe("terminal");
    expect(issueResend(403, "validation_error")).toBe("terminal");
    expect(issueResend(409, "invalid_idempotent_request")).toBe("terminal");
    expect(issueResend(409, "concurrent_idempotent_requests")).toBe("rejouable");
    expect(issueResend(429, "rate_limit_exceeded")).toBe("rejouable");
    expect(issueResend(503, undefined)).toBe("rejouable");

    const refus = await envoyerMail(mail, cfg, {
      cleIdempotence: "k",
      fetchImpl: vi.fn(async () => reponse(403, { name: "validation_error", message: "You can only send testing emails to your own email address" })),
    });
    expect(refus.issue).toBe("terminal");
    expect(refus.reponse).toMatch(/^resend http 403 validation_error : You can only/);
    const panne = await envoyerMail(mail, cfg, {
      cleIdempotence: "k",
      fetchImpl: vi.fn(async () => {
        throw Object.assign(new Error("connect"), { code: "ECONNRESET" });
      }),
    });
    expect(panne).toEqual({ issue: "rejouable", reponse: "resend : ECONNRESET" });
  });

  it("la clé d'API n'apparaît jamais dans la réponse enregistrée", async () => {
    const r = await envoyerMail(mail, cfg, { cleIdempotence: "k", fetchImpl: vi.fn(async () => reponse(401, { name: "missing_api_key", message: "re_cle" })) });
    // Le message d'erreur vient de Resend : on n'y met rien de nous.
    expect(r.issue).toBe("terminal");
    const ok = await envoyerMail(mail, cfg, { cleIdempotence: "k", fetchImpl: vi.fn(async () => reponse(200, { id: "x" })) });
    expect(ok.reponse).not.toContain("re_cle");
  });
});

describe("signature des webhooks", () => {
  const SECRET = "s".repeat(40);
  const corps = JSON.stringify({ source: "mip-rum", text: "[MIP RUM] alerte" });

  it("sans secret : l'identifiant de livraison seul ; avec : horodatage et HMAC vérifiables", () => {
    expect(entetesDeLivraison({ id: 12, corps })).toEqual({ "x-mip-delivery-id": "12" });
    const maintenantMs = 1_790_000_000_000;
    const e = entetesDeLivraison({ id: 12, corps, secret: SECRET, maintenantMs });
    expect(e["x-mip-timestamp"]).toBe("1790000000");
    expect(e["x-mip-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifierSignature({ secrets: [SECRET], entetes: e, corps, maintenantMs })).toEqual({ ok: true });
  });

  it("refuse un corps altéré, un mauvais secret, un horodatage périmé ou absent", () => {
    const maintenantMs = 1_790_000_000_000;
    const e = entetesDeLivraison({ id: 1, corps, secret: SECRET, maintenantMs });
    expect(verifierSignature({ secrets: [SECRET], entetes: e, corps: corps + " ", maintenantMs }).ok).toBe(false);
    expect(verifierSignature({ secrets: ["t".repeat(40)], entetes: e, corps, maintenantMs })).toEqual({ ok: false, raison: "signature" });
    // Un corps capturé ne se rejoue pas six minutes plus tard.
    expect(verifierSignature({ secrets: [SECRET], entetes: e, corps, maintenantMs: maintenantMs + 360_000 })).toEqual({ ok: false, raison: "horodatage" });
    expect(verifierSignature({ secrets: [SECRET], entetes: { "x-mip-delivery-id": "1" }, corps })).toEqual({ ok: false, raison: "absente" });
  });

  it("rotation : « nouveau,ancien » — la première signe, les deux vérifient", () => {
    const [nouveau, ancien] = secretsDeSignature(` ${"n".repeat(32)} , ${"a".repeat(32)} `);
    expect([nouveau, ancien]).toEqual(["n".repeat(32), "a".repeat(32)]);
    const maintenantMs = Date.now();
    const signeAvecAncien = entetesDeLivraison({ id: 1, corps, secret: ancien, maintenantMs });
    expect(verifierSignature({ secrets: [nouveau, ancien], entetes: signeAvecAncien, corps, maintenantMs }).ok).toBe(true);
  });
});

/** Pool factice du dispatcher : une livraison réservée par ligne donnée, puis plus rien. */
function poolAvec(lignes: Array<Record<string, unknown>>) {
  const file = lignes.map((l, i) => ({ id: i + 1, attempts: 0, message: "m", severity: "warning", ...l }));
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

describe("dispatcher — e-mail par Resend (migration-v88)", () => {
  const email = configEmail({ RESEND_API_KEY: "re_cle", ALERT_EMAIL_FROM: "onboarding@resend.dev", ALERT_EMAIL_TEST_RECIPIENTS: "ops@example.com" });

  it("sans configuration (le scheduler) : `skipped` avec la raison, sans tentative comptée", async () => {
    const pool = poolAvec([{ target: "ops@example.com" }]);
    expect(await dispatchOnce(pool as never)).toEqual({ sent: 0, failed: 0, dead: 0, skipped: 1 });
    expect(pool.misesAJour[0].sql).toContain("status = 'skipped'");
    expect(pool.misesAJour[0].sql).not.toContain("attempts = attempts + 1");
    expect(String(pool.misesAJour[0].params[0])).toMatch(/RESEND_API_KEY .*notifier/);
  });

  it("hors liste de test : `skipped`, Resend jamais appelé", async () => {
    const pool = poolAvec([{ target: "autre@example.com" }]);
    const fetchMail = vi.fn();
    expect(await dispatchOnce(pool as never, { email, fetchMail })).toMatchObject({ skipped: 1 });
    expect(fetchMail).not.toHaveBeenCalled();
    expect(String(pool.misesAJour[0].params[0])).toMatch(/ALERT_EMAIL_TEST_RECIPIENTS/);
  });

  it("accepté : `delivered`, l'identifiant Resend dans `response`, clé d'idempotence par livraison", async () => {
    const pool = poolAvec([{ target: "ops@example.com", severity: "critical", message: "SLO en burn" }]);
    const fetchMail = vi.fn(async () => reponse(200, { id: "re-42" }));
    const vus: unknown[] = [];
    expect(await dispatchOnce(pool as never, { email, fetchMail, onLivraison: (x: unknown) => vus.push(x) })).toEqual({ sent: 1, failed: 0, dead: 0, skipped: 0 });
    expect(pool.misesAJour[0].params.slice(0, 2)).toEqual(["delivered", "resend re-42"]);
    const init = (fetchMail.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("mip-delivery-1");
    expect(JSON.parse(String(init.body)).subject).toBe("[MIP RUM CRITICAL] SLO en burn");
    expect(vus).toEqual([{ canal: "email", status: "delivered" }]);
  });

  it("refus 4xx : `dead` d'emblée ; panne : `failed`, rejouée avec la MÊME clé", async () => {
    const refus = poolAvec([{ target: "ops@example.com" }]);
    await dispatchOnce(refus as never, { email, fetchMail: vi.fn(async () => reponse(422, { name: "validation_error", message: "x" })) });
    expect(refus.misesAJour[0].params[0]).toBe("dead");
    expect(refus.misesAJour[0].sql).toContain("attempts = attempts + 1");

    const panne = poolAvec([{ id: 9, target: "ops@example.com", attempts: 1 }]);
    const fetchMail = vi.fn(async () => reponse(503, {}));
    await dispatchOnce(panne as never, { email, fetchMail });
    expect(panne.misesAJour[0].params[0]).toBe("failed");
  });

  it("une cible ni URL ni adresse : `skipped`, et le motif le dit", async () => {
    const pool = poolAvec([{ target: "ftp://ailleurs" }]);
    expect(await dispatchOnce(pool as never, { email })).toMatchObject({ skipped: 1 });
    expect(String(pool.misesAJour[0].params[0])).toMatch(/ni HTTP\(S\) ni adresse e-mail/);
  });
});

describe("dispatcher — webhooks signés", () => {
  it("le corps posté est celui que la signature couvre, et l'identifiant est toujours là", async () => {
    const SECRET = "w".repeat(40);
    const pool = poolAvec([{ target: "https://hooks.exemple.test/a" }, { target: "https://hooks.exemple.test/b" }]);
    const envois: Array<{ headers: Record<string, string>; body: string }> = [];
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      envois.push({ headers: init.headers as Record<string, string>, body: String(init.body) });
      return { status: 204, ok: true, body: null } as unknown as Response;
    });
    await dispatchOnce(pool as never, { fetchImpl, secretSignature: SECRET });
    expect(envois).toHaveLength(2);
    for (const [i, e] of envois.entries()) {
      expect(e.headers["x-mip-delivery-id"]).toBe(String(i + 1));
      expect(verifierSignature({ secrets: [SECRET], entetes: e.headers, corps: e.body })).toEqual({ ok: true });
    }
    // Sans secret : identifiant seul, rien de signé.
    const sansSecret = poolAvec([{ target: "https://hooks.exemple.test/c" }]);
    const f2 = vi.fn(async (_u: string, init: RequestInit) => {
      expect(init.headers).toEqual({ "content-type": "application/json", "x-mip-delivery-id": "1" });
      return { status: 200, ok: true, body: null } as unknown as Response;
    });
    await dispatchOnce(sansSecret as never, { fetchImpl: f2 });
    expect(f2).toHaveBeenCalledOnce();
  });
});

describe("scheduler — SCHEDULER_DELIVERY=off : le tick décide, il ne livre plus", () => {
  const poolFactice = () => ({ query: vi.fn(async () => ({ rows: [{ result: 0, present: true }] })) });

  it("off : ni routage de l'outbox, ni webhooks, ni tickets, ni réconciliation", async () => {
    const dispatch = vi.fn();
    const bilan = await travaux(poolFactice() as never, { log: muet, dispatch, livraison: false }).tick();
    expect(Object.keys(bilan.resultats)).toEqual(["check_alerts", "check_slo_burn", "uptime"]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("on (défaut) : l'ordre historique du tick est inchangé", async () => {
    const dispatch = vi.fn(async () => ({ sent: 0 }));
    const bilan = await travaux(poolFactice() as never, { log: muet, dispatch }).tick();
    expect(Object.keys(bilan.resultats)).toEqual([
      "check_alerts",
      "route_error_issue_notifications",
      "check_slo_burn",
      "uptime",
      "dispatch_alerts",
      "dispatch_tickets",
      "reconcile_deliveries",
    ]);
  });
});

describe("livreur — la passe du notifier", () => {
  /** Pool qui répond aux étapes de livraison et à la lecture de l'arriéré. */
  function poolLivreur({ plusAncienneS = null as number | null } = {}) {
    const textes: string[] = [];
    return {
      textes,
      query: vi.fn(async (q: string | { text: string }) => {
        const t = texteDe(q);
        textes.push(t);
        if (t.includes("to_regprocedure")) return { rows: [{ present: true }] };
        if (t.includes("to_regclass('public.ticket_outbox')")) return { rows: [{ v84: false }] };
        if (t.includes("from alert_delivery where status = 'queued'")) return { rows: [{ en_attente: 3, plus_ancienne_s: plusAncienneS }] };
        return { rows: [{ result: 0 }] };
      }),
      connect: vi.fn(),
    };
  }

  it("une passe : outbox, livraison, tickets — dans cet ordre, sous une échéance courte ; configuration transmise", async () => {
    const pool = poolLivreur();
    const dispatch = vi.fn(async () => ({ sent: 0, failed: 0, dead: 0, skipped: 0 }));
    const email = { apiKey: "k", from: "a@b.co", destinatairesTest: null };
    const t0 = 1_000_000;
    const livreur = creerLivreur({ pool: pool as never, log: muet, dispatch, email, secretSignature: "s".repeat(32), budgetMs: 10_000, maintenant: () => t0 });
    const bilan = await livreur.passe();
    expect(Object.keys(bilan.resultats)).toEqual(["route_error_issue_notifications", "dispatch_alerts", "dispatch_tickets"]);
    expect(bilan.ok).toBe(true);
    const options = (dispatch.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(options).toMatchObject({ echeance: t0 + 10_000, email, secretSignature: "s".repeat(32) });
    expect(typeof options.onLivraison).toBe("function");
    // La réconciliation n'est PAS dans la passe : elle a sa boucle horaire.
    expect(pool.textes.some((t) => t.includes("reconcile_alert_deliveries"))).toBe(false);
    await livreur.reconcilier();
    expect(pool.textes.some((t) => t.includes("reconcile_alert_deliveries"))).toBe(true);
  });

  it("les livraisons soldées sont comptées par canal et par statut", async () => {
    const metrics = createMetrics();
    const dispatch = vi.fn(async (_p: unknown, o: { onLivraison: (x: object) => void }) => {
      o.onLivraison({ canal: "email", status: "delivered" });
      o.onLivraison({ canal: "webhook", status: "failed" });
      return { sent: 1, failed: 1, dead: 0, skipped: 0 };
    });
    await creerLivreur({ pool: poolLivreur() as never, log: muet, metrics, dispatch }).passe();
    const texte = await metrics.render();
    expect(texte).toContain('notifier_deliveries_total{canal="email",status="delivered"} 1');
    expect(texte).toContain('notifier_deliveries_total{canal="webhook",status="failed"} 1');
  });

  it("/ready : frais après une passe aboutie ; en retard au-delà de quatre intervalles ; bloqué par un arriéré de 15 min", async () => {
    let t = 0;
    const livreur = creerLivreur({ pool: poolLivreur() as never, log: muet, dispatch: vi.fn(async () => ({})), maintenant: () => t });
    await livreur.passe();
    expect((await livreur.etat()).ok).toBe(true);
    t += 4 * INTERVALLE_DEFAUT_MS + 1_000;
    const tard = await livreur.etat();
    expect(tard.ok).toBe(false);
    expect(tard.passe.silence_s).toBeGreaterThan(tard.passe.tolerance_s);

    const bloque = creerLivreur({ pool: poolLivreur({ plusAncienneS: 16 * 60 }) as never, log: muet, maintenant: () => 0 });
    const e = await bloque.etat();
    expect(e).toMatchObject({ ok: false, backlog: { livraisons_en_attente: 3, bloque: true } });
  });

  it("une étape qui échoue est rapportée, la passe continue et /ready garde le dernier SUCCÈS", async () => {
    let t = 0;
    let echoue = false;
    const dispatch = vi.fn(async () => {
      if (echoue) throw new Error("boum");
      return {};
    });
    const livreur = creerLivreur({ pool: poolLivreur() as never, log: muet, dispatch, maintenant: () => t });
    await livreur.passe();
    const succes = (await livreur.etat()).passe.dernier_succes;
    echoue = true;
    t += 1_000;
    const bilan = await livreur.passe();
    expect(bilan.ok).toBe(false);
    expect(Object.keys(bilan.resultats)).toContain("dispatch_tickets");
    const e = await livreur.etat();
    expect(e.passe).toMatchObject({ statut: "echec", etapes_en_echec: ["dispatch_alerts"], dernier_succes: succes });
  });
});

describe("services — configuration au démarrage", () => {
  const lancer = (entree: string, args: string[], env: Record<string, string>) =>
    new Promise<{ code: number | null; sortie: string }>((r) => {
      const e = spawn(process.execPath, [entree, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
      let sortie = "";
      e.stdout!.on("data", (d) => (sortie += d));
      e.stderr!.on("data", (d) => (sortie += d));
      e.on("exit", (code) => r({ code, sortie }));
    });

  it("notifier : gabarit d'environnement complet", async () => {
    const g = await lancer("services/notifier/worker.mjs", ["--print-env-example"], {});
    expect(g.code).toBe(0);
    expect(g.sortie).toMatch(/^DATABASE_URL=$/m);
    for (const v of ["RESEND_API_KEY", "ALERT_EMAIL_FROM", "ALERT_EMAIL_TEST_RECIPIENTS", "WEBHOOK_SIGNING_SECRET", "TICKET_SECRET_KEY", "NOTIFIER_INTERVAL_MS", "METRICS_TOKEN"]) {
      expect(g.sortie).toContain(`${v}=`);
    }
  }, 15_000);

  it("notifier : refuse de démarrer sur une configuration e-mail incohérente — toutes les erreurs, aucun secret", async () => {
    const r = await lancer("services/notifier/worker.mjs", [], {
      DATABASE_URL: "postgres://u:p@localhost:1/x",
      RESEND_API_KEY: "re_ne_doit_pas_fuir",
      ALERT_EMAIL_FROM: "onboarding@resend.dev",
      WEBHOOK_SIGNING_SECRET: "court",
      LOG_LEVEL: "info",
    });
    expect(r.code).toBe(2);
    expect(r.sortie).toContain("ALERT_EMAIL_FROM : un expéditeur @resend.dev exige ALERT_EMAIL_TEST_RECIPIENTS");
    expect(r.sortie).toContain("WEBHOOK_SIGNING_SECRET : chaque valeur doit faire au moins 32 caractères");
    expect(r.sortie).not.toContain("re_ne_doit_pas_fuir");
  }, 15_000);

  it("scheduler : SCHEDULER_DELIVERY au gabarit, et rien d'autre que on|off", async () => {
    const g = await lancer("services/scheduler/worker.mjs", ["--print-env-example"], {});
    expect(g.sortie).toContain("SCHEDULER_DELIVERY=");
    const r = await lancer("services/scheduler/worker.mjs", [], { DATABASE_URL: "postgres://u:p@localhost:1/x", SCHEDULER_DELIVERY: "peut-etre", LOG_LEVEL: "info" });
    expect(r.code).toBe(2);
    expect(r.sortie).toContain("SCHEDULER_DELIVERY : valeur hors liste");
  }, 15_000);
});
