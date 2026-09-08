// Fiche d'appel — déroulé chronologique des étapes d'un appel SVI.
//
// Écran DÉDIÉ plutôt que réutilisation de /tracing/[traceId] : cette page-là code
// en dur des paliers navigateur / serveur / base et un texte parlant de navigateur.
// Un appel s'y afficherait en gris, étiqueté « interne », sous un sous-titre hors
// sujet — la porte du cadrage passerait à la lettre et échouerait en esprit.
// Cf. l'en-tête de migration-v51.
import Link from "next/link";
import { CapaciteFermee, estFermee } from "@/components/CapaciteFermee";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/format";
import { parseFilters, type SearchParams } from "@/lib/queries-v2";
import { sviCallDetail } from "@/lib/queries-svi";
import { fmtDuration, outcomeLabel } from "@/lib/svi-outcome";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  disclosure: "information IA",
  greeting: "message d'accueil",
  prompt: "invite",
  menu: "menu",
  input: "saisie",
  lookup: "consultation",
  queue: "file d'attente",
  transfer: "transfert",
  agent: "conseiller",
  bot_turn: "tour de parole",
  disconnect: "raccroché",
  error: "erreur",
};

const KIND_COLOR: Record<string, string> = {
  menu: "bg-sky-400", input: "bg-violet-400", queue: "bg-amber-400",
  transfer: "bg-sky-500", agent: "bg-emerald-400", error: "bg-red-400",
  disconnect: "bg-ink-faint",
};

export default async function FicheAppel({
  params,
  searchParams,
}: {
  params: Promise<{ callId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  if (estFermee("/svi")) {
    return (
      <CapaciteFermee
        titre="Supervision SVI"
        sujet="Supervision du serveur vocal interactif."
      />
    );
  }

  const { callId } = await params;
  const f = parseFilters(await searchParams);

  // `f.app` est la portée de l'utilisateur : un appel d'une autre app est
  // introuvable, pas « interdit ». On ne révèle pas son existence.
  const detail = await sviCallDetail(f.app, callId);
  if (!detail) notFound();
  const { call, steps } = detail;

  // Échelle du déroulé : on borne au plus tard entre la fin déclarée de l'appel
  // et la dernière étape observée — sinon une étape dépassant la durée annoncée
  // sortirait silencieusement du cadre.
  const t0 = new Date(call.started_at).getTime();
  const finEtapes = steps.reduce((max, s) => {
    const fin = new Date(s.started_at).getTime() + (s.duration_ms ?? 0);
    return Math.max(max, fin);
  }, t0);
  const total = Math.max(call.duration_ms ?? 0, finEtapes - t0, 1);

  return (
    <>
      <PageHeader
        title="Déroulé de l'appel"
        sub={
          <>
            <Link className="hover:underline" href="/svi/appels">
              ← Tous les appels
            </Link>
            <span className="mx-2 text-ink-faint">·</span>
            <code className="chip-mono">{call.call_id.slice(0, 16)}…</code>
          </>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Issue", outcomeLabel(call.outcome)],
          ["Durée", fmtDuration(call.duration_ms)],
          ["Attente", fmtDuration(call.wait_ms)],
          ["MOS moyen", call.mos_avg == null ? "—" : call.mos_avg.toFixed(2)],
          ["Point d'entrée", call.entry_point ?? "—"],
          ["Parcours final", call.menu_path_final ?? "—"],
          ["File", call.queue_name ?? "—"],
          ["Détail d'issue", call.outcome_detail ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-line bg-panel p-3">
            <div className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</div>
            <div className="mt-1 text-sm">{value}</div>
          </div>
        ))}
      </section>

      {/* Provenance affichée : elle dit ce que cet appel permet ou non de calculer. */}
      <p className="mb-6 text-xs text-ink-soft">
        Niveaux de données disponibles :{" "}
        {call.provenance.length === 0 ? (
          <em>aucun déclaré</em>
        ) : (
          call.provenance.map((p) => (
            <span key={p} className="mr-1 rounded border border-line bg-panel2 px-1.5 py-0.5">
              {p}
            </span>
          ))
        )}
        {!call.provenance.includes("journey") && (
          <> — sans le niveau « journey », le détail de parcours ci-dessous est partiel.</>
        )}
        {call.is_test && <> · appel de démonstration ({call.platform}), exclu du trafic réel.</>}
      </p>

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Étapes ({steps.length})
      </h2>
      {steps.length === 0 ? (
        <p className="rounded border border-line bg-panel p-4 text-sm text-ink-soft">
          Aucune étape enregistrée pour cet appel. Le détail de parcours exige que le flow du SVI
          soit instrumenté (niveau « journey ») ; l'entête d'appel seul provient du CDR.
        </p>
      ) : (
        <ol className="space-y-1">
          {steps.map((s) => {
            const debut = new Date(s.started_at).getTime() - t0;
            const largeur = Math.max(((s.duration_ms ?? 0) / total) * 100, 0.6);
            const gauche = Math.min((debut / total) * 100, 99.4);
            return (
              <li key={s.seq} className="rounded border border-line bg-panel p-2">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="tabular-nums text-ink-faint">#{s.seq}</span>
                  <span className="font-medium">{KIND_LABEL[s.kind] ?? s.kind}</span>
                  {s.node_label && <span className="text-ink-soft">— {s.node_label}</span>}
                  {/* La VALEUR saisie n'existe nulle part : on n'affiche que sa nature. */}
                  {s.input_class && (
                    <span className="rounded border border-line bg-panel2 px-1.5 py-0.5 text-[11px]">
                      {s.input_sensitive
                        ? "saisie masquée"
                        : `${s.input_class}${s.input_len ? ` (${s.input_len})` : ""}`}
                    </span>
                  )}
                  {s.no_match && <span className="text-amber-600 dark:text-amber-400">non reconnu</span>}
                  {s.no_input && <span className="text-amber-600 dark:text-amber-400">sans réponse</span>}
                  <span className="ml-auto tabular-nums text-ink-soft">
                    {fmtDuration(s.duration_ms)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded bg-panel2">
                  <div
                    className={`h-1.5 rounded ${KIND_COLOR[s.kind] ?? "bg-ink-faint"}`}
                    style={{ marginLeft: `${gauche}%`, width: `${Math.min(largeur, 100 - gauche)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
