// Chargeur webpack : le correctif de React 19.3.0 sur l'hydratation, reporté dans
// le React que Next 15.5 embarque (branché par next.config.mjs).
//
// LE DÉFAUT. Next sert l'App Router avec SA copie de React
// (`next/dist/compiled/react-dom`, 19.2.0-canary-0bdb9206 jusqu'à Next 15.5.26),
// pas celle du package.json. Le RSC arrive en flux : au-delà de 3 200 octets par
// ligne, le serveur Flight reporte les éléments dans des lignes suivantes
// (`$L…`, des enfants paresseux). Si l'hydratation atteint un élément hôte (un
// `<svg>`, un `<tbody>`) dont un enfant n'est pas encore arrivé, l'élément
// suspend, puis React le REJOUE (`replaySuspendedUnitOfWork`). Jusqu'à 19.2, ce
// rejeu repasse par `beginWork` sans ramener le curseur d'hydratation : l'élément
// réclame son nœud DOM une seconde fois alors que le curseur est déjà sur son
// premier enfant — « <svg> attendu, <g> trouvé ». Faux écart de structure, erreur
// #418 (« HTML »), toute la page est jetée et re-rendue côté client.
//
// Intermittent par nature : il faut que le flux soit encore en cours pendant
// l'hydratation. /admin/composants (3 Mo de HTML, dont 1,8 Mo de RSC en ligne)
// est de loin la page la plus lourde, d'où le crawl rouge une fois sur quelques
// dizaines, sur elle seule.
//
// LE CORRECTIF est celui de React 19.3.0 (branche `case 5` de
// `replaySuspendedUnitOfWork`) : avant de rejouer un élément hôte qui est le
// parent d'hydratation courant, remonter au parent et reposer le curseur sur le
// nœud de l'élément. À retirer quand Next embarquera React ≥ 19.3 (Next 16.3 le
// fait) : le chargeur voit alors le correctif en place et ne touche à rien.
"use strict";

/** La branche `HostComponent` du rejeu, telle que l'écrit React ≤ 19.2. */
const ANCRE = /case 5:(\s*)resetHooksOnUnwind\((\w+)\);(\s*)default:/g;

/** La même branche, déjà corrigée (React ≥ 19.3, ou ce chargeur passé une fois). */
const CORRIGEE = /case 5:\s*resetHooksOnUnwind\((\w+)\);\s*var (\w+) = \1;\s*\2 === hydrationParentFiber &&/;

/**
 * Applique le correctif à un bundle client de react-dom. Rend la source telle
 * quelle si elle est déjà corrigée ; lève si la branche n'a pas la forme
 * attendue — une montée de Next qui la déplacerait doit être relue, pas
 * contournée en silence.
 */
function corrigerRejeu(source) {
  if (CORRIGEE.test(source)) return source;
  const trouvees = source.match(ANCRE) ?? [];
  if (trouvees.length !== 1) {
    throw new Error(
      `correctif-react-hydratation : ${trouvees.length} branche(s) « case 5 » du rejeu au lieu d'une — ` +
        "la version de React embarquée par Next a changé ; relire le correctif (apps/console/scripts/correctif-react-hydratation.cjs).",
    );
  }
  return source.replace(
    ANCRE,
    (_tout, avant, fibre, apres) =>
      `case 5:${avant}resetHooksOnUnwind(${fibre});` +
      `${avant}var fibreRejouee = ${fibre};` +
      `${avant}fibreRejouee === hydrationParentFiber &&` +
      " (isHydrating" +
      " ? (popToNextHostParent(fibreRejouee)," +
      " 5 === fibreRejouee.tag && null != fibreRejouee.stateNode && (nextHydratableInstance = fibreRejouee.stateNode))" +
      " : (popToNextHostParent(fibreRejouee), (isHydrating = !0)));" +
      `${apres}default:`,
  );
}

/** Les bundles clients de react-dom (stable ou expérimental, prod, dev, profilage). */
const BUNDLES_CLIENT =
  /[\\/]next[\\/]dist[\\/]compiled[\\/]react-dom(?:-experimental)?[\\/]cjs[\\/]react-dom-(?:client|profiling)\.(?:production|development|profiling)\.js$/;

module.exports = function chargeur(source) {
  return corrigerRejeu(source);
};
module.exports.corrigerRejeu = corrigerRejeu;
module.exports.BUNDLES_CLIENT = BUNDLES_CLIENT;
