// Le noyau backend extrait de Next.js : runner de migrations, cadences du
// scheduler, exécution des travaux planifiés.
//
// Ce qui est couvert ici est ce qui n'a PAS de filet ailleurs : une cadence
// fausse ne se voit qu'au bout d'une heure d'attente, et un runner de
// migrations qui se trompe touche la base de production.
import { describe, expect, it, vi } from "vitest";
import { aFaire, empreinte, jusquaInclus } from "../../apps/ingest/migrate.mjs";
import { CADENCES, prochainDelai } from "../../apps/ingest/jobs/cadence.mjs";
import { executerEtapes, travaux } from "../../apps/ingest/jobs/planifie.mjs";
import { optionsSsl } from "../../apps/ingest/lib/serveur.mjs";
import { DUREES, prendreBail, rendreBail } from "../../apps/ingest/jobs/bail.mjs";

const muet = { info() {}, warn() {}, error() {} };

describe("migrate — ce qui reste à appliquer", () => {
  const f = (nom: string, sql: string) => ({ nom, sql, checksum: empreinte(sql) });

  it("ne retient que les fichiers absents du registre", () => {
    const fichiers = [f("migration-v02.sql", "a"), f("migration-v03.sql", "b")];
    const { enAttente } = aFaire(fichiers, [
      { filename: "migration-v02.sql", checksum: empreinte("a") },
    ]);
    expect(enAttente.map((x) => x.nom)).toEqual(["migration-v03.sql"]);
  });

  // Un fichier modifié APRÈS son application : la base ne correspond plus au
  // fichier. Le rejouer serait pire que de le signaler — d'où la distinction.
  it("signale un fichier modifié après coup sans le remettre en attente", () => {
    const fichiers = [f("migration-v02.sql", "nouveau contenu")];
    const { enAttente, modifies } = aFaire(fichiers, [
      { filename: "migration-v02.sql", checksum: empreinte("ancien contenu") },
    ]);
    expect(enAttente).toEqual([]);
    expect(modifies).toEqual(["migration-v02.sql"]);
  });

  it("sur une base vierge, tout est en attente", () => {
    const fichiers = [f("migration-v02.sql", "a"), f("migration-v03.sql", "b")];
    expect(aFaire(fichiers, []).enAttente).toHaveLength(2);
  });
});

describe("migrate — étalonnage d'une base existante", () => {
  const fichiers = ["v02", "v03", "v51", "v52", "v53"].map((v) => ({ nom: `migration-${v}.sql` }));

  // Le cas réel : la base de production est à v51 sans registre. Sans
  // étalonnage, le premier passage rejouerait 48 fichiers sur une base qui les
  // a déjà.
  it("marque tout jusqu'au repère inclus", () => {
    expect(jusquaInclus(fichiers, "migration-v51.sql")?.map((f) => f.nom)).toEqual([
      "migration-v02.sql",
      "migration-v03.sql",
      "migration-v51.sql",
    ]);
  });

  it("renvoie null sur un repère inconnu plutôt que de tout marquer", () => {
    expect(jusquaInclus(fichiers, "migration-v99.sql")).toBeNull();
  });
});

describe("cadences du scheduler", () => {
  const ms = (nom: "tick" | "horaire" | "quotidien", iso: string) =>
    prochainDelai(nom, new Date(iso));

  it("le tick tombe sur les multiples de 5 minutes, pas sur l'heure de démarrage", () => {
    // 14h03 -> 14h05, et non 14h08 : la grille suit l'horloge, sinon deux
    // instances qui se relaient n'auraient pas les mêmes fenêtres.
    expect(ms("tick", "2026-09-08T14:03:00Z")).toBe(2 * 60_000);
    expect(ms("tick", "2026-09-08T14:03:30Z")).toBe(90_000);
    expect(ms("tick", "2026-09-08T14:00:00Z")).toBe(5 * 60_000);
  });

  it("le tick passe l'heure sans cas particulier", () => {
    // 14h58 -> 15h00 : setUTCMinutes(60) reporte de lui-même.
    expect(ms("tick", "2026-09-08T14:58:00Z")).toBe(2 * 60_000);
  });

  it("l'horaire vise HH:05 et saute à l'heure suivante s'il est passé", () => {
    expect(ms("horaire", "2026-09-08T14:00:00Z")).toBe(5 * 60_000);
    expect(ms("horaire", "2026-09-08T14:05:00Z")).toBe(60 * 60_000);
    expect(ms("horaire", "2026-09-08T14:30:00Z")).toBe(35 * 60_000);
  });

  it("le quotidien vise 03:17 UTC et change de jour une fois passé", () => {
    expect(ms("quotidien", "2026-09-08T03:00:00Z")).toBe(17 * 60_000);
    expect(ms("quotidien", "2026-09-08T04:00:00Z")).toBe((23 * 60 + 17) * 60_000);
  });

  // À la milliseconde pile de l'échéance, un délai nul ferait boucler la
  // minuterie sans respirer.
  it("ne renvoie jamais un délai nul", () => {
    for (const nom of ["tick", "horaire", "quotidien"] as const) {
      expect(prochainDelai(nom, new Date("2026-09-08T03:17:00Z"))).toBeGreaterThanOrEqual(1000);
    }
  });

  it("refuse une cadence inconnue au lieu d'en inventer une", () => {
    // @ts-expect-error — c'est précisément l'entrée invalide qu'on teste
    expect(() => prochainDelai("hebdomadaire", Date.now())).toThrow(/cadence inconnue/);
    expect(Object.keys(CADENCES).sort()).toEqual(["horaire", "quotidien", "tick"]);
  });
});

describe("exécution des travaux planifiés", () => {
  // Le point qui compte : une étape qui casse ne doit pas emporter les
  // suivantes. Une purge en échec ne doit pas annuler le comptage du volume.
  it("continue après un échec et le rapporte séparément", async () => {
    const bilan = await executerEtapes(
      [
        { name: "a", run: async () => 1 },
        {
          name: "b",
          run: async () => {
            throw new Error("boum");
          },
        },
        { name: "c", run: async () => 3 },
      ],
      muet,
    );
    expect(bilan.ok).toBe(false);
    expect(bilan.echecs).toBe(1);
    expect((bilan.resultats.a as { ok: boolean }).ok).toBe(true);
    expect((bilan.resultats.b as { ok: boolean; error: string }).error).toContain("boum");
    expect((bilan.resultats.c as { ok: boolean }).ok).toBe(true);
  });

  it("annonce ok quand tout passe", async () => {
    const bilan = await executerEtapes([{ name: "a", run: async () => "ok" }], muet);
    expect(bilan).toMatchObject({ ok: true, echecs: 0 });
  });
});

describe("cadences et fonctions SQL appelées", () => {
  /** Pool factice : retient les requêtes au lieu de parler à Postgres. */
  function poolFactice() {
    const requetes: string[] = [];
    return {
      requetes,
      query: vi.fn(async (sql: string) => {
        requetes.push(sql);
        return { rows: [{ result: 0 }] };
      }),
    };
  }

  it("le tick évalue alertes, SLO, uptime, livraison et réconciliation", async () => {
    const pool = poolFactice();
    const dispatch = vi.fn(async () => ({ sent: 0 }));
    const bilan = await travaux(pool as never, { log: muet, dispatch }).tick();

    expect(bilan.ok).toBe(true);
    expect(Object.keys(bilan.resultats)).toEqual([
      "check_alerts",
      "check_slo_burn",
      "uptime",
      "dispatch_alerts",
      "reconcile_deliveries",
    ]);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(pool.requetes.some((q) => q.includes("check_alerts()"))).toBe(true);
    expect(pool.requetes.some((q) => q.includes("uptime_check"))).toBe(true);
  });

  // `dispatch` est injecté : sans lui, aucune étape de livraison. C'est ce qui
  // permet de faire tourner le tick dans un environnement sans réseau sortant.
  it("sans dispatcher, l'étape de livraison disparaît au lieu d'échouer", async () => {
    const bilan = await travaux(poolFactice() as never, { log: muet }).tick();
    expect(Object.keys(bilan.resultats)).not.toContain("dispatch_alerts");
    expect(bilan.ok).toBe(true);
  });

  it("le quotidien purge par CLIENT, pas globalement", async () => {
    const pool = poolFactice();
    await travaux(pool as never, { log: muet }).quotidien();
    // purge_rum_tenants respecte app_registry.retention_days ; purge_rum (v09)
    // applique un délai global — confondre les deux efface la donnée d'un
    // client qui a payé pour la garder plus longtemps.
    expect(pool.requetes.some((q) => q.includes("purge_rum_tenants(30)"))).toBe(true);
    expect(pool.requetes.some((q) => /purge_rum\(/.test(q))).toBe(false);
  });

  it("l'horaire rafraîchit les rollups et les deux détections", async () => {
    const pool = poolFactice();
    const bilan = await travaux(pool as never, { log: muet }).horaire();
    expect(Object.keys(bilan.resultats)).toEqual([
      "refresh_rum_rollups",
      "check_new_errors",
      "check_ai_op_anomalies",
    ]);
  });
});

describe("décision TLS de la connexion Postgres", () => {
  // Le cas qui a cassé le smoke-test du conteneur : en docker-compose l'hôte
  // s'appelle `db`. Ce n'est pas `localhost`, mais ce n'est pas public non
  // plus — et exiger TLS d'un Postgres de conteneur donne « The server does
  // not support SSL connections ».
  it("n'impose pas TLS à un hôte qui ne peut pas être public", () => {
    for (const h of ["localhost", "127.0.0.1", "db", "postgres", "mip-db"]) {
      expect(optionsSsl(`postgres://u:p@${h}:5432/mip`), h).toBeUndefined();
    }
  });

  it("impose TLS vérifié à tout hôte public", () => {
    for (const h of ["ep-x.eu-central-1.aws.neon.tech", "db.exemple.fr"]) {
      expect(optionsSsl(`postgres://u:p@${h}/neondb`), h).toEqual({ rejectUnauthorized: true });
    }
  });

  // `sslmode` est le réglage standard : quand il est là, il fait autorité —
  // sur l'heuristique comme sur le reste.
  it("respecte sslmode quand l'URL le porte", () => {
    expect(optionsSsl("postgres://u:p@db/mip?sslmode=require")).toEqual({ rejectUnauthorized: true });
    expect(optionsSsl("postgres://u:p@db.exemple.fr/mip?sslmode=disable")).toBeUndefined();
    expect(optionsSsl("postgres://u:p@x.fr/m?sslmode=verify-full")).toEqual({ rejectUnauthorized: true });
  });

  // Ne jamais deviner à la baisse : une chaîne illisible se traite comme
  // distante, pas comme locale.
  it("chiffre par défaut sur une chaîne non parsable", () => {
    expect(optionsSsl("pas une url")).toEqual({ rejectUnauthorized: true });
  });

  // Le contrat non négociable : jamais de vérification désactivée, sinon une
  // interception passerait sans bruit.
  it("ne désactive JAMAIS la vérification du certificat", () => {
    for (const cs of ["postgres://u:p@x.fr/m", "postgres://u:p@db/m", "n'importe quoi"]) {
      const o = optionsSsl(cs);
      if (o) expect(o.rejectUnauthorized).toBe(true);
    }
  });
});

describe("bail d'exclusion des travaux planifiés", () => {
  /** Client factice : retient la requête et son jeu de paramètres. */
  function clientFactice(reponse: unknown[] = []) {
    const appels: Array<{ sql: string; params: unknown[] }> = [];
    return {
      appels,
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        appels.push({ sql, params });
        return { rows: reponse, rowCount: reponse.length };
      }),
    };
  }

  // La prise de bail doit tenir en UNE requête atomique. Une lecture suivie
  // d'une écriture laisserait une fenêtre où deux instances se croient seules —
  // exactement ce que le bail existe pour empêcher.
  it("prend le bail en une seule requête, conditionnée à l'expiration", async () => {
    const c = clientFactice([{ holder: "moi" }]);
    const pris = await prendreBail(c as never, { job: "tick", porteur: "moi", secondes: 600 });

    expect(pris).toBe(true);
    expect(c.appels).toHaveLength(1);
    const { sql, params } = c.appels[0];
    expect(sql).toContain("on conflict (job) do update");
    expect(sql).toContain("where scheduler_lease.expires_at < now()");
    expect(params).toEqual(["tick", "moi", 600]);
  });

  it("n'obtient PAS le bail quand la clause d'expiration bloque la mise à jour", async () => {
    const c = clientFactice([]); // aucune ligne renvoyée = bail tenu par un autre
    expect(await prendreBail(c as never, { job: "tick", porteur: "moi", secondes: 600 })).toBe(false);
  });

  // Cas subtil : la requête renvoie une ligne, mais elle porte le nom d'un
  // AUTRE porteur. Se déclarer titulaire là-dessus autoriserait deux exécutions.
  it("n'obtient pas le bail si la ligne renvoyée nomme quelqu'un d'autre", async () => {
    const c = clientFactice([{ holder: "quelqu-un-d-autre" }]);
    expect(await prendreBail(c as never, { job: "tick", porteur: "moi", secondes: 600 })).toBe(false);
  });

  // Le point qui compte à la libération : si NOTRE bail a expiré et qu'un autre
  // l'a repris, le supprimer sans filtrer sur le porteur effacerait LE SIEN et
  // ouvrirait la porte à une troisième instance.
  it("ne libère que SON propre bail", async () => {
    const c = clientFactice();
    await rendreBail(c as never, { job: "tick", porteur: "moi" });
    const { sql, params } = c.appels[0];
    expect(sql).toContain("holder = $2");
    expect(params).toEqual(["tick", "moi"]);
  });

  // La ligne SURVIT à la libération : `max(expires_at)` devient le battement de
  // cœur que la vitrine lit pour dire la latence d'alerte réelle. Un DELETE
  // n'aurait rien laissé à lire entre deux passages.
  it("libère en faisant EXPIRER la ligne, pas en la supprimant", async () => {
    const c = clientFactice();
    await rendreBail(c as never, { job: "tick", porteur: "moi" });
    expect(c.appels[0].sql).toContain("update scheduler_lease set expires_at = now()");
    expect(c.appels[0].sql).not.toContain("delete");
  });

  // Un bail plus court que le travail qu'il protège est pire que pas de bail :
  // il expire en cours de route et autorise le doublon qu'il devait empêcher.
  it("donne des durées très au-dessus du temps d'exécution observé", () => {
    expect(DUREES.tick).toBeGreaterThanOrEqual(600);
    expect(DUREES.horaire).toBeGreaterThanOrEqual(DUREES.tick);
    expect(DUREES.quotidien).toBeGreaterThanOrEqual(DUREES.horaire);
  });
});
