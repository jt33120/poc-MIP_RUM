// P8.7 — d'où vient l'adresse IP du client, et comment un client ne peut pas la
// choisir à notre place.
//
// Le cœur de ce fichier est la TENTATIVE DE FALSIFICATION : un visiteur qui
// écrit lui-même `X-Forwarded-For: 1.2.3.4` dans sa requête. Prendre le premier
// élément de la chaîne — le geste réflexe — lui donnerait le pays de son choix.
// On vérifie ici qu'aucun mode ne le permet, et que le mode par défaut ne lit
// aucune adresse du tout.
import { describe, expect, it } from "vitest";
// @ts-expect-error module ESM partagé, sans déclarations
import { ipClient, MAX_HOPS, parseSourceIp } from "../../apps/ingest/supabase/functions/_shared/client-ip.mjs";

/** Requête Node : en-têtes déjà en minuscules, socket éventuelle. */
const req = (headers: Record<string, string | string[]> = {}, remoteAddress?: string) =>
  ({ headers, socket: remoteAddress ? { remoteAddress } : {} });

const EDGE = { "x-railway-request-id": "01J0000000000000000000000" };

describe("parseSourceIp — la façade se déclare, elle ne se devine pas", () => {
  it("le défaut ne lit RIEN : sans déclaration, GeoIP reste éteint", () => {
    expect(parseSourceIp(undefined)).toEqual({ mode: "none" });
    expect(parseSourceIp(null)).toEqual({ mode: "none" });
    expect(parseSourceIp("")).toEqual({ mode: "none" });
    expect(parseSourceIp("   ")).toEqual({ mode: "none" });
    expect(parseSourceIp("none")).toEqual({ mode: "none" });
  });

  it("les modes reconnus, insensibles à la casse", () => {
    expect(parseSourceIp("socket")).toEqual({ mode: "socket" });
    expect(parseSourceIp("Railway")).toEqual({ mode: "railway" });
    expect(parseSourceIp("XFF:2")).toEqual({ mode: "xff", hops: 2 });
    expect(parseSourceIp(` xff:${MAX_HOPS} `)).toEqual({ mode: "xff", hops: MAX_HOPS });
  });

  it("une déclaration incohérente est INVALIDE, jamais rabattue sur un défaut permissif", () => {
    for (const brut of ["xff", "xff:0", `xff:${MAX_HOPS + 1}`, "xff:-1", "xff:abc", "cloudflare", "true", "1"]) {
      expect(parseSourceIp(brut), brut).toMatchObject({ mode: "invalide" });
    }
  });
});

describe("ipClient — mode `none`, le défaut", () => {
  it("ne lit aucune adresse, même quand tous les en-têtes sont là", () => {
    const r = req({ ...EDGE, "x-real-ip": "9.9.9.9", "x-forwarded-for": "8.8.8.8" }, "7.7.7.7");
    expect(ipClient(r, parseSourceIp("none"))).toBeNull();
    expect(ipClient(r, parseSourceIp("xff"))).toBeNull(); // déclaration invalide = rien
  });
});

describe("ipClient — mode `socket` : la connexion, et rien d'autre", () => {
  it("rend l'adresse de la connexion et IGNORE les en-têtes", () => {
    const r = req({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }, "203.0.113.7");
    expect(ipClient(r, parseSourceIp("socket"))).toBe("203.0.113.7");
  });

  it("sans socket, rien", () => {
    expect(ipClient(req({ "x-forwarded-for": "1.2.3.4" }), parseSourceIp("socket"))).toBeNull();
  });
});

describe("ipClient — mode `railway`", () => {
  it("lit X-Real-IP quand un marqueur d'arête Railway est présent", () => {
    expect(ipClient(req({ ...EDGE, "x-real-ip": "212.27.38.253" }), parseSourceIp("railway")))
      .toBe("212.27.38.253");
    expect(ipClient(req({ "x-railway-edge": "amsterdam", "x-real-ip": "212.27.38.253" }), parseSourceIp("railway")))
      .toBe("212.27.38.253");
  });

  it("SANS marqueur d'arête, rien — un appel qui n'est pas passé par la façade ne se fait pas passer pour elle", () => {
    expect(ipClient(req({ "x-real-ip": "1.2.3.4" }), parseSourceIp("railway"))).toBeNull();
  });

  it("X-Forwarded-For n'est jamais lu dans ce mode", () => {
    expect(ipClient(req({ ...EDGE, "x-forwarded-for": "1.2.3.4" }), parseSourceIp("railway"))).toBeNull();
  });

  it("en-tête dupliqué : on garde le DERNIER, celui du relais le plus proche", () => {
    // Node concatène les doublons. Le client a pu écrire le premier ; seul un
    // relais peut avoir écrit le dernier.
    expect(ipClient(req({ ...EDGE, "x-real-ip": "1.2.3.4, 212.27.38.253" }), parseSourceIp("railway")))
      .toBe("212.27.38.253");
    expect(ipClient(req({ ...EDGE, "x-real-ip": ["1.2.3.4, 212.27.38.253"] }), parseSourceIp("railway")))
      .toBe("212.27.38.253");
  });
});

describe("ipClient — mode `xff:<n>` : la tentative de falsification par proxy", () => {
  const un = parseSourceIp("xff:1");
  const deux = parseSourceIp("xff:2");

  it("un relais de confiance : l'adresse est la dernière de la chaîne", () => {
    expect(ipClient(req({ "x-forwarded-for": "212.27.38.253" }), un)).toBe("212.27.38.253");
  });

  it("LE CLIENT FORGE UN PRÉFIXE : il est ignoré par construction", () => {
    // Le visiteur envoie `X-Forwarded-For: 1.2.3.4` ; le relais de confiance y
    // ajoute l'adresse qu'il a VUE. Avec un relais déclaré, on lit la sienne.
    expect(ipClient(req({ "x-forwarded-for": "1.2.3.4, 212.27.38.253" }), un)).toBe("212.27.38.253");
    expect(ipClient(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9, 212.27.38.253" }), un))
      .toBe("212.27.38.253");
  });

  it("deux relais de confiance : on remonte de deux, pas de la chaîne entière", () => {
    expect(ipClient(req({ "x-forwarded-for": "1.2.3.4, 212.27.38.253, 10.0.0.1" }), deux)).toBe("212.27.38.253");
  });

  it("une chaîne trop courte pour la déclaration ne rend rien plutôt qu'une adresse de relais", () => {
    expect(ipClient(req({ "x-forwarded-for": "212.27.38.253" }), deux)).toBeNull();
    expect(ipClient(req({}), un)).toBeNull();
    expect(ipClient(req({ "x-forwarded-for": "" }), un)).toBeNull();
  });

  it("espaces et éléments vides ne décalent pas le comptage", () => {
    expect(ipClient(req({ "x-forwarded-for": " 1.2.3.4 ,, 212.27.38.253 " }), un)).toBe("212.27.38.253");
  });
});

describe("ipClient — en-têtes façon Web (Headers de la console)", () => {
  it("lit un objet Headers aussi bien qu'un dictionnaire Node", () => {
    const r = { headers: new Headers({ "X-Railway-Request-Id": "abc", "X-Real-IP": "212.27.38.253" }) };
    expect(ipClient(r as never, parseSourceIp("railway"))).toBe("212.27.38.253");
  });
});

describe("ipClient — robustesse", () => {
  it("ne lève jamais, quelle que soit la requête", () => {
    for (const r of [null, undefined, {}, { headers: null }, { headers: {} }]) {
      for (const mode of ["none", "socket", "railway", "xff:1"]) {
        expect(() => ipClient(r as never, parseSourceIp(mode))).not.toThrow();
      }
    }
  });
});
