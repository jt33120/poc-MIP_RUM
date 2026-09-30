// La carte en texte : les mêmes éléments, zone par zone, avec leurs faits et leurs
// sources. Rendue côté serveur : lisible sans JavaScript, par un lecteur d'écran ou un
// moteur de recherche, et imprimable. Elle lit la même donnée que la carte
// (lib/cartographie/donnees.ts) : l'une ne peut pas dire autre chose que l'autre.
import { CARTOGRAPHIE } from "@/lib/cartographie/donnees";
import { FAMILLES, STATUTS, adresseSource } from "@/lib/cartographie/types";

/** Les tiers n'ont pas de zone sur la carte : la version texte les range à la fin. */
const HORS_ZONE = { id: "tiers", titre: "Autour", sousTitre: "utilisateurs et services externes" } as const;

export function InventaireCarte({ depot }: { depot: string }) {
  return (
    <details className="group mt-6 rounded-2xl border border-white/10 bg-white/[0.02]" data-testid="carte-texte">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-white/85 hover:text-white">
        <span>
          La carte en texte : {CARTOGRAPHIE.elements.length} éléments, {CARTOGRAPHIE.liens.length} liens, relevés le{" "}
          {CARTOGRAPHIE.releveeLe}
        </span>
        <span aria-hidden className="text-[#f89101] transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="space-y-10 px-5 pb-8 pt-2">
        {[...CARTOGRAPHIE.zones, HORS_ZONE].map((z) => {
          const elements = CARTOGRAPHIE.elements.filter((e) => (e.zone ?? HORS_ZONE.id) === z.id);
          return (
            <section key={z.id} aria-labelledby={`carte-texte-${z.id}`}>
              <h3 id={`carte-texte-${z.id}`} className="text-lg font-bold text-white">
                {z.titre} <span className="text-sm font-normal text-white/50">— {z.sousTitre}</span>
              </h3>
              <ul className="mt-4 grid gap-4 md:grid-cols-2">
                {elements.map((e) => (
                  <li key={e.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4" id={`carte-${e.id}`}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: FAMILLES[e.famille].couleur }}>
                      {FAMILLES[e.famille].libelle}
                      {e.statut && e.statut !== "en-service" && <span className="ml-2 normal-case tracking-normal text-[#fbbc64]">· {STATUTS[e.statut]}</span>}
                    </p>
                    <p className="mt-1 font-semibold text-white">{e.titre}</p>
                    <p className="text-sm text-white/55">{e.sousTitre}</p>
                    <p className="mt-2 text-sm leading-relaxed text-white/80">{e.resume}</p>
                    {e.faits.length > 0 && (
                      <ul className="mt-2 space-y-1.5 text-sm text-white/70">
                        {e.faits.map((f) => (
                          <li key={f.texte}>
                            {f.texte}{" "}
                            {f.sources.map((s) => (
                              <a
                                key={s}
                                href={adresseSource(s, depot)}
                                className="ml-1 break-all font-mono text-[11px] text-[#fbbc64]/70 hover:text-[#fbbc64]"
                              >
                                {s}
                              </a>
                            ))}
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.liste && (
                      <p className="mt-2 text-xs leading-relaxed text-white/55">
                        {e.liste.titre} : <span className="font-mono">{e.liste.entrees.map((x) => x.nom).join(", ")}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
