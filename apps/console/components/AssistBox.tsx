"use client";
import { useState } from "react";

/** Encart assistant IA du wizard d'onboarding — generation de middleware pour
 *  une stack non couverte, diagnostic « rien n'arrive », questions CSP/RGPD. */
export function AssistBox({ appId }: { appId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "disabled" | "error">("idle");

  async function ask() {
    if (!question.trim() || state === "loading") return;
    setState("loading");
    setAnswer(null);
    try {
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId, question }),
      });
      const data = await res.json();
      if (res.status === 501) {
        setState("disabled");
        return;
      }
      if (!res.ok) {
        setAnswer(data.error ?? "erreur");
        setState("error");
        return;
      }
      setAnswer(data.answer);
      setState("idle");
    } catch {
      setAnswer("Erreur réseau.");
      setState("error");
    }
  }

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/50 p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-violet-900">
        🤖 Assistant d&apos;intégration (IA)
      </h2>
      <p className="mb-3 text-xs text-violet-700/80">
        Décris la stack du client (« backend Django 4 derrière nginx ») ou un blocage (« le
        snippet est posé mais rien n&apos;arrive ») — l&apos;assistant génère le middleware ou le
        diagnostic. Il connaît le protocole et les pièges rencontrés en vrai.
      </p>
      {state === "disabled" ? (
        <p className="rounded border border-violet-200 bg-white px-3 py-2 text-xs text-slate-500">
          Assistant désactivé — ajouter <code>ANTHROPIC_API_KEY</code> aux variables
          d&apos;environnement de la console pour l&apos;activer. Le guide ci-dessus couvre déjà
          FastAPI, Express et le protocole générique.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              placeholder="Ex. : génère le middleware pour Django 4 + gunicorn, config via django-environ"
              className="grow rounded-md border border-violet-200 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={ask}
              disabled={state === "loading"}
              className="self-end rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {state === "loading" ? "…" : "Demander"}
            </button>
          </div>
          {answer && (
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-violet-200 bg-white p-3 text-xs leading-relaxed text-slate-800">
              {answer}
            </pre>
          )}
        </>
      )}
    </section>
  );
}
