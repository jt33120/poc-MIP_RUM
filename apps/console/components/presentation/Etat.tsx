// Quatrième section de la vitrine : l'état réel du POC, en deux colonnes.
// À gauche ce qui tourne, à droite ce qui manque — y compris ce qui empêche de
// vendre. Une vitrine de POC qui ne montre que la colonne de gauche se fait
// démonter au premier rendez-vous technique ; celle-ci donne l'écart d'avance.
//
// Chaque ligne a été VÉRIFIÉE dans le dépôt, pas reprise d'un document de
// cadrage — plusieurs affirmations de docs/MARKET_SCAN_BMAD.md (juillet) sont
// devenues fausses depuis : les policies RLS ne sont plus en `using(true)`, et
// le comptage de volume par client existe. Sources : docs/LIMITES.md,
// _bmad-output/planning-artifacts/CHANTIERS.md, et le code lui-même.
import { ICON_PATHS, Icon } from "@/components/icons";

/** Ce qui tourne aujourd'hui, vérifié dans le code. */
const OPERATIONNEL: { t: string; d: string }[] = [
  {
    t: "Deux capteurs, un pipeline",
    d: "SDK ~12 ko et extension Chrome/Edge MV3 écrivent le même OTLP, avec le même identifiant d'application.",
  },
  {
    t: "Core Web Vitals au p75",
    d: "LCP, INP, CLS, FCP, TTFB par route et par appareil, avec la distribution derrière la moyenne.",
  },
  {
    t: "Erreurs groupées par signature",
    d: "Regroupement par cause, triage résolu/ignoré/rouvert, détection des régressions.",
  },
  {
    t: "Sessions, parcours, replay",
    d: "Timeline d'une session réelle ; replay rrweb en option par app, saisies masquées par défaut.",
  },
  {
    t: "Tracing front → back",
    d: "Propagation traceparent jusqu'au middleware FastAPI, un saut, corrélé par trace_id.",
  },
  {
    t: "Multi-utilisateur cloisonné",
    d: "Rôles admin/viewer scopés par application, SSO OIDC, journal d'audit de toute action sensible.",
  },
  {
    t: "RGPD par construction",
    d: "Aucune adresse IP stockée (géo par fuseau), scrub PII côté client ET serveur, rétention 30 jours.",
  },
  {
    t: "Comptage du volume par client",
    d: "Événements, sessions et erreurs agrégés chaque jour, quota par application, écran d'administration.",
  },
  {
    t: "Intégrable",
    d: "API publique v1 documentée en OpenAPI, API de lecture par jeton, conteneur d'ingestion prouvé en CI.",
  },
];

type Gravite = "bloquant" | "limite";

/** Ce qui manque, et ce que ça empêche concrètement. */
const A_FAIRE: { t: string; d: string; g: Gravite }[] = [
  {
    t: "Alerting à remettre en service",
    g: "bloquant",
    d: "Le moteur d'alerte, les SLO et les sondes uptime existent et sont testés, mais leur déclenchement périodique reste à câbler sur cet environnement. Tant que ce n'est pas fait, le produit alerte sur le papier, pas en continu.",
  },
  {
    t: "Clé d'ingestion à rendre obligatoire",
    g: "bloquant",
    d: "L'authentification par clé d'API existe application par application, mais le refus n'est pas encore le comportement par défaut. Le passage en fermé-par-défaut précède toute mise en service client.",
  },
  {
    t: "Filet d'isolation en base à activer",
    g: "bloquant",
    d: "Les policies de cloisonnement existent et filtrent bien par application, mais la connexion de production utilise un rôle propriétaire qui les contourne. L'isolation repose donc aujourd'hui entièrement sur le code, sans filet au niveau du moteur.",
  },
  {
    t: "Pas de couche organisation",
    g: "bloquant",
    d: "Le cloisonnement s'arrête à l'application. Aucun niveau au-dessus pour regrouper les applications d'un même client, ni facturer à ce niveau.",
  },
  {
    t: "Stockage qui ne tiendra pas l'échelle",
    g: "bloquant",
    d: "PostgreSQL tient jusqu'à quelques millions d'événements ; au-delà, les calculs de percentile s'effondrent. Le chemin ClickHouse est prouvé en local, jamais déployé.",
  },
  {
    t: "Charge réelle inconnue",
    g: "limite",
    d: "~4 000 événements/seconde mesurés sur un poste, jamais en conditions cloud. Le comportement sous vraie charge reste une hypothèse.",
  },
  {
    t: "SDK non distribuables",
    g: "limite",
    d: "Les paquets sont privés : l'intégration se fait par copie de fichier, pas par une installation npm chez le client.",
  },
  {
    t: "Console non conteneurisée",
    g: "limite",
    d: "L'ingestion a son image, pas la console. L'argument « souverain, déployable chez vous » n'est donc pas livrable de bout en bout.",
  },
  {
    t: "Rien de certifié, mentions légales à compléter",
    g: "limite",
    d: "Aucune certification (SOC 2, ISO 27001, CSPN) — souvent éliminatoire en appel d'offres grand compte — et l'identité légale reste à renseigner dans les CGU/CGV/DPA.",
  },
];

function Coche() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good/10"
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3 text-good" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8.5 6.5 12 13 4.5" />
      </svg>
    </span>
  );
}

export function Etat() {
  return (
    <section id="etat" className="mip-bande-claire scroll-mt-16 border-y border-line">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <header className="max-w-2xl">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-perf">
            L&apos;écart, sans le maquiller
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Ce qui tourne, ce qui manque
          </h2>
          <p className="mt-3 leading-relaxed text-ink-soft">
            C&apos;est un POC, et il est utile de dire lequel. À gauche ce qui fonctionne en
            production aujourd&apos;hui ; à droite ce qui reste entre cet état et un produit
            vendable. Chaque ligne est vérifiée dans le dépôt.
          </p>
        </header>

        <div className="mt-10 grid gap-6 lg:grid-cols-2 lg:gap-8">
          {/* Opérationnel ------------------------------------------------- */}
          <div className="rounded-2xl border border-good/30 bg-good/[0.04] p-6">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-good">
              <Icon paths={ICON_PATHS.activity} className="h-4 w-4" strokeWidth={2.4} />
              Opérationnel
            </h3>
            <ul className="mt-5 flex flex-col gap-4">
              {OPERATIONNEL.map((o) => (
                <li key={o.t} className="flex gap-3">
                  <Coche />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{o.t}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
                      {o.d}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* À faire ------------------------------------------------------ */}
          <div className="rounded-2xl border border-warn/30 bg-warn/[0.04] p-6">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-warn">
              <Icon paths={ICON_PATHS.alert} className="h-4 w-4" strokeWidth={2.4} />
              À faire
            </h3>
            <ul className="mt-5 flex flex-col gap-4">
              {A_FAIRE.map((a) => (
                <li key={a.t} className="flex gap-3">
                  <span
                    aria-hidden
                    className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${
                      a.g === "bloquant" ? "bg-bad" : "bg-warn"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="text-sm font-semibold text-ink">{a.t}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
                          a.g === "bloquant"
                            ? "bg-bad/10 text-bad"
                            : "bg-warn/10 text-warn"
                        }`}
                      >
                        {a.g === "bloquant" ? "bloque la vente" : "limite connue"}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
                      {a.d}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-6 rounded-xl border border-line bg-panel px-5 py-4 text-sm leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Ce que ça veut dire.</span> La chaîne de mesure
          — collecte, ingestion, restitution — est complète et tourne sur des données réelles. Ce
          qui manque tient à l&apos;exploitation : fermer l&apos;ingestion par défaut, activer le filet
          d&apos;isolation en base, câbler le déclenchement des alertes, et changer de moteur de
          stockage avant la montée en volume. Aucun de ces points n&apos;est un inconnu de recherche&nbsp;; tous
          sont chiffrés dans le découpage en chantiers du dépôt.
        </p>
      </div>
    </section>
  );
}
