// E0 — Contexte de trace W3C du SDK web (logique pure, sans DOM).
//
// Régression gardée ici : AVANT, chaque span tirait son propre traceId au hasard
// (`traceId: hexId(16)` dans startSpan), donc aucun span n'appartenait à la même
// trace qu'un autre et un backend OTel voyait autant de traces que de spans.
// Le contrat est désormais : UN traceId par page vue, partagé, tournant à chaque
// navigation.
import { describe, expect, it } from "vitest";
import { traceparent } from "../../packages/rum-sdk/src/apispans";
import { currentTraceId, newPageTrace } from "../../packages/rum-sdk/src/otel";

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

describe("contexte de trace de la page vue (E0)", () => {
  it("expose un traceId au format W3C (16 octets hex, non tout-zéro)", () => {
    const id = currentTraceId();
    expect(id).toMatch(HEX32);
    expect(id).not.toBe("0".repeat(32));
  });

  it("est STABLE entre deux appels — c'est tout l'objet du correctif", () => {
    expect(currentTraceId()).toBe(currentTraceId());
  });

  it("newPageTrace() ouvre une trace différente et la rend courante", () => {
    const before = currentTraceId();
    const opened = newPageTrace();
    expect(opened).toMatch(HEX32);
    expect(opened).not.toBe(before);
    expect(currentTraceId()).toBe(opened);
  });

  it("50 navigations successives produisent 50 traces distinctes", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newPageTrace()));
    expect(ids.size).toBe(50);
  });
});

describe("en-tête traceparent porté par les appels API", () => {
  it("suit le format W3C version 00, échantillonné", () => {
    const tid = currentTraceId();
    const header = traceparent(tid, "00000000000000a2");
    expect(header).toBe(`00-${tid}-00000000000000a2-01`);
    const [version, traceId, spanId, flags] = header.split("-");
    expect(version).toBe("00");
    expect(traceId).toMatch(HEX32);
    expect(spanId).toMatch(HEX16);
    expect(flags).toBe("01");
  });

  it("porte la trace de la PAGE — le serveur rejoint la trace du pageview", () => {
    const tid = currentTraceId();
    // deux appels API de la même page vue -> même traceId, spanId différents
    const a = traceparent(tid, "00000000000000a1").split("-");
    const b = traceparent(tid, "00000000000000b2").split("-");
    expect(a[1]).toBe(b[1]);
    expect(a[2]).not.toBe(b[2]);
  });
});
