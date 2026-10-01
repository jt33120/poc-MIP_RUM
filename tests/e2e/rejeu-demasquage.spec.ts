// E2E du démasquage sélectif au rejeu (`mip-rum-unmask`, option `replayUnmask`).
//
// CE QUE CE TEST PROUVE, ET POURQUOI DANS UN VRAI NAVIGATEUR. rrweb 2.0.1 n'a pas
// de sélecteur de démasquage : le SDK passe par `maskTextFn(texte, élément)` et
// par un `blockSelector` en `:is(…):not(…)`. Que la décision soit la bonne se
// teste sans DOM (tests/unit/replay-masquage.test.ts) ; que rrweb l'applique —
// à l'instantané COMME aux mutations — et que Chromium accepte le sélecteur ne se
// voit qu'ici. Le test lit ce qui part réellement sur le fil : les chunks gzip
// POSTés vers /v1/replay, décompressés, et l'arbre de l'instantané complet.
//
// SANS SERVEUR. La page, le SDK (packages/rum-sdk/dist, produit par
// `pnpm build:sdk`) et la collecte sont servis par `page.route` sur une origine
// fictive : le test ne dépend ni de la démo :8080 ni du receveur :4319, et ne
// peut pas lire par erreur le build d'un autre poste servi sur ces ports.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

const ORIGINE = "http://rejeu-demasquage.test";
const DIST = join(process.cwd(), "packages/rum-sdk/dist");
const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#f60"/></svg>';

/** Un nœud sérialisé par rrweb-snapshot (Document 0, Element 2, Text 3). */
interface Noeud {
  type: number;
  id: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: Noeud[];
  textContent?: string;
}
interface Evenement {
  type: number;
  data: {
    node?: Noeud;
    source?: number;
    texts?: { id: number; value: string }[];
    adds?: { parentId: number; node: Noeud }[];
    text?: string;
    id?: number;
  };
}

// Un élément BLOQUÉ n'est sérialisé qu'avec sa classe et sa taille (rr_width,
// rr_height) : son `id` disparaît. Les éléments que le test retrouve portent donc
// leur repère en classe.
const CORPS = `
  <table><tr>
    <td class="clair mip-rum-unmask">Commande 4521</td>
    <td class="voisine">Jeanne Martin</td>
  </tr></table>
  <div class="zone mip-rum-unmask">
    <p class="total">Total 128,40 €</p>
    <input class="saisie" value="secret-123" />
    <div class="editable" contenteditable="true">note privée</div>
    <img class="logo-clair" src="/logo.svg" width="20" height="20" alt="" />
    <p class="bloc mip-rum-block">IBAN FR76 3000</p>
  </div>
  <img class="logo-masque" src="/logo.svg" width="20" height="20" alt="" />
  <section class="par-option" data-rejeu-clair><span>Visible par option</span></section>`;

/**
 * Monte la page de test avec `config` en plus de l'init commune, et rend la
 * liste des chunks de rejeu reçus (corps décompressés, dans l'ordre d'envoi).
 */
async function monter(page: Page, config: Record<string, unknown>): Promise<Evenement[][]> {
  const chunks: Evenement[][] = [];
  const init = {
    endpoint: `${ORIGINE}/v1/traces`,
    appId: "rejeu-demasquage",
    replay: true,
    replayEndpoint: `${ORIGINE}/v1/replay`,
    ...config,
  };
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
    <script src="/mip-rum.js"></script>
    <script>MIPRum.init(${JSON.stringify(init)});</script>
    </head><body>${CORPS}</body></html>`;

  await page.route(`${ORIGINE}/**`, async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname;
    if (chemin === "/v1/replay") {
      chunks.push(JSON.parse(gunzipSync(req.postDataBuffer()!).toString("utf8")));
      return route.fulfill({ status: 200, body: "" });
    }
    if (chemin === "/mip-rum.js" || chemin === "/mip-rum-replay.js")
      return route.fulfill({ contentType: "application/javascript", body: readFileSync(join(DIST, chemin.slice(1))) });
    if (chemin === "/logo.svg") return route.fulfill({ contentType: "image/svg+xml", body: LOGO });
    if (req.method() === "GET") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 200, body: "{}" }); // traces, journaux
  });

  await page.goto(`${ORIGINE}/`);
  // Le rejeu se vide au passage en arrière-plan (fetch keepalive) : on le simule.
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }),
  );
  await vider(page, chunks, 1);
  return chunks;
}

/** Provoque des vidages jusqu'à avoir reçu `n` chunks. */
async function vider(page: Page, chunks: unknown[], n: number) {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        return chunks.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(n);
}

function instantane(chunks: Evenement[][]): Noeud {
  const plein = chunks.flat().find((e) => e.type === 2); // EventType.FullSnapshot
  expect(plein, "instantané complet").toBeTruthy();
  return plein!.data.node!;
}

/** Le nœud qui porte la classe `repere`. */
function trouver(n: Noeud, repere: string): Noeud {
  const pile = [n];
  while (pile.length) {
    const c = pile.pop()!;
    if (String(c.attributes?.class ?? "").split(" ").includes(repere)) return c;
    pile.push(...(c.childNodes ?? []));
  }
  throw new Error(`.${repere} absent de l'instantané`);
}

const texte = (n: Noeud): string =>
  (n.childNodes ?? []).map((c) => (c.type === 3 ? (c.textContent ?? "") : texte(c))).join("");

test.describe("démasquage sélectif — niveau « all » (défaut)", () => {
  test("critères 1 à 4 sur l'instantané complet, et le plancher", async ({ page }) => {
    const chunks = await monter(page, { replayUnmask: "[data-rejeu-clair]" });
    const racine = instantane(chunks);

    // 1. Une cellule démasquée garde son texte ; 2. sa voisine sort en « * ».
    expect(texte(trouver(racine, "clair"))).toBe("Commande 4521");
    expect(texte(trouver(racine, "voisine"))).toBe("****** ******");
    // Les descendants de la zone sont démasqués avec elle.
    expect(texte(trouver(racine, "total"))).toBe("Total 128,40 €");
    // L'option `replayUnmask` s'ajoute à la classe réservée.
    expect(texte(trouver(racine, "par-option"))).toBe("Visible par option");

    // 3. Une saisie dans la zone reste masquée — sa valeur comme un contenteditable.
    expect(trouver(racine, "saisie").attributes?.value).toBe("**********");
    expect(texte(trouver(racine, "editable"))).toBe("**** ******");

    // 4. Une image démasquée garde sa source ; hors zone, elle reste un cadre.
    const clair = trouver(racine, "logo-clair").attributes!;
    expect(clair.src).toBe(`${ORIGINE}/logo.svg`);
    expect(clair.rr_width).toBeUndefined();
    const masque = trouver(racine, "logo-masque").attributes!;
    expect(masque.src).toBeUndefined();
    expect(masque.rr_width).toBe("20px");

    // `mip-rum-block` l'emporte, même dans une zone démasquée : rien n'est sérialisé.
    const bloc = trouver(racine, "bloc");
    expect(bloc.attributes?.rr_width).toBeDefined();
    expect(bloc.childNodes ?? []).toEqual([]);
    expect(JSON.stringify(chunks)).not.toContain("IBAN");
    expect(JSON.stringify(chunks)).not.toContain("secret-123");
    expect(JSON.stringify(chunks)).not.toContain("Jeanne");
  });

  test("les mutations suivent la même règle que l'instantané", async ({ page }) => {
    const chunks = await monter(page, {});
    // characterData dans la zone, nœud ajouté hors zone, saisie tapée dans la zone.
    await page.evaluate(() => {
      (document.querySelector(".clair")!.firstChild as Text).data = "Commande 4522";
      document.querySelector(".voisine")!.append(" et Paul Durand");
    });
    await page.fill(".saisie", "nouveau-secret");
    await vider(page, chunks, 2);

    const incrementaux = chunks.flat().filter((e) => e.type === 3); // IncrementalSnapshot
    const mutations = incrementaux.filter((e) => e.data.source === 0);
    const textes = mutations.flatMap((e) => e.data.texts ?? []).map((t) => t.value);
    const ajouts = mutations.flatMap((e) => e.data.adds ?? []).map((a) => a.node.textContent);
    expect(textes).toContain("Commande 4522");
    expect(ajouts).toContain(" ** **** ******");
    const saisies = incrementaux.filter((e) => e.data.source === 5).map((e) => e.data.text); // Input
    expect(saisies.length).toBeGreaterThan(0);
    for (const s of saisies) expect(s).toMatch(/^\**$/);
    expect(JSON.stringify(chunks)).not.toContain("Paul");
    expect(JSON.stringify(chunks)).not.toContain("nouveau-secret");
  });

  test("un sélecteur invalide est ignoré, avec un avertissement : la zone qu'il visait reste masquée", async ({
    page,
  }) => {
    const avertissements: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "warning") avertissements.push(m.text());
    });
    const chunks = await monter(page, { replayUnmask: "[data-rejeu-clair]]" });
    const racine = instantane(chunks);

    expect(avertissements.some((a) => a.startsWith("[mip-rum] replayUnmask ignoré"))).toBe(true);
    expect(texte(trouver(racine, "par-option"))).toBe("******* *** ******");
    // La classe réservée, elle, continue de valoir.
    expect(texte(trouver(racine, "clair"))).toBe("Commande 4521");
    expect(trouver(racine, "logo-masque").attributes?.rr_width).toBe("20px");
  });
});

// `closest()` et le combinateur descendant s'arrêtent à la racine d'un shadow DOM
// et au document d'une iframe : une zone démasquée posée sur l'hôte ou sur
// l'iframe ne s'étend pas à leur contenu, qui reste masqué.
test("le démasquage ne traverse ni un shadow DOM ni une iframe", async ({ page }) => {
  await page.addInitScript(() => {
    // Le script d'init s'exécute aussi DANS l'iframe : sans ce garde, chaque
    // iframe en créerait une autre, et la page ne finirait jamais de charger.
    if (window !== window.top) return;
    document.addEventListener("DOMContentLoaded", () => {
      const hote = document.createElement("div");
      hote.className = "hote mip-rum-unmask";
      const p = document.createElement("p");
      p.textContent = "Texte du shadow";
      hote.attachShadow({ mode: "open" }).append(p);
      document.body.append(hote);
      const cadre = document.createElement("iframe");
      cadre.className = "cadre mip-rum-unmask";
      cadre.srcdoc = "<p>Texte de l'iframe</p>";
      document.body.append(cadre);
    });
  });
  const chunks = await monter(page, {});
  // rrweb sérialise l'iframe à son chargement : selon l'ordre, dans l'instantané
  // ou dans un chunk suivant. On attend de l'avoir vue passer.
  await expect
    .poll(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      return JSON.stringify(chunks).includes("***** ** ********"); // « Texte de l'iframe »
    })
    .toBe(true);

  const fil = JSON.stringify(chunks);
  expect(fil).toContain("***** ** ******"); // « Texte du shadow »
  expect(fil).not.toContain("Texte du shadow");
  // Le NŒUD de texte de l'iframe est masqué. (Son attribut `srcdoc`, lui, part
  // tel quel : rrweb ne masque aucun attribut — limite connue, hors démasquage.)
  expect(fil).not.toContain('"textContent":"Texte de l');
});

// Chrome 80 à 87 ont CompressionStream — le rejeu y tourne — mais pas `:is()`.
// rrweb avale l'exception d'un `matches()` refusé et répond « non bloqué » : sans
// repli, un vieux navigateur enregistrerait TOUS les médias. On simule ce
// navigateur en refusant `:is(` dans matches() et closest().
test("navigateur sans :is() : le texte se démasque, les médias restent bloqués", async ({ page }) => {
  await page.addInitScript(() => {
    for (const nom of ["matches", "closest"] as const) {
      const original = Element.prototype[nom] as (s: string) => unknown;
      (Element.prototype as unknown as Record<string, unknown>)[nom] = function (this: Element, s: string) {
        if (s.includes(":is(")) throw new DOMException(`'${s}' is not a valid selector`, "SyntaxError");
        return original.call(this, s);
      };
    }
  });
  const chunks = await monter(page, {});
  const racine = instantane(chunks);

  expect(texte(trouver(racine, "clair"))).toBe("Commande 4521");
  expect(texte(trouver(racine, "voisine"))).toBe("****** ******");
  expect(trouver(racine, "logo-clair").attributes?.rr_width).toBe("20px");
  expect(trouver(racine, "logo-clair").attributes?.src).toBeUndefined();
  expect(trouver(racine, "logo-masque").attributes?.rr_width).toBe("20px");
});

test("niveau « media » : le texte est en clair partout, les médias se démasquent zone par zone", async ({
  page,
}) => {
  const chunks = await monter(page, { replayMask: "media" });
  const racine = instantane(chunks);

  expect(texte(trouver(racine, "voisine"))).toBe("Jeanne Martin");
  expect(trouver(racine, "logo-clair").attributes?.src).toBe(`${ORIGINE}/logo.svg`);
  expect(trouver(racine, "logo-masque").attributes?.rr_width).toBe("20px");
  expect(trouver(racine, "saisie").attributes?.value).toBe("**********");
});
