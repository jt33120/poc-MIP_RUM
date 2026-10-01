// POST /api/assistant — ce que la route refuse, et ce qu'elle répond sans modèle.
//
// CE QUE CES TESTS EMPÊCHENT.
//   - Une question sans session, ou d'une session de démonstration (ouverte à
//     l'internet entier), qui dépenserait le quota du modèle.
//   - Un corps sans borne (32 Kio), ou un débit sans borne (20 questions / 10 min).
//   - Un condensé mal formé transmis tel quel au modèle.
//   - Une clé absente (la CI, la production avant la clé) qui ferait tomber la route :
//     elle répond par règles.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));

import { POST } from "@/app/api/assistant/route";
import { getUser } from "@/lib/auth";
import { reinitialiserDebit } from "@/lib/assistant/debit";
import { construireDigestVueEnsemble } from "@/lib/assistant/digest";
import { MAX_FAITS_ACCEPTES, validerDemande } from "@/lib/assistant/validation";
import { entrees } from "./assistant-fixtures";

const digest = construireDigestVueEnsemble(entrees());
const QUESTION = "Résume l'état de mon application aujourd'hui";
const VIEWER = { email: "lectrice@example.test", role: "viewer" as const, apps: ["boutique"] };

function requete(corps: unknown, entetes: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("https://console.test/api/assistant", {
    method: "POST",
    headers: entetes,
    body: typeof corps === "string" ? corps : JSON.stringify(corps),
  });
}

describe("POST /api/assistant", () => {
  const cleAvant = process.env.MISTRAL_API_KEY;
  let appelsSortants: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reinitialiserDebit();
    delete process.env.MISTRAL_API_KEY;
    vi.mocked(getUser).mockResolvedValue(VIEWER);
    // Aucune requête ne doit sortir d'un test de la route.
    appelsSortants = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("aucun appel sortant attendu"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (cleAvant === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = cleAvant;
  });

  it("401 sans session", async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const r = await POST(requete({ question: QUESTION, digest }));
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("403 pour une session de démonstration", async () => {
    vi.mocked(getUser).mockResolvedValue({ ...VIEWER, demo: true });
    const r = await POST(requete({ question: QUESTION, digest }));
    expect(r.status).toBe(403);
  });

  it("415 pour un corps qui n'est pas du JSON (formulaire d'un autre site)", async () => {
    const r = await POST(requete(`question=${encodeURIComponent(QUESTION)}`, { "content-type": "application/x-www-form-urlencoded" }));
    expect(r.status).toBe(415);
  });

  it("413 au-delà de 32 Kio, annoncés ou reçus", async () => {
    const gros = { question: QUESTION, digest: { ...digest, periode: "x".repeat(40 * 1024) } };
    expect((await POST(requete(gros))).status).toBe(413);
    // Sans content-length (corps en flux) : la lecture s'arrête à la borne.
    const flux = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode("x".repeat(8 * 1024)));
        c.close();
      },
    });
    const enFlux = new Request("https://console.test/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: flux,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await POST(enFlux)).status).toBe(413);
  });

  it("429 à la 21ᵉ question en 10 minutes, pour le même utilisateur seulement", async () => {
    for (let i = 0; i < 20; i++) expect((await POST(requete({ question: QUESTION, digest }))).status).toBe(200);
    const r = await POST(requete({ question: QUESTION, digest }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    vi.mocked(getUser).mockResolvedValue({ ...VIEWER, email: "autre@example.test" });
    expect((await POST(requete({ question: QUESTION, digest }))).status).toBe(200);
  });

  it("400 pour un JSON illisible, une question vide ou un condensé mal formé", async () => {
    expect((await POST(requete("{pas du json"))).status).toBe(400);
    expect((await POST(requete({ question: "   ", digest }))).status).toBe(400);
    expect((await POST(requete({ question: QUESTION, digest: { ...digest, version: 2 } }))).status).toBe(400);
    const mauvais = { ...digest, faits: [{ ...digest.faits[0], cible: "javascript:alert(1)" }] };
    expect((await POST(requete({ question: QUESTION, digest: mauvais }))).status).toBe(400);
  });

  it("sans clé de modèle : 200, réponse par règles citée, et aucun appel sortant", async () => {
    const r = await POST(requete({ question: QUESTION, digest }));
    expect(r.status).toBe(200);
    const corps = await r.json();
    expect(corps).toMatchObject({ mode: "regles", intention: "resume" });
    expect(corps.avertissement).toBe("Réponse calculée par règles : aucun modèle d'IA n'est configuré.");
    expect(corps.citations.length).toBeGreaterThan(0);
    expect(corps.texte.split("\n")[0]).toMatch(/^Santé 72/);
    expect(appelsSortants).not.toHaveBeenCalled();
  });

  it("clé posée mais Mistral AI pas encore déclaré aux sous-traitants : toujours par règles, aucun appel", async () => {
    process.env.MISTRAL_API_KEY = "cle-de-test";
    const corps = await (await POST(requete({ question: QUESTION, digest }))).json();
    expect(corps.mode).toBe("regles");
    expect(corps.avertissement).toMatch(/pas encore déclaré au registre des sous-traitants/);
    expect(appelsSortants).not.toHaveBeenCalled();
  });
});

describe("validerDemande — le condensé revenu du navigateur", () => {
  it("accepte le condensé de la page, et masque ce qui ressemble à une donnée personnelle", () => {
    const v = validerDemande({ question: `  ${QUESTION}  `, digest });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.valeur.question).toBe(QUESTION);
    expect(v.valeur.digest.faits).toHaveLength(digest.faits.length);
    const pollue = { ...digest, faits: [{ ...digest.faits[0], detail: "écrit par jean@example.com depuis 192.168.1.20" }] };
    const w = validerDemande({ question: "Qui ?", digest: pollue });
    expect(w.ok && w.valeur.digest.faits[0].detail).toBe("écrit par [adresse masquée] depuis [IP masquée]");
  });

  it("ne laisse passer aucun champ qu'elle ne vérifie pas", () => {
    const v = validerDemande({ question: "Q", digest: { ...digest, faits: [{ ...digest.faits[0], secret: "x" }], autre: 1 } });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Object.keys(v.valeur.digest.faits[0])).not.toContain("secret");
    expect(Object.keys(v.valeur.digest)).not.toContain("autre");
  });

  it("refuse plus de 200 faits, un identifiant en double, une question de plus de 500 caractères", () => {
    const f = digest.faits[0];
    const trop = Array.from({ length: MAX_FAITS_ACCEPTES + 1 }, (_v, i) => ({ ...f, id: `F${i + 1}` }));
    expect(validerDemande({ question: "Q", digest: { ...digest, faits: trop } })).toMatchObject({ ok: false });
    expect(validerDemande({ question: "Q", digest: { ...digest, faits: [f, f] } })).toMatchObject({ ok: false, raison: "F1 : identifiant en double" });
    expect(validerDemande({ question: "x".repeat(501), digest })).toMatchObject({ ok: false });
  });
});
