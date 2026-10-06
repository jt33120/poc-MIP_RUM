// La conformité telle que le code la déclare. `lib/legal.ts` est servi publiquement
// (pages légales, pied de page de la vitrine) : ce qu'il dit des sous-traitants, des
// régions et des sources de données doit suivre le code.
//
// L'en-tête de `lib/legal.ts` énonce la règle : tout changement d'hébergeur, ou toute
// nouvelle sortie de données vers un tiers, se répercute dans la même modification
// que le code. Ce fichier vérifie ce qui se vérifie mécaniquement : un sous-traitant
// déclaré avant d'être appelé, les régions réellement utilisées, l'adresse IP lue par
// Railway dès que l'IaC l'y autorise, et le consentement que le SDK tient.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fournisseurDeclare, URL_MISTRAL } from "../../apps/console/lib/assistant/mistral";
import { DATA_SOURCES, HOSTS, SOUS_TRAITANT_ASSISTANT, SUBPROCESSORS } from "../../apps/console/lib/legal";

describe("sous-traitants — déclarés avant d'être appelés", () => {
  it("l'assistant n'appelle le modèle que si son fournisseur est déclaré", () => {
    // La clé posée sur Vercel ne suffit pas à faire sortir une donnée : le
    // fournisseur doit être dans SUBPROCESSORS, la liste que servent les pages
    // légales. C'est `fournisseurDeclare` qui garde l'appel.
    expect(SOUS_TRAITANT_ASSISTANT.name).toBe("Mistral AI");
    expect(new URL(URL_MISTRAL).hostname).toBe("api.mistral.ai");
    expect(fournisseurDeclare()).toBe(SUBPROCESSORS.some((s) => s.name === SOUS_TRAITANT_ASSISTANT.name));
    expect(fournisseurDeclare([])).toBe(false);
    expect(fournisseurDeclare([...SUBPROCESSORS, SOUS_TRAITANT_ASSISTANT])).toBe(true);
    // La déclaration préparée dit ce que le code envoie, et rien de plus.
    expect(SOUS_TRAITANT_ASSISTANT.societe).toBe("Société de droit français");
    expect(SOUS_TRAITANT_ASSISTANT.note).toMatch(/jamais d'identifiant de visiteur ni d'adresse IP/);
    expect(SOUS_TRAITANT_ASSISTANT.note).toMatch(/configuré et qu'un utilisateur l'interroge/);
  });

  it("ne déclare aucun fournisseur que le code ne connaît plus", () => {
    // Supabase est sorti avec la migration vers Neon, Anthropic avec l'ancien assistant.
    const noms = SUBPROCESSORS.map((s) => s.name).join(" ");
    for (const mort of ["Supabase", "Anthropic"]) expect(noms, mort).not.toContain(mort);
  });

  it("DB-IP est une source de données attribuée, pas un sous-traitant", () => {
    // CC BY 4.0 n'autorise l'usage qu'avec une attribution visible ; DB-IP ne reçoit
    // aucune donnée : un fichier téléchargé n'est pas une sous-traitance.
    const dbip = DATA_SOURCES.find((s) => s.name.includes("DB-IP"));
    expect(dbip, "lib/legal.ts ne déclare plus DB-IP").toBeTruthy();
    expect(dbip!.attribution).toBeTruthy();
    expect(dbip!.licence).toBeTruthy();
    expect(SUBPROCESSORS.map((s) => s.name).join(" ")).not.toContain("DB-IP");
  });
});

describe("résidence des données — les régions annoncées sont celles du code", () => {
  it("cite les trois régions réellement utilisées, et jamais celle d'un hébergeur abandonné", () => {
    const hotes = HOSTS.data + HOSTS.app + HOSTS.backend;
    for (const r of ["aws-eu-central-1", "fra1", "europe-west4"]) expect(hotes, `${r} absent de legal.ts`).toContain(r);
    // `eu-west-3` était la région Supabase.
    expect(hotes).not.toContain("eu-west-3");
  });
});

describe("adresse IP et collecte directe", () => {
  it("le GeoIP du trafic direct allumé dans l'IaC : Railway est déclaré lire l'adresse IP", () => {
    // P6b.G (28/09/2026) : dès que le collector lit une adresse (`GEOIP_IP_SOURCE`
    // autre que `none`), Railway reçoit l'adresse IP des navigateurs qui lui
    // écrivent en direct.
    const iac = readFileSync(join(__dirname, "../../.railway/railway.ts"), "utf8");
    const geoip = /GEOIP_IP_SOURCE: "([^"]+)"/.exec(iac)?.[1];
    expect(geoip, "GEOIP_IP_SOURCE introuvable dans .railway/railway.ts").toBeTruthy();
    if (geoip === "none") return;
    const railway = SUBPROCESSORS.find((s) => s.name === "Railway Corp.");
    expect(railway?.note).toMatch(/adresse IP/);
  });

  it("la collecte directe des clients existe dans le code : legal.ts dit que leurs navigateurs écrivent au collecteur", () => {
    // Le texte suit le CODE, pas la variable posée sur Vercel, que rien dans la CI ne voit.
    const code = readFileSync(join(__dirname, "../../apps/console/lib/ingest-endpoint.ts"), "utf8");
    if (!code.includes("NEXT_PUBLIC_DIRECT_COLLECTOR_URL")) return;
    expect(HOSTS.backend).toMatch(/que les navigateurs lui envoient directement/);
    const railway = SUBPROCESSORS.find((s) => s.name === "Railway Corp.");
    expect(railway?.note).toMatch(/sites dont le code de suivi vise le collecteur/);
  });
});

describe("consentement — ce que le SDK tient", () => {
  it("le refus coupe le réseau, le terminal et le rejeu", () => {
    // Le SDK retient le réseau ET le terminal tant que le consentement manque
    // (finding 1.11), prouvé par tests/unit/sdk-consentement-stockage.test.ts.
    const sdk = (f: string) => readFileSync(join(__dirname, `../../packages/rum-sdk/src/${f}`), "utf8");
    expect(sdk("index.ts")).toContain("arreterReplay?.();");
    expect(sdk("session.ts")).not.toContain("CE QUI N'EST PAS RÉGLÉ ICI");
    expect(sdk("index.ts")).toContain("autoriserAccesTerminal(!accordAttendu)");
    for (const cle of ["mip_rum_session", "mip_rum_visitor", "mip_rum_sampling"]) {
      expect(sdk("consent.ts"), `${cle} absente des clés effacées au refus`).toContain(`"${cle}"`);
    }
  });
});
