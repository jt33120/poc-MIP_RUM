// Quatrième section de la vitrine : où en est le POC face aux critères d'un
// outil de RUM sérieux. Un tableau cible/réel d'abord — c'est lui qui dit à
// quel point on répond au cahier des charges — puis la liste de ce qui manque.
//
// Chaque ligne est VÉRIFIÉE dans le dépôt, pas reprise d'un document de
// cadrage : plusieurs affirmations de docs/MARKET_SCAN_BMAD.md (juillet) sont
// périmées, et deux lignes de la version précédente de cette section étaient
// fausses — la purge de rétention et le comptage de volume sont codés mais
// jamais déclenchés en production, faute d'authentification du planificateur.
// Sources : le code, docs/LIMITES.md, docs/RAPPORT_CLIENT.md, docs/INTEGRATION.md.
import { ICON_PATHS, Icon } from "@/components/icons";
import { fmtDate } from "@/lib/format";
import { dernierPassagePlanifie } from "@/lib/queries-planifie";

type Statut = "atteint" | "partiel" | "manque" | "non-mesure";

const LIBELLE: Record<Statut, string> = {
  atteint: "Atteint",
  partiel: "Partiel",
  manque: "Non atteint",
  "non-mesure": "Non mesuré",
};

const TON: Record<Statut, string> = {
  atteint: "border-good/40 bg-good/10 text-good",
  partiel: "border-warn/40 bg-warn/10 text-warn",
  manque: "border-bad/40 bg-bad/10 text-bad",
  "non-mesure": "border-line bg-panel2 text-ink-faint",
};

/** Les critères d'un RUM sérieux, la cible visée, et où on en est vraiment. */
const CRITERES: { c: string; cible: string; reel: string; s: Statut }[] = [
  {
    c: "Poids du capteur",
    cible: "≤ 35 ko gzip (budget du build)",
    // Le chiffre est mesuré (gzip du bundle publié). La comparaison au marché a
    // été retirée : elle venait d'une note interne sans source, et le poids d'un
    // SDK concurrent dépend de sa version et des modules activés — invérifiable
    // en l'état, donc pas affichable comme un fait.
    reel: "12,0 ko gzip, mesuré sur le bundle publié",
    s: "atteint",
  },
  {
    c: "Seuils Core Web Vitals",
    cible: "Barème Google",
    reel: "LCP 2,5 / 4 s · INP 200 / 500 ms · CLS 0,1 / 0,25",
    s: "atteint",
  },
  {
    c: "Agrégation",
    cible: "p75, comme l'exige le standard CWV",
    reel: "p75 par route et par appareil, distribution complète",
    s: "atteint",
  },
  {
    c: "Donnée identifiante",
    cible: "Aucune adresse IP stockée",
    reel: "Géolocalisation par fuseau, scrub PII côté client et serveur",
    s: "atteint",
  },
  {
    c: "Format sur le fil",
    cible: "OTLP/HTTP standard, backend remplaçable",
    reel: "OTLP JSON valide et lisible au DevTools, mais sans parentSpanId, kind ni status",
    s: "partiel",
  },
  {
    c: "Masquage du replay",
    cible: "Saisies, texte et médias masqués par défaut (standard 2026)",
    reel: "Saisies masquées et blocs exclus ; texte et médias non masqués",
    s: "partiel",
  },
  {
    c: "Latence d'alerte",
    cible: "5 minutes",
    reel: "60 minutes — cadence réduite pour tenir dans le quota d'exécution",
    s: "manque",
  },
  {
    c: "Volumétrie",
    cible: "10⁸ événements et au-delà (ClickHouse)",
    reel: "~10⁶–10⁷ sur PostgreSQL avant que les percentiles ne s'effondrent",
    s: "manque",
  },
  {
    c: "Débit d'ingestion",
    cible: "Mesuré en conditions cloud réelles",
    reel: "~4 000 événements/seconde, sur un poste de développement uniquement",
    s: "non-mesure",
  },
];

type Gravite = "bloquant" | "limite";

/** Ce qui manque, en liste simple. */
const A_FAIRE: { t: string; d: string; g: Gravite }[] = [
  {
    t: "Clé d'ingestion à rendre obligatoire",
    g: "bloquant",
    d: "L'authentification par clé d'API existe application par application, mais le refus n'est pas encore le comportement par défaut. Le passage en fermé-par-défaut précède toute mise en service client.",
  },
  {
    t: "Filet d'isolation en base à activer",
    g: "bloquant",
    d: "Les policies de cloisonnement existent et filtrent bien par application, mais la connexion de production utilise un rôle propriétaire qui les contourne. L'isolation repose aujourd'hui entièrement sur le code, sans filet au niveau du moteur.",
  },
  {
    t: "Pas de couche organisation",
    g: "bloquant",
    d: "Le cloisonnement s'arrête à l'application. Aucun niveau au-dessus pour regrouper les applications d'un même client, ni facturer à ce niveau.",
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

/**
 * La rétention et le déclencheur périodique sont les deux seuls points dont
 * l'état CHANGE sans qu'on touche au code : il suffit que le secret du
 * planificateur soit posé côté hébergeur. Ils sont donc DÉDUITS d'une preuve en
 * base — la dernière exécution aboutie — plutôt qu'écrits en dur. C'est
 * exactement là que la version précédente de cette section a menti : elle
 * affirmait « jamais déclenchée » bien après que le secret ait été posé.
 */
function volatiles(dernier: Date | null): {
  retention: { c: string; cible: string; reel: string; s: Statut };
  planif: { t: string; d: string; g: Gravite } | null;
} {
  const frais = dernier != null && Date.now() - dernier.getTime() < 48 * 3600 * 1000;

  if (frais) {
    return {
      retention: {
        c: "Rétention",
        cible: "Purge à 30 jours, réglable par client",
        reel: `Purge par client active — dernier passage le ${fmtDate(dernier!)}`,
        s: "atteint",
      },
      planif: null, // plus un manque : le bloc s'exécute
    };
  }

  const jamais = dernier == null;
  return {
    retention: {
      c: "Rétention",
      cible: "Purge à 30 jours, réglable par client",
      reel: jamais
        ? "Codée et testée ; aucune exécution constatée en production"
        : `Codée et testée ; dernier passage le ${fmtDate(dernier!)}, plus de 48 h`,
      s: jamais ? "manque" : "partiel",
    },
    planif: {
      t: "Tâches planifiées à relancer",
      g: "bloquant",
      d: jamais
        ? "Évaluation des alertes, SLO, sondes uptime, purge de rétention et comptage du volume par client partagent le même déclencheur périodique. Tout ce bloc est écrit et testé ; aucune exécution n'a encore abouti en production."
        : "Le déclencheur périodique existe et a déjà abouti, mais pas depuis plus de 48 h — alertes, SLO, sondes uptime, purge et comptage du volume sont donc à l'arrêt.",
    },
  };
}

export async function Etat() {
  const { retention, planif } = volatiles(await dernierPassagePlanifie());
  // La rétention se range après le masquage du replay, à sa place d'origine dans
  // la progression « mesure → restitution → exploitation ».
  const criteres = [...CRITERES.slice(0, 6), retention, ...CRITERES.slice(6)];
  const aFaire = planif ? [planif, ...A_FAIRE] : A_FAIRE;
  const compte = (s: Statut) => criteres.filter((c) => c.s === s).length;

  return (
    <section id="etat" className="mip-bande-claire scroll-mt-16 border-y border-line">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <header className="max-w-2xl">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-perf">
            L&apos;écart, sans le maquiller
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Face aux critères d&apos;un vrai RUM
          </h2>
          <p className="mt-3 leading-relaxed text-ink-soft">
            Ce qu&apos;un outil de Real User Monitoring doit tenir, et où en est ce POC sur chaque
            point. Les chiffres viennent du code et des mesures, pas d&apos;un document
            d&apos;intention.
          </p>
          <p className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-good/40 bg-good/10 px-3 py-1 text-good">
              {compte("atteint")} atteints
            </span>
            <span className="rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-warn">
              {compte("partiel")} partiels
            </span>
            <span className="rounded-full border border-bad/40 bg-bad/10 px-3 py-1 text-bad">
              {compte("manque")} non atteints
            </span>
            <span className="rounded-full border border-line bg-panel2 px-3 py-1 text-ink-faint">
              {compte("non-mesure")} non mesuré
            </span>
          </p>
        </header>

        {/* Tableau cible / réel ------------------------------------------- */}
        <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-panel">
          {/* En-têtes : desktop seulement — en mobile chaque cellule porte son
              propre libellé, une ligne de titres n'aurait rien à surmonter. */}
          <div className="hidden border-b border-line bg-panel2 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint lg:grid lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,7rem)] lg:gap-5">
            <span>Critère</span>
            <span>Cible</span>
            <span>Réel</span>
            <span className="text-right">Statut</span>
          </div>

          <ul className="divide-y divide-line">
            {criteres.map((c) => (
              <li
                key={c.c}
                className="grid gap-x-5 gap-y-2 px-5 py-4 lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,7rem)] lg:items-baseline"
              >
                <span className="text-sm font-semibold text-ink">{c.c}</span>

                <span className="text-[13px] leading-relaxed text-ink-soft">
                  <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint lg:hidden">
                    Cible
                  </span>
                  {c.cible}
                </span>

                <span className="text-[13px] leading-relaxed text-ink">
                  <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint lg:hidden">
                    Réel
                  </span>
                  {c.reel}
                </span>

                <span className="lg:text-right">
                  <span
                    className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${TON[c.s]}`}
                  >
                    {LIBELLE[c.s]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Ce qui manque, en liste simple --------------------------------- */}
        <div className="mt-10">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-warn">
            <Icon paths={ICON_PATHS.alert} className="h-4 w-4" strokeWidth={2.4} />
            Ce qui manque
          </h3>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {aFaire.map((a) => (
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
                        a.g === "bloquant" ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn"
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

        <p className="mt-8 rounded-xl border border-line bg-panel px-5 py-4 text-sm leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Ce que ça veut dire.</span> La chaîne de mesure
          — collecte, ingestion, restitution — tient les critères de fond : poids, seuils,
          percentile, anonymat. Ce qui manque relève de l&apos;exploitation, pas de la conception :
          brancher le déclencheur des tâches planifiées, fermer l&apos;ingestion par défaut, activer
          le filet d&apos;isolation en base, et changer de moteur de stockage avant la montée en
          volume.
        </p>
      </div>
    </section>
  );
}
