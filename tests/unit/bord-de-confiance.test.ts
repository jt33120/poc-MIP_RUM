// P2 — le bord de confiance (`mip-edge/1`) : ce que le collector croit d'un
// relais, et ce qu'il refuse de croire d'un client.
//
// Le cœur de ce fichier est la FALSIFICATION : un visiteur qui frappe le
// collector EN DIRECT peut écrire lui-même `x-vercel-ip-country: KP` ou
// `x-mip-edge-country: FR`. Aucun des deux ne doit lui donner un pays. Seul un
// relais qui présente le secret partagé (`x-mip-edge-auth`) porte un pays — et
// jamais une adresse : une requête relayée saute le GeoIP, c'est ce qui garde
// vraie la phrase publique « aucune adresse IP n'est transmise ni stockée ».
import { describe, expect, it } from "vitest";
import {
  creerBordDeConfiance,
  EDGE_PROTOCOL,
  retirerEntetesBord,
  verifierSecretsBord,
  // @ts-expect-error module ESM partagé, sans déclarations
} from "../../packages/backend/shared/client-ip.mjs";

const ANCIEN = "a".repeat(40);
const NOUVEAU = "n".repeat(40);

/** Requête Node : en-têtes en minuscules, `rawHeaders` à plat. */
function req(headers: Record<string, string>) {
  const rawHeaders = Object.entries(headers).flat();
  return { headers: { ...headers }, rawHeaders };
}

describe("protocole", () => {
  it("porte un nom STABLE, que le relais (P3) vérifiera sur /health", () => {
    expect(EDGE_PROTOCOL).toBe("mip-edge/1");
  });
});

describe("requête directe (aucune signature)", () => {
  it("absente : mode direct, aucun pays, rien à retirer", () => {
    const bord = creerBordDeConfiance([ANCIEN]);
    expect(bord.lire(req({ "content-type": "application/json" }))).toEqual({ mode: "direct", pays: null, forges: 0 });
  });

  it("les en-têtes pays de CDN sont IGNORÉS hors requête authentifiée", () => {
    const bord = creerBordDeConfiance([ANCIEN]);
    const r = req({ "x-vercel-ip-country": "KP", "cf-ipcountry": "KP" });
    expect(bord.lire(r)).toMatchObject({ mode: "direct", pays: null });
  });

  it("un pays de bord FORGÉ est ignoré, retiré, et compté", () => {
    const bord = creerBordDeConfiance([ANCIEN]);
    const r = req({ "x-mip-edge-country": "FR", "x-mip-edge-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" });
    expect(bord.lire(r)).toEqual({ mode: "direct", pays: null, forges: 2 });
    expect(Object.keys(r.headers)).toEqual(["x-forwarded-for"]);
    expect(r.rawHeaders).toEqual(["x-forwarded-for", "1.2.3.4"]);
  });

  it("sans secret configuré, même comportement : aucun pays ne s'achète par un en-tête", () => {
    const bord = creerBordDeConfiance(undefined);
    expect(bord.actif).toBe(false);
    expect(bord.lire(req({ "x-mip-edge-country": "FR" }))).toMatchObject({ mode: "direct", pays: null, forges: 1 });
  });
});

describe("requête signée", () => {
  it("valide : mode relayé, le pays du relais", () => {
    const bord = creerBordDeConfiance([ANCIEN]);
    const r = req({ "x-mip-edge-auth": ANCIEN, "x-mip-edge-country": "FR" });
    expect(bord.lire(r)).toEqual({ mode: "relaye", pays: "FR", forges: 0 });
    // Le secret lui-même ne survit pas à la lecture : aucun code en aval ne
    // peut le relire, le journaliser ou le recopier.
    expect(r.headers).toEqual({});
    expect(r.rawHeaders).toEqual([]);
  });

  it("valide sans x-mip-edge-country : repli sur l'en-tête du CDN, AUTORISÉ ici seulement", () => {
    const bord = creerBordDeConfiance([ANCIEN]);
    expect(bord.lire(req({ "x-mip-edge-auth": ANCIEN, "x-vercel-ip-country": "BE" }))).toMatchObject({ mode: "relaye", pays: "BE" });
    expect(bord.lire(req({ "x-mip-edge-auth": ANCIEN, "cf-ipcountry": "CH" }))).toMatchObject({ mode: "relaye", pays: "CH" });
  });

  it("rotation : l'ancienne ET la nouvelle valeur sont acceptées", () => {
    const bord = creerBordDeConfiance([ANCIEN, NOUVEAU]);
    expect(bord.lire(req({ "x-mip-edge-auth": ANCIEN, "x-mip-edge-country": "FR" })).mode).toBe("relaye");
    expect(bord.lire(req({ "x-mip-edge-auth": NOUVEAU, "x-mip-edge-country": "FR" })).mode).toBe("relaye");
    // Une fois l'ancienne retirée, elle ne passe plus.
    expect(creerBordDeConfiance([NOUVEAU]).lire(req({ "x-mip-edge-auth": ANCIEN })).mode).toBe("refuse");
  });

  it("fausse : mode refusé — ni pays, ni GeoIP (l'adresse serait celle du relais)", () => {
    const bord = creerBordDeConfiance([ANCIEN]);
    for (const faux of ["", "x", ANCIEN.slice(1), `${ANCIEN}x`, ANCIEN.toUpperCase()]) {
      const r = req({ "x-mip-edge-auth": faux, "x-mip-edge-country": "FR" });
      expect(bord.lire(r), JSON.stringify(faux)).toEqual({ mode: "refuse", pays: null, forges: 2 });
      expect(r.headers).toEqual({});
    }
  });

  it("pays invalide : aucun pays, et pas de repli sur l'en-tête suivant", () => {
    const bord = creerBordDeConfiance([ANCIEN]);
    for (const pays of ["fr", "FRA", "F", "F1", " FR", "XX,YY", "🇫🇷"]) {
      const r = req({ "x-mip-edge-auth": ANCIEN, "x-mip-edge-country": pays, "x-vercel-ip-country": "BE" });
      expect(bord.lire(r), pays).toEqual({ mode: "relaye", pays: null, forges: 0 });
    }
  });

  it("l'adresse n'est JAMAIS transmise : le résultat ne porte qu'un mode et un pays", () => {
    const bord = creerBordDeConfiance([ANCIEN]);
    const r = req({ "x-mip-edge-auth": ANCIEN, "x-mip-edge-country": "FR", "x-mip-edge-ip": "203.0.113.7" });
    const lu = bord.lire(r);
    expect(Object.keys(lu).sort()).toEqual(["forges", "mode", "pays"]);
    expect(JSON.stringify(lu)).not.toContain("203.0.113.7");
    expect(r.headers).toEqual({});
  });
});

describe("retirerEntetesBord", () => {
  it("vaut aussi pour les `Headers` du web (route Next, P3)", () => {
    const h = new Headers({ "X-Mip-Edge-Auth": "s", "x-mip-edge-country": "FR", "x-mip-app": "a" });
    expect(retirerEntetesBord({ headers: h })).toBe(2);
    expect([...h.keys()]).toEqual(["x-mip-app"]);
  });

  it("ne touche à rien d'autre, et supporte une requête sans en-têtes", () => {
    expect(retirerEntetesBord({})).toBe(0);
    const r = req({ "x-mip-session": "s", "x-mip-app": "a" });
    expect(retirerEntetesBord(r)).toBe(0);
    expect(r.headers).toEqual({ "x-mip-session": "s", "x-mip-app": "a" });
  });
});

describe("verifierSecretsBord — la valeur d'EDGE_PROXY_SECRET", () => {
  it("absente : rien à redire (le bord est simplement éteint)", () => {
    expect(verifierSecretsBord([])).toBeNull();
    expect(verifierSecretsBord(undefined)).toBeNull();
  });

  it("une ou deux valeurs d'au moins 32 caractères", () => {
    expect(verifierSecretsBord([ANCIEN])).toBeNull();
    expect(verifierSecretsBord([ANCIEN, NOUVEAU])).toBeNull();
  });

  it("refuse trois valeurs, ou une valeur courte — sans jamais la citer", () => {
    expect(verifierSecretsBord([ANCIEN, NOUVEAU, "c".repeat(40)])).toMatch(/2 valeurs au plus/);
    const message = verifierSecretsBord([ANCIEN, "court-secret"]);
    expect(message).toMatch(/32 caractères/);
    expect(message).not.toContain("court-secret");
  });
});
