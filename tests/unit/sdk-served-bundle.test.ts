import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("bundle SDK réellement servi", () => {
  it("expose les APIs P2 depuis apps/console/public/mip-rum.js", () => {
    const code = readFileSync("apps/console/public/mip-rum.js", "utf8");
    const sandbox: Record<string, unknown> = {
      crypto: globalThis.crypto,
      TextEncoder,
      setInterval: () => 1,
      clearInterval: () => {},
    };
    vm.runInNewContext(code, sandbox);
    const sdk = sandbox.MIPRum as Record<string, unknown>;
    for (const method of [
      "setGlobalContext", "setUser", "setAccount", "startView", "addAction",
      "addTiming", "addFeatureFlagEvaluation", "addError",
    ]) expect(typeof sdk[method]).toBe("function");
  });
});
