// Bulle d'aide branchée sur le glossaire : <GlossaryTip id="LCP" />.
// Restitue les trois niveaux de lecture (technique / stack / commercial) avec
// une mise en forme homogène sur toute la console.
import { GLOSSARY, type GlossaryId } from "@/lib/glossary";
import { InfoTip } from "./InfoTip";

export function GlossaryTip({
  id,
  side = "bottom",
  className = "",
}: {
  id: GlossaryId;
  side?: "top" | "bottom";
  className?: string;
}) {
  const e = GLOSSARY[id];
  return (
    <InfoTip side={side} className={className} label={`Aide : ${e.label}`}>
      <span className="mb-1.5 block text-sm font-semibold text-ink">{e.label}</span>
      <Row tag="Technique" tone="brand" text={e.term} />
      <Row tag="Stack" tone="accent" text={e.stack} />
      <Row tag="En clair" tone="emerald" text={e.business} />
    </InfoTip>
  );
}

const TONE: Record<string, string> = {
  brand: "bg-brand/10 text-brand",
  accent: "bg-accent/15 text-accent-ink",
  emerald:
    "bg-good/10 text-good-ink",
};

function Row({ tag, tone, text }: { tag: string; tone: string; text: string }) {
  return (
    <span className="mt-1.5 block">
      <span
        className={`mb-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE[tone]}`}
      >
        {tag}
      </span>
      <span className="block text-ink-soft">{text}</span>
    </span>
  );
}
