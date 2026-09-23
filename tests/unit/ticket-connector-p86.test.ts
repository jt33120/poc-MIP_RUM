// P8.6 — le contrat du connecteur de tickets, sans base ni réseau.
//
// CE QUE CES TESTS CHERCHENT À METTRE EN DÉFAUT :
//
//   · une charge qui ferait sortir de MIP autre chose que le minimum — une pile
//     d'appels, une identité, un secret qui aurait échappé au scrub ;
//   · un aperçu qui ne serait pas EXACTEMENT ce qui part ;
//   · une vérification de signature qui accepterait un corps modifié, une
//     signature tronquée, ou qui comparerait en temps variable ;
//   · un rejeu de création après une incertitude — le doublon chez le client ;
//   · un statut de fournisseur qui écraserait une décision humaine `ignored` ;
//   · une référence de secret qui accepterait un jeton en clair.
import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error module JS sans déclarations
import {
  CODES,
  ErreurTicket,
  MENTION_ETAPE,
  PROVIDERS,
  STRATEGIE,
  construireCharge,
  egalTempsConstant,
  mappingStatut,
  octetsHex,
  prochaineTentative,
  referenceMip,
  statutPropose,
  urlConsole,
} from "../../packages/backend/lib/integrations/tickets/adapter.mjs";
// @ts-expect-error module JS sans déclarations
import {
  WEBHOOK_MAX_OCTETS,
  chercherParReference,
  createIssue,
  getIssue,
  normalizeWebhook,
  validateWebhook,
} from "../../packages/backend/lib/integrations/tickets/github.mjs";
// @ts-expect-error module JS sans déclarations
import { adaptateurDe } from "../../packages/backend/lib/integrations/tickets/dispatcher.mjs";
// @ts-expect-error module JS sans déclarations
import { ErreurSecret, chiffrer, decrire, referenceValide, resoudre } from "../../packages/backend/lib/integrations/tickets/secrets.mjs";
import { parseDemandeTicket, parseIntegrationPatch, parseIntegrationRequest } from "../../apps/console/lib/queries-ticket-integrations";

const CONSOLE = "https://console.exemple.fr";
const ISSUE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const issue = {
  issueId: ISSUE,
  appId: "app-a",
  errorType: "TypeError",
  message: "Cannot read properties of undefined (reading 'panier')",
  firstRelease: "2026.09.1",
  lastRelease: "2026.09.3",
  occurrences: 4214,
  firstSeen: new Date("2026-09-01T08:00:00.000Z"),
  lastSeen: new Date("2026-09-17T17:23:00.000Z"),
};

describe("P8.6 — la charge envoyée hors de MIP", () => {
  it("porte le minimum utile, et RIEN de plus", () => {
    const charge = construireCharge(issue, { consoleBase: CONSOLE });
    expect(charge.titre).toContain("TypeError");
    expect(charge.description).toContain("app-a");
    expect(charge.description).toContain("2026.09.1");
    // Compteur OBSERVÉ, annoncé comme tel : un lecteur de ticket ne doit pas le
    // prendre pour un nombre d'utilisateurs touchés.
    expect(charge.description).toContain("somme des répétitions réellement reçues");
    expect(charge.url).toBe(`${CONSOLE}/errors/issues/${ISSUE}?app=app-a`);
    expect(charge.description).toContain(charge.url);
    expect(charge.reference).toBe(`MIP-RUM-ISSUE:${ISSUE}`);
  });

  it("n'emporte ni pile d'appels ni identité, même si on les lui donne", () => {
    const charge = construireCharge(
      {
        ...issue,
        message:
          "boom chez alice@client.fr avec token=ghp_0123456789abcdefghij\n  at Panier.valider (panier.js:42:9)\n  at Achat.payer (achat.js:7:3)",
      },
      { consoleBase: CONSOLE },
    );
    const tout = `${charge.titre}\n${charge.description}`;
    expect(tout).not.toContain("alice@client.fr");
    expect(tout).not.toContain("ghp_0123456789abcdefghij");
    expect(tout).not.toContain("panier.js:42:9");
    expect(tout).not.toContain("achat.js:7:3");
    // Et l'absence est DITE, pour qu'un lecteur de ticket ne la croie pas fortuite.
    expect(charge.description).toContain("ne sont pas transmises");
  });

  it("dit « Inconnue » plutôt que d'inventer un 0 ou une chaîne vide", () => {
    const charge = construireCharge(
      { ...issue, firstRelease: null, lastRelease: "   ", occurrences: null, firstSeen: null, lastSeen: null },
      { consoleBase: CONSOLE },
    );
    expect(charge.description).toContain("**Release de première vue** : Inconnue");
    expect(charge.description).toContain("**Release de dernière vue** : Inconnue");
    expect(charge.description).toContain("**Occurrences observées** : Inconnu");
    expect(charge.description).toContain("**Première vue** : Inconnue");
    expect(charge.description).not.toContain("Occurrences observées** : 0");
  });

  it("dit que GitHub est une étape, et nomme la cible avec sa réserve", () => {
    const charge = construireCharge(issue, { consoleBase: CONSOLE });
    expect(charge.description).toContain(MENTION_ETAPE);
    expect(MENTION_ETAPE).toContain("GitHub Issues");
    expect(MENTION_ETAPE).toContain("ServiceNow");
    expect(MENTION_ETAPE).toContain("sous réserve de confirmation");
  });

  it("est DÉTERMINISTE : l'aperçu montré et la charge figée ne peuvent pas diverger", () => {
    const a = construireCharge(issue, { consoleBase: CONSOLE });
    const b = construireCharge(issue, { consoleBase: CONSOLE });
    expect(b).toEqual(a);
  });

  it("borne titre et description, quelle que soit l'entrée", () => {
    // 20 000 caractères : largement au-delà des bornes, et sans faire tourner le
    // scrub serveur sur un motif pathologique — ce n'est pas lui qu'on teste ici.
    const charge = construireCharge({ ...issue, message: "abcdef ".repeat(3000) }, { consoleBase: CONSOLE });
    expect([...charge.titre].length).toBeLessThanOrEqual(200);
    expect([...charge.description].length).toBeLessThanOrEqual(8000);
  });

  it("encode l'issue et l'app dans le lien console", () => {
    expect(urlConsole({ issueId: "a b", appId: "x/y" }, `${CONSOLE}///`)).toBe(
      `${CONSOLE}/errors/issues/a%20b?app=x%2Fy`,
    );
  });

  it("n'implémente qu'un fournisseur, et le registre le dit", () => {
    expect(PROVIDERS).toEqual(["github"]);
    expect(adaptateurDe("github")).not.toBeNull();
    expect(adaptateurDe("jira")).toBeNull();
    expect(adaptateurDe("servicenow")).toBeNull();
    // Pas de piège de prototype : `toString` n'est pas un fournisseur.
    expect(adaptateurDe("toString")).toBeNull();
  });
});

describe("P8.6 — signature du webhook, mécanisme officiel de GitHub", () => {
  const secret = "un-secret-de-webhook-de-test";
  const corps = Buffer.from(JSON.stringify({ action: "closed", issue: { number: 12, state: "closed" } }), "utf8");
  const signer = (octets: Buffer, cle = secret) =>
    `sha256=${createHmac("sha256", cle).update(octets).digest("hex")}`;
  const entetes = (extra: Record<string, string> = {}) =>
    new Headers({
      "x-github-event": "issues",
      "x-github-delivery": "5f1e7a20-0000-4000-8000-abcdefabcdef",
      "x-hub-signature-256": signer(corps),
      ...extra,
    });

  it("accepte une livraison correctement signée", () => {
    const r = validateWebhook({ secret, entetes: entetes(), corps: new Uint8Array(corps) });
    expect(r).toEqual({ ok: true, deliveryId: "5f1e7a20-0000-4000-8000-abcdefabcdef", type: "issues" });
  });

  it("refuse un corps modifié d'un seul octet", () => {
    const altere = Buffer.from(corps);
    altere[altere.length - 2] ^= 0x01;
    const r = validateWebhook({ secret, entetes: entetes(), corps: new Uint8Array(altere) });
    expect(r).toEqual({ ok: false, raison: "signature_invalide" });
  });

  it("refuse une signature d'un autre secret", () => {
    const r = validateWebhook({
      secret,
      entetes: entetes({ "x-hub-signature-256": signer(corps, "autre-secret") }),
      corps: new Uint8Array(corps),
    });
    expect(r).toEqual({ ok: false, raison: "signature_invalide" });
  });

  it("refuse une signature absente, tronquée ou non hexadécimale", () => {
    const cas: [Record<string, string>, string][] = [
      [{ "x-hub-signature-256": "" }, "signature_absente"],
      [{ "x-hub-signature-256": "sha1=abcd" }, "signature_absente"],
      [{ "x-hub-signature-256": "sha256=abc" }, "signature_malformee"],
      [{ "x-hub-signature-256": "sha256=zzzz" }, "signature_malformee"],
      // Une signature TRONQUÉE ne doit jamais valider un préfixe correct.
      [{ "x-hub-signature-256": signer(corps).slice(0, 20) }, "signature_malformee"],
    ];
    for (const [extra, raison] of cas) {
      expect(validateWebhook({ secret, entetes: entetes(extra), corps: new Uint8Array(corps) })).toEqual({
        ok: false,
        raison,
      });
    }
  });

  it("exige un identifiant de livraison unique et un type", () => {
    expect(
      validateWebhook({ secret, entetes: entetes({ "x-github-delivery": "" }), corps: new Uint8Array(corps) }),
    ).toEqual({ ok: false, raison: "livraison_sans_identifiant" });
    expect(
      validateWebhook({ secret, entetes: entetes({ "x-github-event": "" }), corps: new Uint8Array(corps) }),
    ).toEqual({ ok: false, raison: "type_absent" });
  });

  it("borne la taille, et refuse sans secret", () => {
    const enorme = new Uint8Array(WEBHOOK_MAX_OCTETS + 1);
    expect(validateWebhook({ secret, entetes: entetes(), corps: enorme })).toEqual({
      ok: false,
      raison: "corps_trop_grand",
    });
    expect(validateWebhook({ secret: "", entetes: entetes(), corps: new Uint8Array(corps) })).toEqual({
      ok: false,
      raison: "secret_absent",
    });
  });

  it("compare à temps constant : longueurs différentes refusées sans court-circuit d'octets", () => {
    expect(egalTempsConstant(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(egalTempsConstant(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(egalTempsConstant(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
    expect(egalTempsConstant(new Uint8Array([]), new Uint8Array([]))).toBe(true);
    // @ts-expect-error entrée hostile volontaire
    expect(egalTempsConstant("abc", new Uint8Array([1]))).toBe(false);
    expect(octetsHex("00ff")).toEqual(new Uint8Array([0, 255]));
    expect(octetsHex("0f0")).toBeNull();
    expect(octetsHex("gg")).toBeNull();
  });

  it("normalise un événement sans rien décider", () => {
    const e = normalizeWebhook({
      entetes: entetes(),
      corps: { action: "closed", issue: { number: 12, state: "closed" }, repository: { full_name: "moi/bac" } },
    });
    expect(e).toEqual({
      provider: "github",
      deliveryId: "5f1e7a20-0000-4000-8000-abcdefabcdef",
      type: "issues",
      action: "closed",
      externalId: "12",
      etat: "closed",
      cible: "moi/bac",
    });
    // Corps incomplet : aucun identifiant inventé.
    expect(normalizeWebhook({ entetes: entetes(), corps: {} }).externalId).toBeNull();
    expect(normalizeWebhook({ entetes: entetes(), corps: {} }).etat).toBe("unknown");
  });
});

describe("P8.6 — conflit de statut : MIP reste source de vérité", () => {
  const mapping = { closed: "resolved", reopened: "open" };

  it("une issue IGNORÉE n'est jamais modifiée par le fournisseur", () => {
    expect(statutPropose({ action: "closed", etat: "closed" }, mapping, "ignored")).toEqual({
      statut: null,
      raison: "mip_source_de_verite",
    });
    expect(statutPropose({ action: "reopened", etat: "open" }, mapping, "ignored")).toEqual({
      statut: null,
      raison: "mip_source_de_verite",
    });
  });

  it("sans mapping configuré, rien ne change", () => {
    expect(statutPropose({ action: "closed", etat: "closed" }, mappingStatut({}), "open")).toEqual({
      statut: null,
      raison: "mapping_absent",
    });
    expect(statutPropose({ action: "closed", etat: "closed" }, mappingStatut(null), "open")).toEqual({
      statut: null,
      raison: "mapping_absent",
    });
  });

  it("un événement qui propose l'état COURANT ne rouvre pas une oscillation", () => {
    expect(statutPropose({ action: "closed", etat: "closed" }, mapping, "resolved")).toEqual({
      statut: null,
      raison: "deja_a_cet_etat",
    });
  });

  it("une action non suivie ne déclenche rien", () => {
    for (const action of ["edited", "labeled", "assigned", "deleted", ""]) {
      expect(statutPropose({ action, etat: "open" }, mapping, "open").statut).toBeNull();
    }
  });

  it("applique le mapping quand il est explicite et que l'état change vraiment", () => {
    expect(statutPropose({ action: "closed", etat: "closed" }, mapping, "open")).toEqual({ statut: "resolved" });
    expect(statutPropose({ action: "reopened", etat: "open" }, mapping, "resolved")).toEqual({ statut: "open" });
  });

  it("ne retient d'un mapping que des statuts MIP connus", () => {
    expect(mappingStatut({ statusMapping: { closed: "supprimee", reopened: "open" } })).toEqual({
      closed: null,
      reopened: "open",
    });
  });
});

describe("P8.6 — backoff et débit", () => {
  it("recule de 30 s × 2^tentatives, plafonné", () => {
    const t0 = 1_000_000;
    expect(prochaineTentative(1, { maintenant: t0 })).toBe(t0 + 30_000);
    expect(prochaineTentative(2, { maintenant: t0 })).toBe(t0 + 60_000);
    expect(prochaineTentative(3, { maintenant: t0 })).toBe(t0 + 120_000);
    expect(prochaineTentative(20, { maintenant: t0 })).toBe(t0 + STRATEGIE.plafondMs);
  });

  it("l'attente demandée par le fournisseur GAGNE sur le recul calculé", () => {
    const t0 = 1_000_000;
    expect(prochaineTentative(1, { attendreSec: 900, maintenant: t0 })).toBe(t0 + 900_000);
    // Plus courte que le recul : c'est le recul qui tient — on ne martèle pas.
    expect(prochaineTentative(3, { attendreSec: 1, maintenant: t0 })).toBe(t0 + 120_000);
  });
});

describe("P8.6 — l'adaptateur GitHub face à des réponses hostiles", () => {
  const charge = construireCharge(issue, { consoleBase: CONSOLE });
  const base = { cible: "moi/bac", secret: "jeton-de-test", charge };
  const reponse = (statut: number, corps: unknown, entetes: Record<string, string> = {}) =>
    new Response(typeof corps === "string" ? corps : JSON.stringify(corps), {
      status: statut,
      headers: entetes,
    });

  it("crée le ticket et rend son identifiant, son URL et son état", async () => {
    const appels: { url: string; init: RequestInit }[] = [];
    const faux = (async (url: string, init: RequestInit) => {
      appels.push({ url, init });
      return reponse(201, { number: 42, html_url: "https://github.com/moi/bac/issues/42", state: "open" });
    }) as unknown as typeof fetch;
    const r = await createIssue({ ...base, fetchImpl: faux });
    expect(r).toEqual({ externalId: "42", url: "https://github.com/moi/bac/issues/42", etat: "open" });
    expect(appels[0].url).toBe("https://api.github.com/repos/moi/bac/issues");
    // Le corps envoyé est la charge FIGÉE, pas une recomposition.
    const envoye = JSON.parse(String(appels[0].init.body));
    expect(envoye).toEqual({ title: charge.titre, body: charge.description });
  });

  it("401 : jeton révoqué → intégration dégradée, jamais un rejeu", async () => {
    const faux = (async () => reponse(401, { message: "Bad credentials" })) as unknown as typeof fetch;
    const err = await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErreurTicket);
    expect((err as ErreurTicket).code).toBe(CODES.auth);
    expect((err as ErreurTicket).degrade).toBe(true);
    expect((err as ErreurTicket).rejouable).toBe(false);
  });

  it("403 avec quota épuisé : débit dépassé, rejouable avec l'attente demandée", async () => {
    const faux = (async () =>
      reponse(403, { message: "rate limited" }, { "retry-after": "60", "x-ratelimit-remaining": "0" })) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.debit);
    expect(err.rejouable).toBe(true);
    expect(err.attendreSec).toBe(60);
  });

  it("403 sans quota : droit manquant, donc dégradation — pas un rejeu sans fin", async () => {
    const faux = (async () => reponse(403, { message: "Resource not accessible" })) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.auth);
    expect(err.degrade).toBe(true);
  });

  it("404 : la cible configurée n'existe pas — on dégrade au lieu de marteler", async () => {
    const faux = (async () => reponse(404, { message: "Not Found" })) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.cible);
    expect(err.degrade).toBe(true);
  });

  it("422 : charge refusée, définitivement — rejouer n'y changerait rien", async () => {
    const faux = (async () => reponse(422, { message: "Validation Failed" })) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.invalide);
    expect(err.rejouable).toBe(false);
  });

  it("429 : rejouable, avec l'instant de réarmement quand Retry-After manque", async () => {
    const reset = Math.ceil(Date.now() / 1000) + 45;
    const faux = (async () =>
      reponse(429, { message: "too many" }, { "x-ratelimit-reset": String(reset) })) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.debit);
    expect(err.rejouable).toBe(true);
    expect(err.attendreSec).toBeGreaterThan(30);
  });

  it("500 : panne distante, rejouable", async () => {
    const faux = (async () => reponse(503, { message: "oops" })) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.distant);
    expect(err.rejouable).toBe(true);
  });

  it("coupure réseau sur une ÉCRITURE : incertain, jamais rejouable en l'état", async () => {
    const faux = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.incertain);
    expect(err.incertain).toBe(true);
    expect(err.rejouable).toBe(false);
  });

  it("2xx au corps illisible : le ticket existe peut-être — incertain, pas un succès", async () => {
    const faux = (async () => reponse(201, "ce n'est pas du JSON")) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.incertain);
    expect(err.incertain).toBe(true);
  });

  it("2xx sans numéro ni URL : réponse illisible, jamais un identifiant inventé", async () => {
    const faux = (async () => reponse(201, { message: "ok" })) as unknown as typeof fetch;
    const err = (await createIssue({ ...base, fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.reponse);
  });

  it("une coupure sur une LECTURE est rejouable, pas incertaine : lire ne crée rien", async () => {
    const faux = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const err = (await getIssue({ ...base, externalId: "42", fetchImpl: faux }).catch((e: unknown) => e)) as ErreurTicket;
    expect(err.code).toBe(CODES.distant);
    expect(err.rejouable).toBe(true);
    expect(err.incertain).toBe(false);
  });
});

describe("P8.6 — retrouver un ticket par sa référence MIP, après une incertitude", () => {
  const reference = referenceMip(ISSUE);
  const ticket = (n: number, body: string, cree = "2026-09-18T10:00:00Z") => ({
    number: n,
    html_url: `https://github.com/moi/bac/issues/${n}`,
    state: "open",
    body,
    created_at: cree,
  });

  it("trouve le ticket créé, et rend son identifiant", async () => {
    const faux = (async () =>
      new Response(JSON.stringify([ticket(7, "autre chose"), ticket(8, `blabla\n${reference}\nfin`)]), {
        status: 200,
      })) as unknown as typeof fetch;
    const r = await chercherParReference({ cible: "moi/bac", secret: "s", reference, fetchImpl: faux });
    expect(r).toEqual({ concluante: true, trouve: { externalId: "8", url: "https://github.com/moi/bac/issues/8", etat: "open" } });
  });

  it("n'interroge JAMAIS /search/issues : son index est à cohérence différée", async () => {
    const urls: string[] = [];
    const faux = (async (url: string) => {
      urls.push(url);
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    await chercherParReference({ cible: "moi/bac", secret: "s", reference, fetchImpl: faux });
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).not.toContain("/search/");
      expect(u).toContain("/repos/moi/bac/issues?");
    }
  });

  it("absence PROUVÉE quand la page n'est pas pleine : on pourra recréer sans doublon", async () => {
    const faux = (async () =>
      new Response(JSON.stringify([ticket(7, "rien à voir")]), { status: 200 })) as unknown as typeof fetch;
    const r = await chercherParReference({ cible: "moi/bac", secret: "s", reference, fetchImpl: faux });
    expect(r).toEqual({ concluante: true, trouve: null });
  });

  it("fenêtre insuffisante : NON concluante — un opérateur tranchera", async () => {
    // Trois pages pleines, toutes postérieures à la demande : on n'a jamais
    // atteint le moment où le ticket aurait pu être créé.
    const pleine = Array.from({ length: 100 }, (_, i) => ticket(1000 - i, "rien", "2026-09-19T10:00:00Z"));
    const faux = (async () => new Response(JSON.stringify(pleine), { status: 200 })) as unknown as typeof fetch;
    const r = await chercherParReference({
      cible: "moi/bac",
      secret: "s",
      reference,
      depuis: "2026-09-18T10:00:00Z",
      fetchImpl: faux,
    });
    expect(r).toEqual({ concluante: false, raison: "fenetre_insuffisante" });
  });

  it("une page pleine ANTÉRIEURE à la demande suffit à conclure à l'absence", async () => {
    const pleine = Array.from({ length: 100 }, (_, i) => ticket(1000 - i, "rien", "2026-09-01T10:00:00Z"));
    const faux = (async () => new Response(JSON.stringify(pleine), { status: 200 })) as unknown as typeof fetch;
    const r = await chercherParReference({
      cible: "moi/bac",
      secret: "s",
      reference,
      depuis: "2026-09-18T10:00:00Z",
      fetchImpl: faux,
    });
    expect(r).toEqual({ concluante: true, trouve: null });
  });

  it("une recherche en échec n'est jamais lue comme une absence", async () => {
    for (const faire of [
      async () => new Response("{}", { status: 500 }),
      async () => new Response("pas du json", { status: 200 }),
      async () => {
        throw new Error("réseau");
      },
    ]) {
      const r = await chercherParReference({
        cible: "moi/bac",
        secret: "s",
        reference,
        fetchImpl: faire as unknown as typeof fetch,
      });
      expect(r.concluante).toBe(false);
    }
  });
});

describe("P8.6 — les secrets ne sont jamais en clair, ni en base ni en réponse", () => {
  const CLE = randomBytes(32).toString("base64");

  it("n'accepte pour référence que `env:NOM` ou `enc:v1:…`", () => {
    expect(referenceValide("env:GITHUB_TICKETS_TOKEN")).toBe(true);
    expect(referenceValide("enc:v1:" + "A".repeat(32))).toBe(true);
    // Un vrai jeton, une URL signée, un mot de passe : tout est refusé.
    expect(referenceValide("ghp_0123456789abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(referenceValide("github_pat_11ABCDEF")).toBe(false);
    expect(referenceValide("env:minuscules")).toBe(false);
    expect(referenceValide("")).toBe(false);
    expect(referenceValide(null)).toBe(false);
  });

  it("décrit une référence sans jamais rendre sa valeur", () => {
    expect(decrire("env:GITHUB_TICKETS_TOKEN")).toEqual({ kind: "env", name: "GITHUB_TICKETS_TOKEN" });
    const chiffre = chiffrer("jeton-tres-secret", { TICKET_SECRET_KEY: CLE });
    expect(decrire(chiffre)).toEqual({ kind: "encrypted" });
    expect(JSON.stringify(decrire(chiffre))).not.toContain("jeton-tres-secret");
    expect(decrire("n'importe quoi")).toEqual({ kind: "invalid" });
  });

  it("chiffre avec un nonce : deux chiffrements du même jeton diffèrent", () => {
    const env = { TICKET_SECRET_KEY: CLE };
    const a = chiffrer("meme-jeton", env);
    const b = chiffrer("meme-jeton", env);
    expect(a).not.toBe(b);
    expect(resoudre(a, env)).toBe("meme-jeton");
    expect(resoudre(b, env)).toBe("meme-jeton");
  });

  it("refuse un chiffré altéré ou déchiffré avec une autre clé", () => {
    const env = { TICKET_SECRET_KEY: CLE };
    const chiffre = chiffrer("jeton", env);
    const autre = { TICKET_SECRET_KEY: randomBytes(32).toString("base64") };
    expect(() => resoudre(chiffre, autre)).toThrow(ErreurSecret);
    const altere = `${chiffre.slice(0, -6)}AAAAAA`;
    expect(() => resoudre(altere, env)).toThrow(ErreurSecret);
  });

  it("une variable absente est une erreur, pas une chaîne vide", () => {
    // Partir avec un jeton vide donnerait un 401 du fournisseur, donc le
    // diagnostic FAUX « jeton révoqué » au lieu de « jamais fourni ».
    const err = (() => {
      try {
        resoudre("env:ABSENTE", {});
      } catch (e) {
        return e;
      }
    })() as ErreurSecret;
    expect(err).toBeInstanceOf(ErreurSecret);
    expect(err.code).toBe("variable_absente");
    expect(() => resoudre("env:PRESENTE", { PRESENTE: "v" })).not.toThrow();
  });

  it("sans clé serveur, on chiffre et déchiffre rien du tout", () => {
    expect(() => chiffrer("x", {})).toThrow(ErreurSecret);
    expect(() => resoudre("enc:v1:" + "A".repeat(64), {})).toThrow(ErreurSecret);
    expect(() => chiffrer("x", { TICKET_SECRET_KEY: "trop-courte" })).toThrow(ErreurSecret);
  });
});

describe("P8.6 — validation des requêtes d'administration", () => {
  const valide = {
    app: "app-a",
    provider: "github",
    target: "moi/bac",
    credentialRef: "env:GITHUB_TICKETS_TOKEN",
  };

  it("accepte une configuration minimale, sans mapping", () => {
    const r = parseIntegrationRequest(valide);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.config).toEqual({ statusMapping: { closed: null, reopened: null } });
      expect(r.value.webhookSecretRef).toBeNull();
    }
  });

  it("REFUSE un jeton collé à la place d'une référence", () => {
    const r = parseIntegrationRequest({ ...valide, credentialRef: "ghp_0123456789abcdefghijklmnop" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("jamais le jeton lui-même");
  });

  it("exige une cible explicite : rien n'est déduit d'un remote git", () => {
    for (const target of ["", "bac", "moi/", "/bac", "https://github.com/moi/bac", "moi/bac/issues"]) {
      const r = parseIntegrationRequest({ ...valide, target });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("rien n'est déduit");
    }
  });

  it("n'accepte aucun fournisseur non implémenté", () => {
    for (const provider of ["jira", "linear", "servicenow", ""]) {
      expect(parseIntegrationRequest({ ...valide, provider }).ok).toBe(false);
    }
  });

  it("n'accepte qu'un mapping de statuts MIP connus", () => {
    expect(parseIntegrationRequest({ ...valide, statusMapping: { closed: "resolved" } }).ok).toBe(true);
    expect(parseIntegrationRequest({ ...valide, statusMapping: { closed: "ignored" } }).ok).toBe(false);
    expect(parseIntegrationRequest({ ...valide, statusMapping: { reopened: "supprimee" } }).ok).toBe(false);
  });

  it("le patch exige au moins une mutation, et ne sait pas dégrader", () => {
    expect(parseIntegrationPatch({}).ok).toBe(false);
    expect(parseIntegrationPatch({ enabled: true }).ok).toBe(true);
    expect(parseIntegrationPatch({ state: "degraded" }).ok).toBe(false);
    expect(parseIntegrationPatch({ state: "active" }).ok).toBe(true);
    expect(parseIntegrationPatch({ configVersion: 0 }).ok).toBe(false);
  });

  it("une demande de ticket exige app, intégration et révision lue", () => {
    expect(parseDemandeTicket({ app: "a", integrationId: 1, expectedRevision: 3 }).ok).toBe(true);
    expect(parseDemandeTicket({ app: "a", integrationId: 1 }).ok).toBe(false);
    expect(parseDemandeTicket({ app: "", integrationId: 1, expectedRevision: 1 }).ok).toBe(false);
    expect(parseDemandeTicket({ app: "a", integrationId: "0", expectedRevision: 1 }).ok).toBe(false);
  });
});
