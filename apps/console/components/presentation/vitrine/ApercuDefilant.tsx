"use client";

// L'aperçu défilant de la vitrine : la console, capture après capture, pilotée par le
// défilement. La dynamique est celle de basedb (eodia.github.io/basedb) : une section
// haute dont l'intérieur reste épinglé à l'écran ; le premier dixième du défilement
// redresse le cadre (il arrive incliné, en perspective), le reste se partage entre les
// étapes — chaque étape change la légende, fait glisser la capture suivante à la place
// de la précédente, et remplit sa barre dans la navigation du bas.
//
// Le défilement n'écrit dans React que le numéro de l'étape ; tout ce qui bouge en
// continu (inclinaison, barres, léger zoom) s'écrit en style direct, une fois par image
// (requestAnimationFrame) : pas un rendu React par pixel défilé. Qui a demandé moins de
// mouvement voit les mêmes étapes, sans inclinaison ni glissé.
import { useEffect, useRef, useState } from "react";
import type { EtapeApercu } from "@/lib/vitrine";

/** Part du défilement qui redresse le cadre, avant la première étape. */
const INTRO = 0.12;
/** Défilement par étape, en hauteurs d'écran. */
const PAR_ETAPE_VH = 90;

const borne = (x: number) => Math.min(1, Math.max(0, x));
const douce = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export function ApercuDefilant({ etapes }: { etapes: readonly EtapeApercu[] }) {
  const section = useRef<HTMLElement>(null);
  const cadre = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const barres = useRef<(HTMLSpanElement | null)[]>([]);
  const zooms = useRef<(HTMLImageElement | null)[]>([]);
  // -1 : le cadre se redresse, aucune étape encore (la première capture est déjà là).
  const [etape, setEtape] = useState(-1);
  const n = etapes.length;
  const pas = (1 - INTRO) / n;

  useEffect(() => {
    const s = section.current;
    if (!s) return;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let image = 0;
    const maj = () => {
      image = 0;
      const r = s.getBoundingClientRect();
      const p = borne(-r.top / Math.max(1, r.height - window.innerHeight));
      const t = reduit ? (p > INTRO / 2 ? 1 : 0) : douce(borne(p / INTRO));
      if (intro.current) {
        intro.current.style.opacity = String(borne(1 - t * 1.6));
        intro.current.style.transform = reduit ? "" : `translateY(${-48 * t}px)`;
      }
      if (cadre.current) {
        cadre.current.style.transform = reduit
          ? ""
          : `perspective(1600px) translateY(${(1 - t) * 14}vh) rotateX(${(1 - t) * 28}deg) scale(${0.84 + 0.16 * t})`;
      }
      const i = p < INTRO ? -1 : Math.min(n - 1, Math.floor((p - INTRO) / pas));
      setEtape((avant) => (avant === i ? avant : i));
      barres.current.forEach((b, k) => b?.style.setProperty("transform", `scaleX(${borne((p - INTRO - k * pas) / pas)})`));
      if (!reduit) {
        zooms.current.forEach((img, k) => img?.style.setProperty("transform", `scale(${1 + 0.035 * borne((p - INTRO - k * pas) / pas)})`));
      }
    };
    const demander = () => {
      if (image === 0) image = requestAnimationFrame(maj);
    };
    maj();
    window.addEventListener("scroll", demander, { passive: true });
    window.addEventListener("resize", demander);
    return () => {
      window.removeEventListener("scroll", demander);
      window.removeEventListener("resize", demander);
      if (image) cancelAnimationFrame(image);
    };
  }, [n, pas]);

  /** Défile jusqu'au début de l'étape `k` (un peu après, pour que sa légende soit posée). */
  const allerA = (k: number) => {
    const s = section.current;
    if (!s) return;
    const longueur = s.offsetHeight - window.innerHeight;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: s.offsetTop + (INTRO + (k + 0.08) * pas) * longueur, behavior: reduit ? "auto" : "smooth" });
  };

  const visible = Math.max(0, etape);
  return (
    <section
      ref={section}
      aria-labelledby="apercu-titre"
      data-testid="vitrine-apercu"
      className="relative"
      style={{ height: `calc(100svh + ${Math.round((n * PAR_ETAPE_VH) / (1 - INTRO))}vh)` }}
    >
      <div className="sticky top-0 flex h-[100svh] min-h-[32rem] flex-col items-center overflow-hidden px-4 pb-4 pt-[calc(1.25rem+4vh)]">
        <div aria-hidden className="apercu-halo pointer-events-none absolute inset-0 -z-10" />

        {/* Le titre de la section, puis une légende par étape, dans la même case de grille. */}
        <div className="grid w-full max-w-4xl text-center">
          <div ref={intro} className="[grid-area:1/1]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-accent-ink">Aperçu</p>
            <h2 id="apercu-titre" className="mt-3 text-3xl font-extrabold tracking-[-0.03em] text-ink sm:text-5xl">
              La console, telle que la voit la démo.
            </h2>
          </div>
          {etapes.map((e, k) => (
            <div
              key={e.nom}
              className="apercu-legende [grid-area:1/1]"
              data-actif={etape === k}
              aria-hidden={etape !== k}
              data-testid="apercu-legende"
            >
              <h3 className="text-3xl font-extrabold tracking-[-0.03em] text-ink sm:text-5xl">{e.titre}</h3>
              <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">{e.texte}</p>
            </div>
          ))}
        </div>

        {/* Le cadre : une fenêtre de navigateur, et les captures empilées dedans. */}
        <div className="mt-6 flex min-h-0 w-full flex-1 items-center justify-center sm:mt-8 sm:items-start">
          <div
            ref={cadre}
            className="origin-top overflow-hidden rounded-xl border border-white/10 bg-[#0b1430] shadow-[0_60px_120px_-40px_rgba(248,145,1,0.35),0_0_0_1px_rgba(255,255,255,0.04)] will-change-transform sm:rounded-2xl"
            style={{ width: "min(1080px, 100%, calc((100svh - 19rem) * 1.6))" }}
          >
            <div className="flex h-8 items-center gap-3 border-b border-white/10 bg-[#0e1936] px-3 sm:h-9">
              <span aria-hidden className="flex gap-1.5">
                <i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <i className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              </span>
              <span className="mx-auto truncate rounded-md bg-white/5 px-3 py-0.5 font-mono text-[11px] text-white/60">
                MIP RUM · compte démo · {etapes[visible]?.chemin}
              </span>
              <span aria-hidden className="w-[42px]" />
            </div>
            <div className="relative aspect-[16/10] overflow-hidden bg-white">
              {etapes.map((e, k) => (
                <figure
                  key={e.nom}
                  className="apercu-vue absolute inset-0 m-0"
                  data-etat={k === visible ? "actif" : k < visible ? "avant" : "apres"}
                  aria-hidden={k !== visible}
                >
                  {/* <img>, pas next/image : une capture déjà au bon format, sans optimisation à la volée (quota Vercel). */}
                  <img
                    ref={(el) => {
                      zooms.current[k] = el;
                    }}
                    src={`/vitrine/${e.nom}.webp`}
                    alt={e.alt}
                    width={2880}
                    height={1800}
                    decoding="async"
                    loading={k === 0 ? "eager" : "lazy"}
                    className="h-full w-full origin-top object-cover object-top"
                  />
                </figure>
              ))}
            </div>
          </div>
        </div>

        {/* La navigation : une étape par bouton, sa barre se remplit au défilement. */}
        <nav aria-label="Étapes de l'aperçu" className={`apercu-etapes mt-4 flex gap-2 sm:gap-3 ${etape < 0 ? "opacity-0" : "opacity-100"}`}>
          {etapes.map((e, k) => (
            <button
              key={e.nom}
              type="button"
              onClick={() => allerA(k)}
              aria-current={etape === k ? "step" : undefined}
              className="group flex w-14 flex-col items-center gap-1.5 py-1 sm:w-24"
            >
              <span className={`text-[11px] font-medium transition sm:text-xs ${etape === k ? "text-ink" : "text-ink-soft group-hover:text-ink"}`}>
                {e.onglet}
              </span>
              <span className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
                <span
                  ref={(el) => {
                    barres.current[k] = el;
                  }}
                  className="block h-full w-full origin-left scale-x-0 rounded-full bg-accent"
                />
              </span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}
