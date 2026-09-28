// La preuve qu'exige le GeoIP de la collecte directe (P6b.G) : la façade Railway
// ÉCRASE-t-elle une adresse forgée par le client ? Sans elle, n'importe qui
// choisirait le pays de ses propres mesures en écrivant `X-Real-IP` lui-même.
//
// CE QUE LE SCRIPT FAIT, ET RIEN D'AUTRE — trois lectures, aucune écriture :
//
//   1. `GET /health` (publique) : le service, et l'état de son GeoIP ;
//   2. `OPTIONS /v1/traces` avec l'origine de la console : le préflight CORS que
//      ferait le navigateur. Aucune donnée ne part, rien n'est écrit ;
//   3. `GET /diagnostic/ip` (jeton METRICS_TOKEN) avec un `X-Real-IP` et un
//      `X-Forwarded-For` FORGÉS, pris dans les plages de documentation (RFC 5737).
//      Le collector répond D'OÙ vient l'adresse qu'il retiendrait — une forgée,
//      ou une autre, posée par la façade —, jamais l'adresse elle-même.
//
// Le diagnostic évalue le mode `railway` QUEL QUE SOIT `GEOIP_IP_SOURCE` : la
// preuve se fait avant l'apply qui l'allume, pas après.
//
// LE JETON SUR L'ENTRÉE STANDARD, comme `empreinte-identite.mjs` : en argument,
// il finirait dans l'historique du shell et dans `ps`.
//
//   railway variables --service collector --json | jq -r .METRICS_TOKEN \
//     | node scripts/ops/verifier-ip-directe.mjs
//   pbpaste | node scripts/ops/verifier-ip-directe.mjs --collector https://… --origine https://…
//
// Code de sortie : 0 tout est prouvé ; 1 l'adresse est FORGEABLE (ne pas
// allumer) ; 2 rien de conclu (jeton, service, préflight, requête hors façade).
import { pathToFileURL } from "node:url";
import { SONDES_FORGEES } from "../../packages/backend/shared/client-ip.mjs";

export const COLLECTOR_DEFAUT = "https://collector-production-d769.up.railway.app";
export const ORIGINE_DEFAUT = "https://mip-rum-console.vercel.app";

/**
 * Les trois lectures, et leur lecture. Rend les lignes à afficher et le code de
 * sortie ; n'écrit rien, n'affiche rien (le test l'appelle tel quel).
 * @param {{ collector: string, origine: string, jeton: string, fetch?: typeof fetch }} o
 */
export async function verifier({ collector, origine, jeton, fetch: f = fetch }) {
  const base = collector.replace(/\/+$/, "");
  const lignes = [];
  let code = 0;

  // 1 — /health : c'est bien le collector, et où en est son GeoIP.
  let sante = null;
  try {
    const r = await f(`${base}/health`);
    sante = await r.json();
  } catch (err) {
    lignes.push(`✗ /health illisible : ${err?.message ?? err}`);
    return { lignes, code: 2 };
  }
  if (sante?.service !== "collector") {
    lignes.push(`✗ /health ne décrit pas le collector (service : ${JSON.stringify(sante?.service)})`);
    return { lignes, code: 2 };
  }
  const g = sante.geoip ?? {};
  lignes.push(`• GeoIP déclaré : source ${g.source_ip ?? "?"}, base ${g.etat ?? "?"}${g.version ? ` (${g.version})` : ""}${g.raison ? ` — ${g.raison}` : ""}`);
  if (g.source_ip === "railway" && g.etat === "eteint") {
    // Source allumée mais base absente : aucune adresse ne sera résolue.
    lignes.push("✗ source « railway » mais base éteinte : l'image n'a pas embarqué DB-IP (voir la raison)");
    code = 2;
  }

  // 2 — préflight CORS : le navigateur de la console aura-t-il le droit d'écrire ici ?
  try {
    const r = await f(`${base}/v1/traces`, {
      method: "OPTIONS",
      headers: { origin: origine, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    const permise = r.headers.get("access-control-allow-origin");
    if (permise === origine) {
      lignes.push(`✓ CORS : ${origine} est acceptée`);
    } else {
      lignes.push(`✗ CORS : ${origine} n'est pas acceptée (app_registry.allowed_origins de mip-rum-console)`);
      code = 2;
    }
  } catch (err) {
    lignes.push(`✗ préflight CORS impossible : ${err?.message ?? err}`);
    code = 2;
  }

  // 3 — la preuve : une adresse forgée dans chaque en-tête.
  let diag = null;
  try {
    const r = await f(`${base}/diagnostic/ip`, {
      headers: {
        authorization: `Bearer ${jeton}`,
        "x-real-ip": SONDES_FORGEES["x-real-ip"],
        "x-forwarded-for": SONDES_FORGEES["x-forwarded-for"],
      },
    });
    if (r.status === 404) {
      lignes.push("✗ /diagnostic/ip : 404 — jeton faux, ou collector antérieur à ce diagnostic");
      return { lignes, code: 2 };
    }
    diag = await r.json();
  } catch (err) {
    lignes.push(`✗ /diagnostic/ip illisible : ${err?.message ?? err}`);
    return { lignes, code: 2 };
  }
  lignes.push(
    `• requête vue par le collector : marqueur d'arête ${diag.marqueur_arete ? "présent" : "ABSENT"}, ` +
      `X-Real-IP ${diag.x_real_ip?.valeurs ?? "?"} valeur(s), retenue : ${diag.x_real_ip?.retenue ?? "?"} ; ` +
      `X-Forwarded-For ${diag.x_forwarded_for?.elements ?? "?"} élément(s), premier : ${diag.x_forwarded_for?.premier ?? "?"}, dernier : ${diag.x_forwarded_for?.dernier ?? "?"}`,
  );
  if (diag.verdict === "sure") {
    lignes.push("✓ la façade écrase l'adresse forgée : le mode « railway » retient une adresse que le client n'a pas écrite");
  } else if (diag.verdict === "forgeable") {
    lignes.push("✗ FORGEABLE : le mode « railway » retiendrait l'adresse écrite par le client — NE PAS allumer le GeoIP");
    // Le défaut de sécurité passe devant tout autre échec : c'est lui qui interdit l'apply.
    return { lignes, code: 1 };
  } else {
    lignes.push("✗ indéterminé : la requête n'a pas traversé la façade Railway (marqueur ou X-Real-IP absent)");
    code = 2;
  }
  return { lignes, code };
}

/** Argument `--nom valeur`, ou le défaut. */
function argument(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

async function principal() {
  let brut = "";
  process.stdin.setEncoding("utf8");
  if (!process.stdin.isTTY) for await (const morceau of process.stdin) brut += morceau;
  const jeton = brut.replace(/\r?\n$/, "");
  if (!jeton) {
    console.error("METRICS_TOKEN attendu sur l'entrée standard (rien reçu)");
    process.exit(2);
  }
  const { lignes, code } = await verifier({
    collector: argument("collector", COLLECTOR_DEFAUT),
    origine: argument("origine", ORIGINE_DEFAUT),
    jeton,
  });
  for (const l of lignes) console.log(l);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await principal();
