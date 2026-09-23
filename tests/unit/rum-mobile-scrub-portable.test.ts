// P7.2 — le scrub PORTABLE du SDK mobile doit se comporter exactement comme le
// scrub d'ingestion.
//
// Le corpus n'est pas réécrit : chaque cas est joué contre LES DEUX
// implémentations et leurs sorties sont comparées. Une divergence — un motif
// ajouté d'un côté, un ordre de passes modifié de l'autre — devient un échec de
// test au lieu d'une fuite silencieuse sur le disque d'un téléphone.
import { describe, expect, it } from "vitest";
import {
  scrubAttributesPourDisque,
  scrubProps,
  scrubText,
  scrubUrl,
} from "../../packages/rum-mobile/src/scrub";
import {
  scrubProps as scrubPropsServeur,
  scrubText as scrubTextServeur,
  scrubUrl as scrubUrlServeur,
  // @ts-expect-error module JS partagé sans déclarations
} from "../../packages/backend/shared/scrub.mjs";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";

/** Corpus de `tests/unit/scrub.test.ts`, rejoué contre les deux implémentations. */
const TEXTES = [
  "contact jean.dupont@client.fr svp",
  "Authorization: Bearer abc.def.ghi123",
  `token ${JWT}`,
  "key sk-ABCDEFGH1234",
  "apiKey mip_0123456789abcdef",
  "password=hunter2 and x=1",
  '{"api_key":"s3cr3tvalue"}',
  "carte 4111 1111 1111 1111 refusée",
  "from 192.168.1.42 denied",
  "TypeError at line 42, col 7",
  "at Object.Module.exports (app.js)",
  "Basic QWxhZGRpbjpvcGVuU2VzYW1l",
  "",
];

const URLS = [
  "https://x.fr/cb?token=abc123&u=2#frag",
  "https://x.fr/u/jean@client.fr/profil",
  "https://x.fr/aos/12345",
  "https://x.fr/k/mip_0123456789abcdef",
];

describe("scrub portable — parité stricte avec le scrub d'ingestion", () => {
  it("scrubText : même sortie sur tout le corpus serveur", () => {
    for (const texte of TEXTES) {
      expect(scrubText(texte), `texte : ${texte}`).toBe(scrubTextServeur(texte));
    }
  });

  it("scrubText : une entrée non-string rend null des deux côtés", () => {
    for (const valeur of [undefined, null, 42, {}, []]) {
      expect(scrubText(valeur)).toBe(scrubTextServeur(valeur));
      expect(scrubText(valeur)).toBeNull();
    }
  });

  it("scrubUrl : même sortie, query et fragment retirés", () => {
    for (const url of URLS) {
      expect(scrubUrl(url), `url : ${url}`).toBe(scrubUrlServeur(url));
    }
    expect(scrubUrl(null)).toBeNull();
  });

  it("scrubProps : même arbre nettoyé, clefs sensibles masquées", () => {
    const props = {
      password: "x",
      note: "mail a@b.fr",
      amount: 12,
      vrai: true,
      nul: null,
      nested: { token: "t", email: "a@b.fr", liste: ["carte 4111 1111 1111 1111", 7] },
    };
    expect(scrubProps(props)).toEqual(scrubPropsServeur(props));
    expect(scrubProps(props)).toMatchObject({
      password: "[redacted]",
      note: "mail [email]",
      amount: 12,
      nested: { token: "[redacted]", email: "[redacted]" },
    });
  });

  it("scrubProps : profondeur bornée des deux côtés, sans lever", () => {
    let o: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i++) o = { child: o };
    expect(() => JSON.stringify(scrubProps(o))).not.toThrow();
    expect(scrubProps(o)).toEqual(scrubPropsServeur(o));
  });
});

describe("scrubAttributesPourDisque — ce qui n'a pas le droit de dormir sur un disque", () => {
  it("retire identités brutes et clef d'API, garde les identifiants techniques", () => {
    const propre = scrubAttributesPourDisque({
      "mip.session_id": "sess-1",
      "mip.visitor_id": "v-1",
      "mip.identity.user_id": "alice@example.test",
      "mip.identity.account_id": "customer-42",
      "mip.api_key": "mip_0123456789abcdef",
      "http.status_code": 200,
      "mip.timing_ms": 12,
    });
    expect(propre["mip.identity.user_id"]).toBeUndefined();
    expect(propre["mip.identity.account_id"]).toBeUndefined();
    expect(propre["mip.api_key"]).toBeUndefined();
    // Les identifiants TECHNIQUES restent : sans eux, le serveur ne peut pas
    // rattacher l'événement à la session qu'il connaît déjà, et l'ingestion ne
    // peut plus le dédoublonner au rejeu.
    expect(propre["mip.session_id"]).toBe("sess-1");
    expect(propre["mip.visitor_id"]).toBe("v-1");
    expect(propre["http.status_code"]).toBe(200);
    expect(propre["mip.timing_ms"]).toBe(12);
  });

  it("nettoie message, stack et URL selon leur nature", () => {
    const propre = scrubAttributesPourDisque({
      "exception.message": "login failed for jean@client.fr password=hunter2",
      "exception.stacktrace": "at auth (app.js) Bearer abc.def.ghijklmno",
      "http.url": "https://api.fr/cart?token=zzz",
      "mip.url": "/u/12345",
    });
    expect(propre["exception.message"]).toBe("login failed for [email] password=[redacted]");
    expect(propre["exception.stacktrace"]).toContain("Bearer [redacted]");
    // L'URL perd sa query ; son identifiant numérique de chemin reste utile.
    expect(propre["http.url"]).toBe("https://api.fr/cart");
    expect(propre["mip.url"]).toBe("/u/12345");
  });

  it("nettoie props et contexte STRUCTURELLEMENT, pas en texte plat", () => {
    const propre = scrubAttributesPourDisque({
      "mip.props": JSON.stringify({ email: "a@b.fr", plan: "pro", amount: 42 }),
      "mip.context": JSON.stringify({ role: "admin", token: "s3cr3t" }),
    });
    // Le NOM de la clef porte la sensibilité : « email » vaut [redacted], pas
    // [email] — l'appliquer en texte plat perdrait cette information.
    expect(JSON.parse(String(propre["mip.props"]))).toEqual({
      email: "[redacted]", plan: "pro", amount: 42,
    });
    expect(JSON.parse(String(propre["mip.context"]))).toEqual({
      role: "admin", token: "[redacted]",
    });
  });

  it("un attribut JSON illisible retombe sur le nettoyage texte, sans lever", () => {
    const propre = scrubAttributesPourDisque({ "mip.props": "{ceci n'est pas du json a@b.fr" });
    expect(String(propre["mip.props"])).toContain("[email]");
    expect(String(propre["mip.props"])).not.toContain("a@b.fr");
  });
});
