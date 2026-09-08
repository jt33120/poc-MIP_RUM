// Compte de démonstration de la vitrine publique. Trois propriétés à tenir,
// parce que cette fonctionnalité ouvre la console à l'internet entier :
//   1. fermée par défaut — sans DEMO_USER_APPS, rien n'est ouvert ;
//   2. un périmètre vide n'ouvre RIEN — surtout pas « toutes les apps », ce qui
//      publierait les vrais clients ;
//   3. le drapeau `demo` survit à l'aller-retour JWT, sinon le middleware ne
//      peut pas imposer la lecture seule et un visiteur pourrait créer une règle
//      d'alerte avec un webhook vers l'URL de son choix.
import { beforeAll, describe, expect, it } from "vitest";
import { signJwt, verifyJwt } from "../../apps/console/lib/auth";
import { demoConfig } from "../../apps/console/lib/demo";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

beforeAll(() => {
  process.env.AUTH_SECRET = "secret-de-test-demo-session";
});

describe("demoConfig — la démo est fermée tant qu'on ne l'ouvre pas", () => {
  it("null sans DEMO_USER_APPS", () => {
    expect(demoConfig(env({}))).toBeNull();
  });

  it("null quand le périmètre est vide, blanc, ou ne contient que des virgules", () => {
    expect(demoConfig(env({ DEMO_USER_APPS: "" }))).toBeNull();
    expect(demoConfig(env({ DEMO_USER_APPS: "   " }))).toBeNull();
    expect(demoConfig(env({ DEMO_USER_APPS: " , ,, " }))).toBeNull();
  });

  it("un email seul n'ouvre rien — c'est le périmètre qui est l'interrupteur", () => {
    expect(demoConfig(env({ DEMO_USER_EMAIL: "demo@mip-rum.local" }))).toBeNull();
  });

  it("découpe le périmètre, ignore les espaces et les entrées vides", () => {
    expect(demoConfig(env({ DEMO_USER_APPS: " mip-rum-console , insight-performance ,, " }))).toEqual(
      { email: "demo@mip-rum.local", apps: ["mip-rum-console", "insight-performance"] },
    );
  });

  it("email par défaut, ou celui fourni, normalisé", () => {
    expect(demoConfig(env({ DEMO_USER_APPS: "a" }))?.email).toBe("demo@mip-rum.local");
    expect(demoConfig(env({ DEMO_USER_APPS: "a", DEMO_USER_EMAIL: " Vitrine@MIP.fr " }))?.email).toBe(
      "vitrine@mip.fr",
    );
    // email blanc => on retombe sur le défaut plutôt que sur une identité vide
    expect(demoConfig(env({ DEMO_USER_APPS: "a", DEMO_USER_EMAIL: "  " }))?.email).toBe(
      "demo@mip-rum.local",
    );
  });
});

describe("drapeau demo dans le JWT — support de la lecture seule", () => {
  it("survit à l'aller-retour signature → vérification", async () => {
    const t = await signJwt({ email: "d@x.fr", role: "viewer", apps: ["demo-app"], demo: true });
    expect(await verifyJwt(t)).toMatchObject({ email: "d@x.fr", role: "viewer", demo: true });
  });

  it("vaut false pour une session normale — une session ordinaire n'est jamais bridée", async () => {
    const t = await signJwt({ email: "a@x.fr", role: "admin", apps: null });
    expect((await verifyJwt(t))?.demo).toBe(false);
  });

  it("un jeton falsifié ne passe pas — le drapeau n'est pas déclaratif côté client", async () => {
    const t = await signJwt({ email: "d@x.fr", role: "viewer", apps: null, demo: true });
    const [h, , s] = t.split(".");
    const forge = Buffer.from(
      JSON.stringify({ email: "d@x.fr", role: "admin", apps: null }),
    ).toString("base64url");
    expect(await verifyJwt(`${h}.${forge}.${s}`)).toBeNull();
  });
});
