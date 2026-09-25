// LES OBJECTIFS DE CONVERSION (C6) — `app/goals/actions.ts`, l'écran `/goals`.
//
// L'administrateur de l'application les crée, les active ou les suspend, les
// supprime. La portée est `app` : l'objectif appartient à UNE application nommée
// de son périmètre, et chaque ligne est relue DANS cette application — un
// identifiant d'une autre application est introuvable, comme absent. Avant C6,
// activer ou supprimer filtrait par identifiant seul : un administrateur pouvait
// toucher l'objectif d'une application hors de sa liste.
//
// Activer POSE l'état voulu (`active: true | false`) au lieu de l'inverser : un
// formulaire rejoué deux fois ne suspend pas ce qu'il voulait activer.
import { booleen, chaine, objet, parmi } from "@mip/console-contract";
import { tx } from "../db";
import { commande, MOTIF_ENTIER } from "./commun";

const CHEMIN_ID = objet({ id: chaine({ max: 18, motif: MOTIF_ENTIER, description: "identifiant entier" }) });

export const creerObjectif = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "goal.create" },
    corps: objet({
      name: chaine({ max: 120 }),
      kind: parmi(["pageview", "event"] as const),
      pattern: chaine({ max: 500 }),
      match_type: parmi(["exact", "contains"] as const),
    }),
  },
  async ({ app, corps, auditer }) => {
    const id = await tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into goal (app_id, name, kind, pattern, match_type) values ($1, $2, $3, $4, $5) returning id::text as id",
        [app, corps.name, corps.kind, corps.pattern, corps.match_type],
      );
      await auditer(c, `${app} "${corps.name}" ${corps.kind}:${corps.match_type} ${corps.pattern}`);
      return rows[0].id;
    });
    return { etat: "cree", id } as const;
  },
);

export const activerObjectif = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "goal.update" },
    chemin: CHEMIN_ID,
    corps: objet({ active: booleen() }),
  },
  async ({ app, chemin, corps, auditer }) => {
    return tx(async (c) => {
      const { rows } = await c.query<{ name: string; active: boolean }>(
        "update goal set active = $3 where id = $1 and app_id = $2 returning name, active",
        [chemin.id, app, corps.active],
      );
      if (!rows[0]) return { etat: "introuvable" } as const;
      await auditer(c, `${rows[0].name} active=${rows[0].active}`);
      return { etat: "ok", active: rows[0].active } as const;
    });
  },
);

export const supprimerObjectif = commande(
  {
    regle: { auth: "admin", portee: "app", audit: "goal.delete" },
    chemin: CHEMIN_ID,
  },
  async ({ app, chemin, auditer }) => {
    return tx(async (c) => {
      const { rows } = await c.query<{ name: string }>("delete from goal where id = $1 and app_id = $2 returning name", [chemin.id, app]);
      if (!rows[0]) return { etat: "introuvable" } as const;
      await auditer(c, rows[0].name);
      return { etat: "ok" } as const;
    });
  },
);
