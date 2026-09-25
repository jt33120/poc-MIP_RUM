// LES SONDES DE DISPONIBILITÉ (C8) — `app/admin/uptime/actions.ts`, l'écran `/admin/uptime`.
//
// Un check appartient à UNE application : règle `admin` + portée `app`, et chaque
// écriture filtre sa ligne par elle — avant C8, activer ou supprimer filtrait par
// identifiant seul. Aucun secret : une URL à surveiller.
//
// L'URL EST JUGÉE À L'ÉCRITURE (P1). Une sonde est une requête que le scheduler
// émet depuis le réseau privé Railway : une IP littérale, un nom interne
// (`*.railway.internal`, `localhost`) ou un nom sans domaine sont refusés ici,
// avec leur CODE, par le contrôle sans réseau de `safe-fetch`. Ce contrôle ne fait
// pas foi : ce que le DNS répondra au moment de la sonde, seul `safeFetch` le juge.
import { booleen, chaine, facultatif, objet } from "@mip/console-contract";
import { verifierUrlSortante } from "@mip/backend/lib/net/safe-fetch.mjs";
import { tx } from "../db";
import { createUptimeCheck, deleteUptimeCheck, toggleUptimeCheck } from "../queries-uptime";
import { commande, MOTIF_ENTIER } from "./commun";

const CHEMIN_ID = objet({ id: chaine({ max: 18, motif: MOTIF_ENTIER, description: "identifiant entier" }) });

export const creerSonde = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "uptime_check.create" },
    corps: objet({
      name: chaine({ max: 200 }),
      url: chaine({ max: 2048 }),
      expect_status: facultatif(chaine({ max: 3, motif: /^[1-5][0-9]{2}$/, description: "statut HTTP attendu" })),
    }),
  },
  async ({ app, corps, auditer }) => {
    const verdict = verifierUrlSortante(corps.url);
    if (!verdict.ok) return { etat: "url_refusee", code: verdict.code } as const;
    const expect = Number(corps.expect_status ?? 200) || 200;
    const id = await tx(async (c) => {
      const cree = await createUptimeCheck(app!, corps.name, corps.url, expect, c);
      await auditer(c, `${corps.name} ${corps.url} -> ${app}`);
      return cree;
    });
    return { etat: "cree", id } as const;
  },
);

export const activerSonde = commande(
  { regle: { auth: "admin", portee: "app", audit: "uptime_check.set_enabled" }, chemin: CHEMIN_ID, corps: objet({ enabled: booleen() }) },
  async ({ app, chemin, corps, auditer }) =>
    tx(async (c) => {
      if (!(await toggleUptimeCheck(Number(chemin.id), app!, corps.enabled, c))) return { etat: "introuvable" } as const;
      await auditer(c, `id=${chemin.id} enabled=${corps.enabled}`);
      return { etat: "ok" } as const;
    }),
);

export const supprimerSonde = commande(
  { regle: { auth: "admin", portee: "app", audit: "uptime_check.delete" }, chemin: CHEMIN_ID },
  async ({ app, chemin, auditer }) =>
    tx(async (c) => {
      if (!(await deleteUptimeCheck(Number(chemin.id), app!, c))) return { etat: "introuvable" } as const;
      await auditer(c, `id=${chemin.id}`);
      return { etat: "ok" } as const;
    }),
);
