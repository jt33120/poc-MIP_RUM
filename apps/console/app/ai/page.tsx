// Espace PARTENAIRE : supervision IA propulsée par xSOM AI Guard (ADR-0001).
// Lecture seule via la façade xSOM (fetchAiSummary) — ZÉRO donnée IA stockée
// côté MIP RUM, aucune table rum_ai. Clairement badgé « sponsorisé xSOM » : c'est
// un placement partenaire, distinct du produit RUM natif de MIP.
import { ECRANS } from "@mip/console-contract";
import { PageHeader } from "@/components/PageHeader";
import { CapaciteFermee, estFermee } from "@/components/CapaciteFermee";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { chargerAi } from "@/lib/chargeurs/ai";
import { chargerEcran } from "@/lib/ecran";
import { XsomSponsorBanner, XsomAiPanel } from "@/components/xsom/XsomAiPanel";

export const dynamic = "force-dynamic";

// Lien vers la console publique du partenaire (CTA). Configurable ; défaut = prod xSOM.
const XSOM_CONSOLE_URL = process.env.XSOM_CONSOLE_URL ?? "https://xsom-ai-guard-production.up.railway.app";

export default async function AiPartner({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  // La sidebar n'y mène plus, mais l'URL reste tapable : le refus doit vivre ICI
  // aussi, sinon le cadenas n'est qu'un décor. Aucun appel à la façade xSOM n'est
  // émis tant que la capacité est fermée.
  if (estFermee("/ai")) {
    return (
      <CapaciteFermee
        titre="Supervision IA"
        sujet="Supervision des agents et modèles en production."
      />
    );
  }

  // Le chargeur (`lib/chargeurs/ai.ts`) lit la façade xSOM, app par app.
  const ecran = await chargerEcran(ECRANS.ai, chargerAi, (await searchParams) ?? {});
  if (ecran.etat === "fermee") {
    return <CapaciteFermee titre="Supervision IA" sujet="Supervision des agents et modèles en production." />;
  }
  if (ecran.etat === "refus") return <FilterProblemNotice title="Assistant IA" problem={ecran.problem} />;
  const { ai, periode } = ecran;
  const f = { app: ecran.app };

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
        <XsomAiPanel ai={ai} periodLabel={periode} />
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

