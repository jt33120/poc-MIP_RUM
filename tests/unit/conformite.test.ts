// Le dossier de conformité — la pièce qu'un acheteur public annexe à son dossier.
//
// CE QU'IL A DÉCLARÉ DE FAUX. `docs/CONFORMITE.md` porte en tête « pièce destinée
// aux grilles de notation d'AO grand compte et aux DPO ». Il a annoncé pendant des
// semaines une base **Supabase en région eu-west-3 (Paris)** — migrée vers Neon /
// Francfort —, une **CA Supabase épinglée**, un sous-traitant **Mistral / Anthropic**
// qui ne traite plus rien, et il **omettait Railway**, qui reçoit pourtant les
// mesures RUM.
//
// L'en-tête de `lib/legal.ts` énonce la règle depuis longtemps — tout changement
// d'hébergeur se répercute dans la même modification que le code — et cette règle a
// bien été appliquée à `legal.ts`. Elle ne l'a pas été ici, parce que rien ne
// l'imposait : `legal.ts` est servi publiquement et couvert par des tests, ce
// fichier-ci n'était couvert par rien.
//
// LA RÈGLE QUE CE FICHIER FAIT RESPECTER, et sa nuance : un nom de fournisseur mort
// peut encore apparaître en PROSE, à condition d'être présenté comme révolu. C'est
// même souhaitable — dire « nous avons déclaré Supabase pendant des semaines après
// la migration » est une information utile à un DPO. Ce qui est interdit, c'est de
// le DÉCLARER : dans le registre des sous-traitants, ou dans une ligne de résidence
// des données. Les citations en bloc (`>`) sont donc exclues du contrôle ; tout le
// reste y est soumis.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOSTS, SUBPROCESSORS } from "../../apps/console/lib/legal";

const DOC = readFileSync(join(__dirname, "../../docs/CONFORMITE.md"), "utf8");

/** Le document SANS ses citations en bloc : ce qu'il déclare, pas ce qu'il raconte. */
const DECLARE = DOC.split("\n")
  .filter((l) => !l.trimStart().startsWith(">"))
  .join("\n");

/** Les lignes du registre des sous-traitants (§7), hors en-tête et séparateur. */
function lignesRegistre(): string[] {
  const sept = DOC.split(/^## 7\./m)[1] ?? "";
  const fin = sept.split(/^## /m)[0];
  return fin
    .split("\n")
    .filter((l) => l.trimStart().startsWith("|"))
    .filter((l) => !/^\|\s*-+/.test(l.trim()) && !/Sous-traitant/.test(l));
}

/** Fournisseurs réellement en place, hors emplacement à renseigner. */
const VIVANTS = SUBPROCESSORS.filter((s) => !s.name.startsWith("["));

describe("registre des sous-traitants — le reflet de lib/legal.ts", () => {
  const registre = lignesRegistre();

  it("nomme CHAQUE sous-traitant déclaré dans le code", () => {
    // Un sous-traitant omis est le défaut le plus coûteux des deux : Railway
    // reçoit les mesures RUM et n'apparaissait nulle part dans ce dossier.
    const absents = VIVANTS.filter((s) => !registre.some((l) => l.includes(s.name)));
    expect(absents.map((s) => s.name)).toEqual([]);
  });

  it("ne déclare AUCUN fournisseur que le code ne connaît plus", () => {
    // Déclarer un sous-traitant qui ne traite rien est aussi faux que d'en
    // omettre un qui traite. Mistral et Anthropic sont sortis le 09/09/2026
    // avec la suppression de l'assistant IA ; Supabase avec la migration Neon.
    for (const mort of ["Supabase", "Mistral", "Anthropic"])
      expect(registre.join("\n"), mort).not.toContain(mort);
  });

  it("compte autant de lignes que le code a de sous-traitants", () => {
    // Sans ce contrôle, une ligne inventée passerait : elle ne serait ni absente
    // d'un côté, ni morte de l'autre.
    expect(registre.length).toBe(SUBPROCESSORS.length);
  });
});

describe("résidence des données — les régions annoncées sont celles du code", () => {
  // Les régions vivent en toutes lettres dans HOSTS. On ne compare pas les
  // phrases (le dossier les reformule pour un lecteur juridique), on compare les
  // IDENTIFIANTS de région, qui eux ne se reformulent pas.
  const regions = ["aws-eu-central-1", "fra1", "europe-west4"];

  it("cite les trois régions réellement utilisées", () => {
    for (const r of regions) {
      expect(HOSTS.data + HOSTS.app + HOSTS.backend, `${r} absent de legal.ts`).toContain(r);
      expect(DECLARE, `${r} absent du dossier`).toContain(r);
    }
  });

  it("ne déclare plus la région d'un hébergeur abandonné", () => {
    // `eu-west-3` était la région Supabase. Elle peut être RACONTÉE dans un
    // encadré ; elle ne peut plus être déclarée.
    expect(DECLARE).not.toContain("eu-west-3");
  });

  it("ne présente pas la résidence UE comme de la souveraineté", () => {
    // La confusion qui coûte un appel d'offres : trois sociétés de droit
    // américain hébergent en UE. Le dossier doit dire les deux.
    expect(DECLARE).toContain("droit américain");
  });
});

describe("affirmations que le code ne tient pas", () => {
  it("ne dit plus que le hash utilisateur est anonyme", () => {
    // `user_hash` est dérivé du user-agent, de la langue, de la résolution et du
    // décalage horaire, sans aléa (packages/rum-sdk/src/session.ts) : sur un parc
    // homogène plusieurs personnes partagent la même valeur. Ce n'est ni un
    // identifiant de personne, ni une donnée anonyme au sens du RGPD.
    expect(DECLARE).not.toMatch(/user_hash\s*\*\*anonymisé\*\*/);
    expect(DECLARE).not.toContain("hash utilisateur anonyme");
  });

  it("dit d'où vient le pays quand ce n'est pas le fuseau", () => {
    // L'ingestion lit `x-vercel-ip-country` / `cf-ipcountry` en repli et l'écrit
    // en base : la résolution IP→pays a bien lieu, chez le CDN. « Aucune IP
    // stockée » reste vrai ; « ni même résolue » ne l'était pas.
    expect(DECLARE).toContain("cf-ipcountry");
  });

  it("ne présente pas le tampon de consentement comme couvrant le terminal", () => {
    // `requireConsent` retient le RÉSEAU. L'identifiant de session est écrit dans
    // le stockage local avant la barrière, et survit au refus.
    // Le paragraphe, pas la ligne : la phrase court sur plusieurs lignes.
    const i = DECLARE.indexOf("requireConsent");
    expect(i, "le dossier ne parle plus de requireConsent").toBeGreaterThan(-1);
    const paragraphe = DECLARE.slice(i).split("\n\n")[0];
    expect(paragraphe).toMatch(/réseau/);
  });
});
