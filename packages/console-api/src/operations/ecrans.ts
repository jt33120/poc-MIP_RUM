// LES ÉCRANS DE LA CONSOLE (C2 → C5) : un chargeur par écran, servi tel quel.
//
// Les chargeurs vivent dans la console (`apps/console/lib/chargeurs/`) : c'est le
// code que ses écrans exécutent aujourd'hui. Le service les reçoit par INJECTION
// (`services/console-api/server.mjs` les embarque dans son bundle) — ce paquet
// n'importe rien de la console et se vérifie seul. Ici : la politique de chaque
// opération, et la traduction d'une lecture en SECTION sur le fil — la raison
// d'un échec part au journal, avec le `request_id`, jamais dans la réponse.
import { COQUILLE, type Coquille, type Section } from "@mip/console-contract";
import type { Journal } from "../contexte";
import { ErreurContrat } from "../erreurs";
import { servir, type Enregistrement } from "../politique";

/** Une lecture de section, telle que la console la rend (`lire()`, `lib/lecture.ts`). */
export type Lecture<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly raison: string };

/** Le principal tel qu'un chargeur le reçoit : rôle et périmètre (relus en base par la session). */
export interface PrincipalChargeur {
  readonly email: string;
  readonly role: "admin" | "viewer";
  readonly apps: readonly string[] | null;
}

export interface ChargeursEcrans {
  readonly coquille: (p: PrincipalChargeur) => Promise<{
    readonly projets: Lecture<readonly { app_id: string; name: string }[]>;
    readonly schema: Lecture<readonly string[]>;
    readonly fuseaux: Readonly<Record<string, string>>;
    readonly tickets: Lecture<boolean> | null;
  }>;
}

/** Une lecture → une section du fil : la raison reste au journal. */
export function versSection<T>(l: Lecture<T>, contexte: { journal: Journal; requestId: string; section: string }): Section<T> {
  if (l.ok) return { ok: true, data: l.data };
  contexte.journal.warn("section en échec", { section: contexte.section, request_id: contexte.requestId, raison: l.raison });
  return { ok: false, code: "lecture_en_echec" };
}

export function operationsEcrans(c: ChargeursEcrans): Enregistrement[] {
  return [
    servir(COQUILLE, { auth: "session", portee: "globale", demo: "lecture" }, async ({ principal, requestId, journal }) => {
      if (principal.kind !== "session") throw new ErreurContrat("session_requise", "session requise");
      const l = await c.coquille({ email: principal.email, role: principal.role, apps: principal.apps });
      const ctx = { journal, requestId };
      const reponse: Coquille = {
        projets: versSection(l.projets, { ...ctx, section: "projets" }),
        schema: versSection(l.schema, { ...ctx, section: "schema" }),
        fuseaux: l.fuseaux,
        tickets: l.tickets === null ? null : versSection(l.tickets, { ...ctx, section: "tickets" }),
      };
      return reponse;
    }),
  ];
}
