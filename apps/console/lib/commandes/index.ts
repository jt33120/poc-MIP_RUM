// LE REGISTRE DES COMMANDES : une par écriture du contrat (`COMMANDES`), sans exception.
//
// Le type l'exige (`satisfies`) : une opération déclarée au contrat sans commande
// ici, ou une commande sans opération, ne compile pas. Deux lecteurs : la console
// (`lib/commande-locale.ts`, jusqu'à la bascule) et console-api
// (`services/console-api/commandes.mjs`).
import type { CleCommande } from "@mip/console-contract";
import type { CommandeQuelconque } from "./commun";
import { activerObjectif, creerObjectif, supprimerObjectif } from "./objectifs";
import {
  ajouterCarte,
  ajouterSection,
  clonerModele,
  clonerTableau,
  configurerCarte,
  creerTableau,
  deplacerCarte,
  enregistrerAnalyse,
  modifierTableau,
  retirerCarte,
  supprimerTableau,
} from "./tableaux";
import { creerVue, modifierVue, supprimerVue } from "./vues";

export const COMMANDES_CONSOLE = {
  // C6 — espace de travail.
  creerTableau,
  clonerModele,
  clonerTableau,
  modifierTableau,
  supprimerTableau,
  ajouterCarte,
  ajouterSection,
  enregistrerAnalyse,
  configurerCarte,
  retirerCarte,
  deplacerCarte,
  creerVue,
  modifierVue,
  supprimerVue,
  creerObjectif,
  activerObjectif,
  supprimerObjectif,
} satisfies { readonly [K in CleCommande]: CommandeQuelconque };
