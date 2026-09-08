// Espace PARTENAIRE : supervision IA propulsée par xSOM AI Guard (ADR-0001).
// Lecture seule via la façade xSOM (fetchAiSummary) — ZÉRO donnée IA stockée
// côté MIP RUM, aucune table rum_ai. Clairement badgé « sponsorisé xSOM » : c'est
// un placement partenaire, distinct du produit RUM natif de MIP.
import { PageHeader } from "@/components/PageHeader";
import { ICON_PATHS, Icon } from "@/components/icons";
import { CATEGORIES } from "@/components/nav-items";
import { parseFilters, periodLabel, type SearchParams } from "@/lib/queries-v2";
import { fetchAiSummary } from "@/lib/xsom-ai";
import { XsomSponsorBanner, XsomAiPanel } from "@/components/xsom/XsomAiPanel";

export const dynamic = "force-dynamic";

// Lien vers la console publique du partenaire (CTA). Configurable ; défaut = prod xSOM.
const XSOM_CONSOLE_URL = process.env.XSOM_CONSOLE_URL ?? "https://xsom-ai-guard-production.up.railway.app";

/** Même drapeau que la sidebar : l'accès se rouvre en un seul endroit. */
const FERME = CATEGORIES.find((c) => c.href === "/ai")?.verrouille === true;

export default async function AiPartner({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  // La sidebar n'y mène plus, mais l'URL reste tapable : le refus doit vivre ICI
  // aussi, sinon le cadenas n'est qu'un décor. Aucun appel à la façade xSOM n'est
  // émis tant que la capacité est fermée.
  if (FERME) return <AiFerme />;

  const sp = await searchParams;
  const f = parseFilters(sp);
  // xSOM expose 24h/7d/30d ; on mappe la période console (1h/24h/7d).
  const windowKey = f.period === "7d" ? "7d" : "24h";
  // Lecture façade — app-scopée par le token xSOM ; null (échec/non couvert) => état « indisponible ».
  const ai = f.app ? await fetchAiSummary(f.app, windowKey) : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        domain="ai"
        title="Supervision IA"
        sub="Espace partenaire — propulsé par xSOM AI Guard, distinct du RUM MIP."
      >
        <span className="rounded-full border border-ai/40 bg-ai/10 px-2.5 py-1 text-[11px] font-semibold text-ai">
          par xSOM
        </span>
      </PageHeader>

      <XsomSponsorBanner href={XSOM_CONSOLE_URL} />

      {ai ? (
        <XsomAiPanel ai={ai} periodLabel={periodLabel(f)} />
      ) : (
        <div className="card p-8 text-center">
          <h3 className="text-sm font-bold text-ink">Supervision IA indisponible ici</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">
            {f.app
              ? "xSOM AI Guard n'a pas (encore) de données pour cette application, ou le service est momentanément injoignable."
              : "Sélectionnez une application couverte par xSOM pour afficher sa supervision IA."}{" "}
            La supervision IA complète (coût, tokens, qualité, alertes) se consulte sur la console xSOM.
          </p>
          <a
            href={XSOM_CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block rounded-lg border border-ai/40 px-4 py-2 text-sm font-semibold text-ai transition hover:bg-ai/10"
          >
            Ouvrir xSOM AI Guard →
          </a>
        </div>
      )}
    </div>
  );
}

/** Écran de capacité fermée — annoncée, pas encore ouverte. */
function AiFerme() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Supervision IA"
        sub="Supervision des agents et modèles en production. Capacité annoncée, accès non ouvert."
      />
      <div className="card flex max-w-2xl flex-col items-start gap-3 p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel2 text-ink-faint">
          <Icon paths={ICON_PATHS.lock} className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <h2 className="text-base font-semibold text-ink">Accès fermé pour le moment</h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          Cet espace n&apos;est pas encore ouvert. Le reste de la console — performance, sessions,
          erreurs, objectifs et alertes — fonctionne normalement.
        </p>
      </div>
    </div>
  );
}
