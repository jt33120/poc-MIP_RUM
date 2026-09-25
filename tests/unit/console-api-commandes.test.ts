// C6 → C9 — une écriture a UNE règle, appliquée des deux côtés à l'identique.
//
// Quand la console exécute ses commandes elle-même (`lib/commande.ts`, hors de la
// part servie par console-api), elle applique leur règle par `refusDAcces` (contrat) ; console-api l'applique
// par son pipeline, avec la politique qu'il en TIRE (`politiqueDeCommande`). Deux
// codes pour une même règle : ce test les confronte pour chaque commande du
// registre, chaque profil et chaque application demandée — même refus, au code
// près, ou le même passage. Une console plus permissive que le service rougit ici.
//
// Les vraies commandes, sur une vraie base, sont dans la matrice d'autorisations.
import { describe, expect, it, vi } from "vitest";
import { COMMANDES, refusDAcces, type CleCommande, type PrincipalRegle } from "@mip/console-contract";
import { creerConsoleApi, operationsCommandes, politiqueDeCommande, verifierTable, type CommandesServies } from "@mip/console-api";

// Le registre tire la couche de données de la console : aucune requête ne part ici.
vi.mock("@/lib/db", () => ({ q: vi.fn(async () => []), tx: vi.fn(), pool: {} }));
const { COMMANDES_CONSOLE } = await import("@/lib/commandes");

const SECRET = "c".repeat(40);
const CLES = Object.keys(COMMANDES) as CleCommande[];

/** Les profils : leur jeton, et ce qu'ils valent. `null` : aucune session. */
const PROFILS: Record<string, PrincipalRegle | null> = {
  anonyme: null,
  demo: { role: "viewer", apps: ["a"], demo: true },
  "viewer [a]": { role: "viewer", apps: ["a"] },
  "viewer (toutes)": { role: "viewer", apps: null },
  "viewer []": { role: "viewer", apps: [] },
  "admin [a]": { role: "admin", apps: ["a"] },
  "admin []": { role: "admin", apps: [] },
  "admin plateforme": { role: "admin", apps: null },
};
const APPS: (string | null)[] = [null, "a", "b", "all", "!mauvaise"];
const jeton = (profil: string) => `jeton-${profil.replace(/[^a-z]/g, "-")}`.padEnd(24, "0");

describe("C6 — le registre des commandes couvre le contrat, et chaque règle est une politique valide", () => {
  it("une commande par écriture du contrat, et rien de plus", () => {
    expect(Object.keys(COMMANDES_CONSOLE).sort()).toEqual([...CLES].sort());
  });

  it("toute écriture est refusée à la démo et déclare son audit — `verifierTable` accepte la table", () => {
    const table = operationsCommandes(COMMANDES_CONSOLE as unknown as CommandesServies);
    expect(verifierTable(table)).toEqual([]);
    for (const e of table) {
      expect(e.politique.demo, e.operation.id).toBe("refus");
      expect(e.politique.audit, e.operation.id).toBeDefined();
    }
  });

  it("une règle `app` devient la portée « une application nommée » ; le corps est validé par le validateur de la commande", () => {
    const creer = COMMANDES_CONSOLE.creerObjectif;
    const p = politiqueDeCommande(creer);
    expect(p).toMatchObject({ auth: "admin", portee: "une-app", demo: "refus", audit: "goal.create" });
    expect(p.entree?.corps).toBe(creer.corps);
    expect(politiqueDeCommande(COMMANDES_CONSOLE.supprimerTableau).portee).toBe("globale");
  });
});

describe("C6 — la console et console-api refusent les mêmes écritures, pour les mêmes raisons", () => {
  // Une commande factice par clé : la VRAIE règle, sans validateurs ni base — ce test ne porte que sur l'accès.
  const passees: string[] = [];
  const factices = Object.fromEntries(
    CLES.map((cle) => [cle, { regle: COMMANDES_CONSOLE[cle].regle, executer: async () => (passees.push(cle), { passe: true }) }]),
  ) as unknown as CommandesServies;
  const principaux = Object.fromEntries(
    Object.entries(PROFILS).flatMap(([nom, p]) =>
      p ? [[jeton(nom), { kind: "session" as const, sessionId: nom, userId: "1", email: `${nom}@mip.test`, role: p.role, apps: p.apps, demo: p.demo === true }]] : [],
    ),
  );
  const api = creerConsoleApi({
    table: operationsCommandes(factices),
    secretsClient: [SECRET],
    journal: { info() {}, warn() {}, error() {} },
    verifierSession: async (j) => principaux[j] ?? null,
    debitParMinute: 0,
  });

  it("chaque commande × chaque profil × chaque application : même code de refus, ou le même passage", async () => {
    const ecarts: string[] = [];
    let cas = 0;
    for (const cle of CLES) {
      const op = COMMANDES[cle];
      const chemin = op.chemin.replace(/\{[^}]+\}/g, "1");
      for (const [nom, principal] of Object.entries(PROFILS)) {
        for (const app of APPS) {
          cas++;
          const local = refusDAcces(COMMANDES_CONSOLE[cle].regle, principal, app);
          const entetes: Record<string, string> = { "x-mip-client": SECRET };
          if (principal) entetes.authorization = `Bearer ${jeton(nom)}`;
          const qs = app === null ? "" : `?app=${encodeURIComponent(app)}`;
          const r = await api(new Request(`https://c.test${chemin}${qs}`, { method: op.methode, headers: entetes }));
          const service = r.status === 200 ? null : ((await r.json()) as { error: { code: string } }).error.code;
          if ((local?.code ?? null) !== service) ecarts.push(`${op.id} · ${nom} · app=${app} : console ${local?.code ?? "passe"}, service ${service ?? "passe"}`);
        }
      }
    }
    expect(ecarts).toEqual([]);
    expect(cas).toBe(CLES.length * Object.keys(PROFILS).length * APPS.length);
    // Le passage est réel : les commandes permises ont bien été appelées par le service.
    expect(passees.length).toBeGreaterThan(0);
  });

  it("une écriture ne vise jamais `all` : refusée des deux côtés, avant la commande", async () => {
    const regle = COMMANDES_CONSOLE.creerObjectif.regle;
    expect(refusDAcces(regle, { role: "admin", apps: null }, "all")).toMatchObject({ code: "entree_invalide", champ: "app" });
    const r = await api(
      new Request("https://c.test/v1/goals?app=all", { method: "POST", headers: { "x-mip-client": SECRET, authorization: `Bearer ${jeton("admin plateforme")}` } }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatchObject({ code: "entree_invalide", details: { champ: "app" } });
  });

  it("un administrateur AVEC une liste n'écrit que dans ses applications", () => {
    const regle = COMMANDES_CONSOLE.creerObjectif.regle;
    expect(refusDAcces(regle, { role: "admin", apps: ["a"] }, "a")).toBeNull();
    expect(refusDAcces(regle, { role: "admin", apps: ["a"] }, "b")).toMatchObject({ code: "hors_perimetre" });
  });
});
