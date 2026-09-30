"use client";

// Une section dont le contenu entre au rythme du défilement, pas d'un minuteur : la
// section publie sa progression dans `--p` (0 quand son haut touche le bas de
// l'écran, 1 quand il touche le haut), et le CSS en tire, élément par élément
// (`--i`), le glissé et le fondu (`.entrees-piece`, globals.css). Défiler à l'envers
// rembobine. Sans script, `--p` manque et vaut 1 : tout est en place.
import { useEffect, useRef } from "react";
import type { ComponentProps } from "react";

export function SectionDefilee(props: ComponentProps<"section">) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let image = 0;
    const mesurer = () => {
      image = 0;
      const h = window.innerHeight;
      const p = Math.min(1, Math.max(0, (h - el.getBoundingClientRect().top) / h));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const planifier = () => {
      if (!image) image = requestAnimationFrame(mesurer);
    };
    mesurer();
    window.addEventListener("scroll", planifier, { passive: true });
    window.addEventListener("resize", planifier);
    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener("scroll", planifier);
      window.removeEventListener("resize", planifier);
    };
  }, []);

  return <section ref={ref} {...props} />;
}
