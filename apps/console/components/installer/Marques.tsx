// Les visuels de l'ajout d'un projet (/select/new), repris de la vitrine
// (/presentation/installation) pour que la console parle la même langue : un logo
// blanc sur une pastille de la couleur de sa marque, et le SDK en étiquette orange
// posée dans une fenêtre de navigateur. Tracés : lib/logos-marques.ts (Simple Icons).
import { LOGOS, type Marque } from "@/lib/logos-marques";

/** Un logo de marque, blanc sur une pastille de sa couleur. Edge : monogramme (plus de tracé chez Simple Icons). */
export function PastilleMarque({ marque, className = "h-8 w-8" }: { marque: Marque | "edge"; className?: string }) {
  const fond = marque === "edge" ? "linear-gradient(135deg,#0c59a4,#35c1f1)" : LOGOS[marque].couleur;
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-lg ${className}`} style={{ background: fond }}>
      {marque === "edge" ? (
        <span className="text-[0.8em] font-black leading-none text-white">e</span>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" fill="white">
          <path d={LOGOS[marque].trace} />
        </svg>
      )}
    </span>
  );
}

/** Le SDK embarqué : une fenêtre de navigateur, l'étiquette « SDK » dans la page. */
export function VisuelSdk({ className = "h-12 w-16" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 64 48" className={`shrink-0 ${className}`} fill="none">
      <rect x="1" y="1" width="62" height="46" rx="7" fill="#0b1735" />
      <path d="M1 8a7 7 0 0 1 7-7h48a7 7 0 0 1 7 7v4H1z" fill="#16275c" />
      {[7, 12, 17].map((x, i) => (
        <circle key={x} cx={x} cy="6.5" r="1.6" fill={["#ff5f57", "#febc2e", "#28c840"][i]} />
      ))}
      <rect x="8" y="19" width="26" height="4" rx="2" fill="rgba(255,255,255,.22)" />
      <rect x="8" y="27" width="34" height="3" rx="1.5" fill="rgba(255,255,255,.1)" />
      <rect x="8" y="33" width="28" height="3" rx="1.5" fill="rgba(255,255,255,.1)" />
      <rect x="38" y="16" width="20" height="10" rx="5" fill="#f89101" />
      <text x="48" y="23.4" fontSize="6" fontWeight="800" textAnchor="middle" fill="#040a1c">
        SDK
      </text>
    </svg>
  );
}

/** L'extension navigateur : les deux navigateurs pris en charge (Manifest V3). */
export function VisuelExtension() {
  return (
    <span aria-hidden className="flex shrink-0 -space-x-2">
      <PastilleMarque marque="chrome" className="h-9 w-9 ring-2 ring-panel" />
      <PastilleMarque marque="edge" className="h-9 w-9 ring-2 ring-panel" />
    </span>
  );
}
