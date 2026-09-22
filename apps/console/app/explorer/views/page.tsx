// Vues enregistrées de l'Explorer (P6.5) — rendu 100 % serveur.
//
// CE QUE LA LISTE MONTRE. Les vues du compte connecté, plus — pour un admin —
// celles des autres comptes de ses apps. Aucune vue n'est publique : le périmètre
// est celui de la session, et une vue d'une app non autorisée n'apparaît pas.
//
// UNE VUE ILLISIBLE RESTE ÉDITABLE. Un AST écrit par une version antérieure du
// registre, ou devenu invalide depuis, n'est pas supprimé en silence : la ligne
// affiche sa raison, sans lien « ouvrir », et garde renommage et suppression.
//
// F34 (§ 5.22) — L'ÉCRAN RÉPOND À « QUE MESURENT-ELLES ? ». Le nom qu'un
// utilisateur donne à une vue ne dit pas la mesure : une colonne « Ce qu'elle
// mesure » la résume depuis l'AST (`resumeVue`, même lecture que la réouverture).
// Les six analyses de départ de l'Explorer sont listées en tête, « fournies » et
// en lecture seule. Supprimer se fait en deux temps (un `<details>`, puis
// « Confirmer la suppression »), sans couleur de verdict (CE11). Une session de
// démonstration ne voit AUCUN bouton d'écriture (V9) : ils ne sont pas rendus,
// plutôt que rendus puis refusés par le middleware.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ActionsVue } from "@/components/explorer/ActionsVue";
import { ModelesDepart } from "@/components/explorer/ModelesDepart";
import { getUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { explorerHrefFromAst, resumeVue } from "@/lib/explorer-page-params";
import { MODELES_EXPLORER, modelesDeDepart, type ModeleDepart } from "@/lib/explorer-modeles";
import { pageFilters } from "@/lib/page-filters";
import { listSavedViews, savedViewReader } from "@/lib/queries-saved-views";
import { dimensionSchema } from "@/lib/query-schema";
import { SAVED_VIEW_MAX_PER_APP } from "@/lib/saved-views";
import { VIEW_CONTEXT_PARAMS } from "@/lib/view-state";
import { paramReader } from "@/lib/query-contract";
import type { SearchParams } from "@/lib/filters";

export const dynamic = "force-dynamic";

/** La question de l'écran (P1). */
const QUESTION = "Quelles analyses ai-je gardées, que mesurent-elles, et lesquelles ne se relisent plus ?";

/**
 * Les analyses fournies, liées à l'Explorer EXÉCUTÉ sur les filtres de l'URL (ceux
 * de l'Explorer : les liens y mènent). Des filtres refusés ne cachent pas les
 * modèles : chacun est montré sans lien, avec la raison.
 */
async function modelesFournis(sp: SearchParams): Promise<ModeleDepart[]> {
  const ecran = await pageFilters(sp, "/explorer");
  if (!ecran.ok) {
    return MODELES_EXPLORER.map((m) => ({
      cle: m.cle,
      titre: m.titre,
      question: m.question,
      href: null,
      raison: `filtres de l’adresse refusés : ${ecran.problem.message}`,
    }));
  }
  const reader = paramReader(sp);
  const vue = Object.fromEntries(VIEW_CONTEXT_PARAMS.map((nom) => [nom, reader.get(nom)]));
  return modelesDeDepart(ecran.query, await dimensionSchema(), vue);
}

export default async function Vues({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const user = await getUser();
  if (!user) return null;
  const sp = (await searchParams) ?? {};
  const reader = await savedViewReader(user);
  const [result, modeles] = await Promise.all([listSavedViews(reader), modelesFournis(sp)]);
  const demo = user.demo === true;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Vues enregistrées" sub={QUESTION}>
        <Link href="/explorer" className="btn-ghost">
          ← Explorer
        </Link>
      </PageHeader>
      <p className="-mt-4 mb-6 text-xs text-ink-soft">
        Analyses de l’Explorer conservées pour les rejouer : chacune se relit avec les droits de son lecteur, sur la
        fenêtre de l’écran. {SAVED_VIEW_MAX_PER_APP} au plus par application ; elles restent personnelles — aucune
        n’est publique.
      </p>

      {sp.conflit === "1" && (
        <p role="alert" data-testid="vues-conflit" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Cette vue a changé depuis son affichage : rien n’a été écrit. La liste ci-dessous est à jour.
        </p>
      )}
      {sp.refus === "1" && (
        <p role="alert" data-testid="vues-refus" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Opération refusée : une vue enregistrée n’est modifiable que par son propriétaire, dans une application de
          son périmètre. Rien n’a été écrit.
        </p>
      )}
      {sp.plafond === "1" && (
        <p role="alert" data-testid="vues-plafond" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          Plafond atteint : {SAVED_VIEW_MAX_PER_APP} vues enregistrées par application. En supprimer avant d’en
          ajouter.
        </p>
      )}

      {/* W-V1 : les analyses fournies — des liens, qui ne lisent rien avant le clic. */}
      <section aria-labelledby="modeles-fournis-titre" data-testid="vues-modeles" className="card mb-6 min-w-0 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="modeles-fournis-titre" className="text-sm font-semibold text-ink">
            Modèles fournis
          </h2>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft">fourni</span>
          <span className="min-w-0 basis-full text-xs text-ink-soft sm:basis-auto">
            lecture seule : ni renommables, ni supprimables ; chacun s’ouvre exécuté dans l’Explorer.
          </span>
        </div>
        <ModelesDepart modeles={modeles} compact />
      </section>

      <h2 className="mb-2 text-sm font-semibold text-ink">Mes vues</h2>

      {result.kind === "unavailable" && (
        <p role="status" data-testid="vues-indisponibles" className="card px-4 py-8 text-center text-sm text-ink-soft">
          Les vues enregistrées ne sont pas encore disponibles sur cette base : la migration v79 n’est pas appliquée.
          L’Explorer reste utilisable, et ses requêtes restent partageables par leur URL.
        </p>
      )}
      {result.kind === "forbidden" && (
        <p role="alert" className="card px-4 py-8 text-center text-sm text-ink-soft">
          {result.error}
        </p>
      )}

      {result.kind === "ok" && (
        // `overflow-x-auto` et non `overflow-hidden` : à 390 px, six colonnes dont
        // un champ de saisie ne tiennent pas. Les MASQUER rendrait le renommage
        // inatteignable ; les faire défiler le garde accessible.
        // `relative` : la légende et les libellés `sr-only` (position: absolute) restent
        // dans ce conteneur défilant au lieu d'élargir la page (piège 16).
        <div className="card relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Vues enregistrées lisibles par ce compte</caption>
            <thead>
              <tr>
                <th scope="col" className="th text-left">Nom</th>
                <th scope="col" className="th text-left">Ce qu’elle mesure</th>
                <th scope="col" className="th text-left">App</th>
                <th scope="col" className="th text-left">Propriétaire</th>
                <th scope="col" className="th text-right">Mise à jour</th>
                <th scope="col" className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.value.map((vue) => {
                const ouvrir = explorerHrefFromAst(vue.query);
                const resume = resumeVue(vue.query);
                return (
                  <tr key={vue.id} className="border-t border-line align-top hover:bg-panel2" data-testid={`vue-${vue.id}`}>
                    <td className="px-3 py-2 font-medium">
                      {ouvrir.ok ? (
                        <Link href={ouvrir.href} className="text-accent hover:underline">
                          {vue.name}
                        </Link>
                      ) : (
                        <span className="text-ink">{vue.name}</span>
                      )}
                    </td>
                    <td className="min-w-48 px-3 py-2 text-xs" data-testid="vue-mesure">
                      {resume.ok ? (
                        <span className="text-ink">{resume.texte}</span>
                      ) : (
                        <p role="note" className="max-w-sm break-words text-ink-soft">
                          Requête illisible : {resume.raison}. La vue est conservée — la renommer ou la supprimer
                          reste possible.
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{vue.app_id}</td>
                    <td className="px-3 py-2 text-ink-soft">
                      {vue.mine ? "vous" : (vue.owner_email ?? "un autre compte")}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-soft">
                      {fmtDate(vue.updated_at)}
                    </td>
                    <td className="px-3 py-2">
                      <ActionsVue vue={vue} demo={demo} />
                    </td>
                  </tr>
                );
              })}
              {!result.value.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-ink-soft">
                    Aucune vue enregistrée — en composer une dans l’Explorer, puis l’enregistrer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
