// P5.6 — contrat des mutations de workflow d'une issue, lu sans base.
//
// Ce qui entre en base doit déjà respecter error_issue_activity_v73 et
// error_issue_ticket_v73 : commentaire scrubbé de 1 à 2 000 caractères APRÈS
// masquage, URL HTTPS normalisée en ASCII sans identifiants, libellé d'une ligne.
// Le comportement transactionnel (409, périmètre, assigné, régression) est prouvé
// sur PostgreSQL dans tests/integration/error-issues-sql.test.ts.
import { describe, expect, it } from "vitest";
import {
  COMMENTAIRE_MAX,
  texteActivite,
  tronquerCaracteres,
} from "../../packages/backend/lib/error-issue-workflow.mjs";
import {
  COMMENT_MAX_CHARS,
  hasSqlControlCharacters,
  normalizeTicketUrl,
  parseBigintId,
  parseCommentRequest,
  parseLinkRequest,
  parseTriageRequest,
} from "../../apps/console/lib/error-issue-workflow";
import { ISSUE_STATUSES } from "../../apps/console/lib/error-issues";

const base = { app: "app-a", expectedRevision: "3" };

describe("texte d'activité partagé ingestion/console", () => {
  it("scrubbe comme un message d'erreur, retire NUL et espaces de bord", () => {
    expect(texteActivite("  appeler jean@exemple.fr, token=abc123\u0000 ")).toBe("appeler [email], token=[redacted]");
    expect(texteActivite(" \n\t ")).toBeNull();
    expect(texteActivite(42)).toBeNull();
  });

  it("tronque en points de code, comme char_length de PostgreSQL", () => {
    const emoji = "😀".repeat(3);
    expect(tronquerCaracteres(emoji, 2)).toBe("😀😀");
    expect(tronquerCaracteres("court", 10)).toBe("court");
    expect(COMMENT_MAX_CHARS).toBe(COMMENTAIRE_MAX);
  });
});

describe("POST /api/v1/issues/{id}/triage — corps", () => {
  it("statuts de migration-v72, assigné en identifiant de compte ou null", () => {
    for (const status of ISSUE_STATUSES) {
      expect(parseTriageRequest({ ...base, status })).toEqual({ ok: true, value: { ...base, status } });
    }
    expect(parseTriageRequest({ ...base, assigneeUserId: 12 })).toEqual({ ok: true, value: { ...base, assigneeUserId: "12" } });
    expect(parseTriageRequest({ ...base, assigneeUserId: "9007199254740993" })).toMatchObject({
      ok: true,
      value: { assigneeUserId: "9007199254740993" },
    });
    expect(parseTriageRequest({ ...base, assigneeUserId: null })).toEqual({ ok: true, value: { ...base, assigneeUserId: null } });
  });

  it("exige app, expectedRevision et au moins une mutation", () => {
    expect(parseTriageRequest({ ...base })).toMatchObject({ ok: false, error: expect.stringMatching(/au moins une mutation/) });
    expect(parseTriageRequest({ status: "open", expectedRevision: "1" })).toMatchObject({ ok: false, error: "app requise" });
    expect(parseTriageRequest({ app: "app-a", status: "open" })).toMatchObject({ ok: false, error: expect.stringMatching(/expectedRevision/) });
    expect(parseTriageRequest({ ...base, expectedRevision: 0, status: "open" })).toMatchObject({ ok: false });
    expect(parseTriageRequest({ ...base, expectedRevision: 1.5, status: "open" })).toMatchObject({ ok: false });
    expect(parseTriageRequest({ ...base, status: "regressed" })).toMatchObject({ ok: false, error: expect.stringMatching(/status invalide/) });
    expect(parseTriageRequest({ ...base, assigneeUserId: "jean@exemple.fr" })).toMatchObject({ ok: false });
    expect(parseTriageRequest([base])).toMatchObject({ ok: false, error: "objet JSON attendu" });
    expect(parseTriageRequest({ ...base, app: "app\na", status: "open" })).toMatchObject({ ok: false, error: "app requise" });
  });

  it("identifiants bigint : jamais un nombre hors plage sûre, jamais zéro", () => {
    expect(parseBigintId(1)).toBe("1");
    expect(parseBigintId("42")).toBe("42");
    expect(parseBigintId(2 ** 53)).toBeNull();
    expect(parseBigintId("042")).toBeNull();
    expect(parseBigintId("-1")).toBeNull();
    expect(parseBigintId("1e3")).toBeNull();
  });
});

describe("POST /api/v1/issues/{id}/comments — corps", () => {
  it("scrubbé avant stockage et borné APRÈS masquage", () => {
    expect(parseCommentRequest({ ...base, body: " Voir avec paul@exemple.fr " })).toEqual({
      ok: true,
      value: { ...base, body: "Voir avec [email]" },
    });
    expect(parseCommentRequest({ ...base, body: "x".repeat(2000) })).toMatchObject({ ok: true });
    expect(parseCommentRequest({ ...base, body: "x".repeat(2001) })).toMatchObject({ ok: false, error: expect.stringMatching(/2000/) });
    // 1 995 caractères + « pwd=a » deviennent plus de 2 000 une fois masqués.
    expect(parseCommentRequest({ ...base, body: `${"x".repeat(1995)} pwd=a` })).toMatchObject({ ok: false });
    expect(parseCommentRequest({ ...base, body: "   " })).toMatchObject({ ok: false, error: expect.stringMatching(/body requis/) });
    expect(parseCommentRequest({ ...base, body: 12 })).toMatchObject({ ok: false });
  });
});

describe("POST /api/v1/issues/{id}/links — corps", () => {
  it("URL HTTPS normalisée en ASCII, sans identifiants, 2 048 caractères au plus", () => {
    expect(normalizeTicketUrl("https://jira.exemple.fr/browse/MIP-12")).toBe("https://jira.exemple.fr/browse/MIP-12");
    expect(normalizeTicketUrl(" https://Tickets.Exemple.fr/é?q=a b ")).toBe("https://tickets.exemple.fr/%C3%A9?q=a%20b");
    expect(normalizeTicketUrl("https://bücher.exemple/x")).toBe("https://xn--bcher-kva.exemple/x");
    expect(normalizeTicketUrl("http://jira.exemple.fr/browse/MIP-12")).toBeNull();
    expect(normalizeTicketUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeTicketUrl("https://moi:secret@jira.exemple.fr/")).toBeNull();
    expect(normalizeTicketUrl(`https://jira.exemple.fr/${"a".repeat(2030)}`)).toBeNull();
    expect(normalizeTicketUrl("pas une url")).toBeNull();
  });

  it("libellé d'une ligne, scrubbé, 120 caractères au plus", () => {
    const url = "https://github.com/org/depot/issues/7";
    expect(parseLinkRequest({ ...base, url, label: " Ticket de marie@exemple.fr " })).toEqual({
      ok: true,
      value: { ...base, url, label: "Ticket de [email]" },
    });
    expect(parseLinkRequest({ ...base, url, label: "a\nb" })).toMatchObject({ ok: false, error: expect.stringMatching(/label/) });
    // `[[:cntrl:]]` de PostgreSQL refuse aussi C1 (U+0080 à U+009F) : 400 ici plutôt que 500 en base.
    expect(parseLinkRequest({ ...base, url, label: "MIP\u0085-1" })).toMatchObject({ ok: false, error: expect.stringMatching(/label/) });
    expect(hasSqlControlCharacters("a\u009fb")).toBe(true);
    expect(hasSqlControlCharacters("MIP-1 \u00a0é")).toBe(false);
    expect(parseLinkRequest({ ...base, url, label: "x".repeat(121) })).toMatchObject({ ok: false });
    expect(parseLinkRequest({ ...base, url, label: "" })).toMatchObject({ ok: false });
    expect(parseLinkRequest({ ...base, url: "ftp://x", label: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/url invalide/) });
  });
});
