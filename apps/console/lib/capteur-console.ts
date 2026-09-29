// Le snippet par lequel la console s'instrumente avec son propre SDK (dogfooding).
//
// POURQUOI UNE CLÉ ICI. La production accepte encore les beacons sans clé
// (`REQUIRE_API_KEY=false`) : n'importe qui peut écrire sous l'`app_id` d'une
// application, puisque les `app_id` sont publics. Pour exiger la clé, chaque
// capteur actif doit d'abord la porter — la console comme le site du client —,
// sinon le passage du drapeau à `true` couperait sa collecte (403, sans repli du
// relais). Cette variable est l'étape « poser la clé dans le snippet » pour la
// console.
//
// PAS UN SECRET. Une clé d'ingestion voyage dans le beacon (attribut OTLP
// `mip.api_key`, `sendBeacon` ne porte pas d'en-tête) : elle est lisible dans la
// page de tout visiteur, d'où `NEXT_PUBLIC_`. Elle empêche l'écriture anonyme
// sous l'identité d'une application ; elle ne protège pas d'un visiteur qui la
// recopie, ce que borne le limiteur de débit.

/** Le format que génèrent la console et `scripts/ops/provisionner-cles.mjs`. */
const FORMAT_CLE = /^mip_[0-9a-f]{32}$/;

export interface OptionsCapteurConsole {
  endpoint: string;
  release: string;
  replay: number;
  /** `NEXT_PUBLIC_DOGFOOD_API_KEY` ; absente ou mal formée : le snippet n'en porte pas. */
  apiKey?: string | null;
}

/**
 * Rend l'appel `MIPRum.init(...)` inséré dans le `<head>` de la console.
 *
 * Une clé mal formée est IGNORÉE plutôt que transmise : elle serait refusée dès
 * que le drapeau passerait à `true`, et la valeur, recopiée telle quelle dans un
 * `<script>`, ne doit pas pouvoir y porter autre chose qu'une clé.
 */
export function scriptCapteurConsole(o: OptionsCapteurConsole): string {
  const champs = [
    `endpoint:${JSON.stringify(o.endpoint)}`,
    `appId:"mip-rum-console"`,
    `clientId:"mip"`,
    `env:"prod"`,
    `release:${JSON.stringify(o.release)}`,
    `replay:${JSON.stringify(o.replay)}`,
  ];
  const cle = o.apiKey?.trim();
  if (cle && FORMAT_CLE.test(cle)) champs.push(`apiKey:${JSON.stringify(cle)}`);
  return `window.MIPRum && MIPRum.init({${champs.join(",")}});`;
}
