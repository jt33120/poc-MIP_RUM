// LES APPLICATIONS CLIENTES (C9) — `app/admin/customers/actions.ts`, `app/select/new/actions.ts`.
//
// CRÉER une application (un nouveau client, ou un site ajouté depuis `/select`)
// est un geste de l'ADMINISTRATEUR DE LA PLATEFORME : une application créée par un
// administrateur d'une liste tomberait hors de celle-ci, et il ne la verrait plus.
// La GÉRER — renouveler sa clé d'ingestion, l'activer ou la couper, fixer ses
// origines CORS — revient à l'administrateur de CETTE application (portée `app`) :
// la ligne est celle de la portée, `where app_id = $1`.
//
// La clé d'ingestion est générée ici, stockée hachée (sha256), et RENDUE UNE FOIS
// par la décision de la commande : jamais écrite en clair, ni en base, ni dans
// l'audit.
import { createHash, randomBytes } from "node:crypto";
import { booleen, chaine, facultatif, objet, parmi } from "@mip/console-contract";
import { tx } from "../db";
import { formatApiKey, parseOrigins, validateAppId } from "../onboarding";
import { createExtensionScope } from "../queries-extension-scope";
import { commande } from "./commun";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const nouvelleCle = () => formatApiKey(randomBytes(16).toString("hex"));

/** « Ma Boutique Démo » → « ma-boutique-demo » (identifiant d'application stable). */
function slug(nom: string): string {
  return nom
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Hostname d'une origine (« https://ma-boutique.fr » → « ma-boutique.fr »). */
function hote(origine: string): string | null {
  try {
    return new URL(origine).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export const creerApplication = commande(
  {
    regle: { auth: "admin-plateforme", portee: "globale", audit: "app.create" },
    corps: objet({
      app_id: chaine({ min: 0, max: 64 }),
      name: chaine({ min: 0, max: 200 }),
      client_id: facultatif(chaine({ max: 200 })),
      notes: facultatif(chaine({ max: 2000 })),
      origins: chaine({ min: 0, max: 4000 }),
    }),
  },
  async ({ principal, corps, auditer }) => {
    const app = validateAppId(corps.app_id);
    const nom = corps.name.trim();
    if (!app) return { etat: "refus", champ: "app_id" } as const;
    if (!nom) return { etat: "refus", champ: "name" } as const;
    const { origins, invalid } = parseOrigins(corps.origins);
    if (invalid.length) return { etat: "refus", champ: "origin", detail: invalid[0] } as const;
    if (!origins.length) return { etat: "refus", champ: "no_origin" } as const;
    const cle = nouvelleCle();
    const cree = await tx(async (c) => {
      const { rowCount } = await c.query(
        `insert into app_registry (app_id, name, client_id, api_key_hash, active, allowed_origins, created_by, notes)
         values ($1, $2, $3, $4, true, $5, $6, $7) on conflict (app_id) do nothing`,
        [app, nom, corps.client_id?.trim() || null, sha256(cle), origins, principal.email, corps.notes?.trim() || null],
      );
      if (!rowCount) return false;
      await auditer(c, `${app} (${nom}) origins=${origins.join("|")}`, app);
      return true;
    });
    return cree ? ({ etat: "cree", app, cle } as const) : ({ etat: "existe" } as const);
  },
);

/**
 * Un site ajouté depuis `/select` (le « + ») : la même création, avec un formulaire
 * minimal — l'identifiant dérivé du nom, l'origine CORS de l'URL — et, en mode
 * extension, le domaine enregistré d'emblée pour l'extension navigateur. Une seule
 * transaction : l'application et son domaine, ou rien.
 */
export const creerSite = commande(
  {
    regle: { auth: "admin-plateforme", portee: "globale", audit: "app.create" },
    corps: objet({
      name: chaine({ min: 0, max: 200 }),
      url: chaine({ min: 0, max: 2048 }),
      app_id: facultatif(chaine({ max: 64 })),
      mode: parmi(["sdk", "extension"] as const),
    }),
  },
  async ({ principal, corps, auditer }) => {
    const nom = corps.name.trim();
    if (!nom) return { etat: "refus", champ: "name" } as const;
    const app = validateAppId(corps.app_id?.trim() || slug(nom));
    if (!app) return { etat: "refus", champ: "app_id" } as const;
    const { origins, invalid } = parseOrigins(corps.url.trim());
    if (invalid.length || !origins.length) return { etat: "refus", champ: "url" } as const;
    const cle = nouvelleCle();
    const cree = await tx(async (c) => {
      const { rowCount } = await c.query(
        `insert into app_registry (app_id, name, api_key_hash, active, allowed_origins, created_by)
         values ($1, $2, $3, true, $4, $5) on conflict (app_id) do nothing`,
        [app, nom, sha256(cle), origins, principal.email],
      );
      if (!rowCount) return false;
      // Mode extension : le domaine est enregistré d'emblée (domaine → application).
      const domaine = corps.mode === "extension" ? hote(origins[0]) : null;
      if (domaine) await createExtensionScope(domaine, app, c);
      await auditer(c, `${app} (${nom}) via /select · mode ${corps.mode}${domaine ? ` · domaine ${domaine}` : ""}`, app);
      return true;
    });
    return cree ? ({ etat: "cree", app, cle, mode: corps.mode } as const) : ({ etat: "existe" } as const);
  },
);

export const renouvelerCle = commande(
  { regle: { auth: "admin", portee: "app", audit: "app.rotate_key" } },
  async ({ app, auditer }) => {
    const cle = nouvelleCle();
    const fait = await tx(async (c) => {
      const { rowCount } = await c.query("update app_registry set api_key_hash = $2 where app_id = $1", [app, sha256(cle)]);
      if (!rowCount) return false;
      await auditer(c, app);
      return true;
    });
    return fait ? ({ etat: "ok", app: app!, cle } as const) : ({ etat: "introuvable" } as const);
  },
);

/** Activer ou couper une application : sa collecte s'arrête (l'ingestion refuse une app inactive). */
export const activerApplication = commande(
  { regle: { auth: "admin", portee: "app", audit: "app.set_active" }, corps: objet({ active: booleen() }) },
  async ({ app, corps, auditer }) =>
    tx(async (c) => {
      const { rowCount } = await c.query("update app_registry set active = $2 where app_id = $1", [app, corps.active]);
      if (!rowCount) return { etat: "introuvable" } as const;
      await auditer(c, `${app} active=${corps.active}`);
      return { etat: "ok" } as const;
    }),
);

export const majOrigines = commande(
  { regle: { auth: "admin", portee: "app", audit: "app.update_origins" }, corps: objet({ origins: chaine({ min: 0, max: 4000 }) }) },
  async ({ app, corps, auditer }) => {
    const { origins, invalid } = parseOrigins(corps.origins);
    if (invalid.length || !origins.length) return { etat: "refus", champ: "origin" } as const;
    return tx(async (c) => {
      const { rowCount } = await c.query("update app_registry set allowed_origins = $2 where app_id = $1", [app, origins]);
      if (!rowCount) return { etat: "introuvable" } as const;
      await auditer(c, `${app} origins=${origins.join("|")}`);
      return { etat: "ok" } as const;
    });
  },
);
