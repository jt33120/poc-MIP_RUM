// La section « Specs / Capacité technique » de la vitrine PUBLIQUE.
//
// CE QUE CE FICHIER EMPÊCHE. Une page de spécifications est le genre d'écrit
// qu'on rédige une fois et que personne ne relit — pendant que le code, lui,
// change. Le dépôt a déjà servi « purge de rétention jamais exécutée » des
// semaines après sa reprise, et « Supabase / Paris » douze jours après la
// migration vers Neon / Francfort. Les deux étaient des phrases vraies devenues
// fausses en silence.
//
// D'où le contrat de lib/specs.ts, que ce fichier fait respecter :
//
//   1. ce qui décrit le dépôt porte le chemin qui le prouve  -> on ouvre le fichier
//   2. ce qu'on annonce ABSENT porte son marqueur d'absence   -> on le cherche, il ne doit pas y être
//   3. ce qui existe ailleurs est importé, jamais recopié     -> on compare aux sources
//   4. les chiffres sont mesurés                              -> on remesure le fichier réel
//
// Le point 2 est le plus important, et le moins courant : il rend une affirmation
// négative falsifiable. Le jour où quelqu'un implémente les Long Animation
// Frames, ce test échoue — et la vitrine cesse de prétendre qu'il manque.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CATALOGUES } from "../../apps/console/lib/dashboard-blocs";
import { NON_ETABLI_PLANIFIE, volatiles } from "../../apps/console/lib/etat-planifie";
import { ingestPath } from "../../apps/console/lib/ingest-endpoint";
import { EXAMPLE_SNIPPET } from "../../apps/console/lib/onboarding";
import { HOSTS } from "../../apps/console/lib/legal";
import { MCP_ORIGINE } from "../../apps/console/lib/mcp-public";
import {
  ANGLES_MORTS,
  EXT_PERMISSIONS,
  EXT_VERSION,
  FEEDBACK_GZIP_KO,
  INFRA,
  MESURES,
  RAILWAY,
  REPLAY_GZIP_KO,
  SDK_BUDGET_KO,
  SDK_GZIP_KO,
  mesuresNonCouvertes,
} from "../../apps/console/lib/specs";
import { RN_VERSION } from "../../apps/console/lib/versions";
import { SDK_POIDS_TEXTE } from "../../apps/console/lib/sdk-poids";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");
const koGzip = (rel: string) => Number((gzipSync(readFileSync(join(RACINE, rel))).length / 1024).toFixed(1));
// zlib ne produit pas exactement la même taille entre macOS et le runner Linux
// (le replay vaut actuellement 56,7 ko localement et 56,9 ko en CI). La valeur
// publique reste contrôlée au dixième, avec une marge bornée qui laisse passer
// cette variation de compresseur mais pas une croissance réelle du bundle.
const DERIVE_GZIP_KO = 0.3;
const attendrePoidsGzip = (rel: string, annonce: number) => {
  expect(Math.abs(koGzip(rel) - annonce)).toBeLessThanOrEqual(DERIVE_GZIP_KO);
};

/** Tout le DDL du dépôt : le schéma initial ET les migrations qui l'ont suivi. */
function toutLeDdl(): string {
  const dir = join(RACINE, "apps/ingest/sql");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

/** Toutes les lignes d'infrastructure, tous groupes confondus. */
const LIGNES = INFRA.flatMap((g) => g.lignes);

describe("onglet infrastructure — chaque ligne porte sa preuve", () => {
  it("nomme des fichiers qui existent VRAIMENT", () => {
    // Une preuve qui ne s'ouvre pas est pire qu'une absence de preuve : elle
    // donne l'air vérifiable à ce qui ne l'est plus. Un service renommé, un
    // module supprimé, et la vitrine décrit un dépôt qui n'existe pas.
    const manquants = LIGNES.filter((l) => l.preuve && !existsSync(join(RACINE, l.preuve)));
    expect(manquants.map((l) => `${l.k} -> ${l.preuve}`)).toEqual([]);
  });

  it("décrit les services par leur point d'entrée réel", () => {
    // Les commandes de démarrage : scheduler et mcp côté Railway, et le receveur
    // autonome gardé pour l'hébergement chez le client. Si l'un de ces fichiers
    // disparaît, ce n'est pas la vitrine qui est fausse : c'est le déploiement
    // qui est cassé, et on l'apprend ici plutôt qu'au prochain déploiement.
    for (const f of [
      "services/ingest/server.mjs",
      "services/scheduler/worker.mjs",
      "services/mcp/http.mjs",
    ]) {
      expect(LIGNES.some((l) => l.preuve === f), f).toBe(true);
    }
  });

  it("ne recopie pas l'hébergement : ce sont les chaînes des mentions légales", () => {
    // lib/legal.ts est servi publiquement sur /legal/mentions et /legal/dpa. Deux
    // rédactions de la même information finissent par diverger — c'est
    // exactement ce que l'invariant AD-7 existe pour empêcher, et le dépôt l'a
    // déjà payé trois fois.
    const valeurs = LIGNES.map((l) => l.v);
    expect(valeurs).toContain(HOSTS.data);
    expect(valeurs).toContain(HOSTS.app);
    expect(valeurs).toContain(HOSTS.backend);
  });

  it("donne l'adresse du serveur MCP depuis sa source unique", () => {
    expect(LIGNES.some((l) => l.v.includes(MCP_ORIGINE))).toBe(true);
  });

  it("dit que la souveraineté n'est PAS atteinte", () => {
    // La ligne la plus facile à adoucir, et celle qui coûterait le plus cher :
    // « données en UE » n'est pas « hébergeur souverain », et un acheteur public
    // fait la différence. Elle doit rester rouge tant que l'hébergeur relève du
    // droit américain.
    const souv = LIGNES.find((l) => l.k === "Souveraineté");
    expect(souv?.s).toBe("manque");
  });

  it("dit que le compte développeur Chrome n'existe pas", () => {
    const compte = LIGNES.find((l) => l.k === "Compte développeur Chrome");
    expect(compte?.s).toBe("manque");
    // Le kit de soumission est prêt : la ligne doit renvoyer au document qui le
    // décrit, sinon « il ne reste qu'à ouvrir un compte » n'est pas vérifiable.
    expect(compte?.preuve).toBe("docs/CHROME_WEB_STORE.md");
  });
});

describe("chiffres annoncés — remesurés sur les fichiers publiés", () => {
  // Ces bundles sont VERSIONNÉS (git ls-files les liste) : on peut donc les
  // repeser ici. Un rebuild qui change le poids fait échouer ce test, et le
  // message donne la nouvelle valeur à écrire. C'est le seul moyen qu'un chiffre
  // de vitrine ne dérive pas sans qu'on le sache. Une tolérance de 0,3 ko couvre
  // uniquement la différence zlib documentée entre les environnements.
  it("poids du bundle cœur", () => {
    attendrePoidsGzip("apps/console/public/mip-rum.js", SDK_GZIP_KO);
  });

  it("poids du bundle de rejeu, chargé à la demande", () => {
    attendrePoidsGzip("apps/console/public/mip-rum-replay.js", REPLAY_GZIP_KO);
  });

  it("poids du widget d'avis, chargé à la demande", () => {
    attendrePoidsGzip("apps/console/public/mip-rum-feedback.js", FEEDBACK_GZIP_KO);
  });

  // « ~12 ko » a survécu à un passage de 12,4 à 12,6 ko sans que rien ne bronche,
  // à SIX endroits à la fois : vitrine, carrousel d'intégration, page
  // Présentation, fiche capteur. Un nombre recopié n'est pas relu — donc plus
  // personne ne le recopie.
  it("aucun écran ne réécrit le poids du SDK à la main", () => {
    let source = "";
    try {
      source = execFileSync(
        "grep",
        [
          "-rn",
          "--include=*.ts",
          "--include=*.tsx",
          "--exclude-dir=node_modules",
          "--exclude-dir=.next",
          "--exclude=sdk-poids.ts",
          "-E",
          String.raw`[0-9]+([.,][0-9]+)? ?ko gzip`,
          join(RACINE, "apps/console"),
        ],
        { encoding: "utf8" },
      ).trim();
    } catch {
      source = ""; // grep sort en 1 quand il ne trouve rien — le cas recherché
    }
    // Seules les lignes qui INTERPOLENT la constante sont tolérées.
    const dur = source
      .split("\n")
      .filter(Boolean)
      .filter((l) => !/\$\{|SDK_POIDS_TEXTE|koTexte|SDK_BUDGET_KO/.test(l));
    expect(dur).toEqual([]);
  });

  it("la formulation française du poids est bien celle qu'on affiche", () => {
    expect(SDK_POIDS_TEXTE).toBe(`${String(SDK_GZIP_KO).replace(".", ",")} ko gzip`);
  });

  it("le cœur tient sous le budget que le build fait respecter", () => {
    // Le budget n'est pas décoratif : packages/rum-sdk/build.mjs refuse de
    // publier au-delà. On vérifie que la vitrine annonce LE MÊME nombre.
    expect(lire("packages/rum-sdk/build.mjs")).toContain(String(SDK_BUDGET_KO));
    expect(SDK_GZIP_KO).toBeLessThanOrEqual(SDK_BUDGET_KO);
  });

  it("version et permissions de l'extension, telles que le manifeste les porte", () => {
    const m = JSON.parse(lire("apps/extension/manifest.json"));
    expect(m.manifest_version).toBe(3);
    expect(m.version).toBe(EXT_VERSION);
    expect(m.permissions).toEqual([...EXT_PERMISSIONS]);
    // « jamais <all_urls> » est l'argument de confidentialité de l'extension, et
    // le premier motif de rejet au Chrome Web Store. Une permission d'hôte
    // OBLIGATOIRE le rendrait faux ; la demander à l'exécution, domaine par
    // domaine (optional_host_permissions), est ce qui le tient.
    expect(m.host_permissions).toBeUndefined();
    expect(m.permissions).not.toContain("<all_urls>");
  });
});

describe("onglet mesures — ce qu'on capte est routé et stocké pour de vrai", () => {
  // Le parseur OTLP est L'AIGUILLAGE : c'est lui qui décide, par le nom du span,
  // dans quelle table une mesure atterrit. Une famille annoncée sur la vitrine
  // dont le nom n'y figure pas n'est pas mesurée — elle est espérée.
  const parseur = lire("apps/ingest/supabase/functions/_shared/otlp.mjs");
  const inserts = lire("apps/ingest/lib/pg-ingest.mjs");

  /**
   * L'aiguillage route par PRÉFIXE (`span.name.startsWith("track.")`). Un signal
   * plus précis que ce que le parseur nomme est donc bien routé : `track.form.`
   * tombe dans la branche `track.`. On remonte les préfixes pointés jusqu'à en
   * trouver un que le parseur connaît.
   */
  function routeParLIngestion(signal: string): boolean {
    const bouts = signal.split(".");
    for (let n = bouts.length; n > 0; n--) {
      const prefixe = bouts.slice(0, n).join(".");
      if (prefixe && parseur.includes(prefixe)) return true;
    }
    return false;
  }

  it("chaque signal annoncé est reconnu par l'aiguillage d'ingestion", () => {
    const inconnus = MESURES.filter((m) => m.otlp && !routeParLIngestion(m.otlp));
    expect(inconnus.map((m) => `${m.quoi} (${m.otlp})`)).toEqual([]);
  });

  it("le nom du signal est bien celui que le module émet", () => {
    // Sans ce test, le précédent se contenterait d'un préfixe générique : on
    // pourrait écrire `track.` partout et rester vert. Ici on exige que le
    // module cité contienne LE nom annoncé — l'émission et le routage doivent
    // parler du même signal.
    const menteurs = MESURES.filter((m) => m.otlp && !lire(m.module).includes(m.otlp));
    expect(menteurs.map((m) => `${m.quoi} : ${m.otlp} absent de ${m.module}`)).toEqual([]);
  });

  it("chaque mesure atterrit dans une table CRÉÉE PAR UNE MIGRATION et écrite", () => {
    // « Créée par une migration » et non « existe en production » : c'est
    // l'invariant que migration-v54 a dû restaurer, après qu'une table soit née
    // par effet de bord d'un service, décrite nulle part dans le schéma. Une
    // base reconstruite depuis ce dépôt doit porter chaque table annoncée ici.
    const ddl = toutLeDdl();
    const orphelines = MESURES.filter(
      (m) => !ddl.includes(`create table if not exists ${m.table}`) || !inserts.includes(m.table),
    );
    expect(orphelines.map((m) => `${m.quoi} -> ${m.table}`)).toEqual([]);
  });

  it("chaque mesure nomme le module qui l'émet, et il existe", () => {
    const perdus = MESURES.filter((m) => !existsSync(join(RACINE, m.module)));
    expect(perdus.map((m) => `${m.quoi} -> ${m.module}`)).toEqual([]);
  });

  it("couvre les familles pour lesquelles une table dédiée existe", () => {
    // L'inverse du test précédent : pas « ce qu'on annonce existe », mais « ce
    // qui existe est annoncé ». Une table RUM alimentée et absente de la vitrine
    // est une capacité qu'on a codée et qu'on ne montre pas — l'omission est
    // moins grave que le mensonge, mais c'est le contraire du but de l'onglet.
    const annoncees = new Set(MESURES.map((m) => m.table));
    for (const t of [
      "rum_metric",
      "rum_pageview",
      "rum_session",
      "rum_error",
      "rum_resource",
      "rum_longtask",
      "rum_breadcrumb",
      "rum_event",
      "rum_span",
      "rum_log",
      "replay_chunk",
    ]) {
      expect(annoncees.has(t), t).toBe(true);
    }
  });

  it("ne promet pas de collecter une donnée identifiante", () => {
    // Le produit s'engage à ne stocker aucune adresse IP. Une ligne de vitrine
    // qui annoncerait le contraire serait une déclaration RGPD fausse, pas une
    // coquille.
    const session = MESURES.find((m) => m.table === "rum_session");
    // Insensible à la casse : la phrase a été réécrite le 09/09/2026 pour dire le
    // repli sur l'en-tête pays du CDN, et l'engagement y ouvre désormais une
    // proposition (« Aucune adresse IP… »). C'est l'ENGAGEMENT qui est vérifié,
    // pas la majuscule.
    expect(session?.detail.toLowerCase()).toContain("aucune adresse ip");
  });
});

describe("onglet mesures — ce qu'on annonce absent l'est vraiment", () => {
  /**
   * Cherche un fragment dans le CODE d'un fichier ou d'un dossier, en écartant
   * ce qui n'est pas source : `node_modules` (des dépendances tierces) et
   * `dist` (des bundles minifiés, où n'importe quelle suite de caractères
   * finit par apparaître par accident).
   */
  function present(cible: string, fragment: string): string[] {
    const chemin = join(RACINE, cible);
    if (!existsSync(chemin)) return [`CIBLE INTROUVABLE: ${cible}`];
    try {
      const out = execFileSync(
        "grep",
        ["-rlF", "--exclude-dir=node_modules", "--exclude-dir=dist", "--", fragment, chemin],
        { encoding: "utf8" },
      );
      return out.split("\n").filter(Boolean);
    } catch {
      return []; // grep sort en 1 quand il ne trouve rien : c'est le cas attendu
    }
  }

  it.each(ANGLES_MORTS)("« $label » : le code annoncé absent ne s'est pas glissé dans le dépôt", (a) => {
    const [cible, fragment] = a.marqueur;
    const trouves = present(cible, fragment);
    // Si ce test échoue, la vitrine ment PAR EXCÈS DE MODESTIE : la capacité a
    // été codée depuis. Retirer la ligne de ANGLES_MORTS, et l'ajouter à MESURES.
    expect(trouves, `« ${a.label} » : ${fragment} trouvé dans ${trouves.join(", ")}`).toEqual([]);
  });

  it("le marqueur d'absence sait détecter une présence", () => {
    // Anti-tautologie. Un `grep` mal formé renverrait « rien trouvé » sur tout,
    // et les quatre tests ci-dessus passeraient au vert quoi qu'il arrive — la
    // vitrine pourrait alors annoncer absent n'importe quoi. On vérifie donc que
    // la sonde trouve bien quelque chose dont on SAIT qu'il est là.
    expect(present("packages/rum-sdk/src", "longtask").length).toBeGreaterThan(0);
  });

  it("reprend les mesures non couvertes que la console déclare déjà", () => {
    // Pas une quatrième liste écrite à la main : ce sont les `indisponibles` de
    // la roue des blocs, celles que voit un utilisateur connecté écran par
    // écran. Les réécrire ici aurait créé deux vérités sur la même absence.
    const attendus = new Set(CATALOGUES.flatMap((c) => c.indisponibles.map((i) => i.label)));
    const rendus = mesuresNonCouvertes();
    expect(new Set(rendus.map((r) => r.label))).toEqual(attendus);
    // Le motif est obligatoire côté catalogue ; il doit survivre au transport.
    expect(rendus.every((r) => r.raison.length > 0)).toBe(true);
    // Chaque ligne dit de quel écran elle vient, sinon « Speed Index » et
    // « Politique d'escalade » se lisent au même niveau alors qu'elles ne
    // parlent pas du même sujet.
    expect(rendus.every((r) => r.ecran.length > 0)).toBe(true);
  });

  it("ne montre pas deux fois la même absence", () => {
    const labels = mesuresNonCouvertes().map((r) => r.label);
    expect(labels.length).toBe(new Set(labels).size);
  });
});

describe("faits relevés à la main chez l'hébergeur", () => {
  // Railway n'est pas dans le dépôt : ces valeurs ont été lues dans sa console.
  // On ne peut donc pas les revérifier ici — on peut seulement exiger qu'elles
  // portent leur date de relevé, pour qu'un lecteur sache de quand elles datent.
  it("portent une date de relevé, et la région annoncée est en UE", () => {
    expect(RAILWAY.releve).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(RAILWAY.region.startsWith("europe-")).toBe(true);
    expect(INFRA.some((g) => g.lignes.some((l) => l.v.includes(RAILWAY.releve)))).toBe(true);
  });

  it("la région annoncée est celle que déclarent les mentions légales", () => {
    // europe-west4 est nommée dans HOSTS.backend, servi sur /legal/mentions.
    // Deux régions différentes sur deux pages du même site, ce serait la
    // divergence de trop.
    expect(HOSTS.backend).toContain(RAILWAY.region.split("-").slice(0, 2).join("-"));
  });
});

describe("vérité de la vitrine (P**.1)", () => {
  it("la version React Native citée est celle du paquet", () => {
    const pkg = JSON.parse(readFileSync(join(RACINE, "packages/rum-mobile/package.json"), "utf8"));
    expect(RN_VERSION).toBe(pkg.version);
  });

  it("une lecture du planificateur en échec est « non établie », pas « jamais exécutée »", () => {
    const { retention, planif } = volatiles({ etat: "illisible" });
    expect(retention.s).toBe("non-mesure");
    expect(retention.reel).toBe(NON_ETABLI_PLANIFIE);
    // Rien n'est ajouté à « Ce qui manque » sur la foi d'une inconnue.
    expect(planif).toBeNull();
  });

  it("une lecture aboutie sans passage reste « aucune exécution constatée »", () => {
    const { retention, planif } = volatiles({ etat: "lu", date: null });
    expect(retention.s).toBe("manque");
    expect(planif?.t).toBe("Tâches planifiées à relancer");
    const maintenant = Date.parse("2026-09-22T12:00:00Z");
    expect(volatiles({ etat: "lu", date: new Date(maintenant - 3_600_000) }, maintenant).retention.s).toBe("atteint");
    expect(volatiles({ etat: "lu", date: new Date(maintenant - 72 * 3_600_000) }, maintenant).retention.s).toBe("partiel");
  });

  it("le snippet du carrousel vise la route d'ingestion de la console", () => {
    expect(EXAMPLE_SNIPPET).toContain(`https://<console>${ingestPath("traces")}`);
    expect(EXAMPLE_SNIPPET).toContain("/api/ingest/v1/traces");
    expect(EXAMPLE_SNIPPET).not.toContain("<ingest>");
  });
});
