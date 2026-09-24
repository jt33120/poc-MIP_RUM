// migration-v63 — l'ingestion différée : ce qui se vérifie sans moteur.
//
// Le comportement (drain, recul, renoncement, parallélisme, effacement) est
// vérifié sur un vrai PostgreSQL par tests/integration/ingest-differe-sql.test.ts.
// Ici : les invariants de forme, et surtout LES AVERTISSEMENTS. Une table
// UNLOGGED perd des données à l'arrêt brutal ; ce fait ne doit pas pouvoir
// disparaître d'une relecture à l'autre.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healthToMetrics } from "../../apps/console/lib/metrics-format";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const V63 = lire("packages/db/sql/migration-v63.sql");
const LIB = lire("packages/backend/lib/ingest-differe.mjs");
const RECEVEUR = lire("packages/backend/lib/receiver.mjs");
const SERVICE = lire("services/collector/server.mjs");

describe("le compromis de durabilité est écrit, pas sous-entendu", () => {
  it("la migration dit que la table est vidée après un arrêt brutal", () => {
    // UNLOGGED est le gain ET le risque. Une migration qui écrirait « unlogged
    // pour la performance » sans la suite laisserait un opérateur croire que la
    // file survit à un redémarrage.
    expect(V63).toContain("create unlogged table if not exists ingest_raw");
    expect(V63.replace(/\s+/g, " ")).toContain("VIDÉE au redémarrage de PostgreSQL après un arrêt brutal");
    expect(V63.replace(/\s+/g, " ")).toContain("acquitté 200 mais pas encore drainé serait alors perdu");
  });

  it("le mode est ÉTEINT par défaut", () => {
    // Un compromis de durabilité se choisit ; il ne s'hérite pas d'une mise à
    // jour. Le défaut reste l'écriture synchrone dans les tables finales.
    // Le receveur lit l'environnement injecté (process.env par défaut).
    expect(RECEVEUR).toContain('env.INGEST_DEFERRED === "true"');
    expect(SERVICE).toContain('process.env.INGEST_DEFERRED === "true"');
  });

  it("l'état du mode est annoncé sur /health", () => {
    // Un opérateur doit pouvoir lire, sans fouiller les variables d'un
    // hébergeur, si ce déploiement acquitte avant d'avoir écrit.
    expect(SERVICE).toContain("ingest_deferred: DIFFERE");
  });

  it("la documentation d'intégration porte le même avertissement", () => {
    expect(lire("docs/INTEGRATION.md")).toContain("INGEST_DEFERRED");
  });
});

describe("la file ne peut pas devenir une porte ouverte", () => {
  it("le débarquement a lieu APRÈS les gardes, jamais avant", () => {
    // Si le lot était débarqué avant la vérification de clé et le rate-limit, la
    // file amplifierait l'abus au lieu de découpler le travail : n'importe qui
    // pourrait remplir une table UNLOGGED.
    const i = RECEVEUR.indexOf("const refus = await gardes(rows.apiKeys");
    const j = RECEVEUR.indexOf("deposerLot(pool, appId, rows, o)");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });

  it("le lot débarqué est DÉJÀ aplati", () => {
    // Stocker le payload brut obligerait le travailleur à refaire flattenOtlp —
    // donc à refaire le travail que la requête a déjà fait, et à rejouer la
    // détection de clé hors du chemin où elle a un sens.
    expect(LIB).toContain("insert into ingest_raw (app_id, lot) values ($1, $2::jsonb)");
  });
});

describe("un lot en échec ne bloque ni ne disparaît", () => {
  it("prend un recul EXPONENTIEL au lieu d'être retenté aussitôt", () => {
    // Sans recul, les cinq tentatives d'un lot sont brûlées en quelques
    // millisecondes : une coupure de base d'une seconde devient une perte
    // définitive. C'est un test d'intégration qui l'a montré, pas une relecture.
    expect(LIB).toContain("reprendre_a = now() + make_interval(secs => power(2, tentatives)::int)");
    expect(LIB).toContain("and reprendre_a <= now()");
  });

  it("cesse d'être repris après cinq échecs, en gardant son erreur", () => {
    // Une file qui rejoue indéfiniment un lot empoisonné n'avance plus, et le
    // silence ressemble à du travail.
    expect(LIB).toContain("export const MAX_TENTATIVES = 5;");
    expect(LIB).toContain("erreur = $2");
    expect(V63).toContain("where tentatives < 5");
  });

  it("l'échec est enregistré dans la MÊME transaction que le verrou", () => {
    // Sinon deux travailleurs se repasseraient le lot sans jamais compter, et le
    // renoncement n'arriverait jamais.
    const debut = LIB.indexOf("} catch (err) {");
    const bloc = LIB.slice(debut, LIB.indexOf('return "echec";', debut));
    expect(bloc).toContain("update ingest_raw");
    // P8.1 — et il est précédé d'un RETOUR AU POINT DE REPRISE. Une transaction
    // PostgreSQL en échec refuse tout ordre suivant (25P02), y compris un simple
    // UPDATE de compteur : sans savepoint, le compteur ne montait jamais et le
    // lot empoisonné revenait sans fin. Le verrou d'application, pris AVANT le
    // point de reprise, survit à ce retour arrière partiel.
    expect(LIB).toContain('await client.query("savepoint avant_ecriture");');
    expect(bloc.indexOf('rollback to savepoint avant_ecriture'))
      .toBeLessThan(bloc.indexOf("update ingest_raw"));
    // Le commit appartient à la primitive partagée, pas à ce module : c'est elle
    // qui ouvre la transaction, borne l'attente et prend le verrou.
    expect(LIB).toContain("withAppIngestTransaction(pool, candidat.app_id");
  });
});

describe("P8.1 — l'ordre des verrous, et le client unique", () => {
  it("le candidat est pré-lu SANS verrou, puis repris sous le verrou d'app", () => {
    // On ne peut pas savoir quelle application verrouiller avant d'avoir vu une
    // ligne, et on ne peut pas verrouiller la ligne avant l'application :
    // l'effacement prend app puis file, et l'inverse ici s'interbloquerait.
    const preLecture = LIB.indexOf("async function lireCandidat");
    expect(preLecture).toBeGreaterThan(0);
    const corps = LIB.slice(preLecture, LIB.indexOf("}\n", LIB.indexOf("return rows[0] ?? null;")));
    expect(corps).not.toContain("for update");
    // La reprise, elle, verrouille la ligne et REVÉRIFIE son éligibilité.
    const reprise = LIB.slice(LIB.indexOf("async function traiterCandidat"));
    expect(reprise).toContain("where id = $1 and tentatives < $2 and reprendre_a <= now()");
    expect(reprise).toContain("for update skip locked");
    expect(reprise).toContain('if (!ligne) return "absent";');
  });

  it("les tables finales sont écrites par LE MÊME client que la ligne de file", () => {
    // C'est la faille d'origine : le drain tenait la file sur sa connexion et
    // appelait writeRows(pool, …), qui ouvrait une transaction sur une AUTRE
    // connexion. Les deux n'étaient sérialisées avec rien.
    expect(LIB).toContain("await writeRows(pool, filtre.rows, { client });");
    expect(LIB).not.toMatch(/writeRows\(pool,\s*completer\(/);
  });

  it("le dépôt filtre par barrières et ne dépose pas un lot entièrement interdit", () => {
    // Déposer un lot interdit en espérant que le drain fera le ménage le
    // laisserait lisible dans une table de production, et un drain d'une version
    // antérieure l'écrirait tel quel.
    const depot = LIB.slice(LIB.indexOf("export async function deposerLot"));
    expect(depot).toContain("filtrerParBarrieres(client, sousLot)");
    expect(depot).toContain("if (filtre.total > 0 && !porteDeLaTelemetrie(filtre.rows)) return;");
  });

  it("un lot multi-app est scindé au dépôt, pour que le verrou soit exact", () => {
    // Une ligne de file portant l'app A mais contenant des collections de B
    // ferait écrire dans B sous le verrou de A, c'est-à-dire sans verrou.
    expect(LIB).toContain("export function scinderParApp");
    expect(LIB.slice(LIB.indexOf("export async function deposerLot"))).toContain("scinderParApp(rows, appId)");
  });
});

describe("l'effacement d'un client et la santé interne", () => {
  it("erase_app_data vide la file EN PREMIER", () => {
    // Un lot en attente réintroduirait, quelques secondes après l'effacement,
    // exactement les données effacées. L'ordre est donc une propriété, pas un
    // détail de mise en page.
    const fn = V63.slice(V63.indexOf("create or replace function erase_app_data"));
    const corps = fn.slice(0, fn.indexOf("end $$;"));
    expect(corps.indexOf("delete from ingest_raw")).toBeGreaterThan(0);
    expect(corps.indexOf("delete from ingest_raw")).toBeLessThan(corps.indexOf("delete from rum_metric"));
  });

  it("expose la file, les lots abandonnés et l'âge du plus vieux", () => {
    // Une file qui monte est ce qu'un redémarrage perdrait : ce n'est pas un
    // détail de performance, c'est une quantité de données en sursis.
    const noms = healthToMetrics({
      ingest_metrics_5m: 0, ingest_pageviews_5m: 0, ingest_errors_5m: 0, ingest_sessions_5m: 0,
      apps_active: 0, alerts_unacked: 0, deliveries_queued: 0, deliveries_failed: 0,
      deliveries_dead: 0, metering_lag_hours: null, apps_route_capped: 0, routes_max: 0,
      ingest_backlog: 12, ingest_backlog_blocked: 1, ingest_backlog_age_s: 3.5,
    }).map((m) => m.name);
    expect(noms).toContain("miprum_ingest_backlog");
    expect(noms).toContain("miprum_ingest_backlog_blocked");
    expect(noms).toContain("miprum_ingest_backlog_age_seconds");
  });

  it("le drain tourne près du receveur, pas dans le planificateur horaire", () => {
    // Drainer toutes les cinq minutes rendrait la console aveugle cinq minutes
    // et ferait grossir une table qu'un redémarrage vide.
    expect(SERVICE).toContain("drainerIngestRaw");
    expect(lire("packages/backend/jobs/planifie.mjs")).not.toContain("drainerIngestRaw");
  });
});

describe("les chiffres du banc de charge", () => {
  it("le banc mesure les DEUX modes, en alternance, sur le vrai receveur", () => {
    // Mesurer un seul mode ne dit rien ; mesurer les deux dans le même ordre
    // laisserait le second profiter des caches du premier.
    const banc = lire("scripts/bench-ingest.mjs");
    expect(banc).toContain("creerReceveur");
    expect(banc).toContain("const sync1 = await mesurer(false");
    expect(banc).toContain("const diff1 = await mesurer(true");
    expect(banc).toContain("const sync2 = await mesurer(false");
  });

  it("le lot du banc est réaliste, pas un span isolé", () => {
    // Un lot d'un seul span mesurerait le coût fixe et pas le coût réel.
    const banc = lire("scripts/bench-ingest.mjs");
    expect(banc).toContain("17 spans par requête");
    expect(banc).toContain("webvital.${m}");
  });
});
