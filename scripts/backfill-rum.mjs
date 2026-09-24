#!/usr/bin/env node
// P8.2 — l'outil de reprise d'historique et son dry-run.
//
//   node scripts/backfill-rum.mjs plan   --kind <kind> --app <app> --from <UTC> --to <UTC> [--batch N] [--out fichier]
//   node scripts/backfill-rum.mjs apply  --plan-id <uuid> --plan-sha <sha256> [--max-lots N]
//   node scripts/backfill-rum.mjs status --run-id <uuid>
//   node scripts/backfill-rum.mjs pause  --run-id <uuid>
//   node scripts/backfill-rum.mjs resume --run-id <uuid> --plan-sha <sha256>
//   node scripts/backfill-rum.mjs verify --run-id <uuid>
//
// `--app` ET LES BORNES SONT OBLIGATOIRES. Il n'y a pas de valeur par défaut,
// pas de « toutes les apps », pas de « les trente derniers jours ». Une reprise
// d'historique réécrit des données que plus personne ne regarde : le périmètre
// est une décision, pas un réglage.
//
// LA BASE. La chaîne de connexion se lit dans `BACKFILL_DATABASE_URL`, et
// DÉLIBÉRÉMENT PAS dans `DATABASE_URL`. La seconde désigne la production dans
// tout le reste du dépôt, et un outil qui la prendrait par défaut exécuterait un
// jour une reprise sur la production parce que quelqu'un avait la variable dans
// son terminal. L'opérateur nomme la base qu'il vise, une fois, exprès. Sa
// valeur n'est jamais affichée.
//
// CE QUE `plan` ÉCRIT. Une ligne de `backfill_run` en état `planned` — un
// manifeste TECHNIQUE — et, si `--out` est donné, le plan complet en JSON dans
// un fichier. AUCUNE table RUM n'est touchée : ni lue en écriture, ni verrouillée
// en écriture. `plan` est une lecture.
import { writeFileSync } from "node:fs";
import process from "node:process";
import pg from "pg";

import { ErreurPlan, KINDS, planifier } from "../packages/backend/lib/backfills/planner.mjs";
import {
  etat,
  executer,
  inscrirePlan,
  mettreEnPause,
  verifier,
} from "../packages/backend/lib/backfills/runner.mjs";
import { ErreurBackfill } from "../packages/backend/lib/backfills/commun.mjs";

const USAGE = `
Reprise d'historique RUM (P8.2). --app et les bornes sont obligatoires.

  plan   --kind <${Object.keys(KINDS).join("|")}> --app <app> --from <UTC> --to <UTC> [--batch 100..5000] [--out plan.json]
  apply  --plan-id <uuid> --plan-sha <sha256> [--max-lots N]
  status --run-id <uuid>
  pause  --run-id <uuid>
  resume --run-id <uuid> --plan-sha <sha256> [--max-lots N]
  verify --run-id <uuid>

Connexion : BACKFILL_DATABASE_URL (jamais DATABASE_URL — cf. l'en-tête du fichier).
`;

/** Arguments `--cle valeur`, sans dépendance. Un drapeau inconnu est refusé. */
export function analyserArgs(argv, connus) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const jeton = argv[i];
    if (!jeton.startsWith("--")) throw new ErreurPlan("argument_invalide", `argument inattendu « ${jeton} »`);
    const cle = jeton.slice(2);
    if (!connus.includes(cle)) {
      throw new ErreurPlan("argument_inconnu", `option inconnue « --${cle} » (attendues : ${connus.map((c) => `--${c}`).join(", ")})`);
    }
    const valeur = argv[i + 1];
    if (valeur == null || valeur.startsWith("--")) {
      throw new ErreurPlan("argument_sans_valeur", `l'option « --${cle} » attend une valeur`);
    }
    out[cle] = valeur;
    i++;
  }
  return out;
}

/** Exige une option, en disant laquelle et pourquoi. */
export function exiger(args, cle, pourquoi) {
  if (!args[cle]) throw new ErreurPlan("option_obligatoire", `--${cle} est obligatoire : ${pourquoi}`);
  return args[cle];
}

function connexion() {
  const url = process.env.BACKFILL_DATABASE_URL;
  if (!url) {
    throw new ErreurPlan(
      "base_non_designee",
      "BACKFILL_DATABASE_URL n'est pas défini. Cet outil ne lit PAS DATABASE_URL : la base visée "
      + "par une reprise d'historique se nomme exprès.",
    );
  }
  // `max: 2` : un travailleur par application, plus la connexion de contrôle.
  return new pg.Pool({ connectionString: url, max: 2 });
}

const rendre = (objet) => console.log(JSON.stringify(objet, null, 2));

async function commandePlan(pool, argv) {
  const args = analyserArgs(argv, ["kind", "app", "from", "to", "batch", "out"]);
  exiger(args, "kind", `l'une des reconstructions ${Object.keys(KINDS).join(", ")}`);
  exiger(args, "app", "une reprise s'applique à UNE application explicite, jamais à « all »");
  exiger(args, "from", "borne basse UTC de la fenêtre [from, to)");
  exiger(args, "to", "borne haute UTC, exclue");
  const plan = await planifier(pool, {
    kind: args.kind,
    app: args.app,
    from: args.from,
    to: args.to,
    taille: args.batch,
  });
  const planId = await inscrirePlan(pool, plan);
  const sortie = { plan_id: planId, ...plan };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(sortie, null, 2)}\n`);
  rendre(sortie);
  console.error(
    `\nDry-run seulement. Pour exécuter :\n`
    + `  node scripts/backfill-rum.mjs apply --plan-id ${planId} --plan-sha ${plan.plan_sha}\n`,
  );
}

async function commandeApply(pool, argv, { reprise = false } = {}) {
  const args = analyserArgs(argv, [reprise ? "run-id" : "plan-id", "plan-sha", "max-lots"]);
  const id = exiger(args, reprise ? "run-id" : "plan-id", "l'identifiant rendu par `plan`");
  const planSha = exiger(
    args,
    "plan-sha",
    "une exécution ne démarre pas sur un plan qu'on n'a pas relu ; c'est l'empreinte rendue par `plan`",
  );
  const controleur = new AbortController();
  // SIGTERM PROPRE : le lot en cours va au bout — sa transaction est courte —,
  // le curseur est écrit, et l'exécution passe en `paused`. Tuer au milieu d'un
  // lot annulerait sa transaction : ni perte ni doublon non plus, mais un lot
  // rejoué pour rien.
  const arreter = () => {
    console.error("\nsignal reçu : arrêt après le lot en cours…");
    controleur.abort();
  };
  process.on("SIGTERM", arreter);
  process.on("SIGINT", arreter);
  try {
    const bilan = await executer(pool, id, {
      planSha,
      signal: controleur.signal,
      maxLots: args["max-lots"] ? Number(args["max-lots"]) : null,
    });
    rendre(bilan);
  } finally {
    process.off("SIGTERM", arreter);
    process.off("SIGINT", arreter);
  }
}

async function commandeStatus(pool, argv) {
  const args = analyserArgs(argv, ["run-id"]);
  rendre(await etat(pool, exiger(args, "run-id", "l'identifiant de l'exécution")));
}

async function commandePause(pool, argv) {
  const args = analyserArgs(argv, ["run-id"]);
  const id = exiger(args, "run-id", "l'identifiant de l'exécution");
  rendre({ run: id, state: await mettreEnPause(pool, id) });
}

async function commandeVerify(pool, argv) {
  const args = analyserArgs(argv, ["run-id"]);
  rendre(await verifier(pool, exiger(args, "run-id", "l'identifiant de l'exécution")));
}

export async function principal(argv = process.argv.slice(2)) {
  const [commande, ...reste] = argv;
  if (!commande || ["-h", "--help", "help"].includes(commande)) {
    console.log(USAGE);
    return 0;
  }
  const pool = connexion();
  try {
    switch (commande) {
      case "plan": await commandePlan(pool, reste); break;
      case "apply": await commandeApply(pool, reste); break;
      case "resume": await commandeApply(pool, reste, { reprise: true }); break;
      case "status": await commandeStatus(pool, reste); break;
      case "pause": await commandePause(pool, reste); break;
      case "verify": await commandeVerify(pool, reste); break;
      default:
        throw new ErreurPlan("commande_inconnue", `commande « ${commande} » inconnue`);
    }
    return 0;
  } finally {
    await pool.end();
  }
}

// `import.meta.main` n'existe pas sur Node 20 ; la comparaison d'URL, si.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  principal().then(
    (code) => process.exit(code),
    (err) => {
      // Un code et une phrase. Jamais une pile, jamais un identifiant de
      // personne, jamais la chaîne de connexion.
      const code = err instanceof ErreurPlan || err instanceof ErreurBackfill ? err.code : "erreur_inattendue";
      console.error(`échec [${code}] : ${err.message}`);
      process.exit(1);
    },
  );
}
