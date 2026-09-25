// C10 — les commandes du RGPD. Une identité brute entre dans le CORPS d'une
// recherche ou d'une confirmation et n'en ressort qu'en HMAC : ni dans la
// décision, ni dans l'audit. « Toutes les applications » est à la plateforme.
// Chaque demande laisse sa ligne au journal, refus compris ; celle d'un
// effacement entre dans SA transaction.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { hashIdentity } from "../../packages/backend/lib/identity-hash.mjs";

const audit: { action: string; detail: string | null; app: string | null; dansEffacement: boolean }[] = [];
let dansEffacement = false;
const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };

vi.mock("@/lib/db", () => ({ tx: async (fn: (c: typeof client) => Promise<unknown>) => fn(client), q: vi.fn() }));
vi.mock("@/lib/commandes/audit", () => ({
  ecrireAudit: async (_c: unknown, l: { action: string; detail: string | null; app: string | null }) => {
    audit.push({ action: l.action, detail: l.detail, app: l.app, dansEffacement });
  },
}));
const supprime = [{ table: "rum_metric", deleted: 2 }, { table: "rum_session", deleted: 1 }];
const dsar = vi.hoisted(() => ({
  dsarIdentityErase: vi.fn(),
  dsarErase: vi.fn(),
  dsarIdentityExport: vi.fn(),
  dsarExport: vi.fn(),
}));
vi.mock("@/lib/queries-dsar", () => dsar);

const { COMMANDES_CONSOLE: C } = await import("@/lib/commandes");
const { DsarRefus } = await import("@/lib/dsar");

const RAW = "alice@example.test";
const APP = "vie-privee-app";
const SECRET = "vie-privee-test-secret";
const PLATEFORME = { email: "p@mip.test", role: "admin" as const, apps: null };
const LISTE = { email: "l@mip.test", role: "admin" as const, apps: [APP] };
const demande = <B,>(principal: typeof PLATEFORME | typeof LISTE, corps: B, app: string | null = APP) => ({ principal, app, chemin: {}, corps, requestId: "req-c10" });

describe("C10 — commandes du RGPD", () => {
  beforeEach(() => {
    audit.length = 0;
    process.env.IDENTITY_HASH_SECRET = SECRET;
    for (const f of Object.values(dsar)) f.mockReset();
    dsar.dsarIdentityErase.mockImplementation(async (_a, _k, _h, _io, _acteur, apres) => {
      dansEffacement = true;
      await apres?.(client, supprime);
      dansEffacement = false;
      return supprime;
    });
    dsar.dsarErase.mockImplementation(async (_a, _v, _acteur, apres) => {
      dansEffacement = true;
      await apres?.(client, supprime);
      dansEffacement = false;
      return supprime;
    });
  });

  it("recherche : la décision et l'audit ne portent que le HMAC de l'application", async () => {
    const d = await C.rechercherIdentite.executer(demande(LISTE, { kind: "user" as const, identity: `  ${RAW} ` }));
    expect(d).toEqual({ etat: "ok", hash: hashIdentity(SECRET, APP, "user", RAW) });
    expect(audit).toEqual([{ action: "privacy.identity_search", detail: expect.stringContaining("hash_prefix="), app: APP, dansEffacement: false }]);
    expect(JSON.stringify([d, audit])).not.toContain(RAW);
  });

  it("recherche sans clé de hachage : indisponible, rien d'inscrit", async () => {
    process.env.IDENTITY_HASH_SECRET = "";
    expect(await C.rechercherIdentite.executer(demande(LISTE, { kind: "user" as const, identity: RAW }))).toEqual({ etat: "indisponible" });
    expect(audit).toEqual([]);
  });

  it("effacement : la ressaisie doit hacher au HMAC effacé ; l'audit entre dans la transaction de l'effacement", async () => {
    const hash = hashIdentity(SECRET, APP, "account", RAW) as string;
    expect(await C.effacerIdentite.executer(demande(LISTE, { kind: "account" as const, identity_hash: hash, confirm_identity: "mallory@example.test" }))).toEqual({
      etat: "confirmation",
    });
    expect(dsar.dsarIdentityErase).not.toHaveBeenCalled();
    const d = await C.effacerIdentite.executer(demande(LISTE, { kind: "account" as const, identity_hash: hash, confirm_identity: RAW }));
    expect(d).toEqual({ etat: "efface", lignes: 3 });
    expect(dsar.dsarIdentityErase).toHaveBeenCalledWith(APP, "account", hash, undefined, LISTE.email, expect.any(Function));
    expect(audit).toEqual([{ action: "privacy.identity_erase", detail: expect.stringContaining("rows=3"), app: APP, dansEffacement: true }]);
    expect(JSON.stringify(audit)).not.toContain(RAW);
  });

  it("visiteur : « toutes » à la plateforme seule ; une application hors de la liste, refusée", async () => {
    const corps = { app: "all", visitor_id: "v-1", confirm: "v-1" };
    expect(await C.effacerVisiteur.executer(demande(LISTE, corps, null))).toEqual({ etat: "interdit" });
    expect(await C.exporterVisiteur.executer(demande(LISTE, { app: "all", visitor_id: "v-1" }, null))).toEqual({ etat: "interdit" });
    expect(await C.effacerVisiteur.executer(demande(LISTE, { ...corps, app: "autre-app" }, null))).toEqual({ etat: "interdit" });
    expect(dsar.dsarErase).not.toHaveBeenCalled();
    expect(await C.effacerVisiteur.executer(demande(PLATEFORME, corps, null))).toEqual({ etat: "efface", lignes: 3 });
    expect(dsar.dsarErase).toHaveBeenCalledWith("all", "v-1", PLATEFORME.email, expect.any(Function));
    expect(audit).toEqual([{ action: "privacy.visitor_erase", detail: expect.stringContaining("rows=3"), app: null, dansEffacement: true }]);
  });

  it("visiteur : la confirmation est la ressaisie exacte", async () => {
    expect(await C.effacerVisiteur.executer(demande(LISTE, { app: APP, visitor_id: "v-1", confirm: "v-2" }, null))).toEqual({ etat: "confirmation" });
    expect(dsar.dsarErase).not.toHaveBeenCalled();
  });

  it("un refus (ancienne empreinte de terminal) est inscrit au journal, hors de toute transaction d'effacement", async () => {
    dsar.dsarErase.mockRejectedValueOnce(new DsarRefus("refus_empreinte"));
    const d = await C.effacerVisiteur.executer(demande(LISTE, { app: APP, visitor_id: "v-1", confirm: "v-1" }, null));
    expect(d).toEqual({ etat: "refus", motif: "refus_empreinte" });
    expect(audit).toEqual([{ action: "privacy.visitor_erase", detail: expect.stringMatching(/^refus=refus_empreinte /), app: APP, dansEffacement: false }]);
    dsar.dsarExport.mockRejectedValueOnce(new DsarRefus("inconnu"));
    expect(await C.exporterVisiteur.executer(demande(LISTE, { app: APP, visitor_id: "v-1" }, null))).toMatchObject({ etat: "refus", motif: "inconnu" });
    expect(audit.at(-1)).toMatchObject({ action: "privacy.visitor_export", detail: expect.stringMatching(/^refus=inconnu /) });
  });

  it("export : le document n'est rendu qu'une fois sa divulgation inscrite", async () => {
    dsar.dsarIdentityExport.mockResolvedValue({ kind: "mip-rum-dsar-identity-export" });
    const hash = hashIdentity(SECRET, APP, "user", RAW) as string;
    const d = await C.exporterIdentite.executer(demande(LISTE, { kind: "user" as const, identity_hash: hash }));
    expect(d).toMatchObject({ etat: "ok", document: { kind: "mip-rum-dsar-identity-export" } });
    expect(audit).toEqual([{ action: "privacy.identity_export", detail: `kind=user app=${APP} hash_prefix=${hash.slice(0, 12)}`, app: APP, dansEffacement: false }]);
  });
});
