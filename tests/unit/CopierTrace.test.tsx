// CopierTrace (§ 4.3, F61) : l'identifiant COMPLET d'une trace se copie. L'en-tête
// n'en montrait que 16 caractères ; le repli sans presse-papiers est un champ en
// lecture seule qui porte les 32.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopierTrace } from "@/components/tracing/CopierTrace";

const TRACE = "0af7651916cd43dd8448eb211c80319c";

describe("CopierTrace", () => {
  it("rend les 32 caractères dans un champ en lecture seule, nommé, et un bouton de copie", () => {
    const html = renderToStaticMarkup(<CopierTrace traceId={TRACE} />);
    expect(html).toContain(`value="${TRACE}"`);
    expect(html).toMatch(/<input[^>]*readonly=""/i);
    expect(html).toContain('aria-label="Identifiant de trace"');
    expect(html).toContain('type="button"');
    expect(html).toContain("Copier l&#x27;identifiant");
  });
});
