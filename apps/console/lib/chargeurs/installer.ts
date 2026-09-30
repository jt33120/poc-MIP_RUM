// LE CHARGEUR DE LA PAGE « INSTALLER » — `app/installer/page.tsx`.
//
// Trois lectures, chacune une section (une panne n'emporte qu'elle) : la
// configuration de l'application (clé, domaines, état de collecte), ses domaines de
// l'extension, et la sonde du test « ça arrive », relue toutes les 5 s tant que la
// page le demande (10 minutes au plus).
//
// LES DROITS, COMME AILLEURS. Un écran d'application lit l'application DEMANDÉE
// (`?app=`, posé par le middleware) si elle est dans le périmètre signé du
// principal : `resolveScope` de `lib/query-contract.ts`, la règle que
// `analyserFiltres` applique à tous les écrans de mesure. Un client qui a accès à
// son application lit donc cette page ; hors périmètre, le même refus qu'ailleurs.
// `administrable` ne donne aucun droit : il dit seulement si la page peut montrer
// les liens vers la fiche (régénérer la clé, changer les domaines), dont les
// commandes gardent leur propre règle.
//
// DANS LE CONTRAT (`ECRANS.installer`), servi aussi par `services/console-api/ecrans.mjs` :
// le jour où les écrans basculent vers console-api, cette page suit sans changer.
import { paramReader, requestedAppOf, resolveScope } from "../query-contract";
import type { FilterProblem } from "../filtres-ecran";
import { configInstallation, sondeInstallation } from "../queries-customers";
import { domainesExtensionDe } from "../queries-extension-scope";
import { section, type Chargeur } from "./commun";

export const chargerInstaller = (async (principal, sp) => {
  const scope = resolveScope(principal, requestedAppOf(paramReader(sp).get("app")));
  if (!scope.ok) {
    const problem: FilterProblem = {
      code: scope.error.code,
      message: scope.error.message,
      resetHref: "/select",
      resetLabel: "Choisir un projet autorisé",
    };
    return { etat: "refus", problem } as const;
  }
  const app = scope.value.requestedApp;
  // Toutes les applications à la fois n'ont pas de sens ici : on installe UNE application.
  if (!app) return { etat: "sans_app" } as const;
  const [config, domaines, sonde] = await Promise.all([
    section(() => configInstallation(app)),
    section(() => domainesExtensionDe(app)),
    section(() => sondeInstallation(app)),
  ]);
  if (config.ok && config.data === null) return { etat: "introuvable", app } as const;
  const administrable =
    !!principal && principal.role === "admin" && !principal.demo && (principal.apps === null || principal.apps.includes(app));
  return { etat: "ok", app, administrable, config, domaines, sonde } as const;
}) satisfies Chargeur<unknown>;
