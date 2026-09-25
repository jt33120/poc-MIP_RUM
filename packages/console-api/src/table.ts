// LA TABLE DES OPÉRATIONS SERVIES : ce qu'une DSI relit.
//
// Une ligne par opération, avec sa politique (qui, quelle portée, la démo,
// l'audit). La doc `docs/api/console-api.md` et la matrice d'autorisations en
// sont générées. Elle grandit lot par lot : C0 l'exploitation et la vitrine
// publique, C1 l'identité ; les écrans en C3–C5.
import { lignesDuContrat } from "@mip/console-contract";
import { empreinte, type Trousseau } from "./cles";
import type { Lecteur } from "./contexte";
import { operationsExploitation } from "./operations/exploitation";
import { operationsIdentite, type DependancesIdentite } from "./operations/identite";
import { operationsPlateforme } from "./operations/plateforme";
import type { Enregistrement } from "./politique";

export interface Dependances {
  readonly trousseau: Trousseau;
  /** Le commit déployé (court), ou `dev`. */
  readonly version: string;
  readonly db: Lecteur;
  /** C1 — l'identité (connexion, démo, déconnexion, `/v1/me`). */
  readonly identite: Omit<DependancesIdentite, "trousseau" | "db">;
}

/** Construit la table, et l'empreinte du contrat qu'elle sert (annoncée par la poignée de main). */
export async function creerTable(d: Dependances): Promise<{ table: Enregistrement[]; contrat: string }> {
  let contrat = "";
  const table = [
    ...operationsExploitation({ trousseau: d.trousseau, version: d.version, contrat: () => contrat }),
    ...operationsPlateforme({ db: d.db }),
    ...operationsIdentite({ ...d.identite, trousseau: d.trousseau, db: d.db }),
  ];
  contrat = await empreinte(lignesDuContrat(table.map((e) => e.operation)));
  return { table, contrat };
}
