import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("rendu Expérience sans avis noté", () => {
  it("emploie le panneau données insuffisantes sans inventer un score /100", () => {
    const page = readFileSync(join(process.cwd(), "apps/console/app/experience/page.tsx"), "utf8");
    const component = readFileSync(join(process.cwd(), "apps/console/components/ExperienceUnavailable.tsx"), "utf8");
    expect(page).toContain("<ExperienceUnavailable />");
    expect(component).toContain("Données insuffisantes");
    expect(component).not.toContain("/100");
  });
});
