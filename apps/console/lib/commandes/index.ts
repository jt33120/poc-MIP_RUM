// LE REGISTRE DES COMMANDES : une par écriture du contrat (`COMMANDES`), sans exception.
//
// Le type l'exige (`satisfies`) : une opération déclarée au contrat sans commande
// ici, ou une commande sans opération, ne compile pas. Deux lecteurs : la console
// (`lib/commande.ts`, pour la part qu'elle sert elle-même) et console-api
// (`services/console-api/commandes.mjs`).
import type { CleCommande } from "@mip/console-contract";
import type { CommandeQuelconque } from "./commun";
import {
  acquitterEvenement,
  activerCanal,
  activerRegle,
  activerSlo,
  creerCanal,
  creerEtapeEscalade,
  creerRegle,
  creerSlo,
  evaluerAlertes,
  modifierRegle,
  supprimerCanal,
  supprimerEtapeEscalade,
  supprimerSlo,
} from "./alertes";
import { activerApplication, creerApplication, creerSite, majOrigines, renouvelerCle } from "./applications";
import { activerCompte, creerCompte, reinitialiserMotDePasse } from "./comptes";
import { commenterIssue, trierGroupe, trierIssue } from "./issues";
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
import {
  activerDomaineExtension,
  creerDomaineExtension,
  creerJetonLecture,
  creerJetonSourcemap,
  oublierPoste,
  revoquerJetonLecture,
  revoquerJetonSourcemap,
  validerCapaciteMobile,
} from "./raccordements";
import { activerSonde, creerSonde, supprimerSonde } from "./uptime";
import { effacerIdentite, effacerVisiteur, exporterIdentite, exporterVisiteur, rechercherIdentite } from "./vie-privee";
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
  // C7 — workflow des erreurs.
  trierIssue,
  commenterIssue,
  trierGroupe,
  // C8 — alerting et disponibilité.
  creerRegle,
  modifierRegle,
  activerRegle,
  acquitterEvenement,
  evaluerAlertes,
  creerSlo,
  activerSlo,
  supprimerSlo,
  creerCanal,
  activerCanal,
  supprimerCanal,
  creerEtapeEscalade,
  supprimerEtapeEscalade,
  creerSonde,
  activerSonde,
  supprimerSonde,
  // C9 — administration.
  creerCompte,
  activerCompte,
  reinitialiserMotDePasse,
  creerApplication,
  creerSite,
  renouvelerCle,
  activerApplication,
  majOrigines,
  creerJetonLecture,
  revoquerJetonLecture,
  creerJetonSourcemap,
  revoquerJetonSourcemap,
  creerDomaineExtension,
  activerDomaineExtension,
  oublierPoste,
  validerCapaciteMobile,
  // C10 — le RGPD.
  rechercherIdentite,
  exporterIdentite,
  effacerIdentite,
  exporterVisiteur,
  effacerVisiteur,
} satisfies { readonly [K in CleCommande]: CommandeQuelconque };
