// LE BADGE DE LA CHAÎNE DE MESURE, dans la barre du haut (étude A3 § 2.6) : sur
// chaque écran, dire si ce qu'on regarde est mesuré. Même verdict que la carte de
// `/admin/health` (`verdictMesure`), lu par la coquille et gardé 60 s
// (`lireEtatMesure`) : aucune lecture par écran, aucune à chaque actualisation.
//
// Rendu serveur, sans état. L'âge du dernier canari se calcule ICI, au rendu : le
// cache de 60 s ne fige pas le verdict — un canari qui se tait fait passer le
// badge au rouge à la minute près. Un administrateur de la plateforme suit le lien
// vers la carte ; les autres lisent le texte, sans lien vers un écran refusé.
//
// Étroit (< 640 px) : une pastille sans texte, la forme doublant la couleur ; le
// libellé complet reste aux lecteurs d'écran.
import Link from "next/link";
import type { EtatMesureCoquille } from "@mip/console-contract";
import { libelleBadgeMesure, verdictMesure, type NiveauChaine } from "@/lib/chaine-mesure";

const TON: Record<NiveauChaine, string> = {
  ok: "border-good/30 bg-good/10 text-good-ink",
  attention: "border-warn/40 bg-warn/10 text-warn-ink",
  incident: "border-bad/40 bg-bad/10 text-bad-ink",
  inconnu: "border-line bg-panel2 text-ink-soft",
};

/** La forme double la couleur : lisible sans elle (mêmes glyphes que la carte). */
const PASTILLE: Record<NiveauChaine, string> = { ok: "●", attention: "▲", incident: "■", inconnu: "○" };

export function BadgeMesure({ etat, lien, maintenant }: { etat: EtatMesureCoquille; lien: boolean; maintenant: number }) {
  const verdict = verdictMesure(etat, maintenant);
  const libelle = libelleBadgeMesure(verdict.niveau);
  const complet = `${verdict.titre}${verdict.detail ? `. ${verdict.detail}` : ""}`;
  const classe = `relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-full border px-1.5 text-[11px] font-semibold sm:px-2.5 ${TON[verdict.niveau]}`;
  const contenu = (
    <>
      <span aria-hidden="true" className="text-[10px] leading-none">
        {PASTILLE[verdict.niveau]}
      </span>
      <span className="hidden whitespace-nowrap sm:inline">{libelle}</span>
      <span className="sr-only sm:hidden">{libelle}</span>
      <span className="sr-only"> — {complet}</span>
    </>
  );
  const attributs = { "data-testid": "badge-mesure", "data-niveau": verdict.niveau, title: `${libelle} — ${complet}` };
  return lien ? (
    <Link
      href="/admin/health#chaine"
      className={`${classe} transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`}
      {...attributs}
    >
      {contenu}
    </Link>
  ) : (
    <span className={classe} {...attributs}>
      {contenu}
    </span>
  );
}
