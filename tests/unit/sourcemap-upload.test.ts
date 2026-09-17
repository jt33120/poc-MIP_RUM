// P5.4 — contrat d'upload partagé par la console et le backend direct :
// bornes avant parsing, validation de TOUTE la liste, jetons dédiés, débit.
// L'écriture transactionnelle (idempotence, 409, remplacement audité, A ≠ B)
// est prouvée sur PostgreSQL dans tests/integration/sourcemaps-p54-sql.test.ts.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  creerLimiteurUpload,
  empreinteContenu,
  empreinteManifeste,
  ErreurUpload,
  genererJetonUpload,
  LIMITES_UPLOAD,
  lireCorpsLimite,
  lireJetonUpload,
  lireRequeteUpload,
  verifierJetonUpload,
} from "../../apps/ingest/lib/sourcemap-upload.mjs";

const MAP = { version: 3, sources: ["src/panier.ts"], names: ["valider"], mappings: "AAAAA" };
const corps = (objet: unknown) => Buffer.from(JSON.stringify(objet));
const requete = (maps: unknown[], extra: Record<string, unknown> = {}) =>
  corps({ appId: "app-a", release: "2.3.1", maps, ...extra });

/** Rejette-t-il avec ce statut et un message qui correspond ? */
function refuse(fn: () => unknown, statut: number, message: RegExp) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ErreurUpload);
    expect((err as ErreurUpload).statut).toBe(statut);
    expect((err as Error).message).toMatch(message);
    return;
  }
  throw new Error("aucune erreur levée");
}

describe("lireRequeteUpload — le contrat complet avant toute écriture", () => {
  it("accepte la liste, un contenu texte ou objet, et calcule l'empreinte des octets envoyés", () => {
    const texte = JSON.stringify(MAP);
    const demande = lireRequeteUpload(
      requete([
        { filename: "panier-4f2a.js", content: texte },
        { filename: "assets/vendor-9c1d.js", content: MAP },
      ]),
    );
    expect(demande).toMatchObject({ appId: "app-a", release: "2.3.1", remplacer: false });
    expect(demande.maps[0]).toEqual({
      filename: "panier-4f2a.js",
      content: texte,
      octets: Buffer.byteLength(texte),
      checksum: createHash("sha256").update(texte, "utf8").digest("hex"),
    });
    expect(demande.maps[1].content).toBe(JSON.stringify(MAP));
  });

  it("garde la forme historique mono-map et le remplacement explicite", () => {
    const demande = lireRequeteUpload(
      corps({ appId: "app-a", release: "1", filename: "main.js", content: MAP, replace: true }),
    );
    expect(demande.maps.map((m) => m.filename)).toEqual(["main.js"]);
    expect(demande.remplacer).toBe(true);
  });

  it("une liste dont la DERNIÈRE map est invalide est refusée en entier", () => {
    const valides = [1, 2].map((n) => ({ filename: `ok-${n}.js`, content: MAP }));
    refuse(
      () => lireRequeteUpload(requete([...valides, { filename: "casse.js", content: { ...MAP, mappings: "!!" } }])),
      400,
      /source map invalide \(casse\.js\) : caractère invalide/,
    );
  });

  it.each([
    ["un corps illisible", Buffer.from("{"), 400, /JSON invalide/],
    ["un tableau", corps([]), 400, /objet JSON/],
    ["appId absent", corps({ release: "1", maps: [{ filename: "a.js", content: MAP }] }), 400, /appId requis/],
    ["release trop longue", corps({ appId: "a", release: "r".repeat(201), maps: [{ filename: "a.js", content: MAP }] }), 400, /release requis/],
    ["aucune map", corps({ appId: "a", release: "1", maps: [] }), 400, /au moins une map/],
    ["replace non booléen", requete([{ filename: "a.js", content: MAP }], { replace: "oui" }), 400, /replace/],
    ["un fichier .map comme nom", requete([{ filename: "main.js.map", content: MAP }]), 400, /pas le fichier \.map/],
    ["un segment ..", requete([{ filename: "../main.js", content: MAP }]), 400, /filename invalide/],
    ["une barre oblique inverse", requete([{ filename: "a\\main.js", content: MAP }]), 400, /filename invalide/],
    ["un caractère de contrôle", requete([{ filename: `main${String.fromCharCode(10)}.js`, content: MAP }]), 400, /filename invalide/],
    ["un doublon", requete([{ filename: "a.js", content: MAP }, { filename: "a.js", content: MAP }]), 400, /deux fois/],
    ["un contenu absent", requete([{ filename: "a.js" }]), 400, /contenu de source map absent/],
    ["une URL de map", requete([{ filename: "a.js", content: "https://cdn.exemple.fr/a.js.map" }]), 400, /map externe non prise en charge/],
    ["un commentaire sourceMappingURL", requete([{ filename: "a.js", content: "//# sourceMappingURL=a.js.map" }]), 400, /map externe/],
    ["une URL en chaîne JSON", requete([{ filename: "a.js", content: JSON.stringify("data:application/json;base64,e30=") }]), 400, /map externe/],
    ["une map indexée", requete([{ filename: "a.js", content: { version: 3, sections: [] } }]), 400, /indexée/],
    // Un NUL brut rend le JSON illisible ; échappé, il est refusé comme caractère de contrôle.
    ["un NUL brut", requete([{ filename: "a.js", content: `{${String.fromCharCode(0)}}` }]), 400, /JSON illisible/],
    ["un NUL échappé", requete([{ filename: "a.js", content: { ...MAP, file: `a${String.fromCharCode(0)}` } }]), 400, /champ file invalide/],
  ])("refuse %s", (_, brut, statut, message) => {
    refuse(() => lireRequeteUpload(brut), statut, message);
  });

  it("borne le nombre de maps et la taille de chacune AVANT de la parser (413)", () => {
    const trop = Array.from({ length: LIMITES_UPLOAD.maps + 1 }, (_, i) => ({ filename: `m${i}.js`, content: MAP }));
    refuse(() => lireRequeteUpload(requete(trop)), 413, /au plus 200 maps/);
    const enorme = `${" ".repeat(LIMITES_UPLOAD.map)}{}`;
    const parse = vi.spyOn(JSON, "parse");
    refuse(() => lireRequeteUpload(requete([{ filename: "lourd.js", content: enorme }])), 413, /trop volumineuse \(lourd\.js/);
    // Un seul JSON.parse : celui du corps. La map de 15 Mio n'a jamais été parsée.
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });
});

describe("jetons d'upload dédiés", () => {
  it("format msu_<id>_<secret> : 256 bits aléatoires, seul le hash est rendu pour stockage", () => {
    const a = genererJetonUpload();
    const b = genererJetonUpload();
    expect(a.jeton).toMatch(/^msu_[0-9a-f]{32}_[0-9a-f]{64}$/);
    expect(a.jeton).not.toBe(b.jeton);
    const lu = lireJetonUpload(`Bearer ${a.jeton}`);
    expect(lu?.id).toBe(a.id);
    expect(a.empreinte).toBe(createHash("sha256").update(lu!.secret).digest("hex"));
    expect(a.empreinte).not.toContain(lu!.secret);
  });

  it.each([
    ["absent", null],
    ["jeton de lecture CONSOLE_API_TOKENS", "Bearer tok"],
    ["jeton de lecture UTI", "Bearer mrk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg"],
    ["majuscules", `Bearer msu_${"A".repeat(32)}_${"a".repeat(64)}`],
    ["sans schéma Bearer", `msu_${"a".repeat(32)}_${"a".repeat(64)}`],
    ["secret tronqué", `Bearer msu_${"a".repeat(32)}_${"a".repeat(63)}`],
  ])("refuse un en-tête %s sans interroger la base", async (_, authorization) => {
    const db = { query: vi.fn() };
    expect(lireJetonUpload(authorization)).toBeNull();
    expect(await verifierJetonUpload(db, authorization)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("vérifie le hash en temps constant, puis l'état actif — sans dire lequel a échoué", async () => {
    const { id, jeton, empreinte } = genererJetonUpload();
    const ligne = { id, app_id: "app-a", secret_hash: empreinte, actif: true };
    const db = (rows: unknown[]) => ({ query: vi.fn(async () => ({ rows })) });

    const ok = db([ligne]);
    expect(await verifierJetonUpload(ok, `Bearer ${jeton}`)).toEqual({ id, app_id: "app-a" });
    expect(ok.query.mock.calls[0][1]).toEqual([id, "sourcemaps:write"]);

    const autre = genererJetonUpload();
    expect(await verifierJetonUpload(db([ligne]), `Bearer msu_${id.replaceAll("-", "")}_${autre.jeton.slice(-64)}`)).toBeNull();
    expect(await verifierJetonUpload(db([{ ...ligne, actif: false }]), `Bearer ${jeton}`)).toBeNull();
    expect(await verifierJetonUpload(db([]), `Bearer ${jeton}`)).toBeNull();
  });

  it("table absente (code publié avant v71) : 503 explicite, pas un 500", async () => {
    const db = { query: vi.fn(async () => { throw Object.assign(new Error("relation absente"), { code: "42P01" }); }) };
    await expect(verifierJetonUpload(db, `Bearer ${genererJetonUpload().jeton}`)).rejects.toMatchObject({
      statut: 503,
      message: expect.stringMatching(/migration-v71/),
    });
  });
});

describe("creerLimiteurUpload", () => {
  it("borne les uploads par minute pour une clé, puis libère la fenêtre", () => {
    let t = 0;
    const l = creerLimiteurUpload({ parMinute: 2, simultanes: 10, maintenant: () => t });
    for (let i = 0; i < 2; i++) {
      const prise = l.prendre("jeton:1");
      expect("liberer" in prise).toBe(true);
      if ("liberer" in prise) prise.liberer();
    }
    expect(l.prendre("jeton:1")).toMatchObject({ refus: { retryAfter: 60 } });
    expect("liberer" in l.prendre("jeton:2")).toBe(true);
    t += 60_001;
    expect("liberer" in l.prendre("jeton:1")).toBe(true);
  });

  it("un émetteur lent n'occupe que SES places : les autres continuent jusqu'au plafond global", () => {
    const l = creerLimiteurUpload({ parMinute: 100, simultanesParCle: 2, simultanes: 3 });
    const lentes = [l.prendre("jeton:lent"), l.prendre("jeton:lent")];
    expect(l.prendre("jeton:lent")).toMatchObject({ refus: { retryAfter: 5 } });
    const autre = l.prendre("jeton:autre");
    expect("liberer" in autre).toBe(true);
    // Plafond global atteint (3) : même un émetteur sans upload en cours attend.
    expect(l.prendre("jeton:troisieme")).toMatchObject({ refus: { retryAfter: 5 } });
    for (const prise of lentes) if ("liberer" in prise) prise.liberer();
    expect("liberer" in l.prendre("jeton:troisieme")).toBe(true);
  });

  it("libérer deux fois ne rend qu'une place", () => {
    const l = creerLimiteurUpload({ parMinute: 100, simultanesParCle: 1, simultanes: 1 });
    const premiere = l.prendre("a");
    expect(l.prendre("b")).toMatchObject({ refus: { retryAfter: 5 } });
    if ("liberer" in premiere) {
      premiere.liberer();
      premiere.liberer();
    }
    expect("liberer" in l.prendre("b")).toBe(true);
    expect(l.prendre("c")).toMatchObject({ refus: expect.anything() });
  });
});

describe("lireCorpsLimite — octets et durée bornés", () => {
  it("assemble un flux Node ou un ReadableStream web sous la limite", async () => {
    expect((await lireCorpsLimite(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), { max: 4 })).toString()).toBe("abcd");
    const web = new Response("héhé").body!;
    expect((await lireCorpsLimite(web as unknown as AsyncIterable<Uint8Array>, { max: 16 })).toString()).toBe("héhé");
  });

  it("413 au morceau qui dépasse, sans lire la suite", async () => {
    let lus = 0;
    async function* flux() {
      for (let i = 0; i < 100; i++) {
        lus++;
        yield Buffer.alloc(1024);
      }
    }
    await expect(lireCorpsLimite(flux(), { max: 3000 })).rejects.toMatchObject({ statut: 413 });
    expect(lus).toBe(3);
  });

  it("sur un vrai serveur HTTP, le client reçoit le 413 et son message, pas une connexion coupée", async () => {
    const serveur = createServer(async (req, res) => {
      try {
        await lireCorpsLimite(req, { max: 1024 * 1024 });
        res.writeHead(200).end();
      } catch (err) {
        res.writeHead((err as ErreurUpload).statut, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
    try {
      const { port } = serveur.address() as { port: number };
      const reponse = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: Buffer.alloc(8 * 1024 * 1024, 97) });
      expect(reponse.status).toBe(413);
      expect(await reponse.json()).toEqual({ error: "corps trop volumineux (limite 1 Mio)" });
    } finally {
      serveur.closeAllConnections();
      await new Promise((ok) => serveur.close(ok));
    }
  });

  it("408 quand le corps n'arrive pas dans le délai total", async () => {
    async function* lent() {
      yield Buffer.from("{");
      await new Promise((r) => setTimeout(r, 200));
      yield Buffer.from("}");
    }
    await expect(lireCorpsLimite(lent(), { max: 10, delaiMs: 50 })).rejects.toMatchObject({ statut: 408 });
  });

  it("408 après un silence entre deux morceaux, même dans le délai total", async () => {
    async function* goutteAGoutte() {
      yield Buffer.from("{");
      await new Promise((r) => setTimeout(r, 150));
      yield Buffer.from("}");
    }
    await expect(lireCorpsLimite(goutteAGoutte(), { max: 10, delaiMs: 5_000, delaiInactiviteMs: 50 })).rejects.toMatchObject({
      statut: 408,
    });
    expect((await lireCorpsLimite(goutteAGoutte(), { max: 10, delaiMs: 5_000, delaiInactiviteMs: 1_000 })).toString()).toBe("{}");
  });
});

describe("empreintes", () => {
  it("empreinte du manifeste : indépendante de l'ordre, sensible au contenu, marque les maps sans checksum", () => {
    const a = { filename: "a.js", checksum: empreinteContenu("{}") };
    const b = { filename: "b.js", checksum: empreinteContenu("[]") };
    expect(empreinteManifeste([a, b])).toBe(empreinteManifeste([b, a]));
    expect(empreinteManifeste([a, b])).not.toBe(empreinteManifeste([a, { ...b, checksum: empreinteContenu("{ }") }]));
    expect(empreinteManifeste([a, { ...b, checksum: null }])).not.toBe(empreinteManifeste([a, b]));
    expect(empreinteManifeste([])).toMatch(/^[0-9a-f]{64}$/);
  });
});
