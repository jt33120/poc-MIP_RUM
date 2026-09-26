// Stack du dernier exemplaire d'un groupe historique ou d'une issue, avec sa
// release, son environnement déclaré, sa vue et sa position source. Rendu serveur.
//
// Ce qui est lu — la symbolication, et le contexte de code réservé à
// l'administrateur — l'est par le chargeur de l'écran (`lib/chargeurs/pile-erreur.ts`,
// C4) : ce composant rend ce qu'il reçoit, sur le fil.
import Link from "next/link";
import type { Fil } from "@mip/console-contract";
import type { PileErreur } from "@/lib/chargeurs/pile-erreur";
import { fmtDate } from "@/lib/format";
import type { ErrorExemplar } from "@/lib/queries-errors";

type StackSymbolication = NonNullable<Fil<PileErreur>["symbolication"]>;
type CodeContext = NonNullable<Fil<PileErreur>["contexte"]>;

export function ErrorStackCard({
  last,
  pile,
  appId,
  admin = false,
}: {
  last: ErrorExemplar | null;
  /** La pile lue par le chargeur : symbolication, et contexte de code pour l'admin hors démo. */
  pile: Fil<PileErreur>;
  /** App du groupe : le lien de téléversement d'une source map la porte. */
  appId: string;
  /** Administrateur hors démo : lui seul peut téléverser une source map. */
  admin?: boolean;
}) {
  const { symbolication, contexte } = pile;
  const deminified = symbolication?.symbolication_status === "resolved" && !!symbolication.stack_symbolicated;

  return (
    // `overflow-hidden` n'est là que pour les coins arrondis : les `<pre>` défilent
    // eux-mêmes. `min-w-0` : dans une grille, une longue ligne de pile n'élargit pas
    // la colonne (et donc la page) — c'est le `<pre>` qui défile.
    <div className="card mb-6 min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Pile d&apos;appels du dernier exemplaire ({last ? fmtDate(last.ts) : "—"})
        {deminified && (
          <span
            data-testid="stack-deminified"
            className="rounded bg-good/10 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-good-ink"
          >
            dé-minifié{last?.release ? ` · ${last.release}` : ""}
          </span>
        )}
        {!deminified && last?.release && (
          <span className="font-mono text-xs font-normal normal-case tracking-normal text-ink-faint">
            release {last.release}
          </span>
        )}
        {last?.env && (
          <span
            className="font-mono text-xs font-normal normal-case tracking-normal text-ink-faint"
            title="Environnement déclaré par l'émetteur (le SDK web vaut « dev » par défaut) : pas une vérité de déploiement."
          >
            env {last.env} (déclaré)
          </span>
        )}
        {last?.view_name && (
          <span className="font-mono text-xs font-normal normal-case tracking-normal text-ink-faint">
            vue {last.view_name}
          </span>
        )}
        {last?.source && (
          <span className="ml-auto break-all font-mono text-xs font-normal normal-case tracking-normal text-ink-faint">
            {last.source}
            {last.lineno != null && `:${last.lineno}`}
            {last.colno != null && `:${last.colno}`}
          </span>
        )}
      </div>
      <SymbolicationNotice
        symbolication={symbolication}
        release={last?.release ?? null}
        televerserHref={admin ? `/admin/sourcemaps?app=${encodeURIComponent(appId)}` : null}
      />
      {/* terminal navy permanent : lisible dans les deux thèmes */}
      <pre className="max-w-full overflow-x-auto bg-navy-950 p-4 text-xs leading-relaxed text-slate-200">
        {(deminified ? symbolication?.stack_symbolicated : last?.stack) ?? last?.message ?? "(aucune pile capturée)"}
      </pre>
      {deminified && last?.stack && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-4 py-2 text-xs text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
            Pile brute (minifiée)
          </summary>
          <pre className="max-w-full overflow-x-auto bg-navy-950 p-4 text-xs leading-relaxed text-slate-300">{last.stack}</pre>
        </details>
      )}
      {contexte && <CodeContextBlock context={contexte} />}
    </div>
  );
}

/**
 * Pourquoi la stack affichée n'est pas en positions source, dit explicitement :
 * une release sans map, une map inutilisable ou une symbolication différée ne se
 * confondent pas avec une stack réellement résolue.
 */
function SymbolicationNotice({
  symbolication,
  release,
  televerserHref,
}: {
  symbolication: StackSymbolication | null;
  release: string | null;
  /** Écran de téléversement des source maps (administrateur) ; `null` : un autre compte. */
  televerserHref: string | null;
}) {
  const status = symbolication?.symbolication_status;
  if (!symbolication || !status) return null;
  if (status === "resolved") {
    return symbolication.origin === "lecture" ? (
      <p className="border-b border-line px-4 py-2 text-xs text-ink-soft">
        Symbolisée à l&apos;affichage : la source map de la release a été mise en ligne après l&apos;erreur.
      </p>
    ) : null;
  }
  const titre =
    status === "failed" ? "Source map inutilisable" : status === "pending" ? "Symbolication différée" : "Pile non symbolisée";
  // Une app sans source map n'est pas en défaut : seuls l'échec et le report alertent.
  const ton = status === "unavailable" ? "bg-panel2" : "bg-warn/10";
  return (
    <p role="status" data-testid="symbolication-status" className={`border-b border-line px-4 py-2 text-xs text-ink-soft ${ton}`}>
      <strong className="font-semibold text-ink">{titre}</strong>
      {" — "}
      {symbolication.reason ?? (release ? `aucune source map exploitable pour la release ${release}` : "release absente")}
      {/* Recette du 26/09/2026 : la phrase ne disait pas quoi faire. Une symbolication
          différée n'appelle aucun geste ; les deux autres états, un téléversement. */}
      {status !== "pending" &&
        (televerserHref ? (
          <>
            {" "}
            <Link href={televerserHref} className="whitespace-nowrap rounded text-brand hover:underline" data-testid="televerser-source-map">
              Téléverser une source map →
            </Link>
          </>
        ) : (
          " Un administrateur peut téléverser la source map de cette release."
        ))}
    </p>
  );
}

/** ±3 lignes de code source autour de la première frame résolue (admin seulement). */
function CodeContextBlock({ context }: { context: CodeContext }) {
  return (
    <figure className="border-t border-line" data-testid="code-context">
      <figcaption className="break-all px-4 py-2 font-mono text-xs text-ink-soft">
        {context.source}:{context.line} <span className="font-sans text-ink-faint">· visible par les admins</span>
      </figcaption>
      <pre className="relative max-w-full overflow-x-auto bg-navy-950 py-3 text-xs leading-relaxed text-slate-300">
        {context.lines.map((ligne, i) => {
          const numero = context.start + i;
          const courante = numero === context.line;
          return (
            <div key={numero} className={courante ? "bg-accent/20 px-4 text-slate-100" : "px-4"}>
              <span className="mr-4 inline-block w-10 select-none text-right text-slate-500" aria-hidden="true">
                {numero}
              </span>
              <span className="sr-only">{courante ? `ligne ${numero}, ligne résolue de la pile : ` : `ligne ${numero} : `}</span>
              {ligne}
            </div>
          );
        })}
      </pre>
    </figure>
  );
}
