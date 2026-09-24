// PS2 — Les capteurs (plan § 8.2), premier bloc de « Ce qu'il contient ». Extension
// navigateur à gauche, SDK embarqué à droite ; sous chacun, dans cet ordre : une
// phrase en français courant pour un lecteur non technique, les spécifications qui
// situent le capteur sur le marché, puis à qui il s'adresse avec son point fort et
// sa limite. Sous les deux cartes, les agents côté serveur.
//
// Titres : la partie porte le `h2` (Partie.tsx), ce bloc le `h3`, chaque carte un
// `h4` et ses rubriques un `h5`. Texte de moins de 18 px en `ink-soft`, jamais
// `ink-faint` (§ 3.9 : ≈ 2,8:1 en clair).
//
// Le contenu n'est pas du marketing : il vient de docs/CADRAGE_EXTENSION.md
// (registre domaine→app, MV3, cible poste géré, non publié au store),
// docs/LIMITES.md (ce qui manque, assumé) et docs/OFFRE.md (positionnement — document
// commercial hors dépôt, cf. docs/DOCUMENTS-HORS-DEPOT.md).
// Les versions sont celles des paquets (tests/unit/specs.test.ts les compare au
// manifeste de l'extension et au package.json de React Native) ; les réserves
// viennent du document de couverture (C1, C10 ; C5, C6 pour le côté serveur).
// Rendu entièrement côté serveur, aucun JS envoyé au navigateur.
import { ICON_PATHS, Icon, type IconName } from "@/components/icons";
import { SousPartie } from "@/components/presentation/SousPartie";
import { SDK_GZIP_KO, SDK_POIDS_TEXTE, koTexte } from "@/lib/sdk-poids";
import { EXT_VERSION } from "@/lib/specs";
import { RN_VERSION } from "@/lib/versions";

type Capteur = {
  n: string;
  icon: IconName;
  titre: string;
  accroche: string;
  /** Étapes du chemin de la mesure, du poste du visiteur jusqu'à la console. */
  flux: string[];
  specs: { k: string; v: string }[];
  pourQui: string[];
  fort: string;
  limite: string;
};

const CAPTEURS: Capteur[] = [
  {
    n: "01",
    icon: "grid",
    titre: "Extension navigateur",
    accroche: "Sans toucher au site",
    flux: ["Poste géré", "Extension MV3", "OTLP/HTTP", "Console"],
    specs: [
      { k: "Déploiement", v: "Politique Chrome / Edge, ou sideload" },
      { k: "Intégration", v: "Aucune — le site n'est pas modifié" },
      { k: "Portée", v: "Registre domaine → app, jamais <all_urls>" },
      { k: "Périmètre", v: "Chrome / Edge, Manifest V3" },
      { k: "Moteur", v: "Recharge le même SDK, même pipeline" },
      { k: "Version", v: `${EXT_VERSION}, non publiée au Chrome Web Store` },
    ],
    pourQui: [
      "Usage interne : parc de postes gérés, applications métier",
      "Audit et avant-vente : mesurer un site qu'on ne contrôle pas",
    ],
    fort: "Zéro ligne de code chez le client — l'IT le déploie par politique d'entreprise.",
    limite:
      "Ne voit que les postes équipés. Pas le grand public tant que l'extension n'est pas publiée au Chrome Web Store ; Firefox hors périmètre.",
  },
  {
    n: "02",
    icon: "logs",
    titre: "SDK embarqué",
    accroche: "Une balise dans la page",
    flux: ["Visiteur", `SDK ${koTexte(SDK_GZIP_KO)} ko`, "OTLP/HTTP", "Console"],
    specs: [
      { k: "Déploiement", v: `Une balise <script>, ${SDK_POIDS_TEXTE}` },
      { k: "Intégration", v: "Une ligne d'init, côté développeur" },
      { k: "Portée", v: "Tout le trafic réel, échantillonnable" },
      { k: "Capture", v: "Vitals, erreurs, fetch/XHR, replay opt-in" },
      { k: "Sur le fil", v: "OTLP/HTTP JSON, lisible au DevTools" },
    ],
    pourQui: [
      "Monitoring de masse : trafic public, portails, e-commerce",
      // Node ET FastAPI, comme la ligne « Côté serveur » sous les cartes (C5, C6).
      "Corrélation front → back par traceparent (un saut, Node ou FastAPI)",
    ],
    fort: "Atteint tout le trafic public, bien au-delà du parc interne — moins les visiteurs qui refusent la mesure (DNT et GPC honorés par défaut) et ceux qu'un bloqueur arrête.",
    // Texte exact du plan (PS2). « ni un simulateur » : C1 (« Aucun appareil, aucun
    // simulateur, aucun bundle Metro »), RUM_PARITY_STATUS.md:169.
    limite: `Demande une mise en production côté client. Web ; React Native en paquet privé (v${RN_VERSION}), jamais exécuté sur un appareil ni un simulateur ; pas de SDK iOS ou Android natif.`,
  },
];

/** Le chemin de la mesure, en pastilles reliées. Les flèches dérivent doucement
 *  pour donner le sens de lecture ; l'animation se coupe en reduced-motion. */
function Flux({ etapes }: { etapes: string[] }) {
  return (
    <ol className="mip-flux flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-lg border border-line/70 bg-app/50 px-3 py-2.5">
      {etapes.map((e, i) => (
        <li key={e} className="flex items-center gap-1.5">
          {i > 0 && (
            <span
              aria-hidden
              className="mip-fleche text-accent/70"
              style={{ animationDelay: `${i * 0.18}s` }}
            >
              →
            </span>
          )}
          <span className="whitespace-nowrap rounded-md bg-panel px-2 py-1 font-mono text-[10.5px] text-ink-soft ring-1 ring-line">
            {e}
          </span>
        </li>
      ))}
    </ol>
  );
}

function CarteCapteur({ c }: { c: Capteur }) {
  return (
    <article className="mip-carte group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/80 p-6 shadow-card backdrop-blur-sm transition duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-pop">
      {/* filet dégradé en haut de carte, révélé au survol */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent opacity-40 transition-opacity duration-300 group-hover:opacity-100"
      />

      <header className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
          <Icon paths={ICON_PATHS[c.icon]} className="h-5 w-5 text-white" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            {/* accent-ink et non accent : l'orange de marque ne tient que 2,3:1 en texte (F01). */}
            <span className="font-mono text-[11px] font-bold text-accent-ink">{c.n}</span>
            <h4 className="text-lg font-bold tracking-tight text-ink">{c.titre}</h4>
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">
            {c.accroche}
          </p>
        </div>
      </header>

      <div className="mt-5">
        <Flux etapes={c.flux} />
      </div>

      {/* les spécifications qui le situent */}
      <div className="mt-6">
        <h5 className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft">
          Spécifications
        </h5>
        <dl className="mt-2 divide-y divide-line/70">
          {c.specs.map((s) => (
            <div key={s.k} className="flex flex-wrap items-baseline gap-x-3 py-2">
              <dt className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                {s.k}
              </dt>
              <dd className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-ink-soft">
                {s.v}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 3 — à qui ça s'adresse, ce qu'il vaut, ce qu'il ne fait pas */}
      <div className="mt-6 flex flex-1 flex-col">
        <h5 className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft">
          À qui ça s&apos;adresse
        </h5>
        <ul className="mt-2 space-y-1.5">
          {c.pourQui.map((p) => (
            <li key={p} className="flex gap-2 text-[13px] leading-relaxed text-ink-soft">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-perf" />
              {p}
            </li>
          ))}
        </ul>

        {/* mt-auto : les deux cartes n'ont pas la même hauteur de texte, ce
            couple se cale donc en bas pour s'aligner d'une carte à l'autre. */}
        <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-2">
          <p className="rounded-lg border border-good/30 bg-good/5 p-3 text-[12.5px] leading-relaxed text-ink-soft">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-good-ink">
              Point fort
            </span>
            {c.fort}
          </p>
          <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-[12.5px] leading-relaxed text-ink-soft">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-warn-ink">
              Limite assumée
            </span>
            {c.limite}
          </p>
        </div>
      </div>
    </article>
  );
}

const CODE = "rounded bg-app/70 px-1.5 py-0.5 font-mono text-[12.5px] text-ink";

export function Capteurs() {
  return (
    <SousPartie
      id="contient-capteurs"
      surtitre="Deux points d'entrée"
      titre="Extension navigateur ou SDK embarqué"
      chapeau={
        <>
          Même moteur de collecte, même console. Chrome et Edge pour l&apos;extension ; une balise{" "}
          <code className={CODE}>{"<script>"}</code> pour le SDK, sur n&apos;importe quel site.
        </>
      }
    >
      <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-2">
        {CAPTEURS.map((c) => (
          <CarteCapteur key={c.n} c={c} />
        ))}
      </div>

      {/* Ce qui réunit les deux — la raison pour laquelle ce n'est pas deux produits.
          « pages lentes » est devenu « Pages » (F09) ; le filtre est la dimension
          `source` du contrat, libellée « Source de collecte » (lib/query-contract.ts). */}
      <p className="mt-6 rounded-xl border border-line bg-panel/60 px-5 py-4 text-sm leading-relaxed text-ink-soft backdrop-blur-sm">
        <span className="font-semibold text-ink">Même pipeline, même console.</span> Les deux capteurs
        écrivent avec le même identifiant d&apos;application ; un attribut{" "}
        <code className={CODE}>collection_source</code> distingue l&apos;extension du SDK. Sessions,
        pages, erreurs et alertes fonctionnent sur les deux, et le filtre « Source de collecte » les
        compare l&apos;un à l&apos;autre.
      </p>

      {/* Texte exact du plan (PS2). Sources : C5, C6 (RUM_PARITY_STATUS.md:173-174) —
          un seul saut de trace, ni propagation d'un service à l'autre. */}
      <p className="mt-3 text-sm leading-relaxed text-ink-soft" data-testid="capteurs-serveur">
        Côté serveur : un agent Node (<code className={CODE}>packages/agent-node</code>) et un middleware
        FastAPI (<code className={CODE}>examples/integrations/fastapi</code>) relient un appel du navigateur à son
        exécution serveur, sur un seul saut.
      </p>
    </SousPartie>
  );
}
