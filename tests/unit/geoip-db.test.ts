// P8.7 — chargement de la base DB-IP, et les cinq façons de ne pas en avoir.
//
// Ce que ce fichier prouve : qu'une base absente, mal nommée, périmée, datée du
// futur ou corrompue n'empêche RIEN — le chargeur renvoie un refus nommé, et
// l'ingestion continue sans GeoIP. C'est la condition posée par la spec : P6
// fonctionne sans fournisseur.
//
// La livraison RÉELLE de DB-IP n'est pas versionnée dans le dépôt (4,5 Mio par
// mois). Les tests portent sur une base de fixture réduite, écrite à la main, au
// format exact du fichier réel — ZZ compris. Un test supplémentaire s'exécute
// contre la vraie base si elle a été déposée.
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM partagé, sans déclarations
import { AGE_MAX_JOURS_DEFAUT, chargerGeoip, cheminBase, creerGeoip, DOSSIER_DONNEES } from "../../packages/backend/lib/geoip-db.mjs";

const FIXTURES = join(__dirname, "..", "fixtures");
const FIXTURE = join(FIXTURES, "dbip-country-lite-2026-09.csv");
/** 18 septembre 2026 : la fixture a 17 jours. */
const MAINTENANT = Date.UTC(2026, 8, 18);
const muet = { info() {}, warn() {}, error() {} };

describe("chargerGeoip — la base de fixture", () => {
  it("charge, rend sa version et résout les deux familles", async () => {
    const r = await chargerGeoip({ chemin: FIXTURE, maintenant: MAINTENANT });
    expect(r.ok).toBe(true);
    expect(r.version).toBe("dbip-country-lite-2026-09");
    expect(r.stats.age_jours).toBe(17);
    expect(r.pays("212.27.38.253")).toBe("FR");
    expect(r.pays("2a01:cb00::1")).toBe("FR");
    expect(r.pays("10.0.0.1")).toBeNull();
  });
});

describe("chargerGeoip — les refus, tous nommés, aucun fatal", () => {
  it("aucun chemin", async () => {
    expect(await chargerGeoip({ chemin: null })).toMatchObject({ ok: false, raison: "geoip_db_absente" });
  });

  it("un nom qui ne porte pas sa version : on ne charge pas une base qu'on ne saurait pas dater", async () => {
    expect(await chargerGeoip({ chemin: join(FIXTURES, "dbip-country-lite.csv"), maintenant: MAINTENANT }))
      .toMatchObject({ ok: false, raison: "geoip_db_nom_invalide" });
    expect(await chargerGeoip({ chemin: join(FIXTURES, "GeoLite2-Country.mmdb"), maintenant: MAINTENANT }))
      .toMatchObject({ ok: false, raison: "geoip_db_nom_invalide" });
  });

  it("PÉRIMÉE : refusée, pas utilisée en dégradé", async () => {
    // Le même fichier, lu deux ans plus tard. Rien n'a changé sur le disque —
    // c'est la donnée qui a vieilli, et les plages se réattribuent.
    const vieille = await chargerGeoip({ chemin: FIXTURE, maintenant: Date.UTC(2028, 8, 18) });
    expect(vieille).toMatchObject({ ok: false, raison: "geoip_db_perimee" });
    expect(vieille.detail.age_jours).toBeGreaterThan(AGE_MAX_JOURS_DEFAUT);
    // Une tolérance plus large la ré-accepte : c'est une décision d'exploitation,
    // pas une constante du code.
    expect(await chargerGeoip({ chemin: FIXTURE, maintenant: Date.UTC(2028, 8, 18), ageMaxJours: 3650 }))
      .toMatchObject({ ok: true });
  });

  it("datée du futur : une horloge fausse n'est pas plus crédible qu'une base vieille", async () => {
    expect(await chargerGeoip({ chemin: FIXTURE, maintenant: Date.UTC(2024, 0, 1) }))
      .toMatchObject({ ok: false, raison: "geoip_db_datee_futur" });
  });

  it("fichier absent du disque", async () => {
    expect(await chargerGeoip({ chemin: join(FIXTURES, "dbip-country-lite-2026-08.csv.gz"), maintenant: MAINTENANT }))
      .toMatchObject({ ok: false, raison: "geoip_db_illisible" });
  });

  it("un `.gz` qui n'en est pas un : refus nommé, pas une exception qui remonte", async () => {
    const dossier = await mkdtemp(join(tmpdir(), "p87-"));
    try {
      const faux = join(dossier, "dbip-country-lite-2026-09.csv.gz");
      await writeFile(faux, "1.0.0.0,1.0.0.255,AU\n"); // du texte clair sous un nom compressé
      expect(await chargerGeoip({ chemin: faux, maintenant: MAINTENANT }))
        .toMatchObject({ ok: false, raison: "geoip_db_decompression" });
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  });

  it("une base illisible en contenu est refusée sans rien casser", async () => {
    const dossier = await mkdtemp(join(tmpdir(), "p87-"));
    try {
      const casse = join(dossier, "dbip-country-lite-2026-09.csv");
      await writeFile(casse, "ceci n'est pas une base\ndu tout\n");
      expect(await chargerGeoip({ chemin: casse, maintenant: MAINTENANT }))
        .toMatchObject({ ok: false, raison: "geoip_db_illisible" });
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  });

  it("ne lève jamais, quel que soit le chemin", async () => {
    for (const chemin of [undefined, "", "/", "/dev/null", 42]) {
      await expect(chargerGeoip({ chemin: chemin as never, maintenant: MAINTENANT })).resolves.toMatchObject({ ok: false });
    }
  });
});

describe("cheminBase — la base se dépose, elle ne se configure pas forcément", () => {
  it("GEOIP_DB_PATH prime sur tout", async () => {
    expect(await cheminBase({ GEOIP_DB_PATH: "/opt/geo/dbip-country-lite-2026-09.csv.gz" }, FIXTURES))
      .toBe("/opt/geo/dbip-country-lite-2026-09.csv.gz");
  });

  it("sinon, la livraison la plus récente du dossier de données", async () => {
    const trouve = await cheminBase({}, FIXTURES);
    expect(trouve).toBe(FIXTURE);
  });

  it("un dossier sans livraison, ou inexistant, ne rend rien", async () => {
    expect(await cheminBase({}, join(FIXTURES, "dossier-qui-n-existe-pas"))).toBeNull();
  });

  it("le dossier de données IGNORE les livraisons : elles se déposent, elles ne se committent pas", async () => {
    // La livraison réelle pèse 4,5 Mio et se renouvelle tous les mois. La
    // committer ferait grossir l'historique de git — définitivement — d'une
    // donnée qui se périme. Ce test garde la décision visible : si quelqu'un
    // retire cette ligne, c'est en conscience, pas par accident.
    const ignore = await readFile(join(DOSSIER_DONNEES, ".gitignore"), "utf8");
    expect(ignore).toContain("dbip-country-lite-*.csv");
  });
});

describe("creerGeoip — le résolveur du processus", () => {
  it("sans base déposée : éteint, et `resoudre` rend null sans lever", async () => {
    const g = creerGeoip({ env: {}, log: muet, dossier: join(FIXTURES, "vide") });
    await g.pret;
    expect(g.etat()).toBe("eteint");
    expect(g.raison()).toBe("geoip_db_absente");
    expect(g.version()).toBeNull();
    expect(g.resoudre("212.27.38.253")).toBeNull();
  });

  it("avec la fixture : actif, et la résolution porte sa version", async () => {
    const g = creerGeoip({ env: { GEOIP_DB_PATH: FIXTURE }, log: muet, maintenant: () => MAINTENANT });
    await g.pret;
    expect(g.etat()).toBe("actif");
    expect(g.version()).toBe("dbip-country-lite-2026-09");
    expect(g.resoudre("212.27.38.253")).toEqual({ country: "FR", version: "dbip-country-lite-2026-09" });
    expect(g.resoudre("2a02:2698::5")).toEqual({ country: "RU", version: "dbip-country-lite-2026-09" });
    expect(g.resoudre("10.0.0.1")).toBeNull();
    expect(g.resoudre(null)).toBeNull();
  });

  it("AVANT LA FIN DU CHARGEMENT, la résolution rend null — jamais une attente", () => {
    const g = creerGeoip({ env: { GEOIP_DB_PATH: FIXTURE }, log: muet, maintenant: () => MAINTENANT });
    expect(g.etat()).toBe("chargement");
    expect(g.resoudre("212.27.38.253")).toBeNull();
    return g.pret;
  });

  it("une base périmée éteint GeoIP au lieu de répondre faux", async () => {
    const g = creerGeoip({
      env: { GEOIP_DB_PATH: FIXTURE, GEOIP_MAX_AGE_DAYS: "30" },
      log: muet,
      maintenant: () => Date.UTC(2027, 8, 18),
    });
    await g.pret;
    expect(g.etat()).toBe("eteint");
    expect(g.raison()).toBe("geoip_db_perimee");
    expect(g.resoudre("212.27.38.253")).toBeNull();
  });

  it("GEOIP_MAX_AGE_DAYS absurde retombe sur le défaut plutôt que de tout éteindre", async () => {
    const g = creerGeoip({
      env: { GEOIP_DB_PATH: FIXTURE, GEOIP_MAX_AGE_DAYS: "pas un nombre" },
      log: muet,
      maintenant: () => MAINTENANT,
    });
    await g.pret;
    expect(g.etat()).toBe("actif");
  });
});

// La vraie livraison DB-IP n'est pas dans le dépôt. Quand elle a été déposée
// (`node scripts/fetch-geoip-db.mjs`), on vérifie que le parseur la lit
// INTÉGRALEMENT — zéro ligne rejetée — et que les deux familles répondent.
describe("la livraison réelle, si elle a été déposée", () => {
  it("se charge sans rejeter une seule ligne", async () => {
    const chemin = await cheminBase({});
    if (!chemin) return; // base non déposée : le reste du lot fonctionne sans elle
    const r = await chargerGeoip({ chemin, maintenant: MAINTENANT, ageMaxJours: 36_500 });
    expect(r.ok, r.raison).toBe(true);
    expect(r.stats.ignorees).toBe(0);
    expect(r.stats.v4).toBeGreaterThan(100_000);
    expect(r.stats.v6).toBeGreaterThan(100_000);
    expect(r.pays("212.27.38.253")).toMatch(/^[A-Z]{2}$/);
    expect(r.pays("10.0.0.1")).toBeNull();
  }, 30_000);
});
