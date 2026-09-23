// A2 — scrub PII à l'ingestion (défense en profondeur). Logique pure, exécutée
// par vitest dans les deux runtimes ciblés (module _shared runtime-agnostic).
// Couvre scrubText / scrubUrl / scrubProps + le bout-en-bout via flattenOtlp
// (0 PII dans les lignes écrites en base).
import { describe, expect, it } from "vitest";
import {
  scrubProps,
  scrubText,
  scrubUrl,
} from "../../packages/backend/shared/scrub.mjs";
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

describe("scrubText — masque secrets et données personnelles", () => {
  it("emails", () => {
    expect(scrubText("contact jean.dupont@client.fr svp")).toBe("contact [email] svp");
  });
  it("Bearer + JWT", () => {
    expect(scrubText("Authorization: Bearer abc.def.ghi123")).toContain("Bearer [redacted]");
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";
    expect(scrubText(`token ${jwt}`)).toBe("token [jwt]");
  });
  it("clés à préfixe (sk-/mip_)", () => {
    expect(scrubText("key sk-ABCDEFGH1234")).toBe("key [key]");
    expect(scrubText("apiKey mip_0123456789abcdef")).toBe("apiKey [key]");
  });
  it("affectation clé=valeur sensible", () => {
    expect(scrubText("password=hunter2 and x=1")).toBe("password=[redacted] and x=1");
    expect(scrubText('{"api_key":"s3cr3tvalue"}')).toContain('api_key":"[redacted]');
  });
  it("longues suites de chiffres (carte) et IPv4", () => {
    expect(scrubText("carte 4111 1111 1111 1111 refusée")).toBe("carte [number] refusée");
    expect(scrubText("from 192.168.1.42 denied")).toBe("from [ip] denied");
  });
  it("préserve le texte utile : petits nombres, identifiants pointés de stack", () => {
    expect(scrubText("TypeError at line 42, col 7")).toBe("TypeError at line 42, col 7");
    // une stack avec identifiants pointés ne doit PAS être prise pour un JWT
    expect(scrubText("at Object.Module.exports (app.js)")).toBe(
      "at Object.Module.exports (app.js)",
    );
  });
  it("non-string -> null", () => {
    expect(scrubText(undefined)).toBeNull();
    expect(scrubText(42 as unknown as string)).toBeNull();
  });
});

describe("scrubUrl — query/fragment retirés + secrets masqués", () => {
  it("retire query et fragment (le token en query disparaît)", () => {
    expect(scrubUrl("https://x.fr/cb?token=abc123&u=2#frag")).toBe("https://x.fr/cb");
  });
  it("masque un email/clé restés dans le chemin", () => {
    expect(scrubUrl("https://x.fr/u/jean@client.fr/profil")).toBe("https://x.fr/u/[email]/profil");
  });
  it("préserve un id numérique de chemin (utile, non identifiant)", () => {
    expect(scrubUrl("https://x.fr/aos/12345")).toBe("https://x.fr/aos/12345");
  });
  it("non-string -> null", () => expect(scrubUrl(null)).toBeNull());
});

describe("scrubProps — props d'événements (définies par le client)", () => {
  it("masque les clés sensibles, nettoie les strings, garde les nombres", () => {
    expect(
      scrubProps({ password: "x", note: "mail a@b.fr", amount: 12, nested: { token: "t" } }),
    ).toEqual({
      password: "[redacted]",
      note: "mail [email]",
      amount: 12,
      nested: { token: "[redacted]" },
    });
  });
  it("borne la profondeur sur un objet hostile", () => {
    let o: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i++) o = { child: o };
    expect(() => JSON.stringify(scrubProps(o))).not.toThrow();
  });
  it("null/undefined passent", () => expect(scrubProps(null)).toBeNull());
});

// --- bout-en-bout : aucune PII connue ne doit subsister dans les lignes -------
describe("flattenOtlp — scrub appliqué aux erreurs et aux événements", () => {
  const sv = (s: string) => ({ stringValue: s });
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "mip.app_id", value: sv("demo") }] },
        scopeSpans: [
          {
            spans: [
              {
                spanId: "s1",
                name: "exception",
                startTimeUnixNano: "1760000000000000000",
                attributes: [
                  { key: "mip.session_id", value: sv("sess-1") },
                  { key: "exception.type", value: sv("Error") },
                  {
                    key: "exception.message",
                    value: sv("login failed for jean@client.fr password=hunter2"),
                  },
                  {
                    key: "exception.stacktrace",
                    value: sv("at auth (app.js) Bearer abc.def.ghijklmno"),
                  },
                  { key: "mip.error_source", value: sv("https://x.fr/app.js?token=zzz") },
                ],
              },
              {
                spanId: "s2",
                name: "track.signup",
                startTimeUnixNano: "1760000000000000000",
                attributes: [
                  { key: "mip.session_id", value: sv("sess-1") },
                  { key: "mip.props", value: sv('{"email":"a@b.fr","plan":"pro"}') },
                ],
              },
              {
                spanId: "s3",
                name: "breadcrumb",
                startTimeUnixNano: "1760000000000000000",
                attributes: [
                  { key: "mip.session_id", value: sv("sess-1") },
                  { key: "breadcrumb.type", value: sv("email jean@client.fr password=hunter2") },
                  { key: "breadcrumb.label", value: sv("clic jean@client.fr eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N depuis 192.168.1.42") },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const rows = flattenOtlp(payload);

  it("erreur : email/secret/Bearer masqués, query retirée de la source", () => {
    const e = rows.errors[0];
    expect(e.message).toBe("login failed for [email] password=[redacted]");
    expect(e.stack).toContain("Bearer [redacted]");
    expect(e.source).toBe("https://x.fr/app.js");
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain("jean@client.fr");
    expect(blob).not.toContain("hunter2");
  });

  it("événement : clé sensible des props masquée", () => {
    expect(rows.events[0].props).toEqual({ email: "[redacted]", plan: "pro" });
    expect(JSON.stringify(rows.events)).not.toContain("a@b.fr");
  });

  it("breadcrumb : email, JWT et IP ne franchissent jamais la persistance", () => {
    expect(rows.breadcrumbs[0].label).toContain("[email]");
    expect(rows.breadcrumbs[0].label).toContain("[jwt]");
    expect(rows.breadcrumbs[0].label).toContain("[ip]");
    const blob = JSON.stringify(rows.breadcrumbs);
    expect(blob).not.toContain("jean@client.fr");
    expect(blob).not.toContain("dozjgNryP4J3jVmNHl0w5N");
    expect(blob).not.toContain("192.168.1.42");
  });

  it("breadcrumb : type est une taxonomie et label est scrubé puis borné", () => {
    expect(rows.breadcrumbs[0].type).toBe("custom");
    const oversized = flattenOtlp({
      ...payload,
      resourceSpans: [{
        ...payload.resourceSpans[0],
        scopeSpans: [{
          ...payload.resourceSpans[0].scopeSpans[0],
          spans: [{
            ...payload.resourceSpans[0].scopeSpans[0].spans[2],
            attributes: [
              { key: "mip.session_id", value: sv("sess-1") },
              { key: "breadcrumb.type", value: sv("NAV") },
              { key: "breadcrumb.label", value: sv("a".repeat(300)) },
            ],
          }],
        }],
      }],
    });
    expect(oversized.breadcrumbs[0]).toMatchObject({ type: "nav" });
    expect(oversized.breadcrumbs[0].label).toHaveLength(120);
  });
});
