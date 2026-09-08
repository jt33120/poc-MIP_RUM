// Compte de démonstration de la vitrine publique. Deux propriétés à tenir, parce
// que cette fonctionnalité ouvre la console à l'internet entier :
//   1. fermée par défaut — sans DEMO_USER_EMAIL, rien n'est ouvert ;
//   2. le drapeau `demo` survit à l'aller-retour JWT, sinon le middleware ne
//      peut pas imposer la lecture seule et un visiteur pourrait créer une règle
//      d'alerte avec un webhook vers l'URL de son choix.
import { beforeAll, describe, expect, it } from "vitest";
import { signJwt, verifyJwt } from "../../apps/console/lib/auth";
import { demoEmail } from "../../apps/console/lib/demo";

beforeAll(() => {
  process.env.AUTH_SECRET = "secret-de-test-demo-session";
});

describe("demoEmail — la démo est fermée tant qu'on ne l'ouvre pas", () => {
  it("null quand la variable est absente", () => {
    expect(demoEmail({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("null quand la variable est vide ou blanche", () => {
    expect(demoEmail({ DEMO_USER_EMAIL: "" } as NodeJS.ProcessEnv)).toBeNull();
    expect(demoEmail({ DEMO_USER_EMAIL: "   " } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("normalise en minuscules et sans espaces (l'email en base l'est aussi)", () => {
    expect(demoEmail({ DEMO_USER_EMAIL: "  Demo@MIP-RUM.local " } as NodeJS.ProcessEnv)).toBe(
      "demo@mip-rum.local",
    );
  });
});

describe("drapeau demo dans le JWT — support de la lecture seule", () => {
  it("survit à l'aller-retour signature → vérification", async () => {
    const t = await signJwt({ email: "d@x.fr", role: "viewer", apps: ["demo-app"], demo: true });
    const u = await verifyJwt(t);
    expect(u).toMatchObject({ email: "d@x.fr", role: "viewer", demo: true });
  });

  it("vaut false pour une session normale — une session ordinaire n'est jamais bridée", async () => {
    const t = await signJwt({ email: "a@x.fr", role: "admin", apps: null });
    expect((await verifyJwt(t))?.demo).toBe(false);
  });

  it("un jeton falsifié ne passe pas — le drapeau n'est pas déclaratif côté client", async () => {
    const t = await signJwt({ email: "d@x.fr", role: "viewer", apps: null, demo: true });
    // on retouche la charge utile : la signature ne suit pas
    const [h, , s] = t.split(".");
    const forge = Buffer.from(
      JSON.stringify({ email: "d@x.fr", role: "admin", apps: null }),
    ).toString("base64url");
    expect(await verifyJwt(`${h}.${forge}.${s}`)).toBeNull();
  });
});
