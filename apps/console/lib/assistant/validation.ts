// CE QUE LA ROUTE DE L'ASSISTANT ACCEPTE — logique pure, testée sans serveur.
//
// Le condensé revient du navigateur : la route ne le relit pas en base (elle n'y a
// pas accès, et c'est voulu : l'assistant ne dit que ce que l'écran a montré), elle le
// VÉRIFIE. Forme exacte, 200 faits au plus, chaque texte borné, identifiants et
// sélecteurs à leur format ; puis chaque texte repasse par le masque des données
// personnelles avant de partir vers le modèle. Un condensé falsifié par son propre
// utilisateur ne peut donc que mal renseigner cet utilisateur-là, dans ces bornes.
import type { Digest, FaitDigest, TonFait } from "./digest";
import { masquerDonneesPersonnelles } from "./masque";

export const MAX_FAITS_ACCEPTES = 200;
export const MAX_QUESTION = 500;

const LIMITES = { categorie: 40, libelle: 200, valeur: 200, detail: 400, variation: 200, cible: 200, cle: 80, ecran: 60, app: 100, periode: 100, genereLe: 40 } as const;
const ID = /^F\d{1,3}$/;
const CLE = /^[a-z0-9:_-]+$/i;
/** Un sélecteur de repère : attributs, identifiants, `:nth-child()` — rien d'exécutable, et il ne sert qu'au navigateur. */
const SELECTEUR = /^[#.\w\s[\]="'():>,-]+$/;
const TONS: readonly TonFait[] = ["bon", "moyen", "mauvais", "neutre"];

export type Verdict<T> = { ok: true; valeur: T } | { ok: false; raison: string };

const texte = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const nombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validerFait(brut: unknown, i: number): Verdict<FaitDigest> {
  if (!brut || typeof brut !== "object") return { ok: false, raison: `fait ${i + 1} : objet attendu` };
  const f = brut as Record<string, unknown>;
  if (!texte(f.id, 4) || !ID.test(f.id)) return { ok: false, raison: `fait ${i + 1} : identifiant invalide` };
  if (!texte(f.cle, LIMITES.cle) || !CLE.test(f.cle)) return { ok: false, raison: `${f.id} : clé invalide` };
  for (const champ of ["categorie", "libelle", "valeur"] as const) {
    if (!texte(f[champ], LIMITES[champ]) || f[champ] === "") return { ok: false, raison: `${f.id} : ${champ} invalide` };
  }
  if (!texte(f.cible, LIMITES.cible) || !SELECTEUR.test(f.cible)) return { ok: false, raison: `${f.id} : cible invalide` };
  if (f.repli !== undefined && (!texte(f.repli, LIMITES.cible) || !SELECTEUR.test(f.repli))) return { ok: false, raison: `${f.id} : repli invalide` };
  if (f.detail !== undefined && !texte(f.detail, LIMITES.detail)) return { ok: false, raison: `${f.id} : détail invalide` };
  if (f.variation !== undefined && !texte(f.variation, LIMITES.variation)) return { ok: false, raison: `${f.id} : variation invalide` };
  if (f.verdict !== undefined && !texte(f.verdict, LIMITES.variation)) return { ok: false, raison: `${f.id} : verdict invalide` };
  if (f.ton !== undefined && !TONS.includes(f.ton as TonFait)) return { ok: false, raison: `${f.id} : ton invalide` };
  for (const champ of ["ecartPct", "poids"] as const) {
    if (f[champ] !== undefined && !nombre(f[champ])) return { ok: false, raison: `${f.id} : ${champ} invalide` };
  }
  if (f.degradation !== undefined && typeof f.degradation !== "boolean") return { ok: false, raison: `${f.id} : dégradation invalide` };

  // Reconstruit champ par champ : rien d'autre que ce qui est vérifié ne passe.
  const m = masquerDonneesPersonnelles;
  const fait: FaitDigest = {
    id: f.id,
    categorie: m(f.categorie as string),
    libelle: m(f.libelle as string),
    valeur: m(f.valeur as string),
    cible: f.cible,
    cle: f.cle,
  };
  if (f.detail !== undefined) fait.detail = m(f.detail as string);
  if (f.repli !== undefined) fait.repli = f.repli as string;
  if (f.variation !== undefined) fait.variation = m(f.variation as string);
  if (f.ton !== undefined) fait.ton = f.ton as TonFait;
  if (f.verdict !== undefined) fait.verdict = m(f.verdict as string);
  if (f.ecartPct !== undefined) fait.ecartPct = f.ecartPct as number;
  if (f.degradation !== undefined) fait.degradation = f.degradation as boolean;
  if (f.poids !== undefined) fait.poids = f.poids as number;
  return { ok: true, valeur: fait };
}

/** Le condensé reçu, vérifié et masqué ; ou la raison du refus. */
export function validerDigest(brut: unknown): Verdict<Digest> {
  if (!brut || typeof brut !== "object") return { ok: false, raison: "condensé absent" };
  const d = brut as Record<string, unknown>;
  if (d.version !== 1) return { ok: false, raison: "version du condensé inconnue" };
  if (!texte(d.ecran, LIMITES.ecran) || !texte(d.periode, LIMITES.periode) || !texte(d.genereLe, LIMITES.genereLe)) {
    return { ok: false, raison: "portée du condensé invalide" };
  }
  if (d.app !== null && !texte(d.app, LIMITES.app)) return { ok: false, raison: "application invalide" };
  if (!Array.isArray(d.faits)) return { ok: false, raison: "faits absents" };
  if (d.faits.length > MAX_FAITS_ACCEPTES) return { ok: false, raison: `plus de ${MAX_FAITS_ACCEPTES} faits` };
  const faits: FaitDigest[] = [];
  const vus = new Set<string>();
  for (const [i, x] of d.faits.entries()) {
    const v = validerFait(x, i);
    if (!v.ok) return v;
    if (vus.has(v.valeur.id)) return { ok: false, raison: `${v.valeur.id} : identifiant en double` };
    vus.add(v.valeur.id);
    faits.push(v.valeur);
  }
  return {
    ok: true,
    valeur: {
      version: 1,
      ecran: masquerDonneesPersonnelles(d.ecran),
      app: d.app === null ? null : masquerDonneesPersonnelles(d.app as string),
      periode: masquerDonneesPersonnelles(d.periode),
      genereLe: d.genereLe,
      faits,
    },
  };
}

/** La demande entière : `{ question, digest }`. */
export function validerDemande(brut: unknown): Verdict<{ question: string; digest: Digest }> {
  if (!brut || typeof brut !== "object") return { ok: false, raison: "corps JSON attendu" };
  const c = brut as Record<string, unknown>;
  if (typeof c.question !== "string") return { ok: false, raison: "question absente" };
  const question = c.question.replace(/[ \t\r\n]+/g, " ").trim();
  if (!question) return { ok: false, raison: "question vide" };
  if (question.length > MAX_QUESTION) return { ok: false, raison: `question de plus de ${MAX_QUESTION} caractères` };
  const digest = validerDigest(c.digest);
  if (!digest.ok) return digest;
  return { ok: true, valeur: { question: masquerDonneesPersonnelles(question), digest: digest.valeur } };
}
