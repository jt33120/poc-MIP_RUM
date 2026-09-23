// États du domaine usages (F54, plan § 6.5 et § 3.8) : les frontières d'ÉCRAN des sept
// routes — /sessions, /sessions/[id], /acquisition, /retention, /paths, /forms, /map.
//
// Ce que ces tests verrouillent (l'e2e `usages-etats.spec.ts` le rejoue sur une vraie
// base coupée, avec les largeurs) :
//   · la preuve de fin de F54 devient une garde : chaque route a SON `error.tsx` ;
//   · aucune route n'a de `loading.tsx`, ni aucun de ses ancêtres : une frontière
//     Suspense au-dessus d'un écran casse la navigation par query (`router.replace`
//     de la barre de filtres) — écart F02 validé, repris par F54 ;
//   · chaque `error.tsx` parle français, nomme SON écran (pas le filet racine
//     « Console MIP RUM »), propose « Réessayer », et ne montre aucun détail
//     technique : ni le message de l'exception (il peut nommer un hôte ou une table),
//     ni la pile — seulement la référence `digest` qui relie l'écran aux journaux.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

// « Réessayer » lit le routeur de Next : hors application, on lui en donne un inerte.
// `next` est une dépendance de la CONSOLE : le module simulé est désigné par son
// chemin résolu depuis apps/console, celui qu'importe SectionErreur (cf. Figure.test).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

type PropsErreur = { error: Error & { digest?: string }; reset: () => void };

/** Les sept écrans du domaine, le titre que leur `error.tsx` doit porter (celui de la navigation). */
const ECRANS = [
  { dossier: "sessions", titre: "Sessions", module: () => import("@/app/sessions/error") },
  { dossier: "sessions/[id]", titre: "Détail de session", module: () => import("@/app/sessions/[id]/error") },
  { dossier: "acquisition", titre: "Acquisition", module: () => import("@/app/acquisition/error") },
  { dossier: "retention", titre: "Rétention", module: () => import("@/app/retention/error") },
  { dossier: "paths", titre: "Parcours", module: () => import("@/app/paths/error") },
  { dossier: "forms", titre: "Formulaires", module: () => import("@/app/forms/error") },
  { dossier: "map", titre: "Carte", module: () => import("@/app/map/error") },
] as const;

const APP = join(process.cwd(), "apps/console/app");

/** Le texte visible, sans balises ni entités d'espace. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

/** Une panne de base réaliste : son message nomme un hôte et une table. */
function panne(): Error & { digest?: string } {
  const e = new Error('connect ECONNREFUSED 10.0.0.12:5432 — relation "rum_session" does not exist') as Error & {
    digest?: string;
  };
  e.digest = "3141592653";
  e.stack = `${e.message}\n    at sessionMeta (lib/queries.ts:679:21)`;
  return e;
}

describe("F54 — preuve de fin : les sept routes ont leur error.tsx, aucune n'a de loading.tsx", () => {
  it("un error.tsx dans chacun des sept dossiers de route", () => {
    const manquants = ECRANS.filter((e) => !existsSync(join(APP, e.dossier, "error.tsx"))).map((e) => e.dossier);
    expect(manquants).toEqual([]);
  });

  it("aucun loading.tsx sur une route du domaine ni au-dessus (piège 7 : il casse la navigation par query)", () => {
    const dossiers = new Set<string>([""]);
    for (const e of ECRANS) {
      const parties = e.dossier.split("/");
      for (let i = 1; i <= parties.length; i++) dossiers.add(parties.slice(0, i).join("/"));
    }
    const trouves = [...dossiers].filter((d) => existsSync(join(APP, d, "loading.tsx"))).map((d) => `app/${d}/loading.tsx`);
    expect(trouves).toEqual([]);
  });
});

describe("F54 — chaque error.tsx : français, son écran, « Réessayer », aucun détail technique", () => {
  for (const ecran of ECRANS) {
    it(`/${ecran.dossier} → « ${ecran.titre} »`, async () => {
      const { default: Erreur } = (await ecran.module()) as { default: ComponentType<PropsErreur> };
      const html = renderToStaticMarkup(<Erreur error={panne()} reset={() => {}} />);
      const t = texte(html);

      // SON écran, en titre de page : pas le filet racine (app/error.tsx).
      expect(html).toMatch(new RegExp(`<h1[^>]*>${ecran.titre}</h1>`));
      expect(t).not.toContain("Console MIP RUM");
      // Le vocabulaire des états (§ 3.8), et le geste.
      expect(html).toContain('role="alert"');
      expect(t).toContain("Lecture en échec.");
      expect(t).toContain(`La lecture de l'écran « ${ecran.titre} » a échoué ; aucun chiffre partiel n'est affiché.`);
      expect(html).toMatch(/<button[^>]*>Réessayer<\/button>/);
      // Seule la référence relie l'écran aux journaux serveur.
      expect(t).toContain("Référence : 3141592653");
      // Aucun détail technique : ni message, ni hôte, ni table, ni pile.
      for (const fuite of ["ECONNREFUSED", "10.0.0.12", "rum_session", "does not exist", "sessionMeta", "queries.ts"]) {
        expect(t, fuite).not.toContain(fuite);
      }
      // Aucun texte anglais de Next.
      for (const anglais of ["Application error", "Something went wrong", "Try again", "server-side exception"]) {
        expect(t, anglais).not.toContain(anglais);
      }
    });
  }

  it("sans digest, aucune ligne « Référence » vide", async () => {
    const { default: Erreur } = (await import("@/app/acquisition/error")) as { default: ComponentType<PropsErreur> };
    const erreur = panne();
    delete erreur.digest;
    const t = texte(renderToStaticMarkup(<Erreur error={erreur} reset={() => {}} />));
    expect(t).not.toContain("Référence");
    expect(t).toContain("Lecture en échec.");
  });

  it("/sessions/[id] dit que la liste, elle, reste lisible, et y ramène", async () => {
    const { default: Erreur } = (await import("@/app/sessions/[id]/error")) as { default: ComponentType<PropsErreur> };
    const html = renderToStaticMarkup(<Erreur error={panne()} reset={() => {}} />);
    expect(texte(html)).toContain("La liste des sessions reste lisible : ← Toutes les sessions .");
    expect(html).toMatch(/<a[^>]*href="\/sessions"[^>]*>← Toutes les sessions<\/a>/);
  });
});
