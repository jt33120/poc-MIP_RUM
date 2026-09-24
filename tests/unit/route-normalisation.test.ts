// migration-v62 — ce qu'on peut vérifier SANS moteur : les invariants de forme.
//
// Le comportement (normalisation, plafond, rattrapage, effacement) est vérifié
// sur un vrai PostgreSQL par tests/integration/route-cardinalite-sql.test.ts.
// Ce fichier verrouille ce qu'une relecture laisserait passer : une table
// oubliée dans une énumération, un déclencheur posé sur UPDATE, une table de
// données sans déclencheur du tout.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healthToMetrics } from "../../apps/console/lib/metrics-format";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const V62 = lire("packages/db/sql/migration-v62.sql");

/** Les tables de DONNÉES portant une route, telles que la migration les énumère. */
const TABLES = [
  "rum_metric", "rum_pageview", "rum_error", "rum_longtask",
  "rum_resource", "rum_event", "rum_span", "rum_log", "rum_ai",
];

describe("le déclencheur couvre toutes les tables de données, et elles seules", () => {
  it.each(TABLES)("%s est dans la liste du déclencheur", (t) => {
    const bloc = V62.slice(V62.indexOf("foreach t in array"), V62.indexOf("execute function mip_trigger_route()"));
    expect(bloc).toContain(`'${t}'`);
  });

  it("ne pose RIEN sur alert_rule ni sur slo", () => {
    // Les deux portent une colonne `route`, mais comme FILTRE de configuration :
    // la réécrire changerait ce qu'un client surveille. Marqueur négatif, borné
    // au bloc du déclencheur ET à celui du rattrapage — `alert_rule` apparaît
    // légitimement ailleurs, dans l'effacement d'un client.
    const listeDeclencheur = V62.slice(
      V62.indexOf("foreach t in array"),
      V62.indexOf("execute function mip_trigger_route()"),
    );
    const backfill = V62.slice(V62.indexOf("create or replace function backfill_route_patterns"));
    for (const bloc of [listeDeclencheur, backfill.slice(0, backfill.indexOf("end $$;"))]) {
      expect(bloc).not.toContain("'alert_rule'");
      expect(bloc).not.toContain("'slo'");
    }
  });

  it("est BEFORE INSERT, jamais BEFORE UPDATE", () => {
    // Le rattrapage d'historique écrit des routes DÉJÀ normalisées ; les repasser
    // dans le plafond ferait basculer en (other) des routes antérieures à lui.
    expect(V62).toContain("before insert on %1$I");
    expect(V62).not.toMatch(/before\s+(insert\s+or\s+)?update/i);
  });

  it("ne se déclenche pas sur une route absente", () => {
    // `when (new.route is not null)` : une ligne sans route ne paie pas les deux
    // recherches mesurées ci-dessous.
    expect(V62).toContain("when (new.route is not null)");
  });
});

describe("les trois tables entrent dans les énumérations qui comptent", () => {
  it.each(["route_pattern", "route_registry", "route_cardinality"])(
    "l'effacement d'un client supprime %s",
    (t) => {
      const bloc = V62.slice(V62.indexOf("create or replace function erase_app_data"));
      expect(bloc.slice(0, bloc.indexOf("end $$;"))).toMatch(
        new RegExp(`delete from ${t}\\s+where app_id = p_app_id`),
      );
    },
  );

  it("elles ne sont PAS dans la purge de rétention, et c'est écrit", () => {
    // Un motif et un registre de routes ne sont pas de la télémétrie datée : les
    // effacer au bout de 30 jours perdrait la configuration du client et ferait
    // repartir le plafond de zéro. Décision explicite, pas un oubli.
    expect(V62).not.toContain("purge_rum_app");
    expect(V62.replace(/\s+/g, " ")).toContain("Pas dans la purge de RÉTENTION");
  });

  it.each(["route_pattern", "route_registry", "route_cardinality"])("%s est sous RLS", (t) => {
    expect(V62).toContain(`'${t}'`);
    expect(V62).toContain("create policy tenant_scope on %I for select to console_ro");
  });
});

describe("les chiffres cités sont ceux d'un banc qui existe", () => {
  it("le banc de mesure est dans le dépôt et compare bien avec et sans", () => {
    // Une performance annoncée sans banc est une opinion. Celui-ci alterne les
    // passes pour que l'ordre ne décide pas du gagnant.
    const banc = lire("scripts/bench-route-trigger.mjs");
    expect(banc).toContain("poserDeclencheurs");
    expect(banc).toContain("SURCOÛT");
    expect(banc).toContain("passes alternées");
  });

  it("la migration cite une FOURCHETTE, pas un chiffre flatteur", () => {
    // Trois exécutions ont donné 8, 12 et 16 µs. Publier « 8 µs » serait choisir
    // la plus belle des trois.
    expect(V62).toContain("8 à 16 µs");
    expect(V62).toContain("+25 à +66 %");
  });

  it("ne prétend pas que la réécriture SQL a fait gagner ce qu'elle n'a pas gagné", () => {
    // La version SQL de mip_normaliser_route mesure 7,4 µs contre 8,0 pour la
    // boucle PL/pgSQL. Le commentaire le dit au lieu de vendre l'optimisation.
    const fn = V62.slice(V62.indexOf("create or replace function mip_normaliser_route"));
    expect(fn.slice(0, fn.indexOf("$$;"))).toContain("SANS le gain qu'on en attendait");
  });
});

describe("la perte de détail est visible dans la santé interne", () => {
  it("expose le nombre d'applications au plafond en Prometheus", () => {
    // Une application au plafond n'est pas en panne : elle a cessé de distinguer
    // ses nouvelles routes. Sans compteur, c'est un silence.
    const noms = healthToMetrics({
      ingest_metrics_5m: 0, ingest_pageviews_5m: 0, ingest_errors_5m: 0, ingest_sessions_5m: 0,
      apps_active: 0, alerts_unacked: 0, deliveries_queued: 0, deliveries_failed: 0,
      deliveries_dead: 0, metering_lag_hours: null, apps_route_capped: 2, routes_max: 2000,
    }).map((m) => m.name);
    expect(noms).toContain("miprum_apps_route_capped");
    expect(noms).toContain("miprum_routes_max");
  });

  it("la page /admin/health dit quoi FAIRE, pas seulement qu'il y a un problème", () => {
    // « Apps au plafond : 3 » sans suite ne sert à rien. La bonne réponse est
    // d'écrire des motifs, pas de relever le plafond.
    const page = lire("apps/console/app/admin/health/page.tsx");
    expect(page).toContain("apps_route_capped");
    expect(page).toContain("route_pattern");
    expect(page.replace(/\s+/g, " ")).toContain("pas un plafond plus haut");
  });
});
