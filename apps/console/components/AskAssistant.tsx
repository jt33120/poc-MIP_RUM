"use client";
// Widget « Assistant IA » — bouton flottant + panneau. Pose une question sur les
// DONNÉES de l'app ou l'ARCHITECTURE du produit ; la réponse rend chaque citation
// [n] en EXPOSANT CLIQUABLE vers la page source (donnée live ou ancre d'archi) —
// la preuve visible que l'IA n'hallucine pas. Client léger : fetch /api/ask.
import { useRef, useState } from "react";

interface ClientSource {
  n: number;
  title: string;
  url: string;
  kind: "data" | "archi";
}
type Turn = { q: string; answer: string; sources: ClientSource[] };
type State = "idle" | "loading" | "disabled" | "error";

// Tokenise l'intérieur d'un bloc de texte : **gras**, `code`, et marqueurs de
// citation [n] (rendus en exposant cliquable). Le reste du Markdown renvoyé par
// le modèle (titres, italique) n'est volontairement pas géré — hors du contrat
// de prompt, donc jamais attendu en pratique.
const INLINE_RE = /\*\*(.+?)\*\*|`([^`]+?)`|\[(\d+)\]/g;

function renderInline(text: string, keyPrefix: string, byN: Map<number, ClientSource>): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-ink">
          {m[1]}
        </strong>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-c-${i}`} className="rounded bg-panel px-1 py-0.5 text-[12px] text-accent">
          {m[2]}
        </code>,
      );
    } else if (m[3] !== undefined) {
      const src = byN.get(Number(m[3]));
      if (src) {
        nodes.push(
          <a
            key={`${keyPrefix}-n-${i}`}
            href={src.url}
            target="_blank"
            rel="noreferrer"
            title={`Source : ${src.title}`}
            className="ml-0.5 inline-flex align-super text-[10px] font-bold text-accent hover:underline"
          >
            [{src.n}]
          </a>,
        );
      }
      // marqueur inconnu : le serveur les efface déjà (sanitizeCitations), on ne
      // le rend donc jamais — filet de sécurité, pas le chemin attendu.
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Rend une réponse Markdown-lite : **gras**, `code`, listes num./à puces, et
 *  citations [n] en exposant cliquable — jamais un "*" littéral à l'écran. */
function AnswerText({ answer, sources }: { answer: string; sources: ClientSource[] }) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  return (
    <>
      {answer.split(/\n+/).map((block, pi) => {
        if (!block.trim()) return null;
        const ol = block.match(/^(\d+)\.\s+([\s\S]*)$/);
        const ul = !ol && block.match(/^[-*]\s+([\s\S]*)$/);
        if (ol) {
          return (
            <div key={pi} className="mb-1.5 flex gap-2 last:mb-0">
              <span className="shrink-0 font-semibold text-ink-faint">{ol[1]}.</span>
              <span>{renderInline(ol[2], String(pi), byN)}</span>
            </div>
          );
        }
        if (ul) {
          return (
            <div key={pi} className="mb-1.5 flex gap-2 last:mb-0">
              <span className="shrink-0 text-ink-faint">•</span>
              <span>{renderInline(ul[1], String(pi), byN)}</span>
            </div>
          );
        }
        return (
          <p key={pi} className="mb-2 last:mb-0">
            {renderInline(block, String(pi), byN)}
          </p>
        );
      })}
    </>
  );
}

export function AskAssistant({ appId }: { appId: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function ask() {
    const qq = question.trim();
    if (!qq || state === "loading") return;
    setState("loading");
    setErr(null);
    setQuestion("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app: appId, question: qq }),
      });
      const data = await res.json();
      if (res.status === 501) {
        setState("disabled");
        return;
      }
      if (!res.ok) {
        setErr(data.error ?? "erreur");
        setState("error");
        return;
      }
      setTurns((t) => [...t, { q: qq, answer: data.answer ?? "", sources: data.sources ?? [] }]);
      setState("idle");
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }));
    } catch {
      setErr("Erreur réseau.");
      setState("error");
    }
  }

  return (
    <>
      {/* Bouton flottant */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Assistant IA"
        className="fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-gradient-to-br from-accent to-accent-deep px-4 text-sm font-semibold text-navy-950 shadow-glow transition hover:brightness-105"
      >
        <span className="text-base leading-none">✦</span>
        {open ? "Fermer" : "Assistant IA"}
      </button>

      {open && (
        <section
          className="fixed bottom-20 right-5 z-40 flex max-h-[70vh] w-[min(92vw,400px)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-card"
          aria-label="Panneau assistant IA"
        >
          <header className="border-b border-line bg-panel2 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="text-accent">✦</span> Assistant IA
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">
              Vos données ou l&apos;architecture du produit. Chaque réponse cite ses sources —
              cliquez le <span className="font-semibold text-accent">[n]</span> pour vérifier.
            </p>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {turns.length === 0 && state !== "disabled" && (
              <div className="text-[12px] text-ink-faint">
                <p className="mb-2">Exemples :</p>
                <ul className="flex flex-col gap-1.5">
                  {[
                    "Combien de sessions cette semaine ?",
                    "Quelle librairie Python est utilisée côté backend ?",
                    "Où sont stockées les données ?",
                    "Comment est mesuré le LCP ?",
                  ].map((ex) => (
                    <li key={ex}>
                      <button
                        type="button"
                        onClick={() => setQuestion(ex)}
                        className="text-left text-ink-soft transition hover:text-accent"
                      >
                        › {ex}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {state === "disabled" && (
              <p className="rounded-lg border border-line bg-panel2 px-3 py-2 text-[12px] text-ink-soft">
                Assistant désactivé — ajouter <code className="text-accent">MISTRAL_API_KEY</code>{" "}
                (ou <code>ANTHROPIC_API_KEY</code>) aux variables d&apos;environnement de la console.
              </p>
            )}

            <div className="flex flex-col gap-4">
              {turns.map((t, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <p className="self-end rounded-2xl rounded-br-sm bg-accent/10 px-3 py-1.5 text-[13px] font-medium text-ink">
                    {t.q}
                  </p>
                  <div className="rounded-2xl rounded-bl-sm border border-line bg-panel2 px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
                    <AnswerText answer={t.answer} sources={t.sources} />
                    {t.sources.length > 0 && (
                      <div className="mt-2.5 border-t border-line pt-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                          Sources
                        </div>
                        <ul className="flex flex-col gap-1">
                          {t.sources.map((s) => (
                            <li key={s.n} className="flex items-start gap-1.5 text-[11px]">
                              <span className="font-bold text-accent">[{s.n}]</span>
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-ink-soft underline decoration-line underline-offset-2 transition hover:text-accent"
                              >
                                {s.title}
                                <span className="ml-1 text-ink-faint">
                                  {s.kind === "data" ? "· donnée live" : "· architecture"}
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {state === "loading" && (
              <p className="mt-3 flex items-center gap-2 text-[12px] text-ink-faint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                Recherche dans les sources…
              </p>
            )}
            {state === "error" && err && (
              <p className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                {err}
              </p>
            )}
          </div>

          <div className="border-t border-line bg-panel2 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask();
                  }
                }}
                rows={2}
                placeholder="Posez votre question…"
                className="grow resize-none rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[13px] text-ink shadow-sm focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={ask}
                disabled={state === "loading" || !question.trim()}
                className="shrink-0 rounded-lg bg-gradient-to-br from-accent to-accent-deep px-3 py-2 text-[13px] font-semibold text-navy-950 transition hover:brightness-105 disabled:opacity-40"
              >
                {state === "loading" ? "…" : "Envoyer"}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
