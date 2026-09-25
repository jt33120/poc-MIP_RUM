import { beforeEach, describe, expect, it, vi } from "vitest";

// Triage d'un groupe d'erreurs par empreinte : l'action serveur refuse tout ce que
// l'écran ne propose pas (V9). Sans cette garde, masquer les boutons ne protégeait
// rien — une session de démonstration pouvait écrire par un POST direct.
// C7 : l'action passe par sa commande (`trierGroupe`) — la règle `admin` + portée
// `app`, puis le statut et sa ligne d'audit dans une transaction.
const { client } = vi.hoisted(() => ({ client: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/next-cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ q: vi.fn(async () => []), tx: vi.fn(async (fn: (c: unknown) => unknown) => fn(client)) }));
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
    vi.mocked(q).mockClear();
    client.query.mockClear();
  });

  it("un admin de l'app trie, et l'écriture est tracée dans la même transaction", async () => {
    connecter({ email: "admin@x", role: "admin", apps: null });
    await setErrorStatusAction(formulaire());
    expect(setErrorStatus).toHaveBeenCalledWith("app-a", "fp-1", "resolved", "admin@x", client);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into audit_log"), ["admin@x", "error.set_status", "app-a/fp-1 -> resolved"]);
  });

  it("un viewer ne trie pas, même dans son périmètre", async () => {
    connecter({ email: "viewer@x", role: "viewer", apps: ["app-a"] });
    await setErrorStatusAction(formulaire());
    expect(setErrorStatus).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("un administrateur avec une liste ne trie que ses applications (C7)", async () => {
    connecter({ email: "admin-a@x", role: "admin", apps: ["app-a"] });
    await setErrorStatusAction(formulaire("app-b"));
    expect(setErrorStatus).not.toHaveBeenCalled();
    await setErrorStatusAction(formulaire("app-a"));
    expect(setErrorStatus).toHaveBeenCalledTimes(1);
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
