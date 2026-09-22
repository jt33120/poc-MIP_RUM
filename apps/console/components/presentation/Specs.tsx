// Quatrième section de la vitrine : les SPÉCIFICATIONS du POC, en trois onglets
// — l'infrastructure, les mesures, l'écart au marché.
//
// POURQUOI TROIS ONGLETS. Cette section n'était qu'un tableau cible/réel. Il
// disait honnêtement OÙ ON EN EST, mais pas CE QU'ON A CODÉ : un lecteur y
// apprenait que l'hébergement est partiel sans jamais savoir combien de services
// tournent, ni ce que le capteur mesure. Les trois onglets répondent aux trois
// questions dans l'ordre où on se les pose : où ça tourne, ce que ça capte, ce
// que ça vaut face au marché.
//
// L'écart reste le troisième — pas parce qu'il compte moins, mais parce qu'il ne
// se comprend qu'une fois les deux premiers lus. Il n'est pas pour autant caché :
// son décompte (atteints / partiels / non atteints) est affiché EN TÊTE de
// section, hors des onglets, avant tout clic.
//
// SANS JAVASCRIPT. Les onglets sont trois boutons radio masqués et leurs
// étiquettes ; `peer-checked` fait le reste en CSS. La vitrine publique
// n'envoie donc toujours aucun script au navigateur, et le composant reste un
// Server Component qui lit la base.
//
// Le CONTENU des deux premiers onglets vit dans lib/specs.ts, où chaque ligne
// porte de quoi la contredire (fichier de preuve, marqueur d'absence, valeurs
// importées de lib/legal.ts). Ici, il n'y a que du rendu.
import { ICON_PATHS, Icon } from "@/components/icons";
import { fmtBorne } from "@/lib/format";
import { THRESHOLDS } from "@/lib/rating";
import { dernierPassagePlanifie, dernierTickScheduler } from "@/lib/queries-planifie";
import { CADENCE_TICK_MIN } from "@/lib/etat-latence";
import { latenceDepuis, volatiles, type Gravite } from "@/lib/etat-planifie";
import {
  ANGLES_MORTS,
  INFRA,
  MESURES,
  NOTE_NAVIGATEURS,
  mesuresNonCouvertes,
  type Statut,
} from "@/lib/specs";
import { SDK_BUDGET_KO, SDK_POIDS_TEXTE } from "@/lib/sdk-poids";

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

/** Pastille d'état, la même dans les trois onglets. */
function Etiquette({ s, texte }: { s: Statut; texte?: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${TON[s]}`}
    >
      {texte ?? LIBELLE[s]}
    </span>
  );
}

/** Les critères d'un RUM sérieux, la cible visée, et où on en est vraiment. */
const CRITERES: { c: string; cible: string; reel: string; s: Statut }[] = [
  {
    c: "Poids du capteur",
    cible: `≤ ${SDK_BUDGET_KO} ko gzip (budget du build)`,
    // Le chiffre est mesuré (gzip du bundle publié). La comparaison au marché a
    // été retirée : elle venait d'une note interne sans source, et le poids d'un
    // SDK concurrent dépend de sa version et des modules activés — invérifiable
    // en l'état, donc pas affichable comme un fait.
    reel: `${SDK_POIDS_TEXTE}, mesuré sur le bundle publié`,
    s: "atteint",
  },
  {
    c: "Seuils Core Web Vitals",
    cible: "Barème Google",
    // Lu dans lib/rating.ts, comme l'écran qui colore les valeurs : recopié à la
    // main, un seuil finit par diverger (c'est arrivé au glossaire).
    reel: (["LCP", "INP", "CLS"] as const)
      .map((n) => `${n} ${fmtBorne(n, THRESHOLDS[n][0])} / ${fmtBorne(n, THRESHOLDS[n][1])}`)
      .join(" · "),
    s: "atteint",
  },
  {
    c: "Agrégation",
    cible: "p75, comme l'exige le standard CWV",
    reel: "p75 par route et par appareil, et l'histogramme des mesures par tranche de valeur",
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
    // CE QUI A ÉTÉ ÉCRIT DE TRAVERS, ET CORRIGÉ LE MÊME JOUR. Cette ligne a
    // annoncé le matin du 09/09/2026 une trace « lisible par un collecteur
    // tiers ». La STRUCTURE avait bien été vérifiée — parenté, nature, issue —
    // mais pas le TEMPS : `realEmit` ouvre le span et le referme dans la foulée
    // (cf. otel.ts), si bien que début et fin tombent sur la même milliseconde.
    // La durée réelle ne vit que dans l'attribut propriétaire `http.duration_ms`.
    // Un collecteur tiers reçoit donc un arbre juste et une chronologie vide :
    // il dessine un waterfall PLAT. Vérifier la forme d'un span ne dit rien de
    // ce qu'il mesure.
    reel: "OTLP JSON dont la structure est vérifiée — parentSpanId, kind, status, trace enracinée sur la page vue. Mais les spans partent avec une durée nulle : un collecteur tiers dessine un waterfall plat. Vocabulaire encore partiellement propriétaire.",
    s: "partiel",
  },
  {
    c: "Masquage du replay",
    cible: "Saisies, texte et médias masqués par défaut (standard 2026)",
    // Vérifié le 09/09/2026 dans un Chromium réel, avec le bundle rrweb publié :
    // ni le texte de la page, ni la valeur d'un champ, ni les octets d'une image
    // ne survivent à l'enregistrement au niveau par défaut. Le niveau se règle
    // par application (`replayMask`), mais son DÉFAUT est le plus protecteur —
    // un masquage qu'il faut penser à activer n'en est pas un.
    reel: "Saisies, texte et médias masqués par défaut ; blocs marqués jamais capturés",
    s: "atteint",
  },
  {
    c: "Hébergement",
    cible: "Donnée ET traitement en UE, chez un hébergeur de droit européen",
    // Chaque moitié est vérifiée séparément. La base : docs/NEON_MIGRATION.md et
    // lib/legal.ts. La console : l'en-tête `x-vercel-id` d'une réponse NON mise en
    // cache, qui valait `iad1:iad1::iad1::…` (Washington) et vaut désormais
    // `iad1:iad1::fra1::…` — le troisième segment est la région d'exécution ; la
    // clé `regions` de apps/console/vercel.json l'a fixée à Francfort.
    // Le backend : projet Railway `mip-rum-backend`, services `ingest`,
    // `scheduler` et `mcp`, région `europe-west4-drams3a` (Amsterdam) — relevée
    // le 09/09/2026 dans `multiRegionConfig` des trois services, après leur
    // déplacement depuis `us-west2`. Cf. DEPLOY.md § 1 bis. `ingest` a été
    // supprimé le 21/09/2026 (docs/TOPOLOGIE_BACKEND.md) : restent `scheduler` et `mcp`.
    //
    // « Traitement en UE » est donc désormais VRAI ; « chez un hébergeur de
    // droit européen » reste faux. La ligne dit les deux, parce que ne dire que
    // la première moitié laisserait croire la seconde.
    reel: "Donnée et traitement en UE — Neon et Vercel à Francfort, Railway à Amsterdam ; mais trois fournisseurs de droit américain",
    s: "partiel",
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
    t: "Backend sur Railway, à migrer chez un hébergeur de droit européen",
    g: "bloquant",
    d: "Les travaux planifiés et le serveur MCP ont quitté la console : ce sont des services autonomes, sans framework, déployés sur Railway à Amsterdam depuis le 09/09/2026 ; la collecte, elle, reste une route de la console, sur Vercel à Francfort. Le calcul est donc en UE, au même titre que la donnée. Cela ne change RIEN à la souveraineté — Neon, Vercel et Railway sont trois sociétés de droit américain, et la résidence européenne des données n'est pas la souveraineté : ce point reste bloquant tant que l'hébergeur relève du droit américain, quelle que soit la région. Cible : base, console et backend chez un hébergeur de droit européen, qualifié SecNumCloud pour un acheteur public. Le backend y est prêt : il ne dépend que de Node et de PostgreSQL, et ses images se construisent depuis ce dépôt.",
  },
  {
    t: "SDK non distribuables",
    g: "limite",
    d: "Les paquets sont privés : l'intégration se fait par copie de fichier, pas par une installation npm chez le client.",
  },
  {
    t: "Console non conteneurisée",
    g: "limite",
    d: "Le backend a ses images (ingestion et serveur MCP), pas la console. L'argument « déployable chez vous » n'est donc pas livrable de bout en bout.",
  },
  {
    t: "Aucune certification, mentions légales à compléter",
    g: "limite",
    d: "Aucune certification (SOC 2, ISO 27001, CSPN) — souvent éliminatoire en appel d'offres grand compte — et l'identité légale reste à renseigner dans les CGU/CGV/DPA.",
  },
];

// ─────────────────────────────── les onglets ────────────────────────────────
// Trois radios masquées, trois étiquettes, trois panneaux — TOUS frères, parce
// que le sélecteur `peer-checked` de Tailwind repose sur le combinateur de
// fratrie (`~`) : un panneau imbriqué dans un conteneur ne serait jamais
// atteint. Le conteneur est en `flex-wrap` et les panneaux en `w-full`, ce qui
// les renvoie sous la rangée d'étiquettes.

/** Étiquette d'onglet. `p` est le nom du peer, `sel` sa classe active. */
function Onglet({
  id,
  titre,
  sous,
  sel,
}: {
  id: string;
  titre: string;
  sous: string;
  sel: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`cursor-pointer select-none rounded-xl border border-line bg-panel px-4 py-2.5 transition hover:border-ink-faint/40 ${sel}`}
    >
      <span className="block text-sm font-bold text-ink">{titre}</span>
      <span className="block text-[11px] text-ink-faint">{sous}</span>
    </label>
  );
}

export async function Specs() {
  const [quotidien, tick] = await Promise.all([dernierPassagePlanifie(), dernierTickScheduler()]);
  const { retention, planif } = volatiles(quotidien);

  // La latence d'alerte est DÉDUITE du battement de cœur du scheduler, pas
  // écrite en dur : elle change sans qu'on touche au code (cf. lib/etat-latence).
  // Lecture en échec : « non établi », jamais « aucun passage constaté ».
  const latence = latenceDepuis(tick, Date.now());

  // La rétention se range après le masquage du replay, à sa place d'origine dans
  // la progression « mesure → restitution → exploitation » ; la latence juste
  // après l'hébergement, là où elle a toujours été.
  const criteres = [
    ...CRITERES.slice(0, 6),
    retention,
    CRITERES[6], // Hébergement
    { c: "Latence d'alerte", cible: `${CADENCE_TICK_MIN} minutes`, reel: latence.reel, s: latence.s },
    ...CRITERES.slice(7),
  ];
  const aFaire = planif ? [planif, ...A_FAIRE] : A_FAIRE;
  const compte = (s: Statut) => criteres.filter((c) => c.s === s).length;
  const nonCouvertes = mesuresNonCouvertes();

  return (
    <section id="specs" className="scroll-mt-16 border-y border-line">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <header className="max-w-3xl">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-perf">
            Ce qu&apos;on a codé, sans le maquiller
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Specs / Capacité technique
          </h2>
          <p className="mt-3 leading-relaxed text-ink-soft">
            Où ça tourne, ce que ça mesure, et ce que ça vaut face aux critères d&apos;un vrai RUM.
            Les chiffres viennent du code et des mesures, pas d&apos;un document d&apos;intention —
            et chaque ligne porte le fichier qui la prouve.
          </p>
          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
              Face au marché
            </span>
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

        <div className="mt-10 flex flex-wrap items-stretch gap-2">
          {/* Les trois commandes. `sr-only` les sort du flux sans les sortir de
              l'arbre d'accessibilité : le clavier les atteint, les flèches
              passent de l'une à l'autre, et l'étiquette porte l'anneau de focus. */}
          <input
            id="specs-infra"
            type="radio"
            name="specs-onglet"
            defaultChecked
            className="peer/infra sr-only"
          />
          <input id="specs-mesures" type="radio" name="specs-onglet" className="peer/mesures sr-only" />
          <input id="specs-ecart" type="radio" name="specs-onglet" className="peer/ecart sr-only" />

          <Onglet
            id="specs-infra"
            titre="Infrastructure"
            sous="Où ça tourne"
            sel="peer-checked/infra:border-accent peer-checked/infra:bg-accent/[0.06] peer-checked/infra:ring-2 peer-checked/infra:ring-accent/20 peer-focus-visible/infra:ring-2 peer-focus-visible/infra:ring-accent"
          />
          <Onglet
            id="specs-mesures"
            titre="Mesures"
            sous={`${MESURES.length} captées · ${ANGLES_MORTS.length + nonCouvertes.length} absentes`}
            sel="peer-checked/mesures:border-accent peer-checked/mesures:bg-accent/[0.06] peer-checked/mesures:ring-2 peer-checked/mesures:ring-accent/20 peer-focus-visible/mesures:ring-2 peer-focus-visible/mesures:ring-accent"
          />
          <Onglet
            id="specs-ecart"
            titre="Écart au marché"
            sous={`${compte("partiel") + compte("manque") + compte("non-mesure")} points ouverts`}
            sel="peer-checked/ecart:border-accent peer-checked/ecart:bg-accent/[0.06] peer-checked/ecart:ring-2 peer-checked/ecart:ring-accent/20 peer-focus-visible/ecart:ring-2 peer-focus-visible/ecart:ring-accent"
          />

          {/* ═══════════════ Onglet 1 — infrastructure ═══════════════ */}
          <div className="hidden w-full pt-6 peer-checked/infra:block">
            <div className="grid gap-5">
              {INFRA.map((g) => (
                <div key={g.titre} className="overflow-hidden rounded-2xl border border-line bg-panel">
                  <div className="border-b border-line bg-panel2 px-5 py-3">
                    <h3 className="text-sm font-bold text-ink">{g.titre}</h3>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">{g.sous}</p>
                  </div>
                  <ul className="divide-y divide-line">
                    {g.lignes.map((l) => (
                      <li
                        key={l.k}
                        className="grid gap-x-5 gap-y-1.5 px-5 py-4 lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,7rem)] lg:items-baseline"
                      >
                        <span className="text-sm font-semibold text-ink">{l.k}</span>
                        <span className="min-w-0 text-[13px] leading-relaxed text-ink">
                          {l.v}
                          {l.preuve && (
                            <span className="mt-1 block font-mono text-[11px] text-ink-faint">
                              {l.preuve}
                            </span>
                          )}
                        </span>
                        <span className="lg:text-right">
                          <Etiquette s={l.s} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* ═══════════════ Onglet 2 — mesures ═══════════════ */}
          <div className="hidden w-full pt-6 peer-checked/mesures:block">
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              <div className="border-b border-line bg-panel2 px-5 py-3">
                <h3 className="text-sm font-bold text-ink">
                  Ce qu&apos;on capte — {MESURES.length} familles de mesures
                </h3>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">
                  Chaque ligne dit ce qui voyage sur le fil, où ça atterrit en base, et quel module
                  l&apos;émet. Rien ici n&apos;est déclaratif : les trois se vérifient dans le dépôt.
                </p>
              </div>
              <ul className="divide-y divide-line">
                {MESURES.map((m) => (
                  <li
                    key={`${m.quoi}-${m.module}`}
                    className="grid gap-x-5 gap-y-1.5 px-5 py-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,13rem)] lg:items-baseline"
                  >
                    <span className="text-sm font-semibold text-ink">{m.quoi}</span>
                    <span className="text-[13px] leading-relaxed text-ink-soft">{m.detail}</span>
                    <span className="min-w-0 font-mono text-[11px] leading-relaxed text-ink-faint lg:text-right">
                      <span className="block">{m.otlp ? `${m.otlp} →` : "canal séparé →"}</span>
                      <span className="block text-ink-soft">{m.table}</span>
                      <span className="block break-all">{m.module.replace(/^packages\//, "")}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line bg-panel2 px-5 py-3 text-[12px] leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">Couverture par navigateur.</span>{" "}
                {NOTE_NAVIGATEURS}
              </p>
            </div>

            {/* Ce qu'on ne mesure pas ------------------------------------- */}
            <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel">
              <div className="border-b border-line bg-panel2 px-5 py-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-warn">
                  <Icon paths={ICON_PATHS.alert} className="h-4 w-4" strokeWidth={2.4} />
                  Ce qu&apos;on ne mesure pas
                </h3>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">
                  Avec le motif à chaque fois : plusieurs de ces lignes ne seront jamais tenables,
                  et une liste grisée sans raison se lirait comme une feuille de route.
                </p>
              </div>
              <ul className="divide-y divide-line">
                {/* D'abord les angles morts : ce qu'un RUM du marché fait et qu'on
                    devrait faire. Un test échoue le jour où le code apparaît. */}
                {ANGLES_MORTS.map((a) => (
                  <li key={a.label} className="px-5 py-4">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-ink">{a.label}</span>
                      <Etiquette s="manque" texte="pas encore codé" />
                    </span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">
                      {a.raison}
                    </span>
                  </li>
                ))}
                {/* Puis celles que la console déclare déjà, écran par écran, dans
                    la roue des blocs — reprises telles quelles, pas réécrites. */}
                {nonCouvertes.map((i) => (
                  <li key={i.label} className="px-5 py-4">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-ink">{i.label}</span>
                      <span className="rounded-full border border-line bg-panel2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                        {i.ecran}
                      </span>
                    </span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">
                      {i.raison}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ═══════════════ Onglet 3 — écart au marché ═══════════════ */}
          <div className="hidden w-full pt-6 peer-checked/ecart:block">
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
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
                      <Etiquette s={c.s} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Ce qui manque, en liste simple ----------------------------- */}
            <div className="mt-8">
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
              <span className="font-semibold text-ink">Ce que ça veut dire.</span> La chaîne de
              mesure — collecte, ingestion, restitution — tient les critères de fond : poids,
              seuils, percentile, anonymat. Ce qui manque relève de l&apos;exploitation, pas de la
              conception : brancher le déclencheur des tâches planifiées, fermer l&apos;ingestion
              par défaut, activer le filet d&apos;isolation en base, rapatrier l&apos;hébergement
              chez un fournisseur de droit européen — le backend, désormais autonome, est prêt à
              être déplacé — et changer de moteur de stockage avant la montée en volume.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
