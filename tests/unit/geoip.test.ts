// P8.7 — résolution IP → pays en mémoire, et provenance du pays.
//
// Ce que ce fichier prouve : qu'une adresse forgée, tronquée ou ambiguë n'est
// jamais lue ; qu'une plage privée, de documentation ou non attribuée rend
// « inconnu » MÊME QUAND LA BASE LUI DONNE UN PAYS (c'est le cas réel de
// `fec0::/10`, que DB-IP attribue à CH) ; que les deux familles d'adresses sont
// résolues, IPv4 déguisée en IPv6 comprise ; qu'une base mal formée est refusée
// en bloc plutôt que réparée en silence ; et que la provenance est posée dans le
// même geste que le pays, avec la précédence annoncée.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM partagé, sans déclarations
import {
  ageEnJours,
  appliquerGeo,
  chargerBase,
  demasquer,
  estReservee,
  parseIp,
  paysDe,
  PROVENANCES,
  versionDepuisNom,
} from "../../packages/backend/shared/geoip.mjs";

const FIXTURE = join(__dirname, "..", "fixtures", "dbip-country-lite-2026-09.csv");
const csv = readFileSync(FIXTURE, "utf8");
const charge = chargerBase(csv, { version: "dbip-country-lite-2026-09" });
const base = charge.ok ? charge.base : null;
const pays = (ip: string) => paysDe(base, ip);

describe("parseIp — ce qu'on accepte de lire, et ce qu'on refuse", () => {
  it("IPv4 canonique", () => {
    expect(parseIp("0.0.0.0")).toEqual({ v: 4, a: 0 });
    expect(parseIp("255.255.255.255")).toEqual({ v: 4, a: 0xffffffff });
    expect(parseIp("212.27.38.253")).toEqual({ v: 4, a: 0xd41b26fd });
    expect(parseIp(" 8.8.8.8 ")).toEqual({ v: 4, a: 0x08080808 });
  });

  it("refuse les formes AMBIGUËS d'IPv4 — un zéro de tête se lit en octal ailleurs", () => {
    expect(parseIp("01.2.3.4")).toBeNull();
    expect(parseIp("10.1")).toBeNull(); // inet_aton en ferait 10.0.0.1
    expect(parseIp("1.2.3.4.5")).toBeNull();
    expect(parseIp("1.2.3.256")).toBeNull();
    expect(parseIp("1.2.3.")).toBeNull();
    expect(parseIp("0x7f.0.0.1")).toBeNull();
    expect(parseIp("2130706433")).toBeNull(); // entier : jamais une adresse pour nous
  });

  it("IPv6, abrégée ou non, avec ou sans queue IPv4", () => {
    expect(parseIp("::")).toEqual({ v: 6, hi: 0n, lo: 0n });
    expect(parseIp("::1")).toEqual({ v: 6, hi: 0n, lo: 1n });
    expect(parseIp("2001:db8::1")).toEqual({ v: 6, hi: 0x20010db800000000n, lo: 1n });
    expect(parseIp("2a01:cb00:0:0:0:0:0:1")).toEqual({ v: 6, hi: 0x2a01cb0000000000n, lo: 1n });
    expect(parseIp("2a01:cb00::1")).toEqual(parseIp("2a01:cb00:0:0:0:0:0:1"));
    expect(parseIp("::ffff:212.27.38.253")).toEqual({ v: 6, hi: 0n, lo: 0x0000ffffd41b26fdn });
    expect(parseIp("1:2:3:4:5:6:7.8.9.10")).toEqual(parseIp("1:2:3:4:5:6:708:90a"));
  });

  it("IPv6 : formes invalides refusées", () => {
    expect(parseIp("2001::db8::1")).toBeNull(); // deux abréviations
    expect(parseIp("1:2:3:4:5:6:7")).toBeNull(); // sept groupes sans `::`
    expect(parseIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIp("2001:db8::g")).toBeNull();
    expect(parseIp("2001:db8::12345")).toBeNull();
    expect(parseIp(":1")).toBeNull();
    expect(parseIp("::ffff:1.2.3")).toBeNull();
  });

  it("port et crochets retirés, zone d'interface ignorée", () => {
    expect(parseIp("[2a01:cb00::1]:443")).toEqual(parseIp("2a01:cb00::1"));
    expect(parseIp("212.27.38.253:4318")).toEqual(parseIp("212.27.38.253"));
    expect(parseIp("fe80::1%eth0")).toEqual(parseIp("fe80::1"));
  });

  it("rien de tout cela n'est une adresse", () => {
    for (const brut of ["", "   ", "localhost", "unknown", "-", null, undefined, 42, {}, "a".repeat(60)]) {
      expect(parseIp(brut as never)).toBeNull();
    }
  });
});

describe("demasquer — une IPv4 sous un masque IPv6", () => {
  it("::ffff:a.b.c.d redevient de l'IPv4 (forme rendue par une socket double pile)", () => {
    expect(demasquer(parseIp("::ffff:212.27.38.253"))).toEqual(parseIp("212.27.38.253"));
  });

  it("::1 n'est PAS déplié en 0.0.0.1", () => {
    expect(demasquer(parseIp("::1"))).toEqual({ v: 6, hi: 0n, lo: 1n });
  });
});

describe("estReservee — ce qui ne désigne aucun hôte public", () => {
  it("IPv4 privées, boucle locale, CGNAT, lien-local et documentation", () => {
    for (const ip of [
      "0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.1.1", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "100.64.0.1", "192.0.2.1", "198.51.100.7", "203.0.113.9", "198.18.0.1",
      "224.0.0.1", "255.255.255.255",
    ]) {
      expect(estReservee(parseIp(ip)), ip).toBe(true);
    }
  });

  it("IPv4 voisines d'une plage privée sans en être", () => {
    for (const ip of ["9.255.255.255", "11.0.0.1", "172.15.255.255", "172.32.0.1", "192.167.255.255", "100.128.0.1"]) {
      expect(estReservee(parseIp(ip)), ip).toBe(false);
    }
  });

  it("IPv6 : seul 2000::/3 est de l'unicast global", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd00::1", "fe80::1", "fec0::1", "ff02::1", "2001:db8::1", "3fff:ffff::1"]) {
      const reservee = ip.startsWith("3fff") ? false : true;
      expect(estReservee(parseIp(ip)), ip).toBe(reservee);
    }
    expect(estReservee(parseIp("2a01:cb00::1"))).toBe(false);
  });
});

describe("chargerBase — la base de fixture, et les bases qu'on refuse", () => {
  it("charge la fixture : deux familles, ZZ compté mais jamais rendu", () => {
    expect(charge.ok).toBe(true);
    expect(base.version).toBe("dbip-country-lite-2026-09");
    expect(base.stats.ignorees).toBe(0);
    expect(base.stats.v4).toBeGreaterThan(0);
    expect(base.stats.v6).toBeGreaterThan(0);
    expect(base.stats.lignes).toBe(base.stats.v4 + base.stats.v6);
  });

  it("REFUSE une base non triée plutôt que de la réparer", () => {
    const desordre = "2.16.0.0,2.16.7.255,FR\n1.0.0.0,1.0.0.255,AU\n";
    expect(chargerBase(desordre, { version: "dbip-country-lite-2026-09" }))
      .toMatchObject({ ok: false, raison: "geoip_db_non_triee" });
  });

  it("REFUSE une base dont les plages se chevauchent", () => {
    const chevauche = "1.0.0.0,1.0.1.255,AU\n1.0.1.0,1.0.3.255,CN\n";
    expect(chargerBase(chevauche, { version: "v" })).toMatchObject({ ok: false, raison: "geoip_db_non_triee" });
  });

  it("REFUSE une base vide, illisible, ou majoritairement fautive", () => {
    expect(chargerBase("", { version: "v" })).toMatchObject({ ok: false, raison: "geoip_db_vide" });
    expect(chargerBase("n'importe quoi\nvraiment\n", { version: "v" }))
      .toMatchObject({ ok: false, raison: "geoip_db_illisible" });
    // 1 ligne bonne, 3 fautives : au-delà de 1 % de rejet, ce n'est plus la base attendue.
    expect(chargerBase("1.0.0.0,1.0.0.255,AU\nx,y,ZZ\na,b\n1.2.3,4.5.6,FR\n", { version: "v" }))
      .toMatchObject({ ok: false, raison: "geoip_db_illisible" });
  });

  it("tolère CRLF et une dernière ligne sans saut", () => {
    const crlf = "1.0.0.0,1.0.0.255,AU\r\n2.16.0.0,2.16.7.255,FR";
    const r = chargerBase(crlf, { version: "v" });
    expect(r.ok).toBe(true);
    expect(r.base.stats.lignes).toBe(2);
    expect(paysDe(r.base, "2.16.0.1")).toBe("FR");
  });
});

describe("paysDe — ce que la base rend, et ce qu'elle ne rend jamais", () => {
  it("résout l'IPv4 aux deux bornes de chaque plage", () => {
    expect(pays("2.16.0.0")).toBe("FR");
    expect(pays("2.16.7.255")).toBe("FR");
    expect(pays("2.16.8.0")).toBe("DE");
    expect(pays("51.15.255.255")).toBe("FR");
    expect(pays("51.16.0.0")).toBe("NL");
    expect(pays("212.27.38.253")).toBe("FR");
    expect(pays("185.0.128.1")).toBe("GB");
  });

  it("résout l'IPv6, et l'IPv4 déguisée en IPv6", () => {
    expect(pays("2a01:cb00::1")).toBe("FR");
    expect(pays("2a01:cbff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe("FR");
    expect(pays("2a02:2698::5")).toBe("RU");
    expect(pays("2a03:2880:f000::1")).toBe("IE");
    expect(pays("::ffff:212.27.38.253")).toBe("FR");
  });

  it("`ZZ` n'est pas un pays", () => {
    // La ligne existe dans la base, mais elle dit « non attribué ».
    expect(csv).toContain("1.0.1.0,1.0.3.255,CN");
    expect(pays("0.0.0.1")).toBeNull();
  });

  it("une plage privée reste inconnue MÊME quand la base lui donne un pays", () => {
    // Cas réel : DB-IP attribue fec0::/10 à « CH ». Le contrôle des plages
    // réservées passe AVANT la base, sinon une adresse de réseau interne
    // ressortirait avec un pays.
    expect(csv).toContain("fec0::,ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff,CH");
    expect(pays("fec0::1")).toBeNull();
    expect(pays("10.0.0.1")).toBeNull();
    expect(pays("192.168.1.1")).toBeNull();
    expect(pays("203.0.113.9")).toBeNull();
    expect(pays("::1")).toBeNull();
  });

  it("ne lève JAMAIS, et rend null sur tout ce qui n'est pas résolu", () => {
    for (const brut of ["", "pas-une-ip", "999.999.999.999", null, undefined, 42]) {
      expect(() => paysDe(base, brut as never)).not.toThrow();
      expect(paysDe(base, brut as never)).toBeNull();
    }
    expect(paysDe(null, "8.8.8.8")).toBeNull();
    // Une adresse hors de toute plage de la fixture : inconnue, pas une erreur.
    expect(pays("99.99.99.99")).toBeNull();
  });
});

describe("versionDepuisNom / ageEnJours — l'âge se lit dans le NOM", () => {
  it("reconnaît une livraison DB-IP, compressée ou non", () => {
    expect(versionDepuisNom("dbip-country-lite-2026-09.csv.gz"))
      .toEqual({ version: "dbip-country-lite-2026-09", annee: 2026, mois: 9 });
    expect(versionDepuisNom("/opt/geoip/dbip-country-lite-2024-01.csv"))
      .toEqual({ version: "dbip-country-lite-2024-01", annee: 2024, mois: 1 });
  });

  it("refuse un nom qui ne porte pas sa version", () => {
    for (const nom of ["dbip-country-lite.csv.gz", "dbip-country-lite-2026-13.csv", "GeoLite2-Country.mmdb", "", null]) {
      expect(versionDepuisNom(nom as never), String(nom)).toBeNull();
    }
  });

  it("l'âge compte depuis le premier du mois annoncé", () => {
    const maintenant = Date.UTC(2026, 8, 18); // 18 septembre 2026
    expect(ageEnJours("dbip-country-lite-2026-09", maintenant)).toBe(17);
    expect(ageEnJours("dbip-country-lite-2024-01", maintenant)).toBeGreaterThan(900);
    expect(ageEnJours("dbip-country-lite-2026-12", maintenant)).toBeLessThan(0);
  });
});

describe("appliquerGeo — la provenance est posée avec le pays, jamais après", () => {
  const session = (over: Record<string, unknown> = {}) =>
    ({ geo_country: null, geo_source: null, geo_db_version: null, ...over });

  it("les trois provenances sont exactement celles de la contrainte v85", () => {
    expect([...PROVENANCES]).toEqual(["geoip", "timezone", "cdn"]);
  });

  it("GeoIP prime sur le fuseau, et emporte la version de base", () => {
    const s = session({ geo_country: "FR", geo_source: "timezone" });
    appliquerGeo([s], { geoip: { country: "BE", version: "dbip-country-lite-2026-09" } });
    expect(s).toEqual({ geo_country: "BE", geo_source: "geoip", geo_db_version: "dbip-country-lite-2026-09" });
  });

  it("sans GeoIP, le fuseau déjà posé est conservé — l'en-tête CDN ne l'écrase pas", () => {
    const s = session({ geo_country: "FR", geo_source: "timezone" });
    appliquerGeo([s], { cdn: "DE" });
    expect(s).toEqual({ geo_country: "FR", geo_source: "timezone", geo_db_version: null });
  });

  it("sans GeoIP ni fuseau, l'en-tête CDN est retenu ET étiqueté comme tel", () => {
    const s = session();
    appliquerGeo([s], { cdn: "de" });
    expect(s).toEqual({ geo_country: "DE", geo_source: "cdn", geo_db_version: null });
  });

  it("un en-tête CDN qui n'est pas un code pays est ignoré", () => {
    for (const cdn of ["XX1", "", "france", "F", null, undefined, 42]) {
      const s = session();
      appliquerGeo([s], { cdn: cdn as never });
      expect(s.geo_country, String(cdn)).toBeNull();
      expect(s.geo_source, String(cdn)).toBeNull();
    }
  });

  it("aucune provenance sans pays : un GeoIP qui n'a pas résolu ne marque rien", () => {
    const s = session();
    appliquerGeo([s], { geoip: null, cdn: null });
    expect(s).toEqual({ geo_country: null, geo_source: null, geo_db_version: null });
  });

  it("ne lève pas sur un lot vide ou malformé", () => {
    expect(() => appliquerGeo([], {})).not.toThrow();
    expect(() => appliquerGeo(null as never, {})).not.toThrow();
    expect(() => appliquerGeo([null, undefined] as never, { cdn: "FR" })).not.toThrow();
  });
});
