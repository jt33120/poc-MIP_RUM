// Vitrine des composants — F07 : `Cascade` et `DetailPanel` (plan § 4.2, § 3.5).
//
// Données FIXES, comme le reste de la vitrine : aucune lecture en base. Les tons
// montrés ne sont jamais inventés — un verdict n'apparaît que là où un seuil nommé
// existe (INP d'une action, `lib/rating.ts`) ; une ressource ou une tâche longue n'a
// pas de seuil publié, elle reste « neutre » (R-S). L'erreur, elle, est un fait.
//
// Le panneau s'ouvre par l'URL (`?panel=route:<route>`), depuis la liste ci-dessous :
// c'est la matière de tests/e2e/panneau.spec.ts (clavier, plein écran à 390 px).
import Link from "next/link";
import type { ReactNode } from "react";
import { Cascade, type ElementCascade, type MarqueurCascade, type PisteCascade, type TonCascade } from "@/components/charts/Cascade";
import { Figure } from "@/components/charts/Figure";
import { formater } from "@/lib/fmt-ids";
import { RATING_LABEL, rating2026, type Rating } from "@/lib/rating";
import { ecrirePanel } from "@/lib/view-state";
import { PanneauOuvert, type PanneauDemo } from "./panneau-ouvert";

const CHEMIN = "/admin/composants";

// ─────────────────────────────── Une trace ───────────────────────────────

const PISTES_TRACE: PisteCascade[] = [
  { cle: "navigateur", libelle: "Navigateur" },
  { cle: "serveur", libelle: "Serveur" },
  { cle: "base", libelle: "Base de données" },
  { cle: "interne", libelle: "Interne" },
];

/** Un appel en échec : 503 côté serveur, un verrou en base, un sous-appel en 404. */
const TRACE: ElementCascade[] = [
  { id: "f1", piste: "navigateur", libelle: "POST /api/panier", debutMs: 0, dureeMs: 842, ton: "erreur", detail: "HTTP 503" },
  { id: "b1", piste: "serveur", libelle: "POST /api/panier", debutMs: 38, dureeMs: 790, ton: "erreur", parentId: "f1", detail: "HTTP 503" },
  { id: "d1", piste: "base", libelle: "SELECT panier_lignes", debutMs: 52, dureeMs: 0.4, ton: "neutre", parentId: "b1" },
  { id: "d2", piste: "base", libelle: "UPDATE stock (verrou)", debutMs: 60, dureeMs: 702, ton: "neutre", parentId: "b1" },
  { id: "i1", piste: "interne", libelle: "GET /tarifs/promo", debutMs: 771, dureeMs: 41, ton: "warn", parentId: "b1", detail: "HTTP 404" },
];

// ─────────────────────────────── Une vue ───────────────────────────────

const PISTES_VUE: PisteCascade[] = [
  { cle: "actions", libelle: "Actions" },
  { cle: "erreurs", libelle: "Erreurs" },
  { cle: "ressources", libelle: "Ressources" },
  { cle: "taches", libelle: "Tâches longues" },
];

const TON_DU_VERDICT: Record<Rating, TonCascade> = { good: "good", "needs-improvement": "warn", poor: "poor" };

/** Une action porte son INP : là, et là seulement, un seuil nommé donne un verdict. */
function action(id: string, libelle: string, debutMs: number, inp: number): ElementCascade {
  return {
    id,
    piste: "actions",
    libelle,
    debutMs,
    dureeMs: inp,
    ton: TON_DU_VERDICT[rating2026("INP", inp) ?? "good"],
    detail: `INP ${formater("ms", inp)}`,
  };
}

const VUE: ElementCascade[] = [
  { id: "r1", piste: "ressources", libelle: "app.3f2c.js", debutMs: 120, dureeMs: 540, ton: "neutre", detail: "173 Ko" },
  { id: "r2", piste: "ressources", libelle: "hero.webp", debutMs: 410, dureeMs: 1490, ton: "neutre", detail: "412 Ko" },
  { id: "r3", piste: "ressources", libelle: "GET /api/recommandations", debutMs: 2300, dureeMs: 880, ton: "neutre" },
  { id: "t1", piste: "taches", libelle: "Tâche longue (script)", debutMs: 700, dureeMs: 310, ton: "neutre" },
  { id: "t2", piste: "taches", libelle: "Tâche longue (rendu)", debutMs: 2950, dureeMs: 180, ton: "neutre" },
  action("a1", "Clic « Menu »", 1600, 96),
  action("a2", "Clic « Ajouter au panier »", 3400, 380),
  action("a3", "Clic « Payer »", 4700, 640),
  { id: "e1", piste: "erreurs", libelle: "TypeError: prix is undefined", debutMs: 3420, dureeMs: null, ton: "erreur" },
];

const REPERES: MarqueurCascade[] = [
  { t: 1180, libelle: "FCP", vital: "FCP", valeur: 1180 },
  { t: 2710, libelle: "LCP", vital: "LCP", valeur: 2710 },
  { t: 3000, libelle: "Chargement" },
];

const PARTIEL = "ressources de plus de 300 ms seulement, 20 par vue";

// ─────────────────────────────── Le panneau ───────────────────────────────

const ROUTES = [
  { route: "/checkout", lcp: 3420, n: 412, sessions: 388, erreurs: 7 as number | null, navigateur: "Chrome 126" },
  { route: "/panier", lcp: 2710, n: 1204, sessions: 1102, erreurs: null, navigateur: "Safari 17" },
  { route: "/produit/[id]", lcp: 2240, n: 3980, sessions: 3515, erreurs: 0, navigateur: "Firefox 128" },
];

/** L'adresse du panneau d'une route : `panel=route:<route encodée>`, encodé à son tour dans l'URL. */
function lienPanneau(route: string): string {
  return `${CHEMIN}?${new URLSearchParams({ panel: ecrirePanel({ type: "route", id: route }) })}`;
}

function contenuDuPanneau(r: (typeof ROUTES)[number]): ReactNode {
  const verdict = rating2026("LCP", r.lcp);
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-soft">
        Plage de l&apos;écran : 24 h (20/09 14:00 → 21/09 14:00 UTC). Le panneau n&apos;a pas de fenêtre de temps
        propre : il lit celle de l&apos;écran.
      </p>
      <section id="panneau-vitals" className="space-y-1">
        <h3 className="text-sm font-semibold text-ink">Web Vitals</h3>
        <p className="text-sm text-ink-soft">
          LCP p75 {formater("ms", r.lcp)} sur {formater("count", r.n)} mesures
          {verdict ? ` — ${RATING_LABEL[verdict]}` : ""}.
        </p>
      </section>
      <Figure titre="Une vue type de la route" meta={<span>cascade réduite : l&apos;aperçu par piste seul</span>}>
        <Cascade totalMs={5200} pistes={PISTES_VUE} elements={VUE} marqueurs={REPERES} partiel={PARTIEL} hauteur="reduite" />
      </Figure>
      <section id="panneau-erreurs" className="space-y-1">
        <h3 className="text-sm font-semibold text-ink">Erreurs</h3>
        <p className="text-sm text-ink-soft">
          {r.erreurs == null
            ? "Compte inconnu : l'onglet l'écrit « (—) », jamais « (0) »."
            : `${formater("count", r.erreurs)} occurrence${r.erreurs > 1 ? "s" : ""} sur la plage.`}
        </p>
      </section>
      <section id="panneau-sessions" className="space-y-1">
        <h3 className="text-sm font-semibold text-ink">Sessions</h3>
        <p className="text-sm text-ink-soft">{formater("count", r.sessions)} sessions commencées ont vu cette route.</p>
      </section>
    </div>
  );
}

const PANNEAUX: PanneauDemo[] = ROUTES.map((r, i) => {
  const ici = lienPanneau(r.route);
  return {
    type: "route",
    id: r.route,
    titre: r.route,
    puces: [
      { label: "Appareil", valeur: "Tous" },
      { label: "Navigateur", valeur: r.navigateur },
      { label: "Pays estimé", valeur: "France", provenance: "géolocalisation IP" },
      { label: "Release", valeur: "1.4.2" },
    ],
    pageHref: `/pages?route=${encodeURIComponent(r.route)}`,
    precedentHref: i > 0 ? lienPanneau(ROUTES[i - 1].route) : null,
    suivantHref: i < ROUTES.length - 1 ? lienPanneau(ROUTES[i + 1].route) : null,
    onglets: [
      { cle: "vitals", libelle: "Web Vitals", compte: 3, href: `${ici}#panneau-vitals`, actif: true },
      { cle: "erreurs", libelle: "Erreurs", compte: r.erreurs, href: `${ici}#panneau-erreurs`, actif: false },
      { cle: "sessions", libelle: "Sessions", compte: r.sessions, href: `${ici}#panneau-sessions`, actif: false },
    ],
    contenu: contenuDuPanneau(r),
  };
});

// ─────────────────────────────── Mise en page ───────────────────────────────

function Bloc({ id, titre, sous, children }: { id: string; titre: string; sous: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-10 min-w-0" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`} className="text-base font-semibold text-ink">
        {titre}
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-soft">{sous}</p>
      {children}
    </section>
  );
}

export function SectionPanneau() {
  return (
    <>
      <Bloc
        id="cascade"
        titre="Cascade"
        sous="Axe horizontal partagé : la couleur dit la sévérité (jamais seule), la piste est écrite sous le libellé, « partiel » en tête, alternative intégrée."
      >
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <Figure titre="Trace : pistes, parent → enfant, statut 5xx et 4xx, segment sélectionné" id="cascade-trace">
            <Cascade totalMs={842} pistes={PISTES_TRACE} elements={TRACE} selection="d2" />
          </Figure>
          <Figure titre="Vue : repères FCP / LCP à verdict, instants, collecte partielle" id="cascade-vue">
            <Cascade totalMs={5200} pistes={PISTES_VUE} elements={VUE} marqueurs={REPERES} partiel={PARTIEL} />
          </Figure>
          <Figure titre="Hauteur réduite (dans un panneau) : l'aperçu par piste seul" id="cascade-reduite">
            <Cascade totalMs={5200} pistes={PISTES_VUE} elements={VUE} marqueurs={REPERES} hauteur="reduite" />
          </Figure>
          <Figure titre="Aucun élément" id="cascade-vide">
            <Cascade totalMs={0} pistes={PISTES_VUE} elements={[]} />
          </Figure>
        </div>
      </Bloc>

      <Bloc
        id="panneau"
        titre="DetailPanel"
        sous="Ouvert par l'URL (panel=route:…), sans JavaScript ; plein écran sous 1280 px, moitié de la zone de contenu au-delà. Clavier : Échap ferme, ↑ / ↓ parcourent la liste, le focus va au titre."
      >
        <ul className="card divide-y divide-line" data-testid="panneau-liste" aria-label="Routes de démonstration">
          {ROUTES.map((r) => (
            <li key={r.route}>
              <Link
                href={lienPanneau(r.route)}
                scroll={false}
                className="flex min-w-0 items-center gap-3 px-4 py-2.5 text-sm hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.route}</span>
                <span className="shrink-0 tabular-nums text-ink-soft">LCP p75 {formater("ms", r.lcp)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <PanneauOuvert fermerHref={CHEMIN} panneaux={PANNEAUX} />
      </Bloc>
    </>
  );
}
