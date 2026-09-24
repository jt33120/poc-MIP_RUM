// L'identité du visiteur — finding 1.3 de docs/AUDIT_RUM_EXTERNE.md, le seul dont
// la conséquence soit juridique et pas seulement cosmétique.
//
// CE QUI ÉTAIT FAUX. `user_hash` valait `fnv1a(userAgent | langue | résolution |
// décalage UTC)`. Aucun aléa, aucun sel, aucun tirage persisté : deux personnes
// sur le même modèle de poste, la même version de navigateur, la même langue, la
// même résolution et le même fuseau obtenaient LA MÊME valeur. Ce n'était pas une
// collision improbable, c'était le comportement nominal — et sur le créneau visé
// (portails de service public, parcs gérés par une DSI) c'est le cas majoritaire.
//
// TROIS FAMILLES DE CONSÉQUENCES, ET ELLES NE SE VALENT PAS :
//
//   1. COMPTER. « Utilisateurs uniques » comptait des CLASSES D'APPAREIL. Un parc
//      de cent postes identiques valait un utilisateur.
//   2. QUALIFIER. « Nouveaux vs revenants » déclarait tout le monde revenant dès
//      qu'un poste de ce modèle avait été vu une fois. La rétention par cohortes
//      affichait de la fidélité là où il n'y avait qu'un modèle de PC.
//   3. RÉPONDRE À UNE DEMANDE RGPD. Un export art. 15 sur cette clé communiquait
//      les données de tiers ; un effacement art. 17 supprimait celles de gens qui
//      n'avaient rien demandé. L'outil de conformité produisait la violation.
//
// Les deux premières familles se corrigent en changeant de clé. La troisième ne
// se corrige PAS : l'information « qui était derrière ce hash » n'a jamais
// existé. D'où un REFUS explicite, testé plus bas — répondre partiellement vaut
// mieux que répondre avec les données de quelqu'un d'autre.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DSAR_ID_COLUMN,
  DSAR_MESSAGES,
  DSAR_VERDICTS,
  DsarRefus,
  dsarVerdict,
} from "../../apps/console/lib/dsar";

const RACINE = join(__dirname, "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");

/**
 * Retire commentaires de ligne et de bloc. Les marqueurs d'absence ci-dessous
 * portent sur le CODE : un commentaire qui EXPLIQUE ce qu'on a retiré doit
 * pouvoir nommer la chose retirée, sinon on ne peut plus documenter une
 * suppression sans faire rougir son propre garde-fou.
 */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** `grep -R` sans faire échouer le test quand il ne trouve rien (grep sort en 1). */
function chercher(motif: string, ...cibles: string[]): string {
  try {
    return execFileSync("grep", ["-RIn", "--", motif, ...cibles], {
      cwd: RACINE,
      encoding: "utf8",
    });
  } catch {
    return "";
  }
}

const V57 = lire("packages/db/sql/migration-v57.sql");
const QUERIES = lire("apps/console/lib/queries.ts");
const SUMMARY = lire("apps/console/lib/queries-summary.ts");
const COHORTS = lire("apps/console/lib/queries-cohorts.ts");
const DSAR_IO = lire("apps/console/lib/queries-dsar.ts");

// ═══════════════════ 1. Ce que le SDK émet, et ce qu'il n'émet plus ═══════════

describe("le SDK a cessé de dériver une identité du terminal", () => {
  const SESSION = sansCommentaires(lire("packages/rum-sdk/src/session.ts"));
  const INDEX = sansCommentaires(lire("packages/rum-sdk/src/index.ts"));

  it("l'attribut annoncé par la vitrine est celui que le SDK émet", () => {
    // La fiche « Sessions anonymes » de la page Specs nomme `mip.visitor_id`.
    // Le test des Specs vérifie le champ `otlp` ; celui-ci vérifie la PROSE,
    // qui sinon pourrait annoncer n'importe quoi.
    expect(lire("apps/console/lib/specs.ts")).toContain("`mip.visitor_id`");
    expect(INDEX).toContain('"mip.visitor_id"');
  });

  it("l'ancienne empreinte a DISPARU du SDK, pas seulement cessé d'être envoyée", () => {
    // Marqueurs d'absence : si quelqu'un réintroduit le calcul, ce test rougit.
    // Une fonction morte mais présente finit par être rappelée.
    for (const marqueur of ["fnv1a", "computeUserHash", "userHash"]) {
      expect(SESSION, `${marqueur} subsiste dans session.ts`).not.toContain(marqueur);
      expect(INDEX, `${marqueur} subsiste dans index.ts`).not.toContain(marqueur);
    }
    // Anti-tautologie : la sonde SAIT trouver ce qui est présent.
    expect(SESSION).toContain("getOrCreateVisitor");
  });

  it("l'identifiant est TIRÉ AU HASARD, pas dérivé de caractéristiques du poste", () => {
    // La seule preuve qui compte : la source d'entropie. `crypto.getRandomValues`
    // ne peut pas produire deux fois la même valeur pour deux postes identiques,
    // ce qui était exactement le défaut de fnv1a(userAgent|langue|…).
    expect(SESSION).toContain("getRandomValues");
    for (const derive of ["navigator.userAgent", "screen.width", "getTimezoneOffset"]) {
      expect(SESSION, `${derive} ne doit pas entrer dans l'identifiant`).not.toContain(derive);
    }
  });

  it("le visiteur peut l'effacer — sinon ce serait un identifiant subi", () => {
    expect(SESSION).toContain("forgetVisitor");
    expect(SESSION).toContain("removeItem");
  });
});

// ═══════════════════════ 2. Le schéma dit ce que vaut chaque ligne ════════════

describe("migration-v57 — l'historique reste marqué pour ce qu'il est", () => {
  it("ajoute visitor_id sans rien détruire", () => {
    expect(V57).toMatch(/alter table rum_session add column if not exists visitor_id text/);
  });

  it("id_kind est GÉNÉRÉE : aucun code ne peut la désynchroniser", () => {
    // L'audit proposait une colonne maintenue par l'ingestion. Deux colonnes pour
    // un seul fait finissent par se contredire — c'est le défaut que ce dépôt
    // passe son temps à corriger ailleurs. PostgreSQL refuse qu'on écrive une
    // colonne générée : la contradiction devient impossible plutôt qu'improbable.
    expect(V57).toMatch(/id_kind text\s*\n?\s*generated always as/);
    expect(V57).toContain("stored");
    expect(V57).toContain("'device_class'");
    expect(V57).toContain("'random'");
  });

  it("NE rétro-remplit PAS — on ne peut pas inventer ce qui n'a pas été mesuré", () => {
    // Le piège le plus tentant : un `update rum_session set visitor_id = user_hash`
    // ferait passer tous les compteurs au vert et transformerait la classe
    // d'appareil en identité de personne. Ce serait le mensonge d'origine, avec
    // un nom de colonne neuf.
    expect(V57).not.toMatch(/update\s+rum_session\s+set\s+visitor_id/i);
    expect(V57).not.toMatch(/visitor_id\s*=\s*user_hash/i);
  });

  it("« utilisateurs touchés » par une erreur compte des visiteurs", () => {
    expect(V57).toContain("count(distinct s.visitor_id)  as users_affected");
  });
});

// ══════════════════════════ 3. Compter des personnes ═════════════════════════

describe("les quatre comptages de personnes ont changé de clé", () => {
  it("le résumé de l'API v1 (/summary)", () => {
    expect(SUMMARY).toContain("count(distinct s.visitor_id)::int");
    expect(SUMMARY).not.toContain("count(distinct s.user_hash)");
  });

  it("le résumé expose AUSSI ce qu'il ne compte pas", () => {
    // Un champ `users` qui sous-compte en silence est un mensonge à part
    // entière : le consommateur de l'API n'a aucun moyen de savoir que la
    // population réelle est plus grande. `unidentified_sessions` est le
    // contre-poids, et le contrat OpenAPI doit le porter.
    expect(SUMMARY).toContain("unidentified_sessions");
    expect(SUMMARY).toContain("s.visitor_id is null) as unidentified_sessions");
    expect(lire("docs/RUM_READ_API.md")).toContain("unidentified_sessions");
  });

  it("nouveaux vs revenants (visitStats)", () => {
    expect(QUERIES).toContain("s2.visitor_id = s.visitor_id");
    expect(QUERIES).not.toContain("s2.user_hash = s.user_hash");
  });

  it("nouveaux vs revenants est enfin borné par app_id", () => {
    // Défaut d'origine, indépendant de l'identité : la sous-requête « ce visiteur
    // a-t-il une session antérieure ? » balayait TOUTES les applications. Un
    // visiteur arrivant pour la première fois sur une app était déclaré revenant
    // parce qu'il avait visité une autre app du parc.
    expect(QUERIES).toContain("s2.app_id = s.app_id");
  });

  it("les sessions sans identifiant sont comptées à part, jamais réparties", () => {
    expect(QUERIES).toContain("unidentified_count");
    // Ni « nouvelles » ni « revenantes » : les deux filtres exigent `identifie`.
    expect(QUERIES).toContain("filter (where identifie and is_returning)");
    expect(QUERIES).toContain("filter (where identifie and not is_returning)");
  });

  it("les cohortes de rétention", () => {
    expect(COHORTS).toContain("s.visitor_id as user");
    expect(COHORTS).toContain("where s.visitor_id is not null");
    expect(COHORTS).not.toContain("s.user_hash as user");
  });
});

describe("plus aucune affirmation d'exactitude que le chiffre ne tient", () => {
  it("le bloc « Nouveaux vs revenants » ne se dit plus « exacte » tout court", () => {
    const blocs = lire("apps/console/lib/dashboard-blocs.ts");
    const ligne = blocs.split("\n").find((l) => l.includes('id: "resume"')) ?? "";
    expect(ligne, "le bloc resume est introuvable").not.toBe("");
    // Il balaie bien toute la fenêtre (vrai), mais seulement les sessions
    // identifiées (ce que « exacte » laissait croire couvert).
    expect(ligne).toContain("IDENTIFIÉS");
    expect(ligne.toLowerCase()).not.toContain("exacte");
  });

  it("plus un seul « fingerprint anonymisé » dans la console", () => {
    // Le mot « anonymisé » portait la garantie exactement à l'envers : la valeur
    // était irréversible (vrai) ET réidentifiante par recoupement, puisque
    // entièrement dérivée du terminal.
    // `docs/archive/` est exclu VOLONTAIREMENT : c'est un fonds d'archive, il
    // décrit le produit tel qu'il était. Le réécrire pour verdir un test
    // reviendrait à effacer la trace de l'erreur — l'inverse de ce que ce
    // fichier défend.
    const trouve = chercher("fingerprint anonymisé", "apps/console", "docs")
      .split("\n")
      // `/archive/` n'importe où dans la ligne, pas un PRÉFIXE : la sortie de
      // grep n'est relative que parce qu'on lui fixe un répertoire courant.
      // Faire dépendre le filtre de cette relativité, c'est laisser le test
      // rougir sur du contenu d'archive le jour où elle change.
      .filter((l) => l && !l.includes("/archive/"))
      .join("\n");
    expect(trouve, `« fingerprint anonymisé » subsiste :\n${trouve}`).toBe("");
    // Anti-tautologie : la sonde fonctionne sur une chaîne réellement présente.
    expect(chercher("visitor_id", "apps/console/lib/queries-dsar.ts")).not.toBe("");
  });
});

// ═══════════════ 4. Le DSAR refuse plutôt que de livrer un tiers ══════════════

describe("recevabilité d'une demande RGPD — la décision, isolée et pure", () => {
  it("exécute quand l'identifiant désigne un visiteur", () => {
    expect(dsarVerdict({ visiteur: 3, heritees: 0 })).toBe("execute");
  });

  it("REFUSE quand il ne désigne qu'une ancienne empreinte de terminal", () => {
    expect(dsarVerdict({ visiteur: 0, heritees: 12 })).toBe("refus_empreinte");
  });

  it("distingue « je refuse » de « je ne connais pas »", () => {
    // Les confondre reviendrait à répondre « nous n'avons rien sur vous » à
    // quelqu'un dont on a bel et bien des données — une réponse fausse à une
    // demande d'accès, ce que le refus explicite évite.
    expect(dsarVerdict({ visiteur: 0, heritees: 0 })).toBe("inconnu");
    expect(DSAR_MESSAGES.refus_empreinte).not.toBe(DSAR_MESSAGES.inconnu);
  });

  it("un identifiant qui est LES DEUX s'exécute sur le visiteur seulement", () => {
    // Cas de collision quasi impossible, mais la règle doit être écrite : on
    // n'élargit jamais le périmètre d'un effacement à des lignes héritées.
    expect(dsarVerdict({ visiteur: 1, heritees: 5 })).toBe("execute");
  });

  it("chaque verdict a un message, et le refus dit POURQUOI", () => {
    for (const v of DSAR_VERDICTS) expect(DSAR_MESSAGES[v].length).toBeGreaterThan(20);
    expect(DSAR_MESSAGES.refus_empreinte).toContain("user_hash");
    expect(DSAR_MESSAGES.refus_empreinte.toLowerCase()).toContain("tiers");
  });

  it("le refus voyage comme une erreur typée, avec son motif", () => {
    const e = new DsarRefus("refus_empreinte");
    expect(e).toBeInstanceOf(Error);
    expect(e.verdict).toBe("refus_empreinte");
    expect(e.message).toBe(DSAR_MESSAGES.refus_empreinte);
  });
});

describe("le refus est STRUCTUREL, pas seulement affiché", () => {
  it("l'ancre du DSAR est visitor_id, en constante", () => {
    expect(DSAR_ID_COLUMN).toBe("visitor_id");
    expect(DSAR_IO).toContain("${DSAR_ID_COLUMN} = $2");
  });

  it("aucun select * ni delete de ce module ne vise user_hash", () => {
    // LA garantie qui compte. Une seule requête lit `user_hash`, et elle COMPTE
    // des lignes pour expliquer le refus ; il n'existe pas de chemin de code
    // capable d'exporter ou d'effacer sur cette clé, même par erreur.
    const lignes = DSAR_IO.split("\n").filter(
      (l) => /select \*|delete from/.test(l) || /delete from \$\{/.test(l),
    );
    expect(lignes.length, "aucune requête d'export/effacement trouvée").toBeGreaterThan(2);
    for (const l of lignes) expect(l, `requête visant user_hash : ${l}`).not.toContain("user_hash");
  });

  it("la seule lecture de user_hash est un COMPTAGE, et elle est isolée", () => {
    expect(DSAR_IO).toContain("user_hash"); // l'en-tête explique pourquoi il reste
    const dansDuSql = sansCommentaires(DSAR_IO)
      .split("\n")
      .filter((l) => l.includes("user_hash"));
    expect(dansDuSql.length, `user_hash dans plus d'une requête :\n${dansDuSql.join("\n")}`).toBe(1);
    // Et cette unique requête est bien celle qui COMPTE : `SQL_HERITEES`, dont
    // le corps ne rend jamais de contenu de ligne.
    const heritees = /const SQL_HERITEES = `([^`]*)`/.exec(DSAR_IO);
    expect(heritees, "SQL_HERITEES introuvable").not.toBeNull();
    expect(heritees![1]).toContain("count(*)");
    expect(heritees![1]).toContain("user_hash");
    expect(heritees![1]).not.toContain("select *");
  });

  it("export ET effacement passent tous deux par le contrôle de recevabilité", () => {
    // Un seul des deux protégé serait pire que rien : on croirait le chemin sûr.
    for (const fn of ["export", "erase"]) {
      const i = DSAR_IO.indexOf(`export async function dsar${fn[0].toUpperCase()}${fn.slice(1)}(`);
      expect(i, `dsar${fn} introuvable`).toBeGreaterThan(-1);
      expect(DSAR_IO.slice(i, i + 900)).toContain("await exigerRecevable(");
    }
  });

  it("la route d'export répond 409 et le motif, pas une pile d'erreur", () => {
    const route = lire("apps/console/app/admin/privacy/export/route.ts");
    expect(route).toContain("instanceof DsarRefus");
    expect(route).toContain("status: 409");
  });

  it("un refus d'effacement est TRACÉ — une demande sans suite laisse une trace", () => {
    const actions = lire("apps/console/app/admin/privacy/actions.ts");
    expect(actions).toContain("dsar_erase_refuse");
    expect(actions).toContain("instanceof DsarRefus");
  });

  it("la déclaration de conformité annonce le refus, et le bon identifiant", () => {
    // Sans cela, le code refuserait pendant que le document promet l'inverse —
    // et c'est le document qu'un DPO lit.
    const c = lire("docs/CONFORMITE.md");
    expect(c).toContain("visitor_id");
    expect(c).toContain("id_kind = 'device_class'");
    expect(c).toContain("dsar_erase_refuse");
    // La ligne héritée reste décrite pour ce qu'elle est, pas effacée du tableau.
    expect(c).toContain("user_hash");
  });

  it("le document d'export change de version, parce que sa clé change de sens", () => {
    // `user_hash` → `visitor_id` n'est pas un renommage : les deux champs ne
    // désignent pas la même chose. Garder version 1 laisserait un consommateur
    // croire qu'il lit le même document.
    const pur = lire("apps/console/lib/dsar.ts");
    expect(pur).toContain("version: 2");
    expect(pur).toContain("visitor_id: input.visitorId");
    expect(pur).not.toContain("user_hash: input");
  });
});
