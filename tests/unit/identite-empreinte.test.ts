// P2 — l'empreinte du secret d'identité (`IDENTITY_HASH_FINGERPRINT`).
//
// POURQUOI CE FICHIER. Changer `IDENTITY_HASH_SECRET` casse la continuité de
// `user_id_hash` EN SILENCE : rien n'échoue, les HMAC sont juste différents, et
// les écrans qui comptent des personnes se coupent en deux populations.
// L'empreinte déclarée à côté du secret rend ce changement BRUYANT. On vérifie
// ici les quatre états, la règle « secret sans empreinte = refus de démarrer »,
// et l'outil d'exploitation qui calcule l'empreinte depuis l'entrée standard.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  empreinteIdentite,
  etatIdentite,
  IDENTITY_FINGERPRINT_PATTERN,
  verifierConfigIdentite,
  // @ts-expect-error module ESM partagé, sans déclarations
} from "../../packages/backend/lib/identity-hash.mjs";

const SECRET = "s".repeat(48);
const AUTRE = "t".repeat(48);
const OUTIL = join(__dirname, "..", "..", "scripts", "ops", "empreinte-identite.mjs");

describe("empreinteIdentite", () => {
  it("12 hex, stable, et différente pour deux secrets", () => {
    const fp = empreinteIdentite(SECRET);
    expect(fp).toMatch(IDENTITY_FINGERPRINT_PATTERN);
    expect(empreinteIdentite(SECRET)).toBe(fp);
    expect(empreinteIdentite(AUTRE)).not.toBe(fp);
  });

  it("n'est PAS le sha256 nu du secret (séparation de domaine : /health est public)", () => {
    const nu = createHash("sha256").update(SECRET).digest("hex").slice(0, 12);
    expect(empreinteIdentite(SECRET)).not.toBe(nu);
  });

  it("sans secret : null", () => {
    expect(empreinteIdentite(undefined)).toBeNull();
    expect(empreinteIdentite("")).toBeNull();
  });
});

describe("etatIdentite — les quatre états", () => {
  const fp = empreinteIdentite(SECRET);

  it("absente : pas de secret, l'identité est retirée (comportement d'aujourd'hui)", () => {
    expect(etatIdentite(undefined, undefined)).toEqual({ etat: "absente", id_fp: null, attendue: null, secret: null });
    expect(etatIdentite("", fp)).toMatchObject({ etat: "absente", secret: null });
  });

  it("active : secret ET empreinte concordante — le secret sert au hachage", () => {
    expect(etatIdentite(SECRET, fp)).toEqual({ etat: "active", id_fp: fp, attendue: fp, secret: SECRET });
  });

  it("discordante : le secret n'est PAS rendu (identité retirée, jamais un HMAC incohérent)", () => {
    const r = etatIdentite(AUTRE, fp);
    expect(r).toMatchObject({ etat: "discordante", attendue: fp, secret: null });
    expect(r.id_fp).toBe(empreinteIdentite(AUTRE));
  });

  it("non_verifiee : secret sans empreinte (serveurs de développement seulement)", () => {
    expect(etatIdentite(SECRET, undefined)).toMatchObject({ etat: "non_verifiee", secret: SECRET });
  });
});

describe("verifierConfigIdentite — la règle du service", () => {
  it("un secret SANS empreinte est un refus de démarrer, qui dit comment la calculer", () => {
    const message = verifierConfigIdentite({ secret: SECRET, empreinte: undefined });
    expect(message).toMatch(/IDENTITY_HASH_FINGERPRINT est obligatoire/);
    expect(message).toContain("scripts/ops/empreinte-identite.mjs");
    expect(message).not.toContain(SECRET);
  });

  it("secret + empreinte, ou ni l'un ni l'autre : rien à redire", () => {
    expect(verifierConfigIdentite({ secret: SECRET, empreinte: empreinteIdentite(SECRET) })).toBeNull();
    expect(verifierConfigIdentite({ secret: undefined, empreinte: undefined })).toBeNull();
  });
});

describe("scripts/ops/empreinte-identite.mjs", () => {
  const lancer = (entree: string) => spawnSync(process.execPath, [OUTIL], { input: entree, encoding: "utf8" });

  it("lit le secret sur stdin et imprime l'empreinte du collector, et elle seule", () => {
    const r = lancer(`${SECRET}\n`); // le saut de ligne d'`echo` est retiré
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${empreinteIdentite(SECRET)}\n`);
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });

  it("refuse une entrée vide ou un secret trop court (code 2)", () => {
    expect(lancer("").status).toBe(2);
    const court = lancer("court");
    expect(court.status).toBe(2);
    expect(court.stderr).toMatch(/trop court/);
    expect(court.stdout).toBe("");
  });
});
