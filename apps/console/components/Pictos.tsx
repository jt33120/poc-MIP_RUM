// Pictogrammes communs de la console (charte § 3.12) : logo du navigateur et du
// système, drapeau du pays, classe d'appareil, capteur. Une image à la place d'un mot,
// pour qu'une ligne tienne sur 32 px.
//
// UN SEUL JEU (01/10/2026). Les classements (`ImpactTable`, son `PictoSegment`) et les
// écrans Usages (`components/sessions/Pictos.tsx`) dessinaient chacun leurs logos,
// leurs monogrammes et leurs drapeaux, avec les mêmes tables recopiées : un logo
// ajouté d'un côté manquait de l'autre. Les deux modules réexportent celui-ci.
//
// CE QU'UN PICTOGRAMME NE FAIT JAMAIS SEUL : dire la valeur. Il est décoratif
// (`aria-hidden`) ; le nom complet voyage à côté, en infobulle (`title`) ET en texte
// lu (`sr-only`) par l'appelant. Une valeur inconnue a son pictogramme à elle — un
// « ? » en pointillé —, jamais le logo d'une marque au hasard.
//
// JAMAIS UN `<span>` : les listes et les classements lisent leur libellé dans le
// premier `<span>` d'une ligne (e2e). Un pictogramme est un `<svg>` ou un `<i>`.
//
// Les tracés viennent de `lib/logos-marques.ts` (Simple Icons, CC0). Edge et Windows
// n'y figurent plus (retirés à la demande de Microsoft) : un monogramme neutre, sans
// imitation de marque. Rendu serveur, sans état.
import { LOGOS, type Marque } from "@/lib/logos-marques";

/** Familles de navigateurs (`packages/backend/shared/dimensions.mjs`) qui ont un logo. */
const LOGO_NAVIGATEUR: Record<string, Marque> = {
  Chrome: "chrome",
  Firefox: "firefox",
  Safari: "safari",
  Opera: "opera",
  "Android WebView": "android",
  "iOS WebView": "apple",
};

/** Systèmes qui ont un logo ; Windows n'en a plus chez Simple Icons (monogramme). */
const LOGO_SYSTEME: Record<string, Marque> = {
  macOS: "apple",
  iOS: "apple",
  Android: "android",
  Linux: "linux",
  ChromeOS: "chrome",
};

/** Une marque noire, ou trop pâle sur fond clair, se dessine à l'encre du thème (mode sombre compris). */
const ENCRE_DU_THEME = new Set(["#000000", "#FCC624"]);

const TAILLE = "h-3.5 w-3.5 shrink-0";

/**
 * « FR » → 🇫🇷 (deux indicateurs régionaux). Un code qui n'est pas ISO 3166 alpha-2
 * (valeur inconnue, « XX » de test mal formé) ne rend rien : jamais un drapeau inventé.
 */
export function drapeauPays(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return String.fromCodePoint(...[...c].map((l) => 0x1f1e6 + l.charCodeAt(0) - 65));
}

/**
 * Variante stricte des classements : le code tel quel, en capitales (« fr » n'est pas
 * un code de la dimension `country`, qui les écrit en capitales).
 */
export function drapeau(code: string): string | null {
  return /^[A-Z]{2}$/.test(code) ? drapeauPays(code) : null;
}

/** La marque d'un navigateur, s'il en a une (« Chrome » → chrome) ; exportée pour les tests. */
export function marqueNavigateur(nom: string | null | undefined): Marque | null {
  return nom ? (LOGO_NAVIGATEUR[nom.trim()] ?? null) : null;
}

/** La marque d'un système, s'il en a une (« macOS » → apple) ; exportée pour les tests. */
export function marqueSysteme(nom: string | null | undefined): Marque | null {
  return nom ? (LOGO_SYSTEME[nom.trim()] ?? null) : null;
}

export function LogoMarque({ marque }: { marque: Marque }) {
  const { trace, couleur } = LOGOS[marque];
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={TAILLE} fill={ENCRE_DU_THEME.has(couleur) ? "currentColor" : couleur}>
      <path d={trace} />
    </svg>
  );
}

/** Monogramme neutre (Edge, Windows, familles sans logo) ; « ? » en pointillé pour l'inconnu. */
export function Monogramme({ lettre, pointille = false }: { lettre: string; pointille?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`${TAILLE} text-ink-soft`}>
      <rect
        x="0.5"
        y="0.5"
        width="15"
        height="15"
        rx="4"
        className={pointille ? "fill-none stroke-ink-faint" : "fill-panel2 stroke-line"}
        strokeDasharray={pointille ? "2 2" : undefined}
      />
      <text x="8" y="11.5" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="currentColor">
        {lettre}
      </text>
    </svg>
  );
}

const INCONNU = <Monogramme lettre="?" pointille />;

/** Logo du navigateur ; monogramme (initiale) sans logo, « ? » quand il est inconnu. */
export function PictoNavigateur({ nom }: { nom: string | null | undefined }) {
  const propre = nom?.trim();
  if (!propre || propre === "Inconnu") return INCONNU;
  const marque = marqueNavigateur(propre);
  if (marque) return <LogoMarque marque={marque} />;
  return <Monogramme lettre={propre === "Edge" ? "e" : propre.charAt(0).toUpperCase()} />;
}

/** Logo du système ; monogramme sans logo (Windows : « W »), « ? » quand il est inconnu. */
export function PictoSysteme({ nom }: { nom: string | null | undefined }) {
  const propre = nom?.trim();
  if (!propre || propre === "Inconnu") return INCONNU;
  const marque = marqueSysteme(propre);
  if (marque) return <LogoMarque marque={marque} />;
  return <Monogramme lettre={propre.charAt(0).toUpperCase()} />;
}

/** Le tracé d'une classe d'appareil (tracés simples, sans marque), ou `null`. */
function traceAppareil(classe: string | null | undefined) {
  const c = classe?.trim().toLowerCase();
  return c === "desktop" ? (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ) : c === "tablet" ? (
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ) : c === "mobile" ? (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ) : null;
}

function Trait({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`${TAILLE} text-ink-soft`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Classe d'appareil déclarée par l'émetteur : ordinateur, mobile, tablette ; « ? » sinon. */
export function PictoAppareil({ classe }: { classe: string | null | undefined }) {
  const trace = traceAppareil(classe);
  return trace ? <Trait>{trace}</Trait> : INCONNU;
}

/** Le drapeau en `<i>` (jamais un `<span>`, voir l'en-tête). */
function Drapeau({ emoji }: { emoji: string }) {
  return (
    <i aria-hidden="true" className="inline-block w-4 shrink-0 text-center text-sm not-italic leading-none">
      {emoji}
    </i>
  );
}

/** Drapeau du pays estimé (émoji) ; « ? » en pointillé quand il est inconnu. */
export function PictoPays({ code }: { code: string | null | undefined }) {
  const d = drapeauPays(code);
  return d ? <Drapeau emoji={d} /> : INCONNU;
}

/** Capteur de la session : le SDK (fenêtre de navigateur), l'extension (pièce de puzzle), le mobile. */
export function PictoCapteur({ source }: { source: string | null | undefined }) {
  const s = source?.trim().toLowerCase();
  const trace =
    s === "extension" ? (
      <path d="M10 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h-2a2 2 0 0 0 0 4h2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 0 0-4 0v2H6a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z" />
    ) : s === "mobile" || s === "react_native" ? (
      <>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ) : s === "sdk" ? (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M2 9h20M6 6.5h.01M9 6.5h.01" />
      </>
    ) : null;
  return trace ? <Trait>{trace}</Trait> : INCONNU;
}

/**
 * Le pictogramme d'un groupe de découpage (« Qui sont ces sessions ») : la dimension
 * choisit la famille, la valeur brute le dessin. `null` pour une dimension sans image.
 */
export function PictoDimension({ dimension, valeur }: { dimension: string; valeur: string | null }) {
  if (dimension === "browser") return <PictoNavigateur nom={valeur} />;
  if (dimension === "os") return <PictoSysteme nom={valeur} />;
  if (dimension === "device") return <PictoAppareil classe={valeur} />;
  if (dimension === "country") return <PictoPays code={valeur} />;
  if (dimension === "source") return <PictoCapteur source={valeur} />;
  return null;
}

/**
 * Le pictogramme d'un segment de classement (charte § 3.5) : mêmes dessins que
 * `PictoDimension`, mais RIEN quand l'image ne dirait rien — une route, une release,
 * un code pays mal formé, une classe d'appareil hors liste. « Inconnu » garde son « ? ».
 */
export function PictoSegment({ dimension, libelle }: { dimension?: string; libelle: string }) {
  if (!dimension || dimension === "route" || dimension === "release") return null;
  if (libelle === "Inconnu") return INCONNU;
  if (dimension === "browser") return <PictoNavigateur nom={libelle} />;
  if (dimension === "os") return <PictoSysteme nom={libelle} />;
  if (dimension === "country") {
    const d = drapeau(libelle);
    return d ? <Drapeau emoji={d} /> : null;
  }
  if (dimension === "device") {
    const trace = traceAppareil(libelle);
    return trace ? <Trait>{trace}</Trait> : null;
  }
  return null;
}
