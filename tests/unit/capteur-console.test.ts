// Le snippet du capteur de la console : la clé d'ingestion n'y entre que bien
// formée, et son absence laisse le snippet tel qu'il était avant elle.
import { describe, expect, it } from "vitest";
import { scriptCapteurConsole } from "../../apps/console/lib/capteur-console";

const BASE = { endpoint: "https://mip-rum-console.vercel.app/api/ingest", release: "abc123def456", replay: 1 };
const CLE = `mip_${"0123456789abcdef".repeat(2)}`;

describe("scriptCapteurConsole", () => {
  it("sans clé : le snippet d'avant, à l'octet près", () => {
    expect(scriptCapteurConsole(BASE)).toBe(
      'window.MIPRum && MIPRum.init({endpoint:"https://mip-rum-console.vercel.app/api/ingest",appId:"mip-rum-console",clientId:"mip",env:"prod",release:"abc123def456",replay:1});',
    );
  });

  it("une clé bien formée est ajoutée, espaces retirés", () => {
    const s = scriptCapteurConsole({ ...BASE, apiKey: `  ${CLE}\n` });
    expect(s).toContain(`,apiKey:"${CLE}"});`);
  });

  it.each([
    ["vide", ""],
    ["absente", undefined],
    ["nulle", null],
    ["mauvais préfixe", CLE.replace("mip_", "mop_")],
    ["trop courte", CLE.slice(0, -1)],
    ["majuscules", CLE.toUpperCase().replace("MIP_", "mip_")],
    ["tentative d'injection", `${CLE}"});</script><script>alert(1)//`],
  ])("clé %s : ignorée", (_cas, apiKey) => {
    expect(scriptCapteurConsole({ ...BASE, apiKey })).not.toContain("apiKey");
  });
});
