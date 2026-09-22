// `lire` (F02, § 4.2) : une lecture en échec devient une VALEUR que la section
// rend en état « erreur » — jamais un vide ou un zéro de repli, jamais une
// exception qui emporte tout l'écran. Deux exceptions ne sont pas capturées : le
// refus d'un filtre (contrat, pas panne) et les signaux de contrôle de Next.
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `next` est une dépendance de la console, pas de la racine : on prend ses
// signaux de navigation là où `lib/lecture.ts` les résout.
const { notFound, redirect } = createRequire(`${process.cwd()}/apps/console/package.json`)(
  "next/navigation",
) as typeof import("next/navigation");

const { forwardLog } = vi.hoisted(() => ({ forwardLog: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock("@/lib/log-forward", () => ({ forwardLog }));

import { lire } from "@/lib/lecture";
import { UnsupportedFilterError } from "@/lib/query-compiler";

describe("lire", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    forwardLog.mockClear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("rend la donnée d'une lecture réussie, telle quelle — un vide réel reste un vide", async () => {
    await expect(lire(async () => [1, 2, 3])).resolves.toEqual({ ok: true, data: [1, 2, 3] });
    await expect(lire(async () => [])).resolves.toEqual({ ok: true, data: [] });
    await expect(lire(async () => 0)).resolves.toEqual({ ok: true, data: 0 });
    expect(forwardLog).not.toHaveBeenCalled();
  });

  it("une base qui ne répond pas donne { ok: false, raison }, pas une valeur de repli", async () => {
    const lecture = await lire<number[]>(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5433");
    });
    expect(lecture).toEqual({ ok: false, raison: "connect ECONNREFUSED 127.0.0.1:5433" });
    // Aucune donnée n'accompagne l'échec : la section ne peut rien afficher de partiel.
    expect("data" in lecture).toBe(false);
  });

  it("journalise l'échec côté serveur, sur le canal de lib/log-forward", async () => {
    await lire(async () => {
      throw new Error("relation \"rum_longtask\" does not exist");
    });
    expect(consoleError).toHaveBeenCalled();
    expect(forwardLog).toHaveBeenCalledTimes(1);
    const [niveau, corps] = forwardLog.mock.calls[0] as unknown as [string, string];
    expect(niveau).toBe("error");
    expect(corps).toContain("[lecture]");
    expect(corps).toContain('relation "rum_longtask" does not exist');
  });

  it("une valeur levée qui n'est pas une Error garde une raison lisible", async () => {
    await expect(
      lire(async () => {
        throw "délai dépassé";
      }),
    ).resolves.toEqual({ ok: false, raison: "délai dépassé" });
  });

  it("un filtre non applicable n'est pas une panne : il est relancé (refus, V10)", async () => {
    const refus = new UnsupportedFilterError({
      code: "unsupported_dimension",
      message: "« Navigateur » n'est pas encore collecté pour les tâches longues",
      dimension: "browser",
    });
    await expect(
      lire(async () => {
        throw refus;
      }),
    ).rejects.toBe(refus);
    expect(forwardLog).not.toHaveBeenCalled();
  });

  it("notFound() et redirect() traversent lire : la navigation n'est jamais avalée", async () => {
    await expect(lire(async () => notFound())).rejects.toThrow();
    await expect(lire(async () => redirect("/select"))).rejects.toThrow();
    expect(forwardLog).not.toHaveBeenCalled();
  });
});
