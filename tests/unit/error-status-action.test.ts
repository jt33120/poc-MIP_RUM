import { beforeEach, describe, expect, it, vi } from "vitest";

// Triage d'un groupe d'erreurs par empreinte : l'action serveur refuse tout ce que
// l'écran ne propose pas (V9). Sans cette garde, masquer les boutons ne protégeait
// rien — une session de démonstration pouvait écrire par un POST direct.
vi.mock("@/lib/next-cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ q: vi.fn() }));
vi.mock("@/lib/queries-v2", () => ({
  ERROR_STATUSES: ["open", "resolved", "ignored"],
  setErrorStatus: vi.fn(),
}));

import { setErrorStatusAction } from "@/app/errors/[fingerprint]/actions";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { setErrorStatus } from "@/lib/queries-v2";

function formulaire(appId = "app-a"): FormData {
  const fd = new FormData();
  fd.set("app_id", appId);
  fd.set("fingerprint", "fp-1");
  fd.set("status", "resolved");
  return fd;
}

type Session = { email: string; role: "admin" | "viewer"; apps: string[] | null; demo?: boolean };
const connecter = (s: Session | null) => vi.mocked(getUser).mockResolvedValue(s as never);

describe("setErrorStatusAction — qui peut trier un groupe d'erreurs", () => {
  beforeEach(() => {
    vi.mocked(setErrorStatus).mockReset();
    vi.mocked(q).mockReset();
  });

  it("un admin de l'app trie, et l'écriture est tracée", async () => {
    connecter({ email: "admin@x", role: "admin", apps: null });
    await setErrorStatusAction(formulaire());
    expect(setErrorStatus).toHaveBeenCalledWith("app-a", "fp-1", "resolved", "admin@x");
    expect(q).toHaveBeenCalledTimes(1);
  });

  it("un viewer ne trie pas, même dans son périmètre", async () => {
    connecter({ email: "viewer@x", role: "viewer", apps: ["app-a"] });
    await setErrorStatusAction(formulaire());
    expect(setErrorStatus).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
  });

  it("la démonstration n'écrit rien, quel que soit son rôle", async () => {
    connecter({ email: "demo@x", role: "viewer", apps: ["demo-app"], demo: true });
    await setErrorStatusAction(formulaire("demo-app"));
    connecter({ email: "demo-admin@x", role: "admin", apps: ["demo-app"], demo: true });
    await setErrorStatusAction(formulaire("demo-app"));
    expect(setErrorStatus).not.toHaveBeenCalled();
  });

  it("sans session, rien", async () => {
    connecter(null);
    await setErrorStatusAction(formulaire());
    expect(setErrorStatus).not.toHaveBeenCalled();
  });
});
