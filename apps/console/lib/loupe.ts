// La loupe (recette du 01/10/2026) : la recherche en haut de la console remplace
// l'entrée « Explorer » du menu. Elle ne cherche pas DANS les données (aucune lecture
// de plus, aucune requête à chaque frappe) : elle mène quelque part.
//   - un écran, y compris ceux qui ne sont pas au menu (Explorer, Mobile) ;
//   - une action (« Créer une alerte », « Créer un SLO »…) ;
//   - un identifiant de session collé → la session ;
//   - un chemin (« /checkout ») → les pages filtrées sur cette route.
// Logique PURE, testée (tests/unit/nav-items.test.ts) ; le composant est `components/Loupe.tsx`.
import { ADMINISTRATION, CATEGORIES } from "@/components/nav-items";

export type Resultat = {
  cle: string;
  libelle: string;
  /** Où l'entrée se range : « Performance », « Action », « Administration »… */
  groupe: string;
  href: string;
  /** L'adresse garde l'application et la période de l'écran courant. */
  garderContexte: boolean;
};

/** Minuscules, sans accents : « Rétention » se trouve en tapant « retention ». */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Les actions : chacune mène au formulaire de création de son écran. */
export const ACTIONS: readonly Omit<Resultat, "garderContexte">[] = [
  { cle: "creer-alerte", libelle: "Créer une alerte", groupe: "Action", href: "/alerts#nouvelle-regle" },
  { cle: "creer-slo", libelle: "Créer un SLO", groupe: "Action", href: "/slo#nouveau-slo" },
  { cle: "creer-objectif", libelle: "Créer un objectif de conversion", groupe: "Action", href: "/goals#gerer-objectifs" },
  { cle: "creer-tableau", libelle: "Créer un tableau de bord", groupe: "Action", href: "/dashboards" },
  { cle: "ajouter-projet", libelle: "Ajouter un projet", groupe: "Action", href: "/select/new" },
  { cle: "installer", libelle: "Installer un capteur", groupe: "Action", href: "/installer" },
];

/** Tous les écrans de la console, menu et hors menu. */
export function ecrans(admin: boolean): Resultat[] {
  const out: Resultat[] = [];
  for (const c of CATEGORIES) {
    if (c.verrouille) continue;
    const enfants = c.children ?? [{ href: c.href, label: c.label }];
    for (const l of enfants) {
      out.push({ cle: `ecran:${l.href}`, libelle: l.label, groupe: c.label, href: l.href, garderContexte: true });
    }
  }
  if (admin) {
    for (const l of ADMINISTRATION) {
      out.push({ cle: `ecran:${l.href}`, libelle: l.label, groupe: "Administration", href: l.href, garderContexte: false });
    }
  }
  // Un même écran rangé deux fois (catégorie mono-page) ne s'affiche qu'une fois.
  return out.filter((r, i) => out.findIndex((x) => x.href === r.href) === i);
}

const SESSION = /^[0-9a-f]{8}(-?[0-9a-f]{4}){0,3}(-?[0-9a-f]{12})?$/i;

/**
 * Les résultats d'une saisie, les meilleurs d'abord : un libellé qui COMMENCE par la
 * saisie passe devant un libellé qui la contient. Chaque mot tapé doit se retrouver
 * dans le libellé ou son groupe. Sans saisie : les actions, puis les écrans.
 */
export function chercher(saisie: string, admin: boolean, max = 8): Resultat[] {
  const brut = saisie.trim();
  const q = normaliser(brut);
  const tous = [...ACTIONS.map((a) => ({ ...a, garderContexte: a.href !== "/select/new" })), ...ecrans(admin)];
  if (!q) return tous.slice(0, max);

  const speciaux: Resultat[] = [];
  if (SESSION.test(brut) && brut.replace(/-/g, "").length >= 8) {
    speciaux.push({ cle: "session", libelle: `Ouvrir la session ${brut}`, groupe: "Session", href: `/sessions/${encodeURIComponent(brut)}`, garderContexte: true });
  }
  if (brut.startsWith("/") && !/\s/.test(brut)) {
    speciaux.push({
      cle: "route",
      libelle: `Pages filtrées sur la route ${brut}`,
      groupe: "Route",
      href: `/pages?route=${encodeURIComponent(brut)}`,
      garderContexte: true,
    });
  }

  const mots = q.split(/\s+/);
  const notes = tous
    .map((r) => {
      const libelle = normaliser(r.libelle);
      const texte = `${libelle} ${normaliser(r.groupe)}`;
      if (!mots.every((m) => texte.includes(m))) return null;
      const note = libelle.startsWith(q) ? 0 : libelle.split(/\s+/).some((m) => m.startsWith(mots[0])) ? 1 : 2;
      return { r, note };
    })
    .filter((x): x is { r: Resultat; note: number } => x !== null)
    .sort((a, b) => a.note - b.note);
  return [...speciaux, ...notes.map((x) => x.r)].slice(0, max);
}

/** L'adresse finale : l'application et la période de l'écran courant suivent l'écran visé. */
export function avecContexte(r: Resultat, rechercheCourante: string): string {
  if (!r.garderContexte) return r.href;
  const courant = new URLSearchParams(rechercheCourante);
  const [chemin, ancre] = r.href.split("#");
  const [base, qs] = chemin.split("?");
  const cible = new URLSearchParams(qs ?? "");
  for (const cle of ["app", "period", "from", "to"]) {
    const v = courant.get(cle);
    if (v !== null && !cible.has(cle)) cible.set(cle, v);
  }
  const s = cible.toString();
  return `${base}${s ? `?${s}` : ""}${ancre ? `#${ancre}` : ""}`;
}
