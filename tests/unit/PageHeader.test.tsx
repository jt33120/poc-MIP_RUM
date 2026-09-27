// PageHeader — le surtitre dit la catégorie, sauf s'il redit le titre (recette du
// 26/09/2026 : « Explorer » écrit quatre fois en haut de l'Explorer).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ usePathname: () => "/explorer" }));

const { PageHeader } = await import("@/components/PageHeader");

describe("PageHeader — surtitre", () => {
  it("un surtitre qui redit le titre n'est pas écrit", () => {
    const html = renderToStaticMarkup(<PageHeader title="Explorer" />);
    expect(html.match(/Explorer/gi)).toHaveLength(1);
  });

  it("un surtitre qui dit autre chose reste", () => {
    const html = renderToStaticMarkup(<PageHeader title="Pages" domain="perf" />);
    expect(html).toContain("Performance");
    expect(html).toContain("Pages");
  });
});
