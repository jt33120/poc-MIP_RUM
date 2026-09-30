"use client";

// Une scène épinglée, pilotée par le défilement : l'aperçu de la vitrine
// (ApercuDefilant) et les tutoriels d'installation (TutorielInstallation) la
// partagent. La dynamique est celle de basedb (eodia.github.io/basedb) : une section
// haute dont l'intérieur reste épinglé à l'écran ; le premier dixième du défilement
// redresse le cadre (il arrive incliné, en perspective), le reste se partage entre les
// étapes — chaque étape change la légende, fait se transformer la scène (rendue par
// l'appelant : `scene(nom)`), et remplit sa barre dans la navigation du bas.
//
// Le défilement n'écrit dans React que le numéro de l'étape ; tout ce qui bouge en
// continu (inclinaison, barres) s'écrit en style direct, une fois par image
// (requestAnimationFrame) : pas un rendu React par pixel défilé. Qui a demandé moins de
// mouvement voit les mêmes étapes, sans inclinaison ni glissé.
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Une étape : son nom (que la scène reçoit), son onglet, sa légende, son adresse affichée. */
export interface EtapeDefilee {
  nom: string;
  onglet: string;
  titre: string;
  texte: string;
  chemin: string;
}

/** Part du défilement qui redresse le cadre, avant la première étape. */
const INTRO = 0.12;
/** Défilement par étape, en hauteurs d'écran. */
const PAR_ETAPE_VH = 90;

const borne = (x: number) => Math.min(1, Math.max(0, x));
const douce = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export function DefilementEpingle<E extends EtapeDefilee>({
  etapes,
  id,
  testId,
  surtitre,
  titre,
  adresse,
  legende,
  ratio,
  scene,
}: {
  etapes: readonly E[];
  /** Préfixe des identifiants (titre de la section). */
  id: string;
  testId: string;
  surtitre: string;
  titre: string;
  /** Ce que la barre d'adresse affiche devant le chemin de l'étape. */
  adresse: string;
  /** La phrase sous le cadre, qui dit ce qu'on regarde. */
  legende: string;
  /** Largeur / hauteur de la scène. */
  ratio: number;
  scene: (etape: E) => ReactNode;
}) {
  const section = useRef<HTMLElement>(null);
  const cadre = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const barres = useRef<(HTMLSpanElement | null)[]>([]);
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
      aria-labelledby={`${id}-titre`}
      data-testid={testId}
      className="relative"
      style={{ height: `calc(100svh + ${Math.round((n * PAR_ETAPE_VH) / (1 - INTRO))}vh)` }}
    >
      <div className="sticky top-0 flex h-[100svh] min-h-[32rem] flex-col items-center overflow-hidden px-4 pb-4 pt-[calc(1.25rem+4vh)]">
        <div aria-hidden className="apercu-halo pointer-events-none absolute inset-0 -z-10" />

        {/* Le titre de la section, puis une légende par étape, dans la même case de grille. */}
        <div className="grid w-full max-w-4xl text-center">
          <div ref={intro} className="[grid-area:1/1]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-accent-ink">{surtitre}</p>
            <h2 id={`${id}-titre`} className="mt-3 text-3xl font-extrabold tracking-[-0.03em] text-ink sm:text-5xl">
              {titre}
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
            style={{ width: `min(1080px, 100%, calc((100svh - 22rem) * ${ratio}))` }}
          >
            <div className="flex h-8 items-center gap-3 border-b border-white/10 bg-[#0e1936] px-3 sm:h-9">
              <span aria-hidden className="flex gap-1.5">
                <i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <i className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              </span>
              <span className="mx-auto truncate rounded-md bg-white/5 px-3 py-0.5 font-mono text-[11px] text-white/60">
                {adresse} {etapes[visible]?.chemin}
              </span>
              <span aria-hidden className="w-[42px]" />
            </div>
            {scene(etapes[visible])}
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] text-ink-soft">
          {legende}
        </p>

        {/* La navigation : une étape par bouton, sa barre se remplit au défilement. */}
        <nav aria-label={`Étapes : ${titre}`} className={`apercu-etapes mt-3 flex gap-1.5 sm:gap-3 ${etape < 0 ? "opacity-0" : "opacity-100"}`}>
          {etapes.map((e, k) => (
            <button
              key={e.nom}
              type="button"
              onClick={() => allerA(k)}
              aria-current={etape === k ? "step" : undefined}
              className="group flex w-12 flex-col items-center gap-1.5 py-1 sm:w-24"
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
