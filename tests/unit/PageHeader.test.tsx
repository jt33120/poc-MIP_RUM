// PageHeader — le titre seul (recette du 30/09/2026) : ni surtitre, qui redisait la
// catégorie allumée dans la barre latérale, ni phrase-question sous le titre.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ usePathname: () => "/explorer" }));

const { PageHeader } = await import("@/components/PageHeader");

describe("PageHeader — le titre seul", () => {
  it("n'écrit pas la catégorie : la barre latérale la dit", () => {
    const html = renderToStaticMarkup(<PageHeader title="Pages" domain="perf" />);
    expect(html).toContain("Pages");
    expect(html).not.toContain("Performance");
  });

  it("n'écrit pas la phrase-question", () => {
    const html = renderToStaticMarkup(<PageHeader title="Vue d'ensemble" sub="Les vrais visiteurs vont-ils bien ?" />);
    expect(html).not.toContain("visiteurs");
  });
});
