// Troisième section de la vitrine : la console en mouvement, puis la porte
// d'entrée vers le compte de démonstration.
//
// La vidéo est un enregistrement Playwright d'une vraie visite de la console
// (apps/console/public/portail/console-tour.mp4, régénérable par
// scripts/record-console-tour.mjs) — pas un montage. Sans son, donc sans
// piste audio dans le fichier.
//
// PROVENANCE DU TRAFIC, à ne pas maquiller : les chiffres à l'écran viennent de
// scripts/gen-traffic.mjs — des sessions Chromium scriptées sur le site de démo
// local, passées par le vrai SDK et la vraie chaîne d'ingestion. Les écrans et
// les calculs sont ceux de production ; les visiteurs, non. Écrire « données
// réelles » ici contredirait la promesse même de la page d'accueil
// (« pas une sonde de laboratoire »).
//
// Le bouton « Voir le compte démo » n'apparaît QUE si DEMO_USER_APPS est
// configurée : sans démo derrière, un bouton qui renvoie vers /login est une
// promesse non tenue. Cf. lib/demo.ts et app/demo/route.ts pour les bornes.
import Link from "next/link";
import { demoConfig } from "@/lib/demo";

/** Ce que le visiteur voit défiler, dans l'ordre de la vidéo. */
const ETAPES = [
  { t: "Vue d'ensemble", d: "Score de santé, Core Web Vitals au p75, volume et taux d'erreur." },
  { t: "Pages lentes", d: "Les routes les plus lentes, et la distribution derrière la moyenne." },
  { t: "Erreurs JS", d: "Regroupées par cause, classées par nombre d'utilisateurs touchés." },
  { t: "Sessions & parcours", d: "Le cheminement réel d'un visiteur, vitals et erreurs sur sa timeline." },
  { t: "Tracing front → back", d: "Chaque appel API relié à son exécution serveur." },
  { t: "Alertes", d: "Règles par app, route et métrique, webhooks sortants." },
];

export function Demo() {
  const demo = demoConfig();

  return (
    <section id="demo" className="scroll-mt-16">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <header className="max-w-2xl">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-perf">
            L&apos;espace de supervision
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            La console, en mouvement
          </h2>
          <p className="mt-3 leading-relaxed text-ink-soft">
            Une visite enregistrée de bout en bout, sans montage : c&apos;est l&apos;outil tel
            qu&apos;il tourne. Le trafic mesuré vient de sessions de navigateur scriptées sur un site
            de démonstration, passées par le vrai SDK et la vraie chaîne d&apos;ingestion — les écrans
            et les calculs sont ceux de production, les visiteurs non.
          </p>
        </header>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] lg:gap-10">
          {/* La visite filmée. Pas d'autoplay : 1,7 Mo, et un mouvement qu'on
              n'a pas demandé est une gêne — le poster + les contrôles natifs
              laissent le visiteur décider. preload="none" ne télécharge rien
              tant qu'il n'a pas cliqué. */}
          <figure className="m-0">
            <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-pop">
              <video
                className="block aspect-[8/5] w-full bg-panel2"
                controls
                playsInline
                muted
                preload="none"
                poster="/portail/console-tour-poster.jpg"
              >
                <source src="/portail/console-tour.mp4" type="video/mp4" />
                Votre navigateur ne peut pas lire cette vidéo — la console reste accessible en se
                connectant.
              </video>
            </div>
            <figcaption className="mt-3 text-xs text-ink-faint">
              Visite de la console enregistrée automatiquement · sans son · 38 s
            </figcaption>
          </figure>

          {/* Ce qu'on voit défiler, pour lire la vidéo sans la regarder */}
          <ol className="flex flex-col gap-3">
            {ETAPES.map((e, i) => (
              <li key={e.t} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-perf/10 font-mono text-[10px] font-bold text-perf">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink">{e.t}</span>
                  <span className="block text-xs leading-relaxed text-ink-soft">{e.d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        {demo && (
          <div className="mt-10 flex flex-col items-start gap-3 rounded-xl border border-line bg-panel/60 p-6 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">Entrer dans la console</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                Un compte de démonstration, ouvert sans mot de passe et en lecture seule. Vous
                naviguez dans les mêmes écrans que la vidéo, sur les applications supervisées.
              </p>
            </div>
            <Link
              href="/demo"
              data-testid="presentation-demo"
              prefetch={false}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-accent via-[#fca62b] to-accent-deep px-6 py-3 text-base font-semibold text-navy-950 shadow-[0_8px_22px_-10px_rgba(248,145,1,0.9)] transition hover:brightness-110 hover:shadow-[0_10px_26px_-8px_rgba(248,145,1,0.95)]"
            >
              Voir le compte démo <span aria-hidden>→</span>
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
