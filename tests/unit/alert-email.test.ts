// Relais e-mail des alertes (migration-v49). Parties pures : mise en forme du
// message, lecture de la configuration du fournisseur, comparaison du jeton.
//
// Le fil rouge de ces tests : le relais ne doit JAMAIS rendre un succès sans
// qu'un e-mail soit parti. Le code HTTP qu'il renvoie détermine le statut de
// livraison en base ; un faux vert ici recrée exactement le défaut que
// migration-v49 corrige (« sent » qui ne prouvait rien).
import { describe, expect, it } from "vitest";
import {
  buildAlertMail,
  mailerConfig,
  sendAlertMail,
  tokenMatches,
} from "../../apps/console/lib/alert-email";

describe("buildAlertMail", () => {
  it("met la sévérité et la première ligne dans le sujet", () => {
    const m = buildAlertMail({
      to: "ops@example.com",
      severity: "critical",
      text: "SLO « LCP 99% / 28 j » en burn rapide : atteinte 81.58%",
    });
    expect(m?.subject).toBe(
      "[MIP RUM CRITICAL] SLO « LCP 99% / 28 j » en burn rapide : atteinte 81.58%",
    );
    expect(m?.to).toBe("ops@example.com");
  });

  it("tronque un sujet trop long sans couper le corps", () => {
    const long = "x".repeat(300);
    const m = buildAlertMail({ to: "a@b.co", text: long });
    expect(m!.subject.length).toBeLessThanOrEqual(140);
    expect(m!.subject.endsWith("…")).toBe(true);
    expect(m!.text).toContain(long);
  });

  it("n'utilise que la première ligne dans le sujet", () => {
    const m = buildAlertMail({ to: "a@b.co", text: "titre\ndétail sur la ligne suivante" });
    expect(m?.subject).toBe("[MIP RUM WARNING] titre");
    expect(m?.text).toContain("détail sur la ligne suivante");
  });

  it("retombe sur warning si la sévérité est absente ou inconnue", () => {
    expect(buildAlertMail({ to: "a@b.co", text: "x" })?.subject).toContain("WARNING");
    expect(buildAlertMail({ to: "a@b.co", text: "x", severity: "bogus" })?.subject).toContain(
      "WARNING",
    );
  });

  it("inclut le détail JSON quand un payload est fourni", () => {
    const m = buildAlertMail({ to: "a@b.co", text: "x", payload: { app: "gip", value: 42 } });
    expect(m?.text).toContain('"app": "gip"');
  });

  it("REFUSE une entrée inexploitable plutôt que d'envoyer un message vide", () => {
    expect(buildAlertMail({ to: "pas-une-adresse", text: "x" })).toBeNull();
    expect(buildAlertMail({ to: "a b@c.co", text: "x" })).toBeNull();
    expect(buildAlertMail({ to: "a@b.co", text: "   " })).toBeNull();
    expect(buildAlertMail({ to: "a@b.co" })).toBeNull();
    expect(buildAlertMail({})).toBeNull();
  });
});

describe("mailerConfig", () => {
  it("null si un des deux réglages manque — jamais de valeur par défaut", () => {
    expect(mailerConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(mailerConfig({ ALERT_EMAIL_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
    expect(mailerConfig({ ALERT_EMAIL_FROM: "a@b.co" } as NodeJS.ProcessEnv)).toBeNull();
    expect(
      mailerConfig({ ALERT_EMAIL_API_KEY: "  ", ALERT_EMAIL_FROM: "a@b.co" } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("lit les deux réglages quand ils sont présents", () => {
    expect(
      mailerConfig({ ALERT_EMAIL_API_KEY: "k", ALERT_EMAIL_FROM: "a@b.co" } as NodeJS.ProcessEnv),
    ).toEqual({ apiKey: "k", from: "a@b.co" });
  });
});

describe("sendAlertMail", () => {
  const mail = { to: "a@b.co", subject: "s", text: "t" };
  const cfg = { apiKey: "k", from: "from@b.co" };

  it("transmet destinataire, sujet et clé au fournisseur", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const r = await sendAlertMail(mail, cfg, fake);
    expect(r.ok).toBe(true);
    expect(seen!.url).toContain("resend.com");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(seen!.init.body as string);
    expect(body.to).toEqual(["a@b.co"]);
    expect(body.from).toBe("from@b.co");
  });

  it("un refus du fournisseur n'est PAS un succès", async () => {
    const fake = (async () => new Response("quota dépassé", { status: 422 })) as typeof fetch;
    const r = await sendAlertMail(mail, cfg, fake);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.detail).toContain("quota");
  });

  it("une panne réseau donne 502, pas une exception qui remonte", async () => {
    const fake = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const r = await sendAlertMail(mail, cfg, fake);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(502);
    expect(r.detail).toContain("ECONNRESET");
  });
});

describe("tokenMatches", () => {
  it("accepte le jeton exact, refuse tout le reste", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secrez", "secret")).toBe(false);
    expect(tokenMatches("secre", "secret")).toBe(false);
    expect(tokenMatches("", "secret")).toBe(false);
    expect(tokenMatches(null, "secret")).toBe(false);
  });

  it("refuse quand aucun jeton n'est configuré — pas d'ouverture par défaut", () => {
    expect(tokenMatches("n'importe quoi", undefined)).toBe(false);
    expect(tokenMatches("", undefined)).toBe(false);
    expect(tokenMatches(null, undefined)).toBe(false);
  });
});
