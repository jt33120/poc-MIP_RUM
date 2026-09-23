// Le scheduler sur @mip/service-kit (P1) : ce qui ne se voit qu'en production,
// le jour où ça casse.
//
//   - L'ORDRE : SIGTERM pendant le premier tick (qui attend la base) doit être
//     un arrêt propre, pas une mort par signal. L'ancien worker enregistrait
//     ses gestionnaires APRÈS `await sousVerrou("tick")`.
//   - LA SONDE : « jamais exécuté » et « bail tenu ailleurs » sont SAINS sur
//     /health — sinon l'instance sortante d'un redéploiement, qui tient encore
//     le bail, ferait échouer le déploiement qui doit la remplacer. La
//     fraîcheur ne vit que sur /ready.
//   - LE DÉLAI PAR ÉTAPE : `statement_timeout` posé dans la transaction de
//     chaque étape SQL, long pour la purge, jamais en SET de session.
//   - LE BATTEMENT : écrit sur succès SEULEMENT. Un échec rend le bail sans
//     prétendre avoir abouti ; le dead-man's switch ne reçoit rien.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { describe, expect, it, vi } from "vitest";
import { DUREES, abandonnerBail, prendreBailDetaille, rendreBail } from "../../packages/backend/jobs/bail.mjs";
import { TOLERANCES_MS } from "../../packages/backend/jobs/cadence.mjs";
import {
  CADENCES_PLANIFIEES,
  creerOrdonnanceur,
  creerSignalDeadman,
  executerSousBail,
  lireEtatBase,
  titulaireBail,
  verdictCadence,
} from "../../packages/backend/jobs/ordonnanceur.mjs";
import {
  DELAIS_ETAPES_MS,
  DELAI_ETAPE_DEFAUT_MS,
  MARGE_CLIENT_MS,
  appelerFn,
  delaiEtape,
  executerEtapes,
  travaux,
} from "../../packages/backend/jobs/planifie.mjs";
import { startService } from "../../packages/service-kit/http.mjs";
import { createLogger } from "../../packages/service-kit/log.mjs";
import { createMetrics } from "../../packages/service-kit/metrics.mjs";
import { resoudreCadence, titulaireManuel } from "../../services/scheduler/run-once.mjs";

const muet = { debug() {}, info() {}, warn() {}, error() {} };
const JETON = "j".repeat(40);

/** Un journal du kit dont on relit les lignes JSON. */
function journal() {
  const lignes: any[] = [];
  const sink = { out: (l: string) => lignes.push(JSON.parse(l)), err: (l: string) => lignes.push(JSON.parse(l)) };
  return { lignes, log: createLogger("test-scheduler", { version: "", replica: "", level: "debug", sink }) };
}

type Requete = { texte: string; params: unknown[]; brut: unknown };

/**
 * Un pool qui répond comme Postgres aux requêtes du scheduler : sonde, table
 * du bail, prise et reddition, lecture de l'état. `bail` règle la prise :
 * "libre" (on l'obtient), "ailleurs" (tenu par un autre).
 */
function poolSimule(o: { bail?: "libre" | "ailleurs"; precedent?: Date | null; baux?: any[]; maintenant?: () => Date; ping?: boolean } = {}) {
  const requetes: Requete[] = [];
  const { bail = "libre", precedent = null, baux = [], maintenant = () => new Date(), ping = true } = o;
  return {
    requetes,
    textes: () => requetes.map((r) => r.texte),
    query: vi.fn(async (q: any, params: unknown[] = []) => {
      const texte = typeof q === "string" ? q : q.text;
      requetes.push({ texte, params, brut: q });
      if (texte === "select 1") {
        if (!ping) throw new Error("base injoignable");
        return { rows: [{ "?column?": 1 }] };
      }
      if (texte.includes("insert into scheduler_lease")) {
        return { rows: bail === "libre" ? [{ holder: params[1], precedent }] : [] };
      }
      if (texte.includes("json_agg")) {
        return {
          rows: [
            {
              baux: baux.map((b) => ({ ...b, expires_at: b.expires_at.toISOString() })),
              livraisons_en_attente: 0,
              plus_ancienne_s: null,
              maintenant: maintenant(),
            },
          ],
        };
      }
      return { rows: [{ result: 0 }], rowCount: 0 };
    }),
  };
}

const bilanOk = { ok: true, echecs: 0, resultats: { a: { ok: true } } };
const bilanKo = { ok: false, echecs: 1, resultats: { a: { ok: true }, check_alerts: { ok: false, error: "Error: boum" } } };

// ---------------------------------------------------------------------------
describe("scheduler — SIGTERM enregistré avant tout await", () => {
  const source = readFileSync("services/scheduler/worker.mjs", "utf8");
  const code = source
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("dans le source : installLifecycle vient avant la configuration, le pool, les boucles et le serveur", () => {
    const i = code.indexOf("installLifecycle(");
    expect(i).toBeGreaterThan(0);
    for (const suivant of ["defineConfig(", "createPool(", "startLoop(", "startService("]) {
      expect(code.indexOf(suivant), suivant).toBeGreaterThan(i);
    }
    // Aucun `await` avant lui — et, de fait, aucun `await` de premier niveau du tout.
    expect(code.slice(0, i)).not.toMatch(/\bawait\b/);
    expect(code).not.toMatch(/^await\b/m);
  });

  // Le vrai test : un processus, une base qui accepte la connexion et ne répond
  // jamais (elle coupe au bout de 1,5 s). Le premier tick attend donc la base
  // quand SIGTERM arrive.
  it("SIGTERM pendant le premier tick : le tick en vol finit, le pool ferme ENSUITE, sortie 0 — pas une mort par signal", async () => {
    const base = net.createServer((s) => {
      s.on("error", () => {});
      setTimeout(() => s.destroy(), 1_500);
    });
    await new Promise<void>((r) => base.listen(0, "127.0.0.1", r));
    const portBase = (base.address() as net.AddressInfo).port;
    const libre = net.createServer();
    await new Promise<void>((r) => libre.listen(0, "127.0.0.1", r));
    const portHttp = (libre.address() as net.AddressInfo).port;
    await new Promise((r) => libre.close(r));

    const lignes: any[] = [];
    const enfant = spawn(process.execPath, ["services/scheduler/worker.mjs"], {
      // Environnement EXPLICITE : jamais celui du poste, qui peut porter une
      // DATABASE_URL de production.
      env: { DATABASE_URL: `postgres://u:p@127.0.0.1:${portBase}/mip`, PORT: String(portHttp), LOG_LEVEL: "info" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lire = (flux: NodeJS.ReadableStream) => {
      let reste = "";
      flux.on("data", (d) => {
        reste += d;
        const morceaux = reste.split("\n");
        reste = morceaux.pop()!;
        for (const l of morceaux) if (l.trim()) lignes.push(JSON.parse(l));
      });
    };
    lire(enfant.stdout!);
    lire(enfant.stderr!);
    const sortie = new Promise<[number | null, string | null]>((r) => enfant.on("exit", (c, s) => r([c, s])));
    try {
      await vi.waitFor(() => expect(lignes.some((l) => l.msg === "scheduler démarré")).toBe(true), { timeout: 5_000 });
      const t0 = Date.now();
      enfant.kill("SIGTERM");
      const [code, signal] = await sortie;
      const ms = Date.now() - t0;

      expect(signal).toBeNull(); // sorti par le cycle de vie, pas tué par le signal
      expect(code).toBe(0);
      expect(ms).toBeLessThan(10_000);
      const rang = (msg: string) => lignes.findIndex((l) => l.msg === msg);
      const arret = rang("arrêt demandé — /ready à 503, drainage");
      const tick = rang("travail en échec — passage suivant à l'heure");
      const pgFerme = lignes.findIndex((l) => l.msg === "ressource fermée" && l.etape === "pg");
      expect(arret).toBeGreaterThan(-1);
      expect(tick).toBeGreaterThan(arret); // le tick était EN VOL au signal…
      expect(pgFerme).toBeGreaterThan(tick); // …et le pool n'a fermé qu'après lui
      expect(lignes.at(-1)).toMatchObject({ msg: "arrêt terminé", code: 0 });
    } finally {
      enfant.kill("SIGKILL");
      await new Promise((r) => base.close(r));
    }
  }, 15_000);

  it("refuse de démarrer sans DATABASE_URL (code 2), et publie son gabarit d'environnement", async () => {
    const lancer = (args: string[], env: Record<string, string>) =>
      new Promise<{ code: number | null; sortie: string }>((r) => {
        const e = spawn(process.execPath, ["services/scheduler/worker.mjs", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
        let sortie = "";
        e.stdout!.on("data", (d) => (sortie += d));
        e.stderr!.on("data", (d) => (sortie += d));
        e.on("exit", (code) => r({ code, sortie }));
      });
    const sansBase = await lancer([], { LOG_LEVEL: "info" });
    expect(sansBase.code).toBe(2);
    expect(sansBase.sortie).toContain("DATABASE_URL : obligatoire, absente ou vide");

    const gabarit = await lancer(["--print-env-example"], {});
    expect(gabarit.code).toBe(0);
    expect(gabarit.sortie).toMatch(/^DATABASE_URL=$/m);
    for (const v of ["DEADMAN_URL", "METRICS_TOKEN", "PGPOOL_MAX", "RAILWAY_DEPLOYMENT_DRAINING_SECONDS"]) {
      expect(gabarit.sortie).toContain(`# ${v}=`);
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
describe("scheduler — la sonde Railway est saine sans exécution et quand le bail est tenu ailleurs", () => {
  async function servir(pool: any, ordonnanceur: any) {
    const svc = startService({ name: "scheduler", port: 0, host: "127.0.0.1", log: muet as any, pool, metricsToken: JETON, ready: () => ordonnanceur.etat() });
    const { port } = await svc.listening;
    const get = async (chemin: string) => {
      const r = await fetch(`http://127.0.0.1:${port}${chemin}`, { headers: { authorization: `Bearer ${JETON}` } });
      return { status: r.status, corps: await r.json() };
    };
    return { get, fermer: () => svc.close() };
  }

  it("jamais exécuté : /health 200, et /ready 200 tant que la tolérance court depuis le démarrage", async () => {
    const pool = poolSimule({ baux: [] });
    const jobs = { tick: vi.fn(), horaire: vi.fn(), quotidien: vi.fn() };
    const ordonnanceur = creerOrdonnanceur({ pool, jobs, porteur: "moi", log: muet as any });
    const { get, fermer } = await servir(pool, ordonnanceur);
    try {
      expect(await get("/health")).toEqual({ status: 200, corps: { status: "ok" } });
      const pret = await get("/ready");
      expect(pret.status).toBe(200);
      expect(pret.corps.cadences.tick).toMatchObject({ battement: null, en_cours: false, retard: false });
      expect(jobs.tick).not.toHaveBeenCalled();
    } finally {
      await fermer();
    }
  });

  it("bail tenu ailleurs : le passage est sauté SANS rien exécuter, /health reste 200, /ready dit qui le tient", async () => {
    const dans5min = new Date(Date.now() + 5 * 60_000);
    const pool = poolSimule({ bail: "ailleurs", baux: [{ job: "tick", holder: "deploiement-sortant:r1", expires_at: dans5min }] });
    const jobs = { tick: vi.fn(async () => bilanOk), horaire: vi.fn(), quotidien: vi.fn() };
    const signal = vi.fn(async () => true);
    const ordonnanceur = creerOrdonnanceur({ pool, jobs, porteur: "moi", log: muet as any, signalDeadman: signal });
    const { get, fermer } = await servir(pool, ordonnanceur);
    try {
      expect(await ordonnanceur.executer("tick")).toMatchObject({ statut: "bail_ailleurs" });
      expect(jobs.tick).not.toHaveBeenCalled();
      expect(signal).not.toHaveBeenCalled();
      expect((await get("/health")).status).toBe(200);
      const pret = await get("/ready");
      expect(pret.status).toBe(200);
      expect(pret.corps.cadences.tick).toMatchObject({ en_cours: true, tenu_par: "deploiement-sortant:r1", retard: false });
    } finally {
      await fermer();
    }
  });

  it("la fraîcheur ne vit que sur /ready : battement trop vieux → /ready 503, /health toujours 200", async () => {
    // Le processus a démarré il y a une heure ; le dernier tick abouti date de
    // 20 min, au-delà des 15 de tolérance.
    const horloge = Date.parse("2026-09-23T12:00:00Z");
    const pool = poolSimule({
      baux: [{ job: "tick", holder: "moi", expires_at: new Date(horloge - 20 * 60_000) }],
      maintenant: () => new Date(horloge),
    });
    const ordonnanceur = creerOrdonnanceur({ pool, jobs: {}, porteur: "moi", log: muet as any, maintenant: () => horloge - 3_600_000 });
    const { get, fermer } = await servir(pool, ordonnanceur);
    try {
      expect((await get("/health")).status).toBe(200);
      const pret = await get("/ready");
      expect(pret.status).toBe(503);
      expect(pret.corps.status).toBe("not_ready");
      expect(pret.corps.cadences.tick).toMatchObject({ retard: true, silence_s: 1200, tolerance_s: TOLERANCES_MS.tick / 1000 });
    } finally {
      await fermer();
    }
  });

  it("verdictCadence : le retard se compte depuis le plus récent du battement et du démarrage", () => {
    const maintenant = new Date("2026-09-23T12:00:00Z");
    const t = maintenant.getTime();
    const tol = TOLERANCES_MS.tick;
    expect(verdictCadence("tick", null, { maintenant, demarrage: t - tol + 1_000 }).retard).toBe(false);
    expect(verdictCadence("tick", null, { maintenant, demarrage: t - tol - 1_000 }).retard).toBe(true);
    const enCours = { job: "tick", holder: "x", expiresAt: new Date(t + 60_000) };
    expect(verdictCadence("tick", enCours, { maintenant, demarrage: 0 })).toMatchObject({ en_cours: true, retard: false, battement: null });
    const frais = { job: "tick", holder: "x", expiresAt: new Date(t - 60_000) };
    expect(verdictCadence("tick", frais, { maintenant, demarrage: 0 })).toMatchObject({ retard: false, silence_s: 60 });
  });

  it("lireEtatBase : une requête, bornée, battements en Date et arriéré", async () => {
    const pool = poolSimule({ baux: [{ job: "horaire", holder: "a:b", expires_at: new Date("2026-09-23T11:05:00Z") }] });
    const e = await lireEtatBase(pool as any);
    expect(pool.requetes).toHaveLength(1);
    expect((pool.requetes[0].brut as any).query_timeout).toBe(2_000);
    expect(e.baux[0]).toEqual({ job: "horaire", holder: "a:b", expiresAt: new Date("2026-09-23T11:05:00Z") });
    expect(e.backlog.livraisons_en_attente).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("scheduler — délai PAR ÉTAPE (statement_timeout dans la transaction)", () => {
  function poolDelais() {
    const appels: Array<{ text: string; query_timeout?: number }> = [];
    return {
      appels,
      query: vi.fn(async (q: any) => {
        appels.push(typeof q === "string" ? { text: q } : q);
        return { rows: [{ result: 0 }] };
      }),
    };
  }
  const delaiDe = (appels: Array<{ text: string; query_timeout?: number }>, fn: string) => {
    const a = appels.find((x) => x.text.includes(`select ${fn} as result`));
    return { serveur: Number(/statement_timeout', '(\d+)'/.exec(a!.text)?.[1]), client: a!.query_timeout, texte: a!.text };
  };

  it("chaque étape SQL pose son délai en set_config LOCAL, puis l'appel, dans UNE chaîne ; le client coupe après le serveur", async () => {
    const pool = poolDelais();
    await travaux(pool as any, { log: muet }).tick();
    const d = delaiDe(pool.appels, "check_alerts()");
    expect(d.texte).toBe("select set_config('statement_timeout', '60000', true); select check_alerts() as result");
    expect(d.serveur).toBe(DELAI_ETAPE_DEFAUT_MS);
    expect(d.client).toBe(DELAI_ETAPE_DEFAUT_MS + MARGE_CLIENT_MS);
    // Jamais de SET de session : il resterait sur la connexion rendue au pooler.
    expect(pool.appels.some((a) => /^\s*set\s/i.test(a.text))).toBe(false);
    // Les étapes réseau gardent leurs propres bornes : pas de set_config sur elles.
    expect(pool.appels.find((a) => a.text.includes("uptime_check"))!.text).not.toContain("set_config");
  });

  it("la purge a le délai LONG ; les pré-agrégats et le comptage, un délai moyen", async () => {
    const pool = poolDelais();
    await travaux(pool as any, { log: muet }).quotidien();
    await travaux(pool as any, { log: muet }).horaire();
    expect(delaiDe(pool.appels, "purge_rum_tenants(30)").serveur).toBe(30 * 60_000);
    expect(delaiDe(pool.appels, "meter_tenant_usage()").serveur).toBe(5 * 60_000);
    expect(delaiDe(pool.appels, "refresh_rum_rollups(26)").serveur).toBe(5 * 60_000);
    expect(delaiDe(pool.appels, "check_new_errors()").serveur).toBe(DELAI_ETAPE_DEFAUT_MS);
    expect(delaiEtape("purge_rum_tenants")).toBeGreaterThan(Math.max(...Object.entries(DELAIS_ETAPES_MS).filter(([k]) => k !== "purge_rum_tenants").map(([, v]) => v)));
  });

  // Un travail qui atteint TOUS ses délais doit encore rendre son bail avant
  // qu'il n'expire : sinon une autre instance démarre la même cadence pendant
  // qu'il tourne — le doublon que le bail existe pour empêcher.
  it("la somme des délais SQL d'une cadence reste sous la durée de son bail", async () => {
    for (const cadence of ["tick", "horaire", "quotidien"] as const) {
      const pool = poolDelais();
      await (travaux(pool as any, { log: muet }) as any)[cadence]();
      const somme = pool.appels.reduce((s, a) => s + (a.query_timeout ?? 0), 0);
      expect(somme, cadence).toBeGreaterThan(0);
      expect(somme, cadence).toBeLessThan(DUREES[cadence] * 1000);
    }
  });

  it("appelerFn rend le résultat du DERNIER énoncé et refuse un délai qui n'est pas un entier positif", async () => {
    const pool = { query: vi.fn(async () => [{ rows: [{ set_config: "2s" }] }, { rows: [{ result: 42 }] }]) };
    expect(await appelerFn(pool as any, "f()", { delaiMs: 2_000 })).toBe(42);
    const rien = { query: vi.fn() };
    await expect(appelerFn(rien as any, "f()", { delaiMs: 1.5 })).rejects.toThrow(RangeError);
    await expect(appelerFn(rien as any, "f()", { delaiMs: "1000; drop table x" as any })).rejects.toThrow(RangeError);
    expect(rien.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("scheduler — une étape en échec : journal d'erreur avec la PILE complète", () => {
  it("l'objet Error part au journal (pile, code), pas String(err)", async () => {
    const { log, lignes } = journal();
    function etapeQuiCasse(): never {
      throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    }
    const bilan = await executerEtapes([{ name: "purge_rum_tenants", delaiMs: 1_800_000, run: async () => etapeQuiCasse() }], log, { job: "quotidien" });
    expect(bilan).toMatchObject({ ok: false, echecs: 1 });
    const ligne = lignes.find((l) => l.msg === "étape planifiée en échec");
    expect(ligne).toMatchObject({ level: "error", job: "quotidien", step: "purge_rum_tenants", delai_ms: 1_800_000 });
    expect(ligne.err.code).toBe("57014");
    expect(ligne.err.stack).toContain("etapeQuiCasse");
  });
});

// ---------------------------------------------------------------------------
describe("scheduler — battement sur SUCCÈS seulement", () => {
  const avant = new Date("2026-09-23T11:55:00Z");

  it("succès : le bail est rendu à now() — c'est le battement", async () => {
    const pool = poolSimule({ precedent: avant });
    const r = await executerSousBail({ pool, job: "tick", porteur: "moi", executer: async () => bilanOk, log: muet as any });
    expect(r.statut).toBe("fait");
    const textes = pool.textes();
    expect(textes).toContain("update scheduler_lease set expires_at = now() where job = $1 and holder = $2");
    expect(textes.some((t) => /least\(|delete from scheduler_lease/.test(t))).toBe(false);
  });

  it("échec : le bail est libéré mais l'ANCIEN battement est remis, jamais now()", async () => {
    const pool = poolSimule({ precedent: avant });
    const r = await executerSousBail({ pool, job: "tick", porteur: "moi", executer: async () => bilanKo, log: muet as any });
    expect(r.statut).toBe("echec");
    const reddition = pool.requetes.at(-1)!;
    expect(reddition.texte).toContain("least($3::timestamptz, now())");
    expect(reddition.params).toEqual(["tick", "moi", avant]);
    expect(pool.textes()).not.toContain("update scheduler_lease set expires_at = now() where job = $1 and holder = $2");
  });

  it("échec d'une cadence qui n'a JAMAIS abouti : la ligne disparaît (« aucun passage constaté » reste vrai)", async () => {
    const pool = poolSimule({ precedent: null });
    await executerSousBail({ pool, job: "horaire", porteur: "moi", executer: async () => bilanKo, log: muet as any });
    expect(pool.requetes.at(-1)).toMatchObject({ texte: "delete from scheduler_lease where job = $1 and holder = $2", params: ["horaire", "moi"] });
  });

  it("un travail qui LÈVE : bail abandonné sans battement, erreur remontée", async () => {
    const pool = poolSimule({ precedent: avant });
    await expect(
      executerSousBail({ pool, job: "tick", porteur: "moi", executer: async () => { throw new Error("faute"); }, log: muet as any }),
    ).rejects.toThrow("faute");
    expect(pool.requetes.at(-1)!.texte).toContain("least(");
  });

  it("prendreBailDetaille lit l'ancien battement dans la MÊME instruction que la prise", async () => {
    const pool = poolSimule({ precedent: avant });
    expect(await prendreBailDetaille(pool as any, { job: "tick", porteur: "moi", secondes: 600 })).toEqual({ tenu: true, battementPrecedent: avant });
    expect(pool.requetes).toHaveLength(1);
    expect(pool.requetes[0].texte).toMatch(/^with precedent as \(select expires_at from scheduler_lease where job = \$1\)/);
    expect(pool.requetes[0].texte).toContain("where scheduler_lease.expires_at < now()");
    const ailleurs = poolSimule({ bail: "ailleurs" });
    expect(await prendreBailDetaille(ailleurs as any, { job: "tick", porteur: "moi", secondes: 600 })).toEqual({ tenu: false, battementPrecedent: null });
  });

  it("abandonnerBail et rendreBail ne touchent qu'au bail de LEUR titulaire", async () => {
    const pool = poolSimule();
    await abandonnerBail(pool as any, { job: "tick", porteur: "moi", battement: avant });
    await abandonnerBail(pool as any, { job: "tick", porteur: "moi", battement: null });
    await rendreBail(pool as any, { job: "tick", porteur: "moi" });
    for (const r of pool.requetes) {
      expect(r.texte).toContain("holder = $2");
      expect(r.params.slice(0, 2)).toEqual(["tick", "moi"]);
    }
  });

  it("dead-man's switch : signalé après un TICK abouti, jamais après un échec, un bail tenu ailleurs ou une autre cadence", async () => {
    const signal = vi.fn(async () => true);
    const metrics = createMetrics();
    const faire = async (bail: "libre" | "ailleurs", job: string, bilan: any) => {
      const pool = poolSimule({ bail });
      const jobs = { tick: async () => bilan, horaire: async () => bilan, quotidien: async () => bilan };
      return creerOrdonnanceur({ pool, jobs, porteur: "moi", log: muet as any, metrics, signalDeadman: signal }).executer(job);
    };
    await faire("libre", "tick", bilanKo);
    await faire("ailleurs", "tick", bilanOk);
    await faire("libre", "horaire", bilanOk);
    expect(signal).not.toHaveBeenCalled();
    await faire("libre", "tick", bilanOk);
    expect(signal).toHaveBeenCalledOnce();

    const texte = await metrics.render();
    expect(texte).toContain('scheduler_job_runs_total{job="tick",result="echec"} 1');
    expect(texte).toContain('scheduler_job_runs_total{job="tick",result="bail_ailleurs"} 1');
    expect(texte).toContain('scheduler_job_runs_total{job="tick",result="fait"} 1');
    expect(texte).toContain('scheduler_step_failures_total{job="tick",step="check_alerts"} 1');
  });

  it("une base injoignable ne fait pas lever l'ordonnanceur : passage compté en erreur, pile au journal", async () => {
    const { log, lignes } = journal();
    const pool = { query: vi.fn(async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); }) };
    const ordonnanceur = creerOrdonnanceur({ pool, jobs: { tick: vi.fn() }, porteur: "moi", log });
    expect(await ordonnanceur.executer("tick")).toEqual({ statut: "erreur" });
    const ligne = lignes.find((l) => l.msg === "travail en échec — passage suivant à l'heure");
    expect(ligne.err.stack).toContain("ECONNREFUSED");
  });

  it("le signal ne lève jamais et ne journalise jamais l'URL (elle EST le secret)", async () => {
    expect(creerSignalDeadman(undefined, { log: muet as any })).toBeNull();
    const url = "https://hc-ping.com/00000000-secret";
    const warn = vi.fn();
    const enPanne = creerSignalDeadman(url, { log: { warn } as any, fetchImpl: async () => { throw new Error("ETIMEDOUT"); } });
    expect(await enPanne!()).toBe(false);
    const refuse = creerSignalDeadman(url, { log: { warn } as any, fetchImpl: async () => new Response(null, { status: 404 }) });
    expect(await refuse!()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
    const appels: unknown[] = [];
    const ok = creerSignalDeadman(url, { log: { warn } as any, timeoutMs: 1234, fetchImpl: async (...a: unknown[]) => { appels.push(a); return new Response("OK"); } });
    expect(await ok!()).toBe(true);
    expect(appels[0]).toEqual([url, { method: "GET", timeoutMs: 1234 }]);
  });
});

// ---------------------------------------------------------------------------
describe("scheduler — titulaire du bail", () => {
  it("deploiement:replique sur Railway ; un UUID remplace la réplique absente ; local- hors Railway", () => {
    expect(titulaireBail({ RAILWAY_DEPLOYMENT_ID: "dep-1", RAILWAY_REPLICA_ID: "rep-a" })).toBe("dep-1:rep-a");
    const a = titulaireBail({ RAILWAY_DEPLOYMENT_ID: "dep-1" });
    const b = titulaireBail({ RAILWAY_DEPLOYMENT_ID: "dep-1" });
    expect(a).toMatch(/^dep-1:[0-9a-f-]{36}$/);
    expect(a).not.toBe(b); // deux processus ne partagent JAMAIS un titulaire
    expect(titulaireBail({})).toMatch(/^local-[0-9a-f-]{36}$/);
  });

  // `railway run` injecte les identifiants du worker en cours : le passage
  // manuel ne doit pas porter son nom, sinon il pourrait rendre SON bail.
  it("run-once : même bail, titulaire préfixé et unique, distinct de celui du worker", () => {
    const env = { RAILWAY_DEPLOYMENT_ID: "dep-1", RAILWAY_REPLICA_ID: "rep-a" };
    const m = titulaireManuel(env);
    expect(m).toMatch(/^manuel:dep-1:[0-9a-f-]{36}$/);
    expect(m).not.toBe(titulaireBail(env));
    expect(titulaireManuel(env)).not.toBe(m);
    expect(resoudreCadence("daily")).toBe("quotidien");
    expect(resoudreCadence("hourly")).toBe("horaire");
    expect(resoudreCadence("hebdo")).toBeNull();
    expect(CADENCES_PLANIFIEES).toEqual(["tick", "horaire", "quotidien"]);
  });
});
