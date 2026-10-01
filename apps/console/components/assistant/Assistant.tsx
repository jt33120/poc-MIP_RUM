"use client";

// L'ASSISTANT DE LA VUE D'ENSEMBLE — un bouton en haut à droite, un volet à droite
// (charte § 5 et § 3.8, recette du 30/09/2026).
//
// Le volet laisse la page visible : il se superpose à droite (400 px), pousse le
// contenu à partir de 1 440 px (`html[data-assistant]`, fin de `app/globals.css`), et
// passe en plein écran sous 640 px. Il annonce sa portée (cet écran, l'application, la
// période), propose quatre questions, et garde le fil de la conversation tant que la
// page reste ouverte — jamais au-delà : rien n'est écrit nulle part.
//
// CHAQUE AFFIRMATION A SA SOURCE. Une réponse cite des faits du condensé (« [F3] »),
// dessinés en pastilles numérotées ; la liste des sources suit la réponse (libellé,
// valeur). Un clic sur une pastille ou une source fait défiler la page jusqu'au chiffre
// et le surligne (`surligner.ts`). Sous 1 440 px, le volet se referme d'abord : il
// recouvrirait le chiffre qu'on veut montrer.
//
// SANS MODÈLE, IL RÉPOND QUAND MÊME. La route (`/api/assistant`) répond par règles
// quand aucune clé n'est posée ; et quand elle refuse (session de démonstration,
// débit atteint) ou ne répond pas, la même réponse par règles est calculée ici, dans
// le navigateur, sur le même condensé — et la réponse le dit.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Digest, FaitDigest } from "@/lib/assistant/digest";
import { QUESTIONS_SUGGEREES, repondreParRegles, segmenterCitations, type ReponseAssistant } from "@/lib/assistant/resume";
import { surligner, trouverCible } from "./surligner";

/** Une question et sa réponse ; les faits cités sont GARDÉS avec la réponse (la page se relit, le condensé change). */
export type MessageAssistant =
  | { id: number; role: "question"; texte: string }
  | { id: number; role: "reponse"; reponse: ReponseAssistant; faits: FaitDigest[] };

/** Au-delà de cette largeur, le volet pousse la page au lieu de la recouvrir. */
const LARGEUR_POUSSEE = "(min-width: 1440px)";
const MAX_QUESTION = 500;

/** L'étincelle de l'assistant (tracé maison, une couleur, 24×24). */
function Etincelle({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5l1.9 5.2 5.2 1.9-5.2 1.9L12 17.7l-1.9-5.2L4.9 10.6l5.2-1.9z" />
      <path d="M18.5 3v3.4M16.8 4.7h3.4M5.5 17.5v3M4 19h3" />
    </svg>
  );
}

/** La réponse, demandée à la route ; en cas de refus ou d'échec, calculée ici par règles. */
export async function obtenirReponse(question: string, digest: Digest, appel: typeof fetch = fetch): Promise<ReponseAssistant> {
  const local = (avertissement: string): ReponseAssistant => ({ ...repondreParRegles(question, digest), avertissement });
  try {
    const res = await appel("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, digest }),
      credentials: "same-origin",
    });
    if (res.status === 403) return local("Compte de démonstration : réponse calculée par règles, sans modèle d'IA.");
    if (res.status === 429) return local("Limite de questions atteinte pour 10 minutes : réponse calculée par règles.");
    if (res.status === 401 || res.redirected) return local("Session expirée : réponse calculée par règles, sur cette page.");
    if (!res.ok) return local("Le serveur de l'assistant n'a pas répondu : réponse calculée par règles.");
    const corps = (await res.json()) as Partial<ReponseAssistant> | null;
    if (!corps || typeof corps.texte !== "string" || !Array.isArray(corps.citations) || (corps.mode !== "regles" && corps.mode !== "modele")) {
      return local("Réponse du serveur illisible : réponse calculée par règles.");
    }
    // Une source n'existe que si ce navigateur la connaît : les citations se relisent ici.
    const connus = new Set(digest.faits.map((f) => f.id));
    return { ...(corps as ReponseAssistant), citations: corps.citations.filter((id) => connus.has(id)) };
  } catch {
    return local("Le serveur de l'assistant est injoignable : réponse calculée par règles.");
  }
}

/** Le texte d'une réponse à copier : citations numérotées, sources en fin. */
export function texteACopier(reponse: ReponseAssistant, faits: readonly FaitDigest[]): string {
  const numero = new Map(reponse.citations.map((id, i) => [id, i + 1]));
  const corps = reponse.texte.replace(/\[(F\d{1,3})\]/g, (m, id: string) => (numero.has(id) ? `[${numero.get(id)}]` : m));
  const sources = reponse.citations
    .map((id) => faits.find((f) => f.id === id))
    .filter((f): f is FaitDigest => f !== undefined)
    .map((f, i) => `[${i + 1}] ${f.libelle} : ${f.valeur}`);
  return sources.length ? `${corps}\n\nSources (tableau de bord) :\n${sources.join("\n")}` : corps;
}

function BoutonCopier({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(texte)
          .then(() => {
            setCopie(true);
            setTimeout(() => setCopie(false), 2000);
          })
          .catch(() => undefined);
      }}
      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
    >
      {copie ? "Copié" : "Copier"}
    </button>
  );
}

/** Une pastille de source : le numéro du fait cité, un bouton qui le montre sur la page. */
function Pastille({ n, fait, surSource }: { n: number; fait: FaitDigest; surSource: (f: FaitDigest) => void }) {
  return (
    <button
      type="button"
      onClick={() => surSource(fait)}
      aria-label={`Source ${n} : ${fait.libelle}, ${fait.valeur}. Voir sur le tableau de bord`}
      title={`${fait.libelle} : ${fait.valeur}`}
      data-testid="assistant-pastille"
      className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-full bg-accent/15 px-1 align-middle text-[10px] font-semibold tabular-nums text-accent-ink transition hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
    >
      {n}
    </button>
  );
}

/** Une réponse : la phrase-verdict, les puces, les pastilles de citation, puis ses sources. */
export function ReponseAssistantVue({
  reponse,
  faits,
  surSource,
}: {
  reponse: ReponseAssistant;
  faits: readonly FaitDigest[];
  surSource: (f: FaitDigest) => void;
}) {
  const parId = new Map(faits.map((f) => [f.id, f]));
  const cites = reponse.citations.map((id) => parId.get(id)).filter((f): f is FaitDigest => f !== undefined);
  const numero = new Map(cites.map((f, i) => [f.id, i + 1]));
  const lignes = reponse.texte.split("\n").map((l) => l.trim()).filter(Boolean);
  const rendre = (ligne: string): ReactNode[] =>
    segmenterCitations(ligne.replace(/^-\s+/, "")).map((s, i) =>
      "texte" in s ? (
        <span key={i}>{s.texte}</span>
      ) : (
        <span key={i} className="whitespace-nowrap">
          {s.ids.map((id) => {
            const f = parId.get(id);
            const n = numero.get(id);
            return f && n ? <Pastille key={id} n={n} fait={f} surSource={surSource} /> : null;
          })}
        </span>
      ),
    );
  const [tete, ...reste] = lignes;
  return (
    <article className="min-w-0 rounded-xl border border-line bg-panel px-3 py-2.5" data-testid="assistant-reponse" data-mode={reponse.mode}>
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-panel2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
          <Etincelle className="h-3 w-3 text-ai dark:text-ai-soft" />
          {reponse.mode === "modele" ? `IA · ${reponse.modele ?? "Mistral"}` : "Règles"}
        </span>
        <span className="ml-auto">
          <BoutonCopier texte={texteACopier(reponse, cites)} />
        </span>
      </div>
      {tete && <p className="text-sm font-medium leading-relaxed text-ink [overflow-wrap:anywhere]">{rendre(tete)}</p>}
      {reste.length > 0 && (
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm leading-relaxed text-ink marker:text-ink-faint">
          {reste.map((l, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              {rendre(l)}
            </li>
          ))}
        </ul>
      )}
      {cites.length > 0 && (
        <div className="mt-2.5 border-t border-line pt-2" data-testid="assistant-sources">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-soft">Sources</p>
          <ol className="mt-1 flex flex-col gap-0.5">
            {cites.map((f, i) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => surSource(f)}
                  data-testid="assistant-source"
                  data-cible={f.cible}
                  className="group flex w-full min-w-0 items-baseline gap-2 rounded-md px-1 py-0.5 text-left text-xs transition hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 px-1 text-[10px] font-semibold tabular-nums text-accent-ink">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-soft group-hover:text-ink" title={f.libelle}>
                    {f.libelle}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">{f.valeur}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {reponse.avertissement && (
        <p role="note" className="mt-2 text-[11px] leading-snug text-ink-soft" data-testid="assistant-avertissement">
          {reponse.avertissement}
        </p>
      )}
    </article>
  );
}

/** Le volet : en-tête et portée, fil (ou questions suggérées), champ de question. Sans état : testable au rendu serveur. */
export function VoletAssistant({
  digest,
  messages,
  enCours,
  saisie,
  alerte,
  idTitre,
  surSaisie,
  surQuestion,
  surSource,
  surFermer,
  refSaisie,
}: {
  digest: Digest;
  messages: readonly MessageAssistant[];
  enCours: boolean;
  saisie: string;
  /** Une source dont l'élément n'est pas à l'écran, dite dans le volet. */
  alerte: string | null;
  idTitre: string;
  surSaisie: (texte: string) => void;
  surQuestion: (question: string) => void;
  surSource: (f: FaitDigest) => void;
  surFermer: () => void;
  refSaisie?: React.Ref<HTMLInputElement>;
}) {
  const posees = new Set(messages.filter((m) => m.role === "question").map((m) => (m as { texte: string }).texte));
  const restantes = QUESTIONS_SUGGEREES.filter((q) => !posees.has(q));
  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    surQuestion(saisie);
  };
  return (
    <>
      <header className="shrink-0 border-b border-line px-4 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <Etincelle className="h-4 w-4 text-ai dark:text-ai-soft" />
          <h2 id={idTitre} className="text-sm font-semibold text-ink">
            Assistant
          </h2>
          <button
            type="button"
            onClick={surFermer}
            aria-label="Fermer l'assistant"
            aria-keyshortcuts="Escape"
            data-testid="assistant-fermer"
            className="-mr-1 ml-auto rounded-lg p-1 text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {/* La portée, en puces : l'assistant ne lit que ce tableau de bord. */}
        <ul aria-label="Portée de l'assistant" className="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-[11px]" data-testid="assistant-portee">
          {[digest.ecran, digest.app ?? "toutes les applications", digest.periode].map((p) => (
            <li key={p} className="max-w-full truncate rounded-md border border-line bg-panel2 px-1.5 py-px font-medium text-ink-soft">
              {p}
            </li>
          ))}
          <li className="px-0.5 tabular-nums text-ink-faint">{digest.faits.length} chiffres lus</li>
        </ul>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {messages.length === 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Questions suggérées" data-testid="assistant-suggestions">
            {QUESTIONS_SUGGEREES.map((q, i) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => surQuestion(q)}
                  data-premier={i === 0 ? "" : undefined}
                  data-testid="assistant-suggestion"
                  className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-left text-sm text-ink transition hover:border-ai/40 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  <span className="min-w-0 flex-1">{q}</span>
                  <span aria-hidden className="shrink-0 text-ink-faint">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ol
            className="flex flex-col gap-3 rounded-sm focus:outline-none"
            aria-live="polite"
            aria-busy={enCours}
            aria-label="Conversation"
            tabIndex={-1}
            data-testid="assistant-fil"
          >
            {messages.map((m) =>
              m.role === "question" ? (
                <li key={m.id} className="ml-8 self-end rounded-xl bg-panel2 px-3 py-2 text-sm text-ink [overflow-wrap:anywhere]" data-testid="assistant-question">
                  {m.texte}
                </li>
              ) : (
                <li key={m.id} className="min-w-0">
                  <ReponseAssistantVue reponse={m.reponse} faits={m.faits} surSource={surSource} />
                </li>
              ),
            )}
            {enCours && (
              <li className="flex items-center gap-2 text-xs text-ink-soft" data-testid="assistant-attente">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai" />
                Lecture des chiffres du tableau de bord…
              </li>
            )}
          </ol>
        )}
        {alerte && (
          <p role="status" className="mt-3 rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-xs text-ink-soft" data-testid="assistant-absent">
            {alerte}
          </p>
        )}
        {messages.length > 0 && !enCours && restantes.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Autres questions suggérées">
            {restantes.map((q) => (
              <li key={q} className="max-w-full">
                <button
                  type="button"
                  onClick={() => surQuestion(q)}
                  className="max-w-full truncate rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft transition hover:border-ai/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* La marge droite laisse la place au bouton « Votre avis ? », fixé en bas à droite. */}
      <form onSubmit={envoyer} className="shrink-0 border-t border-line py-3 pl-4 pr-16">
        <label className="sr-only" htmlFor={`${idTitre}-saisie`}>
          Question sur ce tableau de bord
        </label>
        <div className="flex min-w-0 items-center gap-1 rounded-lg border border-line bg-app pl-2.5 pr-1 focus-within:ring-2 focus-within:ring-perf">
          <input
            ref={refSaisie}
            id={`${idTitre}-saisie`}
            type="text"
            value={saisie}
            onChange={(e) => surSaisie(e.target.value)}
            maxLength={MAX_QUESTION}
            placeholder="Une question sur ce tableau de bord…"
            autoComplete="off"
            data-testid="assistant-saisie"
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={enCours || !saisie.trim()}
            aria-label="Envoyer la question"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-accent-ink transition hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </form>
    </>
  );
}

/** L'élément reçoit-il le focus au clavier ? (Une case est un bouton ; une section ne l'est pas.) */
function focusable(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && (el.tabIndex >= 0 || /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName));
}

export function Assistant({ digest }: { digest: Digest }) {
  const [ouvert, setOuvert] = useState(false);
  const [monte, setMonte] = useState(false);
  const [messages, setMessages] = useState<MessageAssistant[]>([]);
  const [enCours, setEnCours] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [alerte, setAlerte] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const bouton = useRef<HTMLButtonElement>(null);
  const volet = useRef<HTMLElement>(null);
  const refSaisie = useRef<HTMLInputElement>(null);
  const suivant = useRef(1);
  const enVol = useRef(false);
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const idVolet = `assistant-volet-${base}`;
  const idTitre = `assistant-titre-${base}`;

  // Le volet vit dans <body> : aucun ancêtre transformé ne le décale.
  useEffect(() => setMonte(true), []);

  // À partir de 1 440 px, le volet ouvert pousse la page (règle CSS du bloc « Assistant »).
  useEffect(() => {
    const html = document.documentElement;
    if (ouvert) html.dataset.assistant = "ouvert";
    else delete html.dataset.assistant;
    return () => {
      delete html.dataset.assistant;
    };
  }, [ouvert]);

  useEffect(() => {
    if (!ouvert) return;
    // Le focus entre dans le volet : sur la première question suggérée, sinon le champ.
    (volet.current?.querySelector<HTMLElement>("[data-premier]") ?? refSaisie.current)?.focus();
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Une fenêtre de case ouverte se ferme d'abord : c'est elle que vise Échap.
      if (document.querySelector("dialog[open]")) return;
      setOuvert(false);
      bouton.current?.focus();
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [ouvert]);

  function fermer() {
    setOuvert(false);
    bouton.current?.focus();
  }

  async function demander(question: string) {
    const q = question.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
    // Une question à la fois : un double clic ne pose pas deux fois la même.
    if (!q || enVol.current) return;
    enVol.current = true;
    const id = suivant.current;
    suivant.current += 2;
    // Le condensé de CET instant : la page se relit, et les numéros de faits avec elle.
    const instantane = digest;
    setMessages((m) => [...m, { id, role: "question", texte: q }]);
    setSaisie("");
    setAlerte(null);
    setEnCours(true);
    // La question suggérée cliquée disparaît avec la liste : le focus passe au fil,
    // plutôt que de retomber au début de la page.
    requestAnimationFrame(() => {
      if (!volet.current?.contains(document.activeElement)) volet.current?.querySelector<HTMLElement>('[data-testid="assistant-fil"]')?.focus();
    });
    try {
      const reponse = await obtenirReponse(q, instantane);
      const cites = new Set(reponse.citations);
      setMessages((m) => [...m, { id: id + 1, role: "reponse", reponse, faits: instantane.faits.filter((f) => cites.has(f.id)) }]);
    } finally {
      enVol.current = false;
      setEnCours(false);
    }
  }

  function montrer(fait: FaitDigest) {
    const el = trouverCible(document, fait.cible, fait.repli);
    if (!el) {
      setAlerte(`« ${fait.libelle} » n'est pas affiché sur l'écran en ce moment : bloc masqué ou onglet du graphique fermé.`);
      return;
    }
    setAlerte(null);
    const pousse = window.matchMedia(LARGEUR_POUSSEE).matches;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Sous 1 440 px, le volet recouvrirait le chiffre : il se ferme, la conversation reste.
    if (!pousse) setOuvert(false);
    requestAnimationFrame(() => {
      surligner(el, { reduit });
      // Le volet refermé emporte le focus : il va au chiffre montré (sa case est un
      // bouton), sinon au bouton de l'assistant — jamais perdu en tête de page.
      if (!pousse) {
        const dedans = focusable(el) ? el : el.querySelector<HTMLElement>('button, a[href], summary, [tabindex="0"]');
        (dedans ?? bouton.current)?.focus({ preventScroll: true });
      }
      setAnnonce(`${fait.libelle} : ${fait.valeur}, surligné sur le tableau de bord.`);
    });
  }

  // LE BOUTON, EN HAUT À DROITE, SANS PRENDRE DE PLACE. Flottant à droite de la
  // première rangée de l'écran ; son libellé ne s'écrit qu'à partir de 1 280 px, sinon
  // il reprendrait sa largeur à la rangée voisine (mesuré : +31 px de hauteur à 1 024 px).
  // Sous 640 px, il quitte le haut de l'écran : un rond fixé en bas à droite, au-dessus
  // du bouton « Votre avis ? » — en haut, il aurait écrasé la barre des vues (+207 px).
  return (
    <div className="sm:float-right sm:mb-2 sm:ml-3" data-testid="assistant">
      <button
        ref={bouton}
        type="button"
        onClick={() => (ouvert ? fermer() : setOuvert(true))}
        aria-expanded={ouvert}
        aria-controls={idVolet}
        aria-label="Assistant : poser une question sur ce tableau de bord"
        title="Assistant"
        data-testid="assistant-ouvrir"
        className="fixed bottom-[4.5rem] right-5 z-30 inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-full border border-line bg-panel text-xs font-semibold text-ink shadow-pop transition hover:border-ai/40 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf sm:static sm:h-8 sm:w-8 sm:rounded-lg sm:shadow-sm xl:w-auto xl:px-2.5"
      >
        <Etincelle className="h-4 w-4 shrink-0 text-ai dark:text-ai-soft" />
        <span className="hidden xl:inline">Assistant</span>
      </button>
      <p className="sr-only" aria-live="polite">
        {annonce}
      </p>
      {monte &&
        createPortal(
          <aside
            ref={volet}
            id={idVolet}
            aria-labelledby={idTitre}
            data-testid="assistant-volet"
            data-ouvert={ouvert ? "true" : "false"}
            // `hidden` en CLASSE, pas en attribut : l'attribut perdrait contre `flex`
            // (même spécificité, utilitaires après la base). Fermé, le volet reste monté :
            // la conversation survit à la fermeture.
            className={`${ouvert ? "flex" : "hidden"} fixed inset-0 z-40 flex-col bg-panel text-ink shadow-pop sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[25rem] sm:border-l sm:border-line`}
          >
            <VoletAssistant
              digest={digest}
              messages={messages}
              enCours={enCours}
              saisie={saisie}
              alerte={alerte}
              idTitre={idTitre}
              surSaisie={setSaisie}
              surQuestion={(q) => void demander(q)}
              surSource={montrer}
              surFermer={fermer}
              refSaisie={refSaisie}
            />
          </aside>,
          document.body,
        )}
    </div>
  );
}
